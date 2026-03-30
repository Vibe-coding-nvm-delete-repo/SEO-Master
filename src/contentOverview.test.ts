import { describe, expect, it } from 'vitest';
import { buildContentOverview, type ContentOverviewInputs } from './contentOverview';

function makeInputs(): ContentOverviewInputs {
  return {
    pages: [
      { id: 'page-1', input: 'keyword one', status: 'generated', output: 'Keyword One Title', cost: 0.001 },
      { id: 'page-2', input: 'keyword two', status: 'generated', output: 'Keyword Two Title', cost: 0.0012 },
      { id: 'page-ignored', input: '   ', status: 'generated', output: 'Ignored Title', cost: 99 },
    ],
    h2Content: [
      { id: 'h2-a', status: 'generated', output: 'Page 1 H2 body A', cost: 0.01, metadata: { sourceRowId: 'page-1' } },
      { id: 'h2-b', status: 'generated', output: 'Page 1 H2 body B', cost: 0.02, metadata: { sourceRowId: 'page-1' } },
      { id: 'h2-c', status: 'generated', output: 'Page 2 H2 body A', cost: 0.03, metadata: { sourceRowId: 'page-2' } },
      { id: 'h2-d', status: 'pending', output: '', cost: 0.04, metadata: { sourceRowId: 'page-2' } },
    ],
    rating: [
      { id: 'rating-1', status: 'generated', output: '4', cost: 0.05, metadata: { sourceRowId: 'page-1' } },
      { id: 'rating-2', status: 'generated', output: '4', cost: 0.06, metadata: { sourceRowId: 'page-2' } },
    ],
    h2Html: [
      { id: 'html-1', status: 'generated', output: '<p>Page 1 dynamic description</p>', cost: 0.07, metadata: { sourceRowId: 'page-1', order: '1', h2Name: 'Page 1 H2' } },
      { id: 'html-2', status: 'generated', output: '<p>Page 2 dynamic description</p>', cost: 0.08, metadata: { sourceRowId: 'page-2', order: '1', h2Name: 'Page 2 H2' } },
    ],
    h2Summary: [
      { id: 'sum-1', status: 'generated', output: 'Page 1 summary', cost: 0.09, metadata: { sourceRowId: 'page-1' } },
      { id: 'sum-2', status: 'generated', output: 'Page 2 summary', cost: 0.1, metadata: { sourceRowId: 'page-2' } },
    ],
    h1Body: [
      { id: 'h1-body-1', status: 'generated', output: 'Page 1 H1 body', cost: 0.11, metadata: { sourceRowId: 'page-1' } },
      { id: 'h1-body-2', status: 'generated', output: 'Page 2 H1 body', cost: 0.12, metadata: { sourceRowId: 'page-2' } },
    ],
    h1Html: [
      { id: 'h1-html-1', status: 'generated', output: '<p>Page 1 H1 HTML</p>', cost: 0.13, metadata: { sourceRowId: 'page-1' } },
      { id: 'h1-html-2', status: 'generated', output: '<p>Page 2 H1 HTML</p>', cost: 0.14, metadata: { sourceRowId: 'page-2' } },
    ],
    quickAnswer: [
      { id: 'qa-1', status: 'generated', output: 'Page 1 quick answer', cost: 0.15, metadata: { sourceRowId: 'page-1' } },
      { id: 'qa-2', status: 'generated', output: 'Page 2 quick answer', cost: 0.16, metadata: { sourceRowId: 'page-2' } },
    ],
    quickAnswerHtml: [
      { id: 'qa-html-1', status: 'generated', output: '<p>Page 1 quick answer HTML</p>', cost: 0.17, metadata: { sourceRowId: 'page-1' } },
      { id: 'qa-html-2', status: 'generated', output: '<p>Page 2 quick answer HTML</p>', cost: 0.18, metadata: { sourceRowId: 'page-2' } },
    ],
    metasSlugCtas: [
      {
        id: 'meta-1',
        status: 'generated',
        output: 'Meta description page 1',
        cost: 0.19,
        metadata: {
          sourceRowId: 'page-1',
          metaTitle: 'Keyword One Title',
          slug: 'keyword-one-title',
          ctaHeadline: 'CTA headline 1',
          ctaBody: 'CTA body 1',
        },
        slots: {
          slug: { status: 'generated', output: 'keyword-one-title', cost: 0.021 },
          cta: { status: 'generated', output: '{"headline":"CTA headline 1","body":"CTA body 1"}', cost: 0.031 },
        },
      },
      {
        id: 'meta-2',
        status: 'generated',
        output: 'Meta description page 2',
        cost: 0.2,
        metadata: {
          sourceRowId: 'page-2',
          metaTitle: 'Keyword Two Title',
          ctaHeadline: 'CTA headline 2',
          ctaBody: 'CTA body 2',
        },
        slots: {
          slug: { status: 'pending', output: '', cost: 0.022 },
          cta: { status: 'generated', output: '{"headline":"CTA headline 2","body":"CTA body 2"}', cost: 0.032 },
        },
      },
    ],
    tipsRedflags: [
      {
        id: 'tip-1',
        status: 'generated',
        output: 'Pro tip page 1',
        cost: 0.23,
        metadata: { sourceRowId: 'page-1' },
        slots: {
          redflag: { status: 'generated', output: 'Red flag page 1', cost: 0.041 },
          keytakeaways: { status: 'generated', output: 'Key takeaways page 1', cost: 0.051 },
        },
      },
      {
        id: 'tip-2',
        status: 'generated',
        output: 'Pro tip page 2',
        cost: 0.24,
        metadata: { sourceRowId: 'page-2' },
        slots: {
          redflag: { status: 'generated', output: 'Red flag page 2', cost: 0.042 },
          keytakeaways: { status: 'error', output: '', cost: 0.052 },
        },
      },
    ],
  };
}

describe('buildContentOverview', () => {
  it('counts active pages from the pages stage and ignores blank inputs', () => {
    const summary = buildContentOverview(makeInputs());
    expect(summary.totalPages).toBe(2);
    expect(summary.stages[0]).toMatchObject({ label: 'Pages', completed: 2, total: 2, percent: 100 });
  });

  it('computes completion per page for row stages and child slot stages', () => {
    const summary = buildContentOverview(makeInputs());
    expect(summary.stages.find((stage) => stage.id === 'h2-body')).toMatchObject({ completed: 1, total: 2, percent: 50 });

    const metas = summary.stages.find((stage) => stage.id === 'metas-slug-ctas');
    expect(metas?.children).toEqual([
      expect.objectContaining({ label: 'Meta Description', completed: 2, total: 2, percent: 100 }),
      expect.objectContaining({ label: 'Slug', completed: 1, total: 2, percent: 50 }),
      expect.objectContaining({ label: 'CTAs', completed: 2, total: 2, percent: 100 }),
    ]);

    const tips = summary.stages.find((stage) => stage.id === 'tips-redflags');
    expect(tips?.children).toEqual([
      expect.objectContaining({ label: 'Pro Tip', completed: 2 }),
      expect.objectContaining({ label: 'Red Flag', completed: 2 }),
      expect.objectContaining({ label: 'Key Takeaways', completed: 1 }),
    ]);
  });

  it('sums primary and slot costs and reports final-stage progress', () => {
    const summary = buildContentOverview(makeInputs());
    expect(summary.totalCost).toBeCloseTo(2.8642, 6);
    expect(summary.latestCompletedStage).toBe('Red Flag');
    expect(summary.pagesFullyThroughFinalStage).toBe(1);
    expect(summary.overallCompletedOutputs).toBe(28);
    expect(summary.overallOutputTarget).toBe(32);
    expect(summary.completePages).toBe(1);
    expect(summary.blockedPages).toBe(1);
    expect(summary.activePages).toBe(0);
    expect(summary.readyPages).toBe(0);
    expect(summary.bottleneckStage).toBe('H2 Body');
    expect(summary.highestCostStage).toBe('Pro Tip');
    expect(summary.finalImplementedStageId).toBe('final-pages');
    expect(summary.stages.find((stage) => stage.id === 'final-pages')).toMatchObject({ completed: 1, total: 2, percent: 50 });
  });

  it('handles missing downstream rows without throwing', () => {
    const summary = buildContentOverview({
      pages: [{ id: 'page-1', input: 'keyword', status: 'generated', output: 'Keyword Title', cost: 0.01 }],
      h2Content: [],
      rating: [],
      h2Html: [],
      h2Summary: [],
      h1Body: [],
      h1Html: [],
      quickAnswer: [],
      quickAnswerHtml: [],
      metasSlugCtas: [],
      tipsRedflags: [],
    });

    expect(summary.totalPages).toBe(1);
    expect(summary.overallCompletedOutputs).toBe(1);
    expect(summary.latestCompletedStage).toBe('Pages');
    expect(summary.bottleneckStage).toBe('H2 Body');
    expect(summary.stages.find((stage) => stage.id === 'metas-slug-ctas')?.children).toHaveLength(3);
  });

  it('does not count generated-but-empty primary or slot outputs as complete', () => {
    const summary = buildContentOverview({
      pages: [{ id: 'page-1', input: 'keyword', status: 'generated', output: 'Keyword Title' }],
      h2Content: [{ id: 'h2-1', status: 'generated', output: '   ', metadata: { sourceRowId: 'page-1' } }],
      rating: [{ id: 'rating-1', status: 'generated', output: '', metadata: { sourceRowId: 'page-1' } }],
      h2Html: [{ id: 'html-1', status: 'generated', output: '<p>Dynamic description</p>', metadata: { sourceRowId: 'page-1', order: '1', h2Name: 'Dynamic H2' } }],
      h2Summary: [],
      h1Body: [{ id: 'h1-body-1', status: 'generated', output: '', metadata: { sourceRowId: 'page-1' } }],
      h1Html: [],
      quickAnswer: [],
      quickAnswerHtml: [{ id: 'qa-html-1', status: 'generated', output: '<p>Quick answer HTML</p>', metadata: { sourceRowId: 'page-1' } }],
      metasSlugCtas: [{
        id: 'meta-1',
        status: 'generated',
        output: '',
        metadata: {
          sourceRowId: 'page-1',
          metaTitle: 'Keyword Title',
          slug: 'keyword-title',
          ctaHeadline: 'CTA headline',
          ctaBody: 'CTA body',
        },
        slots: {
          slug: { status: 'generated', output: '' },
          cta: { status: 'generated', output: 'cta json' },
        },
      }],
      tipsRedflags: [{
        id: 'tip-1',
        status: 'generated',
        output: '',
        metadata: { sourceRowId: 'page-1' },
        slots: {
          redflag: { status: 'generated', output: '' },
          keytakeaways: { status: 'generated', output: 'Key takeaways' },
        },
      }],
    });

    expect(summary.stages.find((stage) => stage.id === 'h2-body')).toMatchObject({ completed: 0, total: 1 });
    expect(summary.stages.find((stage) => stage.id === 'h2-rate')).toMatchObject({ completed: 0, total: 1 });
    expect(summary.stages.find((stage) => stage.id === 'metas-slug-ctas')?.children).toEqual([
      expect.objectContaining({ label: 'Meta Description', completed: 0, total: 1 }),
      expect.objectContaining({ label: 'Slug', completed: 0, total: 1 }),
      expect.objectContaining({ label: 'CTAs', completed: 1, total: 1 }),
    ]);
    expect(summary.stages.find((stage) => stage.id === 'tips-redflags')?.children).toEqual([
      expect.objectContaining({ label: 'Pro Tip', completed: 0, total: 1 }),
      expect.objectContaining({ label: 'Red Flag', completed: 0, total: 1 }),
      expect.objectContaining({ label: 'Key Takeaways', completed: 1, total: 1 }),
    ]);
    expect(summary.stages.find((stage) => stage.id === 'final-pages')).toMatchObject({ completed: 0, total: 1 });
    expect(summary.completePages).toBe(0);
  });

  it('counts active pages when any row or slot is generating', () => {
    const inputs = makeInputs();
    inputs.quickAnswerHtml[1].status = 'generating';
    inputs.metasSlugCtas[0].slots = {
      ...(inputs.metasSlugCtas[0].slots ?? {}),
      cta: { status: 'generating', cost: 0.031 },
    };

    const summary = buildContentOverview(inputs);
    expect(summary.activePages).toBe(2);
  });
});
