import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadGeneratePrimaryPrompt, mockLoadChunkedAppSettingsRows } = vi.hoisted(() => ({
  mockLoadGeneratePrimaryPrompt: vi.fn(),
  mockLoadChunkedAppSettingsRows: vi.fn(),
}));

vi.mock('./contentPipelineH2', () => ({
  loadGeneratePrimaryPrompt: mockLoadGeneratePrimaryPrompt,
}));

vi.mock('./contentPipelineMetasSlugCtas', () => ({
  METAS_SLUG_CTAS_ROWS_DOC_ID: 'generate_rows_metas_slug_ctas',
}));

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: mockLoadChunkedAppSettingsRows,
}));

import {
  buildKeyTakeawaysPrompt,
  buildProTipPrompt,
  buildRedFlagPrompt,
  buildTipsRedflagsRowsFromFirestore,
  buildTipsRedflagsRowsFromSource,
  mergeDerivedWithPersistedTipsRedflagsRows,
  resolveTipsRedflagsPromptTemplate,
} from './contentPipelineTipsRedflags';

describe('contentPipelineTipsRedflags', () => {
  beforeEach(() => {
    mockLoadGeneratePrimaryPrompt.mockReset();
    mockLoadChunkedAppSettingsRows.mockReset();
  });

  it('builds page-level rows from metas rows using combined h2 summaries as context', () => {
    const rows = buildTipsRedflagsRowsFromSource(
      [
        {
          id: 'meta_html_quick_h1_1',
          metadata: {
            pageName: 'Can You Get Installment Loans With Bad Credit',
            order: '1',
            h2Name: 'What Are Installment Loans',
            h2Content: 'Installment loans let you borrow a lump sum.',
            h2Summaries: 'What Are Installment Loans: Fixed payments spread repayment over time.',
            metaTitle: 'Can You Get Installment Loans With Bad Credit',
            slug: 'can-you-get-installment-loans-with-bad-credit',
            ctaHeadline: 'Check your credit before you apply',
            ctaBody: 'Start with a free look at your credit before you borrow.',
            ratingScore: '5',
            contentGuidelines: 'Keep the opening direct.',
            sourceRowId: 'page-1',
          },
        },
      ],
      'Tip {PAGE_NAME} :: {ARTICLE_CONTEXT}',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].input).toContain('Tip Can You Get Installment Loans With Bad Credit');
    expect(rows[0].input).toContain('What Are Installment Loans: Fixed payments spread repayment over time.');
    expect(rows[0].metadata.slug).toBe('can-you-get-installment-loans-with-bad-credit');
    expect(rows[0].metadata.order).toBe('1');
    expect(rows[0].metadata.ratingScore).toBe('5');
    expect(rows[0].metadata.contentGuidelines).toBe('Keep the opening direct.');
  });

  it('replaces prompt tokens for all three prompts', () => {
    expect(buildProTipPrompt('{PAGE_NAME}|{ARTICLE_CONTEXT}', {
      pageName: 'Page A',
      articleContext: 'Context A',
    })).toBe('Page A|Context A');
    expect(buildRedFlagPrompt('{PAGE_NAME}|{ARTICLE_CONTEXT}', {
      pageName: 'Page A',
      articleContext: 'Context A',
    })).toBe('Page A|Context A');
    expect(buildKeyTakeawaysPrompt('{PAGE_NAME}|{ARTICLE_CONTEXT}', {
      pageName: 'Page A',
      articleContext: 'Context A',
    })).toBe('Page A|Context A');
  });

  it('reuses persisted outputs only when the upstream page context is unchanged', () => {
    const merged = mergeDerivedWithPersistedTipsRedflagsRows(
      [
        {
          id: 'tip_meta_html_quick_h1_1',
          status: 'pending',
          input: 'Tip',
          output: '',
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
          },
        },
        {
          id: 'tip_meta_html_quick_h1_2',
          status: 'pending',
          input: 'Tip 2',
          output: '',
          metadata: {
            pageName: 'Page B',
            h2Name: 'H2',
            h2Content: 'New Body',
            h2Summaries: 'Summary',
          },
        },
      ],
      [
        {
          id: 'tip_meta_html_quick_h1_1',
          status: 'generated',
          input: 'Tip',
          output: 'Helpful tip.',
          slots: {
            redflag: { status: 'generated', output: 'Warning.' },
            keytakeaways: { status: 'generated', output: 'Takeaway.' },
          },
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
          },
        },
        {
          id: 'tip_meta_html_quick_h1_2',
          status: 'generated',
          input: 'Old Tip 2',
          output: 'Old output',
          metadata: {
            pageName: 'Page B',
            h2Name: 'H2',
            h2Content: 'Old Body',
            h2Summaries: 'Summary',
          },
        },
      ],
    );

    expect(merged[0].output).toBe('Helpful tip.');
    expect(merged[0].slots?.redflag?.output).toBe('Warning.');
    expect(merged[0].slots?.keytakeaways?.output).toBe('Takeaway.');
    expect(merged[1].output).toBe('');
    expect(merged[1].slots).toBeUndefined();
  });

  it('downgrades blank generated pro-tip output while preserving reusable slot outputs', () => {
    const merged = mergeDerivedWithPersistedTipsRedflagsRows(
      [
        {
          id: 'tip_meta_html_quick_h1_1',
          status: 'pending',
          input: 'Tip',
          output: '',
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
          },
        },
      ],
      [
        {
          id: 'tip_meta_html_quick_h1_1',
          status: 'generated',
          input: 'Tip',
          output: '   ',
          slots: {
            redflag: { status: 'generated', output: 'Warning.' },
            keytakeaways: { status: 'generated', output: 'Takeaway.' },
          },
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
          },
        },
      ],
    );

    expect(merged[0].status).toBe('pending');
    expect(merged[0].output).toBe('   ');
    expect(merged[0].slots?.redflag?.output).toBe('Warning.');
    expect(merged[0].slots?.keytakeaways?.output).toBe('Takeaway.');
  });

  it('falls back to the bundled prompt when the saved prompt is blank', () => {
    expect(resolveTipsRedflagsPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('builds firestore rows with the fallback prompt and reusable persisted state', async () => {
    mockLoadGeneratePrimaryPrompt.mockResolvedValue('   ');
    mockLoadChunkedAppSettingsRows.mockImplementation(async (docId: string) => {
      if (docId === 'generate_rows_metas_slug_ctas') {
        return [
          {
            id: 'meta_html_quick_h1_1',
            status: 'generated',
            output: 'Meta description text',
            metadata: {
              pageName: 'Page A',
              h2Name: 'H2',
              h2Content: 'Body',
              h2Summaries: 'Summary',
              metaTitle: 'Page A',
              slug: 'page-a',
              ctaHeadline: 'Head',
              ctaBody: 'Body',
              sourceRowId: 'page-1',
            },
          },
        ];
      }
      if (docId === 'generate_rows_tips_redflags') {
        return [
          {
            id: 'tip_meta_html_quick_h1_1',
            status: 'generated',
            input: 'Fallback Page A :: Summary',
            output: 'Helpful tip.',
            metadata: {
              pageName: 'Page A',
              h2Name: 'H2',
              h2Content: 'Body',
              h2Summaries: 'Summary',
            },
            slots: {
              redflag: { status: 'generated', output: 'Warning.' },
              keytakeaways: { status: 'generated', output: 'Takeaway.' },
            },
          },
        ];
      }
      return [];
    });

    const rows = await buildTipsRedflagsRowsFromFirestore({
      settingsDocId: 'generate_settings_tips_redflags',
      fallbackPrompt: 'Fallback {PAGE_NAME} :: {ARTICLE_CONTEXT}',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].input).toBe('Fallback Page A :: Summary');
    expect(rows[0].status).toBe('generated');
    expect(rows[0].output).toBe('Helpful tip.');
    expect(rows[0].slots?.redflag?.output).toBe('Warning.');
    expect(rows[0].slots?.keytakeaways?.output).toBe('Takeaway.');
    expect(rows[0].metadata.sourceRowId).toBe('page-1');
  });
});
