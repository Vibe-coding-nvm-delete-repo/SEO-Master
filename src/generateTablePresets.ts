export type PrimaryColumnPreset = 'default' | 'compact';

const CONTENT_COL = {
  status: 'w-[80px]',
  input: 'w-[132px]',
  output: 'w-[168px]',
  date: 'w-[92px]',
  xs: 'w-[40px]',
  sm: 'w-[72px]',
  md: 'w-[88px]',
  lg: 'w-[112px]',
  text: 'w-[160px]',
  body: 'w-[176px]',
  flags: 'w-[152px]',
  meta: 'w-[128px]',
  slug: 'w-[116px]',
  cta: 'w-[144px]',
} as const;

export const PRIMARY_COLUMN_WIDTH_PRESETS: Record<PrimaryColumnPreset, {
  status: string;
  input: string;
  output: string;
  date: string;
}> = {
  default: {
    status: 'w-[72px]',
    input: 'w-[180px]',
    output: 'w-[220px]',
    date: 'w-[110px]',
  },
  compact: {
    status: CONTENT_COL.status,
    input: CONTENT_COL.input,
    output: CONTENT_COL.output,
    date: CONTENT_COL.date,
  },
};

export const H2_CONTENT_EXTRA_COLUMNS = [
  { key: 'pageName', label: 'Page Name', width: CONTENT_COL.md, compact: true },
  { key: 'order', label: '#', width: CONTENT_COL.xs, compact: true },
  { key: 'h2Name', label: 'H2 Name', width: CONTENT_COL.lg, compact: true },
  { key: 'ratingScore', label: 'Rating', width: CONTENT_COL.sm, compact: true },
  { key: 'contentGuidelines', label: 'Guidelines', width: CONTENT_COL.text, compact: true },
];

export const H2_RATING_EXTRA_COLUMNS = [
  { key: 'factCheckTarget', label: 'Context', width: CONTENT_COL.md, compact: true },
  { key: 'h2Name', label: 'H2 Name', width: CONTENT_COL.lg, compact: true },
  { key: 'h2Content', label: 'H2 Content', width: CONTENT_COL.body },
  { key: 'ratingScore', label: 'Rating Score', width: CONTENT_COL.sm, compact: true },
];

export const H2_SUMMARY_EXTRA_COLUMNS = [
  { key: 'pageName', label: 'Page Name', width: CONTENT_COL.md, compact: true },
  { key: 'order', label: '#', width: CONTENT_COL.xs, compact: true },
  { key: 'h2Name', label: 'H2 Name', width: CONTENT_COL.lg, compact: true },
  { key: 'h2Content', label: 'H2 Content', width: CONTENT_COL.body },
];

export const PAGE_NAMES_EXTRA_COLUMNS = [
  { key: 'h2JsonStatus', label: 'H2 JSON', width: CONTENT_COL.md, compact: true },
  { key: 'h2NamesPreview', label: 'H2s', width: CONTENT_COL.text },
  { key: 'pageGuideJsonStatus', label: 'Guide JSON', width: CONTENT_COL.md, compact: true },
  { key: 'h2QaRating', label: 'H2 QA', width: CONTENT_COL.sm, compact: true },
  { key: 'h2QaFlags', label: 'H2 QA Flags', width: CONTENT_COL.flags },
];

export const PAGE_LEVEL_CONTENT_EXTRA_COLUMNS = [
  { key: 'pageName', label: 'Page Name', width: CONTENT_COL.md, compact: true },
  { key: 'h2Name', label: 'H2 Name', width: CONTENT_COL.lg },
  { key: 'h2Content', label: 'H2 Content', width: CONTENT_COL.body },
  { key: 'h2Summaries', label: 'H2 Summaries', width: CONTENT_COL.body },
];

export const H1_BODY_EXTRA_COLUMNS = PAGE_LEVEL_CONTENT_EXTRA_COLUMNS;
export const H1_HTML_EXTRA_COLUMNS = PAGE_LEVEL_CONTENT_EXTRA_COLUMNS;
export const QUICK_ANSWER_EXTRA_COLUMNS = PAGE_LEVEL_CONTENT_EXTRA_COLUMNS;
export const QUICK_ANSWER_HTML_EXTRA_COLUMNS = PAGE_LEVEL_CONTENT_EXTRA_COLUMNS;
export const TIPS_REDFLAGS_EXTRA_COLUMNS = PAGE_LEVEL_CONTENT_EXTRA_COLUMNS;

export const METAS_SLUG_CTAS_EXTRA_COLUMNS = [
  ...PAGE_LEVEL_CONTENT_EXTRA_COLUMNS,
  { key: 'metaTitle', label: 'Meta Title', width: CONTENT_COL.meta },
  { key: 'slug', label: 'Slug', width: CONTENT_COL.slug },
  { key: 'ctaHeadline', label: 'CTA Headline', width: CONTENT_COL.cta },
  { key: 'ctaBody', label: 'CTA Body', width: CONTENT_COL.body },
];

export type FinalPagesTableColumn = {
  key: string;
  label: string;
  width: string;
};

export const FINAL_PAGES_DYNAMIC_PAIR_COUNT = 30;

export const FINAL_PAGES_TABLE_COLUMNS: FinalPagesTableColumn[] = [
  { key: 'title', label: 'Title', width: 'w-[160px]' },
  { key: 'metaTitle', label: 'Meta Title', width: 'w-[160px]' },
  { key: 'metaDescription', label: 'Meta Description', width: 'w-[180px]' },
  { key: 'slug', label: 'Slug', width: 'w-[132px]' },
  { key: 'quickAnswer', label: 'Quick Answer', width: 'w-[180px]' },
  { key: 'h1Body', label: 'H1 Body', width: 'w-[200px]' },
  { key: 'ctaTitle', label: 'CTA Title', width: 'w-[148px]' },
  { key: 'ctaBody', label: 'CTA Body', width: 'w-[184px]' },
  { key: 'proTip', label: 'Pro Tip', width: 'w-[160px]' },
  { key: 'redFlags', label: 'Red Flags', width: 'w-[200px]' },
  { key: 'keyTakeaways', label: 'Key Takeaways', width: 'w-[200px]' },
  ...Array.from({ length: FINAL_PAGES_DYNAMIC_PAIR_COUNT }, (_, index) => {
    const slot = index + 1;
    return ([
      { key: `dynamicHeader${slot}`, label: `Dynamic Header ${slot}`, width: 'w-[132px]' },
      { key: `dynamicDescription${slot}`, label: `Dynamic Description ${slot}`, width: 'w-[180px]' },
    ] satisfies FinalPagesTableColumn[]);
  }).flat(),
];
