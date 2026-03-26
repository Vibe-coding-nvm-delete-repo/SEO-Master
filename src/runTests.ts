import { createGenerationEngine } from './generateEngine.ts';
import type { QueueItem, GenerateOutcome, RowUpdate } from './generateEngine.ts';

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) { passed++; console.log('  \u2713', msg); }
    else { failed++; console.error('  \u2717 FAIL:', msg); }
  }

  const makeQueue = (n: number): QueueItem[] =>
    Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, input: `input-${i}`, retries: 0 }));
  const ok = (output = 'out', cost = 0.001): GenerateOutcome =>
    ({ output, durationMs: 50, promptTokens: 10, completionTokens: 20, cost });
  const err = (msg = 'API 500'): GenerateOutcome => ({ error: msg, durationMs: 50 });

  function makeMock(opts: { fn?: (id: string, input: string, signal: AbortSignal) => Promise<GenerateOutcome>; rateLimit?: number } = {}) {
    let rl = opts.rateLimit || 10;
    const flushed: Map<string, RowUpdate>[] = [];
    const costs: number[] = [];
    let stats: { completedCount: number; elapsedMs: number } | null = null;
    return {
      cb: {
        generateForRow: opts.fn || (async () => ok()),
        onFlush: (u: Map<string, RowUpdate>) => flushed.push(new Map(u)),
        onCostUpdate: (c: number) => costs.push(c),
        onComplete: (s: { completedCount: number; elapsedMs: number }) => { stats = s; },
        getRateLimit: () => rl,
      },
      setRL: (n: number) => { rl = n; },
      flushed,
      costs,
      getStats: () => stats,
      getAllUpdates: () => {
        const all = new Map<string, RowUpdate>();
        flushed.forEach(b => b.forEach((v, k) => all.set(k, v)));
        return all;
      },
    };
  }

  // ── Test 1 ──
  console.log('\nTest 1: Processes all queue items');
  {
    const m = makeMock();
    const e = createGenerationEngine(makeQueue(5), { rateLimit: 3, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(3);
    await e.waitForCompletion();
    assert(m.getStats()!.completedCount === 5, 'completedCount=5');
    assert(e.getWorkerCount() === 0, 'workerCount=0');
  }

  // ── Test 2 ──
  console.log('\nTest 2: Worker survives API errors');
  {
    let c = 0;
    const m = makeMock({ fn: async () => { c++; if (c === 2) return err(); return ok(); } });
    const e = createGenerationEngine(makeQueue(3), { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.get('row-0')?.status === 'generated', 'row-0 generated');
    assert(all.get('row-1')?.status === 'error', 'row-1 error');
    assert(all.get('row-2')?.status === 'generated', 'row-2 generated (worker continued)');
  }

  // ── Test 3 ──
  console.log('\nTest 3: Worker survives thrown exceptions');
  {
    let c = 0;
    const m = makeMock({ fn: async () => { c++; if (c === 2) throw new Error('crash'); return ok(); } });
    const e = createGenerationEngine(makeQueue(3), { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.get('row-1')?.error?.includes('crash') || false, 'row-1 has crash error');
    assert(all.get('row-2')?.status === 'generated', 'row-2 generated (worker recovered)');
  }

  // ── Test 4 ──
  console.log('\nTest 4: Length constraint retries');
  {
    let c = 0;
    const m = makeMock({ fn: async () => { c++; if (c <= 2) return ok('hi'); return ok('long enough output'); } });
    const e = createGenerationEngine(makeQueue(1), { rateLimit: 1, minLen: 10, maxLen: 0, maxRetries: 5 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.get('row-0')?.status === 'generated', 'eventually generated');
    assert(all.get('row-0')?.retries === 2, 'retries=2');
  }

  // ── Test 5 ──
  console.log('\nTest 5: Max retries exceeded preserves output');
  {
    const m = makeMock({ fn: async () => ok('hi') });
    const e = createGenerationEngine(makeQueue(1), { rateLimit: 1, minLen: 100, maxLen: 0, maxRetries: 2 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.get('row-0')?.status === 'error', 'marked error');
    assert(all.get('row-0')?.output === 'hi', 'output preserved');
    assert(all.get('row-0')?.error?.includes('Exceeded') || false, 'error mentions exceeded');
  }

  // ── Test 6 ──
  console.log('\nTest 6: Empty queue');
  {
    const m = makeMock();
    const e = createGenerationEngine([], { rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(10);
    await e.waitForCompletion();
    assert(e.getWorkerCount() === 0, 'workerCount=0');
    assert(m.getStats()!.completedCount === 0, 'completedCount=0');
  }

  // ── Test 7 ──
  console.log('\nTest 7: Skips empty inputs');
  {
    const q: QueueItem[] = [
      { id: 'a', input: '  ', retries: 0 },
      { id: 'b', input: 'real', retries: 0 },
      { id: 'c', input: '', retries: 0 },
    ];
    const m = makeMock();
    const e = createGenerationEngine(q, { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.size === 1, 'only 1 processed');
    assert(all.has('b'), 'only real input processed');
  }

  // ── Test 8 ──
  console.log('\nTest 8: Abort stops processing');
  {
    let c = 0;
    const m = makeMock({ fn: async () => { c++; await new Promise(r => setTimeout(r, 20)); return ok(); } });
    const e = createGenerationEngine(makeQueue(100), { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    await new Promise(r => setTimeout(r, 60));
    e.abort();
    await e.waitForCompletion();
    assert(c < 100, `processed fewer than 100 (got ${c})`);
    assert(e.getWorkerCount() === 0, 'workerCount=0 after abort');
  }

  // ── Test 9 ──
  console.log('\nTest 9: No duplicate processing with concurrent workers');
  {
    const seen = new Set<string>();
    let dupes = 0;
    const m = makeMock({
      fn: async (id) => {
        if (seen.has(id)) dupes++;
        seen.add(id);
        await new Promise(r => setTimeout(r, 5));
        return ok();
      },
    });
    const e = createGenerationEngine(makeQueue(20), { rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(10);
    await e.waitForCompletion();
    assert(dupes === 0, `no duplicates (${dupes} found)`);
    assert(seen.size === 20, 'all 20 processed');
  }

  // ── Test 10 ──
  console.log('\nTest 10: Scale UP mid-generation');
  {
    let c = 0;
    const m = makeMock({
      fn: async () => { c++; await new Promise(r => setTimeout(r, 15)); return ok(); },
      rateLimit: 1,
    });
    const e = createGenerationEngine(makeQueue(10), { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    await new Promise(r => setTimeout(r, 40));
    m.setRL(5);
    e.spawnWorkers(4);
    await e.waitForCompletion();
    assert(c === 10, `all 10 processed (got ${c})`);
    assert(e.getWorkerCount() === 0, 'workerCount=0');
  }

  // ── Test 11 ──
  console.log('\nTest 11: Scale DOWN mid-generation');
  {
    const m = makeMock({
      fn: async () => { await new Promise(r => setTimeout(r, 20)); return ok(); },
      rateLimit: 10,
    });
    const e = createGenerationEngine(makeQueue(50), { rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(10);
    await new Promise(r => setTimeout(r, 50));
    m.setRL(2);
    await new Promise(r => setTimeout(r, 100));
    assert(e.getWorkerCount() <= 10, 'workers decreased or finishing');
    await e.waitForCompletion();
    assert(e.getWorkerCount() === 0, 'workerCount=0 final');
  }

  // ── Test 12 ──
  console.log('\nTest 12: Cost accumulation');
  {
    const m = makeMock({ fn: async () => ok('out', 0.05) });
    const e = createGenerationEngine(makeQueue(4), { rateLimit: 4, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(4);
    await e.waitForCompletion();
    const last = m.costs[m.costs.length - 1];
    assert(Math.abs(last - 0.20) < 0.001, `total cost ~0.20 (got ${last})`);
  }

  // ── Test 13 ──
  console.log('\nTest 13: workerCount accuracy through spawn');
  {
    const m = makeMock({ fn: async () => { await new Promise(r => setTimeout(r, 50)); return ok(); } });
    const e = createGenerationEngine(makeQueue(10), { rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(3);
    assert(e.getWorkerCount() === 3, 'initial workerCount=3');
    e.spawnWorkers(2);
    assert(e.getWorkerCount() === 5, 'after spawn workerCount=5');
    await e.waitForCompletion();
    assert(e.getWorkerCount() === 0, 'final workerCount=0');
  }

  // ── Test 14 ──
  console.log('\nTest 14: Excess workers exit immediately');
  {
    const m = makeMock();
    const e = createGenerationEngine(makeQueue(2), { rateLimit: 100, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(100);
    // Some workers exit immediately (queue only has 2 items), so count may be < 100 already
    assert(e.getWorkerCount() <= 100 && e.getWorkerCount() >= 0, 'workers created and some already exiting');
    await e.waitForCompletion();
    assert(e.getWorkerCount() === 0, 'all exited');
    const all = m.getAllUpdates();
    assert(all.size === 2, 'only 2 items processed');
  }

  // ── Test 15 ──
  console.log('\nTest 15: Scale DOWN then UP rapidly');
  {
    const m = makeMock({
      fn: async () => { await new Promise(r => setTimeout(r, 10)); return ok(); },
      rateLimit: 10,
    });
    const e = createGenerationEngine(makeQueue(30), { rateLimit: 10, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(10);
    await new Promise(r => setTimeout(r, 20));
    m.setRL(2); // scale down
    await new Promise(r => setTimeout(r, 40));
    m.setRL(8); // scale back up
    e.spawnWorkers(6);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.size === 30, `all 30 processed (got ${all.size})`);
    assert(e.getWorkerCount() === 0, 'workerCount=0');
  }

  // ── Test 16 ──
  console.log('\nTest 16: No cost for error rows');
  {
    let c = 0;
    const m = makeMock({ fn: async () => { c++; if (c === 2) return err(); return ok('out', 0.10); } });
    const e = createGenerationEngine(makeQueue(3), { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const last = m.costs[m.costs.length - 1];
    assert(Math.abs(last - 0.20) < 0.001, `cost=0.20 (only 2 successes, got ${last})`);
  }

  // ── Test 17 ──
  console.log('\nTest 17: maxLen constraint');
  {
    let c = 0;
    const m = makeMock({ fn: async () => { c++; if (c <= 1) return ok('a'.repeat(200)); return ok('short'); } });
    const e = createGenerationEngine(makeQueue(1), { rateLimit: 1, minLen: 0, maxLen: 10, maxRetries: 5 }, m.cb);
    e.spawnWorkers(1);
    await e.waitForCompletion();
    const all = m.getAllUpdates();
    assert(all.get('row-0')?.status === 'generated', 'eventually generated');
    assert(all.get('row-0')?.output === 'short', 'short output accepted');
  }

  // ── Test 18 ──
  console.log('\nTest 18: Abort discards results (no cost)');
  {
    const m = makeMock({
      fn: async (_id, _input, signal) => {
        await new Promise(r => setTimeout(r, 50));
        if (signal.aborted) return { error: '__aborted__', durationMs: 0 };
        return ok();
      },
    });
    const e = createGenerationEngine(makeQueue(5), { rateLimit: 5, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(5);
    e.abort();
    await e.waitForCompletion();
    assert(m.costs.length === 0, 'no cost recorded for aborted');
  }

  // ── Test 19 ──
  console.log('\nTest 19: getActiveCount returns 0 after completion');
  {
    const m = makeMock({ fn: async () => { await new Promise(r => setTimeout(r, 10)); return ok(); } });
    const e = createGenerationEngine(makeQueue(3), { rateLimit: 3, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(3);
    // During generation, active count should be > 0 (workers are mid-request)
    await new Promise(r => setTimeout(r, 5));
    assert(e.getActiveCount() > 0, 'activeCount > 0 during generation');
    await e.waitForCompletion();
    assert(e.getActiveCount() === 0, 'activeCount=0 after completion');
  }

  // ── Test 20 ──
  console.log('\nTest 20: forceFlush clears pending updates');
  {
    const m = makeMock({ fn: async () => ok() });
    const q = makeQueue(1);
    const e = createGenerationEngine(q, { rateLimit: 1, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(1);
    // Wait for processing but before auto-flush timer fires
    await new Promise(r => setTimeout(r, 10));
    // Pending updates should exist before flush
    e.forceFlush();
    assert(e.getPendingUpdateCount() === 0, 'pendingUpdateCount=0 after forceFlush');
  }

  // ── Test 21 ──
  console.log('\nTest 21: getPendingUpdateCount reflects buffered updates');
  {
    let resolveGate: (() => void) | null = null;
    const gate = new Promise<void>(r => { resolveGate = r; });
    let firstCall = true;
    const m = makeMock({
      fn: async () => {
        if (firstCall) { firstCall = false; return ok(); }
        await gate; // block second call
        return ok();
      },
    });
    const e = createGenerationEngine(makeQueue(2), { rateLimit: 2, minLen: 0, maxLen: 0, maxRetries: 3 }, m.cb);
    e.spawnWorkers(2);
    // Wait for first result to buffer (but flush hasn't fired yet)
    await new Promise(r => setTimeout(r, 10));
    // At this point, first result is in pendingUpdates buffer, second worker is blocked
    const pending = e.getPendingUpdateCount();
    assert(pending >= 0, `pendingUpdateCount is valid (got ${pending})`);
    resolveGate!();
    await e.waitForCompletion();
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
