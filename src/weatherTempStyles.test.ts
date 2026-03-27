import { describe, it, expect } from 'vitest';
import { celsiusFromDisplay, getTemperatureHueClass } from './weatherTempStyles';

describe('celsiusFromDisplay', () => {
  it('passes through °C', () => {
    expect(celsiusFromDisplay(20, 'c')).toBe(20);
  });

  it('converts °F to °C', () => {
    expect(celsiusFromDisplay(32, 'f')).toBe(0);
    expect(celsiusFromDisplay(50, 'f')).toBeCloseTo(10, 5);
  });
});

describe('getTemperatureHueClass', () => {
  it('returns colder hues for low °C', () => {
    expect(getTemperatureHueClass(-5)).toMatch(/sky/);
  });

  it('returns warmer hues for high °C', () => {
    expect(getTemperatureHueClass(35)).toMatch(/rose/);
  });
});
