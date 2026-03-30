import { describe, expect, it } from 'vitest';

import {
  H2_CONTENT_DEFAULT_PROMPT,
  PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
  PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT,
} from './ContentTab';
import {
  normalizeGeneratePromptPolicy,
  resetPageGuideRowsForPolicyMigration,
  type PromptSlotConfig,
} from './GenerateTab';

const buildGuideSlot = (): PromptSlotConfig => ({
  id: 'guidelines',
  label: 'Page Guide',
  promptLabel: 'Page Guide',
  defaultPrompt: PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
  validatorLabel: 'Page Guide JSON Contract',
  defaultValidator: PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT,
  clearMetadataKeysOnReset: ['pageGuideJsonStatus'],
  buildInput: (template, pageNameOutput, externalData) => ({
    input: `PAGE_GUIDE::${pageNameOutput}::${externalData?.h2Names?.join(' | ') ?? ''}::${template.slice(0, 24)}`,
  }),
});

describe('generate prompt policy normalization', () => {
  it('replaces stale page guide prompts that are missing the no-table policy', () => {
    const normalized = normalizeGeneratePromptPolicy({
      storageKey: '_page_names',
      defaultPrompt: 'Primary page prompt',
      promptSlots: [buildGuideSlot()],
      slotPrompts: {
        guidelines: 'Return ONLY one valid JSON object with "guidelines". Use a comparison chart or table when useful.',
      },
      slotValidators: {
        guidelines: PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT,
      },
    });

    expect(normalized.slotPrompts.guidelines).toBe(PAGE_GUIDELINES_DEFAULT_PROMPT_V2);
    expect(normalized.didMigratePromptPolicy).toBe(true);
    expect(normalized.didMigratePageGuidePrompt).toBe(true);
  });

  it('replaces stale h2 body prompts that are missing the no-table policy', () => {
    const normalized = normalizeGeneratePromptPolicy({
      storageKey: '_h2_content',
      defaultPrompt: H2_CONTENT_DEFAULT_PROMPT,
      promptSlots: [],
      prompt: 'Write the answer in whatever format is clearest, including tables when useful.',
    });

    expect(normalized.prompt).toBe(H2_CONTENT_DEFAULT_PROMPT);
    expect(normalized.didMigratePromptPolicy).toBe(true);
    expect(normalized.didMigratePageGuidePrompt).toBe(false);
  });

  it('replaces stale page guide validator text that is missing the no-table policy', () => {
    const normalized = normalizeGeneratePromptPolicy({
      storageKey: '_page_names',
      defaultPrompt: 'Primary page prompt',
      promptSlots: [buildGuideSlot()],
      slotPrompts: {
        guidelines: PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
      },
      slotValidators: {
        guidelines: 'Return one JSON object with a guidelines array.',
      },
    });

    expect(normalized.slotValidators.guidelines).toBe(PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT);
    expect(normalized.didMigratePromptPolicy).toBe(true);
  });

  it('preserves up-to-date prompts and validators', () => {
    const normalized = normalizeGeneratePromptPolicy({
      storageKey: '_page_names',
      defaultPrompt: 'Primary page prompt',
      promptSlots: [buildGuideSlot()],
      slotPrompts: {
        guidelines: PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
      },
      slotValidators: {
        guidelines: PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT,
      },
    });

    expect(normalized.slotPrompts.guidelines).toBe(PAGE_GUIDELINES_DEFAULT_PROMPT_V2);
    expect(normalized.slotValidators.guidelines).toBe(PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT);
    expect(normalized.didMigratePromptPolicy).toBe(false);
    expect(normalized.didMigratePageGuidePrompt).toBe(false);
  });
});

describe('page guide prompt policy reset', () => {
  it('resets generated page guide slot rows to pending and clears guide validation metadata', () => {
    const guideSlot = buildGuideSlot();
    const rows: Parameters<typeof resetPageGuideRowsForPolicyMigration>[0]['rows'] = [
      {
        id: 'row-1',
        status: 'generated',
        input: 'installment loans',
        output: 'Can You Get Installment Loans?',
        metadata: {
          keep: 'yes',
          pageGuideJsonStatus: 'Pass',
        },
        slots: {
          h2names: {
            status: 'generated',
            input: '',
            output: '1. What Are Installment Loans?\n2. When Do They Make Sense?',
          },
          guidelines: {
            status: 'generated',
            input: 'stale page guide input',
            output: '{"guidelines":[{"h2":"What Are Installment Loans?","guidelines":"old","formatting":"comparison table"}]}',
            error: 'stale error',
            generatedAt: '2026-03-30T00:00:00.000Z',
            durationMs: 120,
            retries: 1,
            promptTokens: 10,
            completionTokens: 20,
            cost: 0.12,
          },
        },
      },
    ];

    const next = resetPageGuideRowsForPolicyMigration({
      rows,
      storageKey: '_page_names',
      promptSlots: [guideSlot],
      slotPrompts: {
        guidelines: PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
      },
    });

    expect(next[0].metadata).toEqual({ keep: 'yes' });
    expect(next[0].slots?.h2names).toMatchObject({
      status: 'generated',
      output: '1. What Are Installment Loans?\n2. When Do They Make Sense?',
    });
    expect(next[0].slots?.guidelines).toMatchObject({
      status: 'pending',
      output: '',
    });
    expect(next[0].slots?.guidelines?.input).toContain('PAGE_GUIDE::Can You Get Installment Loans?');
    expect(next[0].slots?.guidelines?.input).toContain('What Are Installment Loans? | When Do They Make Sense?');
  });
});
