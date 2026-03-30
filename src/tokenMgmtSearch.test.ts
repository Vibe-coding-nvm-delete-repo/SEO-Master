import { describe, it, expect } from 'vitest';
import { parseTokenMgmtSearchTerms, tokenIncludesAnyTerm } from './tokenMgmtSearch';

describe('parseTokenMgmtSearchTerms', () => {
  it('splits on commas, trims, lowercases', () => {
    expect(parseTokenMgmtSearchTerms('  Foo, bar , , Baz ')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns [] for empty/whitespace-only input', () => {
    expect(parseTokenMgmtSearchTerms('   ')).toEqual([]);
    expect(parseTokenMgmtSearchTerms('')).toEqual([]);
  });
});

describe('tokenIncludesAnyTerm', () => {
  it('matches tokens when any term is contained', () => {
    expect(tokenIncludesAnyTerm('automobile', ['auto'])).toBe(true);
    expect(tokenIncludesAnyTerm('automobile', ['mob'])).toBe(true);
    expect(tokenIncludesAnyTerm('automobile', ['xyz'])).toBe(false);
  });

  it('is case-insensitive on token (terms must be pre-lowercased via parseTokenMgmtSearchTerms)', () => {
    expect(tokenIncludesAnyTerm('AutoMoBile', ['auto'])).toBe(true);
    expect(tokenIncludesAnyTerm('AutoMoBile', ['mobile'])).toBe(true); // token lowercased -> 'automobile' contains 'mobile'
    expect(tokenIncludesAnyTerm('AutoMoBile', ['mob'])).toBe(true); // substring match
  });

  it('returns true when terms array is empty', () => {
    expect(tokenIncludesAnyTerm('anything', [])).toBe(true);
  });
});

