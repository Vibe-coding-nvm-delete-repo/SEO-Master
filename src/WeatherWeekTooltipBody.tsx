import React from 'react';
import { Clock3, CloudRain, RefreshCw, Timer } from 'lucide-react';
import { getWeatherCodeLabel } from './weatherCodes';
import { getWeatherIconAccentClass, getWeatherIconComponent } from './weatherIcons';
import { getTemperatureHueClass } from './weatherTempStyles';

export type WeatherDayRow = {
  dateIso: string;
  weekdayLabel: string;
  code: number;
  maxDisplay: number;
  minDisplay: number;
  /** For hue only (°C). */
  avgC: number;
};

export const WEATHER_TOOLTIP_PANEL_CLASS =
  'z-[100] bg-white border border-zinc-200 rounded-xl shadow-md w-[min(31.5rem,calc(100vw-1rem))] min-w-[22rem] sm:min-w-[22.5rem] overflow-hidden pointer-events-none';

type Props = {
  days: WeatherDayRow[];
  unit: 'c' | 'f';
  metaLines?: string[];
};

export default function WeatherWeekTooltipBody({ days, unit, metaLines = [] }: Props) {
  const sym = unit === 'f' ? '°F' : '°C';
  const metaVisuals = [
    {
      icon: RefreshCw,
      toneClass: 'border-sky-100 bg-sky-50/70 text-sky-900',
      textClass: 'text-sky-800',
    },
    {
      icon: Timer,
      toneClass: 'border-emerald-100 bg-emerald-50/70 text-emerald-900',
      textClass: 'text-emerald-800',
    },
    {
      icon: Clock3,
      toneClass: 'border-violet-100 bg-violet-50/70 text-violet-900',
      textClass: 'text-violet-800',
    },
    {
      icon: CloudRain,
      toneClass: 'border-blue-100 bg-blue-50/70 text-blue-900',
      textClass: 'text-blue-800',
    },
  ];

  return (
    <div className="p-3.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 mb-2.5">
        7-day forecast
      </div>
      {metaLines.length > 0 && (
        <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
          {metaLines.map((line, index) => {
            const visual = metaVisuals[index] ?? metaVisuals[metaVisuals.length - 1];
            const MetaIcon = visual.icon;
            return (
              <div
                key={line}
                className={`rounded-md border px-2 py-1.5 ${visual.toneClass}`}
              >
                <div className="flex items-start gap-1.5">
                  <MetaIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
                  <div className={`text-[10px] leading-snug ${visual.textClass}`}>{line}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {days.length === 0 && (
          <div className="rounded-md border border-zinc-100 bg-zinc-50/80 px-1.5 py-1 text-[10px] text-zinc-500">
            7-day forecast rows unavailable for this location.
          </div>
        )}
        {days.map((d) => {
          const DayIcon = getWeatherIconComponent(d.code);
          const dayIconAccent = getWeatherIconAccentClass(d.code);
          return (
            <div
              key={d.dateIso}
              className="grid grid-cols-[auto_5.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/80 px-2 py-1.5"
            >
              <DayIcon
                className={`h-4 w-4 shrink-0 ${dayIconAccent}`}
                aria-hidden
                strokeWidth={2}
              />
              <span className="w-[5.25rem] shrink-0 text-[10px] font-semibold text-zinc-700">
                {d.weekdayLabel}
              </span>
              <span className="min-w-0 whitespace-normal break-words pr-1 text-[10px] leading-snug text-zinc-600">
                {getWeatherCodeLabel(d.code)}
              </span>
              <span
                className={`shrink-0 rounded-sm border border-zinc-200/80 bg-white/80 px-1.5 py-0.5 text-[10px] tabular-nums font-semibold ${getTemperatureHueClass(d.avgC)}`}
              >
                {Math.round(d.maxDisplay)}
                {sym}
                <span className="text-zinc-400 font-normal"> / </span>
                {Math.round(d.minDisplay)}
                {sym}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
