import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectLifecycle } from './useProjectLifecycle';
import type { Project } from '../types';
import * as projectStorage from '../projectStorage';
import * as projectWorkspace from '../projectWorkspace';

const softDeleteProjectInFirestore = vi.spyOn(projectStorage, 'softDeleteProjectInFirestore');

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ path: 'projects' })),
  onSnapshot: vi.fn((_ref: unknown, _onNext: () => void) => () => {}),
}));

vi.mock('../firebase', () => ({ db: {} }));

describe('useProjectLifecycle project actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    softDeleteProjectInFirestore.mockResolvedValue(undefined);
    vi.spyOn(projectStorage, 'loadProjectsFromFirestore').mockResolvedValue([]);
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
});
