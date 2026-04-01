import { collection, onSnapshot, type FirestoreError, type Unsubscribe } from 'firebase/firestore';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
} from './cloudSyncStatus';
import { db } from './firebase';
import {
  batchSetProjectsFolderId,
  deleteProjectFromFirestore,
  projectFromFirestoreData,
  reviveProjectInFirestore,
  saveProjectFoldersToFirestore,
  saveProjectToFirestore,
  softDeleteProjectInFirestore,
} from './projectStorage';
import { performSharedMutation, subscribeSharedChannel, trackSharedListenerApply } from './sharedCollabContract';
import { getSharedActionRegistryEntry } from './sharedCollaboration';
import { SHARED_MUTATION_ACCEPTED, type SharedMutationResult } from './sharedMutation';
import type { Project, ProjectFolder } from './types';

export function subscribeProjectsCollection(args: {
  onProjects: (projects: Project[], metadata?: { fromCache?: boolean; hasPendingWrites?: boolean }) => void;
  onError?: (error: FirestoreError) => void;
}): Unsubscribe {
  const entry = getSharedActionRegistryEntry('project.collection');
  const unsubscribe = subscribeSharedChannel(entry, () => onSnapshot(
    collection(db, 'projects'),
    (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.projects, snap);
      trackSharedListenerApply(entry);
      const projects: Project[] = [];
      snap.forEach((docSnap) => {
        projects.push(projectFromFirestoreData(docSnap.id, docSnap.data()));
      });
      args.onProjects(projects, snap.metadata);
    },
    (error) => {
      markListenerError(CLOUD_SYNC_CHANNELS.projects);
      args.onError?.(error);
    },
  ));

  return () => {
    clearListenerError(CLOUD_SYNC_CHANNELS.projects);
    unsubscribe();
  };
}

export async function persistProjectMetadata(project: Project): Promise<SharedMutationResult> {
  const entry = getSharedActionRegistryEntry('project.metadata');
  return performSharedMutation(entry, async () => {
    await saveProjectToFirestore(project);
    return SHARED_MUTATION_ACCEPTED;
  });
}

export async function softDeleteProjectMetadata(projectId: string): Promise<SharedMutationResult> {
  const entry = getSharedActionRegistryEntry('project.metadata');
  return performSharedMutation(entry, async () => {
    await softDeleteProjectInFirestore(projectId);
    return SHARED_MUTATION_ACCEPTED;
  });
}

export async function reviveProjectMetadata(project: Project): Promise<SharedMutationResult> {
  const entry = getSharedActionRegistryEntry('project.metadata');
  return performSharedMutation(entry, async () => {
    await reviveProjectInFirestore(project);
    return SHARED_MUTATION_ACCEPTED;
  });
}

export async function deleteProjectMetadata(projectId: string): Promise<SharedMutationResult> {
  const entry = getSharedActionRegistryEntry('project.metadata');
  return performSharedMutation(entry, async () => {
    await deleteProjectFromFirestore(projectId);
    return SHARED_MUTATION_ACCEPTED;
  });
}

export async function persistProjectFolders(folders: ProjectFolder[]): Promise<SharedMutationResult> {
  const entry = getSharedActionRegistryEntry('project.folders');
  return performSharedMutation(entry, async () => {
    await saveProjectFoldersToFirestore(folders);
    return SHARED_MUTATION_ACCEPTED;
  });
}

export async function assignProjectsToFolder(projectIds: string[], folderId: string | null): Promise<SharedMutationResult> {
  const entry = getSharedActionRegistryEntry('project.metadata');
  return performSharedMutation(entry, async () => {
    await batchSetProjectsFolderId(projectIds, folderId);
    return SHARED_MUTATION_ACCEPTED;
  });
}
