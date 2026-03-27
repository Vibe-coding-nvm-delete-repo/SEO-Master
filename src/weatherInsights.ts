export type HourlyWeatherPoint = {
  isoTime: string;
  weatherCode: number;
  precipitationProbability: number | null;
};

export type WeatherInsightSummary = {
  holdLine: string;
  changeLine: string;
  rainLine: string;
};

function isRainLikeCode(code: number): boolean {
  if (!Number.isFinite(code)) return false;
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

function formatDurationFromMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatClock(isoTime: string, localeTag: string): string {
  const ts = Date.parse(isoTime);
  if (!Number.isFinite(ts)) return 'later';
  return new Intl.DateTimeFormat(localeTag, { hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}

export function buildWeatherInsights(
  currentCode: number,
  points: HourlyWeatherPoint[],
  nowMs: number,
  localeTag: string,
): WeatherInsightSummary {
  const upcoming = points
    .map((p) => ({ ...p, ts: Date.parse(p.isoTime) }))
    .filter((p) => Number.isFinite(p.ts) && p.ts >= nowMs)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 24);

  if (upcoming.length === 0) {
    return {
      holdLine: 'Current conditions likely hold for the next few hours.',
      changeLine: 'Next change: unavailable.',
      rainLine: 'Rain timing: unavailable.',
    };
  }

  const nextChange = upcoming.find((p) => Number.isFinite(p.weatherCode) && p.weatherCode !== currentCode);
  const holdLine = nextChange
    ? `Likely stable for about ${formatDurationFromMinutes((nextChange.ts - nowMs) / 60000)}.`
    : 'Likely stable through the next 24h.';
  const changeLine = nextChange
    ? `Next change in ${formatDurationFromMinutes((nextChange.ts - nowMs) / 60000)} (${formatClock(nextChange.isoTime, localeTag)}).`
    : 'No major condition change expected in next 24h.';

  const rainy = upcoming
    .filter((p) => {
      const prob = p.precipitationProbability ?? 0;
      return prob >= 35 || isRainLikeCode(p.weatherCode);
    })
    .slice(0, 3);
  const rainLine =
    rainy.length > 0
      ? `Rain chances: ${rainy
          .map((p) => `${formatClock(p.isoTime, localeTag)}${p.precipitationProbability != null ? ` (${Math.round(p.precipitationProbability)}%)` : ''}`)
          .join(', ')}.`
      : 'Rain not expected in next 24h.';

  return { holdLine, changeLine, rainLine };
}
