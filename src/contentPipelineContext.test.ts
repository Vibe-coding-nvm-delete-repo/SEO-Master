import { describe, expect, it } from 'vitest';

import {
  createCanonicalH2Context,
  hasRequiredCanonicalH2Context,
  mergeCanonicalH2Context,
  readCanonicalH2Context,
} from './contentPipelineContext';

describe('contentPipelineContext', () => {
  it('reads and trims the canonical h2 context from metadata', () => {
    expect(readCanonicalH2Context({
      pageName: ' Page ',
      order: ' 2 ',
      h2Name: ' Heading ',
      ratingScore: ' 5 ',
      contentGuidelines: ' Keep it concise. ',
      sourceRowId: ' row-1 ',
    })).toEqual({
      pageName: 'Page',
      order: '2',
      h2Name: 'Heading',
      ratingScore: '5',
      contentGuidelines: 'Keep it concise.',
      sourceRowId: 'row-1',
    });
  });

  it('merges canonical h2 context into stage metadata without losing stage fields', () => {
    expect(mergeCanonicalH2Context(
      {
        pageName: 'Page',
        order: '2',
        h2Name: 'Heading',
        ratingScore: '4',
        contentGuidelines: 'Guide',
        sourceRowId: 'row-1',
      },
      {
        h2Content: 'Body copy',
        h2ContentRowId: 'h2-row-1',
      },
    )).toEqual({
      pageName: 'Page',
      order: '2',
      h2Name: 'Heading',
      ratingScore: '4',
      contentGuidelines: 'Guide',
      sourceRowId: 'row-1',
      h2Content: 'Body copy',
      h2ContentRowId: 'h2-row-1',
    });
  });

  it('treats page, order, h2 name, and source row as the required canonical fields', () => {
    expect(hasRequiredCanonicalH2Context(createCanonicalH2Context({
      pageName: 'Page',
      order: '1',
      h2Name: 'Heading',
      sourceRowId: 'row-1',
    }))).toBe(true);

    expect(hasRequiredCanonicalH2Context(createCanonicalH2Context({
      pageName: 'Page',
      h2Name: 'Heading',
      sourceRowId: 'row-1',
    }))).toBe(false);
  });
});
