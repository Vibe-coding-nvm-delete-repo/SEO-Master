import { describe, expect, it } from 'vitest';
import { isTransientNetworkError } from './openRouterTimeout';

describe('isTransientNetworkError', () => {
  it('returns true for TypeError (browser "Failed to fetch")', () => {
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('returns true for TypeError with any message', () => {
    expect(isTransientNetworkError(new TypeError('NetworkError when attempting to fetch resource'))).toBe(true);
  });

  it('returns true for TypeError with empty message', () => {
    expect(isTransientNetworkError(new TypeError())).toBe(true);
  });

  it('returns true for errors with "fetch" in message', () => {
    expect(isTransientNetworkError(new Error('Failed to fetch'))).toBe(true);
    expect(isTransientNetworkError(new Error('fetch failed'))).toBe(true);
  });

  it('returns true for errors with "network" in message (case-insensitive)', () => {
    expect(isTransientNetworkError(new Error('Network error'))).toBe(true);
    expect(isTransientNetworkError(new Error('NETWORK_ERROR'))).toBe(true);
    expect(isTransientNetworkError(new Error('A network error occurred'))).toBe(true);
  });

  it('returns false for API errors (not transient)', () => {
    expect(isTransientNetworkError(new Error('API 500: Internal Server Error'))).toBe(false);
    expect(isTransientNetworkError(new Error('API 400: Bad Request'))).toBe(false);
    expect(isTransientNetworkError(new Error('Rate limited'))).toBe(false);
  });

  it('returns false for JSON parse errors', () => {
    expect(isTransientNetworkError(new SyntaxError('Unexpected token < in JSON'))).toBe(false);
  });

  it('returns false for abort errors', () => {
    expect(isTransientNetworkError(new DOMException('Aborted', 'AbortError'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });

  it('returns false for strings and numbers', () => {
    expect(isTransientNetworkError('Failed to fetch')).toBe(false);
    expect(isTransientNetworkError(404)).toBe(false);
  });

  it('returns false for generic errors without network keywords', () => {
    expect(isTransientNetworkError(new Error('Slot output parsing failed'))).toBe(false);
    expect(isTransientNetworkError(new Error('Empty response from API'))).toBe(false);
    expect(isTransientNetworkError(new Error('Unknown error'))).toBe(false);
  });

  it('returns true for plain objects with fetch/network message', () => {
    expect(isTransientNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(isTransientNetworkError({ message: 'network timeout' })).toBe(true);
  });

  it('returns false for plain objects with unrelated message', () => {
    expect(isTransientNetworkError({ message: 'something else' })).toBe(false);
  });
});
