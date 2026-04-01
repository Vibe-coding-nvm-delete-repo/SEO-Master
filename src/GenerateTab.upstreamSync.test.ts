import { afterEach, describe, expect, it, vi } from 'vitest';

import { awaitPersistWithTimeout, classifyRowsSnapshotHandling, getExtraColumnValue, hasActiveGeneration, resolveGenerateControlModeFromPhase, shouldDiscardGenerationResult, shouldSkipEquivalentUpstreamApply, shouldSkipUpstreamEmptyApply, waitForDelayOrAbort } from './GenerateTab';

function makeRow(partial: Partial<{ id: string; input: string; output: string; status: string }> = {}) {
  return {
    id: partial.id ?? 'r1',
    input: partial.input ?? '',
    output: partial.output ?? '',
    status: partial.status ?? 'pending',
  };
}

describe('GenerateTab upstream empty guards', () => {
  it('skips empty upstream when local rows still have synced inputs', () => {
    expect(shouldSkipUpstreamEmptyApply([], [makeRow({ input: 'title one' })] as any)).toBe(true);
  });

  it('allows empty upstream when local rows are truly empty', () => {
    expect(shouldSkipUpstreamEmptyApply([], [makeRow(), makeRow({ id: 'r2' })] as any)).toBe(false);
  });

  it('skips equivalent upstream inputs when current rows already contain accepted output', () => {
    expect(shouldSkipEquivalentUpstreamApply(
      [makeRow({ id: 'r1', input: 'same prompt', status: 'pending' })] as any,
      [makeRow({ id: 'r1', input: 'same prompt', status: 'generated', output: 'accepted output' })] as any,
    )).toBe(true);
  });

  it('does not skip equivalent upstream inputs when current rows are still plain pending rows', () => {
    expect(shouldSkipEquivalentUpstreamApply(
      [makeRow({ id: 'r1', input: 'same prompt', status: 'pending' })] as any,
      [makeRow({ id: 'r1', input: 'same prompt', status: 'pending', output: '' })] as any,
    )).toBe(false);
  });

  it('does not skip upstream apply when the derived input changed', () => {
    expect(shouldSkipEquivalentUpstreamApply(
      [makeRow({ id: 'r1', input: 'new prompt', status: 'pending' })] as any,
      [makeRow({ id: 'r1', input: 'old prompt', status: 'generated', output: 'accepted output' })] as any,
    )).toBe(false);
  });
});

describe('GenerateTab upstream sync guard', () => {
  it('treats primary generation as active', () => {
    expect(hasActiveGeneration(true, {})).toBe(true);
  });

  it('treats any slot generation as active', () => {
    expect(hasActiveGeneration(false, { summary: false, html: true })).toBe(true);
  });

  it('allows upstream sync only when nothing is generating', () => {
    expect(hasActiveGeneration(false, { summary: false, html: false })).toBe(false);
    expect(hasActiveGeneration(false, {})).toBe(false);
  });
});

describe('GenerateTab extra column values', () => {
  it('derives the H2 preview column from the H2 slot output', () => {
    expect(
      getExtraColumnValue(
        {
          metadata: {},
          slots: {
            h2names: {
              output: JSON.stringify({
                h2s: [
                  { order: 1, h2: 'What Is an Installment Loan?' },
                  { order: 2, h2: 'How Do Payments Work?' },
                ],
              }),
            },
          },
        },
        'h2NamesPreview',
      ),
    ).toBe('What Is an Installment Loan? | How Do Payments Work?');
  });

  it('falls back to row metadata for normal extra columns', () => {
    expect(
      getExtraColumnValue(
        {
          metadata: { pageGuideJsonStatus: 'Pass' },
        },
        'pageGuideJsonStatus',
      ),
    ).toBe('Pass');
  });
});

describe('GenerateTab row snapshot handling', () => {
  it('ignores echoes for the last row write even if generation is idle', () => {
    expect(classifyRowsSnapshotHandling({
      incomingUpdatedAt: '2026-03-30T00:00:00.000Z',
      lastWrittenAt: '2026-03-30T00:00:00.000Z',
      latestKnownUpdatedAt: '',
      isPrimaryGenerating: false,
      slotGeneratingState: {},
    })).toBe('ignore');
  });

  it('ignores stale row snapshots that arrive after a newer local version is known', () => {
    expect(classifyRowsSnapshotHandling({
      incomingUpdatedAt: '2026-03-30T00:00:00.000Z',
      lastWrittenAt: '2026-03-30T00:00:02.000Z',
      latestKnownUpdatedAt: '2026-03-30T00:00:02.000Z',
      isPrimaryGenerating: false,
      slotGeneratingState: {},
      hasResolvedCurrentRows: true,
    })).toBe('ignore');
  });

  it('still applies a stale-looking snapshot when local rows only contain pending derived input', () => {
    expect(classifyRowsSnapshotHandling({
      incomingUpdatedAt: '2026-03-30T00:00:00.000Z',
      lastWrittenAt: '2026-03-30T00:00:02.000Z',
      latestKnownUpdatedAt: '2026-03-30T00:00:02.000Z',
      isPrimaryGenerating: false,
      slotGeneratingState: {},
      hasResolvedCurrentRows: false,
    })).toBe('apply');
  });

  it('defers foreign row snapshots while any generation is active', () => {
    expect(classifyRowsSnapshotHandling({
      incomingUpdatedAt: '2026-03-30T00:00:02.000Z',
      lastWrittenAt: '2026-03-30T00:00:01.000Z',
      latestKnownUpdatedAt: '',
      isPrimaryGenerating: true,
      slotGeneratingState: {},
      hasResolvedCurrentRows: false,
    })).toBe('defer');
  });

  it('applies row snapshots only when idle and not echoing the latest write', () => {
    expect(classifyRowsSnapshotHandling({
      incomingUpdatedAt: '2026-03-30T00:00:02.000Z',
      lastWrittenAt: '2026-03-30T00:00:01.000Z',
      latestKnownUpdatedAt: '2026-03-30T00:00:01.500Z',
      isPrimaryGenerating: false,
      slotGeneratingState: { summary: false },
      hasResolvedCurrentRows: false,
    })).toBe('apply');
  });
});

describe('GenerateTab stop guards', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards generation results after stop is requested', () => {
    expect(shouldDiscardGenerationResult({
      stopRequested: true,
      signalAborted: false,
    })).toBe(true);
  });

  it('discards generation results after the request signal aborts', () => {
    expect(shouldDiscardGenerationResult({
      stopRequested: false,
      signalAborted: true,
    })).toBe(true);
  });

  it('keeps generation results only when the run is still active', () => {
    expect(shouldDiscardGenerationResult({
      stopRequested: false,
      signalAborted: false,
    })).toBe(false);
  });

  it('cancels retry backoff immediately when the signal aborts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waitPromise = waitForDelayOrAbort(5_000, controller.signal);
    controller.abort();
    await vi.runAllTimersAsync();
    await expect(waitPromise).resolves.toBe(false);
  });
});

describe('GenerateTab explicit run phases', () => {
  it('shows generate when the run is fully idle', () => {
    expect(resolveGenerateControlModeFromPhase('idle')).toBe('generate');
  });

  it('shows saving during the bounded final persistence phase', () => {
    expect(resolveGenerateControlModeFromPhase('persisting')).toBe('saving');
  });

  it('shows stop while a run is actively executing or stopping', () => {
    expect(resolveGenerateControlModeFromPhase('running')).toBe('stop');
    expect(resolveGenerateControlModeFromPhase('stopping')).toBe('stop');
  });
});

describe('GenerateTab bounded final persistence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times out slow final persistence so the UI can be released', async () => {
    vi.useFakeTimers();
    const persist = vi.fn(() => new Promise<void>(() => undefined));
    const resultPromise = awaitPersistWithTimeout(persist, 250);

    await vi.advanceTimersByTimeAsync(250);

    await expect(resultPromise).resolves.toEqual({ timedOut: true, error: null });
  });

  it('returns errors from the final persistence step when they happen before the timeout', async () => {
    const result = await awaitPersistWithTimeout(async () => {
      throw new Error('persist failed');
    }, 250);

    expect(result.timedOut).toBe(false);
    expect(result.error?.message).toBe('persist failed');
  });
});
