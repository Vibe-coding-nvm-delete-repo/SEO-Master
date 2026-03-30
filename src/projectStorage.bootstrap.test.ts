import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
}));

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDocFromServer: vi.fn(),
  getDocs: firestoreMocks.getDocs,
  getDocsFromServer: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

import { loadProjectsBootstrapState, loadProjectsFromFirestore, LS_PROJECTS_KEY } from './projectStorage';
import type { Project } from './types';

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    description: '',
    createdAt: '2026-03-30T00:00:00.000Z',
    uid: 'local',
    folderId: null,
    deletedAt: null,
  };
}

describe('project bootstrap loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('uses local cache when Firestore returns an empty project collection', async () => {
    const cachedProjects = [makeProject('p1', 'Title Loans'), makeProject('p2', 'Installment Loans')];
    localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(cachedProjects));
    firestoreMocks.getDocs.mockResolvedValue({
      forEach: () => {},
    });

    const result = await loadProjectsBootstrapState();

    expect(result).toEqual({
      projects: cachedProjects,
      source: 'local-cache',
    });
  });

  it('keeps loadProjectsFromFirestore compatible while bootstrapping from local cache', async () => {
    const cachedProjects = [makeProject('p1', 'Title Loans')];
    localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(cachedProjects));
    firestoreMocks.getDocs.mockResolvedValue({
      forEach: () => {},
    });

    await expect(loadProjectsFromFirestore()).resolves.toEqual(cachedProjects);
  });
});
