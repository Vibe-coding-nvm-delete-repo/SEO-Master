import { describe, expect, it, vi } from 'vitest';

vi.mock('./contentPipelineH2', () => ({
  H2_CONTENT_ROWS_DOC_ID: 'generate_rows_h2_content',
  loadGeneratePrimaryPrompt: vi.fn(),
}));

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: vi.fn(),
}));

import {
  buildSummaryPrompt,
  buildSummaryRowsFromH2Rows,
  deriveSummaryRowId,
  mergeDerivedWithPersistedSummaryRows,
  resolveSummaryPromptTemplate,
} from './contentPipelineSummary';

describe('contentPipelineSummary', () => {
  it('builds summary prompts from generated h2 rows', () => {
    const rows = buildSummaryRowsFromH2Rows(
      [
        {
          id: 'h2_1',
          status: 'generated',
          output: '<answer>Installment loans spread repayment across fixed payments.</answer>',
          metadata: {
            pageName: 'Installment Loans Guide',
            h2Name: 'What Are Installment Loans?',
            order: '1',
            ratingScore: '5',
            contentGuidelines: 'Keep the explanation concrete.',
            sourceRowId: 'page_1',
          },
        },
      ],
      'Page: {PAGE_NAME}\nH2: {H2_NAME}\nBody: {H2_CONTENT}',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(deriveSummaryRowId('h2_1'));
    expect(rows[0].input).toContain('Installment Loans Guide');
    expect(rows[0].input).toContain('What Are Installment Loans?');
    expect(rows[0].input).toContain('Installment loans spread repayment across fixed payments.');
    expect(rows[0].metadata.ratingScore).toBe('5');
    expect(rows[0].metadata.contentGuidelines).toBe('Keep the explanation concrete.');
  });

  it('skips summary rows that lost the required canonical h2 context', () => {
    const rows = buildSummaryRowsFromH2Rows(
      [
        {
          id: 'h2_1',
          status: 'generated',
          output: '<answer>Installment loans spread repayment across fixed payments.</answer>',
          metadata: { pageName: 'Installment Loans Guide', h2Name: 'What Are Installment Loans?' },
        },
      ],
      'Page: {PAGE_NAME}\nH2: {H2_NAME}\nBody: {H2_CONTENT}',
    );

    expect(rows).toEqual([]);
  });

  it('reuses persisted summaries only when the source h2 content is unchanged', () => {
    const merged = mergeDerivedWithPersistedSummaryRows(
      [
        {
          id: 'summary_h2_1',
          status: 'pending',
          input: 'Prompt A',
          output: '',
          metadata: { h2Content: 'Fresh body' },
        },
        {
          id: 'summary_h2_2',
          status: 'pending',
          input: 'Prompt B',
          output: '',
          metadata: { h2Content: 'New body' },
        },
      ],
      [
        {
          id: 'summary_h2_1',
          status: 'generated',
          input: 'Prompt A',
          output: 'Reusable summary',
          metadata: { h2Content: 'Fresh body' },
        },
        {
          id: 'summary_h2_2',
          status: 'generated',
          input: 'Old Prompt B',
          output: 'Stale summary',
          metadata: { h2Content: 'Old body' },
        },
      ],
    );

    expect(merged[0].output).toBe('Reusable summary');
    expect(merged[0].status).toBe('generated');
    expect(merged[1].output).toBe('');
    expect(merged[1].status).toBe('pending');
  });

  it('falls back to the bundled summary prompt when the saved one is blank', () => {
    expect(resolveSummaryPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('replaces all summary prompt tokens', () => {
    const prompt = buildSummaryPrompt('A {PAGE_NAME} / {H2_NAME} / {H2_CONTENT}', {
      pageName: 'Page',
      h2Name: 'Heading',
      h2Content: 'Body',
    });

    expect(prompt).toBe('A Page / Heading / Body');
  });
});
