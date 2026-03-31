/**
 * collabV2Cache.ts — V2 canonical cache entries in IndexedDB.
 *
 * Manages reading, writing, validating, and migrating IDB cache entries
 * for V2 collaboration projects. Ensures pre-metadata (legacy) IDB blobs
 * never seed canonical V2 state without explicit migration.
 */

import type { ProjectV2CacheMetadata } from './collabV2Types';
import type { ProjectDataPayload } from './projectStorage';
import { saveToIDB, loadFromIDB, deleteFromIDB } from './projectStorage';

// ─── Cache entry shape ───

export interface ProjectCanonicalCacheEntry {
  /** Always present for V2 entries */
  schemaVersion: number;
  datasetEpoch: number;
  baseCommitId: string;
  cachedAt: string;
  /** The actual payload data */
  payload: ProjectDataPayload;
}

// ─── Required metadata fields for V2 cache validation ───

const REQUIRED_V2_CACHE_FIELDS = ['schemaVersion', 'datasetEpoch', 'baseCommitId', 'cachedAt'] as const;

/**
 * Validate that a cache entry has all required V2 identity metadata.
 * Rejects pre-metadata IDB blobs that could seed stale V2 state.
 */
export function isValidV2CacheEntry(entry: unknown): entry is ProjectCanonicalCacheEntry {
  if (!entry || typeof entry !== 'object') return false;
  const obj = entry as Record<string, unknown>;
  for (const field of REQUIRED_V2_CACHE_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) return false;
  }
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion < 2) return false;
  if (typeof obj.datasetEpoch !== 'number' || obj.datasetEpoch < 1) return false;
  if (typeof obj.baseCommitId !== 'string' || obj.baseCommitId.length === 0) return false;
  if (typeof obj.cachedAt !== 'string') return false;
  if (!obj.payload || typeof obj.payload !== 'object') return false;
  return true;
}

/**
 * Determine if a raw IDB entry is a legacy (pre-V2) cache shape.
 * Legacy entries lack schemaVersion/datasetEpoch/baseCommitId/cachedAt.
 */
export function isLegacyCacheEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const obj = entry as Record<string, unknown>;
  // Legacy entries have direct payload fields (results, clusterSummary, etc.) without wrapper
  return (
    !('schemaVersion' in obj) &&
    ('results' in obj || 'clusterSummary' in obj || 'groupedClusters' in obj)
  );
}

/**
 * Check if a V2 cache entry matches the expected meta (epoch + commitId).
 * Used during bootstrap to decide if the cache is usable.
 */
export function cacheMatchesMeta(
  entry: ProjectCanonicalCacheEntry,
  expectedEpoch: number,
  expectedCommitId: string,
): boolean {
  return entry.datasetEpoch === expectedEpoch && entry.baseCommitId === expectedCommitId;
}

/** IDB key for V2 canonical cache entries. */
function v2CacheKey(projectId: string): string {
  return `v2_${projectId}`;
}

/**
 * Save a canonical V2 cache entry to IDB.
 * Wraps the payload with required metadata.
 */
export async function saveCanonicalCacheToIDB(
  projectId: string,
  payload: ProjectDataPayload,
  meta: ProjectV2CacheMetadata,
): Promise<void> {
  const entry: ProjectCanonicalCacheEntry = {
    schemaVersion: meta.schemaVersion,
    datasetEpoch: meta.datasetEpoch,
    baseCommitId: meta.baseCommitId,
    cachedAt: meta.cachedAt,
    payload,
  };
  await saveToIDB(v2CacheKey(projectId), entry);
}

/**
 * Load and validate a canonical V2 cache entry from IDB.
 * Returns null if:
 * - No entry exists
 * - Entry is legacy (pre-V2) — invalidated
 * - Entry is missing required V2 identity fields
 */
export async function loadCanonicalCacheFromIDB(
  projectId: string,
): Promise<ProjectCanonicalCacheEntry | null> {
  const raw = await loadFromIDB<unknown>(v2CacheKey(projectId));
  if (!raw) return null;
  if (!isValidV2CacheEntry(raw)) return null;
  return raw;
}

/**
 * Invalidate (delete) the V2 canonical cache for a project.
 * Used when cache is stale or during migration.
 */
export async function invalidateCanonicalCache(projectId: string): Promise<void> {
  await deleteFromIDB(v2CacheKey(projectId));
}

/**
 * Migrate a legacy cache entry to V2 format or invalidate it.
 * If the legacy entry has data and a V2 meta is provided, wraps it.
 * Otherwise, invalidates the cache so V2 bootstrap loads from Firestore.
 *
 * Returns the migrated entry or null (if invalidated).
 */
export async function migrateOrInvalidateLegacyCache(
  projectId: string,
  v2Meta?: { epoch: number; commitId: string } | null,
): Promise<ProjectCanonicalCacheEntry | null> {
  // 1. Load raw entry from IDB (the old key is just projectId)
  const raw = await loadFromIDB<unknown>(projectId);

  // 2. If already a valid V2 entry, return as-is
  if (isValidV2CacheEntry(raw)) {
    return raw;
  }

  // 3. If legacy entry with v2Meta provided, wrap in V2 envelope
  if (isLegacyCacheEntry(raw) && v2Meta) {
    const legacyPayload = raw as ProjectDataPayload;
    const now = new Date().toISOString();
    const entry: ProjectCanonicalCacheEntry = {
      schemaVersion: 2,
      datasetEpoch: v2Meta.epoch,
      baseCommitId: v2Meta.commitId,
      cachedAt: now,
      payload: legacyPayload,
    };
    // Save to V2 key
    await saveToIDB(v2CacheKey(projectId), entry);
    // Clean up legacy key
    await deleteFromIDB(projectId);
    return entry;
  }

  // 4. Otherwise, invalidate both old and new keys
  await deleteFromIDB(projectId);
  await deleteFromIDB(v2CacheKey(projectId));
  return null;
}

/**
 * Bootstrap the canonical cache for a V2 project.
 * Priority: V2 cache hit -> legacy migration -> null (requires Firestore load).
 *
 * IMPORTANT: Never let pre-metadata IDB blobs seed canonical V2 state.
 * If allowLegacyFallback is false (default), legacy entries are invalidated, not used.
 */
export async function bootstrapV2Cache(
  projectId: string,
  expectedEpoch: number,
  expectedCommitId: string,
  opts?: { allowLegacyFallback?: boolean },
): Promise<{ entry: ProjectCanonicalCacheEntry | null; source: 'v2-cache' | 'legacy-migrated' | 'miss' }> {
  const allowLegacy = opts?.allowLegacyFallback ?? false;

  // 1. Try loading a V2 canonical cache entry
  const v2Entry = await loadCanonicalCacheFromIDB(projectId);

  if (v2Entry) {
    // 2. Valid and matches meta -> cache hit
    if (cacheMatchesMeta(v2Entry, expectedEpoch, expectedCommitId)) {
      return { entry: v2Entry, source: 'v2-cache' };
    }
    // 3. Valid but wrong epoch/commitId -> stale, invalidate
    await invalidateCanonicalCache(projectId);
  }

  // 4. No usable V2 entry, check legacy
  const meta = allowLegacy ? { epoch: expectedEpoch, commitId: expectedCommitId } : null;
  const migrated = await migrateOrInvalidateLegacyCache(projectId, meta);

  // 5. If legacy migration succeeded and allowed, return it
  if (migrated && allowLegacy) {
    return { entry: migrated, source: 'legacy-migrated' };
  }

  // 6. Cache miss — caller must load from Firestore
  return { entry: null, source: 'miss' };
}
