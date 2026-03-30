export const CANONICAL_H2_CONTEXT_KEYS = [
  'pageName',
  'order',
  'h2Name',
  'ratingScore',
  'contentGuidelines',
  'sourceRowId',
] as const;

export type CanonicalH2ContextKey = (typeof CANONICAL_H2_CONTEXT_KEYS)[number];

export type CanonicalH2Context = Record<CanonicalH2ContextKey, string>;

const EMPTY_CANONICAL_H2_CONTEXT: CanonicalH2Context = {
  pageName: '',
  order: '',
  h2Name: '',
  ratingScore: '',
  contentGuidelines: '',
  sourceRowId: '',
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readCanonicalH2Context(
  metadata?: Record<string, string>,
): CanonicalH2Context {
  return {
    pageName: normalizeString(metadata?.pageName),
    order: normalizeString(metadata?.order),
    h2Name: normalizeString(metadata?.h2Name),
    ratingScore: normalizeString(metadata?.ratingScore),
    contentGuidelines: normalizeString(metadata?.contentGuidelines),
    sourceRowId: normalizeString(metadata?.sourceRowId),
  };
}

export function hasRequiredCanonicalH2Context(
  context: CanonicalH2Context,
): boolean {
  return Boolean(context.pageName && context.order && context.h2Name && context.sourceRowId);
}

export function mergeCanonicalH2Context(
  upstreamMetadata: Record<string, string> | undefined,
  stageMetadata: Record<string, string>,
): Record<string, string> {
  const context = readCanonicalH2Context(upstreamMetadata);
  return {
    ...stageMetadata,
    ...Object.fromEntries(
      CANONICAL_H2_CONTEXT_KEYS.flatMap((key) => {
        const value = context[key];
        return value ? [[key, value]] : [];
      }),
    ),
  };
}

export function createCanonicalH2Context(
  values: Partial<CanonicalH2Context>,
): CanonicalH2Context {
  return {
    ...EMPTY_CANONICAL_H2_CONTEXT,
    ...Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, normalizeString(value)]),
    ),
  } as CanonicalH2Context;
}
