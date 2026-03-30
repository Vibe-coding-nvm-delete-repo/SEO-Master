import { describe, expect, it, vi } from 'vitest';

vi.mock('./contentPipelineH2', () => ({
  UPSTREAM_PAGE_NAMES_DOC_ID: 'generate_rows_page_names',
  loadGeneratePrimaryPrompt: vi.fn(),
  parseH2NamesFromOutput: (raw: string) => raw.split('\n').map((line) => line.trim()).filter(Boolean),
}));

vi.mock('./contentPipelineSummary', () => ({
  H2_SUMMARY_ROWS_DOC_ID: 'generate_rows_h2_summary',
}));

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: vi.fn(),
}));

import {
  buildH1BodyPrompt,
  buildH1BodyRowsFromSources,
  deriveH1BodyRowId,
  mergeDerivedWithPersistedH1BodyRows,
  resolveH1BodyPromptTemplate,
} from './contentPipelineH1';

describe('contentPipelineH1', () => {
  it('builds one page-level H1 row with concatenated H2 reference data', () => {
    const rows = buildH1BodyRowsFromSources(
      [
        {
          id: 'page_1',
          status: 'generated',
          input: 'can you get installment loans',
          output: 'Can You Get Installment Loans?',
          slots: {
            h2names: { status: 'generated', input: '', output: 'What Are Installment Loans?\nHow to Qualify' },
            guidelines: { status: 'generated', input: '', output: 'Use only reliable lender context.' },
          },
        },
      ],
      [
        {
          id: 'summary_1',
          status: 'generated',
          output: 'They let you repay in fixed payments over time.',
          metadata: {
            sourceRowId: 'page_1',
            order: '1',
            h2Name: 'What Are Installment Loans?',
            h2Content: 'Installment loans spread repayment across scheduled payments.',
          },
        },
        {
          id: 'summary_2',
          status: 'generated',
          output: 'Lenders review income, credit, and payment history.',
          metadata: {
            sourceRowId: 'page_1',
            order: '2',
            h2Name: 'How to Qualify',
            h2Content: 'Qualification depends on income, credit, and lender rules.',
          },
        },
      ],
      'Keyword:{MAIN_KEYWORD}\nPage:{PAGE_NAME}\nSections:{H2_NAMES}\nBodies:{H2_CONTENT}\nContext:{CONTEXT}',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(deriveH1BodyRowId('page_1'));
    expect(rows[0].input).toContain('Keyword:can you get installment loans');
    expect(rows[0].input).toContain('Page:Can You Get Installment Loans?');
    expect(rows[0].input).toContain('What Are Installment Loans?');
    expect(rows[0].input).toContain('Installment loans spread repayment across scheduled payments.');
    expect(rows[0].input).toContain('H2 Summaries:');
    expect(rows[0].metadata.h2Summaries).toContain('How to Qualify: Lenders review income, credit, and payment history.');
  });

  it('ignores stale page-title output and stale guideline slot output when upstream status is not generated', () => {
    const rows = buildH1BodyRowsFromSources(
      [
        {
          id: 'page_stale',
          status: 'pending',
          input: 'installment loans',
          output: 'Old Page Title',
          slots: {
            h2names: { status: 'generated', input: '', output: 'Old H2' },
            guidelines: { status: 'generated', input: '', output: 'Old guideline text.' },
          },
        },
        {
          id: 'page_live',
          status: 'generated',
          input: 'installment loans',
          output: 'Fresh Page Title',
          slots: {
            h2names: { status: 'generated', input: '', output: 'Fresh H2' },
            guidelines: { status: 'pending', input: '', output: 'Stale guideline text.' },
          },
        },
      ],
      [
        {
          id: 'summary_1',
          status: 'generated',
          output: 'Summary text.',
          metadata: {
            sourceRowId: 'page_stale',
            order: '1',
            h2Name: 'Old H2',
            h2Content: 'Old content.',
          },
        },
        {
          id: 'summary_2',
          status: 'generated',
          output: 'Fresh summary.',
          metadata: {
            sourceRowId: 'page_live',
            order: '1',
            h2Name: 'Fresh H2',
            h2Content: 'Fresh content.',
          },
        },
      ],
      'Page:{PAGE_NAME}\nContext:{CONTEXT}',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.pageName).toBe('Fresh Page Title');
    expect(rows[0].input).toContain('Page:Fresh Page Title');
    expect(rows[0].input).not.toContain('Old Page Title');
    expect(rows[0].metadata.context).toBe('H2 Summaries:\nFresh H2: Fresh summary.');
    expect(rows[0].input).not.toContain('Stale guideline text.');
  });

  it('reuses persisted h1 output only when source aggregates are unchanged', () => {
    const merged = mergeDerivedWithPersistedH1BodyRows(
      [
        {
          id: 'h1_page_1',
          status: 'pending',
          input: 'Prompt A',
          output: '',
          metadata: {
            h2Name: 'A',
            h2Content: 'B',
            h2Summaries: 'C',
            context: 'D',
          },
        },
        {
          id: 'h1_page_2',
          status: 'pending',
          input: 'Prompt B',
          output: '',
          metadata: {
            h2Name: 'A2',
            h2Content: 'B2',
            h2Summaries: 'C2',
            context: 'D2',
          },
        },
      ],
      [
        {
          id: 'h1_page_1',
          status: 'generated',
          input: 'Prompt A',
          output: 'Reusable intro',
          metadata: {
            h2Name: 'A',
            h2Content: 'B',
            h2Summaries: 'C',
            context: 'D',
          },
        },
        {
          id: 'h1_page_2',
          status: 'generated',
          input: 'Old Prompt B',
          output: 'Stale intro',
          metadata: {
            h2Name: 'A2',
            h2Content: 'OLD',
            h2Summaries: 'C2',
            context: 'D2',
          },
        },
      ],
    );

    expect(merged[0].output).toBe('Reusable intro');
    expect(merged[0].status).toBe('generated');
    expect(merged[1].output).toBe('');
    expect(merged[1].status).toBe('pending');
  });

  it('falls back to bundled h1 prompt when the saved one is blank', () => {
    expect(resolveH1BodyPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('replaces all h1 prompt tokens', () => {
    const prompt = buildH1BodyPrompt('{MAIN_KEYWORD}|{PAGE_NAME}|{H2_NAMES}|{H2_CONTENT}|{H2_SUMMARIES}|{CONTEXT}', {
      mainKeyword: 'kw',
      pageName: 'page',
      h2Names: 'names',
      h2Content: 'content',
      h2Summaries: 'summaries',
      context: 'ctx',
    });

    expect(prompt).toBe('kw|page|names|content|summaries|ctx');
  });
});
