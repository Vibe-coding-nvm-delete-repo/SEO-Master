import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Clock,
  Cloud,
  CloudOff,
  Globe2,
  History,
  Loader2,
  MapPinOff,
  RefreshCw,
  Thermometer,
} from 'lucide-react';
import {
  deriveCloudStatusLine,
  getCollaborationHealthSnapshot,
  getCloudSyncSnapshot,
  resetServerReachOnBrowserOnline,
  subscribeCloudSync,
} from './cloudSyncStatus';
import CloudStatusTooltipBody, { CLOUD_STATUS_TOOLTIP_PANEL_CLASS } from './CloudStatusTooltipBody';
import InlineHelpHint from './InlineHelpHint';
import WeatherLocationBlockedTooltipBody from './WeatherLocationBlockedTooltipBody';
import WeatherWeekTooltipBody, { WEATHER_TOOLTIP_PANEL_CLASS, type WeatherDayRow } from './WeatherWeekTooltipBody';
import { getWeatherCodeLabel } from './weatherCodes';
import { getWeatherIconAccentClass, getWeatherIconComponent } from './weatherIcons';
import { buildWeatherInsights, type HourlyWeatherPoint } from './weatherInsights';
import { celsiusFromDisplay, getTemperatureHueClass } from './weatherTempStyles';
import { shouldUseFahrenheit } from './weatherUnits';
import { subscribeBuildName, subscribeChangelog, type ChangelogEntry } from './changelogStorage';

/** US Eastern — handles EST/EDT automatically. */
const EASTERN_TZ = 'America/New_York';
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

/** Shared size/tone for status-strip row icons (light, minimal). */
const ROW_ICON = 'h-3 w-3 shrink-0 text-zinc-400';

type OpenMeteoCurrentWeather = {
  temperature: number;
  weathercode: number;
};

type OpenMeteoDaily = {
  time: string[];
  weathercode: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max?: number[];
};

type OpenMeteoHourly = {
  time: string[];
  weathercode: number[];
  precipitation_probability: number[];
};

type OpenMeteoResponse = {
  current_weather?: OpenMeteoCurrentWeather;
  daily?: OpenMeteoDaily;
  hourly?: OpenMeteoHourly;
};

export function formatStatusBarNow(now: Date) {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeFmt = (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone,
    });
  const localClock = timeFmt(localTz).format(now);
  const easternClock = timeFmt(EASTERN_TZ).format(now);
  return {
    dateLabel: dateFmt.format(now),
    /** Explicit labels so “this device” vs “US East Coast” is obvious at a glance. */
    localLine: `Local: ${localClock} · ${localTz}`,
    easternLine: `US Eastern (EST/EDT): ${easternClock}`,
  };
}

type WeatherUiState =
  | { kind: 'loading'; phase: 'locating' | 'fetching' }
  | { kind: 'blocked' }
  | { kind: 'unavailable' }
  | {
      kind: 'ready';
      /** WMO code from Open-Meteo (may be NaN if missing). */
      weatherCode: number;
      summaryClass: string;
      summaryText: string;
      fetchedAtMs: number;
      hourlyInsights: {
        holdLine: string;
        changeLine: string;
        rainLine: string;
      };
      days: WeatherDayRow[];
      unit: 'c' | 'f';
    };

type Props = { activeProjectId: string | null };

/**
 * Minimal strip: aggregated cloud line (listeners + project flush queue + last project save)
 * and local / Eastern clocks. Does not claim “all good” from a single listener.
 */
export default function AppStatusBar({ activeProjectId }: Props) {
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [cloudSnap, setCloudSnap] = useState(() => getCloudSyncSnapshot());

  useEffect(() => {
    const unsub = subscribeCloudSync(() => {
      setCloudSnap(getCloudSyncSnapshot());
    });
    return () => {
      unsub();
    };
  }, []);

  const [now, setNow] = useState(() => new Date());
  const [weatherUi, setWeatherUi] = useState<WeatherUiState>({
    kind: 'loading',
    phase: 'locating',
  });
  const [currentBuildName, setCurrentBuildName] = useState('');
  const [latestChangelogEntry, setLatestChangelogEntry] = useState<ChangelogEntry | null>(null);
  const weatherMountedRef = useRef(true);
  const weatherRefreshBusyRef = useRef(false);
  const [weatherRefreshBusy, setWeatherRefreshBusy] = useState(false);

  const refreshWeather = useCallback(async (showLoading: boolean) => {
    if (weatherRefreshBusyRef.current) return;
    weatherRefreshBusyRef.current = true;
    if (weatherMountedRef.current) setWeatherRefreshBusy(true);
    try {
      if (!navigator.geolocation) {
        if (weatherMountedRef.current) setWeatherUi({ kind: 'unavailable' });
        return;
      }
      if (showLoading && weatherMountedRef.current) setWeatherUi({ kind: 'loading', phase: 'locating' });
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          /** Slightly shorter timeout so a blocked/denied prompt fails faster on refresh. */
          timeout: 8000,
          maximumAge: WEATHER_REFRESH_MS,
        });
      }).catch(() => null);

      if (!position) {
        if (weatherMountedRef.current) setWeatherUi({ kind: 'blocked' });
        return;
      }

      if (showLoading && weatherMountedRef.current) setWeatherUi({ kind: 'loading', phase: 'fetching' });

      const { latitude, longitude } = position.coords;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const localeTag = typeof navigator !== 'undefined' ? navigator.language : 'en';
      const useF = shouldUseFahrenheit(timeZone);
      const unit: 'c' | 'f' = useF ? 'f' : 'c';
      const unitSym = useF ? '°F' : '°C';

      const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
      weatherUrl.searchParams.set('latitude', String(latitude));
      weatherUrl.searchParams.set('longitude', String(longitude));
      weatherUrl.searchParams.set('current_weather', 'true');
      weatherUrl.searchParams.set('temperature_unit', useF ? 'fahrenheit' : 'celsius');
      weatherUrl.searchParams.set(
        'daily',
        'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      );
      weatherUrl.searchParams.set('hourly', 'weathercode,precipitation_probability');
      weatherUrl.searchParams.set('forecast_days', '7');
      weatherUrl.searchParams.set('forecast_hours', '24');
      weatherUrl.searchParams.set('timezone', 'auto');

      const response = await fetch(weatherUrl.toString());
      if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
      const payload: OpenMeteoResponse = await response.json();
      const current = payload.current_weather;
      if (
        !current ||
        typeof current.temperature !== 'number' ||
        !Number.isFinite(current.temperature)
      ) {
        throw new Error('Missing current weather payload');
      }
      const roundedTemp = Math.round(current.temperature);
      const code =
        typeof current.weathercode === 'number' && Number.isFinite(current.weathercode)
          ? current.weathercode
          : NaN;
      const weatherLabel = getWeatherCodeLabel(code);
      const tempC = celsiusFromDisplay(current.temperature, unit);
      const summaryClass = getTemperatureHueClass(tempC);

      const daily = payload.daily;
      const dayRows: WeatherDayRow[] = [];
      if (
        daily?.time?.length &&
        daily.weathercode?.length === daily.time.length &&
        daily.temperature_2m_max?.length === daily.time.length &&
        daily.temperature_2m_min?.length === daily.time.length
      ) {
        for (let i = 0; i < daily.time.length; i++) {
          const dateIso = daily.time[i];
          const max = daily.temperature_2m_max[i];
          const min = daily.temperature_2m_min[i];
          const wc = daily.weathercode[i];
          const precipitationProbabilityMax = daily.precipitation_probability_max?.[i];
          if (
            typeof dateIso !== 'string' ||
            typeof max !== 'number' ||
            typeof min !== 'number' ||
            !Number.isFinite(max) ||
            !Number.isFinite(min)
          ) {
            continue;
          }
          const maxC = celsiusFromDisplay(max, unit);
          const minC = celsiusFromDisplay(min, unit);
          const avgC = (maxC + minC) / 2;
          const weekdayLabel = new Intl.DateTimeFormat(localeTag, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          }).format(new Date(`${dateIso}T12:00:00`));
          dayRows.push({
            dateIso,
            weekdayLabel,
            code: typeof wc === 'number' && Number.isFinite(wc) ? wc : NaN,
            maxDisplay: max,
            minDisplay: min,
            avgC,
            precipitationProbabilityMax:
              typeof precipitationProbabilityMax === 'number' &&
              Number.isFinite(precipitationProbabilityMax)
                ? precipitationProbabilityMax
                : null,
          });
        }
      }

      const hourlyPoints: HourlyWeatherPoint[] = [];
      const hourly = payload.hourly;
      if (
        hourly?.time?.length &&
        hourly.weathercode?.length === hourly.time.length &&
        hourly.precipitation_probability?.length === hourly.time.length
      ) {
        for (let i = 0; i < hourly.time.length; i++) {
          const isoTime = hourly.time[i];
          const weatherCode = hourly.weathercode[i];
          const precipitationProbability = hourly.precipitation_probability[i];
          if (typeof isoTime !== 'string') continue;
          hourlyPoints.push({
            isoTime,
            weatherCode:
              typeof weatherCode === 'number' && Number.isFinite(weatherCode) ? weatherCode : NaN,
            precipitationProbability:
              typeof precipitationProbability === 'number' &&
              Number.isFinite(precipitationProbability)
                ? precipitationProbability
                : null,
          });
        }
      }
      const hourlyInsights = buildWeatherInsights(code, hourlyPoints, Date.now(), localeTag);

      if (weatherMountedRef.current) {
        setWeatherUi({
          kind: 'ready',
          weatherCode: code,
          summaryClass,
          summaryText: `Weather: ${roundedTemp}${unitSym} · ${weatherLabel}`,
          fetchedAtMs: Date.now(),
          hourlyInsights,
          days: dayRows,
          unit,
        });
      }
    } catch {
      if (weatherMountedRef.current) setWeatherUi({ kind: 'unavailable' });
    } finally {
      weatherRefreshBusyRef.current = false;
      if (weatherMountedRef.current) setWeatherRefreshBusy(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void refreshWeather(true);
    const weatherIntervalId = window.setInterval(() => {
      void refreshWeather(false);
    }, WEATHER_REFRESH_MS);
    return () => {
      weatherMountedRef.current = false;
      window.clearInterval(weatherIntervalId);
    };
  }, [refreshWeather]);

  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true);
      resetServerReachOnBrowserOnline();
    };
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeBuildName(setCurrentBuildName);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeChangelog((entries) => {
      setLatestChangelogEntry(entries[0] ?? null);
    });
    return unsub;
  }, []);

  const rawPrimaryCloudBusy = activeProjectId
    ? cloudSnap.project.flushDepth > 0 || cloudSnap.project.cloudWritePendingCount > 0
    : cloudSnap.shared.cloudWritePendingCount > 0;
  const [smoothPrimaryCloudBusy, setSmoothPrimaryCloudBusy] = useState(rawPrimaryCloudBusy);

  useLayoutEffect(() => {
    if (rawPrimaryCloudBusy) setSmoothPrimaryCloudBusy(true);
  }, [rawPrimaryCloudBusy]);

  useEffect(() => {
    if (rawPrimaryCloudBusy) return undefined;
    const id = window.setTimeout(() => setSmoothPrimaryCloudBusy(false), 600);
    return () => window.clearTimeout(id);
  }, [rawPrimaryCloudBusy]);

  const { label, tone, detail } = deriveCloudStatusLine(
    browserOnline,
    cloudSnap,
    Boolean(activeProjectId),
    { primaryPipelineAppearsBusy: smoothPrimaryCloudBusy },
  );

  const { dateLabel, localLine, easternLine } = useMemo(() => formatStatusBarNow(now), [now]);

  const cloudTooltip = useMemo(() => {
    return (
      <CloudStatusTooltipBody
        browserOnline={browserOnline}
        snap={cloudSnap}
        collaborationHealth={getCollaborationHealthSnapshot()}
        hasActiveProject={Boolean(activeProjectId)}
        activeProjectId={activeProjectId}
        statusLabel={label}
        statusDetail={detail}
        tone={tone}
      />
    );
  }, [browserOnline, cloudSnap, activeProjectId, label, detail, tone]);

  const buildTooltip = useMemo(() => {
    const latest = latestChangelogEntry;
    return (
      <div className="w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          <History className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden strokeWidth={2} />
          Build Info
        </div>
        <div className="mt-2 text-sm font-semibold text-zinc-900">
          {currentBuildName || 'No build name set'}
        </div>
        {latest ? (
          <div className="mt-2 space-y-1.5 text-xs text-zinc-600">
            <div>
              <span className="font-medium text-zinc-700">Latest update:</span> {latest.summary}
            </div>
            <div>
              <span className="font-medium text-zinc-700">When:</span>{' '}
              {new Date(latest.timestamp).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </div>
            <div>
              <span className="font-medium text-zinc-700">Changes:</span> {latest.changes.length}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-xs text-zinc-500">No changelog entries available yet.</div>
        )}
      </div>
    );
  }, [currentBuildName, latestChangelogEntry]);

  const dotClass =
    tone === 'emerald'
      ? 'bg-emerald-500'
      : tone === 'amber'
        ? 'bg-amber-400'
        : tone === 'rose'
          ? 'bg-rose-500'
          : 'bg-zinc-300';

  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between text-[10px] text-zinc-500 mb-1 pb-1 border-b border-zinc-200/60">
      <InlineHelpHint
        tooltipContent={cloudTooltip}
        ariaLabel={`${label}${detail ? ` ${detail}` : ''}. Hover, focus, or tap for connection details.`}
        triggerRole="group"
        tooltipGap={4}
        tooltipClassName={CLOUD_STATUS_TOOLTIP_PANEL_CLASS}
        data-testid="cloud-status-chip"
        className="inline-flex min-w-0 max-w-full cursor-help rounded-md border border-zinc-200 bg-white px-2 py-1 shadow-sm"
      >
        <div className="flex items-start gap-1.5 min-w-0">
          <span
            className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-white ${dotClass}`}
            aria-hidden
          />
          <div className="flex min-w-0 flex-col gap-0 sm:flex-row sm:items-baseline sm:gap-1.5">
            <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold uppercase tracking-widest text-zinc-400">
              <Cloud className="h-2.5 w-2.5 shrink-0 text-zinc-400" aria-hidden strokeWidth={2} />
              Status
            </span>
            <span className="text-[10px] font-semibold leading-tight text-zinc-800 tracking-tight">
              {label}
              {detail ? (
                <span className="font-medium text-zinc-500"> {detail}</span>
              ) : null}
            </span>
          </div>
        </div>
      </InlineHelpHint>
      <div className="flex flex-wrap items-center sm:justify-end gap-x-2 gap-y-0.5 text-zinc-400 tabular-nums">
        <InlineHelpHint
          tooltipContent={buildTooltip}
          ariaLabel={currentBuildName ? `Current build ${currentBuildName}` : 'Current build not set'}
          triggerRole="group"
          tooltipGap={4}
          data-testid="build-chip"
          className="inline-flex min-w-0 max-w-[min(100vw-2rem,18rem)] cursor-help rounded-md border border-zinc-200 bg-white px-2 py-1 shadow-sm"
        >
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-zinc-500">
            <History className={ROW_ICON} aria-hidden strokeWidth={2} />
            <span className="truncate font-medium">{currentBuildName || 'Build unset'}</span>
          </span>
        </InlineHelpHint>
        <span className="inline-flex items-center gap-1.5 text-zinc-500">
          <CalendarDays className={ROW_ICON} aria-hidden strokeWidth={2} />
          {dateLabel}
        </span>
        <span
          className="inline-flex min-w-0 max-w-[min(100vw-2rem,18rem)] items-center gap-1.5 truncate"
          title="Time from this computer’s clock and timezone settings (not the server)."
        >
          <Clock className={ROW_ICON} aria-hidden strokeWidth={2} />
          <span className="truncate">{localLine}</span>
        </span>
        <span
          className="inline-flex min-w-0 max-w-[min(100vw-2rem,16rem)] items-center gap-1.5 truncate"
          title="US East Coast (America/New_York), including daylight saving (EST vs EDT)."
        >
          <Globe2 className={ROW_ICON} aria-hidden strokeWidth={2} />
          <span className="truncate">{easternLine}</span>
        </span>
        {weatherUi.kind === 'ready' ? (() => {
          const Icon = getWeatherIconComponent(weatherUi.weatherCode);
          const iconAccent = getWeatherIconAccentClass(weatherUi.weatherCode);
          const msUntilRefresh = Math.max(0, weatherUi.fetchedAtMs + WEATHER_REFRESH_MS - now.getTime());
          const mins = Math.floor(msUntilRefresh / 60000);
          const secs = Math.floor((msUntilRefresh % 60000) / 1000);
          const nextRefreshLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          const sinceMs = Math.max(0, now.getTime() - weatherUi.fetchedAtMs);
          const sinceMins = Math.floor(sinceMs / 60000);
          const updatedAgo = sinceMins <= 0 ? 'updated just now' : `updated ${sinceMins}m ago`;
          const weatherTooltip = (
            <WeatherWeekTooltipBody
              days={weatherUi.days}
              unit={weatherUi.unit}
              metaLines={[
                `Updates every 15 minutes · next refresh in ${nextRefreshLabel}.`,
                weatherUi.hourlyInsights.holdLine,
                weatherUi.hourlyInsights.changeLine,
                weatherUi.hourlyInsights.rainLine,
              ]}
            />
          );
          return (
            <InlineHelpHint
              tooltipContent={weatherTooltip}
              ariaLabel={`${weatherUi.summaryText}. Hover, focus, or tap for 7-day forecast.`}
              triggerRole="group"
              tooltipGap={4}
              tooltipClassName={WEATHER_TOOLTIP_PANEL_CLASS}
              className="inline-flex min-w-0 max-w-[min(100vw-2rem,27rem)] cursor-help rounded-md border border-zinc-200/80 bg-white/60 px-1.5 py-0.5"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5" title={`Weather ${updatedAgo}. Refreshes every 15 minutes.`}>
                <Thermometer className={ROW_ICON} aria-hidden strokeWidth={2} />
                <Icon
                  className={`h-3 w-3 shrink-0 ${iconAccent}`}
                  aria-hidden
                  strokeWidth={2}
                />
                <span className={`font-semibold min-w-0 truncate ${weatherUi.summaryClass}`}>
                  {weatherUi.summaryText.replace(/^Weather:\s*/, '')}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-sky-200/80 bg-sky-50/80 px-1 py-[1px] text-[9px] font-medium text-sky-700">
                  <RefreshCw className="h-2.5 w-2.5" aria-hidden strokeWidth={2} />
                  Next {nextRefreshLabel}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void refreshWeather(false);
                  }}
                  disabled={weatherRefreshBusy}
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-zinc-200 bg-white/90 px-1 py-[1px] text-[9px] font-medium text-zinc-700 disabled:opacity-60"
                  title="Refresh weather now"
                  aria-label="Refresh weather now"
                >
                  <RefreshCw
                    className={`h-2.5 w-2.5 ${weatherRefreshBusy ? 'animate-spin' : ''}`}
                    aria-hidden
                    strokeWidth={2}
                  />
                  Refresh
                </button>
              </span>
            </InlineHelpHint>
          );
        })() : weatherUi.kind === 'loading' ? (
          <span
            className="inline-flex min-w-0 max-w-[min(100vw-2rem,19rem)] items-center gap-2 rounded-md border border-dashed border-sky-200/80 bg-gradient-to-r from-sky-50/90 via-white to-zinc-50/80 px-2 py-0.5 shadow-sm ring-1 ring-sky-100/60"
            aria-busy
            aria-live="polite"
          >
            <Thermometer className={`${ROW_ICON} text-sky-600`} aria-hidden strokeWidth={2} />
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin text-sky-600"
              aria-hidden
              strokeWidth={2}
            />
            <span className="truncate text-[10px] font-medium text-zinc-600">
              {weatherUi.phase === 'locating' ? 'Finding your location…' : 'Loading forecast…'}
            </span>
          </span>
        ) : weatherUi.kind === 'blocked' ? (
          <InlineHelpHint
            tooltipContent={<WeatherLocationBlockedTooltipBody />}
            ariaLabel="Location blocked. Hover, focus, or tap for steps to enable location in Chrome, Edge, Safari, or Firefox on Windows or Mac."
            triggerRole="group"
            tooltipGap={4}
            tooltipClassName={WEATHER_TOOLTIP_PANEL_CLASS}
            className="inline-flex min-w-0 max-w-[min(100vw-2rem,18rem)] cursor-help rounded-md border border-amber-200/90 bg-amber-50/60 px-2 py-0.5 ring-1 ring-amber-100/70"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              <MapPinOff className={`${ROW_ICON} text-amber-700`} aria-hidden strokeWidth={2} />
              <span className="truncate text-[10px] font-medium text-amber-900/90">
                Location blocked — hover for help
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void refreshWeather(true);
                }}
                disabled={weatherRefreshBusy}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-amber-200 bg-white/90 px-1 py-[1px] text-[9px] font-medium text-amber-900 disabled:opacity-60"
                title="Retry weather lookup now"
                aria-label="Retry weather lookup now"
              >
                <RefreshCw
                  className={`h-2.5 w-2.5 ${weatherRefreshBusy ? 'animate-spin' : ''}`}
                  aria-hidden
                  strokeWidth={2}
                />
                Retry
              </button>
            </span>
          </InlineHelpHint>
        ) : (
          <span
            className="inline-flex min-w-0 max-w-[min(100vw-2rem,19rem)] items-center gap-1.5 text-zinc-400"
            title="Weather couldn’t load. Check your connection and try refreshing."
          >
            <CloudOff className={ROW_ICON} aria-hidden strokeWidth={2} />
            <span className="min-w-0 truncate">Weather: unavailable</span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void refreshWeather(true);
              }}
              disabled={weatherRefreshBusy}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-zinc-200 bg-white/90 px-1 py-[1px] text-[9px] font-medium text-zinc-700 disabled:opacity-60"
              title="Retry weather lookup now"
              aria-label="Retry weather lookup now"
            >
              <RefreshCw
                className={`h-2.5 w-2.5 ${weatherRefreshBusy ? 'animate-spin' : ''}`}
                aria-hidden
                strokeWidth={2}
              />
              Retry
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
