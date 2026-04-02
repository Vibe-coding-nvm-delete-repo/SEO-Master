/**
 * Project list + create/select/delete/load + Firestore listeners + URL/popstate.
 * P1.1 — extracted from App.tsx; behavior must match the previous inline implementation.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
} from '../cloudSyncStatus';
import type { Project } from '../types';
import {
  deleteFromIDB,
  deleteProjectDataFromFirestore,
  loadProjectsBootstrapState,
} from '../projectStorage';
import { deleteProjectV2Data } from '../projectCollabV2';
import { SHARED_PROJECT_DESCRIPTION } from '../projectSharing';
import { loadSavedWorkspacePrefs } from '../projectWorkspace';
import { parseAppPath, buildMainPath, type MainTab, type GroupSubTab, type SettingsSubTab } from '../appRouting';
import { projectUrlKey, projectUrlKeySuffixFromId } from '../projectUrlKey';
import { isUsableActiveProjectId } from '../projectLifecyclePolicy';
import { advanceGeneration } from '../collabV2WriteGuard';
import { beginRuntimeTrace, traceRuntimeEvent } from '../runtimeTrace';
import {
  deleteProjectMetadata,
  persistProjectMetadata,
  reviveProjectMetadata,
  softDeleteProjectMetadata,
  subscribeProjectsCollection,
} from '../projectMetadataCollab';

export interface UseProjectLifecycleInput {
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  activeProjectId: string | null;
  activeProjectIdRef: MutableRefObject<string | null>;
  setActiveProjectId: (id: string | null) => void;
  loadProject: (projectId: string, projects: Project[]) => Promise<void>;
  clearProject: () => void;
  syncFileNameLocal: (name: string | null) => void;
  mainTab: MainTab;
  groupSubTab: GroupSubTab;
  setMainTab: Dispatch<SetStateAction<MainTab>>;
  setGroupSubTab: Dispatch<SetStateAction<GroupSubTab>>;
  setSettingsSubTab: Dispatch<SetStateAction<SettingsSubTab>>;
  setIsProjectLoading: (v: boolean) => void;
  setIsAuthReady: (v: boolean) => void;
  setSavedClusters: Dispatch<SetStateAction<any[]>>;
  newProjectName: string;
  newProjectDescription: string;
  setNewProjectName: (v: string) => void;
  setNewProjectDescription: (v: string) => void;
  setProjectError: (v: string | null) => void;
  setIsCreatingProject: (v: boolean) => void;
  canChangeProject?: () => boolean;
  onProjectChangeBlocked?: () => void;
}

export function useProjectLifecycle(input: UseProjectLifecycleInput) {
  const {
    projects,
    setProjects,
    activeProjectId,
    activeProjectIdRef,
    setActiveProjectId,
    loadProject,
    clearProject,
    syncFileNameLocal,
    mainTab,
    groupSubTab,
    setMainTab,
    setGroupSubTab,
    setSettingsSubTab,
    setIsProjectLoading,
    setIsAuthReady,
    setSavedClusters,
    newProjectName,
    newProjectDescription,
    setNewProjectName,
    setNewProjectDescription,
    setProjectError,
    setIsCreatingProject,
    canChangeProject,
    onProjectChangeBlocked,
  } = input;

  const allowProjectChange = useCallback(() => {
    if (canChangeProject?.() === false) {
      onProjectChangeBlocked?.();
      return false;
    }
    return true;
  }, [canChangeProject, onProjectChangeBlocked]);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const getProjectKeyFromUrl = useCallback((): string | null => {
    try {
      const pathKey = parseAppPath(window.location.pathname).dataRouteProjectKey;
      if (pathKey) return pathKey;
      return new URLSearchParams(window.location.search).get('project');
    } catch {
      return null;
    }
  }, []);

  const resolveProjectIdFromUrlKey = useCallback((projectKey: string | null, projectList: Project[]): string | null => {
    if (!projectKey) return null;
    if (projectList.some(project => project.id === projectKey)) return projectKey;
    // Exact match: most reliable (name + id-derived suffix).
    const matchedExact = projectList.find(project => projectUrlKey(project) === projectKey);
    if (matchedExact) return matchedExact.id;

    // Fallback match: resolve by id-derived suffix only.
    // This prevents “link stops working” when project name changes.
    const suffix = projectKey.includes('--') ? projectKey.split('--').pop() : null;
    if (suffix) {
      const matchedBySuffix = projectList.find(project => projectUrlKeySuffixFromId(project.id) === suffix);
      if (matchedBySuffix) return matchedBySuffix.id;
    }

    return null;
  }, []);

  const syncProjectIdToUrl = useCallback((projectId: string | null, projectList: Project[]) => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('project');
      if (projectId) {
        const project = projectList.find((item) => item.id === projectId);
        const key = project ? projectUrlKey(project) : projectId;
        u.pathname = buildMainPath('group', 'data', key);
      } else {
        u.pathname = buildMainPath('group', 'data');
      }
      const next = u.pathname + u.search;
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState({}, '', next);
      }
    } catch {
      // Ignore URL sync failures and keep project state functional.
    }
  }, []);

  const initialProjectsLoadedRef = useRef(false);
  const initialProjectsLoadedAtRef = useRef<number>(0);
  const lastAppliedProjectsSnapshotRef = useRef<Project[] | null>(null);
  const recentlyCreatedProjectRef = useRef<{ id: string; until: number } | null>(null);
  const bootstrappedFromLocalCacheRef = useRef(false);
  const pendingUrlProjectKeyRef = useRef<string | null>(null);

  const clearPendingUrlProjectKey = useCallback(() => {
    pendingUrlProjectKeyRef.current = null;
  }, []);

  const loadRequestedProjectFromUrl = useCallback(async (
    projectId: string,
    projectList: Project[],
    key: string,
    source: 'listener' | 'mount',
  ) => {
    if (!allowProjectChange()) return false;
    clearPendingUrlProjectKey();
    advanceGeneration(projectId);
    setMainTab('group');
    setGroupSubTab('data');
    const traceId = beginRuntimeTrace(
      source === 'listener' ? 'useProjectLifecycle.pendingUrlResolve' : 'useProjectLifecycle.mountRestore',
      projectId,
      { key },
    );
    traceRuntimeEvent({
      traceId,
      event: source === 'listener' ? 'lifecycle:pending-url-load-start' : 'lifecycle:mount-load-start',
      source: source === 'listener' ? 'useProjectLifecycle.pendingUrlResolve' : 'useProjectLifecycle.mountRestore',
      projectId,
      data: { key },
    });
    setActiveProjectId(projectId);
    if (source === 'listener') {
      clearProject();
    }
    setIsProjectLoading(true);
    try {
      await loadProject(projectId, projectList);
      return true;
    } finally {
      traceRuntimeEvent({
        traceId,
        event: source === 'listener' ? 'lifecycle:pending-url-load-finished' : 'lifecycle:mount-load-finished',
        source: source === 'listener' ? 'useProjectLifecycle.pendingUrlResolve' : 'useProjectLifecycle.mountRestore',
        projectId,
      });
      setIsProjectLoading(false);
    }
  }, [allowProjectChange, clearPendingUrlProjectKey, clearProject, loadProject, setActiveProjectId, setGroupSubTab, setIsProjectLoading, setMainTab]);

  const resolvePendingUrlProjectKey = useCallback(async (
    projectList: Project[],
    metadata?: { fromCache?: boolean; hasPendingWrites?: boolean },
  ) => {
    const pendingKey = pendingUrlProjectKeyRef.current;
    if (!pendingKey) return false;

    const pendingProjectId = resolveProjectIdFromUrlKey(pendingKey, projectList);
    if (pendingProjectId) {
      const targetProject = projectList.find((project) => project.id === pendingProjectId);
      if (targetProject?.deletedAt) {
        clearPendingUrlProjectKey();
        setActiveProjectId(null);
        setMainTab('group');
        setGroupSubTab('projects');
        clearProject();
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', buildMainPath('group', 'projects'));
        }
        return true;
      }
      if (activeProjectIdRef.current === pendingProjectId) {
        clearPendingUrlProjectKey();
        return true;
      }
      return loadRequestedProjectFromUrl(pendingProjectId, projectList, pendingKey, 'listener');
    }

    if (metadata?.fromCache === true || metadata?.hasPendingWrites === true) {
      return false;
    }

    clearPendingUrlProjectKey();
    if (activeProjectIdRef.current) {
      setActiveProjectId(null);
      clearProject();
    }
    setMainTab('group');
    setGroupSubTab('projects');
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', buildMainPath('group', 'projects'));
    }
    return false;
  }, [activeProjectIdRef, clearPendingUrlProjectKey, clearProject, loadRequestedProjectFromUrl, resolveProjectIdFromUrlKey, setActiveProjectId, setGroupSubTab, setMainTab]);

  // Load projects, saved clusters, and restore active project on mount
  useEffect(() => {
    setIsAuthReady(true);
    let cancelled = false;

    Promise.all([loadProjectsBootstrapState(), loadSavedWorkspacePrefs()])
      .then(([projectBootstrap, prefs]) => {
        if (cancelled) return;
        const loadedProjects = projectBootstrap.projects;
        initialProjectsLoadedRef.current = true;
        initialProjectsLoadedAtRef.current = Date.now();
        lastAppliedProjectsSnapshotRef.current = loadedProjects;
        bootstrappedFromLocalCacheRef.current = projectBootstrap.source === 'local-cache';
        setProjects(loadedProjects);
        setSavedClusters(prefs.savedClusters || []);

        const requestedProjectKey = getProjectKeyFromUrl();
        const requestedProjectId = resolveProjectIdFromUrlKey(requestedProjectKey, loadedProjects);
        pendingUrlProjectKeyRef.current =
          requestedProjectKey && !requestedProjectId
            ? requestedProjectKey
            : null;
        const nextProjectId =
          isUsableActiveProjectId(requestedProjectId, loadedProjects)
            ? requestedProjectId!
            : requestedProjectKey
              ? null
            : isUsableActiveProjectId(prefs.activeProjectId, loadedProjects)
              ? prefs.activeProjectId!
              : null;

        if (nextProjectId) {
          void loadRequestedProjectFromUrl(
            nextProjectId,
            loadedProjects,
            requestedProjectKey ?? nextProjectId,
            'mount',
          ).catch(() => undefined);
        }
      })
      .catch((error) => {
        console.warn('[APP INIT] Failed to load initial Firestore workspace state:', error);
        if (cancelled) return;
        initialProjectsLoadedRef.current = true;
        initialProjectsLoadedAtRef.current = Date.now();
        lastAppliedProjectsSnapshotRef.current = [];
        bootstrappedFromLocalCacheRef.current = false;
        setProjects([]);
        setSavedClusters([]);
        setIsProjectLoading(false);
      });

    return () => { cancelled = true; };
  }, [getProjectKeyFromUrl, loadProject, resolveProjectIdFromUrlKey, setActiveProjectId, setGroupSubTab, setIsAuthReady, setIsProjectLoading, setProjects, setSavedClusters]);

  useEffect(() => {
    if (mainTab !== 'group' || groupSubTab !== 'data') return;
    if (!activeProjectId && pendingUrlProjectKeyRef.current) return;
    syncProjectIdToUrl(activeProjectId, projects);
  }, [mainTab, groupSubTab, activeProjectId, projects, syncProjectIdToUrl]);

  useEffect(() => {
    const handlePopState = async () => {
      const parsed = parseAppPath(window.location.pathname);
      setMainTab(parsed.mainTab);
      if (parsed.groupSubTab !== null) setGroupSubTab(parsed.groupSubTab);
      if (parsed.settingsSubTab !== null) setSettingsSubTab(parsed.settingsSubTab);

      const searchKey = new URLSearchParams(window.location.search).get('project');
      const key = parsed.dataRouteProjectKey || searchKey;
      const projectIdFromUrl = resolveProjectIdFromUrlKey(key, projectsRef.current);

      if (parsed.mainTab === 'group' && parsed.groupSubTab === 'data' && key && projectIdFromUrl) {
        const urlTarget = projectsRef.current.find(p => p.id === projectIdFromUrl);
        if (urlTarget?.deletedAt) {
          setActiveProjectId(null);
          clearProject();
          if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', buildMainPath('group', 'projects'));
          }
          return;
        }
        if (projectIdFromUrl === activeProjectId) return;
        if (!allowProjectChange()) {
          syncProjectIdToUrl(activeProjectIdRef.current, projectsRef.current);
          return;
        }
        const traceId = beginRuntimeTrace('useProjectLifecycle.popstate', projectIdFromUrl, { key });
        advanceGeneration(projectIdFromUrl);
        setActiveProjectId(projectIdFromUrl);
        clearProject();
        traceRuntimeEvent({
          traceId,
          event: 'lifecycle:popstate-load-start',
          source: 'useProjectLifecycle.popstate',
          projectId: projectIdFromUrl,
          data: { key },
        });
        setIsProjectLoading(true);
        try {
          await loadProject(projectIdFromUrl, projectsRef.current);
        } finally {
          traceRuntimeEvent({
            traceId,
            event: 'lifecycle:popstate-load-finished',
            source: 'useProjectLifecycle.popstate',
            projectId: projectIdFromUrl,
          });
          setIsProjectLoading(false);
        }
        return;
      }

      if (parsed.mainTab !== 'group' || parsed.groupSubTab !== 'data') {
        try {
          const u = new URL(window.location.href);
          if (u.searchParams.has('project')) {
            u.searchParams.delete('project');
            window.history.replaceState({}, '', u.pathname + u.search);
          }
        } catch {
          /* ignore */
        }
        if (activeProjectIdRef.current) {
          setActiveProjectId(null);
          clearProject();
        }
        return;
      }

      if (!key || !projectIdFromUrl) {
        if (activeProjectIdRef.current) {
          setActiveProjectId(null);
          clearProject();
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    activeProjectId,
    activeProjectIdRef,
    allowProjectChange,
    clearProject,
    loadProject,
    resolveProjectIdFromUrlKey,
    setActiveProjectId,
    setGroupSubTab,
    setIsProjectLoading,
    setMainTab,
    setSettingsSubTab,
    syncProjectIdToUrl,
  ]);

  useEffect(() => {
    const unsub = subscribeProjectsCollection({
      onProjects: (liveProjects, metadata) => {

      if (!initialProjectsLoadedRef.current) {
        if (liveProjects.length === 0) return;
        initialProjectsLoadedRef.current = true;
        initialProjectsLoadedAtRef.current = Date.now();
      } else if (
        liveProjects.length === 0 &&
        (lastAppliedProjectsSnapshotRef.current?.length ?? 0) > 0
      ) {
        const isBootstrapEmptySnapshot =
          bootstrappedFromLocalCacheRef.current &&
          initialProjectsLoadedAtRef.current > 0 &&
          Date.now() - initialProjectsLoadedAtRef.current < 15000;
        if (isBootstrapEmptySnapshot) {
          return;
        }
        if (metadata?.fromCache === true) {
          return;
        }
        if (metadata?.hasPendingWrites === true) {
          return;
        }
      }

      if (liveProjects.length > 0) {
        bootstrappedFromLocalCacheRef.current = false;
      }
      lastAppliedProjectsSnapshotRef.current = liveProjects;
      setProjects(liveProjects);
      void resolvePendingUrlProjectKey(liveProjects, metadata);

      const pid = activeProjectIdRef.current;
      if (pid && !liveProjects.some(project => project.id === pid)) {
        const grace = recentlyCreatedProjectRef.current;
        if (grace && grace.id === pid && Date.now() < grace.until) {
          return;
        }
        setActiveProjectId(null);
        setMainTab('group');
        setGroupSubTab('projects');
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', buildMainPath('group', 'projects'));
        }
        clearProject();
        return;
      }

      const activeProject = pid ? liveProjects.find(project => project.id === pid) : null;
      if (activeProject?.deletedAt) {
        setActiveProjectId(null);
        setMainTab('group');
        setGroupSubTab('projects');
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', buildMainPath('group', 'projects'));
        }
        clearProject();
        return;
      }

      if (recentlyCreatedProjectRef.current && liveProjects.some(p => p.id === recentlyCreatedProjectRef.current?.id)) {
        recentlyCreatedProjectRef.current = null;
      }

      if (activeProject && typeof activeProject.fileName === 'string') {
        syncFileNameLocal(activeProject.fileName);
      }
      },
      onError: (error) => {
        markListenerError(CLOUD_SYNC_CHANNELS.projects);
        console.warn('[PROJECTS] Firestore snapshot error (likely quota exceeded):', error?.message || error);
      },
    });

    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.projects);
      if (typeof unsub === 'function') unsub();
    };
  }, [
    activeProjectIdRef,
    clearProject,
    setActiveProjectId,
    setGroupSubTab,
    setMainTab,
    setProjects,
    resolvePendingUrlProjectKey,
    syncFileNameLocal,
  ]);

  const createProject = async () => {
    if (!newProjectName.trim()) {
      setProjectError('Project name is required.');
      return;
    }
    setProjectError(null);
    if (!allowProjectChange()) return;
    setIsProjectLoading(true);
    try {
      const newProject: Project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        uid: 'local',
        name: newProjectName,
        description: SHARED_PROJECT_DESCRIPTION,
        createdAt: new Date().toISOString(),
        folderId: null,
        deletedAt: null,
      };
      const updatedProjects = [...projects, newProject];
      await persistProjectMetadata(newProject);
      recentlyCreatedProjectRef.current = { id: newProject.id, until: Date.now() + 10000 };
      setProjects(updatedProjects);
      setNewProjectName('');
      setNewProjectDescription('');
      setIsCreatingProject(false);
      advanceGeneration(newProject.id);
      setActiveProjectId(newProject.id);
      setMainTab('group');
      setGroupSubTab('data');
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', buildMainPath('group', 'data', projectUrlKey(newProject)));
      }
      // loadProject (not clearProject alone) resets load fence / save id from storage for this id
      // and avoids stale session refs after switching from another project.
      await loadProject(newProject.id, updatedProjects);
    } catch {
      setProjectError('Failed to create project.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!window.confirm('Move this project to Deleted? You can restore it later; data is kept until you delete permanently.')) return;
    const proj = projectsRef.current.find(p => p.id === projectId);
    if (!proj) return;
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      clearProject();
    }
    const ts = new Date().toISOString();
    await softDeleteProjectMetadata(projectId);
    setProjects(prev => {
      const next = prev.map(p => (p.id === projectId ? { ...p, deletedAt: ts } : p));
      projectsRef.current = next;
      return next;
    });
  };

  const reviveProject = async (projectId: string) => {
    const proj = projectsRef.current.find(p => p.id === projectId);
    if (!proj) return;
    const revived: Project = { ...proj, deletedAt: null };
    await reviveProjectMetadata(revived);
    setProjects(prev => {
      const next = prev.map(p => (p.id === projectId ? revived : p));
      projectsRef.current = next;
      return next;
    });
  };

  const permanentlyDeleteProject = async (projectId: string) => {
    if (!window.confirm('Permanently delete this project and all its data? This cannot be undone.')) return;
    await Promise.all([
      deleteProjectMetadata(projectId),
      deleteProjectDataFromFirestore(projectId),
      deleteProjectV2Data(projectId),
      deleteFromIDB(projectId),
    ]);
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      clearProject();
    }
    setProjects(prev => {
      const next = prev.filter(p => p.id !== projectId);
      projectsRef.current = next;
      return next;
    });
  };

  const selectProject = async (projectId: string) => {
    const target = projectsRef.current.find(p => p.id === projectId);
    if (target?.deletedAt) return;
    if (!allowProjectChange()) return;
    advanceGeneration(projectId);
    const traceId = beginRuntimeTrace('useProjectLifecycle.selectProject', projectId);
    setActiveProjectId(projectId);
    // Clear immediately so the UI never shows another project’s keywords while the new one loads.
    clearProject();
    traceRuntimeEvent({
      traceId,
      event: 'lifecycle:select-load-start',
      source: 'useProjectLifecycle.selectProject',
      projectId,
    });
    setIsProjectLoading(true);
    setMainTab('group');
    setGroupSubTab('data');
    const proj = projectsRef.current.find((p) => p.id === projectId);
    const key = proj ? projectUrlKey(proj) : projectId;
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', buildMainPath('group', 'data', key));
    }
    try {
      await loadProject(projectId, projectsRef.current);
    } finally {
      traceRuntimeEvent({
        traceId,
        event: 'lifecycle:select-load-finished',
        source: 'useProjectLifecycle.selectProject',
        projectId,
      });
      setIsProjectLoading(false);
    }
  };

  return {
    createProject,
    deleteProject,
    reviveProject,
    permanentlyDeleteProject,
    selectProject,
  };
}
