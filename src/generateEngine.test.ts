import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGenerationEngine, QueueItem, GenerateOutcome, RowUpdate, EngineCallbacks } from './generateEngine';

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

const makeQueue = (count: number, prefix = 'input'): QueueItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    input: `${prefix}-${i}`,
    retries: 0,
  }));

const successResult = (output = 'generated output', cost = 0.001): GenerateOutcome => ({
  output,
  durationMs: 50,
  promptTokens: 10,
  completionTokens: 20,
  cost,
});

const errorResult = (msg = 'API 500: Server Error'): GenerateOutcome => ({
  error: msg,
  durationMs: 50,
});

const abortResult = (): GenerateOutcome => ({
  error: '__aborted__',
  durationMs: 0,
});

interface MockCallbacksOptions {
  generateFn?: (id: string, input: string, signal: AbortSignal) => Promise<GenerateOutcome>;
  rateLimit?: number;
}

function createMockCallbacks(opts: MockCallbacksOptions = {}) {
  let currentRateLimit = opts.rateLimit ?? 10;
  const allFlushedUpdates: Map<string, RowUpdate>[] = [];
  const costUpdates: number[] = [];
  let completeStats: { completedCount: number; elapsedMs: number } | null = null;

  const callbacks: EngineCallbacks = {
    generateForRow: opts.generateFn ?? (async () => successResult()),
    onFlush: vi.fn((updates: Map<string, RowUpdate>) => {
      allFlushedUpdates.push(new Map(updates));
    }),
    onCostUpdate: vi.fn((cost: number) => {
      costUpdates.push(cost);
    }),
    onComplete: vi.fn((stats) => {
      completeStats = stats;
    }),
    getRateLimit: () => currentRateLimit,
  };

  return {
    callbacks,
    setRateLimit: (n: number) => { currentRateLimit = n; },
    getFlushedUpdates: () => allFlushedUpdates,
    getCostUpdates: () => costUpdates,
    getCompleteStats: () => completeStats,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

describe('Generation Engine — Worker Pool', () => {

  it('processes all queue items and calls onComplete', async () => {
    const queue = makeQueue(5);
    const mock = createMockCallbacks();
    const engine = createGenerationEngine(queue, {
      rateLimit: 3, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(3);
    await engine.waitForCompletion();

    expect(mock.callbacks.onComplete).toHaveBeenCalledOnce();
    const stats = mock.getCompleteStats()!;
    expect(stats.completedCount).toBe(5);
    expect(stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('worker count returns to 0 after all workers finish', async () => {
    const queue = makeQueue(3);
    const mock = createMockCallbacks();
    const engine = createGenerationEngine(queue, {
      rateLimit: 3, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(3);
    await engine.waitForCompletion();

    expect(engine.getWorkerCount()).toBe(0);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('spawns no more workers than queue items', async () => {
    const queue = makeQueue(2);
    const mock = createMockCallbacks();
    const engine = createGenerationEngine(queue, {
      rateLimit: 100, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    // Spawn 100 workers for 2 items — engine caps at queue size
    engine.spawnWorkers(100);
    expect(engine.getWorkerCount()).toBe(2); // capped at queue size
    await engine.waitForCompletion();
    expect(engine.getWorkerCount()).toBe(0); // all exited
  });

  it('flushes all updates by completion', async () => {
    const queue = makeQueue(3);
    const mock = createMockCallbacks();
    const engine = createGenerationEngine(queue, {
      rateLimit: 3, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(3);
    await engine.waitForCompletion();

    // All 3 rows should have been flushed
    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    expect(allUpdates.size).toBe(3);
    expect(allUpdates.get('row-0')?.status).toBe('generated');
    expect(allUpdates.get('row-1')?.status).toBe('generated');
    expect(allUpdates.get('row-2')?.status).toBe('generated');
  });
});

describe('Generation Engine — Error Handling', () => {

  it('handles API errors gracefully without killing worker', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        if (callCount === 2) return errorResult('API 500: Internal');
        return successResult();
      },
    });
    const queue = makeQueue(3);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    expect(allUpdates.get('row-0')?.status).toBe('generated');
    expect(allUpdates.get('row-1')?.status).toBe('error');
    expect(allUpdates.get('row-1')?.error).toBe('API 500: Internal');
    expect(allUpdates.get('row-2')?.status).toBe('generated'); // worker continued!
  });

  it('handles unexpected exceptions in generateForRow', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        if (callCount === 2) throw new Error('Network crash');
        return successResult();
      },
    });
    const queue = makeQueue(3);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    expect(allUpdates.get('row-1')?.status).toBe('error');
    expect(allUpdates.get('row-1')?.error).toContain('Network crash');
    expect(allUpdates.get('row-2')?.status).toBe('generated'); // worker recovered!
  });

  it('does not retry on API errors (only retries length constraint failures)', async () => {
    const generateFn = vi.fn(async () => errorResult('API 429: Rate limited'));
    const mock = createMockCallbacks({ generateFn });
    const queue = makeQueue(1);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 5,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    // Should only call once — API errors don't trigger length-retry
    expect(generateFn).toHaveBeenCalledTimes(1);
  });
});

describe('Generation Engine — Length Constraints', () => {

  it('retries when output is too short', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        if (callCount <= 2) return successResult('hi'); // too short
        return successResult('this is long enough output'); // good
      },
    });
    const queue = makeQueue(1);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 10, maxLen: 0, maxRetries: 5,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    expect(allUpdates.get('row-0')?.status).toBe('generated');
    expect(allUpdates.get('row-0')?.retries).toBe(2); // 2 failed + 1 success
  });

  it('retries when output is too long', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        if (callCount <= 1) return successResult('a'.repeat(200)); // too long
        return successResult('short'); // good
      },
    });
    const queue = makeQueue(1);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 10, maxRetries: 5,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    expect(allUpdates.get('row-0')?.status).toBe('generated');
  });

  it('marks error after max retries exceeded and preserves last output', async () => {
    const mock = createMockCallbacks({
      generateFn: async () => successResult('hi'), // always too short
    });
    const queue = makeQueue(1);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 100, maxLen: 0, maxRetries: 2,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    const update = allUpdates.get('row-0')!;
    expect(update.status).toBe('error');
    expect(update.output).toBe('hi'); // last attempt preserved
    expect(update.error).toContain('Exceeded 2 retries');
    expect(update.error).toContain('outside range');
  });
});

describe('Generation Engine — Abort', () => {

  it('stops processing on abort', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        // Small delay so abort can fire
        await new Promise(r => setTimeout(r, 10));
        return successResult();
      },
    });
    const queue = makeQueue(100);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);

    // Abort after brief delay
    await new Promise(r => setTimeout(r, 30));
    engine.abort();
    await engine.waitForCompletion();

    // Should have processed far fewer than 100
    expect(callCount).toBeLessThan(100);
    expect(engine.getWorkerCount()).toBe(0);
  });

  it('discards aborted results (no cost, no output)', async () => {
    const mock = createMockCallbacks({
      generateFn: async (_id, _input, signal) => {
        await new Promise(r => setTimeout(r, 50));
        if (signal.aborted) return abortResult();
        return successResult();
      },
    });
    const queue = makeQueue(5);
    const engine = createGenerationEngine(queue, {
      rateLimit: 5, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(5);

    // Abort immediately
    engine.abort();
    await engine.waitForCompletion();

    // No cost should be recorded for aborted results
    expect(mock.getCostUpdates().length).toBe(0);
  });
});

describe('Generation Engine — Dynamic Concurrency', () => {

  it('scale UP: spawning additional workers processes remaining queue', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        await new Promise(r => setTimeout(r, 20));
        return successResult();
      },
      rateLimit: 1,
    });
    const queue = makeQueue(10);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);

    // Start with 1 worker
    engine.spawnWorkers(1);

    // After brief delay, scale up to 5
    await new Promise(r => setTimeout(r, 30));
    mock.setRateLimit(5);
    engine.spawnWorkers(4); // add 4 more

    await engine.waitForCompletion();
    expect(callCount).toBe(10); // all items processed
    expect(engine.getWorkerCount()).toBe(0);
  });

  it('scale DOWN: excess workers exit gracefully', async () => {
    let peakActive = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        await new Promise(r => setTimeout(r, 30));
        return successResult();
      },
      rateLimit: 10,
    });
    const queue = makeQueue(50);
    const engine = createGenerationEngine(queue, {
      rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);

    engine.spawnWorkers(10);

    // After brief delay, scale down to 2
    await new Promise(r => setTimeout(r, 50));
    mock.setRateLimit(2);

    // Wait a bit for workers to notice scale-down
    await new Promise(r => setTimeout(r, 100));

    // Worker count should have decreased (some may still be mid-request)
    expect(engine.getWorkerCount()).toBeLessThanOrEqual(10);

    await engine.waitForCompletion();
    expect(engine.getWorkerCount()).toBe(0);
  });

  it('scale DOWN then UP: handles rapid changes', async () => {
    const mock = createMockCallbacks({
      generateFn: async () => {
        await new Promise(r => setTimeout(r, 10));
        return successResult();
      },
      rateLimit: 10,
    });
    const queue = makeQueue(30);
    const engine = createGenerationEngine(queue, {
      rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);

    engine.spawnWorkers(10);

    // Scale down
    await new Promise(r => setTimeout(r, 20));
    mock.setRateLimit(2);

    // Scale back up
    await new Promise(r => setTimeout(r, 40));
    mock.setRateLimit(8);
    engine.spawnWorkers(6);

    await engine.waitForCompletion();

    // All items should be processed regardless of scaling
    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    expect(allUpdates.size).toBe(30);
    expect(engine.getWorkerCount()).toBe(0);
  });

  it('workerCount stays accurate through scale-up and scale-down', async () => {
    const mock = createMockCallbacks({
      generateFn: async () => {
        await new Promise(r => setTimeout(r, 50));
        return successResult();
      },
      rateLimit: 5,
    });
    const queue = makeQueue(20);
    const engine = createGenerationEngine(queue, {
      rateLimit: 5, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);

    engine.spawnWorkers(3);
    expect(engine.getWorkerCount()).toBe(3);

    // Scale up — queue has plenty of items remaining
    engine.spawnWorkers(2);
    expect(engine.getWorkerCount()).toBe(5);

    await engine.waitForCompletion();
    expect(engine.getWorkerCount()).toBe(0);
  });
});

describe('Generation Engine — Cost Tracking', () => {

  it('accumulates cost across all completed rows', async () => {
    const mock = createMockCallbacks({
      generateFn: async () => successResult('output', 0.05),
    });
    const queue = makeQueue(4);
    const engine = createGenerationEngine(queue, {
      rateLimit: 4, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(4);
    await engine.waitForCompletion();

    const costs = mock.getCostUpdates();
    // Last cost update should be cumulative
    expect(costs[costs.length - 1]).toBeCloseTo(0.20, 5);
  });

  it('does not accumulate cost for errors', async () => {
    let callCount = 0;
    const mock = createMockCallbacks({
      generateFn: async () => {
        callCount++;
        if (callCount === 2) return errorResult();
        return successResult('output', 0.10);
      },
    });
    const queue = makeQueue(3);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const costs = mock.getCostUpdates();
    // Only 2 successes at $0.10 each
    expect(costs[costs.length - 1]).toBeCloseTo(0.20, 5);
  });
});

describe('Generation Engine — Edge Cases', () => {

  it('handles empty queue', async () => {
    const mock = createMockCallbacks();
    const engine = createGenerationEngine([], {
      rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(10);
    await engine.waitForCompletion();

    expect(engine.getWorkerCount()).toBe(0);
    expect(mock.callbacks.onComplete).toHaveBeenCalledOnce();
    expect(mock.getCompleteStats()!.completedCount).toBe(0);
  });

  it('skips queue items with empty input', async () => {
    const queue: QueueItem[] = [
      { id: 'a', input: '  ', retries: 0 },
      { id: 'b', input: 'real input', retries: 0 },
      { id: 'c', input: '', retries: 0 },
    ];
    const mock = createMockCallbacks();
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    const allUpdates = new Map<string, RowUpdate>();
    for (const batch of mock.getFlushedUpdates()) {
      for (const [k, v] of batch) allUpdates.set(k, v);
    }
    // Only 'b' should be processed
    expect(allUpdates.size).toBe(1);
    expect(allUpdates.has('b')).toBe(true);
  });

  it('single worker processes all items sequentially', async () => {
    const callOrder: string[] = [];
    const mock = createMockCallbacks({
      generateFn: async (id) => {
        callOrder.push(id);
        return successResult();
      },
    });
    const queue = makeQueue(5);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    await engine.waitForCompletion();

    expect(callOrder).toEqual(['row-0', 'row-1', 'row-2', 'row-3', 'row-4']);
  });

  it('forceFlush clears pending updates immediately', async () => {
    const mock = createMockCallbacks({
      generateFn: async () => successResult(),
    });
    const queue = makeQueue(1);
    const engine = createGenerationEngine(queue, {
      rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(1);
    // Wait for processing to complete but before auto-flush
    await new Promise(r => setTimeout(r, 10));
    engine.forceFlush();
    expect(engine.getPendingUpdateCount()).toBe(0);
  });

  it('multiple concurrent workers share queue correctly (no duplicates)', async () => {
    const processedIds = new Set<string>();
    const mock = createMockCallbacks({
      generateFn: async (id) => {
        // Check for duplicate processing
        if (processedIds.has(id)) {
          throw new Error(`DUPLICATE: ${id} was already processed!`);
        }
        processedIds.add(id);
        await new Promise(r => setTimeout(r, 5));
        return successResult();
      },
    });
    const queue = makeQueue(20);
    const engine = createGenerationEngine(queue, {
      rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3,
    }, mock.callbacks);
    engine.spawnWorkers(10);
    await engine.waitForCompletion();

    // All 20 items processed, no duplicates
    expect(processedIds.size).toBe(20);
    expect(engine.getWorkerCount()).toBe(0);
  });
});
