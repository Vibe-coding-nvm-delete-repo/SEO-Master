import { describe, expect, it } from 'vitest';
import {
  normalizeFeedbackTags,
  isAcceptableFeedbackImage,
  FEEDBACK_MAX_IMAGE_BYTES,
  getFeedbackAreaLabel,
  composeIssueFeedbackBody,
  composeFeatureFeedbackBody,
} from './feedbackConstants';

describe('normalizeFeedbackTags', () => {
  it('splits on commas and lowercases', () => {
    expect(normalizeFeedbackTags('Foo, BAR, baz')).toEqual(['foo', 'bar', 'baz']);
  });
  it('drops empties', () => {
    expect(normalizeFeedbackTags('a,, b')).toEqual(['a', 'b']);
  });
});

describe('isAcceptableFeedbackImage', () => {
  it('accepts image/* under size limit', () => {
    expect(isAcceptableFeedbackImage(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true);
  });
  it('rejects oversize files', () => {
    const big = new File([new Uint8Array(FEEDBACK_MAX_IMAGE_BYTES + 1)], 'huge.png', { type: 'image/png' });
    expect(isAcceptableFeedbackImage(big)).toBe(false);
  });
});

describe('getFeedbackAreaLabel', () => {
  it('returns label for known area id', () => {
    expect(getFeedbackAreaLabel('group-data')).toContain('Data');
  });
  it('returns id for unknown slug', () => {
    expect(getFeedbackAreaLabel('legacy-custom-tag')).toBe('legacy-custom-tag');
  });
});

describe('composeIssueFeedbackBody', () => {
  it('includes area and required sections', () => {
    const s = composeIssueFeedbackBody('group-projects', {
      tryingTo: 'Open a project',
      whatHappened: 'Error',
      expected: 'Load',
      steps: '',
    });
    expect(s).toContain('Area:');
    expect(s).toMatch(/Projects \(list/);
    expect(s).toContain('What were you trying to do?');
    expect(s).toContain('Open a project');
  });

  it('omits expected section when not provided', () => {
    const s = composeIssueFeedbackBody('group-projects', {
      tryingTo: 'Open a project',
      whatHappened: 'Error',
      expected: '   ',
      steps: '',
    });
    expect(s).not.toContain('What did you expect instead?');
  });
});

describe('composeFeatureFeedbackBody', () => {
  it('includes need and idea', () => {
    const s = composeFeatureFeedbackBody('generate-tab-1', {
      need: 'Faster batch',
      idea: 'Parallel rows',
      extra: '',
    });
    expect(s).toMatch(/Generate 1/);
    expect(s).toContain('Faster batch');
    expect(s).toContain('Parallel rows');
  });
});
