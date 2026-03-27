import type { OpenRouterUsage } from './KeywordRatingEngine';
import { addOpenRouterUsage, parseOpenRouterUsage } from './KeywordRatingEngine';
import type { TokenSummary } from './types';

export const DEFAULT_AUTO_MERGE_PROMPT = `You identify tokens that are lexically or semantically IDENTICAL to a source token.

NON-NEGOTIABLE MERGE POLICY:
- Merge ONLY when semantic intent is literally identical in all realistic contexts.
- If there is ANY meaning drift, nuance shift, broader/narrower scope, or ambiguity, EXCLUDE it.
- Assume "do not merge" unless exact identity is clearly proven.

LEXICAL VARIATION RULE:
- Allowed lexical variation is only super-minor surface form differences with zero meaning impact:
  - obvious typo or misspelling
  - punctuation/hyphen spacing differences
  - trivial casing/plural formatting variants that do not change meaning
- If lexical variation could imply even slightly different meaning, EXCLUDE it.

DO NOT MERGE:
- broad synonyms
- related terms
- parent/child concepts
- adjacent intents (same category but different user goal)
- brand vs generic variants (unless literally identical referent)
- anything uncertain

Return JSON only:
{
  "matches": ["..."],
  "confidence": 0.0,
  "reason": "short reason"
}

confidence must be between 0 and 1.`;

const HARD_AUTO_MERGE_POLICY = `NON-NEGOTIABLE MERGE POLICY:
- Merge ONLY when semantic intent is literally identical in all realistic contexts.
- If there is ANY meaning drift, nuance shift, broader/narrower scope, or ambiguity, EXCLUDE it.
- Assume "do not merge" unless exact identity is clearly proven.

LEXICAL VARIATION RULE:
- Allowed lexical variation is only super-minor surface form differences with zero meaning impact:
  - obvious typo or misspelling
  - punctuation/hyphen spacing differences
  - trivial casing/plural formatting variants that do not change meaning
- If lexical variation could imply even slightly different meaning, EXCLUDE it.

DO NOT MERGE:
- broad synonyms
- related terms
- parent/child concepts
- adjacent intents (same category but different user goal)
- brand vs generic variants (unless literally identical referent)
- anything uncertain`;

export type AutoMergeSettingsSlice = {
  apiKey: string;
  model: string;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  prompt: string;
};

export type AutoMergeModelResult = {
  matches: string[];
  confidence: number;
  reason: string;
};

export type AutoMergeTokenPageContext = {
  pageName: string;
  keywordCount: number;
  totalVolume: number;
  avgKd: number | null;
};

export function selectAutoMergeTokenRows(tokenRows: TokenSummary[], samplePercent: number): TokenSummary[] {
  if (tokenRows.length <= 2) return tokenRows;
  const pct = Math.max(1, Math.min(100, Math.floor(samplePercent)));
  if (pct >= 100) return tokenRows;
  const limit = Math.min(tokenRows.length, Math.max(2, Math.ceil((tokenRows.length * pct) / 100)));
  if (limit >= tokenRows.length) return tokenRows;
  return [...tokenRows]
    .sort((a, b) => {
      if (a.frequency !== b.frequency) return b.frequency - a.frequency;
      if (a.totalVolume !== b.totalVolume) return b.totalVolume - a.totalVolume;
      return a.token.localeCompare(b.token);
    })
    .slice(0, limit);
}

function parseJsonObjectCandidate(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function extractBalancedJsonObjects(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          out.push(input.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

function openRouterBody(
  model: string,
  message: string,
  temperature: number,
  maxTokens: number,
  reasoningEffort: AutoMergeSettingsSlice['reasoningEffort'],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: message }],
    temperature,
    response_format: { type: 'json_object' },
  };
  if (maxTokens > 0) body.max_tokens = maxTokens;
  if (reasoningEffort && reasoningEffort !== 'none') {
    body.reasoning = { effort: reasoningEffort };
  }
  return body;
}

export function parseAutoMergeJson(content: string): AutoMergeModelResult | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null = fenced.exec(trimmed);
  while (fenceMatch) {
    const body = (fenceMatch[1] || '').trim();
    if (body) candidates.push(body);
    fenceMatch = fenced.exec(trimmed);
  }
  for (const obj of extractBalancedJsonObjects(trimmed)) candidates.push(obj);

  let parsedObj: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    const parsed = parseJsonObjectCandidate(candidate);
    if (!parsed || typeof parsed !== 'object') continue;
    const rec = parsed as Record<string, unknown>;
    const hasMatches = rec.matches != null;
    const hasConfidence = rec.confidence != null;
    const hasReason = rec.reason != null;
    if (hasMatches || hasConfidence || hasReason) {
      parsedObj = rec;
      break;
    }
    if (!parsedObj) parsedObj = rec;
  }
  if (!parsedObj) return null;

  const rec = parsedObj;
  const matchesRaw = Array.isArray(rec.matches)
    ? rec.matches
    : (typeof rec.matches === 'string' ? rec.matches.split(',') : []);
  const matches = matchesRaw
    .filter((m): m is string => typeof m === 'string')
    .map(m => m.trim())
    .filter(Boolean);
  const confRaw = rec.confidence;
  let confidence = 0;
  if (typeof confRaw === 'number' && Number.isFinite(confRaw)) confidence = confRaw;
  else if (typeof confRaw === 'string') {
    const n = parseFloat(confRaw);
    if (Number.isFinite(n)) confidence = n;
  }
  confidence = Math.max(0, Math.min(1, confidence));
  const reason = typeof rec.reason === 'string' ? rec.reason.trim() : '';
  return { matches, confidence, reason };
}

export async function fetchAutoMergeMatches(
  settings: AutoMergeSettingsSlice,
  sourceToken: string,
  candidateTokens: string[],
  signal: AbortSignal,
  context?: {
    sourceTopPages: AutoMergeTokenPageContext[];
    candidateTopPagesByToken: Record<string, AutoMergeTokenPageContext[]>;
  },
): Promise<{ result: AutoMergeModelResult; usage: OpenRouterUsage }> {
  const model = settings.model.trim() || settings.fallbackModel;
  if (!model) throw new Error('Select an OpenRouter model.');
  const user = [
    settings.prompt.trim() || DEFAULT_AUTO_MERGE_PROMPT,
    '',
    HARD_AUTO_MERGE_POLICY,
    '',
    `SOURCE_TOKEN: ${sourceToken}`,
    'SOURCE_TOP_5_PAGES_JSON:',
    JSON.stringify(context?.sourceTopPages || []),
    '',
    'CANDIDATE_TOKENS_JSON:',
    JSON.stringify(candidateTokens),
    '',
    'CANDIDATE_TOP_5_PAGES_BY_TOKEN_JSON:',
    JSON.stringify(context?.candidateTopPagesByToken || {}),
    '',
    'Use top-5 page context to verify literal semantic identity before matching.',
    'Think carefully before deciding.',
    'Return JSON only with matches that are literally IDENTICAL in semantic intent to SOURCE_TOKEN.',
    'If there is any doubt at all, return no match for that candidate.',
  ].join('\n');

  const maxRetries = 5;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
      },
      body: JSON.stringify(
        openRouterBody(
          model,
          user,
          settings.temperature,
          settings.maxTokens,
          settings.reasoningEffort,
        ),
      ),
      signal,
    });
    if (res.status === 429) {
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error('Rate limited (429) during Auto Merge.');
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Auto Merge API ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = parseAutoMergeJson(content);
    if (!parsed) {
      lastErr = new Error(`Model did not return valid Auto Merge JSON (attempt ${attempt + 1}/${maxRetries + 1}).`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      break;
    }
    return { result: parsed, usage: parseOpenRouterUsage(data) };
  }
  throw lastErr || new Error('Auto Merge request failed after retries.');
}

export function addAutoMergeUsage(a: OpenRouterUsage, b: OpenRouterUsage): OpenRouterUsage {
  return addOpenRouterUsage(a, b);
}
