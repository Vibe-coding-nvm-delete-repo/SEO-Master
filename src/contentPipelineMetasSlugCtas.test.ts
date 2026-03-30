import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadGeneratePrimaryPrompt, mockLoadChunkedAppSettingsRows } = vi.hoisted(() => ({
  mockLoadGeneratePrimaryPrompt: vi.fn(),
  mockLoadChunkedAppSettingsRows: vi.fn(),
}));

vi.mock('./contentPipelineH2', () => ({
  loadGeneratePrimaryPrompt: mockLoadGeneratePrimaryPrompt,
}));

vi.mock('./contentPipelineQuickAnswerHtml', () => ({
  QUICK_ANSWER_HTML_ROWS_DOC_ID: 'generate_rows_quick_answer_html',
}));

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: mockLoadChunkedAppSettingsRows,
}));

import {
  buildCtaPrompt,
  buildMetasSlugCtasRowsFromFirestore,
  buildMetaDescriptionPrompt,
  buildMetasSlugCtasRowsFromSource,
  buildSlugPrompt,
  mergeDerivedWithPersistedMetasSlugCtasRows,
  parseCtaJsonOutput,
  resolveMetasSlugCtasPromptTemplate,
} from './contentPipelineMetasSlugCtas';

describe('contentPipelineMetasSlugCtas', () => {
  beforeEach(() => {
    mockLoadGeneratePrimaryPrompt.mockReset();
    mockLoadChunkedAppSettingsRows.mockReset();
  });

  it('builds page-level rows from generated quick answer html', () => {
    const rows = buildMetasSlugCtasRowsFromSource(
      [
        {
          id: 'html_quick_h1_1',
          status: 'generated',
          output: '<p>Use this guide to compare options before you apply.</p>',
          metadata: {
            pageName: 'Can You Get Installment Loans With Bad Credit',
            order: '1',
            h2Name: 'What Are Installment Loans',
            h2Content: 'Installment loans let you borrow a lump sum.',
            h2Summaries: 'Installment loans spread repayment over fixed payments.',
            h1Body: 'You can compare lenders and terms before you borrow.',
            quickAnswer: 'You can compare lenders and terms before you borrow.',
            ratingScore: '5',
            contentGuidelines: 'Keep the opening direct.',
            sourceRowId: 'page-1',
          },
        },
      ],
      'Meta for {PAGE_NAME}',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].input).toBe('Meta for Can You Get Installment Loans With Bad Credit');
    expect(rows[0].metadata.metaTitle).toBe('Can You Get Installment Loans With Bad Credit');
    expect(rows[0].metadata.quickAnswerHtml).toContain('<p>');
    expect(rows[0].metadata.order).toBe('1');
    expect(rows[0].metadata.ratingScore).toBe('5');
    expect(rows[0].metadata.contentGuidelines).toBe('Keep the opening direct.');
  });

  it('builds prompt strings from page-level metadata tokens', () => {
    expect(buildMetaDescriptionPrompt('Meta {PAGE_NAME}', { pageName: 'Page A' })).toBe('Meta Page A');
    expect(buildSlugPrompt('Slug {PAGE_NAME} / {REFERENCE_CONTEXT}', {
      pageName: 'Page A',
      referenceContext: '<p>Context</p>',
    })).toBe('Slug Page A / <p>Context</p>');
    expect(buildCtaPrompt('CTA {PAGE_NAME}', { pageName: 'Page A' })).toBe('CTA Page A');
  });

  it('parses CTA JSON into separate headline and body fields', () => {
    expect(parseCtaJsonOutput('{"headline":"Check your credit before you apply","body":"See where your score stands first. Call for a free credit review to map your next steps."}')).toEqual({
      headline: 'Check your credit before you apply',
      body: 'See where your score stands first. Call for a free credit review to map your next steps.',
    });
  });

  it('fails invalid CTA JSON payloads', () => {
    expect(() => parseCtaJsonOutput('not json')).toThrow('CTA JSON output was invalid.');
    expect(() => parseCtaJsonOutput('{"headline":"Only headline"}')).toThrow('CTA JSON is missing required string field "body".');
  });

  it('reuses persisted primary output, slots, and parsed metadata when upstream source is unchanged', () => {
    const merged = mergeDerivedWithPersistedMetasSlugCtasRows(
      [
        {
          id: 'meta_html_quick_h1_1',
          status: 'pending',
          input: 'Meta for Page A',
          output: '',
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
            h1Body: 'H1',
            quickAnswer: 'Quick',
            quickAnswerHtml: '<p>Quick</p>',
            metaTitle: 'Page A',
          },
        },
      ],
      [
        {
          id: 'meta_html_quick_h1_1',
          status: 'generated',
          input: 'Meta for Page A',
          output: 'Meta description text',
          slots: {
            slug: { status: 'generated', output: 'page-a' },
            cta: { status: 'generated', output: '{"headline":"Head","body":"Body"}' },
          },
          metadata: {
            pageName: 'Page A',
            quickAnswer: 'Quick',
            quickAnswerHtml: '<p>Quick</p>',
            h1Body: 'H1',
            slug: 'page-a',
            ctaHeadline: 'Head',
            ctaBody: 'Body',
          },
        },
      ],
    );

    expect(merged[0].output).toBe('Meta description text');
    expect(merged[0].slots?.slug?.output).toBe('page-a');
    expect(merged[0].metadata.slug).toBe('page-a');
    expect(merged[0].metadata.ctaHeadline).toBe('Head');
    expect(merged[0].metadata.ctaBody).toBe('Body');
  });

  it('downgrades blank generated parent output while preserving reusable slot outputs and metadata', () => {
    const merged = mergeDerivedWithPersistedMetasSlugCtasRows(
      [
        {
          id: 'meta_html_quick_h1_1',
          status: 'pending',
          input: 'Meta for Page A',
          output: '',
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
            h1Body: 'H1',
            quickAnswer: 'Quick',
            quickAnswerHtml: '<p>Quick</p>',
            metaTitle: 'Page A',
          },
        },
      ],
      [
        {
          id: 'meta_html_quick_h1_1',
          status: 'generated',
          input: 'Meta for Page A',
          output: '   ',
          slots: {
            slug: { status: 'generated', output: 'page-a' },
            cta: { status: 'generated', output: '{"headline":"Head","body":"Body"}' },
          },
          metadata: {
            pageName: 'Page A',
            quickAnswer: 'Quick',
            quickAnswerHtml: '<p>Quick</p>',
            h1Body: 'H1',
            slug: 'page-a',
            ctaHeadline: 'Head',
            ctaBody: 'Body',
          },
        },
      ],
    );

    expect(merged[0].status).toBe('pending');
    expect(merged[0].output).toBe('   ');
    expect(merged[0].slots?.slug?.output).toBe('page-a');
    expect(merged[0].slots?.cta?.output).toContain('"headline":"Head"');
    expect(merged[0].metadata.slug).toBe('page-a');
    expect(merged[0].metadata.ctaHeadline).toBe('Head');
    expect(merged[0].metadata.ctaBody).toBe('Body');
  });

  it('drops persisted multi-output state when upstream source changed', () => {
    const merged = mergeDerivedWithPersistedMetasSlugCtasRows(
      [
        {
          id: 'meta_html_quick_h1_1',
          status: 'pending',
          input: 'Meta for Page A',
          output: '',
          metadata: {
            pageName: 'Page A',
            h2Name: 'H2',
            h2Content: 'Body',
            h2Summaries: 'Summary',
            h1Body: 'H1 changed',
            quickAnswer: 'Quick',
            quickAnswerHtml: '<p>Quick changed</p>',
            metaTitle: 'Page A',
          },
        },
      ],
      [
        {
          id: 'meta_html_quick_h1_1',
          status: 'generated',
          input: 'Old meta for Page A',
          output: 'Old meta description',
          slots: {
            slug: { status: 'generated', output: 'page-a' },
          },
          metadata: {
            pageName: 'Page A',
            quickAnswer: 'Quick',
            quickAnswerHtml: '<p>Quick</p>',
            h1Body: 'H1',
            slug: 'page-a',
          },
        },
      ],
    );

    expect(merged[0].output).toBe('');
    expect(merged[0].slots).toBeUndefined();
    expect(merged[0].metadata.slug).toBeUndefined();
  });

  it('falls back to the bundled prompt when saved meta prompt is blank', () => {
    expect(resolveMetasSlugCtasPromptTemplate('   ', 'fallback')).toBe('fallback');
  });

  it('builds firestore rows with the fallback prompt and reusable persisted state', async () => {
    mockLoadGeneratePrimaryPrompt.mockResolvedValue('   ');
    mockLoadChunkedAppSettingsRows.mockImplementation(async (docId: string) => {
      if (docId === 'generate_rows_quick_answer_html') {
        return [
          {
            id: 'html_quick_h1_1',
            status: 'generated',
            output: '<p>Quick answer HTML</p>',
            metadata: {
              pageName: 'Page A',
              h2Name: 'H2',
              h2Content: 'Body',
              h2Summaries: 'Summary',
              h1Body: 'H1',
              quickAnswer: 'Quick answer',
              sourceRowId: 'page-1',
            },
          },
        ];
      }
      if (docId === 'generate_rows_metas_slug_ctas') {
        return [
          {
            id: 'meta_html_quick_h1_1',
            status: 'generated',
            input: 'Fallback Page A',
            output: 'Meta description text',
            metadata: {
              pageName: 'Page A',
              quickAnswer: 'Quick answer',
              quickAnswerHtml: '<p>Quick answer HTML</p>',
              h1Body: 'H1',
              slug: 'page-a',
              ctaHeadline: 'Head',
              ctaBody: 'Body',
            },
            slots: {
              slug: { status: 'generated', output: 'page-a' },
              cta: { status: 'generated', output: '{"headline":"Head","body":"Body"}' },
            },
          },
        ];
      }
      return [];
    });

    const rows = await buildMetasSlugCtasRowsFromFirestore({
      settingsDocId: 'generate_settings_metas_slug_ctas',
      fallbackPrompt: 'Fallback {PAGE_NAME}',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].input).toBe('Fallback Page A');
    expect(rows[0].status).toBe('generated');
    expect(rows[0].output).toBe('Meta description text');
    expect(rows[0].slots?.slug?.output).toBe('page-a');
    expect(rows[0].metadata.sourceRowId).toBe('page-1');
  });
});
