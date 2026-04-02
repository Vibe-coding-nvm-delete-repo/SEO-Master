import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ProjectsTab from './ProjectsTab';
import type { Project } from './types';

const storageMocks = vi.hoisted(() => ({
  saveProjectFoldersToFirestore: vi.fn(() => Promise.resolve()),
  batchSetProjectsFolderId: vi.fn(() => Promise.resolve()),
  saveProjectToFirestore: vi.fn(() => Promise.resolve()),
}));

vi.mock('./projectStorage', async () => {
  const actual = await vi.importActual<typeof import('./projectStorage')>('./projectStorage');
  return {
    ...actual,
    saveProjectFoldersToFirestore: storageMocks.saveProjectFoldersToFirestore,
    batchSetProjectsFolderId: storageMocks.batchSetProjectsFolderId,
    saveProjectToFirestore: storageMocks.saveProjectToFirestore,
  };
});

vi.mock('./firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...p: string[]) => ({ path: p.join('/') })),
  onSnapshot: vi.fn((_ref: unknown, onNext: (s: unknown) => void) => {
    onNext({
      exists: () => true,
      data: () => ({ folders: [{ id: 'f1', name: 'Folder One', order: 0 }] }),
    });
    return () => {};
  }),
  setDoc: vi.fn(() => Promise.resolve()),
}));

describe('ProjectsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.saveProjectFoldersToFirestore.mockResolvedValue(undefined);
    storageMocks.batchSetProjectsFolderId.mockResolvedValue(undefined);
    storageMocks.saveProjectToFirestore.mockResolvedValue(undefined);
  });

  const base = {
    activeProjectId: null as string | null,
    selectProject: vi.fn(),
    deleteProject: vi.fn(),
    reviveProject: vi.fn(),
    permanentlyDeleteProject: vi.fn(),
    createProject: vi.fn(),
    isCreatingProject: false,
    setIsCreatingProject: vi.fn(),
    newProjectName: '',
    setNewProjectName: vi.fn(),
    projectError: null,
    isProjectLoading: false,
    addToast: vi.fn(),
  };

  it('[project-folders-two-session] moves projects to unassigned when removing a folder', async () => {
    const projects: Project[] = [
      {
        id: 'p1',
        name: 'P',
        description: '',
        createdAt: '2020-01-01T00:00:00.000Z',
        uid: 'u',
        folderId: 'f1',
        deletedAt: null,
      },
    ];
    const setProjects = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ProjectsTab {...base} projects={projects} setProjects={setProjects} />);

    expect((await screen.findAllByText('Folder One')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('Remove folder'));

    await waitFor(() => {
      expect(storageMocks.batchSetProjectsFolderId).toHaveBeenCalledWith(['p1'], null);
    });
    expect(storageMocks.saveProjectFoldersToFirestore).toHaveBeenCalled();
  });

  it('changes folder via Move to folder select', async () => {
    const projects: Project[] = [
      {
        id: 'p1',
        name: 'Alpha',
        description: '',
        createdAt: '2020-01-01T00:00:00.000Z',
        uid: 'u',
        folderId: null,
        deletedAt: null,
      },
    ];
    const setProjects = vi.fn();

    render(<ProjectsTab {...base} projects={projects} setProjects={setProjects} />);

    await screen.findByRole('button', { name: 'Folder One' });

    const select = await screen.findByLabelText(/Move Alpha to folder/i);
    fireEvent.change(select, { target: { value: 'f1' } });

    await waitFor(() => {
      expect(storageMocks.saveProjectToFirestore).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1', folderId: 'f1' }),
      );
    });
  });
});
