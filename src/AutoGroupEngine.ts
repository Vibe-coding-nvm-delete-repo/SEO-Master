// AutoGroupEngine.ts — Pure logic for auto-grouping ungrouped pages by token overlap + LLM semantic grouping
// No React dependencies. Handles clustering, cost estimation, prompt building, response parsing, queue processing.

import type { ClusterSummary, AutoGroupCluster, AutoGroupSuggestion } from './types';
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
const MIN_SHARED_TOKENS = 4;

/**
 * Build token clusters from ungrouped pages.
 * Finds groups of pages sharing 4+ identical tokens via combination hashing.
 * Also identifies pages with 100% identical token signatures.
 */
export function buildTokenClusters(pages: ClusterSummary[]): AutoGroupCluster[] {
  if (!pages || pages.length < 2) return [];

  // Phase 1: Find 100% identical signature groups
  const signatureMap = new Map<string, ClusterSummary[]>();
  for (const page of pages) {
    const sig = page.tokens;
    const existing = signatureMap.get(sig);
    if (existing) existing.push(page);
    else signatureMap.set(sig, [page]);
  }

  const identicalClusters: AutoGroupCluster[] = [];
  const assignedPages = new Set<string>(); // Track by tokens (unique per page)

  for (const [sig, group] of signatureMap) {
    if (group.length >= 2) {
      const totalVolume = group.reduce((s, p) => s + p.totalVolume, 0);
      const keywordCount = group.reduce((s, p) => s + p.keywordCount, 0);
      let totalKd = 0, kdCount = 0;
      group.forEach(p => { if (p.avgKd !== null) { totalKd += p.avgKd * p.keywordCount; kdCount += p.keywordCount; } });
      identicalClusters.push({
        id: `identical_${sig}`,
        sharedTokens: group[0].tokenArr.slice().sort(),
        pages: group,
        totalVolume,
        keywordCount,
        avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
        pageCount: group.length,
        confidence: 'high',
        isIdentical: true,
      });
      for (const p of group) assignedPages.add(p.tokens);
    }
  }

  // Phase 2: Build inverted index for remaining pages
  const remainingPages = pages.filter(p => !assignedPages.has(p.tokens));
  // Also include identical-cluster pages for 4-token overlap (they might overlap with OTHER pages too)
  const allForOverlap = pages.filter(p => p.tokenArr.length >= MIN_SHARED_TOKENS);

  // Hash: sorted 4-token combo key → Set<page tokens string>
  const comboMap = new Map<string, Set<string>>();

  for (const page of allForOverlap) {
    // Cap tokens for combination generation
    const tokens = page.tokenArr.length > MAX_TOKENS_PER_PAGE
      ? page.tokenArr.slice(0, MAX_TOKENS_PER_PAGE)
      : page.tokenArr;

    const combos = combinations(tokens.slice().sort(), MIN_SHARED_TOKENS);
    for (const combo of combos) {
      const key = combo.join('|');
      const existing = comboMap.get(key);
      if (existing) existing.add(page.tokens);
      else comboMap.set(key, new Set([page.tokens]));
    }
  }

  // Phase 3: Form clusters from combo groups (only groups with 2+ pages)
  const pageIndex = new Map<string, ClusterSummary>();
  for (const p of pages) pageIndex.set(p.tokens, p);

  // Sort combo groups by: shared token count (all 4 here), then page count desc
  const comboClusters: Array<{ sharedTokens: string[]; pageTokens: Set<string> }> = [];
  for (const [key, pageTokensSet] of comboMap) {
    if (pageTokensSet.size >= 2) {
      comboClusters.push({ sharedTokens: key.split('|'), pageTokens: pageTokensSet });
    }
  }

  // Sort by page count desc (larger clusters first → they get priority in assignment)
  comboClusters.sort((a, b) => b.pageTokens.size - a.pageTokens.size);

  // Phase 4: Assign pages to clusters (greedy, largest first)
  // A page can only belong to ONE non-identical cluster
  const assignedToOverlap = new Set<string>();
  const overlapClusters: AutoGroupCluster[] = [];

  for (const { sharedTokens, pageTokens } of comboClusters) {
    // Filter to only unassigned pages (not already in an overlap cluster)
    const unassigned = [...pageTokens].filter(t => !assignedToOverlap.has(t));
    if (unassigned.length < 2) continue;

    const clusterPages = unassigned.map(t => pageIndex.get(t)!).filter(Boolean);
    if (clusterPages.length < 2) continue;

    const totalVolume = clusterPages.reduce((s, p) => s + p.totalVolume, 0);
    const keywordCount = clusterPages.reduce((s, p) => s + p.keywordCount, 0);
    let totalKd = 0, kdCount = 0;
    clusterPages.forEach(p => { if (p.avgKd !== null) { totalKd += p.avgKd * p.keywordCount; kdCount += p.keywordCount; } });
    const avgKd = kdCount > 0 ? Math.round(totalKd / kdCount) : null;

    // Confidence scoring
    let confidence: 'high' | 'medium' | 'review';
    if (clusterPages.length <= 8) confidence = 'high';
    else if (clusterPages.length <= 20) confidence = 'medium';
    else confidence = 'review';

    overlapClusters.push({
      id: `overlap_${sharedTokens.join('_')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sharedTokens,
      pages: clusterPages,
      totalVolume,
      keywordCount,
      avgKd,
      pageCount: clusterPages.length,
      confidence,
      isIdentical: false,
    });

    for (const t of unassigned) assignedToOverlap.add(t);
  }

  // Combine identical + overlap clusters, sort by confidence then volume
  const confidenceOrder = { high: 0, medium: 1, review: 2 };
  const allClusters = [...identicalClusters, ...overlapClusters];
  allClusters.sort((a, b) => {
    const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    return b.totalVolume - a.totalVolume;
  });

  return allClusters;
}

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

// Allow custom prompt override
let customAutoGroupPrompt: string | null = null;

export function setAutoGroupPrompt(prompt: string | null): void {
  customAutoGroupPrompt = prompt;
}

export function getAutoGroupPrompt(): string {
  return customAutoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT;
}

export { DEFAULT_AUTO_GROUP_PROMPT };

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

// ─── Queue Processing (concurrent API calls) ───

export interface AutoGroupCallbacks {
  onProcessing: (clusterId: string) => void;
  onCompleted: (clusterId: string) => void;
  onSuggestions: (clusterId: string, suggestions: AutoGroupSuggestion[]) => void;
  onError: (clusterId: string, error: string) => void;
  onCost?: (promptTokens: number, completionTokens: number, cost: number) => void;
  onComplete?: (totalProcessed: number, totalSuggestions: number) => void;
}

export async function processAutoGroupQueue(
  clusters: AutoGroupCluster[],
  config: ReviewEngineConfig,
  callbacks: AutoGroupCallbacks,
  signal: AbortSignal
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
        const { system, user } = buildAutoGroupPrompt(cluster);
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

          // Per-request timeout (60s) — prevents hanging forever on slow models
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(() => timeoutController.abort(), 60000);
          const combinedSignal = signal.aborted ? signal : timeoutController.signal;
          // Also abort per-request if the global signal fires
          const globalAbortHandler = () => timeoutController.abort();
          signal.addEventListener('abort', globalAbortHandler, { once: true });

          let res: Response;
          try {
            res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
              },
              body: JSON.stringify(body),
              signal: combinedSignal,
            });
          } finally {
            clearTimeout(timeoutId);
            signal.removeEventListener('abort', globalAbortHandler);
          }

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
            const errText = await res.text().catch(() => '');
            callbacks.onError(cluster.id, `API ${res.status}: ${errText.slice(0, 200)}`);
            totalProcessed++;
            callbacks.onCompleted(cluster.id);
            result = null;
            break;
          }

          responseData = await res.json();
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
        if (e.name === 'AbortError') return;
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
