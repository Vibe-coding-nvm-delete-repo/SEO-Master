import { describe, expect, it } from 'vitest';
import { buildWeatherInsights } from './weatherInsights';

describe('buildWeatherInsights', () => {
  it('reports next change and rain windows', () => {
    const now = Date.parse('2026-03-27T10:00:00Z');
    const result = buildWeatherInsights(
      0,
      [
        { isoTime: '2026-03-27T10:00:00Z', weatherCode: 0, precipitationProbability: 0 },
        { isoTime: '2026-03-27T11:00:00Z', weatherCode: 1, precipitationProbability: 10 },
        { isoTime: '2026-03-27T14:00:00Z', weatherCode: 61, precipitationProbability: 60 },
      ],
      now,
      'en-US',
    );
    expect(result.changeLine).toContain('Next change in');
    expect(result.holdLine).toContain('Likely stable');
    expect(result.rainLine).toContain('Rain chances');
  });

  it('handles stable and dry forecast', () => {
    const now = Date.parse('2026-03-27T10:00:00Z');
    const result = buildWeatherInsights(
      3,
      [
        { isoTime: '2026-03-27T10:00:00Z', weatherCode: 3, precipitationProbability: 5 },
        { isoTime: '2026-03-27T11:00:00Z', weatherCode: 3, precipitationProbability: 10 },
      ],
      now,
      'en-US',
    );
    expect(result.changeLine).toContain('No major condition change');
    expect(result.rainLine).toContain('Rain not expected');
  });
});
