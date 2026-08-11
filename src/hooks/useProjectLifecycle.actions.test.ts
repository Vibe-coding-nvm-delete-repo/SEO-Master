import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectLifecycle } from './useProjectLifecycle';
import type { Project } from '../types';
import * as projectStorage from '../projectStorage';
import * as projectWorkspace from '../projectWorkspace';
import * as projectMetadataCollab from '../projectMetadataCollab';
import * as collabV2WriteGuard from '../collabV2WriteGuard';
import { projectUrlKey } from '../projectUrlKey';

const softDeleteProjectMetadata = vi.spyOn(projectMetadataCollab, 'softDeleteProjectMetadata');
const persistProjectMetadata = vi.spyOn(projectMetadataCollab, 'persistProjectMetadata');
const advanceGenerationSpy = vi.spyOn(collabV2WriteGuard, 'advanceGeneration');
const firestoreListeners = vi.hoisted(() => ({
  handlers: new Map<string, (projects: Project[], metadata?: { fromCache?: boolean; hasPendingWrites?: boolean }) => void>(),
}));

vi.mock('../projectMetadataCollab', async () => {
  const actual = await vi.importActual<typeof import('../projectMetadataCollab')>('../projectMetadataCollab');
  return {
    ...actual,
    subscribeProjectsCollection: vi.fn(({ onProjects }: { onProjects: (projects: Project[], metadata?: { fromCache?: boolean; hasPendingWrites?: boolean }) => void }) => {
      firestoreListeners.handlers.set('projects', onProjects);
      return () => {
        firestoreListeners.handlers.delete('projects');
      };
    }),
    persistProjectMetadata: vi.fn(async () => ({ status: 'accepted' })),
    softDeleteProjectMetadata: vi.fn(async () => ({ status: 'accepted' })),
    reviveProjectMetadata: vi.fn(async () => ({ status: 'accepted' })),
    deleteProjectMetadata: vi.fn(async () => ({ status: 'accepted' })),
  };
});

describe('useProjectLifecycle project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreListeners.handlers.clear();
    advanceGenerationSpy.mockImplementation(() => 1);
    window.history.replaceState({}, '', '/seo-magic/group/projects');
    softDeleteProjectMetadata.mockResolvedValue({ status: 'accepted' });
    persistProjectMetadata.mockResolvedValue({ status: 'accepted' });
    vi.spyOn(projectStorage, 'loadProjectsBootstrapState').mockResolvedValue({
      projects: [],
      source: 'empty',
    });
    vi.spyOn(projectWorkspace, 'loadSavedWorkspacePrefs').mockResolvedValue({
      activeProjectId: null,
      savedClusters: [],
    });
  });

  function makeInput(overrides: Partial<Parameters<typeof useProjectLifecycle>[0]> = {}) {
    const projects: Project[] = [
      {
        id: 'p1',
        name: 'A',
        description: '',
        createdAt: '2020-01-01T00:00:00.000Z',
        uid: 'u',
        folderId: null,
        deletedAt: null,
      },
    ];
    const setProjects = vi.fn();
    const setActiveProjectId = vi.fn();
    const loadProject = vi.fn(() => Promise.resolve());
    const clearProject = vi.fn();
    const base = {
      projects,
      setProjects,
      activeProjectId: null as string | null,
      activeProjectIdRef: { current: null as string | null },
      setActiveProjectId,
      loadProject,
      clearProject,
      syncFileNameLocal: vi.fn(),
      mainTab: 'group' as const,
      groupSubTab: 'projects' as const,
      setMainTab: vi.fn(),
      setGroupSubTab: vi.fn(),
      setSettingsSubTab: vi.fn(),
      setIsProjectLoading: vi.fn(),
      setIsAuthReady: vi.fn(),
      setSavedClusters: vi.fn(),
      newProjectName: '',
      setNewProjectName: vi.fn(),
      setProjectError: vi.fn(),
      setIsCreatingProject: vi.fn(),
    };
    return { ...base, ...overrides };
  }

  it('deleteProject soft-deletes and calls softDeleteProjectInFirestore', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const input = makeInput();
    const { result } = renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await result.current.deleteProject('p1');
    });

    expect(softDeleteProjectMetadata).toHaveBeenCalledWith('p1');
    expect(input.setProjects).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('selectProject clears workspace before loadProject so projects stay visually distinct', async () => {
    const input = makeInput();
    const sequence: string[] = [];
    (input.clearProject as Mock).mockImplementation(() => {
      sequence.push('clear');
    });
    (input.loadProject as Mock).mockImplementation(() => {
      sequence.push('load');
      return Promise.resolve();
    });
    const { result } = renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await result.current.selectProject('p1');
    });

    expect(sequence).toEqual(['clear', 'load']);
    expect(advanceGenerationSpy).toHaveBeenCalledWith('p1');
    expect(input.setActiveProjectId).toHaveBeenCalledWith('p1');
    expect(input.loadProject).toHaveBeenCalledWith('p1', input.projects);
  });

  it('selectProject does not load when project is soft-deleted', async () => {
    const deleted: Project = {
      id: 'p1',
      name: 'A',
      description: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      uid: 'u',
      deletedAt: '2020-02-01T00:00:00.000Z',
    };
    const input = makeInput({ projects: [deleted] });
    const { result } = renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await result.current.selectProject('p1');
    });

    expect(input.loadProject).not.toHaveBeenCalled();
    expect(input.setActiveProjectId).not.toHaveBeenCalled();
  });

  it('keeps cached projects visible when the first live snapshot is empty after local-cache bootstrap', async () => {
    const cachedProjects: Project[] = [
      {
        id: 'p1',
        name: 'Title Loans',
        description: '',
        createdAt: '2020-01-01T00:00:00.000Z',
        uid: 'u',
        folderId: null,
        deletedAt: null,
      },
      {
        id: 'p2',
        name: 'Installment Loans',
        description: '',
        createdAt: '2020-01-02T00:00:00.000Z',
        uid: 'u',
        folderId: null,
        deletedAt: null,
      },
    ];
    vi.spyOn(projectStorage, 'loadProjectsBootstrapState').mockResolvedValue({
      projects: cachedProjects,
      source: 'local-cache',
    });
    const input = makeInput({ projects: [] });

    renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await Promise.resolve();
    });

    expect(input.setProjects).toHaveBeenCalledWith(cachedProjects);

    await act(async () => {
      firestoreListeners.handlers.get('projects')?.([], { fromCache: false, hasPendingWrites: false });
    });

    expect(input.setProjects).toHaveBeenCalledTimes(1);
    expect(input.clearProject).not.toHaveBeenCalled();
  });

  it('createProject waits for accepted shared persistence before exposing the project locally', async () => {
    const deferred = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    persistProjectMetadata.mockImplementationOnce(async () => {
      await deferred.promise;
      return { status: 'accepted' };
    });
    const input = makeInput({
      projects: [],
      newProjectName: 'Shared Project',
    });
    const { result } = renderHook(() => useProjectLifecycle(input));
    (input.setProjects as Mock).mockClear();

    let createPromise: Promise<void> | undefined;
    await act(async () => {
      createPromise = result.current.createProject();
      await Promise.resolve();
    });

    expect(
      (input.setProjects as Mock).mock.calls.some(([projectsArg]) =>
        Array.isArray(projectsArg) && projectsArg.some((project: Project) => project.name === 'Shared Project'),
      ),
    ).toBe(false);

    await act(async () => {
      deferred.resolve();
      await createPromise;
    });

    expect(persistProjectMetadata).toHaveBeenCalledTimes(1);
    expect(
      (input.setProjects as Mock).mock.calls.some(([projectsArg]) =>
        Array.isArray(projectsArg) && projectsArg.some((project: Project) => project.name === 'Shared Project'),
      ),
    ).toBe(true);
  });

  it('does not fall back to workspace prefs when a deep-link project key is unresolved during bootstrap', async () => {
    window.history.replaceState({}, '', '/seo-magic/group/data/test--p4105bd');
    vi.spyOn(projectStorage, 'loadProjectsBootstrapState').mockResolvedValue({
      projects: [],
      source: 'local-cache',
    });
    vi.spyOn(projectWorkspace, 'loadSavedWorkspacePrefs').mockResolvedValue({
      activeProjectId: 'p1',
      savedClusters: [],
    });
    const input = makeInput({ projects: [] });

    renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await Promise.resolve();
    });

    expect(input.setActiveProjectId).not.toHaveBeenCalledWith('p1');
    expect(input.loadProject).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/seo-magic/group/data/test--p4105bd');
  });

  it('resolves a pending deep-link project once the live projects snapshot contains it', async () => {
    vi.spyOn(projectStorage, 'loadProjectsBootstrapState').mockResolvedValue({
      projects: [],
      source: 'local-cache',
    });
    vi.spyOn(projectWorkspace, 'loadSavedWorkspacePrefs').mockResolvedValue({
      activeProjectId: 'p1',
      savedClusters: [],
    });
    const targetProject: Project = {
      id: 'proj_target',
      name: 'TEST',
      description: '',
      createdAt: '2020-01-02T00:00:00.000Z',
      uid: 'u',
      folderId: null,
      deletedAt: null,
    };
    window.history.replaceState({}, '', `/seo-magic/group/data/${projectUrlKey(targetProject)}`);
    const otherProject: Project = {
      id: 'p1',
      name: 'Other Project',
      description: '',
      createdAt: '2020-01-01T00:00:00.000Z',
      uid: 'u',
      folderId: null,
      deletedAt: null,
    };
    const input = makeInput({ projects: [] });

    renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      firestoreListeners.handlers.get('projects')?.([otherProject, targetProject], { fromCache: false, hasPendingWrites: false });
      await Promise.resolve();
    });

    expect(input.setActiveProjectId).toHaveBeenCalledWith('proj_target');
    expect(advanceGenerationSpy).toHaveBeenCalledWith('proj_target');
    expect(input.loadProject).toHaveBeenCalledWith('proj_target', [otherProject, targetProject]);
    expect(input.setActiveProjectId).not.toHaveBeenCalledWith('p1');
  });

  it('createProject advances generation before loading the new project', async () => {
    const input = makeInput({
      projects: [],
      newProjectName: 'Shared Project',
    });
    const { result } = renderHook(() => useProjectLifecycle(input));

    await act(async () => {
      await result.current.createProject();
    });

    expect(advanceGenerationSpy).toHaveBeenCalledTimes(1);
    const advancedProjectId = advanceGenerationSpy.mock.calls[0]?.[0];
    expect(typeof advancedProjectId).toBe('string');
    expect(advancedProjectId).toContain('proj_');
    expect(input.setActiveProjectId).toHaveBeenCalledWith(advancedProjectId);
    expect(input.loadProject).toHaveBeenCalledWith(advancedProjectId, expect.any(Array));
  });
});
