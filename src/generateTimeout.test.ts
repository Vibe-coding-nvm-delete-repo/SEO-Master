import { describe, expect, it } from 'vitest';

import { applyPrimaryInputEdit, buildGenerateTimeoutError, resolveGenerateAbortError } from './GenerateTab';
import { hasActiveGeneration } from './GenerateTab';
import { buildPrimaryGenerationStats, buildSlotGenerationStats, selectActiveGenerationSource } from './GenerateTab';

describe('generate request timeout handling', () => {
  it('returns a visible timeout error for stalled provider requests', () => {
    expect(buildGenerateTimeoutError(60000)).toContain('Request timed out after 60s');
  });

  it('treats parent aborts as user stop, not timeout', () => {
    expect(resolveGenerateAbortError({
      parentAborted: true,
      timedOut: false,
      timeoutMs: 60000,
    })).toBe('__aborted__');
  });

  it('treats timed out requests as row errors so workers can drain', () => {
    expect(resolveGenerateAbortError({
      parentAborted: false,
      timedOut: true,
      timeoutMs: 60000,
    })).toContain('Request timed out after 60s');
  });

  it('treats slot generation as active so timeout-driven slot workers still keep the stop state visible', () => {
    expect(hasActiveGeneration(false, { slug: true, ctas: false })).toBe(true);
  });

  it('uses the active slot as the summary source while slot generation is running', () => {
    expect(selectActiveGenerationSource({
      isPrimaryGenerating: false,
      slotGeneratingState: { slug: true, ctas: false },
      promptSlotIds: ['slug', 'ctas'],
      tableView: 'primary',
    })).toBe('slug');
  });

  it('falls back to the selected slot view when idle', () => {
    expect(selectActiveGenerationSource({
      isPrimaryGenerating: false,
      slotGeneratingState: { slug: false, ctas: false },
      promptSlotIds: ['slug', 'ctas'],
      tableView: 'ctas',
    })).toBe('ctas');
  });

  it('builds primary stats from primary row state only', () => {
    expect(buildPrimaryGenerationStats([
      { id: '1', status: 'generated', input: 'a', output: 'ok', cost: 0.1, promptTokens: 10, completionTokens: 20 },
      { id: '2', status: 'pending', input: 'b', output: '', cost: 0, promptTokens: 0, completionTokens: 0 },
      { id: '3', status: 'error', input: '', output: '', cost: 0.2, promptTokens: 1, completionTokens: 2 },
    ])).toMatchObject({
      totalRows: 2,
      generatedCount: 1,
      pendingCount: 1,
      errorCount: 1,
      queuedCount: 1,
      totalCost: 0.30000000000000004,
      totalPromptTokens: 11,
      totalCompletionTokens: 22,
    });
  });

  it('builds slot stats from slot state and slot input only', () => {
    expect(buildSlotGenerationStats([
      {
        id: '1',
        status: 'generated',
        input: 'meta',
        output: 'meta out',
        slots: {
          slug: { status: 'generated', input: 'slug in', output: 'slug-out', cost: 0.01, promptTokens: 3, completionTokens: 4 },
        },
      },
      {
        id: '2',
        status: 'generated',
        input: 'meta2',
        output: 'meta out 2',
        slots: {
          slug: { status: 'pending', input: 'slug in 2', output: '' },
        },
      },
      {
        id: '3',
        status: 'generated',
        input: 'meta3',
        output: 'meta out 3',
        slots: {
          slug: { status: 'error', input: '', output: '', cost: 0.02, promptTokens: 5, completionTokens: 6 },
        },
      },
    ], 'slug')).toMatchObject({
      totalRows: 2,
      generatedCount: 1,
      pendingCount: 1,
      errorCount: 1,
      queuedCount: 1,
      totalCost: 0.03,
      totalPromptTokens: 8,
      totalCompletionTokens: 10,
    });
  });

  it('resets edited primary rows back into the generate queue and clears stale downstream data', () => {
    const edited = applyPrimaryInputEdit(
      {
        id: '1',
        status: 'generated',
        input: 'old page',
        output: 'old output',
        error: 'stale',
        generatedAt: '2026-03-30T12:00:00.000Z',
        durationMs: 1200,
        retries: 2,
        promptTokens: 10,
        completionTokens: 20,
        cost: 0.25,
        metadata: {
          keep: 'yes',
          primaryReset: 'drop',
          slotReset: 'drop-too',
        },
        slots: {
          guidelines: {
            status: 'generated',
            input: 'stale slot input',
            output: 'stale slot output',
            error: 'stale slot error',
            generatedAt: '2026-03-30T12:00:01.000Z',
            durationMs: 500,
            retries: 1,
            promptTokens: 2,
            completionTokens: 3,
            cost: 0.05,
          },
        },
      },
      'new page',
      ['primaryReset'],
      [{ id: 'guidelines', label: 'Guidelines', promptLabel: 'Guidelines', defaultPrompt: '', clearMetadataKeysOnReset: ['slotReset'] }],
    );

    expect(edited).toMatchObject({
      id: '1',
      status: 'pending',
      input: 'new page',
      output: '',
      error: undefined,
      generatedAt: undefined,
      durationMs: undefined,
      retries: undefined,
      promptTokens: undefined,
      completionTokens: undefined,
      cost: undefined,
      metadata: { keep: 'yes' },
      slots: {
        guidelines: {
          status: 'pending',
          input: '',
          output: '',
        },
      },
    });
    expect(buildPrimaryGenerationStats([edited]).queuedCount).toBe(1);
  });
});
