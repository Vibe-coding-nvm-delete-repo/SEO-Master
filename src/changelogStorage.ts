/**
 * Firestore persistence for the Updates / Changelog tab.
 *
 * Two concerns:
 *  1. `changelog` collection — one doc per update entry (addDoc, real-time listener).
 *  2. `app_settings/build_info` doc — current build name string.
 *
 * Follows the feedbackStorage.ts pattern: onSnapshot → markListenerSnapshot/Error,
 * IDB cache for fast reload, React callback for state.
 */

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
} from './cloudSyncStatus';
import {
  addQaChangelogEntry,
  isContentPipelineQaMode,
  subscribeQaBuildName,
  subscribeQaChangelog,
  updateQaBuildName,
} from './qa/contentPipelineQaRuntime';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangelogEntry {
  id: string;
  buildName: string;
  timestamp: string;
  summary: string;
  changes: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANGELOG_COLLECTION = 'changelog';
const BUILD_INFO_DOC_PATH = 'app_settings/build_info';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(t: unknown): string {
  if (t == null) return new Date().toISOString();
  if (typeof t === 'string') return t;
  if (
    typeof t === 'object' &&
    t !== null &&
    'toDate' in t &&
    typeof (t as { toDate: () => Date }).toDate === 'function'
  ) {
    return (t as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof t === 'object' && t !== null && 'seconds' in t) {
    return new Date((t as { seconds: number }).seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function mapDoc(id: string, data: Record<string, unknown>): ChangelogEntry {
  return {
    id,
    buildName: typeof data.buildName === 'string' ? data.buildName : '',
    timestamp: toIso(data.timestamp),
    summary: typeof data.summary === 'string' ? data.summary : '',
    changes: Array.isArray(data.changes)
      ? (data.changes as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Add a new changelog entry. Called by Claude after each code-change session. */
export async function addChangelogEntry(entry: Omit<ChangelogEntry, 'id'>): Promise<string> {
  if (isContentPipelineQaMode()) {
    return addQaChangelogEntry(entry);
  }
  const docRef = await addDoc(collection(db, CHANGELOG_COLLECTION), {
    buildName: entry.buildName,
    timestamp: entry.timestamp || new Date().toISOString(),
    summary: entry.summary,
    changes: entry.changes,
  });
  return docRef.id;
}

/** Update the current build name shown in the Updates tab header. */
export async function updateCurrentBuildName(name: string): Promise<void> {
  if (isContentPipelineQaMode()) {
    await updateQaBuildName(name);
    return;
  }
  await setDoc(doc(db, BUILD_INFO_DOC_PATH), { name, updatedAt: new Date().toISOString() }, { merge: true });
}

// ---------------------------------------------------------------------------
// Subscribe (real-time)
// ---------------------------------------------------------------------------

/** Live subscription to all changelog entries, newest first. */
export function subscribeChangelog(
  onEntries: (entries: ChangelogEntry[]) => void,
): () => void {
  if (isContentPipelineQaMode()) {
    return subscribeQaChangelog((entries) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.changelog, { docs: [] } as any);
      onEntries(entries);
    });
  }
  const q = query(collection(db, CHANGELOG_COLLECTION), orderBy('timestamp', 'desc'));
  const unsub = onSnapshot(
    q,
    (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.changelog, snap);
      const entries = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
      onEntries(entries);
    },
    (err) => {
      markListenerError(CLOUD_SYNC_CHANNELS.changelog);
      console.warn('Changelog snapshot error:', err);
    },
  );
  return () => {
    clearListenerError(CLOUD_SYNC_CHANNELS.changelog);
    unsub();
  };
}

/** Live subscription to the current build name. */
export function subscribeBuildName(
  onName: (name: string) => void,
): () => void {
  if (isContentPipelineQaMode()) {
    return subscribeQaBuildName((name) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.buildInfo, { exists: () => Boolean(name) } as any);
      onName(name);
    });
  }
  const unsub = onSnapshot(
    doc(db, BUILD_INFO_DOC_PATH),
    (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.buildInfo, snap);
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        onName(typeof data.name === 'string' ? data.name : '');
      } else {
        onName('');
      }
    },
    (err) => {
      markListenerError(CLOUD_SYNC_CHANNELS.buildInfo);
      console.warn('Build info snapshot error:', err);
    },
  );
  return () => {
    clearListenerError(CLOUD_SYNC_CHANNELS.buildInfo);
    unsub();
  };
}
