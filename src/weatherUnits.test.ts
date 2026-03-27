import { describe, it, expect } from 'vitest';
import { shouldUseFahrenheit } from './weatherUnits';

describe('shouldUseFahrenheit', () => {
  it('uses °F for US timezones', () => {
    expect(shouldUseFahrenheit('America/New_York')).toBe(true);
  });

  it('uses °C for Canada timezones even with US locale', () => {
    expect(shouldUseFahrenheit('America/Toronto')).toBe(false);
  });

  it('uses °C for Europe timezones', () => {
    expect(shouldUseFahrenheit('Europe/Berlin')).toBe(false);
  });

  it('uses °C for Mexico even with en-US locale', () => {
    expect(shouldUseFahrenheit('America/Mexico_City')).toBe(false);
  });

  it('uses °C when timezone is not a known US zone', () => {
    expect(shouldUseFahrenheit('America/Sao_Paulo')).toBe(false);
  });
});
