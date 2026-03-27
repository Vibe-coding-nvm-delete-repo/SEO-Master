import { describe, it, expect } from 'vitest';
import { getWeatherCodeLabel } from './weatherCodes';

describe('getWeatherCodeLabel', () => {
  it('maps common weather codes to readable labels', () => {
    expect(getWeatherCodeLabel(0)).toBe('Clear');
    expect(getWeatherCodeLabel(61)).toBe('Rain');
    expect(getWeatherCodeLabel(95)).toBe('Thunderstorm');
    expect(getWeatherCodeLabel(999)).toBe('Weather');
    expect(getWeatherCodeLabel(Number.NaN)).toBe('Weather');
  });
});
