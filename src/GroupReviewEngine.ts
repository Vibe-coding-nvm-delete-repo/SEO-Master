// GroupReviewEngine.ts — Pure logic for AI-powered semantic group review
// No React dependencies. Handles queue processing, API calls, JSON parsing, concurrency.

import {
  OPENROUTER_REQUEST_TIMEOUT_MS,
  resolveOpenRouterAbortError,
  runWithOpenRouterTimeout,
} from './openRouterTimeout';

export interface ReviewRequest {
  groupId: string;
  groupName: string;
  pages: { pageName: string; tokens: string[] }[];
}

export interface ReviewResult {
  groupId: string;
  status: 'approve' | 'mismatch';
  mismatchedPages: string[];
  reason: string;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  reviewedAt: string;
}

export interface ReviewError {
  groupId: string;
  error: string;
  durationMs: number;
}

export interface ReviewEngineConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  concurrency: number;
  modelPricing?: { prompt: string; completion: string };
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

export interface ReviewEngineCallbacks {
  onReviewing: (groupId: string) => void;
  onResult: (result: ReviewResult) => void;
  onError: (error: ReviewError) => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are an SEO expert reviewing keyword groupings. Given a group name and a list of pages (each with their keyword tokens), determine whether ALL pages semantically belong under the group name.

If all pages match the group theme, respond with status "approve".
If any pages do NOT match the group theme, respond with status "mismatch" and list the exact page names that don't belong.

Always respond with valid JSON matching this exact schema:
{ "status": "approve" | "mismatch", "mismatched_pages": [], "reason": "brief explanation" }`;

export { DEFAULT_SYSTEM_PROMPT };

/**
 * Maps LLM-returned mismatched page strings to canonical `pageName` values from the request.
 * Prevents sub-row QA dots from disappearing when the model uses different spacing/casing.
 */
export function normalizeMismatchedPageNames(canonicalPageNames: string[], raw: string[]): string[] {
  const canon = [...canonicalPageNames];
  const canonSet = new Set(canon);
  const out = new Set<string>();

  for (const r of raw) {
    const t = typeof r === 'string' ? r.trim() : '';
    if (!t) continue;

    if (canonSet.has(t)) {
      out.add(t);
      continue;
    }

    const lower = t.toLowerCase();
    const ciHits = canon.filter(c => c.toLowerCase() === lower);
    if (ciHits.length === 1) {
      out.add(ciHits[0]);
      continue;
    }

    const fuzzy = canon.filter(c => c === t || c.includes(t) || t.includes(c));
    if (fuzzy.length === 1) {
      out.add(fuzzy[0]);
      continue;
    }
  }

  return Array.from(out);
}

function buildUserMessage(groupName: string, pages: { pageName: string; tokens: string[] }[]): string {
  const pageList = pages.map(p => `- "${p.pageName}" [tokens: ${p.tokens.join(', ')}]`).join('\n');
  return `Group Name: "${groupName}"\n\nPages in this group:\n${pageList}\n\nRespond with JSON only.`;
}

async function reviewSingleGroup(
  request: ReviewRequest,
  config: ReviewEngineConfig,
  signal: AbortSignal
): Promise<ReviewResult | ReviewError> {
  const startTime = performance.now();
  const maxRateLimitRetries = 5;

  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
    if (signal.aborted) return { groupId: request.groupId, error: '__aborted__', durationMs: 0 };
    let timedOut = false;

    try {
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
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: config.systemPrompt || DEFAULT_SYSTEM_PROMPT },
              { role: 'user', content: buildUserMessage(request.groupName, request.pages) },
            ],
            temperature: config.temperature ?? 0.3,
            ...(config.maxTokens > 0 ? { max_tokens: config.maxTokens } : {}),
            ...(config.reasoningEffort && config.reasoningEffort !== 'none' ? { reasoning: { effort: config.reasoningEffort } } : {}),
            response_format: { type: 'json_object' },
          }),
          signal: requestSignal,
        }),
      });
      const res = timedResponse.result;
      timedOut = timedResponse.timedOut;

      // Rate limited — retry with exponential backoff
      if (res.status === 429) {
        if (attempt < maxRateLimitRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return { groupId: request.groupId, error: `Rate limited (429) — ${maxRateLimitRetries} retries exhausted`, durationMs: Math.round(performance.now() - startTime) };
      }

      if (!res.ok) {
        const timedErrText = await runWithOpenRouterTimeout({
          signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async () => res.text().catch(() => ''),
        }).catch(() => ({ result: '', timedOut }));
        const errText = timedErrText.result;
        timedOut = timedErrText.timedOut;
        return { groupId: request.groupId, error: `API ${res.status}: ${errText.slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
      }

      const timedJson = await runWithOpenRouterTimeout({
        signal,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
        run: async () => res.json(),
      });
      const data = timedJson.result;
      timedOut = timedJson.timedOut;

      // Check for API-level error in body
      if (data.error) {
        return { groupId: request.groupId, error: `API error: ${typeof data.error === 'string' ? data.error : data.error?.message || JSON.stringify(data.error).slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
      }

      const content = data.choices?.[0]?.message?.content || '';
      if (!content.trim()) {
        return { groupId: request.groupId, error: `Empty response from API`, durationMs: Math.round(performance.now() - startTime) };
      }

      // Parse JSON — try direct parse, then extract from markdown code blocks
      let parsed: { status?: string; mismatched_pages?: string[]; reason?: string };
      try {
        parsed = JSON.parse(content);
      } catch {
        // Try extracting from ```json...``` blocks
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            parsed = JSON.parse(jsonMatch[1].trim());
          } catch {
            return { groupId: request.groupId, error: `JSON parse failed: ${content.slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
          }
        } else {
          return { groupId: request.groupId, error: `JSON parse failed: ${content.slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
        }
      }

      // Validate parsed structure
      const status = parsed.status === 'approve' || parsed.status === 'mismatch' ? parsed.status : 'error' as const;
      if (status === 'error') {
        return { groupId: request.groupId, error: `Invalid status "${parsed.status}" in response: ${content.slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
      }

      // Calculate cost
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const promptCost = config.modelPricing ? promptTokens * parseFloat(config.modelPricing.prompt) : 0;
      const completionCost = config.modelPricing ? completionTokens * parseFloat(config.modelPricing.completion) : 0;

      const rawMismatch: string[] = Array.isArray(parsed.mismatched_pages) ? parsed.mismatched_pages : [];
      const canonicalNames = request.pages.map(p => p.pageName);
      const mismatchedPages =
        status === 'mismatch'
          ? normalizeMismatchedPageNames(canonicalNames, rawMismatch)
          : [];

      return {
        groupId: request.groupId,
        status,
        mismatchedPages,
        reason: parsed.reason || '',
        cost: promptCost + completionCost,
        promptTokens,
        completionTokens,
        durationMs: Math.round(performance.now() - startTime),
        reviewedAt: new Date().toISOString(),
      };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return {
          groupId: request.groupId,
          error: resolveOpenRouterAbortError({
            parentAborted: signal.aborted,
            timedOut,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          }),
          durationMs: 0,
        };
      }
      return { groupId: request.groupId, error: e.message || 'Unknown error', durationMs: Math.round(performance.now() - startTime) };
    }
  }

  return { groupId: request.groupId, error: 'Max retries exhausted', durationMs: Math.round(performance.now() - startTime) };
}

export async function processReviewQueue(
  queue: ReviewRequest[],
  config: ReviewEngineConfig,
  callbacks: ReviewEngineCallbacks,
  signal: AbortSignal
): Promise<void> {
  let queueIdx = 0;

  const processNext = async (): Promise<void> => {
    while (queueIdx < queue.length && !signal.aborted) {
      const request = queue[queueIdx++];
      callbacks.onReviewing(request.groupId);

      const result = await reviewSingleGroup(request, config, signal);

      if ('error' in result) {
        if (result.error === '__aborted__') {
          // Must notify — otherwise UI stays on 'reviewing' forever (no onResult/onError).
          callbacks.onError({
            groupId: request.groupId,
            error: 'Aborted',
            durationMs: result.durationMs ?? 0,
          });
          return;
        }
        callbacks.onError(result);
      } else {
        callbacks.onResult(result);
      }
    }
  };

  // concurrency 0 would spawn zero workers and leave every group stuck in 'reviewing'
  const workerCount =
    queue.length === 0 ? 0 : Math.max(1, Math.min(config.concurrency || 1, queue.length));
  const workers = Array.from({ length: workerCount }, () => processNext());
  await Promise.all(workers);
}
