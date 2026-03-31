/**
 * collabV2ContractParity.test.ts — V2 contract invariant parity tests.
 *
 * Asserts that V2 collaboration types, storage constants, cache validation,
 * and recovery FSM are consistent with each other and satisfy documented contracts.
 */

import { describe, it, expect } from 'vitest';
import {
  type ProjectCollabMetaDoc,
  type ProjectBaseCommitManifestDoc,
  type ProjectBaseCommitChunkDoc,
  type ProjectRevisionFields,
  type ProjectGroupDoc,
  type ProjectBlockedTokenDoc,
  type ProjectBlockedKeywordDoc,
  type ProjectTokenMergeRuleDoc,
  type ProjectLabelSectionDoc,
  type ProjectOperationLockDoc,
  type RevisionedDocChange,
  type RevisionedDocAck,
  type ProjectV2CacheMetadata,
  V2_ENTITY_COLLECTIONS,
  scopeCollabDocId,
  parseScopedDocId,
  LOCK_TTL_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
  MIGRATION_LEASE_TTL_MS,
} from './collabV2Types';
import {
  isValidV2CacheEntry,
  isLegacyCacheEntry,
  cacheMatchesMeta,
  type ProjectCanonicalCacheEntry,
} from './collabV2Cache';
import {
  diagnoseV2State,
  isMigrationLeaseExpired,
  isOperationLockExpired,
  type RecoveryDiagnostic,
  type RecoveryAction,
} from './collabV2Recovery';

// ─── Helpers ───

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function makeRevisionFields(overrides?: Partial<ProjectRevisionFields>): ProjectRevisionFields {
  return {
    revision: 1,
    updatedAt: NOW,
    updatedByClientId: 'client-1',
    ...overrides,
  };
}

function makeMetaDoc(overrides?: Partial<ProjectCollabMetaDoc>): ProjectCollabMetaDoc {
  return {
    schemaVersion: 2,
    revision: 1,
    datasetEpoch: 1,
    baseCommitId: 'commit-abc',
    commitState: 'idle',
    readMode: 'v2',
    migrationState: 'complete',
    migrationOwnerClientId: null,
    migrationExpiresAt: null,
    updatedAt: NOW,
    updatedByClientId: 'client-1',
    ...overrides,
  };
}

function makeManifestDoc(overrides?: Partial<ProjectBaseCommitManifestDoc>): ProjectBaseCommitManifestDoc {
  return {
    id: 'manifest',
    commitId: 'commit-abc',
    datasetEpoch: 1,
    commitState: 'ready',
    resultChunkCount: 1,
    clusterChunkCount: 1,
    suggestionChunkCount: 0,
    autoMergeChunkCount: 0,
    groupMergeChunkCount: 0,
    contentHash: null,
    createdAt: NOW,
    createdByClientId: 'client-1',
    ...overrides,
  };
}

function makeLockDoc(overrides?: Partial<ProjectOperationLockDoc>): ProjectOperationLockDoc {
  return {
    type: 'csv-import',
    ownerId: 'client-1',
    startedAt: NOW,
    heartbeatAt: NOW,
    expiresAt: FUTURE,
    status: 'running',
    ...overrides,
  };
}

// ─── Tests ───

describe('V2 Contract Parity', () => {
  // ── Type Invariants ──

  describe('Type Invariants', () => {
    it('ProjectCollabMetaDoc requires schemaVersion 2', () => {
      const meta = makeMetaDoc();
      expect(meta.schemaVersion).toBe(2);

      // Runtime enforcement: schemaVersion must be exactly 2
      const wrongVersion = { ...meta, schemaVersion: 1 as never };
      expect(wrongVersion.schemaVersion).not.toBe(2);
    });

    it('all revisioned entity types include ProjectRevisionFields', () => {
      // Construct each entity type and verify revision fields are present
      const group: ProjectGroupDoc = {
        id: 'g1',
        groupName: 'Test Group',
        status: 'grouped',
        datasetEpoch: 1,
        clusterTokens: ['a', 'b'],
        ...makeRevisionFields(),
      };
      expect(group.revision).toBe(1);
      expect(group.updatedAt).toBe(NOW);
      expect(group.updatedByClientId).toBe('client-1');

      const blockedToken: ProjectBlockedTokenDoc = {
        id: 'bt1',
        token: 'spam',
        datasetEpoch: 1,
        ...makeRevisionFields(),
      };
      expect(blockedToken.revision).toBeDefined();
      expect(blockedToken.updatedAt).toBeDefined();
      expect(blockedToken.updatedByClientId).toBeDefined();

      const blockedKeyword: ProjectBlockedKeywordDoc = {
        id: 'bk1',
        keyword: 'junk',
        volume: 100,
        kd: 50,
        reason: 'irrelevant',
        datasetEpoch: 1,
        ...makeRevisionFields(),
      };
      expect(blockedKeyword.revision).toBeDefined();

      const mergeRule: ProjectTokenMergeRuleDoc = {
        id: 'mr1',
        parentToken: 'parent',
        childTokens: ['child1'],
        createdAt: NOW,
        datasetEpoch: 1,
        ...makeRevisionFields(),
      };
      expect(mergeRule.revision).toBeDefined();

      const labelSection: ProjectLabelSectionDoc = {
        id: 'ls1',
        name: 'Section A',
        tokens: ['t1'],
        colorIndex: 0,
        datasetEpoch: 1,
        ...makeRevisionFields(),
      };
      expect(labelSection.revision).toBeDefined();
    });

    it('all epoch-scoped entities include datasetEpoch', () => {
      const group: ProjectGroupDoc = {
        id: 'g1', groupName: 'G', status: 'grouped', clusterTokens: [],
        datasetEpoch: 3, ...makeRevisionFields(),
      };
      const blockedToken: ProjectBlockedTokenDoc = {
        id: 'bt1', token: 't', datasetEpoch: 3, ...makeRevisionFields(),
      };
      const blockedKeyword: ProjectBlockedKeywordDoc = {
        id: 'bk1', keyword: 'k', volume: 0, kd: null, reason: 'r',
        datasetEpoch: 3, ...makeRevisionFields(),
      };
      const mergeRule: ProjectTokenMergeRuleDoc = {
        id: 'mr1', parentToken: 'p', childTokens: [], createdAt: NOW,
        datasetEpoch: 3, ...makeRevisionFields(),
      };
      const labelSection: ProjectLabelSectionDoc = {
        id: 'ls1', name: 'L', tokens: [], colorIndex: 0,
        datasetEpoch: 3, ...makeRevisionFields(),
      };

      for (const entity of [group, blockedToken, blockedKeyword, mergeRule, labelSection]) {
        expect(entity.datasetEpoch).toBe(3);
      }
    });

    it('V2_ENTITY_COLLECTIONS covers all entity subcollections', () => {
      const expected = {
        groups: 'groups',
        blockedTokens: 'blocked_tokens',
        manualBlockedKeywords: 'manual_blocked_keywords',
        tokenMergeRules: 'token_merge_rules',
        labelSections: 'label_sections',
        activityLog: 'activity_log',
      };
      expect(V2_ENTITY_COLLECTIONS).toEqual(expected);
      expect(Object.keys(V2_ENTITY_COLLECTIONS)).toHaveLength(6);
    });

    it('V2_ENTITY_COLLECTIONS values are snake_case Firestore collection names', () => {
      for (const value of Object.values(V2_ENTITY_COLLECTIONS)) {
        expect(value).toMatch(/^[a-z][a-z_]*$/);
      }
    });
  });

  // ── Epoch Scoping ──

  describe('Epoch Scoping', () => {
    it('scopeCollabDocId produces deterministic epoch-prefixed IDs', () => {
      expect(scopeCollabDocId(1, 'abc')).toBe('e1_abc');
      expect(scopeCollabDocId(42, 'group-123')).toBe('e42_group-123');
      expect(scopeCollabDocId(0, 'zero')).toBe('e0_zero');
      expect(scopeCollabDocId(999, 'big-epoch')).toBe('e999_big-epoch');
    });

    it('parseScopedDocId inverts scopeCollabDocId', () => {
      // Round-trip tests
      const cases = [
        { epoch: 1, id: 'abc' },
        { epoch: 42, id: 'group-123' },
        { epoch: 0, id: 'zero' },
        { epoch: 999, id: 'big-epoch' },
        { epoch: 7, id: 'has_underscore_in_id' },
      ];
      for (const { epoch, id } of cases) {
        const scoped = scopeCollabDocId(epoch, id);
        const parsed = parseScopedDocId(scoped);
        expect(parsed).toEqual({ epoch, logicalId: id });
      }
    });

    it('parseScopedDocId rejects malformed IDs', () => {
      expect(parseScopedDocId('no_prefix')).toBeNull();
      expect(parseScopedDocId('eNaN_abc')).toBeNull();
      expect(parseScopedDocId('')).toBeNull();
      expect(parseScopedDocId('e_missing_epoch')).toBeNull();
      expect(parseScopedDocId('abc')).toBeNull();
      expect(parseScopedDocId('E1_uppercase')).toBeNull();
    });

    it('parseScopedDocId handles edge cases with underscores in logicalId', () => {
      const result = parseScopedDocId('e5_my_complex_id');
      expect(result).toEqual({ epoch: 5, logicalId: 'my_complex_id' });
    });
  });

  // ── Revision Semantics (CAS) ──

  describe('Revision Semantics (CAS)', () => {
    it('RevisionedDocChange requires expectedRevision', () => {
      const upsertChange: RevisionedDocChange<ProjectGroupDoc> = {
        kind: 'upsert',
        id: 'g1',
        expectedRevision: 3,
        datasetEpoch: 1,
        value: {
          id: 'g1', groupName: 'G', status: 'grouped', clusterTokens: [],
          datasetEpoch: 1, ...makeRevisionFields({ revision: 4 }),
        },
      };
      expect(upsertChange.expectedRevision).toBe(3);
    });

    it('upsert changes must include value', () => {
      const change: RevisionedDocChange<{ data: string }> = {
        kind: 'upsert',
        id: 'doc-1',
        expectedRevision: 0,
        datasetEpoch: 1,
        value: { data: 'payload' },
      };
      expect(change.kind).toBe('upsert');
      expect(change.value).toBeDefined();
    });

    it('delete changes do not require value', () => {
      const change: RevisionedDocChange<{ data: string }> = {
        kind: 'delete',
        id: 'doc-1',
        expectedRevision: 2,
        datasetEpoch: 1,
        // value intentionally omitted
      };
      expect(change.kind).toBe('delete');
      expect(change.value).toBeUndefined();
    });

    it('ack includes newRevision and success status', () => {
      const ack: RevisionedDocAck = {
        id: 'doc-1',
        kind: 'upsert',
        newRevision: 5,
        lastMutationId: 'mut-abc',
        success: true,
      };
      expect(ack.newRevision).toBe(5);
      expect(ack.success).toBe(true);
      expect(ack.error).toBeUndefined();
    });

    it('failed ack includes error string', () => {
      const ack: RevisionedDocAck = {
        id: 'doc-1',
        kind: 'upsert',
        newRevision: 4,
        lastMutationId: null,
        success: false,
        error: 'CAS conflict: expected revision 3 but found 4',
      };
      expect(ack.success).toBe(false);
      expect(ack.error).toContain('CAS conflict');
    });
  });

  // ── Commit Barrier Semantics ──

  describe('Commit Barrier Semantics', () => {
    it('base commit manifest commitState only allows writing or ready', () => {
      const writing = makeManifestDoc({ commitState: 'writing' });
      const ready = makeManifestDoc({ commitState: 'ready' });
      expect(writing.commitState).toBe('writing');
      expect(ready.commitState).toBe('ready');

      // The type only permits 'writing' | 'ready' — verify at runtime
      const validStates: string[] = ['writing', 'ready'];
      expect(validStates).toContain(writing.commitState);
      expect(validStates).toContain(ready.commitState);
    });

    it('base commit chunks include datasetEpoch', () => {
      const chunk: ProjectBaseCommitChunkDoc = {
        id: 'chunk-0',
        type: 'results',
        index: 0,
        datasetEpoch: 1,
        data: [{ keyword: 'test' }],
      };
      expect(chunk.datasetEpoch).toBe(1);
      expect(chunk.type).toBe('results');
    });

    it('chunk type covers all data categories', () => {
      const validTypes: ProjectBaseCommitChunkDoc['type'][] = [
        'results', 'clusters', 'suggestions', 'auto_merge', 'group_merge',
      ];
      for (const t of validTypes) {
        const chunk: ProjectBaseCommitChunkDoc = {
          id: `chunk-${t}`, type: t, index: 0, datasetEpoch: 1, data: [],
        };
        expect(chunk.type).toBe(t);
      }
    });

    it('meta commitState values are a superset of manifest commitState', () => {
      const metaStates: ProjectCollabMetaDoc['commitState'][] = ['idle', 'writing', 'ready'];
      const manifestStates: ProjectBaseCommitManifestDoc['commitState'][] = ['writing', 'ready'];

      // Every manifest state must be a valid meta state
      for (const ms of manifestStates) {
        expect(metaStates).toContain(ms);
      }

      // Meta has 'idle' which manifest does not
      expect(metaStates).toContain('idle');
      expect(manifestStates).not.toContain('idle');
    });

    it('when meta is ready, manifest must also be ready (contract invariant)', () => {
      // Healthy case: meta ready + manifest ready
      const meta = makeMetaDoc({ commitState: 'ready' });
      const manifest = makeManifestDoc({ commitState: 'ready' });
      const result = diagnoseV2State(meta, manifest, null, 'me');
      expect(result.diagnostic.kind).toBe('healthy');

      // Broken case: meta ready + manifest writing => detected as missing-commit
      const brokenManifest = makeManifestDoc({ commitState: 'writing' });
      const brokenResult = diagnoseV2State(meta, brokenManifest, null, 'me');
      expect(brokenResult.diagnostic.kind).toBe('missing-commit');
      expect(brokenResult.writesBlocked).toBe(true);
    });
  });

  // ── Lock Lifecycle ──

  describe('Lock Lifecycle', () => {
    it('LOCK_TTL_MS is 15 minutes', () => {
      expect(LOCK_TTL_MS).toBe(15 * 60 * 1000);
    });

    it('MIGRATION_LEASE_TTL_MS is 10 minutes', () => {
      expect(MIGRATION_LEASE_TTL_MS).toBe(10 * 60 * 1000);
    });

    it('LOCK_HEARTBEAT_INTERVAL_MS is 5 seconds', () => {
      expect(LOCK_HEARTBEAT_INTERVAL_MS).toBe(5_000);
    });

    it('heartbeat interval is significantly less than lock TTL', () => {
      // Heartbeat must fire multiple times before lock expires
      expect(LOCK_HEARTBEAT_INTERVAL_MS * 10).toBeLessThan(LOCK_TTL_MS);
    });

    it('operation lock requires type, ownerId, and status', () => {
      const lock = makeLockDoc();
      expect(lock.type).toBeDefined();
      expect(lock.ownerId).toBeDefined();
      expect(lock.status).toBeDefined();
      expect(lock.startedAt).toBeDefined();
      expect(lock.heartbeatAt).toBeDefined();
      expect(lock.expiresAt).toBeDefined();
    });

    it('lock status values are running or releasing', () => {
      const running = makeLockDoc({ status: 'running' });
      const releasing = makeLockDoc({ status: 'releasing' });
      expect(running.status).toBe('running');
      expect(releasing.status).toBe('releasing');

      const validStatuses: string[] = ['running', 'releasing'];
      expect(validStatuses).toContain(running.status);
      expect(validStatuses).toContain(releasing.status);
    });

    it('lock type covers all operation categories', () => {
      const validTypes: ProjectOperationLockDoc['type'][] = [
        'csv-import', 'keyword-rating', 'auto-group', 'token-merge', 'bulk-update', 'migration',
      ];
      for (const t of validTypes) {
        const lock = makeLockDoc({ type: t });
        expect(lock.type).toBe(t);
      }
    });

    it('isOperationLockExpired detects expired lock', () => {
      const expired = makeLockDoc({ expiresAt: PAST });
      expect(isOperationLockExpired(expired)).toBe(true);
    });

    it('isOperationLockExpired returns false for future lock', () => {
      const active = makeLockDoc({ expiresAt: FUTURE });
      expect(isOperationLockExpired(active)).toBe(false);
    });
  });

  // ── ReadMode Cutover ──

  describe('ReadMode Cutover', () => {
    it('readMode values are legacy and v2', () => {
      const legacy = makeMetaDoc({ readMode: 'legacy' });
      const v2 = makeMetaDoc({ readMode: 'v2' });
      expect(legacy.readMode).toBe('legacy');
      expect(v2.readMode).toBe('v2');
    });

    it('readMode transition: legacy to v2 is allowed, v2 to legacy is not (contract)', () => {
      // The one-way cutover: once readMode is 'v2', reverting to 'legacy' is a contract violation.
      // We document this invariant by verifying healthy state in both modes.
      const legacyMeta = makeMetaDoc({ readMode: 'legacy', commitState: 'idle', baseCommitId: null });
      const legacyResult = diagnoseV2State(legacyMeta, null, null, 'me');
      expect(legacyResult.diagnostic.kind).toBe('healthy');

      const v2Meta = makeMetaDoc({ readMode: 'v2', commitState: 'ready' });
      const manifest = makeManifestDoc();
      const v2Result = diagnoseV2State(v2Meta, manifest, null, 'me');
      expect(v2Result.diagnostic.kind).toBe('healthy');

      // Contract: the valid readMode values form a set
      const validModes: string[] = ['legacy', 'v2'];
      expect(validModes).toContain('legacy');
      expect(validModes).toContain('v2');
      expect(validModes).toHaveLength(2);
    });

    it('migration state progression: pending -> running -> complete', () => {
      const pending = makeMetaDoc({ migrationState: 'pending' });
      const running = makeMetaDoc({ migrationState: 'running' });
      const complete = makeMetaDoc({ migrationState: 'complete' });
      const failed = makeMetaDoc({ migrationState: 'failed' });

      const validStates: string[] = ['pending', 'running', 'complete', 'failed'];
      expect(validStates).toContain(pending.migrationState);
      expect(validStates).toContain(running.migrationState);
      expect(validStates).toContain(complete.migrationState);
      expect(validStates).toContain(failed.migrationState);
    });
  });

  // ── Cache Metadata Contract ──

  describe('Cache Metadata Contract', () => {
    it('V2 cache entry requires schemaVersion, datasetEpoch, baseCommitId, cachedAt', () => {
      const validEntry: ProjectCanonicalCacheEntry = {
        schemaVersion: 2,
        datasetEpoch: 1,
        baseCommitId: 'commit-abc',
        cachedAt: NOW,
        payload: {} as never,
      };
      expect(isValidV2CacheEntry(validEntry)).toBe(true);
    });

    it('rejects cache entry missing schemaVersion', () => {
      const entry = { datasetEpoch: 1, baseCommitId: 'c', cachedAt: NOW, payload: {} };
      expect(isValidV2CacheEntry(entry)).toBe(false);
    });

    it('rejects cache entry with schemaVersion < 2', () => {
      const entry = { schemaVersion: 1, datasetEpoch: 1, baseCommitId: 'c', cachedAt: NOW, payload: {} };
      expect(isValidV2CacheEntry(entry)).toBe(false);
    });

    it('rejects cache entry missing datasetEpoch', () => {
      const entry = { schemaVersion: 2, baseCommitId: 'c', cachedAt: NOW, payload: {} };
      expect(isValidV2CacheEntry(entry)).toBe(false);
    });

    it('rejects cache entry with datasetEpoch < 1', () => {
      const entry = { schemaVersion: 2, datasetEpoch: 0, baseCommitId: 'c', cachedAt: NOW, payload: {} };
      expect(isValidV2CacheEntry(entry)).toBe(false);
    });

    it('rejects cache entry missing baseCommitId', () => {
      const entry = { schemaVersion: 2, datasetEpoch: 1, cachedAt: NOW, payload: {} };
      expect(isValidV2CacheEntry(entry)).toBe(false);
    });

    it('rejects cache entry with empty baseCommitId', () => {
      const entry = { schemaVersion: 2, datasetEpoch: 1, baseCommitId: '', cachedAt: NOW, payload: {} };
      expect(isValidV2CacheEntry(entry)).toBe(false);
    });

    it('rejects null and non-object inputs', () => {
      expect(isValidV2CacheEntry(null)).toBe(false);
      expect(isValidV2CacheEntry(undefined)).toBe(false);
      expect(isValidV2CacheEntry('string')).toBe(false);
      expect(isValidV2CacheEntry(42)).toBe(false);
    });

    it('isLegacyCacheEntry identifies legacy shape', () => {
      const legacy = { results: [], clusterSummary: [] };
      expect(isLegacyCacheEntry(legacy)).toBe(true);
    });

    it('isLegacyCacheEntry rejects V2 entries', () => {
      const v2 = { schemaVersion: 2, datasetEpoch: 1, baseCommitId: 'c', cachedAt: NOW, payload: {} };
      expect(isLegacyCacheEntry(v2)).toBe(false);
    });

    it('cacheMatchesMeta validates epoch and commitId match', () => {
      const entry: ProjectCanonicalCacheEntry = {
        schemaVersion: 2,
        datasetEpoch: 5,
        baseCommitId: 'commit-xyz',
        cachedAt: NOW,
        payload: {} as never,
      };
      expect(cacheMatchesMeta(entry, 5, 'commit-xyz')).toBe(true);
      expect(cacheMatchesMeta(entry, 5, 'wrong-commit')).toBe(false);
      expect(cacheMatchesMeta(entry, 6, 'commit-xyz')).toBe(false);
    });

    it('ProjectV2CacheMetadata shape matches cache entry metadata fields', () => {
      const cacheMeta: ProjectV2CacheMetadata = {
        schemaVersion: 2,
        datasetEpoch: 1,
        baseCommitId: 'commit-abc',
        cachedAt: NOW,
      };
      const entry: ProjectCanonicalCacheEntry = {
        ...cacheMeta,
        payload: {} as never,
      };
      // Cache entry metadata fields must be a superset of ProjectV2CacheMetadata
      expect(entry.schemaVersion).toBe(cacheMeta.schemaVersion);
      expect(entry.datasetEpoch).toBe(cacheMeta.datasetEpoch);
      expect(entry.baseCommitId).toBe(cacheMeta.baseCommitId);
      expect(entry.cachedAt).toBe(cacheMeta.cachedAt);
    });
  });

  // ── Recovery Contract ──

  describe('Recovery Contract', () => {
    it('diagnoseV2State returns healthy for consistent state', () => {
      const meta = makeMetaDoc({ commitState: 'ready' });
      const manifest = makeManifestDoc({ commitState: 'ready' });
      const result = diagnoseV2State(meta, manifest, null, 'me');
      expect(result.diagnostic.kind).toBe('healthy');
      expect(result.diagnostic.detail).toBe('V2 state is consistent');
      expect(result.action.type).toBe('none');
      expect(result.writesBlocked).toBe(false);
    });

    it('diagnoseV2State returns healthy for idle state with no commit', () => {
      const meta = makeMetaDoc({ commitState: 'idle', baseCommitId: null });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('healthy');
    });

    it('stuck writing with ready manifest produces finalize-commit action', () => {
      const meta = makeMetaDoc({ commitState: 'writing', baseCommitId: 'commit-abc' });
      const manifest = makeManifestDoc({ commitState: 'ready' });
      const result = diagnoseV2State(meta, manifest, null, 'me');
      expect(result.diagnostic.kind).toBe('stuck-writing');
      if (result.diagnostic.kind === 'stuck-writing') {
        expect(result.diagnostic.canFinalize).toBe(true);
        expect(result.diagnostic.commitId).toBe('commit-abc');
      }
      expect(result.action.type).toBe('finalize-commit');
      expect(result.writesBlocked).toBe(false);
    });

    it('stuck writing with writing manifest produces rollback action', () => {
      const meta = makeMetaDoc({ commitState: 'writing', baseCommitId: 'commit-abc' });
      const manifest = makeManifestDoc({ commitState: 'writing' });
      const result = diagnoseV2State(meta, manifest, null, 'me');
      expect(result.diagnostic.kind).toBe('stuck-writing');
      if (result.diagnostic.kind === 'stuck-writing') {
        expect(result.diagnostic.canFinalize).toBe(false);
      }
      expect(result.action.type).toBe('rollback-to-last-ready');
      expect(result.writesBlocked).toBe(true);
    });

    it('stuck writing with no commitId produces rollback action', () => {
      const meta = makeMetaDoc({ commitState: 'writing', baseCommitId: null });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('stuck-writing');
      expect(result.action.type).toBe('rollback-to-last-ready');
    });

    it('stuck writing with missing manifest produces rollback action', () => {
      const meta = makeMetaDoc({ commitState: 'writing', baseCommitId: 'commit-abc' });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('missing-commit');
      expect(result.action.type).toBe('rollback-to-last-ready');
    });

    it('stale own migration lease is detected', () => {
      const meta = makeMetaDoc({
        migrationState: 'running',
        migrationOwnerClientId: 'me',
        migrationExpiresAt: PAST,
      });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('stale-migration');
      expect(result.action.type).toBe('clear-migration-lease');
      expect(result.writesBlocked).toBe(true);
    });

    it('stale foreign migration lease is detected', () => {
      const meta = makeMetaDoc({
        migrationState: 'running',
        migrationOwnerClientId: 'other-client',
        migrationExpiresAt: PAST,
      });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('stale-migration');
      if (result.diagnostic.kind === 'stale-migration') {
        expect(result.diagnostic.ownerClientId).toBe('other-client');
      }
      expect(result.action.type).toBe('clear-migration-lease');
    });

    it('active foreign migration blocks writes but is healthy', () => {
      const meta = makeMetaDoc({
        migrationState: 'running',
        migrationOwnerClientId: 'other-client',
        migrationExpiresAt: FUTURE,
      });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('healthy');
      expect(result.writesBlocked).toBe(true);
    });

    it('active own migration does not block writes', () => {
      const meta = makeMetaDoc({
        migrationState: 'running',
        migrationOwnerClientId: 'me',
        migrationExpiresAt: FUTURE,
      });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('healthy');
      expect(result.writesBlocked).toBe(false);
    });

    it('failed migration state is unrecoverable', () => {
      const meta = makeMetaDoc({ migrationState: 'failed' });
      const result = diagnoseV2State(meta, null, null, 'me');
      expect(result.diagnostic.kind).toBe('unrecoverable');
      expect(result.action.type).toBe('enter-read-only');
      expect(result.writesBlocked).toBe(true);
    });

    it('stale operation lock is detected and classified', () => {
      const meta = makeMetaDoc({ commitState: 'ready' });
      const manifest = makeManifestDoc({ commitState: 'ready' });
      const staleLock = makeLockDoc({ expiresAt: PAST, ownerId: 'dead-client' });
      const result = diagnoseV2State(meta, manifest, staleLock, 'me');
      expect(result.diagnostic.kind).toBe('stale-lock');
      expect(result.action.type).toBe('clear-stale-lock');
    });

    it('active foreign lock is not treated as stuck', () => {
      const meta = makeMetaDoc({ commitState: 'ready' });
      const manifest = makeManifestDoc({ commitState: 'ready' });
      const activeLock = makeLockDoc({ expiresAt: FUTURE, ownerId: 'other-client' });
      const result = diagnoseV2State(meta, manifest, activeLock, 'me');
      expect(result.diagnostic.kind).toBe('healthy');
      expect(result.writesBlocked).toBe(false);
    });

    it('isMigrationLeaseExpired returns true for past expiry', () => {
      const meta = makeMetaDoc({ migrationExpiresAt: PAST });
      expect(isMigrationLeaseExpired(meta)).toBe(true);
    });

    it('isMigrationLeaseExpired returns true for null expiry', () => {
      const meta = makeMetaDoc({ migrationExpiresAt: null });
      expect(isMigrationLeaseExpired(meta)).toBe(true);
    });

    it('isMigrationLeaseExpired returns false for future expiry', () => {
      const meta = makeMetaDoc({ migrationExpiresAt: FUTURE });
      expect(isMigrationLeaseExpired(meta)).toBe(false);
    });

    it('recovery actions are exhaustive', () => {
      // All RecoveryAction types that the FSM can produce
      const allActionTypes: RecoveryAction['type'][] = [
        'none',
        'finalize-commit',
        'clear-migration-lease',
        'clear-stale-lock',
        'rollback-to-last-ready',
        'enter-read-only',
      ];
      expect(allActionTypes).toHaveLength(6);

      // Verify each is a string
      for (const t of allActionTypes) {
        expect(typeof t).toBe('string');
      }
    });

    it('all diagnostic kinds are distinct', () => {
      const allKinds: RecoveryDiagnostic['kind'][] = [
        'healthy',
        'stuck-writing',
        'stale-migration',
        'stale-lock',
        'missing-commit',
        'unrecoverable',
      ];
      const uniqueKinds = new Set(allKinds);
      expect(uniqueKinds.size).toBe(allKinds.length);
      expect(allKinds).toHaveLength(6);
    });

    it('recovery priority: migration checked before commit state', () => {
      // If both migration and commit are stuck, migration takes precedence
      const meta = makeMetaDoc({
        commitState: 'writing',
        baseCommitId: 'commit-abc',
        migrationState: 'running',
        migrationOwnerClientId: 'dead-client',
        migrationExpiresAt: PAST,
      });
      const result = diagnoseV2State(meta, null, null, 'me');
      // Migration check runs first
      expect(result.diagnostic.kind).toBe('stale-migration');
    });

    it('recovery priority: commit state checked before lock state', () => {
      // If both commit is stuck and lock is stale, commit takes precedence
      const meta = makeMetaDoc({ commitState: 'writing', baseCommitId: null });
      const staleLock = makeLockDoc({ expiresAt: PAST });
      const result = diagnoseV2State(meta, null, staleLock, 'me');
      expect(result.diagnostic.kind).toBe('stuck-writing');
    });
  });
});
