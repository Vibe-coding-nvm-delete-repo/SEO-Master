/**
 * generateEngine.ts — Pure logic for the generation worker pool.
 * Extracted from GenerateTab for testability.
 *
 * This module handles:
 * - Worker pool creation and management
 * - Dynamic concurrency scaling (up/down mid-generation)
 * - Batch update flushing (accumulate results, flush periodically)
 * - Abort handling
 * - Error recovery (workers never silently die)
 */

export interface QueueItem {
  id: string;
  input: string;
  retries: number;
}

export interface GenerateResult {
  output: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

export interface GenerateError {
  error: string;
  durationMs: number;
}

export type GenerateOutcome = GenerateResult | GenerateError;

export interface RowUpdate {
  status: 'generated' | 'error' | 'generating';
  output?: string;
  error?: string;
  generatedAt?: string;
  durationMs?: number;
  retries?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}

export interface EngineConfig {
  rateLimit: number;
  minLen: number;
  maxLen: number;
  maxRetries: number;
}

export interface EngineCallbacks {
  generateForRow: (id: string, input: string, signal: AbortSignal) => Promise<GenerateOutcome>;
  onFlush: (updates: Map<string, RowUpdate>) => void;
  onCostUpdate: (cost: number) => void;
  onComplete: (stats: { completedCount: number; elapsedMs: number }) => void;
  getRateLimit: () => number;
}

export interface EngineHandle {
  /** Spawn additional workers (for dynamic scale-up) */
  spawnWorkers: (count: number) => void;
  /** Wait for all workers to finish */
  waitForCompletion: () => Promise<void>;
  /** Abort all workers */
  abort: () => void;
  /** Get current worker count */
  getWorkerCount: () => number;
  /** Get current active (mid-request) count */
  getActiveCount: () => number;
  /** Get pending updates count */
  getPendingUpdateCount: () => number;
  /** Force flush pending updates */
  forceFlush: () => void;
}

/**
 * Creates and starts a generation engine with the given queue and config.
 * Returns a handle for dynamic control.
 */
export function createGenerationEngine(
  queue: QueueItem[],
  config: EngineConfig,
  callbacks: EngineCallbacks,
): EngineHandle {
  const controller = new AbortController();
  let aborted = false;
  let queueIdx = 0;
  let workerCount = 0;
  let activeCount = 0;
  let totalCost = 0;
  const startTime = Date.now();
  const completionTimestamps: number[] = [];

  // Batch update buffer
  const pendingUpdates = new Map<string, RowUpdate>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushUpdates = () => {
    if (pendingUpdates.size === 0) return;
    const updates = new Map(pendingUpdates);
    pendingUpdates.clear();
    callbacks.onFlush(updates);
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushUpdates();
    }, 200);
  };

  const isOutputInRange = (output: string): boolean => {
    const len = output.length;
    if (config.minLen > 0 && len < config.minLen) return false;
    if (config.maxLen > 0 && len > config.maxLen) return false;
    return true;
  };

  const hasLenConstraint = config.minLen > 0 || config.maxLen > 0;

  // Worker promises tracking
  const activeWorkerPromises = new Set<Promise<void>>();
  const trackWorker = (p: Promise<void>) => {
    activeWorkerPromises.add(p);
    p.finally(() => activeWorkerPromises.delete(p));
  };

  const processNext = async (): Promise<void> => {
    try {
      while (queueIdx < queue.length && !aborted) {
        // Dynamic scale-down: if more workers alive than current rateLimit, exit gracefully
        if (workerCount > callbacks.getRateLimit()) {
          return; // workerCount decremented in finally
        }

        const item = queue[queueIdx++];
        if (!item.input.trim()) continue;
        activeCount++;

        try {
          let attempts = item.retries;
          let lastResult: GenerateOutcome | null = null;

          while (attempts <= config.maxRetries && !aborted) {
            lastResult = await callbacks.generateForRow(item.id, item.input, controller.signal);

            // Aborted — discard
            if ('error' in lastResult && lastResult.error === '__aborted__') {
              lastResult = null;
              break;
            }

            // API error — don't retry
            if ('error' in lastResult) break;

            // Length constraint check
            if (hasLenConstraint && !isOutputInRange(lastResult.output)) {
              attempts++;
              if (attempts > config.maxRetries) {
                const r = lastResult as GenerateResult;
                pendingUpdates.set(item.id, {
                  status: 'error',
                  output: r.output,
                  error: `Exceeded ${config.maxRetries} retries — output length ${r.output.length} outside range [${config.minLen || '0'}–${config.maxLen || '∞'}]`,
                  generatedAt: new Date().toISOString(),
                  durationMs: r.durationMs,
                  retries: attempts,
                  promptTokens: r.promptTokens,
                  completionTokens: r.completionTokens,
                  cost: r.cost,
                });
                lastResult = null;
                break;
              }
              pendingUpdates.set(item.id, { retries: attempts, status: 'generating' });
              scheduleFlush();
              continue;
            }
            break; // Output is in range
          }

          const now = new Date().toISOString();
          if (lastResult && 'output' in lastResult) {
            const r = lastResult as GenerateResult;
            completionTimestamps.push(Date.now());
            totalCost += r.cost;
            callbacks.onCostUpdate(totalCost);
            pendingUpdates.set(item.id, {
              status: 'generated',
              output: r.output,
              generatedAt: now,
              durationMs: r.durationMs,
              retries: attempts,
              promptTokens: r.promptTokens,
              completionTokens: r.completionTokens,
              cost: r.cost,
            });
          } else if (lastResult && 'error' in lastResult) {
            pendingUpdates.set(item.id, {
              status: 'error',
              error: lastResult.error,
              generatedAt: now,
              durationMs: lastResult.durationMs,
              retries: attempts,
            });
          }
          scheduleFlush();
        } catch (e: any) {
          pendingUpdates.set(item.id, {
            status: 'error',
            error: `Unexpected: ${e.message || 'Unknown error'}`,
            generatedAt: new Date().toISOString(),
            durationMs: 0,
            retries: 0,
          });
          scheduleFlush();
        } finally {
          activeCount--;
        }
      }
    } finally {
      // ALWAYS decrement workerCount when worker exits
      workerCount--;
    }
  };

  const spawnWorkers = (count: number) => {
    for (let i = 0; i < count; i++) {
      // Don't spawn workers if queue is exhausted — they'd exit immediately
      if (queueIdx >= queue.length) break;
      workerCount++;
      trackWorker(processNext());
    }
  };

  const waitForCompletion = async () => {
    while (activeWorkerPromises.size > 0) {
      await Promise.all([...activeWorkerPromises]);
    }
    // Final flush
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushUpdates();
    callbacks.onComplete({
      completedCount: completionTimestamps.length,
      elapsedMs: Date.now() - startTime,
    });
  };

  return {
    spawnWorkers,
    waitForCompletion,
    abort: () => { aborted = true; controller.abort(); },
    getWorkerCount: () => workerCount,
    getActiveCount: () => activeCount,
    getPendingUpdateCount: () => pendingUpdates.size,
    forceFlush: flushUpdates,
  };
}
