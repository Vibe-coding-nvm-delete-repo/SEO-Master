/**
 * Project list + create/select/delete/load + Firestore listeners + URL/popstate.
 * P1.1 — extracted from App.tsx; behavior must match the previous inline implementation.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { clearListenerError, markListenerError, markListenerSnapshot } from '../cloudSyncStatus';
import { db } from '../firebase';
import type { Project } from '../types';
import {
  deleteFromIDB,
  deleteProjectDataFromFirestore,
  deleteProjectFromFirestore,
  loadProjectsFromFirestore,
  saveProjectToFirestore,
} from '../projectStorage';
import { loadSavedWorkspacePrefs } from '../projectWorkspace';
import { parseAppPath, buildMainPath, type MainTab, type GroupSubTab, type SettingsSubTab } from '../appRouting';
import { projectUrlKey, projectUrlKeySuffixFromId } from '../projectUrlKey';

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
  } = input;

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

  const mapProjectsSnapshot = useCallback((snapshot: { forEach: (fn: (docSnap: any) => void) => void }): Project[] => {
    const liveProjects: Project[] = [];
    snapshot.forEach((docSnap: any) => {
      const data = docSnap.data();
      liveProjects.push({
        id: docSnap.id,
        name: data.name || '',
        description: data.description || '',
        createdAt: data.createdAt || new Date().toISOString(),
        uid: data.uid || 'local',
        fileName: data.fileName,
      });
    });
    return liveProjects;
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

  // Load projects, saved clusters, and restore active project on mount
  useEffect(() => {
    setIsAuthReady(true);
    let cancelled = false;

    Promise.all([loadProjectsFromFirestore(), loadSavedWorkspacePrefs()])
      .then(([loadedProjects, prefs]) => {
        if (cancelled) return;
        initialProjectsLoadedRef.current = true;
        initialProjectsLoadedAtRef.current = Date.now();
        lastAppliedProjectsSnapshotRef.current = loadedProjects;
        setProjects(loadedProjects);
        setSavedClusters(prefs.savedClusters || []);

        const requestedProjectKey = getProjectKeyFromUrl();
        const requestedProjectId = resolveProjectIdFromUrlKey(requestedProjectKey, loadedProjects);
        const nextProjectId =
          requestedProjectId && loadedProjects.some(p => p.id === requestedProjectId)
            ? requestedProjectId
            : prefs.activeProjectId && loadedProjects.some(p => p.id === prefs.activeProjectId)
              ? prefs.activeProjectId
              : null;

        if (nextProjectId) {
          setActiveProjectId(nextProjectId);
          setGroupSubTab('data');
          setIsProjectLoading(true);
          loadProject(nextProjectId, loadedProjects).finally(() => {
            if (!cancelled) setIsProjectLoading(false);
          });
        }
      })
      .catch((error) => {
        console.warn('[APP INIT] Failed to load initial Firestore workspace state:', error);
        if (cancelled) return;
        initialProjectsLoadedRef.current = true;
        initialProjectsLoadedAtRef.current = Date.now();
        lastAppliedProjectsSnapshotRef.current = [];
        setProjects([]);
        setSavedClusters([]);
        setIsProjectLoading(false);
      });

    return () => { cancelled = true; };
  }, [getProjectKeyFromUrl, loadProject, resolveProjectIdFromUrlKey, setActiveProjectId, setGroupSubTab, setIsAuthReady, setIsProjectLoading, setProjects, setSavedClusters]);

  useEffect(() => {
    if (mainTab !== 'group' || groupSubTab !== 'data') return;
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
        if (projectIdFromUrl === activeProjectId) return;
        setActiveProjectId(projectIdFromUrl);
        setIsProjectLoading(true);
        try {
          await loadProject(projectIdFromUrl, projectsRef.current);
        } finally {
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
  }, [activeProjectId, clearProject, loadProject, resolveProjectIdFromUrlKey, setActiveProjectId, setGroupSubTab, setIsProjectLoading, setMainTab, setSettingsSubTab]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'projects'), (snap) => {
      markListenerSnapshot('projects', snap);
      const liveProjects = mapProjectsSnapshot(snap);

      if (!initialProjectsLoadedRef.current) {
        if (liveProjects.length === 0) return;
        initialProjectsLoadedRef.current = true;
        initialProjectsLoadedAtRef.current = Date.now();
      } else if (
        liveProjects.length === 0 &&
        (lastAppliedProjectsSnapshotRef.current?.length ?? 0) > 0
      ) {
        if (snap.metadata?.fromCache === true) {
          return;
        }
        if (snap.metadata?.hasPendingWrites === true) {
          return;
        }
      }

      lastAppliedProjectsSnapshotRef.current = liveProjects;
      setProjects(liveProjects);

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

      if (recentlyCreatedProjectRef.current && liveProjects.some(p => p.id === recentlyCreatedProjectRef.current?.id)) {
        recentlyCreatedProjectRef.current = null;
      }

      const activeProject = pid
        ? liveProjects.find(project => project.id === pid)
        : null;
      if (activeProject && typeof activeProject.fileName === 'string') {
        syncFileNameLocal(activeProject.fileName);
      }
    }, (error) => {
      markListenerError('projects');
      console.warn('[PROJECTS] Firestore snapshot error (likely quota exceeded):', error?.message || error);
    });

    return () => {
      clearListenerError('projects');
      if (typeof unsub === 'function') unsub();
    };
  }, [clearProject, mapProjectsSnapshot, setActiveProjectId, setGroupSubTab, setMainTab, setProjects, syncFileNameLocal]);

  const createProject = async () => {
    if (!newProjectName.trim()) {
      setProjectError('Project name is required.');
      return;
    }
    setProjectError(null);
    setIsProjectLoading(true);
    try {
      const newProject: Project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        uid: 'local',
        name: newProjectName,
        description: newProjectDescription,
        createdAt: new Date().toISOString(),
      };
      const updatedProjects = [...projects, newProject];
      setProjects(updatedProjects);
      recentlyCreatedProjectRef.current = { id: newProject.id, until: Date.now() + 10000 };
      saveProjectToFirestore(newProject).catch(err => console.error('[createProject] Firestore save failed:', err));
      setNewProjectName('');
      setNewProjectDescription('');
      setIsCreatingProject(false);
      setActiveProjectId(newProject.id);
      setMainTab('group');
      setGroupSubTab('data');
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', buildMainPath('group', 'data', projectUrlKey(newProject)));
      }
      clearProject();
    } catch {
      setProjectError('Failed to create project.');
    } finally {
      setIsProjectLoading(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!window.confirm('Are you sure you want to delete this project and all its data?')) return;
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      clearProject();
    }
    const updatedProjects = projects.filter(p => p.id !== projectId);
    setProjects(updatedProjects);
    await Promise.all([
      deleteProjectFromFirestore(projectId),
      deleteProjectDataFromFirestore(projectId),
      deleteFromIDB(projectId),
    ]);
  };

  const selectProject = async (projectId: string) => {
    setActiveProjectId(projectId);
    setIsProjectLoading(true);
    setMainTab('group');
    setGroupSubTab('data');
    const proj = projects.find((p) => p.id === projectId);
    const key = proj ? projectUrlKey(proj) : projectId;
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', buildMainPath('group', 'data', key));
    }
    try {
      await loadProject(projectId, projects);
    } finally {
      setIsProjectLoading(false);
    }
  };

  return {
    createProject,
    deleteProject,
    selectProject,
  };
}
