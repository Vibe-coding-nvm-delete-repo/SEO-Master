import { describe, it, expect } from 'vitest';
import { normalizeMismatchedPageNames } from './GroupReviewEngine';

describe('normalizeMismatchedPageNames', () => {
  const canonical = [
    'Plumber Austin TX',
    'Emergency Plumbing Repair',
    'Drain Cleaning Services',
  ];

  it('maps exact strings', () => {
    expect(normalizeMismatchedPageNames(canonical, ['Plumber Austin TX'])).toEqual(['Plumber Austin TX']);
  });

  it('trims LLM output', () => {
    expect(normalizeMismatchedPageNames(canonical, ['  Plumber Austin TX  '])).toEqual(['Plumber Austin TX']);
  });

  it('maps case-insensitive when unambiguous', () => {
    expect(normalizeMismatchedPageNames(canonical, ['plumber austin tx'])).toEqual(['Plumber Austin TX']);
  });

  it('maps single fuzzy match when one canonical contains the raw token', () => {
    expect(normalizeMismatchedPageNames(canonical, ['Austin'])).toEqual(['Plumber Austin TX']);
  });

  it('drops unmapped noise instead of false positives', () => {
    expect(normalizeMismatchedPageNames(canonical, ['Unknown Page', ''])).toEqual([]);
  });
});
