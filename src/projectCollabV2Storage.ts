/**
 * projectCollabV2Storage.ts — Authoritative V2 collaboration storage module.
 *
 * This is the ONLY authority for V2 commit-barrier semantics. All Firestore
 * reads/writes for the V2 collab schema flow through this module.
 *
 * Key concepts:
 * - Epoch-scoped entities: every entity doc is scoped to a datasetEpoch
 * - CAS (Compare-And-Swap) revisioned docs: all entity mutations check expected revision
 * - Two-phase base commits: manifest created as 'writing', chunks uploaded, then flipped to 'ready'
 * - Operation locks: prevent concurrent destructive operations
 */

import { db } from './firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  deleteDoc,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';
import { sanitizeJsonForFirestore } from './projectStorage';
import { withPersistTimeout } from './persistTimeout';
import type {
  ProjectCollabMetaDoc,
  ProjectBaseCommitManifestDoc,
  ProjectBaseCommitChunkDoc,
  ProjectRevisionFields,
  ProjectGroupDoc,
  ProjectBlockedTokenDoc,
  ProjectBlockedKeywordDoc,
  ProjectTokenMergeRuleDoc,
  ProjectLabelSectionDoc,
  ProjectActivityLogDoc,
  ProjectOperationLockDoc,
  ProjectCollabEntityState,
  RevisionedDocChange,
  RevisionedDocAck,
  V2EntityCollectionName,
} from './collabV2Types';
import { LOCK_TTL_MS, V2_ENTITY_COLLECTIONS, scopeCollabDocId } from './collabV2Types';

/** Rows per chunk for base commit data arrays. */
const CHUNK_SIZE = 200;

/** Timeout for batch Firestore operations (ms). */
const BATCH_TIMEOUT_MS = 30_000;

/** Firestore top-level projects collection. */
const PROJECTS_COLLECTION = 'projects';

// ─── Collection / doc path helpers (internal) ───

function projectRef(projectId: string): DocumentReference {
  return doc(db, PROJECTS_COLLECTION, projectId);
}

function collabMetaRef(projectId: string): DocumentReference {
  return doc(db, PROJECTS_COLLECTION, projectId, 'collab', 'meta');
}

function baseCommitRef(projectId: string, commitId: string): DocumentReference {
  return doc(db, PROJECTS_COLLECTION, projectId, 'base_commits', commitId);
}

function baseCommitChunksRef(projectId: string, commitId: string): CollectionReference {
  return collection(db, PROJECTS_COLLECTION, projectId, 'base_commits', commitId, 'chunks');
}

function entityCollectionRef(projectId: string, collectionName: V2EntityCollectionName): CollectionReference {
  return collection(db, PROJECTS_COLLECTION, projectId, collectionName);
}

function operationLockRef(projectId: string): DocumentReference {
  return doc(db, PROJECTS_COLLECTION, projectId, 'project_operations', 'current');
}

// ─── Meta operations ───

/**
 * Load the V2 collab meta document for a project.
 * Returns null if the meta doc does not exist.
 */
export async function loadCollabMeta(projectId: string): Promise<ProjectCollabMetaDoc | null> {
  const snap = await getDoc(collabMetaRef(projectId));
  if (!snap.exists()) return null;
  return snap.data() as ProjectCollabMetaDoc;
}

/**
 * Create the V2 collab meta document for a project.
 * This should only be called once during migration or initial setup.
 */
export async function createCollabMeta(projectId: string, meta: ProjectCollabMetaDoc): Promise<void> {
  await setDoc(collabMetaRef(projectId), sanitizeJsonForFirestore(meta));
}

/**
 * Transactionally flip the project meta to point at a new base commit.
 *
 * Validates that the target base commit manifest exists and is in 'ready' state,
 * then increments the meta revision, updates the epoch, and sets commitState to 'idle'.
 *
 * @throws Error if the base commit manifest is missing or not in 'ready' state
 * @throws Error if the meta doc does not exist
 */
export async function flipProjectMetaToCommit(
  projectId: string,
  commitId: string,
  newEpoch: number,
  actorId: string,
): Promise<ProjectCollabMetaDoc> {
  return runTransaction(db, async (txn) => {
    const metaSnap = await txn.get(collabMetaRef(projectId));
    if (!metaSnap.exists()) {
      throw new Error(`[collabV2] Meta doc not found for project ${projectId}`);
    }
    const currentMeta = metaSnap.data() as ProjectCollabMetaDoc;

    // Validate base commit is ready
    const commitSnap = await txn.get(baseCommitRef(projectId, commitId));
    if (!commitSnap.exists()) {
      throw new Error(`[collabV2] Base commit ${commitId} not found for project ${projectId}`);
    }
    const manifest = commitSnap.data() as ProjectBaseCommitManifestDoc;
    if (manifest.commitState !== 'ready') {
      throw new Error(
        `[collabV2] Base commit ${commitId} is in state '${manifest.commitState}', expected 'ready'`,
      );
    }

    const updatedMeta: ProjectCollabMetaDoc = {
      ...currentMeta,
      revision: currentMeta.revision + 1,
      datasetEpoch: newEpoch,
      baseCommitId: commitId,
      commitState: 'idle',
      updatedAt: new Date().toISOString(),
      updatedByClientId: actorId,
    };

    txn.set(collabMetaRef(projectId), sanitizeJsonForFirestore(updatedMeta));
    return updatedMeta;
  });
}

// ─── Base commit operations ───

/**
 * Split an array into chunks of the given size.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Save a base commit to Firestore using two-phase write:
 * 1. Create manifest with commitState='writing'
 * 2. Upload all data chunks in batches
 * 3. Flip manifest to commitState='ready'
 *
 * @returns The final manifest doc (in 'ready' state)
 */
export async function saveBaseCommitToFirestore(
  projectId: string,
  commitId: string,
  epoch: number,
  base: {
    results: unknown[];
    clusters: unknown[];
    suggestions: unknown[];
    autoMerge: unknown[];
    groupMerge: unknown[];
  },
  actorId: string,
): Promise<ProjectBaseCommitManifestDoc> {
  const resultChunks = chunkArray(base.results, CHUNK_SIZE);
  const clusterChunks = chunkArray(base.clusters, CHUNK_SIZE);
  const suggestionChunks = chunkArray(base.suggestions, CHUNK_SIZE);
  const autoMergeChunks = chunkArray(base.autoMerge, CHUNK_SIZE);
  const groupMergeChunks = chunkArray(base.groupMerge, CHUNK_SIZE);

  const now = new Date().toISOString();

  // Phase 1: Create manifest in 'writing' state
  const manifest: ProjectBaseCommitManifestDoc = {
    id: 'manifest',
    commitId,
    datasetEpoch: epoch,
    commitState: 'writing',
    resultChunkCount: resultChunks.length,
    clusterChunkCount: clusterChunks.length,
    suggestionChunkCount: suggestionChunks.length,
    autoMergeChunkCount: autoMergeChunks.length,
    groupMergeChunkCount: groupMergeChunks.length,
    contentHash: null,
    createdAt: now,
    createdByClientId: actorId,
  };

  await setDoc(baseCommitRef(projectId, commitId), sanitizeJsonForFirestore(manifest));

  // Phase 2: Upload all chunks in batched writes
  const chunksCol = baseCommitChunksRef(projectId, commitId);
  const allChunks: ProjectBaseCommitChunkDoc[] = [];

  const addChunks = (
    chunks: unknown[][],
    type: ProjectBaseCommitChunkDoc['type'],
  ) => {
    chunks.forEach((data, index) => {
      allChunks.push({
        id: `${type}_${index}`,
        type,
        index,
        datasetEpoch: epoch,
        data,
      });
    });
  };

  addChunks(resultChunks, 'results');
  addChunks(clusterChunks, 'clusters');
  addChunks(suggestionChunks, 'suggestions');
  addChunks(autoMergeChunks, 'auto_merge');
  addChunks(groupMergeChunks, 'group_merge');

  // Write chunks in Firestore batches (max 500 ops per batch)
  const batchPromises: Promise<void>[] = [];
  let batch = writeBatch(db);
  let ops = 0;

  for (const chunk of allChunks) {
    const chunkDoc = doc(chunksCol, chunk.id);
    batch.set(chunkDoc, sanitizeJsonForFirestore(chunk));
    ops++;
    if (ops >= 500) {
      batchPromises.push(batch.commit());
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) {
    batchPromises.push(batch.commit());
  }

  await withPersistTimeout(
    Promise.all(batchPromises),
    BATCH_TIMEOUT_MS,
    `[collabV2] Base commit chunk upload (${batchPromises.length} batches, commit ${commitId})`,
  );

  // Phase 3: Flip manifest to 'ready'
  const readyManifest: ProjectBaseCommitManifestDoc = {
    ...manifest,
    commitState: 'ready',
  };
  await setDoc(baseCommitRef(projectId, commitId), sanitizeJsonForFirestore(readyManifest));

  return readyManifest;
}

/**
 * Load the manifest doc for a base commit.
 * Returns null if not found.
 */
export async function loadBaseCommitManifest(
  projectId: string,
  commitId: string,
): Promise<ProjectBaseCommitManifestDoc | null> {
  const snap = await getDoc(baseCommitRef(projectId, commitId));
  if (!snap.exists()) return null;
  return snap.data() as ProjectBaseCommitManifestDoc;
}

/**
 * Load all chunk docs for a base commit.
 */
export async function loadBaseCommitChunks(
  projectId: string,
  commitId: string,
): Promise<ProjectBaseCommitChunkDoc[]> {
  const snap = await getDocs(baseCommitChunksRef(projectId, commitId));
  return snap.docs.map((d) => d.data() as ProjectBaseCommitChunkDoc);
}

// ─── CAS entity operations ───

/**
 * Apply a batch of CAS (Compare-And-Swap) changes to revisioned entity docs.
 *
 * Each change is processed in its own transaction to ensure per-doc atomicity:
 * - For upserts: reads current revision, validates it matches expectedRevision,
 *   then writes the new value with revision incremented.
 * - For deletes: reads current revision, validates it matches expectedRevision,
 *   then deletes the doc.
 *
 * Returns an ack for each change indicating success/failure.
 */
export async function commitRevisionedDocChanges<T extends ProjectRevisionFields>(
  projectId: string,
  subcollection: V2EntityCollectionName,
  changes: RevisionedDocChange<T>[],
  actorId: string,
): Promise<RevisionedDocAck[]> {
  const colRef = entityCollectionRef(projectId, subcollection);
  const acks: RevisionedDocAck[] = [];

  for (const change of changes) {
    const scopedId = scopeCollabDocId(change.datasetEpoch, change.id);
    const docRef = doc(colRef, scopedId);

    try {
      const ack = await runTransaction(db, async (txn) => {
        const snap = await txn.get(docRef);
        const currentRevision = snap.exists()
          ? (snap.data() as ProjectRevisionFields).revision
          : 0;

        if (currentRevision !== change.expectedRevision) {
          return {
            id: change.id,
            kind: change.kind,
            newRevision: currentRevision,
            lastMutationId: change.mutationId ?? null,
            success: false,
            error: `Revision mismatch: expected ${change.expectedRevision}, got ${currentRevision}`,
          } satisfies RevisionedDocAck;
        }

        const now = new Date().toISOString();

        if (change.kind === 'delete') {
          if (snap.exists()) {
            txn.delete(docRef);
          }
          return {
            id: change.id,
            kind: 'delete',
            newRevision: currentRevision,
            lastMutationId: change.mutationId ?? null,
            success: true,
          } satisfies RevisionedDocAck;
        }

        // Upsert
        if (!change.value) {
          throw new Error(`[collabV2] Upsert change for ${change.id} missing value`);
        }

        const newRevision = currentRevision + 1;
        const newDoc: T = {
          ...change.value,
          revision: newRevision,
          updatedAt: now,
          updatedByClientId: actorId,
          lastMutationId: change.mutationId ?? null,
        };

        txn.set(docRef, sanitizeJsonForFirestore(newDoc));

        return {
          id: change.id,
          kind: 'upsert',
          newRevision,
          lastMutationId: change.mutationId ?? null,
          success: true,
        } satisfies RevisionedDocAck;
      });

      acks.push(ack);
    } catch (err) {
      acks.push({
        id: change.id,
        kind: change.kind,
        newRevision: -1,
        lastMutationId: change.mutationId ?? null,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return acks;
}

// ─── Activity log (non-revisioned) ───

/**
 * Append a single activity log entry to the project's activity_log subcollection.
 */
export async function appendActivityLogEntry(
  projectId: string,
  entry: ProjectActivityLogDoc,
): Promise<void> {
  const colRef = entityCollectionRef(projectId, V2_ENTITY_COLLECTIONS.activityLog);
  const scopedId = scopeCollabDocId(entry.datasetEpoch, entry.id);
  await setDoc(doc(colRef, scopedId), sanitizeJsonForFirestore(entry));
}

/**
 * Replace the entire activity log for a project within a specific epoch.
 *
 * Writes all entries in batched writes. Existing entries not in the new list
 * are NOT deleted (append-only by design; use epoch scoping for isolation).
 */
export async function replaceActivityLog(
  projectId: string,
  entries: ProjectActivityLogDoc[],
): Promise<void> {
  const colRef = entityCollectionRef(projectId, V2_ENTITY_COLLECTIONS.activityLog);

  const batchPromises: Promise<void>[] = [];
  let batch = writeBatch(db);
  let ops = 0;

  for (const entry of entries) {
    const scopedId = scopeCollabDocId(entry.datasetEpoch, entry.id);
    batch.set(doc(colRef, scopedId), sanitizeJsonForFirestore(entry));
    ops++;
    if (ops >= 500) {
      batchPromises.push(batch.commit());
      batch = writeBatch(db);
      ops = 0;
    }
  }

  if (ops > 0) {
    batchPromises.push(batch.commit());
  }

  await withPersistTimeout(
    Promise.all(batchPromises),
    BATCH_TIMEOUT_MS,
    `[collabV2] Replace activity log (${entries.length} entries)`,
  );
}

// ─── Entity loaders ───

/**
 * Load all epoch-scoped entities for a given epoch.
 *
 * Queries each entity subcollection for docs whose datasetEpoch matches.
 * Returns the canonical entity state (excluding meta and activeOperation,
 * which are loaded separately).
 */
export async function loadEpochEntities(
  projectId: string,
  epoch: number,
): Promise<Omit<ProjectCollabEntityState, 'meta' | 'activeOperation'>> {
  const loadCollection = async <T>(collectionName: V2EntityCollectionName): Promise<T[]> => {
    const colRef = entityCollectionRef(projectId, collectionName);
    const q = query(colRef, where('datasetEpoch', '==', epoch));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as T);
  };

  const [
    groups,
    blockedTokens,
    manualBlockedKeywords,
    tokenMergeRules,
    labelSections,
    activityLog,
  ] = await Promise.all([
    loadCollection<ProjectGroupDoc>(V2_ENTITY_COLLECTIONS.groups),
    loadCollection<ProjectBlockedTokenDoc>(V2_ENTITY_COLLECTIONS.blockedTokens),
    loadCollection<ProjectBlockedKeywordDoc>(V2_ENTITY_COLLECTIONS.manualBlockedKeywords),
    loadCollection<ProjectTokenMergeRuleDoc>(V2_ENTITY_COLLECTIONS.tokenMergeRules),
    loadCollection<ProjectLabelSectionDoc>(V2_ENTITY_COLLECTIONS.labelSections),
    loadCollection<ProjectActivityLogDoc>(V2_ENTITY_COLLECTIONS.activityLog),
  ]);

  return {
    groups,
    blockedTokens,
    manualBlockedKeywords,
    tokenMergeRules,
    labelSections,
    activityLog,
  };
}

// ─── Operation lock lifecycle ───

/**
 * Check whether an operation lock has expired based on its expiresAt timestamp.
 */
export function lockIsExpired(lock: ProjectOperationLockDoc): boolean {
  return new Date(lock.expiresAt).getTime() < Date.now();
}

/**
 * Acquire a project-level operation lock.
 *
 * Uses a Firestore transaction to atomically check whether a lock exists:
 * - If no lock exists, creates one.
 * - If the existing lock is expired, replaces it.
 * - If the existing lock is in 'releasing' state, replaces it.
 * - Otherwise, throws an error indicating the lock is held.
 *
 * @throws Error if a non-expired, non-releasing lock is already held
 */
export async function acquireProjectOperationLock(
  projectId: string,
  type: ProjectOperationLockDoc['type'],
  ownerId: string,
): Promise<ProjectOperationLockDoc> {
  const lockRef = operationLockRef(projectId);
  const now = new Date();

  return runTransaction(db, async (txn) => {
    const snap = await txn.get(lockRef);

    if (snap.exists()) {
      const existing = snap.data() as ProjectOperationLockDoc;
      const isExpired = lockIsExpired(existing);
      const isReleasing = existing.status === 'releasing';

      if (!isExpired && !isReleasing) {
        throw new Error(
          `[collabV2] Operation lock held by ${existing.ownerId} ` +
          `(type=${existing.type}, expires=${existing.expiresAt}). ` +
          `Cannot acquire lock for ${type}.`,
        );
      }
    }

    const newLock: ProjectOperationLockDoc = {
      type,
      ownerId,
      startedAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
      status: 'running',
    };

    txn.set(lockRef, sanitizeJsonForFirestore(newLock));
    return newLock;
  });
}

/**
 * Release a project-level operation lock.
 *
 * Only the owner (matched by ownerId) can release the lock. If the lock
 * does not exist or is owned by someone else, this is a no-op.
 */
export async function releaseProjectOperationLock(
  projectId: string,
  ownerId: string,
): Promise<void> {
  const lockRef = operationLockRef(projectId);

  await runTransaction(db, async (txn) => {
    const snap = await txn.get(lockRef);
    if (!snap.exists()) return;

    const existing = snap.data() as ProjectOperationLockDoc;
    if (existing.ownerId !== ownerId) return;

    txn.delete(lockRef);
  });
}

/**
 * Update the heartbeat timestamp on a project-level operation lock.
 *
 * Extends the lock's expiration by LOCK_TTL_MS from now.
 * Only the owner (matched by ownerId) can heartbeat the lock.
 *
 * @throws Error if the lock does not exist or is owned by someone else
 */
export async function heartbeatProjectOperationLock(
  projectId: string,
  ownerId: string,
): Promise<void> {
  const lockRef = operationLockRef(projectId);
  const now = new Date();

  await runTransaction(db, async (txn) => {
    const snap = await txn.get(lockRef);
    if (!snap.exists()) {
      throw new Error(`[collabV2] No operation lock found for project ${projectId}`);
    }

    const existing = snap.data() as ProjectOperationLockDoc;
    if (existing.ownerId !== ownerId) {
      throw new Error(
        `[collabV2] Lock owned by ${existing.ownerId}, cannot heartbeat as ${ownerId}`,
      );
    }

    const updated: ProjectOperationLockDoc = {
      ...existing,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
    };

    txn.set(lockRef, sanitizeJsonForFirestore(updated));
  });
}
