import { describe, expect, it } from 'vitest';
import { buildFinalPagesRows, buildFinalPagesViewModel } from './contentFinalPages';

describe('buildFinalPagesRows', () => {
  it('maps final page fields from the downstream content pipeline', () => {
    const rows = buildFinalPagesRows({
      pages: [
        { id: 'page-1', input: 'installment loans', output: 'Can You Get Installment Loans?', status: 'generated', generatedAt: '2026-03-29T03:40:00.000Z' },
      ],
      h2Html: [
        { id: 'h2-2', status: 'generated', output: '<p>Second body.</p>', generatedAt: '2026-03-29T03:41:00.000Z', metadata: { sourceRowId: 'page-1', order: '2', h2Name: 'Second H2' } },
        { id: 'h2-1', status: 'generated', output: '<p>First body.</p>', generatedAt: '2026-03-29T03:42:00.000Z', metadata: { sourceRowId: 'page-1', order: '1', h2Name: 'First H2' } },
      ],
      h1Html: [
        { id: 'h1-1', status: 'generated', output: '<p>Intro body.</p>', generatedAt: '2026-03-29T03:43:00.000Z', metadata: { sourceRowId: 'page-1', pageName: 'Can You Get Installment Loans?' } },
      ],
      quickAnswerHtml: [
        { id: 'quick-1', status: 'generated', output: '<p>Quick answer text.</p>', generatedAt: '2026-03-29T03:44:00.000Z', metadata: { sourceRowId: 'page-1' } },
      ],
      metasSlugCtas: [
        {
          id: 'meta-1',
          status: 'generated',
          output: 'Meta description text.',
          generatedAt: '2026-03-29T03:45:00.000Z',
          metadata: {
            sourceRowId: 'page-1',
            metaTitle: 'Can You Get Installment Loans?',
            slug: 'can-you-get-installment-loans',
            ctaHeadline: 'Call before you apply',
            ctaBody: 'We can review your credit first.',
          },
          slots: {
            slug: { status: 'generated', output: 'can-you-get-installment-loans', generatedAt: '2026-03-29T03:46:00.000Z' },
            cta: { status: 'generated', output: '{"headline":"Call before you apply","body":"We can review your credit first."}', generatedAt: '2026-03-29T03:47:00.000Z' },
          },
        },
      ],
      tipsRedflags: [
        {
          id: 'tips-1',
          status: 'generated',
          output: '⚡ Helpful pro tip.',
          generatedAt: '2026-03-29T03:48:00.000Z',
          metadata: { sourceRowId: 'page-1' },
          slots: {
            redflag: { status: 'generated', output: '🚩 Red flag text.', generatedAt: '2026-03-29T03:49:00.000Z' },
            keytakeaways: { status: 'generated', output: '🗝️ Takeaway text.', generatedAt: '2026-03-29T03:50:00.000Z' },
          },
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Can You Get Installment Loans?',
      metaTitle: 'Can You Get Installment Loans?',
      metaDescription: 'Meta description text.',
      slug: 'can-you-get-installment-loans',
      quickAnswer: '<p>Quick answer text.</p>',
      h1Body: '<p>Intro body.</p>',
      ctaTitle: 'Call before you apply',
      ctaBody: 'We can review your credit first.',
      proTip: '⚡ Helpful pro tip.',
      redFlags: '🚩 Red flag text.',
      keyTakeaways: '🗝️ Takeaway text.',
      dynamicHeader1: 'First H2',
      dynamicDescription1: '<p>First body.</p>',
      dynamicHeader2: 'Second H2',
      dynamicDescription2: '<p>Second body.</p>',
      readyToPublish: true,
      lastUpdatedAt: '2026-03-29T03:50:00.000Z',
    });
    expect(rows[0].missingRequiredFields).toEqual([]);
  });

  it('clears derived columns when upstream outputs or slots are not generated', () => {
    const rows = buildFinalPagesRows({
      pages: [{ id: 'page-1', input: 'keyword', output: 'Page Title', status: 'generated' }],
      h2Html: [{ id: 'h2-1', status: 'pending', output: '<p>Old body</p>', metadata: { sourceRowId: 'page-1', order: '1', h2Name: 'Header 1' } }],
      h1Html: [{ id: 'h1-1', status: 'pending', output: '<p>Old H1</p>', metadata: { sourceRowId: 'page-1', pageName: 'Page Title' } }],
      quickAnswerHtml: [{ id: 'quick-1', status: 'pending', output: '<p>Old quick</p>', metadata: { sourceRowId: 'page-1' } }],
      metasSlugCtas: [{
        id: 'meta-1',
        status: 'pending',
        output: 'Old meta',
        metadata: { sourceRowId: 'page-1', metaTitle: 'Page Title', slug: 'old-slug', ctaHeadline: 'Old CTA', ctaBody: 'Old body' },
        slots: {
          slug: { status: 'pending', output: 'old-slug' },
          cta: { status: 'pending', output: '{"headline":"Old CTA","body":"Old body"}' },
        },
      }],
      tipsRedflags: [{
        id: 'tips-1',
        status: 'pending',
        output: 'Old pro tip',
        metadata: { sourceRowId: 'page-1' },
        slots: {
          redflag: { status: 'pending', output: 'Old red flag' },
          keytakeaways: { status: 'pending', output: 'Old takeaways' },
        },
      }],
    });

    expect(rows[0]).toMatchObject({
      title: 'Page Title',
      metaTitle: 'Page Title',
      metaDescription: '',
      slug: '',
      quickAnswer: '',
      h1Body: '',
      ctaTitle: '',
      ctaBody: '',
      proTip: '',
      redFlags: '',
      keyTakeaways: '',
      dynamicHeader1: 'Header 1',
      dynamicDescription1: '',
      readyToPublish: false,
    });
    expect(rows[0].missingRequiredFields).toContain('metaDescription');
    expect(rows[0].missingRequiredFields).toContain('dynamicDescription1');
  });

  it('truncates dynamic h2 pairs after 30 slots', () => {
    const h2Content = Array.from({ length: 32 }, (_, index) => ({
      id: `h2-${index + 1}`,
      status: 'generated',
      output: `<p>Body ${index + 1}</p>`,
      metadata: {
        sourceRowId: 'page-1',
        order: String(index + 1),
        h2Name: `Header ${index + 1}`,
      },
    }));

    const rows = buildFinalPagesRows({
      pages: [{ id: 'page-1', input: 'keyword', output: 'Page Title', status: 'generated' }],
      h2Html: h2Content,
      h1Html: [],
      quickAnswerHtml: [],
      metasSlugCtas: [],
      tipsRedflags: [],
    });

    expect(rows[0].dynamicHeader30).toBe('Header 30');
    expect(rows[0].dynamicDescription30).toBe('<p>Body 30</p>');
    expect(rows[0].dynamicHeader31).toBeUndefined();
    expect(rows[0].dynamicDescription31).toBeUndefined();
  });

  it('builds publish-readiness summary from the assembled final rows', () => {
    const viewModel = buildFinalPagesViewModel({
      pages: [
        { id: 'page-1', input: 'keyword 1', output: 'Page One', status: 'generated', generatedAt: '2026-03-29T04:00:00.000Z' },
        { id: 'page-2', input: 'keyword 2', output: 'Page Two', status: 'generated', generatedAt: '2026-03-29T04:01:00.000Z' },
      ],
      h2Html: [
        { id: 'h2-1', status: 'generated', output: '<p>Body 1</p>', generatedAt: '2026-03-29T04:02:00.000Z', metadata: { sourceRowId: 'page-1', order: '1', h2Name: 'Header 1' } },
        { id: 'h2-2', status: 'generated', output: '', generatedAt: '2026-03-29T04:03:00.000Z', metadata: { sourceRowId: 'page-2', order: '1', h2Name: 'Header 1' } },
      ],
      h1Html: [
        { id: 'h1-1', status: 'generated', output: '<p>H1 One</p>', generatedAt: '2026-03-29T04:04:00.000Z', metadata: { sourceRowId: 'page-1' } },
        { id: 'h1-2', status: 'generated', output: '<p>H1 Two</p>', generatedAt: '2026-03-29T04:05:00.000Z', metadata: { sourceRowId: 'page-2' } },
      ],
      quickAnswerHtml: [
        { id: 'q1', status: 'generated', output: '<p>Quick One</p>', generatedAt: '2026-03-29T04:06:00.000Z', metadata: { sourceRowId: 'page-1' } },
        { id: 'q2', status: 'generated', output: '<p>Quick Two</p>', generatedAt: '2026-03-29T04:07:00.000Z', metadata: { sourceRowId: 'page-2' } },
      ],
      metasSlugCtas: [
        {
          id: 'm1',
          status: 'generated',
          output: 'Meta One',
          generatedAt: '2026-03-29T04:08:00.000Z',
          metadata: { sourceRowId: 'page-1', metaTitle: 'Page One', slug: 'page-one', ctaHeadline: 'CTA One', ctaBody: 'Body One' },
          slots: {
            slug: { status: 'generated', output: 'page-one', generatedAt: '2026-03-29T04:09:00.000Z' },
            cta: { status: 'generated', output: '{"headline":"CTA One","body":"Body One"}', generatedAt: '2026-03-29T04:10:00.000Z' },
          },
        },
        {
          id: 'm2',
          status: 'generated',
          output: '',
          generatedAt: '2026-03-29T04:11:00.000Z',
          metadata: { sourceRowId: 'page-2', metaTitle: 'Page Two', slug: 'page-two', ctaHeadline: 'CTA Two', ctaBody: 'Body Two' },
          slots: {
            slug: { status: 'generated', output: 'page-two', generatedAt: '2026-03-29T04:12:00.000Z' },
            cta: { status: 'generated', output: '{"headline":"CTA Two","body":"Body Two"}', generatedAt: '2026-03-29T04:13:00.000Z' },
          },
        },
      ],
      tipsRedflags: [
        {
          id: 't1',
          status: 'generated',
          output: 'Tip One',
          generatedAt: '2026-03-29T04:14:00.000Z',
          metadata: { sourceRowId: 'page-1' },
          slots: { redflag: { status: 'generated', output: 'Red One', generatedAt: '2026-03-29T04:15:00.000Z' }, keytakeaways: { status: 'generated', output: 'Takeaway One', generatedAt: '2026-03-29T04:16:00.000Z' } },
        },
        {
          id: 't2',
          status: 'generated',
          output: 'Tip Two',
          generatedAt: '2026-03-29T04:17:00.000Z',
          metadata: { sourceRowId: 'page-2' },
          slots: { redflag: { status: 'generated', output: 'Red Two', generatedAt: '2026-03-29T04:18:00.000Z' }, keytakeaways: { status: 'generated', output: 'Takeaway Two', generatedAt: '2026-03-29T04:19:00.000Z' } },
        },
      ],
    });

    expect(viewModel.summary).toMatchObject({
      totalPages: 2,
      readyCount: 1,
      needsReviewCount: 1,
      completionPercent: 50,
      rowsMissingRequiredFields: 1,
      lastUpdatedAt: '2026-03-29T04:19:00.000Z',
    });
    expect(viewModel.rows[0].readyToPublish).toBe(true);
    expect(viewModel.rows[1].readyToPublish).toBe(false);
    expect(viewModel.rows[1].missingRequiredFields).toContain('metaDescription');
    expect(viewModel.rows[1].missingRequiredFields).toContain('dynamicDescription1');
  });
});
