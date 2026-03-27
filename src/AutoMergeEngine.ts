import type { OpenRouterUsage } from './KeywordRatingEngine';
import { addOpenRouterUsage, parseOpenRouterUsage } from './KeywordRatingEngine';

export const DEFAULT_AUTO_MERGE_PROMPT = `You identify tokens that are lexically or semantically IDENTICAL to a source token.

STRICT RULES:
- Only return exact-equivalent tokens (same real-world meaning), including very minor spelling variants/typos.
- Do NOT return broad synonyms or related words.
- Do NOT return parent/child concepts.
- If unsure, exclude it.

Return JSON only:
{
  "matches": ["..."],
  "confidence": 0.0,
  "reason": "short reason"
}

confidence must be between 0 and 1.`;

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
  const rec = parsed as Record<string, unknown>;
  const matchesRaw = Array.isArray(rec.matches) ? rec.matches : [];
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
): Promise<{ result: AutoMergeModelResult; usage: OpenRouterUsage }> {
  const model = settings.model.trim() || settings.fallbackModel;
  if (!model) throw new Error('Select an OpenRouter model.');
  const user = [
    settings.prompt.trim() || DEFAULT_AUTO_MERGE_PROMPT,
    '',
    `SOURCE_TOKEN: ${sourceToken}`,
    '',
    'CANDIDATE_TOKENS_JSON:',
    JSON.stringify(candidateTokens),
    '',
    'Return JSON only with matches that are IDENTICAL to SOURCE_TOKEN.',
  ].join('\n');

  const maxRetries = 5;
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
    if (!parsed) throw new Error('Model did not return valid Auto Merge JSON.');
    return { result: parsed, usage: parseOpenRouterUsage(data) };
  }
  throw new Error('Auto Merge request failed after retries.');
}

export function addAutoMergeUsage(a: OpenRouterUsage, b: OpenRouterUsage): OpenRouterUsage {
  return addOpenRouterUsage(a, b);
}
