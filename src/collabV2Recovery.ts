/**
 * collabV2Recovery.ts — Deterministic recovery FSM for V2 collaboration stuck states.
 *
 * Handles recovery for:
 * 1. commitState: 'writing' — commit started but never finalized
 * 2. Stale migration lease — migration owned by a dead client
 * 3. Stale operation lock — lock held by a dead client
 * 4. Meta pointing to unavailable commit — base commit not found or not ready
 */

import type {
  ProjectCollabMetaDoc,
  ProjectOperationLockDoc,
  ProjectBaseCommitManifestDoc,
} from './collabV2Types';

// ─── Recovery states ───

export type RecoveryDiagnostic =
  | { kind: 'healthy'; detail: string }
  | { kind: 'stuck-writing'; commitId: string; canFinalize: boolean; detail: string }
  | { kind: 'stale-migration'; ownerClientId: string; expiredAt: string; detail: string }
  | { kind: 'stale-lock'; lock: ProjectOperationLockDoc; detail: string }
  | { kind: 'missing-commit'; commitId: string; detail: string }
  | { kind: 'unrecoverable'; detail: string };

export type RecoveryAction =
  | { type: 'none' }
  | { type: 'finalize-commit'; commitId: string }
  | { type: 'clear-migration-lease' }
  | { type: 'clear-stale-lock' }
  | { type: 'rollback-to-last-ready' }
  | { type: 'enter-read-only'; reason: string };

export interface RecoveryResult {
  diagnostic: RecoveryDiagnostic;
  action: RecoveryAction;
  /** Whether writes should be blocked until manual intervention */
  writesBlocked: boolean;
  /** The meta state after recovery (or null if unchanged) */
  recoveredMeta: ProjectCollabMetaDoc | null;
}

// ─── Diagnostic functions ───

/**
 * Check if a migration lease is expired.
 */
export function isMigrationLeaseExpired(meta: ProjectCollabMetaDoc): boolean {
  if (!meta.migrationExpiresAt) return true;
  return new Date(meta.migrationExpiresAt).getTime() < Date.now();
}

/**
 * Check if an operation lock is expired.
 */
export function isOperationLockExpired(lock: ProjectOperationLockDoc): boolean {
  return new Date(lock.expiresAt).getTime() < Date.now();
}

/**
 * Diagnose the current state of a V2 project and determine recovery action.
 *
 * Priority order:
 *   1. Migration state (running / failed)
 *   2. Commit state (stuck writing)
 *   3. Base commit validity (missing / not ready)
 *   4. Operation lock (stale)
 *   5. Healthy
 *
 * @param meta - Current collab meta document
 * @param manifest - Base commit manifest (null if not loadable)
 * @param lock - Current operation lock (null if none)
 * @param currentClientId - This client's ID (to distinguish own vs foreign leases)
 */
export function diagnoseV2State(
  meta: ProjectCollabMetaDoc,
  manifest: ProjectBaseCommitManifestDoc | null,
  lock: ProjectOperationLockDoc | null,
  currentClientId: string,
): RecoveryResult {
  // 1. Check migration state
  if (meta.migrationState === 'running') {
    if (meta.migrationOwnerClientId === currentClientId) {
      // Our own migration — check if expired
      if (isMigrationLeaseExpired(meta)) {
        return {
          diagnostic: {
            kind: 'stale-migration',
            ownerClientId: currentClientId,
            expiredAt: meta.migrationExpiresAt!,
            detail: 'Own migration lease expired',
          },
          action: { type: 'clear-migration-lease' },
          writesBlocked: true,
          recoveredMeta: null,
        };
      }
      // Still running and ours — not stuck
      return {
        diagnostic: { kind: 'healthy', detail: 'Migration in progress (owned by this client)' },
        action: { type: 'none' },
        writesBlocked: false,
        recoveredMeta: null,
      };
    } else {
      // Foreign migration
      if (isMigrationLeaseExpired(meta)) {
        return {
          diagnostic: {
            kind: 'stale-migration',
            ownerClientId: meta.migrationOwnerClientId!,
            expiredAt: meta.migrationExpiresAt!,
            detail: 'Foreign migration lease expired',
          },
          action: { type: 'clear-migration-lease' },
          writesBlocked: true,
          recoveredMeta: null,
        };
      }
      // Still running by another client — wait
      return {
        diagnostic: { kind: 'healthy', detail: `Migration in progress by ${meta.migrationOwnerClientId}` },
        action: { type: 'none' },
        writesBlocked: true, // block writes while foreign migration runs
        recoveredMeta: null,
      };
    }
  }

  if (meta.migrationState === 'failed') {
    return {
      diagnostic: { kind: 'unrecoverable', detail: 'Migration previously failed — manual intervention required' },
      action: { type: 'enter-read-only', reason: 'Migration failed' },
      writesBlocked: true,
      recoveredMeta: null,
    };
  }

  // 2. Check commit state
  if (meta.commitState === 'writing') {
    if (!meta.baseCommitId) {
      return {
        diagnostic: { kind: 'stuck-writing', commitId: '', canFinalize: false, detail: 'Writing state but no commitId' },
        action: { type: 'rollback-to-last-ready' },
        writesBlocked: true,
        recoveredMeta: null,
      };
    }
    if (!manifest) {
      return {
        diagnostic: { kind: 'missing-commit', commitId: meta.baseCommitId, detail: 'Manifest not found for writing commit' },
        action: { type: 'rollback-to-last-ready' },
        writesBlocked: true,
        recoveredMeta: null,
      };
    }
    if (manifest.commitState === 'ready') {
      // Commit is actually ready — just finalize the meta
      return {
        diagnostic: { kind: 'stuck-writing', commitId: meta.baseCommitId, canFinalize: true, detail: 'Commit is ready, meta not updated' },
        action: { type: 'finalize-commit', commitId: meta.baseCommitId },
        writesBlocked: false,
        recoveredMeta: null,
      };
    }
    // Commit still in writing state — cannot finalize
    return {
      diagnostic: { kind: 'stuck-writing', commitId: meta.baseCommitId, canFinalize: false, detail: 'Commit chunks incomplete' },
      action: { type: 'rollback-to-last-ready' },
      writesBlocked: true,
      recoveredMeta: null,
    };
  }

  // 3. Check for missing/invalid base commit reference
  if (meta.commitState === 'ready' && meta.baseCommitId) {
    if (!manifest) {
      return {
        diagnostic: { kind: 'missing-commit', commitId: meta.baseCommitId, detail: 'Meta references commit that does not exist' },
        action: { type: 'enter-read-only', reason: 'Base commit missing' },
        writesBlocked: true,
        recoveredMeta: null,
      };
    }
    if (manifest.commitState !== 'ready') {
      return {
        diagnostic: { kind: 'missing-commit', commitId: meta.baseCommitId, detail: 'Meta references commit that is not ready' },
        action: { type: 'enter-read-only', reason: 'Base commit not ready' },
        writesBlocked: true,
        recoveredMeta: null,
      };
    }
  }

  // 4. Check operation lock
  if (lock && !isOperationLockExpired(lock) && lock.ownerId !== currentClientId) {
    // Active lock by another client — not stuck, just busy
    return {
      diagnostic: { kind: 'healthy', detail: `Operation lock held by ${lock.ownerId}` },
      action: { type: 'none' },
      writesBlocked: false, // entity writes still allowed, just op lock is taken
      recoveredMeta: null,
    };
  }
  if (lock && isOperationLockExpired(lock)) {
    return {
      diagnostic: { kind: 'stale-lock', lock, detail: `Lock expired at ${lock.expiresAt}` },
      action: { type: 'clear-stale-lock' },
      writesBlocked: false,
      recoveredMeta: null,
    };
  }

  // 5. Healthy
  return {
    diagnostic: { kind: 'healthy', detail: 'V2 state is consistent' },
    action: { type: 'none' },
    writesBlocked: false,
    recoveredMeta: null,
  };
}

/**
 * Execute a recovery action. Returns the updated meta or null if no change.
 *
 * This function coordinates with the storage layer to perform the actual
 * Firestore writes needed for recovery. It is designed to be called from
 * the bootstrap path.
 *
 * @param projectId - The project to recover
 * @param result - The diagnostic result from diagnoseV2State
 * @param actorId - This client's ID
 * @param storage - Storage operations (dependency injection for testability)
 */
export async function executeRecoveryAction(
  projectId: string,
  result: RecoveryResult,
  actorId: string,
  storage: {
    loadCollabMeta: (projectId: string) => Promise<ProjectCollabMetaDoc | null>;
    flipProjectMetaToCommit: (projectId: string, commitId: string, epoch: number, actorId: string) => Promise<ProjectCollabMetaDoc>;
    clearMigrationLease: (projectId: string, actorId: string) => Promise<ProjectCollabMetaDoc>;
    clearOperationLock: (projectId: string) => Promise<void>;
  },
): Promise<RecoveryResult> {
  const { action } = result;

  switch (action.type) {
    case 'none':
      return result;

    case 'finalize-commit': {
      try {
        const meta = await storage.loadCollabMeta(projectId);
        if (!meta) return { ...result, writesBlocked: true };
        const recovered = await storage.flipProjectMetaToCommit(
          projectId,
          action.commitId,
          meta.datasetEpoch,
          actorId,
        );
        return { ...result, recoveredMeta: recovered, writesBlocked: false };
      } catch (err) {
        console.error('[V2 Recovery] Failed to finalize commit:', err);
        return {
          ...result,
          writesBlocked: true,
          action: { type: 'enter-read-only', reason: `Finalize failed: ${(err as Error).message}` },
        };
      }
    }

    case 'clear-migration-lease': {
      try {
        const recovered = await storage.clearMigrationLease(projectId, actorId);
        return { ...result, recoveredMeta: recovered, writesBlocked: false };
      } catch (err) {
        console.error('[V2 Recovery] Failed to clear migration lease:', err);
        return { ...result, writesBlocked: true };
      }
    }

    case 'clear-stale-lock': {
      try {
        await storage.clearOperationLock(projectId);
        return { ...result, writesBlocked: false };
      } catch (err) {
        console.error('[V2 Recovery] Failed to clear stale lock:', err);
        return result; // non-critical, lock will expire
      }
    }

    case 'rollback-to-last-ready': {
      // Cannot automatically find the "last ready" commit — enter read-only
      return {
        ...result,
        action: { type: 'enter-read-only', reason: 'Rollback required but no automatic path available' },
        writesBlocked: true,
      };
    }

    case 'enter-read-only':
      return result; // Already in read-only state

    default:
      return result;
  }
}
