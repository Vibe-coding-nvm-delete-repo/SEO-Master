import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildOpenRouterTimeoutError,
  runWithOpenRouterTimeout,
} from './openRouterTimeout';

describe('openRouterTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out hung requests and surfaces the shared timeout message', async () => {
    vi.useFakeTimers();

    const promise = runWithOpenRouterTimeout({
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      run: async (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    });

    const settled = promise.then(
      () => null,
      (error) => error,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    const error = await settled;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect((error as Error).message).toBe(buildOpenRouterTimeoutError(1_000));
  });

  it('passes successful responses through unchanged', async () => {
    await expect(runWithOpenRouterTimeout({
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      run: async () => 'ok',
    })).resolves.toEqual({ result: 'ok', timedOut: false });
  });

  it('preserves user aborts instead of rewriting them as timeouts', async () => {
    const controller = new AbortController();

    const promise = runWithOpenRouterTimeout({
      signal: controller.signal,
      timeoutMs: 1_000,
      run: async (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    });

    controller.abort();

    const error = await promise.then(
      () => null,
      (err) => err,
    );
    expect(error).toBeInstanceOf(DOMException);
    expect((error as Error).message).toBe('Aborted');
  });
});
