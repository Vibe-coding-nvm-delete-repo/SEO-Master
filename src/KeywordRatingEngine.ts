/**
 * OpenRouter calls for keyword relevance rating (1–3) and core-intent summary.
 * Parsing helpers are pure and unit-tested.
 */

import type { ProcessedRow } from './types';
import {
  OPENROUTER_REQUEST_TIMEOUT_MS,
  runWithOpenRouterTimeout,
} from './openRouterTimeout';

export const DEFAULT_KEYWORD_RATING_PROMPT = `You classify a single search keyword relative to the CORE SEMANTIC INTENT of the full keyword set (provided as context).

Output scale (integer only in JSON):
1 = Clearly relevant to that core intent.
2 = Unclear or partially related; you are not sure.
3 = Not relevant to the core intent in any meaningful way.

Respond with JSON only: {"rating":1} or {"rating":2} or {"rating":3}. No explanation.`;

export const DEFAULT_KEYWORD_SUMMARY_SYSTEM = `You summarize the CORE SEMANTIC INTENT shared by a list of search keywords (main topic, user intent, niche). Be concise (2–6 sentences). Output JSON only: {"summary":"..."}`;

export type KeywordRatingSettingsSlice = {
  apiKey: string;
  /** Model id; if empty, caller should fall back to main selectedModel */
  keywordRatingModel: string;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  ratingPrompt: string;
};

/** Parsed from OpenRouter chat/completions `usage` (see openrouter.ai docs). */
export type OpenRouterUsage = {
  promptTokens: number;
  completionTokens: number;
  /** `usage.cost` when returned (USD) */
  costUsd: number | null;
};

export function parseOpenRouterUsage(data: unknown): OpenRouterUsage {
  const rec = data as Record<string, unknown> | null;
  const u = rec?.usage;
  if (!u || typeof u !== 'object') {
    return { promptTokens: 0, completionTokens: 0, costUsd: null };
  }
  const ur = u as Record<string, unknown>;
  const pt = typeof ur.prompt_tokens === 'number' ? ur.prompt_tokens : 0;
  const ct = typeof ur.completion_tokens === 'number' ? ur.completion_tokens : 0;
  const raw = ur.cost;
  let costUsd: number | null = null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    costUsd = raw;
  } else if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/[^0-9.+\-eE]/g, ''));
    if (Number.isFinite(n)) costUsd = n;
  }
  return { promptTokens: pt, completionTokens: ct, costUsd };
}

export function addOpenRouterUsage(a: OpenRouterUsage, b: OpenRouterUsage): OpenRouterUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    costUsd:
      a.costUsd != null || b.costUsd != null
        ? (a.costUsd ?? 0) + (b.costUsd ?? 0)
        : null,
  };
}

/** Human-readable duration for job timer */
export function formatKeywordRatingDuration(ms: number): string {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

/** Build newline-separated keyword list for the summary phase */
export function buildKeywordLinesForSummary(rows: ProcessedRow[]): string {
  return rows.map(r => r.keyword.trim()).filter(Boolean).join('\n');
}

/** Stable key for merging ratings onto `results` rows */
export function keywordRatingRowKey(row: Pick<ProcessedRow, 'pageName' | 'keywordLower'>): string {
  return `${row.pageName}\0${row.keywordLower}`;
}

/** Merge accumulated ratings into the current results snapshot (avoids stale overwrites mid-job). */
export function applyKeywordRatingsToResults(
  base: ProcessedRow[] | null,
  ratingMap: Map<string, 1 | 2 | 3>,
): ProcessedRow[] {
  if (!base) return [];
  return base.map(r => {
    const k = keywordRatingRowKey(r);
    const rt = ratingMap.get(k);
    return rt !== undefined ? { ...r, kwRating: rt } : r;
  });
}

/** How many of `targetRows` have kwRating 1 / 2 / 3 in the merged `results` snapshot. */
export function countKwRatingBucketsForRows(
  merged: ProcessedRow[],
  targetRows: ProcessedRow[],
): { n1: number; n2: number; n3: number } {
  const m = new Map(merged.map(r => [keywordRatingRowKey(r), r.kwRating]));
  let n1 = 0, n2 = 0, n3 = 0;
  for (const r of targetRows) {
    const v = m.get(keywordRatingRowKey(r));
    if (v === 1) n1++;
    else if (v === 2) n2++;
    else if (v === 3) n3++;
  }
  return { n1, n2, n3 };
}

/**
 * Parse model JSON for {"rating":1|2|3} or legacy {"rating": "1"} etc.
 */
export function parseKeywordRatingJson(content: string): 1 | 2 | 3 | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const r = (parsed as Record<string, unknown>).rating;
  const n = typeof r === 'number' ? r : typeof r === 'string' ? parseInt(r, 10) : NaN;
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

/** Parse {"summary":"..."} from summary response */
export function parseCoreIntentSummaryJson(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const s = (parsed as Record<string, unknown>).summary;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return null;
}

function openRouterBody(
  model: string,
  messages: { role: 'system' | 'user'; content: string }[],
  temperature: number,
  maxTokens: number,
  reasoningEffort: KeywordRatingSettingsSlice['reasoningEffort'],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    response_format: { type: 'json_object' },
  };
  if (maxTokens > 0) body.max_tokens = maxTokens;
  if (reasoningEffort && reasoningEffort !== 'none') {
    body.reasoning = { effort: reasoningEffort };
  }
  return body;
}

export async function fetchCoreIntentSummary(
  settings: KeywordRatingSettingsSlice,
  keywordLines: string,
  signal: AbortSignal
): Promise<{ summary: string; usage: OpenRouterUsage }> {
  const model = settings.keywordRatingModel.trim() || settings.fallbackModel;
  if (!model) throw new Error('Select a keyword rating model (or main model) in settings.');
  if (!keywordLines.trim()) throw new Error('No keywords to summarize.');
  const user = `Here is the full keyword list (one per line):\n\n${keywordLines}\n\nReturn JSON: {"summary":"..."} describing the single core semantic intent.`;
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const timedResponse = await runWithOpenRouterTimeout({
      signal,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
        },
        body: JSON.stringify(
          openRouterBody(
            model,
            [
              { role: 'system', content: DEFAULT_KEYWORD_SUMMARY_SYSTEM },
              { role: 'user', content: user },
            ],
            settings.temperature,
            settings.maxTokens,
            settings.reasoningEffort,
          ),
        ),
        signal: requestSignal,
      }),
    });
    const res = timedResponse.result;
    if (res.status === 429) {
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error('Rate limited (429) during summary — try again later.');
    }
    if (!res.ok) {
      const t = (await runWithOpenRouterTimeout({
        signal,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
        run: async () => res.text().catch(() => ''),
      }).catch(() => ({ result: '' }))).result;
      throw new Error(`Summary API ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = (await runWithOpenRouterTimeout({
      signal,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      run: async () => res.json(),
    })).result;
    const content = data.choices?.[0]?.message?.content || '';
    const summary = parseCoreIntentSummaryJson(content);
    if (!summary) throw new Error('Model did not return a valid JSON summary.');
    return { summary, usage: parseOpenRouterUsage(data) };
  }
  throw new Error('Summary request failed after retries.');
}

export async function fetchSingleKeywordRating(
  settings: KeywordRatingSettingsSlice,
  coreIntentSummary: string,
  keyword: string,
  signal: AbortSignal
): Promise<{ rating: 1 | 2 | 3; usage: OpenRouterUsage }> {
  const model = settings.keywordRatingModel.trim() || settings.fallbackModel;
  if (!model) throw new Error('Select a keyword rating model (or main model) in settings.');
  const user = [
    'CORE SEMANTIC INTENT (all keywords in this project):',
    coreIntentSummary,
    '',
    'RATING RULES:',
    settings.ratingPrompt.trim() || DEFAULT_KEYWORD_RATING_PROMPT,
    '',
    `KEYWORD TO RATE: ${keyword}`,
    '',
    'Respond with JSON only: {"rating":1} or {"rating":2} or {"rating":3}.',
  ].join('\n');

  const maxRetries = 5;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const timedResponse = await runWithOpenRouterTimeout({
      signal,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
        },
        body: JSON.stringify(
          openRouterBody(
            model,
            [{ role: 'user', content: user }],
            settings.temperature,
            settings.maxTokens,
            settings.reasoningEffort,
          ),
        ),
        signal: requestSignal,
      }),
    });
    const res = timedResponse.result;

    if (res.status === 429) {
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error('Rate limited (429) after retries');
    }

    if (!res.ok) {
      const t = (await runWithOpenRouterTimeout({
        signal,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
        run: async () => res.text().catch(() => ''),
      }).catch(() => ({ result: '' }))).result;
      throw new Error(`Rating API ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = (await runWithOpenRouterTimeout({
      signal,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      run: async () => res.json(),
    })).result;
    const usage = parseOpenRouterUsage(data);
    const content = data.choices?.[0]?.message?.content || '';
    const rating = parseKeywordRatingJson(content);
    if (rating !== null) return { rating, usage };
    lastErr = new Error('Invalid rating JSON from model');
    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 400));
      continue;
    }
  }
  throw lastErr || new Error('Failed to parse rating');
}

/** Run async tasks with max concurrency */
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => runOne()));
  return results;
}
