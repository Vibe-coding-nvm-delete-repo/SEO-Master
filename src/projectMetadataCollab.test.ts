import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreState = vi.hoisted(() => ({
  projectsListener: null as ((snap: any) => void) | null,
}));

const storageMocks = vi.hoisted(() => ({
  batchSetProjectsFolderId: vi.fn(async () => undefined),
  deleteProjectFromFirestore: vi.fn(async () => undefined),
  projectFromFirestoreData: vi.fn((id: string, data: Record<string, unknown>) => ({
    id,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    createdAt: String(data.createdAt ?? ''),
    uid: String(data.uid ?? ''),
    fileName: typeof data.fileName === 'string' ? data.fileName : undefined,
    folderId: typeof data.folderId === 'string' ? data.folderId : data.folderId === null ? null : undefined,
    deletedAt: typeof data.deletedAt === 'string' ? data.deletedAt : data.deletedAt === null ? null : undefined,
  })),
  reviveProjectInFirestore: vi.fn(async () => undefined),
  saveProjectFoldersToFirestore: vi.fn(async () => undefined),
  saveProjectToFirestore: vi.fn(async () => undefined),
  softDeleteProjectInFirestore: vi.fn(async () => undefined),
}));

vi.mock('./firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  onSnapshot: vi.fn((target: { path: string }, onNext: (snap: any) => void) => {
    if (target.path === 'projects') {
      firestoreState.projectsListener = onNext;
    }
    return () => {
      if (target.path === 'projects') {
        firestoreState.projectsListener = null;
      }
    };
  }),
}));

vi.mock('./projectStorage', () => ({
  batchSetProjectsFolderId: storageMocks.batchSetProjectsFolderId,
  deleteProjectFromFirestore: storageMocks.deleteProjectFromFirestore,
  projectFromFirestoreData: storageMocks.projectFromFirestoreData,
  reviveProjectInFirestore: storageMocks.reviveProjectInFirestore,
  saveProjectFoldersToFirestore: storageMocks.saveProjectFoldersToFirestore,
  saveProjectToFirestore: storageMocks.saveProjectToFirestore,
  softDeleteProjectInFirestore: storageMocks.softDeleteProjectInFirestore,
}));

import { getCollaborationHealthSnapshot, resetCloudSyncStateForTests } from './cloudSyncStatus';
import {
  assignProjectsToFolder,
  persistProjectFolders,
  persistProjectMetadata,
  subscribeProjectsCollection,
} from './projectMetadataCollab';
import type { Project, ProjectFolder } from './types';

describe('projectMetadataCollab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreState.projectsListener = null;
  });

  afterEach(() => {
    resetCloudSyncStateForTests();
  });

  it('[projects-collection-converges] replays shared project collection snapshots through the collaboration listener', async () => {
    const onProjects = vi.fn();
    const unsubscribe = subscribeProjectsCollection({ onProjects });

    expect(firestoreState.projectsListener).toBeTypeOf('function');

    firestoreState.projectsListener?.({
      metadata: { fromCache: false, hasPendingWrites: false },
      forEach(callback: (docSnap: { id: string; data: () => Record<string, unknown> }) => void) {
        callback({
          id: 'proj-1',
          data: () => ({
            name: 'Shared Project',
            description: 'collab',
            createdAt: '2026-04-01T00:00:00.000Z',
            uid: 'u1',
          }),
        });
      },
    });

    expect(onProjects).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'proj-1',
          name: 'Shared Project',
          description: 'collab',
        }),
      ],
      { fromCache: false, hasPendingWrites: false },
    );

    const health = getCollaborationHealthSnapshot().find((entry) => entry.actionId === 'project.collection');
    expect(health?.lastListenerApplyAtMs).not.toBeNull();

    unsubscribe();
  });

  it('[project-metadata-converges] records accepted metadata writes through the shared project metadata contract', async () => {
    const project: Project = {
      id: 'proj-1',
      name: 'Shared Project',
      description: 'collab',
      createdAt: '2026-04-01T00:00:00.000Z',
      uid: 'u1',
      fileName: 'shared.csv',
      folderId: null,
      deletedAt: null,
    };

    const result = await persistProjectMetadata(project);

    expect(result.status).toBe('accepted');
    expect(storageMocks.saveProjectToFirestore).toHaveBeenCalledWith(project);
    const health = getCollaborationHealthSnapshot().find((entry) => entry.actionId === 'project.metadata');
    expect(health?.lastAcceptedWriteAtMs).not.toBeNull();
  });

  it('[project-folders-converges] records shared folder persistence through the collaboration contract', async () => {
    const folders: ProjectFolder[] = [
      { id: 'folder-1', name: 'Shared Folder', order: 0 },
    ];

    const result = await persistProjectFolders(folders);

    expect(result.status).toBe('accepted');
    expect(storageMocks.saveProjectFoldersToFirestore).toHaveBeenCalledWith(folders);
    const health = getCollaborationHealthSnapshot().find((entry) => entry.actionId === 'project.folders');
    expect(health?.lastAcceptedWriteAtMs).not.toBeNull();
  });

  it('routes project-folder assignments through the metadata collaboration contract', async () => {
    const result = await assignProjectsToFolder(['proj-1', 'proj-2'], 'folder-1');

    expect(result.status).toBe('accepted');
    expect(storageMocks.batchSetProjectsFolderId).toHaveBeenCalledWith(['proj-1', 'proj-2'], 'folder-1');
  });
});
