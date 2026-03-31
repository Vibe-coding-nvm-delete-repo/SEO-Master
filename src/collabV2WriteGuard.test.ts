import { describe, it, expect, beforeEach } from 'vitest';
import {
  advanceGeneration,
  getCurrentGeneration,
  isGenerationCurrent,
  createGenerationGuard,
  determineWriteMode,
  assertWriteAllowed,
  assertEpochMatch,
  beginSuppressSnapshot,
  endSuppressSnapshot,
  isSnapshotSuppressed,
  withSnapshotSuppression,
  WriteBlockedError,
  EpochMismatchError,
  _resetWriteGuardState,
} from './collabV2WriteGuard';
import type { ProjectCollabMetaDoc } from './collabV2Types';

// Helper to create a minimal valid meta doc
function makeMeta(overrides: Partial<ProjectCollabMetaDoc> = {}): ProjectCollabMetaDoc {
  return {
    schemaVersion: 2,
    revision: 1,
    datasetEpoch: 1,
    baseCommitId: 'commit-1',
    commitState: 'ready',
    readMode: 'v2',
    migrationState: 'complete',
    migrationOwnerClientId: null,
    migrationExpiresAt: null,
    updatedAt: new Date().toISOString(),
    updatedByClientId: 'client-1',
    ...overrides,
  };
}

describe('Generation Fence', () => {
  beforeEach(() => _resetWriteGuardState());

  it('starts at generation 0 with no project', () => {
    const { generation, projectId } = getCurrentGeneration();
    expect(generation).toBe(0);
    expect(projectId).toBeNull();
  });

  it('advanceGeneration increments counter and sets projectId', () => {
    const gen = advanceGeneration('proj-1');
    expect(gen).toBe(1);
    const { generation, projectId } = getCurrentGeneration();
    expect(generation).toBe(1);
    expect(projectId).toBe('proj-1');
  });

  it('advanceGeneration increments on repeated calls', () => {
    advanceGeneration('proj-1');
    advanceGeneration('proj-1');
    const gen = advanceGeneration('proj-1');
    expect(gen).toBe(3);
  });

  it('isGenerationCurrent returns true for current generation + project', () => {
    advanceGeneration('proj-1');
    expect(isGenerationCurrent(1, 'proj-1')).toBe(true);
  });

  it('isGenerationCurrent returns false after generation advances', () => {
    advanceGeneration('proj-1');
    advanceGeneration('proj-1');
    expect(isGenerationCurrent(1, 'proj-1')).toBe(false);
  });

  it('isGenerationCurrent returns false for wrong project', () => {
    advanceGeneration('proj-1');
    expect(isGenerationCurrent(1, 'proj-2')).toBe(false);
  });

  it('isGenerationCurrent returns false after project switch', () => {
    advanceGeneration('proj-1');
    advanceGeneration('proj-2');
    expect(isGenerationCurrent(1, 'proj-1')).toBe(false);
    expect(isGenerationCurrent(2, 'proj-1')).toBe(false);
    expect(isGenerationCurrent(2, 'proj-2')).toBe(true);
  });

  it('createGenerationGuard captures current generation', () => {
    advanceGeneration('proj-1');
    const guard = createGenerationGuard('proj-1');
    expect(guard.generation).toBe(1);
    expect(guard.projectId).toBe('proj-1');
    expect(guard.isCurrent()).toBe(true);
  });

  it('createGenerationGuard becomes stale after advance', () => {
    advanceGeneration('proj-1');
    const guard = createGenerationGuard('proj-1');
    advanceGeneration('proj-1');
    expect(guard.isCurrent()).toBe(false);
  });

  it('createGenerationGuard becomes stale after project switch', () => {
    advanceGeneration('proj-1');
    const guard = createGenerationGuard('proj-1');
    advanceGeneration('proj-2');
    expect(guard.isCurrent()).toBe(false);
  });

  it('concurrent guards for different projects work independently', () => {
    advanceGeneration('proj-1');
    const guard1 = createGenerationGuard('proj-1');
    advanceGeneration('proj-2');
    const guard2 = createGenerationGuard('proj-2');
    expect(guard1.isCurrent()).toBe(false);
    expect(guard2.isCurrent()).toBe(true);
  });

  it('guard created with wrong projectId is never current', () => {
    advanceGeneration('proj-1');
    const guard = createGenerationGuard('proj-other');
    expect(guard.isCurrent()).toBe(false);
  });
});

describe('Write Mode Guard', () => {
  it('null meta returns legacy mode', () => {
    const result = determineWriteMode(null);
    expect(result).toEqual({ mode: 'legacy', allowed: true });
  });

  it('readMode legacy returns legacy mode', () => {
    const result = determineWriteMode(makeMeta({ readMode: 'legacy' }));
    expect(result).toEqual({ mode: 'legacy', allowed: true });
  });

  it('v2 + ready + complete returns v2 mode', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      commitState: 'ready',
      migrationState: 'complete',
    }));
    expect(result).toEqual({ mode: 'v2', allowed: true });
  });

  it('v2 + writing commit returns blocked', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      commitState: 'writing',
      migrationState: 'complete',
    }));
    expect(result.mode).toBe('blocked');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Commit write in progress');
  });

  it('v2 + migration running returns blocked', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      migrationState: 'running',
    }));
    expect(result.mode).toBe('blocked');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Migration in progress');
  });

  it('v2 + migration failed returns blocked', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      migrationState: 'failed',
    }));
    expect(result.mode).toBe('blocked');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Migration failed');
  });

  it('v2 + idle commitState falls through to v2 allowed', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      commitState: 'idle',
      migrationState: 'complete',
    }));
    expect(result).toEqual({ mode: 'v2', allowed: true });
  });

  it('migration running takes priority over commit writing', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      commitState: 'writing',
      migrationState: 'running',
    }));
    expect(result.reason).toContain('Migration in progress');
  });

  it('migration failed takes priority over commit writing', () => {
    const result = determineWriteMode(makeMeta({
      readMode: 'v2',
      commitState: 'writing',
      migrationState: 'failed',
    }));
    expect(result.reason).toContain('Migration failed');
  });
});

describe('assertWriteAllowed', () => {
  it('allows legacy-chunks writes in legacy mode', () => {
    expect(() => assertWriteAllowed(null, 'legacy-chunks')).not.toThrow();
  });

  it('allows metadata writes in legacy mode', () => {
    expect(() => assertWriteAllowed(null, 'metadata')).not.toThrow();
  });

  it('blocks entity writes in legacy mode', () => {
    expect(() => assertWriteAllowed(null, 'entity')).toThrow(WriteBlockedError);
    expect(() => assertWriteAllowed(null, 'entity')).toThrow('CAS entity writes require V2 mode');
  });

  it('blocks base-commit writes in legacy mode', () => {
    expect(() => assertWriteAllowed(null, 'base-commit')).toThrow(WriteBlockedError);
    expect(() => assertWriteAllowed(null, 'base-commit')).toThrow('Base commit writes require V2 mode');
  });

  it('allows entity writes in v2 mode', () => {
    const meta = makeMeta({ readMode: 'v2', commitState: 'ready', migrationState: 'complete' });
    expect(() => assertWriteAllowed(meta, 'entity')).not.toThrow();
  });

  it('allows base-commit writes in v2 mode', () => {
    const meta = makeMeta({ readMode: 'v2', commitState: 'ready', migrationState: 'complete' });
    expect(() => assertWriteAllowed(meta, 'base-commit')).not.toThrow();
  });

  it('allows metadata writes in v2 mode', () => {
    const meta = makeMeta({ readMode: 'v2', commitState: 'ready', migrationState: 'complete' });
    expect(() => assertWriteAllowed(meta, 'metadata')).not.toThrow();
  });

  it('blocks legacy-chunks writes in v2 mode', () => {
    const meta = makeMeta({ readMode: 'v2', commitState: 'ready', migrationState: 'complete' });
    expect(() => assertWriteAllowed(meta, 'legacy-chunks')).toThrow(WriteBlockedError);
    expect(() => assertWriteAllowed(meta, 'legacy-chunks')).toThrow('Legacy chunk writes are blocked');
  });

  it('throws WriteBlockedError when state is blocked', () => {
    const meta = makeMeta({ readMode: 'v2', migrationState: 'running' });
    expect(() => assertWriteAllowed(meta, 'entity')).toThrow(WriteBlockedError);
    expect(() => assertWriteAllowed(meta, 'legacy-chunks')).toThrow(WriteBlockedError);
    expect(() => assertWriteAllowed(meta, 'metadata')).toThrow(WriteBlockedError);
  });

  it('WriteBlockedError has correct code property', () => {
    try {
      assertWriteAllowed(makeMeta({ readMode: 'v2', migrationState: 'running' }), 'entity');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WriteBlockedError);
      expect((e as WriteBlockedError).code).toBe('write-blocked');
      expect((e as WriteBlockedError).name).toBe('WriteBlockedError');
    }
  });
});

describe('Epoch Validation', () => {
  it('passes when epoch matches', () => {
    const meta = makeMeta({ datasetEpoch: 3 });
    expect(() => assertEpochMatch(meta, 3)).not.toThrow();
  });

  it('throws EpochMismatchError when epoch does not match', () => {
    const meta = makeMeta({ datasetEpoch: 3 });
    expect(() => assertEpochMatch(meta, 2)).toThrow(EpochMismatchError);
  });

  it('EpochMismatchError has correct properties', () => {
    const meta = makeMeta({ datasetEpoch: 5 });
    try {
      assertEpochMatch(meta, 2);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EpochMismatchError);
      const err = e as EpochMismatchError;
      expect(err.code).toBe('epoch-mismatch');
      expect(err.name).toBe('EpochMismatchError');
      expect(err.expectedEpoch).toBe(5);
      expect(err.actualEpoch).toBe(2);
      expect(err.message).toContain('expected 5');
      expect(err.message).toContain('got 2');
    }
  });

  it('epoch 0 is a valid epoch value', () => {
    const meta = makeMeta({ datasetEpoch: 0 });
    expect(() => assertEpochMatch(meta, 0)).not.toThrow();
    expect(() => assertEpochMatch(meta, 1)).toThrow(EpochMismatchError);
  });
});

describe('Snapshot Suppression', () => {
  beforeEach(() => _resetWriteGuardState());

  it('starts not suppressed', () => {
    expect(isSnapshotSuppressed()).toBe(false);
  });

  it('begin/end toggles correctly', () => {
    beginSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(true);
    endSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(false);
  });

  it('nesting works — count must reach zero', () => {
    beginSuppressSnapshot();
    beginSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(true);
    endSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(true);
    endSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(false);
  });

  it('extra endSuppressSnapshot does not go negative', () => {
    endSuppressSnapshot();
    endSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(false);
    beginSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(true);
    endSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(false);
  });

  it('withSnapshotSuppression auto-manages on success', async () => {
    expect(isSnapshotSuppressed()).toBe(false);
    const result = await withSnapshotSuppression(async () => {
      expect(isSnapshotSuppressed()).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(isSnapshotSuppressed()).toBe(false);
  });

  it('withSnapshotSuppression cleans up on error', async () => {
    expect(isSnapshotSuppressed()).toBe(false);
    await expect(
      withSnapshotSuppression(async () => {
        expect(isSnapshotSuppressed()).toBe(true);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(isSnapshotSuppressed()).toBe(false);
  });

  it('withSnapshotSuppression works with nesting', async () => {
    beginSuppressSnapshot();
    await withSnapshotSuppression(async () => {
      expect(isSnapshotSuppressed()).toBe(true);
    });
    // Still suppressed because of the outer begin
    expect(isSnapshotSuppressed()).toBe(true);
    endSuppressSnapshot();
    expect(isSnapshotSuppressed()).toBe(false);
  });
});
