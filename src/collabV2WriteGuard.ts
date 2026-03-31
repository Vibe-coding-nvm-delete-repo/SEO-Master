import type { ProjectCollabMetaDoc } from './collabV2Types';

// ─── Generation Fence ───
// Prevents stale async writes from applying after a project switch.
// Every project load increments the generation; async operations capture
// the generation at start and check it before applying results.

let currentGeneration = 0;
let currentProjectId: string | null = null;

/**
 * Increment the generation counter. Called on every project load/switch.
 * Returns the new generation number.
 */
export function advanceGeneration(projectId: string): number {
  currentGeneration += 1;
  currentProjectId = projectId;
  return currentGeneration;
}

/**
 * Get the current generation for a project.
 * Returns null if no project is loaded.
 */
export function getCurrentGeneration(): { generation: number; projectId: string | null } {
  return { generation: currentGeneration, projectId: currentProjectId };
}

/**
 * Check if a captured generation is still current.
 * Used by async operations to verify they should still apply their results.
 */
export function isGenerationCurrent(capturedGeneration: number, capturedProjectId: string): boolean {
  return currentGeneration === capturedGeneration && currentProjectId === capturedProjectId;
}

/**
 * Create a generation guard that can be checked before applying async results.
 * Captures the current generation at creation time.
 *
 * Usage:
 *   const guard = createGenerationGuard(projectId);
 *   // ... async work ...
 *   if (!guard.isCurrent()) return; // Project switched, discard results
 */
export function createGenerationGuard(projectId: string): {
  generation: number;
  projectId: string;
  isCurrent: () => boolean;
} {
  const captured = currentGeneration;
  return {
    generation: captured,
    projectId,
    isCurrent: () => isGenerationCurrent(captured, projectId),
  };
}

// ─── Write Mode Guard ───
// Determines whether a write operation is allowed based on V2 state.

export type WriteMode = 'legacy' | 'v2' | 'blocked';

export interface WriteGuardResult {
  mode: WriteMode;
  allowed: boolean;
  reason?: string;
}

/**
 * Determine the write mode for a project based on its collab meta.
 *
 * Rules:
 * - No meta → legacy mode (old projects, unrestricted writes)
 * - readMode 'legacy' → legacy mode
 * - readMode 'v2' + commitState 'ready' + migrationState 'complete' → v2 mode
 * - readMode 'v2' + commitState 'writing' → blocked (commit in progress)
 * - readMode 'v2' + migrationState 'running' → blocked (migration in progress)
 * - readMode 'v2' + migrationState 'failed' → blocked (manual intervention needed)
 */
export function determineWriteMode(meta: ProjectCollabMetaDoc | null): WriteGuardResult {
  if (!meta) {
    return { mode: 'legacy', allowed: true };
  }

  if (meta.readMode === 'legacy') {
    return { mode: 'legacy', allowed: true };
  }

  // V2 mode
  if (meta.migrationState === 'running') {
    return { mode: 'blocked', allowed: false, reason: 'Migration in progress' };
  }

  if (meta.migrationState === 'failed') {
    return { mode: 'blocked', allowed: false, reason: 'Migration failed — manual intervention required' };
  }

  if (meta.commitState === 'writing') {
    return { mode: 'blocked', allowed: false, reason: 'Commit write in progress' };
  }

  if (meta.commitState === 'ready' && meta.migrationState === 'complete') {
    return { mode: 'v2', allowed: true };
  }

  // Fallback: idle state or other — allow v2
  if (meta.readMode === 'v2') {
    return { mode: 'v2', allowed: true };
  }

  return { mode: 'legacy', allowed: true };
}

/**
 * Guard a write operation. Throws if writes are blocked.
 * For V2 mode, validates that the write uses the correct path.
 */
export function assertWriteAllowed(
  meta: ProjectCollabMetaDoc | null,
  writeType: 'entity' | 'base-commit' | 'metadata' | 'legacy-chunks',
): void {
  const guard = determineWriteMode(meta);

  if (!guard.allowed) {
    throw new WriteBlockedError(guard.reason || 'Writes blocked');
  }

  // V2-specific restrictions
  if (guard.mode === 'v2') {
    if (writeType === 'legacy-chunks') {
      throw new WriteBlockedError('Legacy chunk writes are blocked for V2 projects');
    }
  }

  // Legacy-specific restrictions
  if (guard.mode === 'legacy') {
    if (writeType === 'entity') {
      throw new WriteBlockedError('CAS entity writes require V2 mode');
    }
    if (writeType === 'base-commit') {
      throw new WriteBlockedError('Base commit writes require V2 mode');
    }
  }
}

export class WriteBlockedError extends Error {
  readonly code = 'write-blocked';

  constructor(reason: string) {
    super(`[V2 Write Guard] ${reason}`);
    this.name = 'WriteBlockedError';
  }
}

// ─── Epoch Validation ───

/**
 * Validate that a write targets the correct epoch.
 * Throws if the epoch doesn't match the current meta epoch.
 */
export function assertEpochMatch(
  meta: ProjectCollabMetaDoc,
  writeEpoch: number,
): void {
  if (writeEpoch !== meta.datasetEpoch) {
    throw new EpochMismatchError(meta.datasetEpoch, writeEpoch);
  }
}

export class EpochMismatchError extends Error {
  readonly code = 'epoch-mismatch';
  readonly expectedEpoch: number;
  readonly actualEpoch: number;

  constructor(expected: number, actual: number) {
    super(`[V2 Write Guard] Epoch mismatch: expected ${expected}, got ${actual}`);
    this.name = 'EpochMismatchError';
    this.expectedEpoch = expected;
    this.actualEpoch = actual;
  }
}

// ─── Suppress Snapshot Flag ───
// During Firestore writes, the onSnapshot listener must be suppressed
// to prevent it from overwriting in-flight state changes.

let suppressSnapshotCount = 0;

/**
 * Begin suppressing snapshot listener processing.
 * Can be nested — each beginSuppressSnapshot must be paired with endSuppressSnapshot.
 */
export function beginSuppressSnapshot(): void {
  suppressSnapshotCount += 1;
}

/**
 * End suppressing snapshot listener processing.
 */
export function endSuppressSnapshot(): void {
  suppressSnapshotCount = Math.max(0, suppressSnapshotCount - 1);
}

/**
 * Check if snapshot processing is currently suppressed.
 */
export function isSnapshotSuppressed(): boolean {
  return suppressSnapshotCount > 0;
}

/**
 * Run an async operation with snapshot suppression.
 * Automatically handles begin/end, even on error.
 */
export async function withSnapshotSuppression<T>(fn: () => Promise<T>): Promise<T> {
  beginSuppressSnapshot();
  try {
    return await fn();
  } finally {
    endSuppressSnapshot();
  }
}

// ─── Test helpers ───

/** Reset all module state (for tests only) */
export function _resetWriteGuardState(): void {
  currentGeneration = 0;
  currentProjectId = null;
  suppressSnapshotCount = 0;
}
