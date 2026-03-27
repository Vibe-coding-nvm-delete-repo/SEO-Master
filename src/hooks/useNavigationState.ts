/**
 * Main tab + Group sub-tab + Settings sub-tab state, URL navigators, and legacy path canonicalization.
 * P1.1 — extracted from App.tsx; behavior must match the previous inline implementation.
 *
 * `activeProjectIdRef` / `projectsRef` are owned by App and synced after `useProjectPersistence`
 * so this hook can run at the top of App without reordering hooks relative to persistence.
 */

import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import type { Project } from '../types';
import {
  parseAppPath,
  buildMainPath,
  APP_BASE_PATH,
  type MainTab,
  type GroupSubTab,
  type SettingsSubTab,
} from '../appRouting';
import { projectUrlKey } from '../projectUrlKey';

export interface UseNavigationStateInput {
  activeProjectIdRef: MutableRefObject<string | null>;
  projectsRef: MutableRefObject<Project[]>;
}

export function useNavigationState({ activeProjectIdRef, projectsRef }: UseNavigationStateInput) {
  const [mainTab, setMainTab] = useState<MainTab>(() => {
    if (typeof window === 'undefined') return 'group';
    return parseAppPath(window.location.pathname).mainTab;
  });
  const [groupSubTab, setGroupSubTab] = useState<GroupSubTab>(() => {
    if (typeof window === 'undefined') return 'projects';
    return parseAppPath(window.location.pathname).groupSubTab ?? 'projects';
  });
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>(() => {
    if (typeof window === 'undefined') return 'general';
    return parseAppPath(window.location.pathname).settingsSubTab ?? 'general';
  });

  const navigateMainTab = useCallback((tab: MainTab) => {
    setMainTab(tab);
    const path =
      tab === 'group'
        ? buildMainPath('group', 'projects')
        : tab === 'generate'
          ? buildMainPath('generate')
          : tab === 'feedback'
            ? buildMainPath('feedback')
            : buildMainPath('feature-ideas');
    if (typeof window !== 'undefined') {
      const cur = window.location.pathname.replace(/\/$/, '') || '/';
      const next = path.replace(/\/$/, '') || '/';
      if (cur !== next) {
        window.history.pushState({ kwgMainTab: tab }, '', path);
      }
    }
  }, []);

  // Canonicalize legacy URLs to /seo-magic/group/... and top-level slugs
  useEffect(() => {
    const p = window.location.pathname.replace(/\/$/, '') || '/';
    const base = APP_BASE_PATH;
    if (p === '/feedback') {
      window.history.replaceState({}, '', `${base}/feedback`);
      return;
    }
    if (p === '/generate') {
      window.history.replaceState({}, '', `${base}/generate`);
      return;
    }
    if (p === '/feature-ideas') {
      window.history.replaceState({}, '', `${base}/feature-ideas`);
      return;
    }
    if (p === '/' || p === '') {
      window.history.replaceState({}, '', `${base}/group/projects`);
      return;
    }
    if (p === base || p === `${base}/`) {
      window.history.replaceState({}, '', `${base}/group/projects`);
      return;
    }
    if (p === '/log' || p === `${base}/log`) {
      window.history.replaceState({}, '', `${base}/group/log`);
      return;
    }
    if (p === '/settings' || p === `${base}/settings`) {
      window.history.replaceState({}, '', buildMainPath('group', 'settings', undefined, 'general'));
      return;
    }
    if (p === `${base}/group/settings` || p === `${base}/group/settings/`) {
      window.history.replaceState({}, '', buildMainPath('group', 'settings', undefined, 'general'));
    }
  }, []);

  const navigateGroupSub = useCallback((sub: GroupSubTab) => {
    setMainTab('group');
    setGroupSubTab(sub);
    const activeProjectId = activeProjectIdRef.current;
    const projects = projectsRef.current;
    let path: string;
    if (sub === 'data' && activeProjectId) {
      const proj = projects.find((p) => p.id === activeProjectId);
      const key = proj ? projectUrlKey(proj) : activeProjectId;
      path = buildMainPath('group', 'data', key);
    } else if (sub === 'settings') {
      path = buildMainPath('group', 'settings', undefined, settingsSubTab ?? 'general');
    } else {
      path = buildMainPath('group', sub);
    }
    if (typeof window !== 'undefined') {
      const cur = window.location.pathname.replace(/\/$/, '') || '/';
      const next = path.replace(/\/$/, '') || '/';
      if (cur !== next) {
        window.history.pushState({ kwgGroupSub: sub }, '', path);
      }
    }
  }, [activeProjectIdRef, projectsRef, settingsSubTab]);

  const navigateSettingsSub = useCallback((st: SettingsSubTab) => {
    setMainTab('group');
    setGroupSubTab('settings');
    setSettingsSubTab(st);
    const path = buildMainPath('group', 'settings', undefined, st);
    if (typeof window !== 'undefined') {
      const cur = window.location.pathname.replace(/\/$/, '') || '/';
      const next = path.replace(/\/$/, '') || '/';
      if (cur !== next) {
        window.history.pushState({ kwgSettingsSub: st }, '', path);
      }
    }
  }, []);

  return {
    mainTab,
    setMainTab,
    groupSubTab,
    setGroupSubTab,
    settingsSubTab,
    setSettingsSubTab,
    navigateMainTab,
    navigateGroupSub,
    navigateSettingsSub,
  };
}
