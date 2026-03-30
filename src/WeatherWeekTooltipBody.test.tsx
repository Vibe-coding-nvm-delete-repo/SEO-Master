import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WeatherWeekTooltipBody from './WeatherWeekTooltipBody';

describe('WeatherWeekTooltipBody', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders summary cards, row badges, and meta sections', () => {
    render(
      <WeatherWeekTooltipBody
        unit="f"
        metaLines={[
          'Updates every 15 minutes · next refresh in 14m 32s.',
          'Likely stable for about 1h 51m.',
          'Next change in 1h 51m (3:00 PM).',
          'Rain not expected in next 24h.',
        ]}
        days={[
          { dateIso: '2026-03-28', weekdayLabel: 'Sat, Mar 28', code: 3, maxDisplay: 43, minDisplay: 31, avgC: 3, precipitationProbabilityMax: 15 },
          { dateIso: '2026-03-29', weekdayLabel: 'Sun, Mar 29', code: 3, maxDisplay: 51, minDisplay: 28, avgC: 6, precipitationProbabilityMax: 25 },
          { dateIso: '2026-03-30', weekdayLabel: 'Mon, Mar 30', code: 61, maxDisplay: 55, minDisplay: 40, avgC: 10, precipitationProbabilityMax: 70 },
        ]}
      />,
    );

    expect(screen.getByText('Weekly outlook')).toBeTruthy();
    expect(screen.getAllByText('Today').length).toBeGreaterThan(0);
    expect(screen.getByText('Warmest')).toBeTruthy();
    expect(screen.getByText('Coolest low')).toBeTruthy();
    expect(screen.getByText('Wettest chance')).toBeTruthy();
    expect(screen.getByText('Weekend')).toBeTruthy();
    expect(screen.getByText('Warming trend')).toBeTruthy();
    expect(screen.getByText('Rain 70%')).toBeTruthy();
    expect(screen.getByText(/Swing 12/)).toBeTruthy();
    expect(screen.getByText(/Refresh cadence/i)).toBeTruthy();
  });
});
