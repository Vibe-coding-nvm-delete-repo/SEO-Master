/**
 * collabV2Types.ts — V2 collaboration storage type definitions.
 *
 * Defines the schema for commit-barrier semantics, epoch-scoped entities,
 * and CAS (Compare-And-Swap) revisioned documents used by the V2 storage layer.
 */

// ─── Meta document (projects/{projectId}/collab/meta) ───

export interface ProjectCollabMetaDoc {
  schemaVersion: 2;
  revision: number;
  datasetEpoch: number;
  baseCommitId: string | null;
  commitState: 'idle' | 'writing' | 'ready';
  readMode: 'legacy' | 'v2';
  migrationState: 'pending' | 'running' | 'complete' | 'failed';
  migrationOwnerClientId: string | null;
  migrationExpiresAt: string | null;
  updatedAt: string;
  updatedByClientId: string;
}

// ─── Base commit manifest (projects/{projectId}/base_commits/{commitId}) ───

export interface ProjectBaseCommitManifestDoc {
  id: string; // always 'manifest'
  commitId: string;
  datasetEpoch: number;
  commitState: 'writing' | 'ready';
  resultChunkCount: number;
  clusterChunkCount: number;
  suggestionChunkCount: number;
  autoMergeChunkCount: number;
  groupMergeChunkCount: number;
  contentHash: string | null;
  createdAt: string;
  createdByClientId: string;
}

// ─── Base commit chunk doc ───

export interface ProjectBaseCommitChunkDoc {
  id: string;
  type: 'results' | 'clusters' | 'suggestions' | 'auto_merge' | 'group_merge';
  index: number;
  datasetEpoch: number;
  data: unknown[];
}

// ─── Revision tracking for all versioned entity docs ───

export interface ProjectRevisionFields {
  revision: number;
  updatedAt: string;
  updatedByClientId: string;
  lastMutationId?: string | null;
}

// ─── Epoch-scoped entity docs ───

export interface ProjectGroupDoc extends ProjectRevisionFields {
  id: string;
  groupName: string;
  status: 'grouped' | 'approved';
  datasetEpoch: number;
  clusterTokens: string[];
  reviewStatus?: 'pending' | 'reviewing' | 'approve' | 'mismatch' | 'error';
  reviewMismatchedPages?: string[];
  reviewReason?: string;
  reviewCost?: number;
  reviewedAt?: string;
  mergeAffected?: boolean;
  groupAutoMerged?: boolean;
}

export interface ProjectBlockedTokenDoc extends ProjectRevisionFields {
  id: string;
  token: string;
  datasetEpoch: number;
}

export interface ProjectBlockedKeywordDoc extends ProjectRevisionFields {
  id: string;
  keyword: string;
  volume: number;
  kd: number | null;
  kwRating?: 1 | 2 | 3 | null;
  reason: string;
  datasetEpoch: number;
}

export interface ProjectTokenMergeRuleDoc extends ProjectRevisionFields {
  id: string;
  parentToken: string;
  childTokens: string[];
  createdAt: string;
  source?: 'manual' | 'auto-merge';
  datasetEpoch: number;
}

export interface ProjectLabelSectionDoc extends ProjectRevisionFields {
  id: string;
  name: string;
  tokens: string[];
  colorIndex: number;
  datasetEpoch: number;
}

export interface ProjectActivityLogDoc {
  id: string;
  timestamp: string;
  action: string;
  details: string;
  count: number;
  datasetEpoch: number;
  createdByClientId?: string;
  mutationId?: string;
}

// ─── Operation lock (projects/{projectId}/project_operations/current) ───

export interface ProjectOperationLockDoc {
  type: 'csv-import' | 'keyword-rating' | 'auto-group' | 'token-merge' | 'bulk-update' | 'migration';
  ownerId: string;
  startedAt: string;
  heartbeatAt: string;
  expiresAt: string;
  status: 'running' | 'releasing';
}

// ─── CAS change descriptor ───

export interface RevisionedDocChange<T> {
  kind: 'upsert' | 'delete';
  id: string;
  expectedRevision: number;
  datasetEpoch: number;
  value?: T;
  mutationId?: string;
}

export interface RevisionedDocAck {
  id: string;
  kind: 'upsert' | 'delete';
  newRevision: number;
  lastMutationId: string | null;
  success: boolean;
  error?: string;
}

// ─── Canonical state envelope ───

export interface ProjectCollabEntityState {
  meta: ProjectCollabMetaDoc | null;
  groups: ProjectGroupDoc[];
  blockedTokens: ProjectBlockedTokenDoc[];
  manualBlockedKeywords: ProjectBlockedKeywordDoc[];
  tokenMergeRules: ProjectTokenMergeRuleDoc[];
  labelSections: ProjectLabelSectionDoc[];
  activityLog: ProjectActivityLogDoc[];
  activeOperation: ProjectOperationLockDoc | null;
}

export interface ProjectV2CacheMetadata {
  schemaVersion: number;
  datasetEpoch: number;
  baseCommitId: string;
  cachedAt: string;
}

// ─── V2 entity subcollection names (canonical) ───

export const V2_ENTITY_COLLECTIONS = {
  groups: 'groups',
  blockedTokens: 'blocked_tokens',
  manualBlockedKeywords: 'manual_blocked_keywords',
  tokenMergeRules: 'token_merge_rules',
  labelSections: 'label_sections',
  activityLog: 'activity_log',
} as const;

export type V2EntityCollectionName = typeof V2_ENTITY_COLLECTIONS[keyof typeof V2_ENTITY_COLLECTIONS];

// ─── Epoch-scoped doc ID helper ───

export function scopeCollabDocId(epoch: number, logicalId: string): string {
  return `e${epoch}_${logicalId}`;
}

export function parseScopedDocId(scopedId: string): { epoch: number; logicalId: string } | null {
  const match = scopedId.match(/^e(\d+)_(.+)$/);
  if (!match) return null;
  return { epoch: parseInt(match[1], 10), logicalId: match[2] };
}

// ─── Lock TTL constants ───

export const LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const LOCK_HEARTBEAT_INTERVAL_MS = 5_000;
export const MIGRATION_LEASE_TTL_MS = 10 * 60 * 1000; // 10 minutes
