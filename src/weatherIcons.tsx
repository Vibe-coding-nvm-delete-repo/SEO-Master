import type { LucideIcon } from 'lucide-react';
import {
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Sun,
} from 'lucide-react';

/** Lucide icon for WMO weather code (Open-Meteo). */
export function getWeatherIconComponent(code: number): LucideIcon {
  if (!Number.isFinite(code)) return Cloud;
  if (code === 0) return Sun;
  if (code >= 1 && code <= 2) return CloudSun;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 57) return CloudDrizzle;
  if (code >= 61 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 80 && code <= 82) return CloudSunRain;
  if (code >= 85 && code <= 86) return CloudSnow;
  if (code >= 95 && code <= 99) return CloudLightning;
  return Cloud;
}

/** Tailwind `text-*` for SVG stroke (icons use currentColor). Distinct at a glance. */
export function getWeatherIconAccentClass(code: number): string {
  if (!Number.isFinite(code)) return 'text-zinc-400';
  if (code === 0) return 'text-amber-500';
  if (code >= 1 && code <= 2) return 'text-amber-600';
  if (code === 3) return 'text-zinc-500';
  if (code === 45 || code === 48) return 'text-slate-500';
  if (code >= 51 && code <= 57) return 'text-sky-600';
  if (code >= 61 && code <= 67) return 'text-sky-700';
  if (code >= 71 && code <= 77) return 'text-sky-600';
  if (code >= 80 && code <= 82) return 'text-sky-600';
  if (code >= 85 && code <= 86) return 'text-sky-600';
  if (code >= 95 && code <= 99) return 'text-violet-600';
  return 'text-zinc-500';
}
