import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLatestPersistQueue } from './useLatestPersistQueue';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useLatestPersistQueue', () => {
  it('flushes the latest persist callback after rerender', async () => {
    const calls: string[] = [];

    const { result, rerender } = renderHook(
      ({ label }: { label: string }) =>
        useLatestPersistQueue(async () => {
          calls.push(label);
        }),
      { initialProps: { label: 'initial' } },
    );

    act(() => {
      result.current.schedule();
    });

    rerender({ label: 'latest' });

    await act(async () => {
      await result.current.flushNow();
    });

    expect(calls).toEqual(['latest']);
  });

  it('coalesces repeated schedules behind a single in-flight flush loop', async () => {
    const calls: string[] = [];
    const firstPersist = createDeferred();
    const secondPersist = createDeferred();
    const startedPromises = [createDeferred(), createDeferred()];

    const { result, rerender } = renderHook(
      ({ label }: { label: string }) =>
        useLatestPersistQueue(async () => {
          calls.push(label);
          const index = calls.length - 1;
          startedPromises[index]?.resolve();
          if (index === 0) {
            await firstPersist.promise;
            return;
          }
          if (index === 1) {
            await secondPersist.promise;
          }
        }),
      { initialProps: { label: 'initial' } },
    );

    act(() => {
      result.current.schedule();
    });
    await startedPromises[0].promise;

    rerender({ label: 'middle' });
    act(() => {
      result.current.schedule();
      result.current.schedule();
    });

    rerender({ label: 'latest' });
    act(() => {
      result.current.schedule();
    });

    firstPersist.resolve();
    await startedPromises[1].promise;
    expect(calls).toEqual(['initial', 'latest']);

    secondPersist.resolve();
    await act(async () => {
      await result.current.flushNow();
    });

    expect(calls).toEqual(['initial', 'latest']);
  });
});
