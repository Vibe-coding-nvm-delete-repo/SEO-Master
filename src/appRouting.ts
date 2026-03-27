/**
 * URL routing for the Group tab and cross-app navigation (/seo-magic/...).
 * Extracted from App.tsx for useProjectLifecycle and tests.
 */

export type MainTab = 'group' | 'generate' | 'feedback' | 'feature-ideas';

/** Group area sub-routes (under /seo-magic/group/...). */
export type GroupSubTab = 'data' | 'projects' | 'topics' | 'settings' | 'log';

/** Settings screen sub-tabs (path under /seo-magic/group/settings/...). */
export type SettingsSubTab = 'general' | 'how-it-works' | 'dictionaries' | 'blocked';

/** URL segment for this app (matches SEO Magic branding). */
export const APP_URL_SLUG = 'seo-magic';
export const APP_BASE_PATH = `/${APP_URL_SLUG}`;

const SETTINGS_TAB_TO_SEG: Record<SettingsSubTab, string> = {
  general: 'general',
  'how-it-works': 'how-it-works',
  dictionaries: 'dictionaries',
  blocked: 'blocked',
};

function settingsSegToTab(seg: string): SettingsSubTab | null {
  const map: Record<string, SettingsSubTab> = {
    general: 'general',
    'how-it-works': 'how-it-works',
    dictionaries: 'dictionaries',
    blocked: 'blocked',
  };
  return map[seg] ?? null;
}

export interface ParsedAppLocation {
  mainTab: MainTab;
  groupSubTab: GroupSubTab | null;
  dataRouteProjectKey: string | null;
  settingsSubTab: SettingsSubTab | null;
}

/** Parse pathname into main tab, group sub-tab, and optional data-route project key. */
export function parseAppPath(pathname: string): ParsedAppLocation {
  const p = pathname.replace(/\/$/, '') || '/';
  const base = APP_BASE_PATH;

  if (p === `${base}/feedback` || p === '/feedback') {
    return { mainTab: 'feedback', groupSubTab: null, dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${base}/feature-ideas` || p === '/feature-ideas') {
    return { mainTab: 'feature-ideas', groupSubTab: null, dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${base}/generate` || p === '/generate') {
    return { mainTab: 'generate', groupSubTab: null, dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${base}/log` || p === '/log') {
    return { mainTab: 'group', groupSubTab: 'log', dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${base}/settings` || p === '/settings') {
    return { mainTab: 'group', groupSubTab: 'settings', dataRouteProjectKey: null, settingsSubTab: 'general' };
  }

  const groupPrefix = `${base}/group`;
  if (p === groupPrefix || p === `${groupPrefix}/`) {
    return { mainTab: 'group', groupSubTab: 'projects', dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${groupPrefix}/projects`) {
    return { mainTab: 'group', groupSubTab: 'projects', dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${groupPrefix}/topics`) {
    return { mainTab: 'group', groupSubTab: 'topics', dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${groupPrefix}/settings` || p === `${groupPrefix}/settings/`) {
    return { mainTab: 'group', groupSubTab: 'settings', dataRouteProjectKey: null, settingsSubTab: 'general' };
  }
  if (p.startsWith(`${groupPrefix}/settings/`)) {
    const rest = p.slice(`${groupPrefix}/settings/`.length);
    const seg = (rest.split('/')[0] || 'general').trim();
    const st = settingsSegToTab(seg) ?? 'general';
    return { mainTab: 'group', groupSubTab: 'settings', dataRouteProjectKey: null, settingsSubTab: st };
  }
  if (p === `${groupPrefix}/log`) {
    return { mainTab: 'group', groupSubTab: 'log', dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p === `${groupPrefix}/data`) {
    return { mainTab: 'group', groupSubTab: 'data', dataRouteProjectKey: null, settingsSubTab: null };
  }
  if (p.startsWith(`${groupPrefix}/data/`)) {
    const raw = p.slice(`${groupPrefix}/data/`.length);
    try {
      const key = decodeURIComponent(raw) || null;
      return { mainTab: 'group', groupSubTab: 'data', dataRouteProjectKey: key, settingsSubTab: null };
    } catch {
      return { mainTab: 'group', groupSubTab: 'data', dataRouteProjectKey: raw || null, settingsSubTab: null };
    }
  }

  if (p === base || p === `${base}/`) {
    return { mainTab: 'group', groupSubTab: 'projects', dataRouteProjectKey: null, settingsSubTab: null };
  }

  return { mainTab: 'group', groupSubTab: 'projects', dataRouteProjectKey: null, settingsSubTab: null };
}

export function pathToMainTab(pathname: string): MainTab {
  return parseAppPath(pathname).mainTab;
}

export function buildMainPath(
  tab: MainTab,
  groupSub?: GroupSubTab,
  dataProjectKey?: string | null,
  settingsSub?: SettingsSubTab | null,
): string {
  if (tab === 'feedback') return `${APP_BASE_PATH}/feedback`;
  if (tab === 'generate') return `${APP_BASE_PATH}/generate`;
  if (tab === 'feature-ideas') return `${APP_BASE_PATH}/feature-ideas`;
  const g = groupSub ?? 'projects';
  if (g === 'data') {
    if (dataProjectKey) {
      return `${APP_BASE_PATH}/group/data/${encodeURIComponent(dataProjectKey)}`;
    }
    return `${APP_BASE_PATH}/group/data`;
  }
  if (g === 'settings') {
    const st = settingsSub ?? 'general';
    return `${APP_BASE_PATH}/group/settings/${SETTINGS_TAB_TO_SEG[st]}`;
  }
  return `${APP_BASE_PATH}/group/${g}`;
}
