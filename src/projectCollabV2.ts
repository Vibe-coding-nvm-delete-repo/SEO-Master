import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  buildProjectDataPayloadFromChunkDocs,
  loadFromIDB,
  sanitizeJsonForFirestore,
  saveToIDB,
  type ProjectDataPayload,
} from './projectStorage';
import type {
  ActivityLogEntry,
  AutoGroupSuggestion,
  AutoMergeRecommendation,
  BlockedKeyword,
  ClusterSummary,
  GroupMergeRecommendation,
  GroupedCluster,
  LabelSection,
  ProcessedRow,
  ProjectActivityLogDoc,
  ProjectBaseCommitManifestDoc,
  ProjectBlockedKeywordDoc,
  ProjectBlockedTokenDoc,
  ProjectCollabMetaDoc,
  ProjectGroupDoc,
  ProjectLabelSectionDoc,
  ProjectOperationLockDoc,
  ProjectTokenMergeRuleDoc,
  ProjectV2CacheMetadata,
  Stats,
  TokenMergeRule,
  TokenSummary,
} from './types';

const PROJECTS_COLLECTION = 'projects';
const CHUNK_SIZE = 200;
const MAX_BATCH_OPS = 450;
const OPERATION_TTL_MS = 15 * 60 * 1000;
export const CLIENT_SCHEMA_VERSION = 2;

export const PROJECT_BASE_SUBCOLLECTION = 'base_chunks';
export const PROJECT_BASE_COMMITS_COLLECTION = 'base_commits';
export const PROJECT_BASE_COMMIT_CHUNKS_SUBCOLLECTION = 'chunks';
export const PROJECT_GROUPS_SUBCOLLECTION = 'groups';
export const PROJECT_BLOCKED_TOKENS_SUBCOLLECTION = 'blocked_tokens';
export const PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION = 'manual_blocked_keywords';
export const PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION = 'token_merge_rules';
export const PROJECT_LABEL_SECTIONS_SUBCOLLECTION = 'label_sections';
export const PROJECT_ACTIVITY_LOG_SUBCOLLECTION = 'activity_log';
export const PROJECT_OPERATIONS_SUBCOLLECTION = 'project_operations';
export const PROJECT_OPERATION_CURRENT_DOC = 'current';
export const PROJECT_COLLAB_META_COLLECTION = 'collab';
export const PROJECT_COLLAB_META_DOC = 'meta';

export interface ProjectBaseSnapshot {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  stats: Stats | null;
  datasetStats: unknown | null;
  autoGroupSuggestions: AutoGroupSuggestion[];
  autoMergeRecommendations: AutoMergeRecommendation[];
  groupMergeRecommendations: GroupMergeRecommendation[];
  updatedAt: string;
  datasetEpoch: number;
}

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

export interface CanonicalProjectState {
  mode: 'legacy' | 'v2';
  base: ProjectBaseSnapshot | null;
  entities: ProjectCollabEntityState;
  resolved: ProjectDataPayload | null;
}

export interface RevisionedDocChange<T extends object> {
  kind: 'upsert' | 'delete';
  id: string;
  expectedRevision: number;
  datasetEpoch?: number;
  value?: T;
  mutationId?: string;
}

export interface RevisionedDocAck<T extends object> {
  kind: 'upsert' | 'delete';
  id: string;
  revision: number;
  lastMutationId: string | null;
  value?: T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function projectDoc(projectId: string, subcollection: string, docId: string) {
  return doc(db, PROJECTS_COLLECTION, projectId, subcollection, docId);
}

function projectCollection(projectId: string, subcollection: string) {
  return collection(db, PROJECTS_COLLECTION, projectId, subcollection);
}

function collabMetaDoc(projectId: string) {
  return doc(db, PROJECTS_COLLECTION, projectId, PROJECT_COLLAB_META_COLLECTION, PROJECT_COLLAB_META_DOC);
}

function baseCommitDoc(projectId: string, commitId: string) {
  return doc(db, PROJECTS_COLLECTION, projectId, PROJECT_BASE_COMMITS_COLLECTION, commitId);
}

function baseCommitChunksCollection(projectId: string, commitId: string) {
  return collection(baseCommitDoc(projectId, commitId), PROJECT_BASE_COMMIT_CHUNKS_SUBCOLLECTION);
}

function operationLockDoc(projectId: string) {
  return projectDoc(projectId, PROJECT_OPERATIONS_SUBCOLLECTION, PROJECT_OPERATION_CURRENT_DOC);
}

function scopedProjectDoc(
  projectId: string,
  subcollection: string,
  datasetEpoch: number,
  logicalId: string,
) {
  return projectDoc(projectId, subcollection, scopeCollabDocId(datasetEpoch, logicalId));
}

function emptyEntities(): ProjectCollabEntityState {
  return {
    meta: null,
    groups: [],
    blockedTokens: [],
    manualBlockedKeywords: [],
    tokenMergeRules: [],
    labelSections: [],
    activityLog: [],
    activeOperation: null,
  };
}

function stableComparable(value: unknown): string {
  return JSON.stringify(sanitizeJsonForFirestore(value));
}

function dedupeClusters(clusters: ClusterSummary[]): ClusterSummary[] {
  const byTokens = new Map<string, ClusterSummary>();
  for (const cluster of clusters) {
    if (!byTokens.has(cluster.tokens)) {
      byTokens.set(cluster.tokens, cluster);
    }
  }
  return Array.from(byTokens.values());
}

function dedupeRows(rows: ProcessedRow[]): ProcessedRow[] {
  const byKey = new Map<string, ProcessedRow>();
  for (const row of rows) {
    const key = `${row.tokens}::${row.keywordLower}`;
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function clusterToRows(cluster: ClusterSummary): ProcessedRow[] {
  return cluster.keywords.map((keyword) => ({
    pageName: cluster.pageName,
    pageNameLower: cluster.pageNameLower,
    pageNameLen: cluster.pageNameLen,
    tokens: cluster.tokens,
    tokenArr: cluster.tokenArr,
    keyword: keyword.keyword,
    keywordLower: keyword.keyword.toLowerCase(),
    searchVolume: keyword.volume,
    kd: keyword.kd,
    label: cluster.label,
    labelArr: cluster.labelArr,
    locationCity: keyword.locationCity,
    locationState: keyword.locationState,
    kwRating: keyword.kwRating ?? null,
  }));
}

function normalizeDocKey(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, ' '));
}

export function groupDocId(groupId: string): string {
  return groupId;
}

export function blockedTokenDocId(token: string): string {
  return normalizeDocKey(token);
}

export function manualBlockedKeywordDocId(keyword: BlockedKeyword): string {
  const normalizedKeyword = keyword.keyword.trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedReason = keyword.reason.trim().toLowerCase().replace(/\s+/g, ' ');
  return encodeURIComponent(`${normalizedKeyword}::${normalizedReason}`);
}

export function tokenMergeRuleDocId(rule: TokenMergeRule): string {
  return rule.id;
}

export function labelSectionDocId(section: LabelSection): string {
  return section.id;
}

export function activityLogDocId(entry: ActivityLogEntry): string {
  return entry.id;
}

export function scopeCollabDocId(datasetEpoch: number, logicalId: string): string {
  return `${datasetEpoch}::${logicalId}`;
}

function unscopedLogicalId(docId: string, fallbackId?: string): string {
  if (fallbackId && fallbackId.length > 0) return fallbackId;
  const delimiter = docId.indexOf('::');
  return delimiter >= 0 ? docId.slice(delimiter + 2) : docId;
}

function toGroupDoc(
  group: GroupedCluster,
  status: 'grouped' | 'approved',
  actorId: string,
  datasetEpoch: number,
): ProjectGroupDoc {
  return {
    id: groupDocId(group.id),
    groupName: group.groupName,
    status,
    datasetEpoch,
    lastWriterClientId: actorId,
    clusterTokens: group.clusters.map((cluster) => cluster.tokens),
    reviewStatus: group.reviewStatus,
    reviewMismatchedPages: group.reviewMismatchedPages,
    reviewReason: group.reviewReason,
    reviewCost: group.reviewCost,
    reviewedAt: group.reviewedAt,
    mergeAffected: group.mergeAffected,
    groupAutoMerged: group.groupAutoMerged,
    pageCount: group.clusters.length,
    totalVolume: group.totalVolume,
    keywordCount: group.keywordCount,
    avgKd: group.avgKd,
    avgKwRating: group.avgKwRating,
    revision: 0,
    updatedAt: nowIso(),
    updatedByClientId: actorId,
    lastMutationId: null,
  };
}

function refreshGroupFromBase(group: ProjectGroupDoc, clusterMap: Map<string, ClusterSummary>): GroupedCluster {
  const fallbackClusters = group.clusters ?? [];
  const clusters = group.clusterTokens
    .map((token) => clusterMap.get(token) ?? fallbackClusters.find((cluster) => cluster.tokens === token) ?? null)
    .filter((cluster): cluster is ClusterSummary => cluster != null);

  const totalVolume = clusters.reduce((sum, cluster) => sum + cluster.totalVolume, 0);
  const keywordCount = clusters.reduce((sum, cluster) => sum + cluster.keywordCount, 0);
  let kdWeighted = 0;
  let kdCount = 0;
  let kwWeighted = 0;
  let kwCount = 0;

  for (const cluster of clusters) {
    if (cluster.avgKd != null) {
      kdWeighted += cluster.avgKd * cluster.keywordCount;
      kdCount += cluster.keywordCount;
    }
    if (cluster.avgKwRating != null) {
      kwWeighted += cluster.avgKwRating * cluster.keywordCount;
      kwCount += cluster.keywordCount;
    }
  }

  return {
    id: group.id,
    groupName: group.groupName,
    clusters,
    totalVolume: totalVolume || group.totalVolume || 0,
    keywordCount: keywordCount || group.keywordCount || 0,
    avgKd: kdCount > 0 ? Math.round(kdWeighted / kdCount) : group.avgKd ?? null,
    avgKwRating: kwCount > 0 ? Math.round(kwWeighted / kwCount) : group.avgKwRating ?? null,
    reviewStatus: group.reviewStatus,
    reviewMismatchedPages: group.reviewMismatchedPages,
    reviewReason: group.reviewReason,
    reviewCost: group.reviewCost,
    reviewedAt: group.reviewedAt,
    mergeAffected: group.mergeAffected,
    groupAutoMerged: group.groupAutoMerged,
  };
}

function filterRowsByGroupedTokens(rows: ProcessedRow[] | null, groupedTokens: Set<string>): ProcessedRow[] | null {
  if (!rows) return null;
  return rows.filter((row) => !groupedTokens.has(row.tokens));
}

function filterClustersByGroupedTokens(
  clusters: ClusterSummary[] | null,
  groupedTokens: Set<string>,
): ClusterSummary[] | null {
  if (!clusters) return null;
  return clusters.filter((cluster) => !groupedTokens.has(cluster.tokens));
}

function diffDocsById<T extends { id: string }>(
  previousDocs: T[],
  nextDocs: T[],
  compare: (value: T) => unknown,
): RevisionedDocChange<T>[] {
  const previousById = new Map(previousDocs.map((docItem) => [docItem.id, docItem]));
  const nextById = new Map(nextDocs.map((docItem) => [docItem.id, docItem]));
  const changes: RevisionedDocChange<T>[] = [];

  for (const previous of previousDocs) {
    if (!nextById.has(previous.id)) {
      const revision = (previous as { revision?: number }).revision ?? 0;
      const datasetEpoch = (previous as { datasetEpoch?: number }).datasetEpoch;
      changes.push({ kind: 'delete', id: previous.id, expectedRevision: revision, datasetEpoch });
    }
  }

  for (const next of nextDocs) {
    const previous = previousById.get(next.id);
    const expectedRevision = previous ? (previous as { revision?: number }).revision ?? 0 : 0;
    const datasetEpoch = (next as { datasetEpoch?: number }).datasetEpoch ?? (previous as { datasetEpoch?: number } | undefined)?.datasetEpoch;
    if (!previous || stableComparable(compare(previous)) !== stableComparable(compare(next))) {
      changes.push({
        kind: 'upsert',
        id: next.id,
        expectedRevision,
        datasetEpoch,
        value: next,
      });
    }
  }

  return changes;
}

function chunkBySize<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function chunkedBasePayload(base: ProjectBaseSnapshot): ProjectDataPayload {
  return {
    results: base.results,
    clusterSummary: base.clusterSummary,
    tokenSummary: base.tokenSummary,
    groupedClusters: [],
    approvedGroups: [],
    stats: base.stats,
    datasetStats: base.datasetStats,
    blockedTokens: [],
    blockedKeywords: [],
    labelSections: [],
    activityLog: [],
    tokenMergeRules: [],
    autoGroupSuggestions: base.autoGroupSuggestions,
    autoMergeRecommendations: base.autoMergeRecommendations,
    groupMergeRecommendations: base.groupMergeRecommendations,
    updatedAt: base.updatedAt,
    lastSaveId: base.datasetEpoch,
  };
}

function toBaseSnapshot(payload: ProjectDataPayload | null): ProjectBaseSnapshot | null {
  if (!payload) return null;
  return {
    results: payload.results,
    clusterSummary: payload.clusterSummary,
    tokenSummary: payload.tokenSummary,
    stats: payload.stats,
    datasetStats: payload.datasetStats,
    autoGroupSuggestions: payload.autoGroupSuggestions ?? [],
    autoMergeRecommendations: payload.autoMergeRecommendations ?? [],
    groupMergeRecommendations: payload.groupMergeRecommendations ?? [],
    updatedAt: payload.updatedAt,
    datasetEpoch: payload.lastSaveId ?? 1,
  };
}

async function replaceSubcollectionDocs<T extends { id: string }>(
  projectId: string,
  subcollection: string,
  nextDocs: T[],
): Promise<void> {
  const snapshot = await getDocs(projectCollection(projectId, subcollection));
  const existingIds = snapshot.docs.map((docSnap) => docSnap.id);
  const pendingDeletes = existingIds.filter((id) => !nextDocs.some((docItem) => docItem.id === id));

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const id of pendingDeletes) {
    batch.delete(projectDoc(projectId, subcollection, id));
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  for (const nextDoc of nextDocs) {
    batch.set(projectDoc(projectId, subcollection, nextDoc.id), sanitizeJsonForFirestore(nextDoc));
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

async function replaceNestedSubcollectionDocs<T extends { id: string }>(
  parentRef: ReturnType<typeof doc>,
  subcollection: string,
  nextDocs: T[],
): Promise<void> {
  const snapshot = await getDocs(collection(parentRef, subcollection));
  const existingIds = snapshot.docs.map((docSnap) => docSnap.id);
  const pendingDeletes = existingIds.filter((id) => !nextDocs.some((docItem) => docItem.id === id));

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const id of pendingDeletes) {
    batch.delete(doc(parentRef, subcollection, id));
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  for (const nextDoc of nextDocs) {
    batch.set(doc(parentRef, subcollection, nextDoc.id), sanitizeJsonForFirestore(nextDoc));
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

async function clearSubcollection(projectId: string, subcollection: string): Promise<void> {
  const snapshot = await getDocs(projectCollection(projectId, subcollection));
  if (snapshot.empty) return;

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const docSnap of snapshot.docs) {
    batch.delete(docSnap.ref);
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

async function clearNestedSubcollection(parentRef: ReturnType<typeof doc>, subcollection: string): Promise<void> {
  const snapshot = await getDocs(collection(parentRef, subcollection));
  if (snapshot.empty) return;

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const docSnap of snapshot.docs) {
    batch.delete(docSnap.ref);
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

async function clearBaseCommits(projectId: string): Promise<void> {
  const snapshot = await getDocs(projectCollection(projectId, PROJECT_BASE_COMMITS_COLLECTION));
  if (snapshot.empty) return;

  for (const commitSnap of snapshot.docs) {
    await clearNestedSubcollection(commitSnap.ref, PROJECT_BASE_COMMIT_CHUNKS_SUBCOLLECTION);
  }

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const commitSnap of snapshot.docs) {
    batch.delete(commitSnap.ref);
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

async function clearEpochSubcollection(projectId: string, subcollection: string, datasetEpoch: number): Promise<void> {
  const snapshot = await getDocs(query(projectCollection(projectId, subcollection), where('datasetEpoch', '==', datasetEpoch)));
  if (snapshot.empty) return;

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const docSnap of snapshot.docs) {
    batch.delete(docSnap.ref);
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

async function loadCollectionDocs<T>(
  projectId: string,
  subcollection: string,
  datasetEpoch?: number,
): Promise<T[]> {
  try {
    const source = datasetEpoch == null
      ? projectCollection(projectId, subcollection)
      : query(projectCollection(projectId, subcollection), where('datasetEpoch', '==', datasetEpoch));
    const snapshot = await getDocs(source);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return {
        id: unscopedLogicalId(docSnap.id, typeof data.id === 'string' ? data.id : undefined),
        ...data,
      } as T;
    });
  } catch {
    return [];
  }
}

function isMetaDocV2(meta: unknown): meta is ProjectCollabMetaDoc {
  return Boolean(meta && typeof meta === 'object' && (meta as { schemaVersion?: number }).schemaVersion === 2);
}

function lockIsActive(lock: ProjectOperationLockDoc | null, actorId?: string): boolean {
  if (!lock) return false;
  const expiresAt = Date.parse(lock.expiresAt || '0');
  return Number.isFinite(expiresAt) && expiresAt > Date.now() && lock.ownerId !== actorId;
}

function migrationLeaseActive(meta: ProjectCollabMetaDoc | null, actorId: string): boolean {
  if (!meta || meta.migrationState !== 'running') return false;
  if (meta.migrationOwnerClientId === actorId) return false;
  const expiresAt = Date.parse(meta.migrationExpiresAt || '0');
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function createMutationId(actorId: string): string {
  return `m_${actorId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildBaseSnapshotFromResolvedPayload(payload: ProjectDataPayload): ProjectBaseSnapshot {
  const fullClusters = dedupeClusters([
    ...(payload.clusterSummary ?? []),
    ...((payload.groupedClusters ?? []).flatMap((group) => group.clusters)),
    ...((payload.approvedGroups ?? []).flatMap((group) => group.clusters)),
  ]);
  const fullResults = dedupeRows([
    ...(payload.results ?? []),
    ...fullClusters.flatMap(clusterToRows),
  ]);

  return {
    results: fullResults,
    clusterSummary: fullClusters,
    tokenSummary: payload.tokenSummary,
    stats: payload.stats,
    datasetStats: payload.datasetStats,
    autoGroupSuggestions: payload.autoGroupSuggestions ?? [],
    autoMergeRecommendations: payload.autoMergeRecommendations ?? [],
    groupMergeRecommendations: payload.groupMergeRecommendations ?? [],
    updatedAt: payload.updatedAt,
    datasetEpoch: Math.max(payload.lastSaveId ?? 1, 1),
  };
}

export function buildEntityStateFromResolvedPayload(
  payload: ProjectDataPayload,
  actorId: string,
  datasetEpoch: number,
): ProjectCollabEntityState {
  return {
    meta: null,
    groups: [
      ...((payload.groupedClusters ?? []).map((group) => toGroupDoc(group, 'grouped', actorId, datasetEpoch))),
      ...((payload.approvedGroups ?? []).map((group) => toGroupDoc(group, 'approved', actorId, datasetEpoch))),
    ],
    blockedTokens: (payload.blockedTokens ?? []).map((token) => ({
      id: blockedTokenDocId(token),
      token,
      datasetEpoch,
      lastWriterClientId: actorId,
      revision: 0,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: null,
    })),
    manualBlockedKeywords: (payload.blockedKeywords ?? []).map((keyword) => ({
      id: manualBlockedKeywordDocId(keyword),
      datasetEpoch,
      lastWriterClientId: actorId,
      keyword: keyword.keyword,
      volume: keyword.volume,
      kd: keyword.kd,
      kwRating: keyword.kwRating,
      reason: keyword.reason,
      tokenArr: keyword.tokenArr,
      revision: 0,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: null,
    })),
    tokenMergeRules: (payload.tokenMergeRules ?? []).map((rule) => ({
      ...rule,
      datasetEpoch,
      lastWriterClientId: actorId,
      revision: 0,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: null,
    })),
    labelSections: (payload.labelSections ?? []).map((section) => ({
      ...section,
      datasetEpoch,
      lastWriterClientId: actorId,
      revision: 0,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: null,
    })),
    activityLog: (payload.activityLog ?? []).map((entry) => ({
      ...entry,
      datasetEpoch,
      createdByClientId: actorId,
      mutationId: null,
    })),
    activeOperation: null,
  };
}

export function assembleCanonicalPayload(
  base: ProjectBaseSnapshot | null,
  entities: ProjectCollabEntityState,
): ProjectDataPayload | null {
  if (!base) return null;

  const clusterMap = new Map((base.clusterSummary ?? []).map((cluster) => [cluster.tokens, cluster]));
  const liveGroupDocs = entities.groups.filter((group) => group.datasetEpoch === base.datasetEpoch);
  const groups = liveGroupDocs.map((group) => refreshGroupFromBase(group, clusterMap));
  const groupedClusters = groups.filter((group) =>
    liveGroupDocs.find((docItem) => docItem.id === group.id)?.status === 'grouped',
  );
  const approvedGroups = groups.filter((group) =>
    liveGroupDocs.find((docItem) => docItem.id === group.id)?.status === 'approved',
  );

  const groupedTokens = new Set<string>();
  for (const group of [...groupedClusters, ...approvedGroups]) {
    for (const cluster of group.clusters) {
      groupedTokens.add(cluster.tokens);
    }
  }

  return {
    results: filterRowsByGroupedTokens(base.results, groupedTokens),
    clusterSummary: filterClustersByGroupedTokens(base.clusterSummary, groupedTokens),
    tokenSummary: base.tokenSummary,
    groupedClusters,
    approvedGroups,
    stats: base.stats,
    datasetStats: base.datasetStats,
    blockedTokens: entities.blockedTokens
      .filter((docItem) => docItem.datasetEpoch === base.datasetEpoch)
      .map((docItem) => docItem.token),
    blockedKeywords: entities.manualBlockedKeywords
      .filter((docItem) => docItem.datasetEpoch === base.datasetEpoch)
      .map((docItem) => ({
        keyword: docItem.keyword,
        volume: docItem.volume,
        kd: docItem.kd,
        kwRating: docItem.kwRating,
        reason: docItem.reason,
        tokenArr: docItem.tokenArr,
      })),
    labelSections: entities.labelSections
      .filter((docItem) => docItem.datasetEpoch === base.datasetEpoch)
      .map((docItem) => ({
        id: docItem.id,
        name: docItem.name,
        tokens: docItem.tokens,
        colorIndex: docItem.colorIndex,
      })),
    activityLog: entities.activityLog
      .filter((docItem) => docItem.datasetEpoch === base.datasetEpoch)
      .map((docItem) => ({
        id: docItem.id,
        timestamp: docItem.timestamp,
        action: docItem.action,
        details: docItem.details,
        count: docItem.count,
      }))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 500),
    tokenMergeRules: entities.tokenMergeRules
      .filter((docItem) => docItem.datasetEpoch === base.datasetEpoch)
      .map((docItem) => ({
        id: docItem.id,
        parentToken: docItem.parentToken,
        childTokens: docItem.childTokens,
        createdAt: docItem.createdAt,
        source: docItem.source,
        recommendationId: docItem.recommendationId,
      })),
    autoGroupSuggestions: base.autoGroupSuggestions ?? [],
    autoMergeRecommendations: base.autoMergeRecommendations ?? [],
    groupMergeRecommendations: base.groupMergeRecommendations ?? [],
    updatedAt: base.updatedAt,
    lastSaveId: base.datasetEpoch,
  };
}

export function createBaseCommitId(datasetEpoch: number, actorId: string): string {
  return `commit_${datasetEpoch}_${normalizeDocKey(actorId)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildBaseCommitManifest(
  commitId: string,
  base: ProjectBaseSnapshot,
  options?: { clientId?: string; commitState?: 'writing' | 'ready'; saveId?: number | string },
): ProjectBaseCommitManifestDoc {
  const payload = chunkedBasePayload(base);
  const clean = sanitizeJsonForFirestore(payload);
  const resultChunks = chunkBySize(clean.results ?? [], CHUNK_SIZE);
  const clusterChunks = chunkBySize(clean.clusterSummary ?? [], CHUNK_SIZE);
  const suggestionChunks = chunkBySize(clean.autoGroupSuggestions ?? [], CHUNK_SIZE);
  const autoMergeChunks = chunkBySize(clean.autoMergeRecommendations ?? [], CHUNK_SIZE);
  const groupMergeChunks = chunkBySize(clean.groupMergeRecommendations ?? [], CHUNK_SIZE);

  return {
    id: 'manifest',
    type: 'meta',
    commitId,
    datasetEpoch: base.datasetEpoch,
    commitState: options?.commitState ?? 'ready',
    resultChunkIds: resultChunks.map((_, index) => `results_${index}`),
    resultChunkCount: resultChunks.length,
    clusterChunkIds: clusterChunks.map((_, index) => `clusters_${index}`),
    clusterChunkCount: clusterChunks.length,
    suggestionChunkIds: suggestionChunks.map((_, index) => `suggestions_${index}`),
    suggestionChunkCount: suggestionChunks.length,
    autoMergeChunkIds: autoMergeChunks.map((_, index) => `auto_merge_${index}`),
    autoMergeChunkCount: autoMergeChunks.length,
    groupMergeChunkIds: groupMergeChunks.map((_, index) => `group_merge_${index}`),
    groupMergeChunkCount: groupMergeChunks.length,
    contentHash: null,
    saveId: options?.saveId ?? base.datasetEpoch,
    clientId: options?.clientId ?? null,
    stats: clean.stats ?? null,
    datasetStats: clean.datasetStats ?? null,
    tokenSummary: clean.tokenSummary ?? null,
    blockedTokens: [],
    labelSections: [],
    activityLog: [],
    tokenMergeRules: [],
    groupedClusterCount: 0,
    approvedGroupCount: 0,
    updatedAt: base.updatedAt,
    updatedByClientId: options?.clientId ?? 'system',
    revision: base.datasetEpoch,
    lastMutationId: null,
  } as ProjectBaseCommitManifestDoc;
}

export async function saveBaseSnapshotToFirestore(
  projectId: string,
  base: ProjectBaseSnapshot,
  options?: { saveId?: number | string; clientId?: string },
): Promise<void> {
  const payload = chunkedBasePayload(base);
  const clean = sanitizeJsonForFirestore(payload);
  const results = clean.results ?? [];
  const clusters = clean.clusterSummary ?? [];
  const suggestions = clean.autoGroupSuggestions ?? [];
  const autoMergeRecommendations = clean.autoMergeRecommendations ?? [];
  const groupMergeRecommendations = clean.groupMergeRecommendations ?? [];

  const resultChunks = chunkBySize(results, CHUNK_SIZE);
  const clusterChunks = chunkBySize(clusters, CHUNK_SIZE);
  const suggestionChunks = chunkBySize(suggestions, CHUNK_SIZE);
  const autoMergeChunks = chunkBySize(autoMergeRecommendations, CHUNK_SIZE);
  const groupMergeChunks = chunkBySize(groupMergeRecommendations, CHUNK_SIZE);

  const docs = [
    ...resultChunks.map((chunk, index) => ({ id: `results_${index}`, type: 'results', index, data: chunk })),
    ...clusterChunks.map((chunk, index) => ({ id: `clusters_${index}`, type: 'clusters', index, data: chunk })),
    ...suggestionChunks.map((chunk, index) => ({ id: `suggestions_${index}`, type: 'suggestions', index, data: chunk })),
    ...autoMergeChunks.map((chunk, index) => ({ id: `auto_merge_${index}`, type: 'auto_merge', index, data: chunk })),
    ...groupMergeChunks.map((chunk, index) => ({ id: `group_merge_${index}`, type: 'group_merge', index, data: chunk })),
    {
      id: 'meta',
      type: 'meta',
      saveId: options?.saveId ?? base.datasetEpoch,
      clientId: options?.clientId ?? null,
      stats: clean.stats ?? null,
      datasetStats: clean.datasetStats ?? null,
      tokenSummary: clean.tokenSummary ?? null,
      blockedTokens: [],
      labelSections: [],
      activityLog: [],
      tokenMergeRules: [],
      groupedClusterCount: 0,
      approvedGroupCount: 0,
      resultChunkCount: resultChunks.length,
      clusterChunkCount: clusterChunks.length,
      blockedChunkCount: 0,
      suggestionChunkCount: suggestionChunks.length,
      autoMergeChunkCount: autoMergeChunks.length,
      groupMergeChunkCount: groupMergeChunks.length,
      updatedAt: base.updatedAt,
    },
  ];

  await replaceSubcollectionDocs(projectId, PROJECT_BASE_SUBCOLLECTION, docs);
}

export async function saveBaseCommitToFirestore(
  projectId: string,
  base: ProjectBaseSnapshot,
  options?: { commitId?: string; saveId?: number | string; clientId?: string },
): Promise<ProjectBaseCommitManifestDoc> {
  const commitId = options?.commitId ?? createBaseCommitId(base.datasetEpoch, options?.clientId ?? 'system');
  const payload = chunkedBasePayload(base);
  const clean = sanitizeJsonForFirestore(payload);
  const resultChunks = chunkBySize(clean.results ?? [], CHUNK_SIZE);
  const clusterChunks = chunkBySize(clean.clusterSummary ?? [], CHUNK_SIZE);
  const suggestionChunks = chunkBySize(clean.autoGroupSuggestions ?? [], CHUNK_SIZE);
  const autoMergeChunks = chunkBySize(clean.autoMergeRecommendations ?? [], CHUNK_SIZE);
  const groupMergeChunks = chunkBySize(clean.groupMergeRecommendations ?? [], CHUNK_SIZE);

  const writingManifest = buildBaseCommitManifest(commitId, base, {
    clientId: options?.clientId,
    commitState: 'writing',
    saveId: options?.saveId ?? base.datasetEpoch,
  });
  await setDoc(baseCommitDoc(projectId, commitId), sanitizeJsonForFirestore(writingManifest));

  const chunkDocs = [
    ...resultChunks.map((chunk, index) => ({ id: `results_${index}`, type: 'results', index, data: chunk })),
    ...clusterChunks.map((chunk, index) => ({ id: `clusters_${index}`, type: 'clusters', index, data: chunk })),
    ...suggestionChunks.map((chunk, index) => ({ id: `suggestions_${index}`, type: 'suggestions', index, data: chunk })),
    ...autoMergeChunks.map((chunk, index) => ({ id: `auto_merge_${index}`, type: 'auto_merge', index, data: chunk })),
    ...groupMergeChunks.map((chunk, index) => ({ id: `group_merge_${index}`, type: 'group_merge', index, data: chunk })),
  ];
  await replaceNestedSubcollectionDocs(baseCommitDoc(projectId, commitId), PROJECT_BASE_COMMIT_CHUNKS_SUBCOLLECTION, chunkDocs);

  const readyManifest = buildBaseCommitManifest(commitId, base, {
    clientId: options?.clientId,
    commitState: 'ready',
    saveId: options?.saveId ?? base.datasetEpoch,
  });
  await setDoc(baseCommitDoc(projectId, commitId), sanitizeJsonForFirestore(readyManifest));
  return readyManifest;
}

function isBaseCommitReady(manifest: unknown): manifest is ProjectBaseCommitManifestDoc {
  return Boolean(
    manifest &&
    typeof manifest === 'object' &&
    (manifest as { type?: string }).type === 'meta' &&
    (manifest as { commitState?: string }).commitState === 'ready' &&
    typeof (manifest as { commitId?: unknown }).commitId === 'string' &&
    typeof (manifest as { datasetEpoch?: unknown }).datasetEpoch === 'number',
  );
}

function countChunkDocsByType(docs: Array<{ data: () => any }>) {
  return docs.reduce(
    (acc, snap) => {
      const data = snap.data() as { type?: string };
      if (data.type === 'results') acc.results += 1;
      if (data.type === 'clusters') acc.clusters += 1;
      if (data.type === 'suggestions') acc.suggestions += 1;
      if (data.type === 'auto_merge') acc.autoMerge += 1;
      if (data.type === 'group_merge') acc.groupMerge += 1;
      return acc;
    },
    { results: 0, clusters: 0, suggestions: 0, autoMerge: 0, groupMerge: 0 },
  );
}

function expectedManifestChunkIds(manifest: ProjectBaseCommitManifestDoc): string[] {
  return [
    ...manifest.resultChunkIds,
    ...manifest.clusterChunkIds,
    ...manifest.suggestionChunkIds,
    ...manifest.autoMergeChunkIds,
    ...manifest.groupMergeChunkIds,
  ];
}

function exactChunkSetMatches(
  manifest: ProjectBaseCommitManifestDoc,
  docs: Array<{ data: () => any }>,
): boolean {
  const expected = expectedManifestChunkIds(manifest).sort();
  const actual = docs
    .map((snap) => {
      const data = snap.data() as { id?: string };
      return typeof data.id === 'string' ? data.id : '';
    })
    .filter((id) => id.length > 0)
    .sort();
  if (expected.length !== actual.length) return false;
  return expected.every((id, index) => actual[index] === id);
}

function normalizeLoadedGroupDoc(group: ProjectGroupDoc): ProjectGroupDoc {
  const clusters = group.clusters ?? [];
  const clusterTokens = (group.clusterTokens ?? []).length > 0
    ? group.clusterTokens
    : clusters.map((cluster) => cluster.tokens);
  return {
    ...group,
    clusterTokens,
    clusters,
  };
}

function isLegacyGroupDoc(group: ProjectGroupDoc): boolean {
  return (group.clusters?.length ?? 0) > 0;
}

export async function loadBaseSnapshotFromFirestore(projectId: string): Promise<ProjectBaseSnapshot | null> {
  try {
    const snapshot = await getDocs(projectCollection(projectId, PROJECT_BASE_SUBCOLLECTION));
    if (snapshot.empty) return null;
    return toBaseSnapshot(buildProjectDataPayloadFromChunkDocs(snapshot.docs as Array<{ data: () => any }>));
  } catch {
    return null;
  }
}

export interface LoadedBaseCommit {
  manifest: ProjectBaseCommitManifestDoc;
  base: ProjectBaseSnapshot;
}

export interface ProjectCanonicalCacheEntry extends ProjectV2CacheMetadata {
  payload: ProjectDataPayload;
}

export async function loadBaseCommit(projectId: string, commitId: string): Promise<LoadedBaseCommit | null> {
  try {
    const [manifestSnap, chunksSnap] = await Promise.all([
      getDoc(baseCommitDoc(projectId, commitId)),
      getDocs(baseCommitChunksCollection(projectId, commitId)),
    ]);
    if (!manifestSnap.exists()) return null;
    const manifest = manifestSnap.data() as ProjectBaseCommitManifestDoc;
    if (!isBaseCommitReady(manifest) || manifest.commitId !== commitId) return null;

    const counts = countChunkDocsByType(chunksSnap.docs as Array<{ data: () => any }>);
    const expectedTotal =
      manifest.resultChunkCount +
      manifest.clusterChunkCount +
      manifest.suggestionChunkCount +
      manifest.autoMergeChunkCount +
      manifest.groupMergeChunkCount;
    const actualTotal =
      counts.results +
      counts.clusters +
      counts.suggestions +
      counts.autoMerge +
      counts.groupMerge;
    if (actualTotal !== expectedTotal) return null;
    if (
      counts.results !== manifest.resultChunkCount ||
      counts.clusters !== manifest.clusterChunkCount ||
      counts.suggestions !== manifest.suggestionChunkCount ||
      counts.autoMerge !== manifest.autoMergeChunkCount ||
      counts.groupMerge !== manifest.groupMergeChunkCount
    ) {
      return null;
    }
    if (!exactChunkSetMatches(manifest, chunksSnap.docs as Array<{ data: () => any }>)) {
      return null;
    }

    const payload = buildProjectDataPayloadFromChunkDocs([
      { data: () => manifest } as { data: () => any },
      ...chunksSnap.docs.map((docSnap) => ({ data: () => docSnap.data() } as { data: () => any })),
    ]);
    const base = toBaseSnapshot(payload);
    if (!base || base.datasetEpoch !== manifest.datasetEpoch) return null;
    base.datasetEpoch = manifest.datasetEpoch;
    return { manifest, base };
  } catch {
    return null;
  }
}

export function isProjectCanonicalCacheEntry(value: unknown): value is ProjectCanonicalCacheEntry {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === CLIENT_SCHEMA_VERSION &&
    typeof (value as { datasetEpoch?: unknown }).datasetEpoch === 'number' &&
    typeof (value as { baseCommitId?: unknown }).baseCommitId === 'string' &&
    typeof (value as { cachedAt?: unknown }).cachedAt === 'string' &&
    value != null &&
    typeof (value as { payload?: unknown }).payload === 'object',
  );
}

export async function loadCanonicalCacheFromIDB(projectId: string): Promise<ProjectCanonicalCacheEntry | null> {
  const cached = await loadFromIDB<ProjectCanonicalCacheEntry | ProjectDataPayload>(projectId);
  if (!cached) return null;
  return isProjectCanonicalCacheEntry(cached) ? cached : null;
}

export async function saveCanonicalCacheToIDB(
  projectId: string,
  payload: ProjectDataPayload,
  meta: Pick<ProjectCollabMetaDoc, 'datasetEpoch' | 'baseCommitId'>,
): Promise<void> {
  if (!meta.baseCommitId) return;
  await saveToIDB(projectId, {
    schemaVersion: CLIENT_SCHEMA_VERSION,
    datasetEpoch: meta.datasetEpoch,
    baseCommitId: meta.baseCommitId,
    cachedAt: nowIso(),
    payload,
  } satisfies ProjectCanonicalCacheEntry);
}

export async function loadCollabMeta(projectId: string): Promise<ProjectCollabMetaDoc | null> {
  try {
    const snapshot = await getDoc(collabMetaDoc(projectId));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return isMetaDocV2(data) ? data : null;
  } catch {
    return null;
  }
}

export async function loadCollabEntitiesFromFirestore(
  projectId: string,
  datasetEpoch?: number,
): Promise<ProjectCollabEntityState> {
  const [meta, groups, blockedTokens, manualBlockedKeywords, tokenMergeRules, labelSections, activityLog, activeOp] =
    await Promise.all([
      loadCollabMeta(projectId),
      loadCollectionDocs<ProjectGroupDoc>(projectId, PROJECT_GROUPS_SUBCOLLECTION, datasetEpoch),
      loadCollectionDocs<ProjectBlockedTokenDoc>(projectId, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, datasetEpoch),
      loadCollectionDocs<ProjectBlockedKeywordDoc>(projectId, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, datasetEpoch),
      loadCollectionDocs<ProjectTokenMergeRuleDoc>(projectId, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, datasetEpoch),
      loadCollectionDocs<ProjectLabelSectionDoc>(projectId, PROJECT_LABEL_SECTIONS_SUBCOLLECTION, datasetEpoch),
      loadCollectionDocs<ProjectActivityLogDoc>(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, datasetEpoch),
      getDoc(operationLockDoc(projectId)).catch(() => null),
    ]);

  const lockData = activeOp && 'exists' in activeOp && activeOp.exists()
    ? (activeOp.data() as ProjectOperationLockDoc)
    : null;

  return {
    meta,
    groups: groups.map(normalizeLoadedGroupDoc),
    blockedTokens,
    manualBlockedKeywords,
    tokenMergeRules,
    labelSections,
    activityLog,
    activeOperation: lockData,
  };
}

async function writeMetaDoc(
  projectId: string,
  actorId: string,
  fields: Partial<ProjectCollabMetaDoc> &
    Pick<ProjectCollabMetaDoc, 'migrationState' | 'datasetEpoch' | 'readMode' | 'baseCommitId' | 'commitState'>,
): Promise<ProjectCollabMetaDoc> {
  const nextMeta: ProjectCollabMetaDoc = {
    schemaVersion: 2,
    migrationState: fields.migrationState,
    datasetEpoch: fields.datasetEpoch,
    baseCommitId: fields.baseCommitId,
    commitState: fields.commitState,
    lastMigratedAt: fields.lastMigratedAt ?? nowIso(),
    migrationOwnerClientId: fields.migrationOwnerClientId ?? null,
    migrationStartedAt: fields.migrationStartedAt ?? null,
    migrationHeartbeatAt: fields.migrationHeartbeatAt ?? null,
    migrationExpiresAt: fields.migrationExpiresAt ?? null,
    readMode: fields.readMode,
    requiredClientSchema: fields.requiredClientSchema ?? CLIENT_SCHEMA_VERSION,
    lastWriterClientId: fields.lastWriterClientId ?? actorId,
    lastWriterUserId: fields.lastWriterUserId ?? null,
    revision: fields.revision ?? 0,
    updatedAt: fields.updatedAt ?? nowIso(),
    updatedByClientId: fields.updatedByClientId ?? actorId,
    lastMutationId: fields.lastMutationId ?? null,
  };
  await setDoc(collabMetaDoc(projectId), sanitizeJsonForFirestore(nextMeta));
  return nextMeta;
}

export async function replaceCollabEntities(
  projectId: string,
  entities: ProjectCollabEntityState,
  actorId: string,
  datasetEpoch: number,
): Promise<void> {
  await saveCollabEntityDocs(projectId, entities, actorId, datasetEpoch);
}

async function saveCollabEntityDocs(
  projectId: string,
  entities: ProjectCollabEntityState,
  actorId: string,
  datasetEpoch: number,
): Promise<void> {
  const saveEpochDocs = async <T extends { id: string }>(subcollection: string, docs: T[]) => {
    await clearEpochSubcollection(projectId, subcollection, datasetEpoch);

    let batch = writeBatch(db);
    let ops = 0;
    const commits: Promise<void>[] = [];
    const flush = () => {
      if (ops === 0) return;
      commits.push(batch.commit());
      batch = writeBatch(db);
      ops = 0;
    };

    for (const docItem of docs) {
      batch.set(
        scopedProjectDoc(projectId, subcollection, datasetEpoch, docItem.id),
        sanitizeJsonForFirestore({
          ...docItem,
          id: docItem.id,
          datasetEpoch,
        }),
      );
      ops += 1;
      if (ops >= MAX_BATCH_OPS) flush();
    }

    flush();
    await Promise.all(commits);
  };

  await Promise.all([
    saveEpochDocs(PROJECT_GROUPS_SUBCOLLECTION, entities.groups),
    saveEpochDocs(PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, entities.blockedTokens),
    saveEpochDocs(PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, entities.manualBlockedKeywords),
    saveEpochDocs(PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, entities.tokenMergeRules),
    saveEpochDocs(PROJECT_LABEL_SECTIONS_SUBCOLLECTION, entities.labelSections),
    saveEpochDocs(PROJECT_ACTIVITY_LOG_SUBCOLLECTION, entities.activityLog),
  ]);
}

export async function flipProjectMetaToCommit(
  projectId: string,
  actorId: string,
  expectedRevision: number,
  expectedEpoch: number,
  nextEpoch: number,
  baseCommitId: string,
): Promise<ProjectCollabMetaDoc> {
  return runTransaction(db, async (tx) => {
    const ref = collabMetaDoc(projectId);
    const lockRef = operationLockDoc(projectId);
    const [metaSnap, lockSnap] = await Promise.all([tx.get(ref), tx.get(lockRef)]);
    const currentMeta = metaSnap.exists() ? (metaSnap.data() as ProjectCollabMetaDoc) : null;
    const currentLock = lockSnap.exists() ? (lockSnap.data() as ProjectOperationLockDoc) : null;

    if (!currentMeta || currentMeta.revision !== expectedRevision || currentMeta.datasetEpoch !== expectedEpoch) {
      throw new Error('meta-conflict');
    }
    if (
      !currentLock ||
      (currentLock.ownerId !== actorId && currentLock.ownerClientId !== actorId) ||
      Date.parse(currentLock.expiresAt || '0') <= Date.now()
    ) {
      throw new Error('lock-conflict');
    }

    const nextMeta: ProjectCollabMetaDoc = {
      ...currentMeta,
      migrationState: 'complete',
      datasetEpoch: nextEpoch,
      baseCommitId,
      commitState: 'ready',
      readMode: 'v2',
      requiredClientSchema: CLIENT_SCHEMA_VERSION,
      lastMigratedAt: nowIso(),
      migrationOwnerClientId: null,
      migrationStartedAt: null,
      migrationHeartbeatAt: null,
      migrationExpiresAt: null,
      lastWriterClientId: actorId,
      revision: currentMeta.revision + 1,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: createMutationId(actorId),
    };

    tx.set(ref, sanitizeJsonForFirestore(nextMeta));
    return nextMeta;
  });
}

export async function heartbeatProjectOperationLock(
  projectId: string,
  actorId: string,
): Promise<ProjectOperationLockDoc | null> {
  return runTransaction(db, async (tx) => {
    const ref = operationLockDoc(projectId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const existing = snap.data() as ProjectOperationLockDoc;
    if (existing.ownerId !== actorId && existing.ownerClientId !== actorId) return null;

    const now = nowIso();
    const nextLock: ProjectOperationLockDoc = {
      ...existing,
      heartbeatAt: now,
      expiresAt: new Date(Date.now() + OPERATION_TTL_MS).toISOString(),
      status: 'running',
    };
    tx.set(ref, sanitizeJsonForFirestore(nextLock));
    return nextLock;
  });
}

export async function commitCanonicalProjectState(
  projectId: string,
  payload: ProjectDataPayload,
  actorId: string,
  options: { expectedMetaRevision: number; expectedDatasetEpoch: number },
): Promise<CanonicalProjectState> {
  const nextEpoch = Math.max(payload.lastSaveId ?? 0, options.expectedDatasetEpoch + 1, 1);
  const base = buildBaseSnapshotFromResolvedPayload(payload);
  base.datasetEpoch = nextEpoch;
  const baseCommitId = createBaseCommitId(nextEpoch, actorId);
  const entities = buildEntityStateFromResolvedPayload(payload, actorId, nextEpoch);

  await saveBaseCommitToFirestore(projectId, base, {
    commitId: baseCommitId,
    saveId: nextEpoch,
    clientId: actorId,
  });
  await saveCollabEntityDocs(projectId, entities, actorId, nextEpoch);

  const meta = await flipProjectMetaToCommit(
    projectId,
    actorId,
    options.expectedMetaRevision,
    options.expectedDatasetEpoch,
    nextEpoch,
    baseCommitId,
  );

  return {
    mode: 'v2',
    base,
    entities: { ...entities, meta, activeOperation: null },
    resolved: assembleCanonicalPayload(base, { ...entities, meta, activeOperation: null }),
  };
}

export async function migrateLegacyProjectToV2(
  projectId: string,
  payload: ProjectDataPayload,
  actorId: string,
): Promise<CanonicalProjectState> {
  const datasetEpoch = Math.max(payload.lastSaveId ?? 1, 1);
  const baseCommitId = createBaseCommitId(datasetEpoch, actorId);
  const leaseExpiresAt = new Date(Date.now() + OPERATION_TTL_MS).toISOString();
  const existingMeta = await loadCollabMeta(projectId);
  const runningRevision = (existingMeta?.revision ?? 0) + 1;

  await runTransaction(db, async (tx) => {
    const ref = collabMetaDoc(projectId);
    const snap = await tx.get(ref);
    const existing = snap.exists() ? (snap.data() as ProjectCollabMetaDoc) : null;
    if (isMetaDocV2(existing) && existing.migrationState === 'complete' && existing.readMode === 'v2') {
      return;
    }
    if (migrationLeaseActive(existing, actorId)) {
      throw new Error('migration-in-progress');
    }

    tx.set(ref, sanitizeJsonForFirestore({
      schemaVersion: 2,
      migrationState: 'running',
      datasetEpoch,
      baseCommitId,
      commitState: 'writing',
      lastMigratedAt: nowIso(),
      migrationOwnerClientId: actorId,
      migrationStartedAt: nowIso(),
      migrationHeartbeatAt: nowIso(),
      migrationExpiresAt: leaseExpiresAt,
      readMode: 'legacy',
      requiredClientSchema: CLIENT_SCHEMA_VERSION,
      lastWriterClientId: actorId,
      revision: runningRevision,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: createMutationId(actorId),
    }));
  });

  const base = buildBaseSnapshotFromResolvedPayload(payload);
  base.datasetEpoch = datasetEpoch;
  const entities = buildEntityStateFromResolvedPayload(payload, actorId, datasetEpoch);
  await saveBaseCommitToFirestore(projectId, base, { commitId: baseCommitId, saveId: datasetEpoch, clientId: actorId });
  await saveCollabEntityDocs(projectId, entities, actorId, datasetEpoch);
  const meta = await flipProjectMetaToCommit(
    projectId,
    actorId,
    runningRevision,
    datasetEpoch,
    datasetEpoch,
    baseCommitId,
  );

  return {
    mode: 'v2',
    base,
    entities: { ...entities, meta, activeOperation: null },
    resolved: assembleCanonicalPayload(base, { ...entities, meta, activeOperation: null }),
  };
}

async function rewriteLegacyGroupDocs(
  projectId: string,
  groups: ProjectGroupDoc[],
  actorId: string,
): Promise<ProjectGroupDoc[]> {
  const legacyGroups = groups.filter(isLegacyGroupDoc);
  if (legacyGroups.length === 0) {
    return groups;
  }

  const changes: RevisionedDocChange<ProjectGroupDoc>[] = legacyGroups.map((group) => ({
    kind: 'upsert',
    id: group.id,
    expectedRevision: group.revision ?? 0,
    datasetEpoch: group.datasetEpoch,
    value: {
      ...group,
      clusterTokens: group.clusterTokens,
      clusters: undefined,
      revision: group.revision ?? 0,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastWriterClientId: actorId,
      lastMutationId: null,
    },
  }));

  try {
    const acknowledgements = await commitRevisionedDocChanges(
      projectId,
      PROJECT_GROUPS_SUBCOLLECTION,
      changes,
      actorId,
    );
    const rewrittenById = new Map(
      acknowledgements
        .filter((ack) => ack.kind === 'upsert' && ack.value)
        .map((ack) => [ack.id, ack.value as ProjectGroupDoc]),
    );
    return groups.map((group) => rewrittenById.get(group.id) ?? group);
  } catch {
    return groups;
  }
}

export async function loadCanonicalEpoch(
  projectId: string,
  meta: ProjectCollabMetaDoc,
): Promise<CanonicalProjectState | null> {
  if (!meta || meta.readMode !== 'v2') return null;

  if (meta.baseCommitId && meta.commitState === 'ready') {
    const [baseCommit, rawEntities] = await Promise.all([
      loadBaseCommit(projectId, meta.baseCommitId),
      loadCollabEntitiesFromFirestore(projectId, meta.datasetEpoch),
    ]);
    if (baseCommit) {
      const groups = await rewriteLegacyGroupDocs(projectId, rawEntities.groups, meta.updatedByClientId ?? 'system');
      const entities = { ...rawEntities, groups };
      const canonicalEntities = { ...entities, meta };
      const resolved = assembleCanonicalPayload(baseCommit.base, canonicalEntities);
      if (resolved) {
        return {
          mode: 'v2',
          base: baseCommit.base,
          entities: canonicalEntities,
          resolved,
        };
      }
    }
  }

  return null;
}

export async function loadCanonicalProjectState(
  projectId: string,
  actorId: string,
  legacyLoader: () => Promise<ProjectDataPayload | null>,
): Promise<CanonicalProjectState> {
  const meta = await loadCollabMeta(projectId);
  if (meta?.readMode === 'v2') {
    const canonical = await loadCanonicalEpoch(projectId, meta);
    if (canonical) {
      return canonical;
    }
  }

  const legacyPayload = await legacyLoader();
  if (!legacyPayload) {
    return {
      mode: 'legacy',
      base: null,
      entities: emptyEntities(),
      resolved: null,
    };
  }

  try {
    return await migrateLegacyProjectToV2(projectId, legacyPayload, actorId);
  } catch (error) {
    if ((error as Error)?.message === 'migration-in-progress') {
      return {
        mode: 'legacy',
        base: null,
        entities: emptyEntities(),
        resolved: legacyPayload,
      };
    }
    return {
      mode: 'legacy',
      base: null,
      entities: emptyEntities(),
      resolved: legacyPayload,
    };
  }
}

export function buildGroupDocChanges(
  previousDocs: ProjectGroupDoc[],
  nextGrouped: GroupedCluster[],
  nextApproved: GroupedCluster[],
  actorId: string,
  datasetEpoch: number,
): RevisionedDocChange<ProjectGroupDoc>[] {
  const nextDocs = [
    ...nextGrouped.map((group) => toGroupDoc(group, 'grouped', actorId, datasetEpoch)),
    ...nextApproved.map((group) => toGroupDoc(group, 'approved', actorId, datasetEpoch)),
  ];

  return diffDocsById(previousDocs, nextDocs, (value) => ({
    groupName: value.groupName,
    status: value.status,
    datasetEpoch: value.datasetEpoch,
    clusterTokens: value.clusterTokens,
    reviewStatus: value.reviewStatus,
    reviewMismatchedPages: value.reviewMismatchedPages,
    reviewReason: value.reviewReason,
    reviewCost: value.reviewCost,
    reviewedAt: value.reviewedAt,
    mergeAffected: value.mergeAffected,
    groupAutoMerged: value.groupAutoMerged,
    pageCount: value.pageCount,
    totalVolume: value.totalVolume,
    keywordCount: value.keywordCount,
    avgKd: value.avgKd,
    avgKwRating: value.avgKwRating,
  }));
}

export function buildBlockedTokenDocChanges(
  previousDocs: ProjectBlockedTokenDoc[],
  nextTokens: string[],
  actorId: string,
  datasetEpoch: number,
): RevisionedDocChange<ProjectBlockedTokenDoc>[] {
  const nextDocs = nextTokens.map((token) => ({
    id: blockedTokenDocId(token),
    token,
    datasetEpoch,
    lastWriterClientId: actorId,
    revision: 0,
    updatedAt: nowIso(),
    updatedByClientId: actorId,
    lastMutationId: null,
  }));
  return diffDocsById(previousDocs, nextDocs, (value) => ({ token: value.token, datasetEpoch: value.datasetEpoch }));
}

export function buildManualBlockedKeywordDocChanges(
  previousDocs: ProjectBlockedKeywordDoc[],
  nextKeywords: BlockedKeyword[],
  actorId: string,
  datasetEpoch: number,
): RevisionedDocChange<ProjectBlockedKeywordDoc>[] {
  const nextDocs = nextKeywords.map((keyword) => ({
    id: manualBlockedKeywordDocId(keyword),
    datasetEpoch,
    lastWriterClientId: actorId,
    keyword: keyword.keyword,
    volume: keyword.volume,
    kd: keyword.kd,
    kwRating: keyword.kwRating,
    reason: keyword.reason,
    tokenArr: keyword.tokenArr,
    revision: 0,
    updatedAt: nowIso(),
    updatedByClientId: actorId,
    lastMutationId: null,
  }));
  return diffDocsById(previousDocs, nextDocs, (value) => ({
    datasetEpoch: value.datasetEpoch,
    keyword: value.keyword,
    volume: value.volume,
    kd: value.kd,
    kwRating: value.kwRating,
    reason: value.reason,
    tokenArr: value.tokenArr,
  }));
}

export function buildTokenMergeRuleDocChanges(
  previousDocs: ProjectTokenMergeRuleDoc[],
  nextRules: TokenMergeRule[],
  actorId: string,
  datasetEpoch: number,
): RevisionedDocChange<ProjectTokenMergeRuleDoc>[] {
  const nextDocs = nextRules.map((rule) => ({
    ...rule,
    id: tokenMergeRuleDocId(rule),
    datasetEpoch,
    lastWriterClientId: actorId,
    revision: 0,
    updatedAt: nowIso(),
    updatedByClientId: actorId,
    lastMutationId: null,
  }));
  return diffDocsById(previousDocs, nextDocs, (value) => ({
    datasetEpoch: value.datasetEpoch,
    parentToken: value.parentToken,
    childTokens: value.childTokens,
    createdAt: value.createdAt,
    source: value.source,
    recommendationId: value.recommendationId,
  }));
}

export function buildLabelSectionDocChanges(
  previousDocs: ProjectLabelSectionDoc[],
  nextSections: LabelSection[],
  actorId: string,
  datasetEpoch: number,
): RevisionedDocChange<ProjectLabelSectionDoc>[] {
  const nextDocs = nextSections.map((section) => ({
    ...section,
    id: labelSectionDocId(section),
    datasetEpoch,
    lastWriterClientId: actorId,
    revision: 0,
    updatedAt: nowIso(),
    updatedByClientId: actorId,
    lastMutationId: null,
  }));
  return diffDocsById(previousDocs, nextDocs, (value) => ({
    datasetEpoch: value.datasetEpoch,
    name: value.name,
    tokens: value.tokens,
    colorIndex: value.colorIndex,
  }));
}

export async function commitRevisionedDocChanges<T extends { revision?: number } & object>(
  projectId: string,
  subcollection: string,
  changes: RevisionedDocChange<T>[],
  actorId: string,
): Promise<RevisionedDocAck<T>[]> {
  const acknowledgements: RevisionedDocAck<T>[] = [];
  for (const change of changes) {
    const ref = change.datasetEpoch != null
      ? scopedProjectDoc(projectId, subcollection, change.datasetEpoch, change.id)
      : projectDoc(projectId, subcollection, change.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const currentRevision = snap.exists() ? ((snap.data() as { revision?: number }).revision ?? 0) : 0;
      if (currentRevision !== change.expectedRevision) {
        throw new Error(`conflict:${subcollection}:${change.id}`);
      }
      if (change.kind === 'delete') {
        tx.delete(ref);
        acknowledgements.push({
          kind: 'delete',
          id: change.id,
          revision: currentRevision + 1,
          lastMutationId: change.mutationId ?? null,
        });
        return;
      }
      const nextValue = {
        ...(change.value as object),
        id: change.id,
        ...(change.datasetEpoch != null ? { datasetEpoch: change.datasetEpoch } : {}),
        revision: currentRevision + 1,
        updatedAt: nowIso(),
        updatedByClientId: actorId,
        lastMutationId: change.mutationId ?? null,
      };
      tx.set(ref, sanitizeJsonForFirestore(nextValue));
      acknowledgements.push({
        kind: 'upsert',
        id: change.id,
        revision: currentRevision + 1,
        lastMutationId: change.mutationId ?? null,
        value: nextValue as unknown as T,
      });
    });
  }
  return acknowledgements;
}

export async function appendActivityLogEntry(
  projectId: string,
  entry: ActivityLogEntry,
  actorId: string,
  datasetEpoch: number,
  mutationId?: string,
): Promise<void> {
  await setDoc(
    scopedProjectDoc(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, datasetEpoch, activityLogDocId(entry)),
    sanitizeJsonForFirestore({
      ...entry,
      datasetEpoch,
      createdByClientId: actorId,
      mutationId: mutationId ?? null,
    }),
  );
}

export async function replaceActivityLog(
  projectId: string,
  entries: ActivityLogEntry[],
  actorId: string,
  datasetEpoch: number,
): Promise<void> {
  await clearEpochSubcollection(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, datasetEpoch);

  let batch = writeBatch(db);
  let ops = 0;
  const commits: Promise<void>[] = [];
  const flush = () => {
    if (ops === 0) return;
    commits.push(batch.commit());
    batch = writeBatch(db);
    ops = 0;
  };

  for (const entry of entries) {
    batch.set(
      scopedProjectDoc(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, datasetEpoch, activityLogDocId(entry)),
      sanitizeJsonForFirestore({
        ...entry,
        id: activityLogDocId(entry),
        datasetEpoch,
        createdByClientId: actorId,
        mutationId: null,
      }),
    );
    ops += 1;
    if (ops >= MAX_BATCH_OPS) flush();
  }

  flush();
  await Promise.all(commits);
}

export async function deleteProjectV2Data(projectId: string): Promise<void> {
  await Promise.all([
    clearSubcollection(projectId, PROJECT_BASE_SUBCOLLECTION),
    clearBaseCommits(projectId),
    clearSubcollection(projectId, PROJECT_GROUPS_SUBCOLLECTION),
    clearSubcollection(projectId, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION),
    clearSubcollection(projectId, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION),
    clearSubcollection(projectId, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION),
    clearSubcollection(projectId, PROJECT_LABEL_SECTIONS_SUBCOLLECTION),
    clearSubcollection(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION),
    clearSubcollection(projectId, PROJECT_OPERATIONS_SUBCOLLECTION),
  ]);

  await deleteDoc(collabMetaDoc(projectId)).catch(() => undefined);
}

export async function acquireProjectOperationLock(
  projectId: string,
  type: ProjectOperationLockDoc['type'],
  actorId: string,
): Promise<ProjectOperationLockDoc | null> {
  return runTransaction(db, async (tx) => {
    const ref = operationLockDoc(projectId);
    const snap = await tx.get(ref);
    const existing = snap.exists() ? (snap.data() as ProjectOperationLockDoc) : null;
    if (lockIsActive(existing, actorId)) {
      return null;
    }

    const startedAt = nowIso();
    const nextLock: ProjectOperationLockDoc = {
      type,
      ownerId: actorId,
      ownerClientId: actorId,
      startedAt,
      heartbeatAt: startedAt,
      expiresAt: new Date(Date.now() + OPERATION_TTL_MS).toISOString(),
      status: 'running',
    };
    tx.set(ref, sanitizeJsonForFirestore(nextLock));
    return nextLock;
  });
}

export async function releaseProjectOperationLock(projectId: string, actorId: string): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = operationLockDoc(projectId);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const existing = snap.data() as ProjectOperationLockDoc;
    if (existing.ownerId !== actorId && existing.ownerClientId !== actorId) return;
    tx.delete(ref);
  });
}
