import { describe, expect, it } from 'vitest';
import { supportsGenerateOnlineToggle } from './GenerateTab';

describe('supportsGenerateOnlineToggle', () => {
  it('enables the online toggle for both generate subtabs', () => {
    expect(supportsGenerateOnlineToggle('')).toBe(true);
    expect(supportsGenerateOnlineToggle('_2')).toBe(true);
  });
});
