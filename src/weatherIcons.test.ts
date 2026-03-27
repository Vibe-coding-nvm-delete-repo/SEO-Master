import { describe, it, expect } from 'vitest';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
} from 'lucide-react';
import { getWeatherIconAccentClass, getWeatherIconComponent } from './weatherIcons';

describe('getWeatherIconComponent', () => {
  it('maps codes to expected icons', () => {
    expect(getWeatherIconComponent(0)).toBe(Sun);
    expect(getWeatherIconComponent(2)).toBe(CloudSun);
    expect(getWeatherIconComponent(61)).toBe(CloudRain);
    expect(getWeatherIconComponent(71)).toBe(CloudSnow);
    expect(getWeatherIconComponent(95)).toBe(CloudLightning);
    expect(getWeatherIconComponent(45)).toBe(CloudFog);
  });

  it('falls back for unknown codes', () => {
    expect(getWeatherIconComponent(999)).toBe(Cloud);
    expect(getWeatherIconComponent(Number.NaN)).toBe(Cloud);
  });
});

describe('getWeatherIconAccentClass', () => {
  it('returns distinct accent classes', () => {
    expect(getWeatherIconAccentClass(0)).toMatch(/amber/);
    expect(getWeatherIconAccentClass(95)).toMatch(/violet/);
    expect(getWeatherIconAccentClass(Number.NaN)).toMatch(/zinc/);
  });
});
