import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  buildProjectDataPayloadFromChunkDocs,
  sanitizeJsonForFirestore,
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
  ProjectBlockedKeywordDoc,
  ProjectBlockedTokenDoc,
  ProjectCollabMetaDoc,
  ProjectGroupDoc,
  ProjectLabelSectionDoc,
  ProjectOperationLockDoc,
  ProjectTokenMergeRuleDoc,
  Stats,
  TokenMergeRule,
  TokenSummary,
} from './types';

const PROJECTS_COLLECTION = 'projects';
const CHUNK_SIZE = 200;
const MAX_BATCH_OPS = 450;
const OPERATION_TTL_MS = 15 * 60 * 1000;
const CLIENT_SCHEMA_VERSION = 2;

export const PROJECT_BASE_SUBCOLLECTION = 'base_chunks';
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
  value?: T;
  mutationId?: string;
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

function operationLockDoc(projectId: string) {
  return projectDoc(projectId, PROJECT_OPERATIONS_SUBCOLLECTION, PROJECT_OPERATION_CURRENT_DOC);
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

function blockedTokenDocId(token: string): string {
  return normalizeDocKey(token);
}

function manualBlockedKeywordDocId(keyword: BlockedKeyword): string {
  const normalizedKeyword = keyword.keyword.trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedReason = keyword.reason.trim().toLowerCase().replace(/\s+/g, ' ');
  return encodeURIComponent(`${normalizedKeyword}::${normalizedReason}`);
}

function toGroupDoc(
  group: GroupedCluster,
  status: 'grouped' | 'approved',
  actorId: string,
  datasetEpoch: number,
): ProjectGroupDoc {
  return {
    id: group.id,
    groupName: group.groupName,
    status,
    datasetEpoch,
    lastWriterClientId: actorId,
    clusterTokens: group.clusters.map((cluster) => cluster.tokens),
    clusters: group.clusters,
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
  const clusters = group.clusterTokens
    .map((token) => clusterMap.get(token) ?? group.clusters.find((cluster) => cluster.tokens === token) ?? null)
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
      changes.push({ kind: 'delete', id: previous.id, expectedRevision: revision });
    }
  }

  for (const next of nextDocs) {
    const previous = previousById.get(next.id);
    const expectedRevision = previous ? (previous as { revision?: number }).revision ?? 0 : 0;
    if (!previous || stableComparable(compare(previous)) !== stableComparable(compare(next))) {
      changes.push({
        kind: 'upsert',
        id: next.id,
        expectedRevision,
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

async function loadCollectionDocs<T>(projectId: string, subcollection: string): Promise<T[]> {
  try {
    const snapshot = await getDocs(projectCollection(projectId, subcollection));
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as object) } as T));
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

export async function loadBaseSnapshotFromFirestore(projectId: string): Promise<ProjectBaseSnapshot | null> {
  try {
    const snapshot = await getDocs(projectCollection(projectId, PROJECT_BASE_SUBCOLLECTION));
    if (snapshot.empty) return null;
    return toBaseSnapshot(buildProjectDataPayloadFromChunkDocs(snapshot.docs as Array<{ data: () => any }>));
  } catch {
    return null;
  }
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

export async function loadCollabEntitiesFromFirestore(projectId: string): Promise<ProjectCollabEntityState> {
  const [meta, groups, blockedTokens, manualBlockedKeywords, tokenMergeRules, labelSections, activityLog, activeOp] =
    await Promise.all([
      loadCollabMeta(projectId),
      loadCollectionDocs<ProjectGroupDoc>(projectId, PROJECT_GROUPS_SUBCOLLECTION),
      loadCollectionDocs<ProjectBlockedTokenDoc>(projectId, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION),
      loadCollectionDocs<ProjectBlockedKeywordDoc>(projectId, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION),
      loadCollectionDocs<ProjectTokenMergeRuleDoc>(projectId, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION),
      loadCollectionDocs<ProjectLabelSectionDoc>(projectId, PROJECT_LABEL_SECTIONS_SUBCOLLECTION),
      loadCollectionDocs<ProjectActivityLogDoc>(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION),
      getDoc(operationLockDoc(projectId)).catch(() => null),
    ]);

  const lockData = activeOp && 'exists' in activeOp && activeOp.exists()
    ? (activeOp.data() as ProjectOperationLockDoc)
    : null;

  return {
    meta,
    groups,
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
  fields: Partial<ProjectCollabMetaDoc> & Pick<ProjectCollabMetaDoc, 'migrationState' | 'datasetEpoch' | 'readMode'>,
): Promise<ProjectCollabMetaDoc> {
  const nextMeta: ProjectCollabMetaDoc = {
    schemaVersion: 2,
    migrationState: fields.migrationState,
    datasetEpoch: fields.datasetEpoch,
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
  await Promise.all([
    replaceSubcollectionDocs(projectId, PROJECT_GROUPS_SUBCOLLECTION, entities.groups),
    replaceSubcollectionDocs(projectId, PROJECT_BLOCKED_TOKENS_SUBCOLLECTION, entities.blockedTokens),
    replaceSubcollectionDocs(projectId, PROJECT_MANUAL_BLOCKED_KEYWORDS_SUBCOLLECTION, entities.manualBlockedKeywords),
    replaceSubcollectionDocs(projectId, PROJECT_TOKEN_MERGE_RULES_SUBCOLLECTION, entities.tokenMergeRules),
    replaceSubcollectionDocs(projectId, PROJECT_LABEL_SECTIONS_SUBCOLLECTION, entities.labelSections),
    replaceSubcollectionDocs(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, entities.activityLog),
  ]);

  await writeMetaDoc(projectId, actorId, {
    migrationState: 'complete',
    datasetEpoch,
    readMode: 'v2',
    lastMigratedAt: nowIso(),
    migrationOwnerClientId: null,
    migrationStartedAt: null,
    migrationHeartbeatAt: null,
    migrationExpiresAt: null,
    lastWriterClientId: actorId,
    revision: Math.max(entities.meta?.revision ?? 0, 0),
  });
}

export async function migrateLegacyProjectToV2(
  projectId: string,
  payload: ProjectDataPayload,
  actorId: string,
): Promise<CanonicalProjectState> {
  const datasetEpoch = Math.max(payload.lastSaveId ?? 1, 1);
  const leaseExpiresAt = new Date(Date.now() + OPERATION_TTL_MS).toISOString();

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
      lastMigratedAt: nowIso(),
      migrationOwnerClientId: actorId,
      migrationStartedAt: nowIso(),
      migrationHeartbeatAt: nowIso(),
      migrationExpiresAt: leaseExpiresAt,
      readMode: 'legacy',
      requiredClientSchema: CLIENT_SCHEMA_VERSION,
      lastWriterClientId: actorId,
      revision: (existing?.revision ?? 0) + 1,
      updatedAt: nowIso(),
      updatedByClientId: actorId,
      lastMutationId: createMutationId(actorId),
    }));
  });

  const base = buildBaseSnapshotFromResolvedPayload(payload);
  base.datasetEpoch = datasetEpoch;
  const entities = buildEntityStateFromResolvedPayload(payload, actorId, datasetEpoch);
  await saveBaseSnapshotToFirestore(projectId, base, { saveId: datasetEpoch, clientId: actorId });
  await replaceCollabEntities(projectId, entities, actorId, datasetEpoch);
  const meta = await writeMetaDoc(projectId, actorId, {
    migrationState: 'complete',
    datasetEpoch,
    readMode: 'v2',
    lastMigratedAt: nowIso(),
    migrationOwnerClientId: null,
    migrationStartedAt: null,
    migrationHeartbeatAt: null,
    migrationExpiresAt: null,
    requiredClientSchema: CLIENT_SCHEMA_VERSION,
    lastWriterClientId: actorId,
    revision: 1,
  });

  return {
    mode: 'v2',
    base,
    entities: { ...entities, meta, activeOperation: null },
    resolved: assembleCanonicalPayload(base, { ...entities, meta, activeOperation: null }),
  };
}

export async function loadCanonicalProjectState(
  projectId: string,
  actorId: string,
  legacyLoader: () => Promise<ProjectDataPayload | null>,
): Promise<CanonicalProjectState> {
  const meta = await loadCollabMeta(projectId);
  if (meta?.readMode === 'v2') {
    const [base, entities] = await Promise.all([
      loadBaseSnapshotFromFirestore(projectId),
      loadCollabEntitiesFromFirestore(projectId),
    ]);
    return {
      mode: 'v2',
      base,
      entities,
      resolved: assembleCanonicalPayload(base, entities),
    };
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
      const [base, entities] = await Promise.all([
        loadBaseSnapshotFromFirestore(projectId),
        loadCollabEntitiesFromFirestore(projectId),
      ]);
      const resolved = assembleCanonicalPayload(base, entities);
      if (resolved) {
        return { mode: 'v2', base, entities, resolved };
      }
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
    clusters: value.clusters,
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
): Promise<void> {
  for (const change of changes) {
    const ref = projectDoc(projectId, subcollection, change.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const currentRevision = snap.exists() ? ((snap.data() as { revision?: number }).revision ?? 0) : 0;
      if (currentRevision !== change.expectedRevision) {
        throw new Error(`conflict:${subcollection}:${change.id}`);
      }
      if (change.kind === 'delete') {
        tx.delete(ref);
        return;
      }
      const nextValue = {
        ...(change.value as object),
        revision: currentRevision + 1,
        updatedAt: nowIso(),
        updatedByClientId: actorId,
        lastMutationId: change.mutationId ?? null,
      };
      tx.set(ref, sanitizeJsonForFirestore(nextValue));
    });
  }
}

export async function appendActivityLogEntry(
  projectId: string,
  entry: ActivityLogEntry,
  actorId: string,
  datasetEpoch: number,
  mutationId?: string,
): Promise<void> {
  await setDoc(
    projectDoc(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, entry.id),
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
  const nextDocs = entries.map((entry) => ({
    ...entry,
    datasetEpoch,
    createdByClientId: actorId,
    mutationId: null,
  }));
  await replaceSubcollectionDocs(projectId, PROJECT_ACTIVITY_LOG_SUBCOLLECTION, nextDocs);
}

export async function deleteProjectV2Data(projectId: string): Promise<void> {
  await Promise.all([
    clearSubcollection(projectId, PROJECT_BASE_SUBCOLLECTION),
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
