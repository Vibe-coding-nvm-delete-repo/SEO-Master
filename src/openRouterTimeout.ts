export const OPENROUTER_REQUEST_TIMEOUT_MS = 60_000;

export function buildOpenRouterTimeoutError(timeoutMs: number): string {
  return `Request timed out after ${Math.round(timeoutMs / 1000)}s. The provider left the request hanging. Retry the row or lower concurrency if this keeps happening.`;
}

export function resolveOpenRouterAbortError(opts: {
  parentAborted: boolean;
  timedOut: boolean;
  timeoutMs: number;
}): string {
  if (opts.parentAborted && !opts.timedOut) return '__aborted__';
  return buildOpenRouterTimeoutError(opts.timeoutMs);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : !!error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError';
}

/**
 * Detect transient network errors that are safe to retry (e.g. "Failed to fetch",
 * connection reset, DNS failure). These are browser-level errors thrown by fetch()
 * before any HTTP response is received.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: string }).message ?? '';
    return /fetch|network/i.test(msg);
  }
  return false;
}

export async function runWithOpenRouterTimeout<T>(opts: {
  signal: AbortSignal;
  timeoutMs?: number;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<{ result: T; timedOut: boolean }> {
  const timeoutMs = opts.timeoutMs ?? OPENROUTER_REQUEST_TIMEOUT_MS;
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const forwardAbort = () => timeoutController.abort();
  opts.signal.addEventListener('abort', forwardAbort, { once: true });

  try {
    const result = await opts.run(timeoutController.signal);
    return { result, timedOut };
  } catch (error) {
    if (timedOut && isAbortError(error)) {
      throw new DOMException(buildOpenRouterTimeoutError(timeoutMs), 'AbortError');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    opts.signal.removeEventListener('abort', forwardAbort);
  }
}
