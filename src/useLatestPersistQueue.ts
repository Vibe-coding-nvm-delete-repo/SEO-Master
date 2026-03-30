import { useCallback, useEffect, useRef } from 'react';

/**
 * Schedules persistence immediately but only flushes the latest state. If new writes
 * arrive while an async persist is in flight, they coalesce into the next loop pass.
 */
export function useLatestPersistQueue(runPersist: () => Promise<void>) {
  const needsFlushRef = useRef(false);
  const runPersistRef = useRef(runPersist);
  const activeFlushRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    runPersistRef.current = runPersist;
  }, [runPersist]);

  const flushLoop = useCallback(async () => {
    while (needsFlushRef.current) {
      needsFlushRef.current = false;
      await runPersistRef.current();
    }
  }, []);

  const ensureFlushScheduled = useCallback(() => {
    if (activeFlushRef.current) return activeFlushRef.current;

    const activeFlush = Promise.resolve()
      .then(flushLoop)
      .catch(() => {
        /* individual persist functions already surface their own failures */
      })
      .finally(() => {
        activeFlushRef.current = null;
      });

    activeFlushRef.current = activeFlush;
    return activeFlush;
  }, [flushLoop]);

  const schedule = useCallback(() => {
    needsFlushRef.current = true;
    void ensureFlushScheduled();
  }, [ensureFlushScheduled]);

  const flushNow = useCallback(async () => {
    await Promise.resolve();
    if (!activeFlushRef.current && !needsFlushRef.current) {
      schedule();
    }
    while (activeFlushRef.current) {
      await activeFlushRef.current;
    }
  }, [schedule]);

  return { schedule, flushNow };
}
