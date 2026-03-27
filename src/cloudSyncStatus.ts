/**
 * Aggregated cloud sync signals for the app status bar — not a single onSnapshot.
 * - Listener health: success clears a channel; errors add it (Firestore error callback).
 * - Server reachability: any snapshot with metadata.fromCache === false.
 * - Project data writes: coalesced flush queue in useProjectPersistence (success/error).
 *
 * **Module singleton:** one in-memory store per tab (by design). Not React context so
 * Firestore callbacks can update without threading props. Subscribers re-render the status bar.
 */

import { WORKSPACE_FIRESTORE_DATABASE_ID } from './firestoreDbConfig';

const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

const listenerErrorChannels = new Set<string>();

/** True after any snapshot confirms a server round-trip (not cache-only). */
let serverReachable = false;

let projectFlushDepth = 0;

/** Set when the active project's Firestore save fails until the next successful save. */
let projectDataWriteFailed = false;

export function subscribeCloudSync(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export function resetServerReachOnBrowserOnline(): void {
  serverReachable = false;
  notify();
}

/**
 * Call from every Firestore listener success path with the snapshot (for metadata).
 * Clears this channel's error state.
 */
export function markListenerSnapshot(
  channel: string,
  snap: { metadata?: { fromCache?: boolean } } | null | undefined,
): void {
  if (snap?.metadata && snap.metadata.fromCache === false) {
    serverReachable = true;
  }
  listenerErrorChannels.delete(channel);
  notify();
}

/** Call from every Firestore listener error callback. */
export function markListenerError(channel: string): void {
  listenerErrorChannels.add(channel);
  notify();
}

/**
 * Clears a listener channel error when that subscription is torn down.
 * Prevents stale "sync problem" status from inactive listeners.
 */
export function clearListenerError(channel: string): void {
  if (!listenerErrorChannels.has(channel)) return;
  listenerErrorChannels.delete(channel);
  notify();
}

export function recordProjectFlushEnter(): void {
  projectFlushDepth += 1;
  notify();
}

export function recordProjectFlushExit(): void {
  projectFlushDepth = Math.max(0, projectFlushDepth - 1);
  notify();
}

export function recordProjectFirestoreSaveOk(): void {
  projectDataWriteFailed = false;
  notify();
}

export function recordProjectFirestoreSaveError(): void {
  projectDataWriteFailed = true;
  notify();
}

/** Call when switching projects so a prior failure does not stick to a new workspace. */
export function clearProjectPersistErrorFlag(): void {
  projectDataWriteFailed = false;
  notify();
}

/**
 * Vitest only — resets listener/error flags (not subscriber list). Keeps module state from
 * leaking across tests on the same worker. Do not call from app code.
 */
export function resetCloudSyncStateForTests(): void {
  listenerErrorChannels.clear();
  serverReachable = false;
  projectFlushDepth = 0;
  projectDataWriteFailed = false;
}

export type CloudSyncDerived = {
  serverReachable: boolean;
  listenerErrorCount: number;
  listenerErrors: readonly string[];
  projectFlushDepth: number;
  projectDataWriteFailed: boolean;
};

export function getCloudSyncSnapshot(): CloudSyncDerived {
  return {
    serverReachable,
    listenerErrorCount: listenerErrorChannels.size,
    listenerErrors: [...listenerErrorChannels].sort(),
    projectFlushDepth,
    projectDataWriteFailed,
  };
}

export type CloudStatusTone = 'muted' | 'amber' | 'emerald' | 'rose';

export type CloudStatusLine = {
  label: string;
  tone: CloudStatusTone;
};

/**
 * Single user-facing line. Priority: offline → listener errors → project save error →
 * flushing queue → connecting (no server snapshot yet) → synced.
 */
export function deriveCloudStatusLine(
  browserOnline: boolean,
  snap: CloudSyncDerived,
  hasActiveProject: boolean,
): CloudStatusLine {
  if (!browserOnline) {
    return { label: 'Offline — saved locally', tone: 'amber' };
  }
  if (snap.listenerErrorCount > 0) {
    return { label: 'Sync problem — retry', tone: 'rose' };
  }
  if (hasActiveProject && snap.projectDataWriteFailed) {
    return { label: 'Sync problem — retry', tone: 'rose' };
  }
  if (snap.projectFlushDepth > 0) {
    return { label: 'Syncing…', tone: 'amber' };
  }
  if (!snap.serverReachable) {
    return { label: 'Connecting…', tone: 'amber' };
  }
  return { label: 'Cloud: synced', tone: 'emerald' };
}

/**
 * Multi-line diagnostic copy for the status tooltip (`InlineHelpHint` / `whitespace-pre-wrap`).
 */
export function formatCloudStatusDetailText(
  browserOnline: boolean,
  snap: CloudSyncDerived,
  hasActiveProject: boolean,
  activeProjectId: string | null,
): string {
  const lines: string[] = [
    'Connection diagnostics (this browser only)',
    '—',
    `Network: ${browserOnline ? 'Online' : 'Offline'}`,
    `Firestore database: ${WORKSPACE_FIRESTORE_DATABASE_ID}`,
    `Server data path: ${snap.serverReachable ? 'Yes — at least one snapshot from the server (not cache-only)' : 'Not yet — waiting for server or using offline cache'}`,
    `Project workspace: ${hasActiveProject ? (activeProjectId ? `Open — ${activeProjectId}` : 'Open') : 'None selected'}`,
    `Project cloud save queue: ${snap.projectFlushDepth > 0 ? `Writing (${snap.projectFlushDepth} flush active)` : 'Idle'}`,
    `Latest project Firestore save: ${!hasActiveProject ? '—' : snap.projectDataWriteFailed ? 'Last attempt failed — retry when online' : 'Succeeded'}`,
  ];
  if (snap.listenerErrors.length > 0) {
    lines.push(`Listener channels in error (${snap.listenerErrors.length}): ${snap.listenerErrors.join(', ')}`);
  } else {
    lines.push('Listener channels: no errors on active subscriptions');
  }
  lines.push('—');
  lines.push(
    'Details update live. Hover, focus, or tap — open Feedback, Generate, etc. to activate more listener channels.',
  );
  return lines.join('\n');
}
