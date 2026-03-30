// AutoGroupEngine.ts — Pure logic for auto-grouping ungrouped pages by token overlap + LLM semantic grouping
// No React dependencies. Handles clustering, cost estimation, prompt building, response parsing, queue processing.

import type { ClusterSummary, AutoGroupCluster, AutoGroupSuggestion, ReconciliationCandidate } from './types';
import {
  OPENROUTER_REQUEST_TIMEOUT_MS,
  runWithOpenRouterTimeout,
} from './openRouterTimeout';

/** Max ungrouped pages (keywords) per v1 assignment API call — UI slider and prompts stay aligned to this. */
export const AUTO_GROUP_MAX_BATCH_PAGES = 500;

/** `max_tokens` for OpenRouter so large assignment JSON is not truncated (provider cap 65536). */
export function computeAutoGroupAssignmentMaxTokens(batchPageCount: number): number {
  const n = Math.max(1, Math.min(batchPageCount, AUTO_GROUP_MAX_BATCH_PAGES));
  const estimated = 8192 + n * 140;
  return Math.min(65536, Math.max(4096, estimated));
}

/** `max_tokens` for cosine summary JSON with one entry per page. */
export function computeCosineSummaryMaxTokens(batchPageCount: number): number {
  const n = Math.max(1, Math.min(batchPageCount, AUTO_GROUP_MAX_BATCH_PAGES));
  const estimated = 4096 + n * 110;
  return Math.min(65536, Math.max(4096, estimated));
}
import type { ReviewEngineConfig } from './GroupReviewEngine';

// ─── Token Cluster Computation (no API, pure logic) ───

/** Generate all C(n,k) combinations from an array */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k > arr.length || k <= 0) return [];
  if (k === arr.length) return [arr];
  if (k === 1) return arr.map(v => [v]);

  const result: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const head = arr[i];
    const tailCombos = combinations(arr.slice(i + 1), k - 1);
    for (const combo of tailCombos) {
      result.push([head, ...combo]);
    }
  }
  return result;
}

/** Cap tokens at MAX_TOKENS_PER_PAGE for combination generation */
const MAX_TOKENS_PER_PAGE = 12;

/** Helper to build cluster stats */
function buildClusterStats(pages: ClusterSummary[]): { totalVolume: number; keywordCount: number; avgKd: number | null } {
  const totalVolume = pages.reduce((s, p) => s + p.totalVolume, 0);
  const keywordCount = pages.reduce((s, p) => s + p.keywordCount, 0);
  let totalKd = 0, kdCount = 0;
  pages.forEach(p => { if (p.avgKd !== null) { totalKd += p.avgKd * p.keywordCount; kdCount += p.keywordCount; } });
  return { totalVolume, keywordCount, avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null };
}

/** Helper to score confidence */
function scoreConfidence(pageCount: number, stage: number): 'high' | 'medium' | 'review' {
  if (stage >= 5 || pageCount <= 5) return 'high';
  if (stage >= 4 || pageCount <= 15) return 'medium';
  return 'review';
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildSuggestionFromPages(
  id: string,
  sourceClusterId: string,
  pages: ClusterSummary[],
  source: AutoGroupSuggestion['source'],
  stage?: number
): AutoGroupSuggestion {
  const sorted = [...pages].sort((a, b) => b.totalVolume - a.totalVolume);
  const stats = buildClusterStats(sorted);

  return {
    id,
    sourceClusterId,
    groupName: sorted[0]?.pageName || sourceClusterId,
    pages: sorted,
    ...stats,
    status: 'pending',
    retryCount: 0,
    stage,
    source,
  };
}

export interface AutoGroupBatchAssignment {
  pageId: string;
  page: string;
  targetGroupName: string;
}

export interface AutoGroupBatchPromptInput {
  batch: ClusterSummary[];
  existingGroupNames: string[];
}

export function buildAutoGroupSuggestionFromPages(
  id: string,
  sourceClusterId: string,
  pages: ClusterSummary[],
  source: AutoGroupSuggestion['source'] = 'llm-v1',
  stage?: number
): AutoGroupSuggestion {
  return buildSuggestionFromPages(id, sourceClusterId, pages, source, stage);
}

export function buildTwoTokenBatchClusters(pages: ClusterSummary[], batchSize = AUTO_GROUP_MAX_BATCH_PAGES): AutoGroupCluster[] {
  const twoTokenPages = pages
    .filter(page => page.tokenArr.length === 2)
    .sort((a, b) => {
      const tokenCmp = a.tokens.localeCompare(b.tokens);
      if (tokenCmp !== 0) return tokenCmp;
      return b.totalVolume - a.totalVolume;
    });

  const batches: AutoGroupCluster[] = [];
  for (let i = 0; i < twoTokenPages.length; i += batchSize) {
    const batchPages = twoTokenPages.slice(i, i + batchSize);
    if (batchPages.length === 0) continue;
    const stats = buildClusterStats(batchPages);
    batches.push({
      id: `two_token_batch_${i / batchSize}`,
      sharedTokens: [],
      pages: batchPages,
      ...stats,
      pageCount: batchPages.length,
      confidence: 'review',
      isIdentical: false,
      stage: 2,
    });
  }

  return batches;
}

export function buildSingleTokenSuggestions(pages: ClusterSummary[]): AutoGroupSuggestion[] {
  return pages
    .filter(page => page.tokenArr.length === 1)
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .map(page =>
      buildSuggestionFromPages(
        `single_token_${page.tokens}`,
        `single_token_${page.tokens}`,
        [page],
        'single-token',
        1
      )
    );
}

/**
 * Build cascading token clusters from ungrouped pages.
 * Cascades from max token overlap down to 2-token overlap.
 * Each stage removes matched pages from the pool before the next stage runs.
 * Pages with <2 tokens or no matches become 1-page clusters.
 */
export function buildCascadingClusters(pages: ClusterSummary[]): AutoGroupCluster[] {
  if (!pages || pages.length === 0) return [];

  const pageIndex = new Map<string, ClusterSummary>();
  for (const p of pages) pageIndex.set(p.tokens, p);

  // Find max token count across all pages
  let maxTokens = 0;
  for (const p of pages) {
    if (p.tokenArr.length > maxTokens) maxTokens = p.tokenArr.length;
  }

  const allClusters: AutoGroupCluster[] = [];
  const assignedPages = new Set<string>(); // Track by tokens (unique per page)

  // Phase 1: Find 100% identical signature groups (any stage)
  const signatureMap = new Map<string, ClusterSummary[]>();
  for (const page of pages) {
    const sig = page.tokens;
    const existing = signatureMap.get(sig);
    if (existing) existing.push(page);
    else signatureMap.set(sig, [page]);
  }

  for (const [sig, group] of signatureMap) {
    if (group.length >= 2) {
      const stats = buildClusterStats(group);
      const stage = group[0].tokenArr.length; // identical = all tokens match
      allClusters.push({
        id: `identical_${sig}`,
        sharedTokens: [...group[0].tokenArr].sort(),
        pages: group,
        ...stats,
        pageCount: group.length,
        confidence: 'high',
        isIdentical: true,
        stage,
      });
      for (const p of group) assignedPages.add(p.tokens);
    }
  }

  // Phase 2: Cascade from maxTokens down to 2
  for (let stage = Math.min(maxTokens, MAX_TOKENS_PER_PAGE); stage >= 2; stage--) {
    // Only consider pages not yet assigned and with enough tokens for this stage
    const remainingPages = pages.filter(p => !assignedPages.has(p.tokens) && p.tokenArr.length >= stage);
    if (remainingPages.length < 2) continue;

    // Build combo map for this stage
    const comboMap = new Map<string, Set<string>>();
    for (const page of remainingPages) {
      const tokens = page.tokenArr.length > MAX_TOKENS_PER_PAGE
        ? page.tokenArr.slice(0, MAX_TOKENS_PER_PAGE)
        : page.tokenArr;
      const sortedTokens = [...tokens].sort();
      const combos = combinations(sortedTokens, stage);
      for (const combo of combos) {
        const key = combo.join('|');
        const existing = comboMap.get(key);
        if (existing) existing.add(page.tokens);
        else comboMap.set(key, new Set([page.tokens]));
      }
    }

    // Form clusters (2+ pages sharing this many tokens)
    const stageClusters: Array<{ sharedTokens: string[]; pageTokens: Set<string> }> = [];
    for (const [key, pageTokensSet] of comboMap) {
      if (pageTokensSet.size >= 2) {
        stageClusters.push({ sharedTokens: key.split('|'), pageTokens: pageTokensSet });
      }
    }

    // Sort by page count desc (larger clusters get priority)
    stageClusters.sort((a, b) => b.pageTokens.size - a.pageTokens.size);

    // Assign pages to clusters (greedy, largest first, only unassigned)
    for (const { sharedTokens, pageTokens } of stageClusters) {
      const unassigned = [...pageTokens].filter(t => !assignedPages.has(t));
      if (unassigned.length < 2) continue;

      const clusterPages = unassigned.map(t => pageIndex.get(t)!).filter(Boolean);
      if (clusterPages.length < 2) continue;

      const stats = buildClusterStats(clusterPages);
      allClusters.push({
        id: `stage${stage}_${sharedTokens.join('_')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sharedTokens,
        pages: clusterPages,
        ...stats,
        pageCount: clusterPages.length,
        confidence: scoreConfidence(clusterPages.length, stage),
        isIdentical: false,
        stage,
      });

      for (const t of unassigned) assignedPages.add(t);
    }
  }

  // Phase 3: Any remaining unmatched pages with 2+ tokens become 1-page clusters
  // (1-token pages are excluded per spec)
  for (const page of pages) {
    if (!assignedPages.has(page.tokens) && page.tokenArr.length >= 2) {
      const stats = buildClusterStats([page]);
      allClusters.push({
        id: `single_${page.tokens}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sharedTokens: [...page.tokenArr].sort(),
        pages: [page],
        ...stats,
        pageCount: 1,
        confidence: 'review',
        isIdentical: false,
        stage: 1, // single-page, lowest stage
      });
      assignedPages.add(page.tokens);
    }
  }

  // Sort by stage desc (tightest matches first), then volume desc
  allClusters.sort((a, b) => {
    if (b.stage !== a.stage) return b.stage - a.stage;
    return b.totalVolume - a.totalVolume;
  });

  return allClusters;
}

// Keep old name as alias for backward compatibility
export const buildTokenClusters = buildCascadingClusters;

/** Count total pages covered by clusters (deduped) */
export function countCoveredPages(clusters: AutoGroupCluster[]): number {
  const seen = new Set<string>();
  for (const c of clusters) {
    for (const p of c.pages) seen.add(p.tokens);
  }
  return seen.size;
}

// ─── Cost Estimation ───

export function estimateCost(
  clusters: AutoGroupCluster[],
  pricing: { prompt: string; completion: string }
): number {
  const promptPricePerToken = parseFloat(pricing.prompt) || 0;
  const completionPricePerToken = parseFloat(pricing.completion) || 0;

  let totalCost = 0;
  for (const cluster of clusters) {
    // Estimate: ~50 tokens per page name + tokens, ~200 tokens system prompt, ~100 tokens response
    const estimatedPromptTokens = 200 + cluster.pageCount * 50;
    const estimatedCompletionTokens = 50 + cluster.pageCount * 20;
    totalCost += estimatedPromptTokens * promptPricePerToken + estimatedCompletionTokens * completionPricePerToken;
  }
  return totalCost;
}

// ─── LLM Prompt Building ───

const DEFAULT_AUTO_GROUP_PROMPT = `You are a strict SEO grouping expert. You will receive a list of pages that share common tokens. Your job is to split them into semantic groups where each group represents a SINGLE, IDENTICAL search intent.

STRICT GROUPING RULES:
1. ONLY group pages if they share the COMPLETE and FULL core semantic intent. Minor lexical variation is fine (word order, plurals, "a/the", "best/top") but the underlying intent must be identical.
2. Do NOT be afraid of single-page groups. If a page has unique intent, it MUST be its own group. Creating many small groups is CORRECT behavior.
3. When in doubt, SEPARATE into different groups. Never combine pages with even slightly different intent.

INTENT DIFFERENTIATION — these are ALWAYS separate groups:
- Informational (what is, how does, meaning, explained) vs Transactional (get, buy, apply, find)
- Tool-based (calculator, checker, estimator) vs General inquiry
- Comparison (vs, compare, difference) vs Direct search
- Review/opinion (reviews, pros and cons, worth it) vs Direct search
- Legal/regulatory (laws, requirements, regulations, rules) vs General inquiry
- Cost/pricing (cost, rates, fees, how much) vs General search for the product/service

LOCATION RULES — CRITICAL (NEVER VIOLATE):
- Any page containing a city name (e.g., "Houston", "Miami", "Los Angeles") MUST be in its own location-specific group
- Pages with the SAME city go together: "payday loans Houston" + "Houston payday loans" = same group
- Pages with the SAME state go together: "payday loans Texas" + "Texas payday loans" = same group
- NEVER mix different cities in the same group — "payday loans Houston" and "payday loans Dallas" are ALWAYS separate groups
- NEVER mix different states in the same group — "payday loans Texas" and "payday loans California" are ALWAYS separate groups
- NEVER mix location pages with non-location pages — "payday loans Houston" and "payday loans" are ALWAYS separate groups
- Each unique city = its own group. Each unique state = its own group. No exceptions.
- A page with "near me" or "nearby" is NOT a location page — it's a general local-intent page and can group with other "near me" variants

EXAMPLES:
- "payday loans online" + "payday loans" + "online payday loans" → SAME group (identical intent: finding payday loans)
- "payday loan calculator" → SEPARATE group (tool intent)
- "payday loans Houston" + "Houston payday loans" → SAME group (same city)
- "payday loans Houston" + "payday loans Dallas" → SEPARATE groups (different cities)
- "payday loans Texas" + "payday loans in Texas" → SAME group (same state)
- "what is a payday loan" + "payday loan meaning" → SAME group (informational, same question)
- "payday loan requirements" + "payday loan application" → could be SAME group (both about getting one) OR SEPARATE (requirements = info, application = action) — when in doubt, SEPARATE

Respond with valid JSON only. No explanation outside the JSON:
{
  "groups": [
    { "pages": ["page name 1", "page name 2"], "theme": "brief description of shared intent" }
  ]
}`;

const DEFAULT_TWO_TOKEN_GROUP_PROMPT = `You are a strict SEO grouping expert. You will receive a batch of SHORT page names where each page has exactly 2 tokens.

Your job is to group ONLY exact semantic matches. The goal is precision, not recall.

STRICT RULES:
1. Only group pages if they represent the SAME exact search intent.
2. Single-page groups are expected and correct.
3. If there is any ambiguity, keep pages separate.
4. Different locations are never a match.
5. Generic vs specific pages are never a match.
6. Tool, comparison, review, informational, pricing, legal, and transactional intents must stay separate.
7. Wording changes can still be the same intent if the semantic meaning is exact.

Examples:
- "car loan" + "auto loan" = same group
- "cash advance" + "payday loans" = same group only if they clearly mean the same product/service
- "mortgage rates" + "mortgage calculator" = separate
- "payday loans houston" + "payday loans dallas" = separate
- "loans" + "payday loans" = separate

Respond with valid JSON only:
{
  "groups": [
    { "pages": ["page 1", "page 2"], "theme": "brief shared intent" }
  ]
}`;

const DEFAULT_SHORT_ASSIGNMENT_PROMPT = `You are deciding whether a short SEO group should merge into one existing long-form SEO group.

You will receive:
- ONE short group (usually 2-token pages)
- A numbered shortlist of candidate existing groups

Merge ONLY if one candidate has the SAME exact search intent.

STRICT RULES:
1. Exact semantic match only.
2. If uncertain, return no match.
3. Different locations are never a match.
4. Generic vs specific pages are never a match.
5. Tool, comparison, review, pricing, legal, informational, and transactional intent differences mean no match.

Return JSON only:
{
  "matchIdx": 3,
  "confidence": 91,
  "reason": "brief explanation"
}

If none should match:
{
  "matchIdx": null,
  "confidence": 0,
  "reason": "no exact semantic match"
}`;

// Allow custom prompt override
let customAutoGroupPrompt: string | null = null;

export function setAutoGroupPrompt(prompt: string | null): void {
  customAutoGroupPrompt = prompt;
}

export function getAutoGroupPrompt(): string {
  return customAutoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT;
}

export { DEFAULT_AUTO_GROUP_PROMPT };

export const DEFAULT_AUTO_GROUP_ASSIGNMENT_PROMPT = `You are a strict SEO grouping engine.

Assign each page to exactly one target group name.

A single request may list up to ${AUTO_GROUP_MAX_BATCH_PAGES} batch pages (ids P1, P2, … P${AUTO_GROUP_MAX_BATCH_PAGES}). You must return one assignment object per batch page — every pageId from P1 through the highest id in the batch exactly once. Do not omit, merge, or duplicate rows.

STRICT RULES:
1. A page may join an existing group only if the page and group name represent the same exact search intent.
2. Minor lexical variation is allowed only when it does not change meaning in any way.
3. If intent, specificity, purpose, modifier, location, or user need changes, do not join it.
4. When in doubt, keep the page separate by assigning it to itself.
5. Single-page groups are correct when no exact match exists.
6. Do not merge broad vs specific, informational vs transactional, comparison, tool, review, pricing, legal, or location-specific intents unless they are truly the same exact intent.
7. targetGroupName must be either an existing group name or one of the current batch page names.
8. Never invent a new name.

Return JSON only (structure scales to the batch size):
{"assignments":[{"pageId":"P1","page":"page name","targetGroupName":"existing group or batch page"},{"pageId":"P2","page":"…","targetGroupName":"…"}]}`;

export const DEFAULT_AUTO_GROUP_QA_PROMPT = `You are a strict SEO QA reviewer.

You will receive:
1. A group name
2. The pages currently assigned to that group

Your job is to decide whether every page is a strict exact semantic match for the group name.

STRICT RULES:
1. Use strict matching.
2. A page belongs only if it represents the same exact search intent as the group name.
3. Minor lexical variation is allowed only when it does not change semantic meaning in any way.
4. If a page is broader, narrower, different in intent, tool-related, comparison-based, informational vs transactional, review-based, pricing-based, legal, or location-specific in a way that changes meaning, it is a mismatch.
5. When in doubt, mark the page as a mismatch.

Return valid JSON only:
{ "status": "approve" | "mismatch", "mismatched_pages": [], "reason": "brief explanation" }`;

export const DEFAULT_COSINE_SUMMARY_PROMPT = `You write strict semantic intent summaries for SEO page names.

You will receive a batch of page ids and page names (up to ${AUTO_GROUP_MAX_BATCH_PAGES} pages per batch: P1 … P${AUTO_GROUP_MAX_BATCH_PAGES}).

Write exactly one sentence per page that describes the exact complete semantic core intent of that page.

STRICT RULES:
1. Be strict and literal.
2. Do not broaden the meaning.
3. Do not add assumptions not clearly supported by the page name.
4. Do not merge nearby intents into one description.
5. Keep each summary concise and factual.
6. Preserve important modifiers like location, intent, audience, comparison, pricing, reviews, tools, requirements, and timing if they are present.
7. Include every pageId from the user message exactly once in "summaries".

Return JSON only:
{"summaries":[{"pageId":"P1","summary":"one sentence"},{"pageId":"P2","summary":"…"}]}`;

export function buildAutoGroupBatchPrompt(input: AutoGroupBatchPromptInput): { system: string; user: string } {
  const batchPages = input.batch
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .map((page, idx) => `P${idx + 1} | ${page.pageName} | vol: ${page.totalVolume}`)
    .join('\n');

  const existingGroups = input.existingGroupNames.length > 0
    ? input.existingGroupNames.join('\n')
    : 'None';

  return {
    system: DEFAULT_AUTO_GROUP_ASSIGNMENT_PROMPT,
    user:
      `Batch pages (${input.batch.length}):\n${batchPages}\n\n` +
      `Existing group names:\n${existingGroups}\n\n` +
      `Page ids are P1 through P${input.batch.length}. Every batch page must appear exactly once in assignments.\n` +
      `Return the pageId for each assignment. targetGroupName must be an existing group name or the exact page name of the batch anchor page.`,
  };
}

export function buildCosineSummaryPrompt(batch: ClusterSummary[]): { system: string; user: string } {
  const pageLines = batch
    .map((page, idx) => `P${idx + 1} | ${page.pageName}`)
    .join('\n');

  return {
    system: DEFAULT_COSINE_SUMMARY_PROMPT,
    user:
      `Write one strict semantic intent sentence for each page.\n\n` +
      `Pages (${batch.length}):\n${pageLines}\n\n` +
      `Every pageId must appear exactly once in the JSON response.`,
  };
}

export function parseAutoGroupBatchResponse(
  content: string,
  batch: ClusterSummary[],
  existingGroupNames: string[]
): AutoGroupBatchAssignment[] {
  let jsonStr = content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed: { assignments?: Array<{ pageId?: string; page?: string; targetGroupName?: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  }

  const pageIds = batch.map((page, idx) => ({ id: `P${idx + 1}`, page }));
  const validPageIds = new Map(pageIds.map(({ id, page }) => [id.toLowerCase(), page]));
  const validPageNames = new Map<string, ClusterSummary[]>();
  for (const page of batch) {
    const normalized = page.pageName.toLowerCase().trim();
    validPageNames.set(normalized, [...(validPageNames.get(normalized) || []), page]);
  }
  const existingLookup = new Map(existingGroupNames.map(name => [name.toLowerCase().trim(), name]));
  const assignments = new Map<string, AutoGroupBatchAssignment>();

  for (const entry of parsed.assignments || []) {
    const normalizedPageId = String(entry.pageId || '').toLowerCase().trim();
    const normalizedPage = String(entry.page || '').toLowerCase().trim();
    const normalizedTarget = String(entry.targetGroupName || '').toLowerCase().trim();
    const page =
      validPageIds.get(normalizedPageId)
      || (validPageNames.get(normalizedPage)?.length === 1 ? validPageNames.get(normalizedPage)?.[0] : undefined);
    if (!page) continue;
    const canonicalPageId = pageIds.find(item => item.page.tokens === page.tokens)?.id || '';

    const batchTargetById = validPageIds.get(normalizedTarget);
    const batchTargetByName = validPageNames.get(normalizedTarget)?.[0];
    const existingTarget = existingLookup.get(normalizedTarget);
    const targetGroupName = existingTarget || batchTargetById?.pageName || batchTargetByName?.pageName || page.pageName;

    assignments.set(page.tokens, { pageId: canonicalPageId, page: page.pageName, targetGroupName });
  }

  for (const { id, page } of pageIds) {
    if (!assignments.has(page.tokens)) {
      assignments.set(page.tokens, { pageId: id, page: page.pageName, targetGroupName: page.pageName });
    }
  }

  return batch.map(page => assignments.get(page.tokens)!);
}

export function parseCosineSummaryResponse(content: string, batch: ClusterSummary[]): string[] {
  let jsonStr = content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed: { summaries?: Array<{ pageId?: string; summary?: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return batch.map(page => page.pageName);
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return batch.map(page => page.pageName);
    }
  }

  const pageIds = batch.map((page, idx) => ({ id: `P${idx + 1}`.toLowerCase(), page }));
  const summaryByToken = new Map<string, string>();

  for (const entry of parsed.summaries || []) {
    const normalizedPageId = String(entry.pageId || '').toLowerCase().trim();
    const matched = pageIds.find(item => item.id === normalizedPageId);
    const summary = String(entry.summary || '').trim();
    if (!matched || !summary) continue;
    summaryByToken.set(matched.page.tokens, summary);
  }

  return batch.map(page => summaryByToken.get(page.tokens) || page.pageName);
}

export function buildAutoGroupPrompt(cluster: AutoGroupCluster): { system: string; user: string } {
  const pageList = cluster.pages
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .map(p => `- "${p.pageName}" (tokens: ${p.tokenArr.join(', ')}, vol: ${p.totalVolume.toLocaleString()})`)
    .join('\n');

  const user = `These ${cluster.pageCount} pages share tokens [${cluster.sharedTokens.join(', ')}]:\n\n${pageList}\n\nGroup them by semantic similarity. Return JSON.`;

  return { system: getAutoGroupPrompt(), user };
}

// ─── Response Parsing ───

export function parseAutoGroupResponse(
  content: string,
  cluster: AutoGroupCluster
): AutoGroupSuggestion[] {
  // Extract JSON from response (may be wrapped in code blocks)
  let jsonStr = content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed: { groups: Array<{ pages: string[]; theme?: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to extract JSON object from the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { return []; }
    } else {
      return [];
    }
  }

  if (!parsed?.groups || !Array.isArray(parsed.groups)) return [];

  // Build page lookup (case-insensitive, trimmed)
  const pageLookup = new Map<string, ClusterSummary>();
  for (const p of cluster.pages) {
    pageLookup.set(p.pageName.toLowerCase().trim(), p);
  }

  const suggestions: AutoGroupSuggestion[] = [];

  for (const group of parsed.groups) {
    if (!group.pages || !Array.isArray(group.pages) || group.pages.length === 0) continue;

    // Fuzzy-match page names from the LLM response to actual pages
    const matchedPages: ClusterSummary[] = [];
    for (const name of group.pages) {
      const normalized = String(name).toLowerCase().trim();
      const match = pageLookup.get(normalized);
      if (match) matchedPages.push(match);
    }

    if (matchedPages.length === 0) continue;

    // Auto-name: highest volume page
    const sorted = [...matchedPages].sort((a, b) => b.totalVolume - a.totalVolume);
    const groupName = sorted[0].pageName;
    const totalVolume = matchedPages.reduce((s, p) => s + p.totalVolume, 0);
    const keywordCount = matchedPages.reduce((s, p) => s + p.keywordCount, 0);

    let totalKd = 0, kdCount = 0;
    matchedPages.forEach(p => {
      if (p.avgKd !== null) { totalKd += p.avgKd * p.keywordCount; kdCount += p.keywordCount; }
    });

    suggestions.push({
      id: `suggest_${cluster.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sourceClusterId: cluster.id,
      groupName,
      pages: matchedPages,
      totalVolume,
      keywordCount,
      avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
      status: 'pending',
      retryCount: 0,
    });
  }

  return suggestions;
}

export function buildTwoTokenPrompt(cluster: AutoGroupCluster): { system: string; user: string } {
  const pageList = cluster.pages
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .map(p => `- "${p.pageName}" (vol: ${p.totalVolume.toLocaleString()}, kws: ${p.keywordCount.toLocaleString()})`)
    .join('\n');

  return {
    system: DEFAULT_TWO_TOKEN_GROUP_PROMPT,
    user: `These are short pages with exactly 2 tokens each.\n\n${pageList}\n\nGroup only exact semantic matches. Many pages should remain single-page groups. Return JSON.`,
  };
}

export function buildSuggestionsFromCosineClusters(
  pages: ClusterSummary[],
  cosineClusters: Array<{ id: string; pages: ClusterSummary[] }>
): { suggestions: AutoGroupSuggestion[]; unmatchedPages: ClusterSummary[] } {
  const matched = new Set<string>();
  const suggestions = cosineClusters.map(cluster => {
    cluster.pages.forEach(page => matched.add(page.tokens));
    const stage = Math.max(...cluster.pages.map(page => page.tokenArr.length), 3);
    return buildSuggestionFromPages(
      `cosine_group_${cluster.id}`,
      `cosine_group_${cluster.id}`,
      cluster.pages,
      'cosine',
      stage
    );
  });

  const unmatchedPages = pages.filter(page => !matched.has(page.tokens));
  return { suggestions, unmatchedPages };
}

export function buildSingletonSuggestions(
  pages: ClusterSummary[],
  source: AutoGroupSuggestion['source']
): AutoGroupSuggestion[] {
  return pages.map(page =>
    buildSuggestionFromPages(
      `${source}_${page.tokens}`,
      `${source}_${page.tokens}`,
      [page],
      source,
      page.tokenArr.length
    )
  );
}

function getSuggestionTokenSet(suggestion: AutoGroupSuggestion): Set<string> {
  const tokens = new Set<string>();
  for (const page of suggestion.pages) {
    for (const token of page.tokenArr) tokens.add(token);
  }
  for (const word of normalizeWords(suggestion.groupName)) tokens.add(word);
  return tokens;
}

export function buildAssignmentCandidates(
  shortGroup: AutoGroupSuggestion,
  targetGroups: AutoGroupSuggestion[],
  limit = 20
): AutoGroupSuggestion[] {
  if (targetGroups.length <= limit) return targetGroups;

  const shortTokens = getSuggestionTokenSet(shortGroup);
  const scored = targetGroups.map(group => {
    const targetTokens = getSuggestionTokenSet(group);
    let shared = 0;
    shortTokens.forEach(token => { if (targetTokens.has(token)) shared++; });

    const sameLocation =
      shortGroup.pages.some(page => page.locationCity || page.locationState)
        ? group.pages.some(page =>
            page.locationCity === shortGroup.pages[0]?.locationCity &&
            page.locationState === shortGroup.pages[0]?.locationState
          )
        : !group.pages.some(page => page.locationCity || page.locationState);

    const broadnessPenalty = group.pages[0]?.tokenArr.length === 1 ? 10 : 0;
    const score = (shared * 100) + (sameLocation ? 25 : -50) + Math.log10(Math.max(group.totalVolume, 1)) - broadnessPenalty;
    return { group, score };
  });

  const shortlist = scored
    .sort((a, b) => b.score - a.score || b.group.totalVolume - a.group.totalVolume)
    .slice(0, Math.max(5, limit - 5))
    .map(item => item.group);

  const extraTopVolume = [...targetGroups]
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .filter(group => !shortlist.some(existing => existing.id === group.id))
    .slice(0, 5);

  return [...shortlist, ...extraTopVolume].slice(0, limit);
}

// ─── Queue Processing (concurrent API calls) ───

export interface AutoGroupCallbacks {
  onProcessing: (clusterId: string) => void;
  onCompleted: (clusterId: string) => void;
  onSuggestions: (clusterId: string, suggestions: AutoGroupSuggestion[]) => void;
  onError: (clusterId: string, error: string) => void;
  onCost?: (promptTokens: number, completionTokens: number, cost: number) => void;
  onComplete?: (totalProcessed: number, totalSuggestions: number) => void;
}

export interface AutoGroupQueueOptions {
  promptBuilder?: (cluster: AutoGroupCluster) => { system: string; user: string };
}

export async function processAutoGroupQueue(
  clusters: AutoGroupCluster[],
  config: ReviewEngineConfig,
  callbacks: AutoGroupCallbacks,
  signal: AbortSignal,
  options: AutoGroupQueueOptions = {}
): Promise<void> {
  // Sort clusters by page count desc (largest first — highest impact)
  const queue = [...clusters].sort((a, b) => b.pageCount - a.pageCount);
  let queueIdx = 0;
  let totalProcessed = 0;
  let totalSuggestionsCount = 0;

  const processNext = async (): Promise<void> => {
    while (queueIdx < queue.length && !signal.aborted) {
      const cluster = queue[queueIdx++];
      callbacks.onProcessing(cluster.id);

      try {
        const { system, user } = (options.promptBuilder || buildAutoGroupPrompt)(cluster);
        const maxRateLimitRetries = 5;

        let result: string | null = null;
        let responseData: any = null;
        for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
          if (signal.aborted) return;

          const body: any = {
            model: config.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: config.temperature,
            response_format: { type: 'json_object' },
          };
          if (config.maxTokens > 0) body.max_tokens = config.maxTokens;
          if (config.reasoningEffort && config.reasoningEffort !== 'none') {
            body.reasoning = { effort: config.reasoningEffort };
          }

          const timedResponse = await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
              },
              body: JSON.stringify(body),
              signal: requestSignal,
            }),
          });
          const res = timedResponse.result;

          if (res.status === 429) {
            if (attempt < maxRateLimitRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
            callbacks.onError(cluster.id, 'Rate limited — max retries exhausted');
            totalProcessed++;
            callbacks.onCompleted(cluster.id);
            result = null;
            break;
          }

          if (!res.ok) {
            const errText = (await runWithOpenRouterTimeout({
              signal,
              timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
              run: async () => res.text().catch(() => ''),
            }).catch(() => ({ result: '' }))).result;
            callbacks.onError(cluster.id, `API ${res.status}: ${errText.slice(0, 200)}`);
            totalProcessed++;
            callbacks.onCompleted(cluster.id);
            result = null;
            break;
          }

          responseData = (await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async () => res.json(),
          })).result;
          result = responseData.choices?.[0]?.message?.content || '';
          break;
        }

        // Track cost from API response
        if (responseData && callbacks.onCost) {
          const promptTokens = responseData.usage?.prompt_tokens || 0;
          const completionTokens = responseData.usage?.completion_tokens || 0;
          const promptPrice = parseFloat(config.modelPricing?.prompt || '0');
          const completionPrice = parseFloat(config.modelPricing?.completion || '0');
          const cost = (promptTokens * promptPrice) + (completionTokens * completionPrice);
          callbacks.onCost(promptTokens, completionTokens, cost);
        }

        // Only count + report completion if not already handled by error path
        if (result !== null) {
          totalProcessed++;
          callbacks.onCompleted(cluster.id);

          if (result) {
            const suggestions = parseAutoGroupResponse(result, cluster);
            if (suggestions.length > 0) {
              totalSuggestionsCount += suggestions.length;
              callbacks.onSuggestions(cluster.id, suggestions);
            } else {
              callbacks.onError(cluster.id, 'LLM returned no valid groups');
            }
          } else {
            callbacks.onError(cluster.id, 'Empty response from API');
          }
        }
      } catch (e: any) {
        if (e.name === 'AbortError' && signal.aborted) return;
        callbacks.onError(cluster.id, e.message || 'Unknown error');
        totalProcessed++;
        callbacks.onCompleted(cluster.id);
      }
    }
  };

  const workerCount = Math.min(config.concurrency || 5, queue.length);
  const workers = Array.from({ length: workerCount }, () => processNext());
  await Promise.all(workers);

  // Signal completion
  if (callbacks.onComplete) {
    callbacks.onComplete(totalProcessed, totalSuggestionsCount);
  }
}

// ─── Reconciliation Engine (Step 2: Compare groups against each other) ───

const DEFAULT_RECONCILIATION_PROMPT = `You are comparing SEO keyword page groups to find semantic duplicates.

You will receive 3 group names to CHECK, and a numbered list of ALL existing groups.

RULES:
- Flag groups ONLY if they have IDENTICAL core semantic intent (just different wording)
- Synonyms with same intent = DUPLICATE (e.g., "cash advance" ↔ "payday loans", "auto loan" ↔ "car loan")
- Different sub-intents = NOT duplicates (e.g., "payday loan calculator" ↔ "payday loans")
- Different locations = NEVER duplicates (e.g., "loans Houston" ↔ "loans Dallas")
- Generic/broad pages should NOT be merged into specific groups (e.g., "loans" should NOT merge into "payday loans")
- When in doubt, do NOT flag as duplicate

Return JSON only:
{
  "duplicates": [
    { "checkIdx": 1, "matchIdx": 47, "confidence": 92, "reason": "brief explanation" }
  ]
}
If no duplicates found: { "duplicates": [] }`;

let customReconciliationPrompt: string | null = null;

export function setReconciliationPrompt(prompt: string | null): void {
  customReconciliationPrompt = prompt;
}

export function getReconciliationPrompt(): string {
  return customReconciliationPrompt || DEFAULT_RECONCILIATION_PROMPT;
}

export { DEFAULT_RECONCILIATION_PROMPT };

export interface ReconciliationCallbacks {
  onBatchProcessed: (batchIdx: number, candidates: ReconciliationCandidate[]) => void;
  onError: (batchIdx: number, error: string) => void;
  onCost: (promptTokens: number, completionTokens: number, cost: number) => void;
  onComplete: (totalBatches: number, totalCandidates: number) => void;
}

export async function processReconciliation(
  groups: AutoGroupSuggestion[],
  config: ReviewEngineConfig,
  callbacks: ReconciliationCallbacks,
  signal: AbortSignal
): Promise<ReconciliationCandidate[]> {
  if (groups.length < 2) {
    callbacks.onComplete(0, 0);
    return [];
  }

  // Build numbered group list
  const groupNames = groups.map(g => g.groupName);
  const numberedList = groupNames.map((name, idx) => `${idx + 1}. ${name}`).join('\n');

  // Batch 3 at a time
  const BATCH_SIZE = 3;
  const batches: number[][] = [];
  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    batches.push(Array.from({ length: Math.min(BATCH_SIZE, groups.length - i) }, (_, j) => i + j));
  }

  const allCandidates: ReconciliationCandidate[] = [];
  let queueIdx = 0;
  let totalProcessed = 0;

  const processNext = async (): Promise<void> => {
    while (queueIdx < batches.length && !signal.aborted) {
      const batchIdx = queueIdx++;
      const batch = batches[batchIdx];

      const checkList = batch.map(idx => `${idx + 1}. ${groupNames[idx]}`).join('\n');

      const userPrompt = `CHECK THESE ${batch.length} GROUPS for duplicates:\n${checkList}\n\nFULL LIST OF ALL ${groupNames.length} GROUPS:\n${numberedList}\n\nFind any semantic duplicates. Return JSON.`;

      try {
        const body: any = {
          model: config.model,
          messages: [
            { role: 'system', content: getReconciliationPrompt() },
            { role: 'user', content: userPrompt },
          ],
          temperature: config.temperature,
          response_format: { type: 'json_object' },
        };
        if (config.maxTokens > 0) body.max_tokens = config.maxTokens;
        if (config.reasoningEffort && config.reasoningEffort !== 'none') {
          body.reasoning = { effort: config.reasoningEffort };
        }

        const maxRetries = 5;
        let responseData: any = null;
        let result: string | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal.aborted) return;

          const timedResponse = await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
              },
              body: JSON.stringify(body),
              signal: requestSignal,
            }),
          });
          const res = timedResponse.result;

          if (res.status === 429) {
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 30000)));
              continue;
            }
            callbacks.onError(batchIdx, 'Rate limited');
            result = null;
            break;
          }

          if (!res.ok) {
            const errText = (await runWithOpenRouterTimeout({
              signal,
              timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
              run: async () => res.text().catch(() => ''),
            }).catch(() => ({ result: '' }))).result;
            callbacks.onError(batchIdx, `API ${res.status}: ${errText.slice(0, 200)}`);
            result = null;
            break;
          }

          responseData = (await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async () => res.json(),
          })).result;
          result = responseData.choices?.[0]?.message?.content || '';
          break;
        }

        // Track cost
        if (responseData && callbacks.onCost) {
          const promptTokens = responseData.usage?.prompt_tokens || 0;
          const completionTokens = responseData.usage?.completion_tokens || 0;
          const promptPrice = parseFloat(config.modelPricing?.prompt || '0');
          const completionPrice = parseFloat(config.modelPricing?.completion || '0');
          callbacks.onCost(promptTokens, completionTokens, (promptTokens * promptPrice) + (completionTokens * completionPrice));
        }

        // Parse response
        if (result) {
          const candidates = parseReconciliationResponse(result, groups, batchIdx);
          if (candidates.length > 0) {
            allCandidates.push(...candidates);
            callbacks.onBatchProcessed(batchIdx, candidates);
          }
        }

        totalProcessed++;
      } catch (e: any) {
        if (e.name === 'AbortError' && signal.aborted) return;
        callbacks.onError(batchIdx, e.message || 'Unknown error');
        totalProcessed++;
      }
    }
  };

  const workerCount = Math.min(config.concurrency || 5, batches.length);
  const workers = Array.from({ length: workerCount }, () => processNext());
  await Promise.all(workers);

  callbacks.onComplete(totalProcessed, allCandidates.length);
  return allCandidates;
}

function parseReconciliationResponse(content: string, groups: AutoGroupSuggestion[], _batchIdx: number): ReconciliationCandidate[] {
  let jsonStr = content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed: { duplicates: Array<{ checkIdx: number; matchIdx: number; confidence: number; reason: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { return []; }
    } else {
      return [];
    }
  }

  if (!parsed?.duplicates || !Array.isArray(parsed.duplicates)) return [];

  const candidates: ReconciliationCandidate[] = [];
  for (const dup of parsed.duplicates) {
    const checkIdx = (dup.checkIdx || 0) - 1; // Convert from 1-indexed
    const matchIdx = (dup.matchIdx || 0) - 1;

    // Validate indices
    if (checkIdx < 0 || checkIdx >= groups.length || matchIdx < 0 || matchIdx >= groups.length) continue;
    if (checkIdx === matchIdx) continue; // Can't match self

    // Deduplicate: ensure we don't already have this pair (A↔B = B↔A)
    const pairKey = [Math.min(checkIdx, matchIdx), Math.max(checkIdx, matchIdx)].join(':');
    const groupA = groups[checkIdx];
    const groupB = groups[matchIdx];

    candidates.push({
      id: `recon_${pairKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      groupA: { name: groupA.groupName, idx: checkIdx, volume: groupA.totalVolume, pages: groupA.pages.length },
      groupB: { name: groupB.groupName, idx: matchIdx, volume: groupB.totalVolume, pages: groupB.pages.length },
      confidence: dup.confidence || 0,
      reason: dup.reason || '',
    });
  }

  return candidates;
}

export interface ShortGroupAssignment {
  shortGroupId: string;
  targetGroupId: string | null;
  confidence: number;
  reason: string;
}

export interface ShortGroupAssignmentCallbacks {
  onProcessed: (processed: number, total: number, assignment: ShortGroupAssignment | null) => void;
  onError: (shortGroupId: string, error: string) => void;
  onCost: (promptTokens: number, completionTokens: number, cost: number) => void;
  onComplete: (processed: number, merged: number) => void;
}

function buildShortAssignmentPrompt(
  shortGroup: AutoGroupSuggestion,
  candidates: AutoGroupSuggestion[]
): { system: string; user: string } {
  const shortPages = shortGroup.pages.map(page => `- "${page.pageName}"`).join('\n');
  const candidateList = candidates.map((group, idx) => {
    const samplePages = group.pages.slice(0, 3).map(page => page.pageName).join(' | ');
    return `${idx + 1}. ${group.groupName} (pages: ${group.pages.length}, sample: ${samplePages})`;
  }).join('\n');

  return {
    system: DEFAULT_SHORT_ASSIGNMENT_PROMPT,
    user: `SHORT GROUP:\nName: ${shortGroup.groupName}\nPages:\n${shortPages}\n\nCANDIDATE EXISTING GROUPS:\n${candidateList}\n\nReturn the numbered exact semantic match, or null if none match exactly.`,
  };
}

function parseShortAssignmentResponse(
  content: string,
  shortGroup: AutoGroupSuggestion,
  candidates: AutoGroupSuggestion[]
): ShortGroupAssignment | null {
  let jsonStr = content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  let parsed: { matchIdx: number | null; confidence?: number; reason?: string };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
    } else {
      return null;
    }
  }

  if (parsed.matchIdx === null || parsed.matchIdx === undefined) {
    return {
      shortGroupId: shortGroup.id,
      targetGroupId: null,
      confidence: 0,
      reason: parsed.reason || 'No exact semantic match',
    };
  }

  const candidate = candidates[(parsed.matchIdx || 0) - 1];
  if (!candidate) return null;

  return {
    shortGroupId: shortGroup.id,
    targetGroupId: candidate.id,
    confidence: parsed.confidence || 0,
    reason: parsed.reason || '',
  };
}

export async function processShortGroupAssignments(
  shortGroups: AutoGroupSuggestion[],
  targetGroups: AutoGroupSuggestion[],
  config: ReviewEngineConfig,
  callbacks: ShortGroupAssignmentCallbacks,
  signal: AbortSignal
): Promise<ShortGroupAssignment[]> {
  if (shortGroups.length === 0 || targetGroups.length === 0) {
    callbacks.onComplete(0, 0);
    return [];
  }

  const assignments: ShortGroupAssignment[] = [];
  let queueIdx = 0;
  let processed = 0;

  const processNext = async (): Promise<void> => {
    while (queueIdx < shortGroups.length && !signal.aborted) {
      const shortGroup = shortGroups[queueIdx++];
      const candidates = buildAssignmentCandidates(shortGroup, targetGroups);

      try {
        const { system, user } = buildShortAssignmentPrompt(shortGroup, candidates);
        const body: any = {
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: config.temperature,
          response_format: { type: 'json_object' },
        };
        if (config.maxTokens > 0) body.max_tokens = config.maxTokens;
        if (config.reasoningEffort && config.reasoningEffort !== 'none') {
          body.reasoning = { effort: config.reasoningEffort };
        }

        const timedResponse = await runWithOpenRouterTimeout({
          signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': window.location.origin,
            },
            body: JSON.stringify(body),
            signal: requestSignal,
          }),
        });
        const res = timedResponse.result;

        if (!res.ok) {
          callbacks.onError(shortGroup.id, `API ${res.status}`);
          processed++;
          callbacks.onProcessed(processed, shortGroups.length, null);
          continue;
        }

        const responseData = (await runWithOpenRouterTimeout({
          signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async () => res.json(),
        })).result;
        if (callbacks.onCost) {
          const promptTokens = responseData.usage?.prompt_tokens || 0;
          const completionTokens = responseData.usage?.completion_tokens || 0;
          const promptPrice = parseFloat(config.modelPricing?.prompt || '0');
          const completionPrice = parseFloat(config.modelPricing?.completion || '0');
          callbacks.onCost(promptTokens, completionTokens, (promptTokens * promptPrice) + (completionTokens * completionPrice));
        }

        const result = responseData.choices?.[0]?.message?.content || '';
        const assignment = parseShortAssignmentResponse(result, shortGroup, candidates);
        if (assignment) assignments.push(assignment);
        processed++;
        callbacks.onProcessed(processed, shortGroups.length, assignment);
      } catch (e: any) {
        if (e.name === 'AbortError' && signal.aborted) return;
        callbacks.onError(shortGroup.id, e.message || 'Unknown error');
        processed++;
        callbacks.onProcessed(processed, shortGroups.length, null);
      }
    }
  };

  const workerCount = Math.min(config.concurrency || 5, shortGroups.length);
  await Promise.all(Array.from({ length: workerCount }, () => processNext()));
  callbacks.onComplete(processed, assignments.filter(item => item.targetGroupId).length);
  return assignments;
}

export function applyShortGroupAssignments(
  longGroups: AutoGroupSuggestion[],
  shortGroups: AutoGroupSuggestion[],
  assignments: ShortGroupAssignment[]
): AutoGroupSuggestion[] {
  const assignedByShortId = new Map(assignments.map(item => [item.shortGroupId, item]));
  const mergedLongGroups = longGroups.map(group => ({ ...group, pages: [...group.pages] }));
  const longGroupById = new Map(mergedLongGroups.map(group => [group.id, group]));
  const remainingShortGroups: AutoGroupSuggestion[] = [];

  for (const shortGroup of shortGroups) {
    const assignment = assignedByShortId.get(shortGroup.id);
    if (assignment?.targetGroupId) {
      const target = longGroupById.get(assignment.targetGroupId);
      if (target) {
        const mergedPages = [...target.pages, ...shortGroup.pages];
        const stats = buildClusterStats(mergedPages);
        target.pages = mergedPages;
        target.keywordCount = stats.keywordCount;
        target.totalVolume = stats.totalVolume;
        target.avgKd = stats.avgKd;
        target.assignmentConfidence = assignment.confidence;
        target.assignmentReason = assignment.reason;
      } else {
        remainingShortGroups.push(shortGroup);
      }
    } else {
      remainingShortGroups.push({
        ...shortGroup,
        source: shortGroup.source || 'two-token-standalone',
        assignmentConfidence: assignment?.confidence,
        assignmentReason: assignment?.reason,
      });
    }
  }

  return [...mergedLongGroups, ...remainingShortGroups]
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

/** Merge reconciliation candidates into suggestions — higher volume group absorbs lower */
export function applyReconciliationMerges(
  suggestions: AutoGroupSuggestion[],
  candidates: ReconciliationCandidate[]
): AutoGroupSuggestion[] {
  // Build union-find for chain merges (A↔B + B↔C = all merge into highest vol)
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    if (!parent.has(x)) return x;
    const p = find(parent.get(x)!);
    parent.set(x, p);
    return p;
  };
  const union = (a: number, b: number): void => {
    const pa = find(a), pb = find(b);
    if (pa === pb) return;
    // Higher volume becomes parent
    if (suggestions[pa].totalVolume >= suggestions[pb].totalVolume) {
      parent.set(pb, pa);
    } else {
      parent.set(pa, pb);
    }
  };

  // Only merge non-dismissed candidates
  for (const c of candidates) {
    if (c.dismissed) continue;
    union(c.groupA.idx, c.groupB.idx);
  }

  // Group all suggestions by their root parent
  const mergeGroups = new Map<number, number[]>();
  for (let i = 0; i < suggestions.length; i++) {
    const root = find(i);
    const existing = mergeGroups.get(root);
    if (existing) existing.push(i);
    else mergeGroups.set(root, [i]);
  }

  // Build merged suggestions
  const merged: AutoGroupSuggestion[] = [];
  for (const [rootIdx, memberIndices] of mergeGroups) {
    if (memberIndices.length === 1) {
      merged.push(suggestions[memberIndices[0]]);
      continue;
    }

    // Merge all members into the root (highest volume)
    const root = suggestions[rootIdx];
    const allPages: ClusterSummary[] = [...root.pages];
    for (const idx of memberIndices) {
      if (idx === rootIdx) continue;
      allPages.push(...suggestions[idx].pages);
    }

    const stats = buildClusterStats(allPages);
    merged.push({
      ...root,
      pages: allPages,
      ...stats,
    });
  }

  return merged;
}
