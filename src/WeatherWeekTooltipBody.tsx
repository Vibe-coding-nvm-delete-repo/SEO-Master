import React, { useMemo } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Clock3, CloudRain, RefreshCw, Timer } from 'lucide-react';
import { getWeatherCodeLabel } from './weatherCodes';
import { getWeatherIconAccentClass, getWeatherIconComponent } from './weatherIcons';
import { getTemperatureHueClass } from './weatherTempStyles';

export type WeatherDayRow = {
  dateIso: string;
  weekdayLabel: string;
  code: number;
  maxDisplay: number;
  minDisplay: number;
  /** For hue only (deg C). */
  avgC: number;
  precipitationProbabilityMax: number | null;
};

export const WEATHER_TOOLTIP_PANEL_CLASS =
  'z-[100] w-[min(34rem,calc(100vw-1rem))] min-w-[22rem] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/95 shadow-xl backdrop-blur-sm pointer-events-none';

type Props = {
  days: WeatherDayRow[];
  unit: 'c' | 'f';
  metaLines?: string[];
};

type TrendVisual = {
  Icon: typeof ArrowUp;
  label: string;
  toneClass: string;
};

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTrendVisual(startAvgC: number, endAvgC: number): TrendVisual {
  const delta = endAvgC - startAvgC;
  if (delta >= 2) {
    return {
      Icon: ArrowUp,
      label: 'Warming trend',
      toneClass: 'border-amber-200/80 bg-amber-50 text-amber-900',
    };
  }
  if (delta <= -2) {
    return {
      Icon: ArrowDown,
      label: 'Cooling trend',
      toneClass: 'border-sky-200/80 bg-sky-50 text-sky-900',
    };
  }
  return {
    Icon: ArrowRight,
    label: 'Steady trend',
    toneClass: 'border-zinc-200 bg-zinc-50 text-zinc-800',
  };
}

export default function WeatherWeekTooltipBody({ days, unit, metaLines = [] }: Props) {
  const sym = unit === 'f' ? '°F' : '°C';
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const metaVisuals = [
    {
      icon: RefreshCw,
      toneClass: 'border-sky-200/80 bg-sky-50/80 text-sky-950',
      textClass: 'text-sky-800',
    },
    {
      icon: Timer,
      toneClass: 'border-emerald-200/80 bg-emerald-50/80 text-emerald-950',
      textClass: 'text-emerald-800',
    },
    {
      icon: Clock3,
      toneClass: 'border-violet-200/80 bg-violet-50/80 text-violet-950',
      textClass: 'text-violet-800',
    },
    {
      icon: CloudRain,
      toneClass: 'border-blue-200/80 bg-blue-50/80 text-blue-950',
      textClass: 'text-blue-800',
    },
  ];

  const range = useMemo(() => {
    const low = Math.min(...days.map((d) => d.minDisplay));
    const high = Math.max(...days.map((d) => d.maxDisplay));
    const spread = Math.max(1, high - low);
    return { low, high, spread };
  }, [days]);

  const weekSummary = useMemo(() => {
    if (days.length === 0) return null;
    const today = days.find((d) => d.dateIso === todayKey) ?? days[0];
    const warmest = days.reduce((best, current) =>
      current.maxDisplay > best.maxDisplay ? current : best,
    );
    const coolest = days.reduce((best, current) =>
      current.minDisplay < best.minDisplay ? current : best,
    );
    const wettest = days.reduce((best, current) => {
      const bestChance = best.precipitationProbabilityMax ?? -1;
      const currentChance = current.precipitationProbabilityMax ?? -1;
      return currentChance > bestChance ? current : best;
    });
    const trend = getTrendVisual(days[0].avgC, days[days.length - 1].avgC);
    return { today, warmest, coolest, wettest, trend };
  }, [days, todayKey]);

  const primaryMeta = metaLines[0] ?? null;
  const secondaryMeta = primaryMeta ? metaLines.slice(1) : metaLines;
  const TrendIcon = weekSummary?.trend.Icon;

  return (
    <div className="bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_38%),linear-gradient(180deg,_rgba(250,250,250,0.94),_rgba(255,255,255,0.98))] p-3.5">
      <div className="rounded-xl border border-zinc-200/80 bg-white/90 px-3 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              7-day forecast
            </div>
            <div className="mt-1 text-[12px] font-semibold tracking-tight text-zinc-900">
              Weekly outlook
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              Cleaner scan of highs, lows, and likely shifts.
            </div>
          </div>
          {weekSummary ? (
            <div
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-semibold ${weekSummary.trend.toneClass}`}
            >
              {TrendIcon ? <TrendIcon className="h-3 w-3" aria-hidden strokeWidth={2} /> : null}
              {weekSummary.trend.label}
            </div>
          ) : null}
        </div>

        {weekSummary ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-2.5 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
                Today
              </div>
              <div className="mt-1 text-[11px] font-semibold text-zinc-900">
                {weekSummary.today.weekdayLabel}
              </div>
              <div className={`text-[10px] font-semibold ${getTemperatureHueClass(weekSummary.today.avgC)}`}>
                {Math.round(weekSummary.today.maxDisplay)}
                {sym}
                <span className="mx-1 text-zinc-300">/</span>
                {Math.round(weekSummary.today.minDisplay)}
                {sym}
              </div>
            </div>
            <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-2.5 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-700/70">
                Warmest
              </div>
              <div className="mt-1 text-[11px] font-semibold text-zinc-900">
                {weekSummary.warmest.weekdayLabel}
              </div>
              <div className={`text-[10px] font-semibold ${getTemperatureHueClass(weekSummary.warmest.avgC)}`}>
                High {Math.round(weekSummary.warmest.maxDisplay)}
                {sym}
              </div>
            </div>
            <div className="rounded-lg border border-sky-200/70 bg-sky-50/70 px-2.5 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-sky-700/70">
                Coolest low
              </div>
              <div className="mt-1 text-[11px] font-semibold text-zinc-900">
                {weekSummary.coolest.weekdayLabel}
              </div>
              <div className={`text-[10px] font-semibold ${getTemperatureHueClass(weekSummary.coolest.avgC)}`}>
                Low {Math.round(weekSummary.coolest.minDisplay)}
                {sym}
              </div>
            </div>
            <div className="rounded-lg border border-blue-200/70 bg-blue-50/70 px-2.5 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-blue-700/70">
                Wettest chance
              </div>
              <div className="mt-1 text-[11px] font-semibold text-zinc-900">
                {weekSummary.wettest.weekdayLabel}
              </div>
              <div className="text-[10px] font-semibold text-blue-800">
                {weekSummary.wettest.precipitationProbabilityMax != null
                  ? `${Math.round(weekSummary.wettest.precipitationProbabilityMax)}% precip`
                  : 'No precip signal'}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {primaryMeta ? (
        <div className="mt-3 rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2.5 shadow-sm">
          <div className="flex items-start gap-2">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700" aria-hidden strokeWidth={2} />
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-sky-700/70">
                Refresh cadence
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-sky-900">{primaryMeta}</div>
            </div>
          </div>
        </div>
      ) : null}

      {secondaryMeta.length > 0 ? (
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-3">
          {secondaryMeta.map((line, index) => {
            const visual = metaVisuals[Math.min(index + 1, metaVisuals.length - 1)];
            const MetaIcon = visual.icon;
            return (
              <div
                key={line}
                className={`rounded-lg border px-2.5 py-2 shadow-sm ${visual.toneClass}`}
              >
                <div className="flex items-start gap-1.5">
                  <MetaIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
                  <div className={`text-[10px] leading-snug ${visual.textClass}`}>{line}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {days.length === 0 ? (
          <div className="rounded-xl border border-zinc-200/80 bg-white/85 px-3 py-2 text-[10px] text-zinc-500 shadow-sm">
            7-day forecast rows unavailable for this location.
          </div>
        ) : null}
        {days.map((d) => {
          const DayIcon = getWeatherIconComponent(d.code);
          const dayIconAccent = getWeatherIconAccentClass(d.code);
          const date = new Date(`${d.dateIso}T12:00:00`);
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const isToday = d.dateIso === todayKey;
          const precipChance = d.precipitationProbabilityMax;
          const tempSwing = Math.round(d.maxDisplay - d.minDisplay);
          const leftPct = ((d.minDisplay - range.low) / range.spread) * 100;
          const widthPct = ((d.maxDisplay - d.minDisplay) / range.spread) * 100;
          return (
            <div
              key={d.dateIso}
              className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 rounded-xl border border-zinc-200/80 bg-white/90 px-3 py-2.5 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200/80 bg-zinc-50">
                    <DayIcon
                      className={`h-4 w-4 shrink-0 ${dayIconAccent}`}
                      aria-hidden
                      strokeWidth={2}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-zinc-900">{d.weekdayLabel}</span>
                      {isToday ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-sky-800">
                          Today
                        </span>
                      ) : null}
                      {!isToday && isWeekend ? (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-violet-800">
                          Weekend
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                      {getWeatherCodeLabel(d.code)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {precipChance != null ? (
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
                            precipChance >= 50
                              ? 'border-blue-200 bg-blue-50 text-blue-800'
                              : precipChance >= 20
                                ? 'border-sky-200 bg-sky-50 text-sky-800'
                                : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                          }`}
                        >
                          Rain {Math.round(precipChance)}%
                        </span>
                      ) : null}
                      <span className="rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-zinc-600">
                        Swing {tempSwing}
                        {sym}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col items-end gap-1">
                <div className="text-[11px] font-semibold tabular-nums text-zinc-900">
                  <span className={getTemperatureHueClass(d.avgC)}>
                    {Math.round(d.maxDisplay)}
                    {sym}
                  </span>
                  <span className="mx-1 text-zinc-300">/</span>
                  <span className="text-zinc-500">
                    {Math.round(d.minDisplay)}
                    {sym}
                  </span>
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`absolute top-0 h-full rounded-full ${getTemperatureHueClass(d.avgC).includes('text-') ? 'bg-current' : 'bg-zinc-400'} ${getTemperatureHueClass(d.avgC)}`}
                    style={{
                      left: `${Math.max(0, Math.min(100, leftPct))}%`,
                      width: `${Math.max(10, Math.min(100 - leftPct, widthPct || 10))}%`,
                    }}
                  />
                </div>
                <div className="flex w-full justify-between text-[8px] font-medium uppercase tracking-wide text-zinc-400">
                  <span>{Math.round(range.low)}</span>
                  <span>{Math.round(range.high)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
