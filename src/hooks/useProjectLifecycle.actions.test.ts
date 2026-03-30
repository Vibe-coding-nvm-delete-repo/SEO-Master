import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectLifecycle } from './useProjectLifecycle';
import type { Project } from '../types';
import * as projectStorage from '../projectStorage';
import * as projectWorkspace from '../projectWorkspace';

const softDeleteProjectInFirestore = vi.spyOn(projectStorage, 'softDeleteProjectInFirestore');
const firestoreListeners = vi.hoisted(() => ({
  handlers: new Map<string, (snap: any) => void>(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ path: 'projects' })),
  onSnapshot: vi.fn((ref: { path: string }, onNext: (snap: any) => void) => {
    firestoreListeners.handlers.set(ref.path, onNext);
    return () => {
      firestoreListeners.handlers.delete(ref.path);
    };
  }),
}));

vi.mock('../firebase', () => ({ db: {} }));

describe('useProjectLifecycle project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreListeners.handlers.clear();
    softDeleteProjectInFirestore.mockResolvedValue(undefined);
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
      newProjectDescription: '',
      setNewProjectName: vi.fn(),
      setNewProjectDescription: vi.fn(),
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

    expect(softDeleteProjectInFirestore).toHaveBeenCalledWith('p1');
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
      firestoreListeners.handlers.get('projects')?.({
        forEach: () => {},
        metadata: { fromCache: false, hasPendingWrites: false },
      });
    });

    expect(input.setProjects).toHaveBeenCalledTimes(1);
    expect(input.clearProject).not.toHaveBeenCalled();
  });
});
