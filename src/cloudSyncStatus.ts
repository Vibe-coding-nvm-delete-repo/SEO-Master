/**
 * Aggregated cloud sync signals for the app status bar.
 *
 * The status chip is project-first when a project is open, but the tooltip also
 * reports shared-doc and auxiliary listener health for this tab.
 */

import { WORKSPACE_FIRESTORE_DATABASE_ID } from './firestoreDbConfig';
import { beginRuntimeTrace, traceRuntimeEvent } from './runtimeTrace';
import type { SharedChannelKind, SharedScope } from './sharedCollaboration';
import type { SharedMutationResult } from './sharedMutation';

const subscribers = new Set<() => void>();

/**
 * Microtask-coalesced notify. Multiple rapid state changes (for example local
 * durability start → ok or a burst of listener updates) collapse into one
 * subscriber flush so the status bar does not thrash.
 */
let notifyQueued = false;

function flushNotify(): void {
  notifyQueued = false;
  subscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function notify(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(flushNotify);
}

function markStateChanged(): void {
  revision += 1;
  notify();
}

export type CloudSyncChannelDomain = 'project' | 'shared' | 'auxiliary';
export type CloudSyncChannelHeadline = 'critical' | 'auxiliary';
export type CloudSyncReachabilityScope = 'project' | 'shared' | 'auxiliary';

export type CloudSyncChannelId =
  | 'project_chunks'
  | 'projects'
  | 'project_folders'
  | 'user_preferences'
  | 'starred_models'
  | 'universal_blocked'
  | 'feedback'
  | 'notifications'
  | 'changelog'
  | 'build_info'
  | 'group_review_settings'
  | 'autogroup_settings'
  | 'topics_loans'
  | `cosine:${string}`
  | `overview:${string}`
  | `final-pages:${string}`
  | `content-tab:${string}`
  | `app-settings-rows:${string}`
  | `app-settings-logs:${string}`
  | `app-settings-settings:${string}`
  | `shared-selected-model:${string}`
  | `upstream:${string}`
  | `pipeline-settings:${string}`;

export type AppSettingsChannelKind =
  | 'cosine'
  | 'overview'
  | 'final-pages'
  | 'content-tab'
  | 'rows'
  | 'logs'
  | 'settings'
  | 'shared-selected-model'
  | 'upstream'
  | 'pipeline-settings';

export type CloudSyncChannel = {
  id: CloudSyncChannelId;
  label: string;
  domain: CloudSyncChannelDomain;
  headline: CloudSyncChannelHeadline;
  reachability: CloudSyncReachabilityScope;
};

type StaticChannelId = Exclude<CloudSyncChannelId, `${string}:${string}`>;

const STATIC_CHANNELS: Record<StaticChannelId, Omit<CloudSyncChannel, 'id'>> = {
  project_chunks: {
    label: 'Project workspace',
    domain: 'project',
    headline: 'critical',
    reachability: 'project',
  },
  projects: {
    label: 'Projects list',
    domain: 'shared',
    headline: 'critical',
    reachability: 'shared',
  },
  project_folders: {
    label: 'Project folders',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  user_preferences: {
    label: 'User preferences',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  starred_models: {
    label: 'Starred models',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  universal_blocked: {
    label: 'Universal blocked tokens',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  feedback: {
    label: 'Feedback',
    domain: 'auxiliary',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  notifications: {
    label: 'Notifications',
    domain: 'auxiliary',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  changelog: {
    label: 'Changelog',
    domain: 'auxiliary',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  build_info: {
    label: 'Build info',
    domain: 'auxiliary',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  group_review_settings: {
    label: 'Group Review settings',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  autogroup_settings: {
    label: 'Auto Group settings',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
  topics_loans: {
    label: 'Topics library',
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  },
};

export const CLOUD_SYNC_CHANNELS = {
  projectChunks: 'project_chunks',
  projects: 'projects',
  projectFolders: 'project_folders',
  userPreferences: 'user_preferences',
  starredModels: 'starred_models',
  universalBlocked: 'universal_blocked',
  feedback: 'feedback',
  notifications: 'notifications',
  changelog: 'changelog',
  buildInfo: 'build_info',
  groupReviewSettings: 'group_review_settings',
  autoGroupSettings: 'autogroup_settings',
  topicsLoans: 'topics_loans',
} as const satisfies Record<string, StaticChannelId>;

export function makeAppSettingsChannel(kind: AppSettingsChannelKind, docId: string): CloudSyncChannelId {
  switch (kind) {
    case 'cosine':
      return `cosine:${docId}`;
    case 'overview':
      return `overview:${docId}`;
    case 'final-pages':
      return `final-pages:${docId}`;
    case 'content-tab':
      return `content-tab:${docId}`;
    case 'rows':
      return `app-settings-rows:${docId}`;
    case 'logs':
      return `app-settings-logs:${docId}`;
    case 'settings':
      return `app-settings-settings:${docId}`;
    case 'shared-selected-model':
      return `shared-selected-model:${docId}`;
    case 'upstream':
      return `upstream:${docId}`;
    case 'pipeline-settings':
      return `pipeline-settings:${docId}`;
  }
}

export function resolveCloudSyncChannel(id: CloudSyncChannelId): CloudSyncChannel {
  if (id in STATIC_CHANNELS) {
    return { id, ...STATIC_CHANNELS[id as StaticChannelId] };
  }
  if (id.startsWith('cosine:')) {
    const docId = id.slice('cosine:'.length);
    return {
      id,
      label: `Cosine summary cache (${docId})`,
      domain: 'shared',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('overview:')) {
    const docId = id.slice('overview:'.length);
    return {
      id,
      label: `Overview input (${docId})`,
      domain: 'auxiliary',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('final-pages:')) {
    const docId = id.slice('final-pages:'.length);
    return {
      id,
      label: `Final Pages input (${docId})`,
      domain: 'auxiliary',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('content-tab:')) {
    const docId = id.slice('content-tab:'.length);
    return {
      id,
      label: `Content tab (${docId})`,
      domain: 'auxiliary',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('app-settings-rows:')) {
    const docId = id.slice('app-settings-rows:'.length);
    return {
      id,
      label: `Rows doc (${docId})`,
      domain: 'shared',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('app-settings-logs:')) {
    const docId = id.slice('app-settings-logs:'.length);
    return {
      id,
      label: `Logs doc (${docId})`,
      domain: 'shared',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('app-settings-settings:')) {
    const docId = id.slice('app-settings-settings:'.length);
    return {
      id,
      label: `Settings doc (${docId})`,
      domain: 'shared',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('shared-selected-model:')) {
    const docId = id.slice('shared-selected-model:'.length);
    return {
      id,
      label: `Shared selected model (${docId})`,
      domain: 'shared',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  if (id.startsWith('upstream:')) {
    const docId = id.slice('upstream:'.length);
    return {
      id,
      label: `Upstream pipeline (${docId})`,
      domain: 'shared',
      headline: 'auxiliary',
      reachability: 'auxiliary',
    };
  }
  const docId = id.slice('pipeline-settings:'.length);
  return {
    id,
    label: `Pipeline settings (${docId})`,
    domain: 'shared',
    headline: 'auxiliary',
    reachability: 'auxiliary',
  };
}

const listenerErrorChannels = new Set<CloudSyncChannelId>();
const collaborationChannelHealth = new Map<string, CollaborationChannelHealth>();

let revision = 0;
let projectServerReachable = false;
let sharedServerReachable = false;
let auxiliaryServerReachable = false;

let projectFlushDepth = 0;
let projectCloudWritePendingCount = 0;
let projectDataWriteFailed = false;
let projectLastCloudWriteOkAtMs: number | null = null;

let sharedCloudWritePendingCount = 0;
let sharedDocWriteFailed = false;
let sharedLastCloudWriteOkAtMs: number | null = null;

let localWritePendingCount = 0;
let localWriteFailed = false;
let localLastWriteOkAtMs: number | null = null;

export type CollaborationChannelHealth = {
  actionId: string;
  label: string;
  scope: SharedScope;
  channelKind: SharedChannelKind;
  storageChannel: string;
  lastAcceptedWriteAtMs: number | null;
  lastListenerApplyAtMs: number | null;
  lastBlockedReason: string | null;
  lastFailedReason: string | null;
};

function ensureCollaborationChannelHealth(seed: {
  actionId: string;
  label: string;
  scope: SharedScope;
  channelKind: SharedChannelKind;
  storageChannel: string;
}): CollaborationChannelHealth {
  const existing = collaborationChannelHealth.get(seed.actionId);
  if (existing) return existing;
  const next: CollaborationChannelHealth = {
    ...seed,
    lastAcceptedWriteAtMs: null,
    lastListenerApplyAtMs: null,
    lastBlockedReason: null,
    lastFailedReason: null,
  };
  collaborationChannelHealth.set(seed.actionId, next);
  return next;
}

function sortChannels(channels: readonly CloudSyncChannel[]): readonly CloudSyncChannel[] {
  return [...channels].sort((a, b) => a.label.localeCompare(b.label));
}

function primaryCloudBusyForProject(): boolean {
  return projectFlushDepth > 0 || projectCloudWritePendingCount > 0;
}

export function subscribeCloudSync(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export function resetServerReachOnBrowserOnline(): void {
  if (!projectServerReachable && !sharedServerReachable && !auxiliaryServerReachable) return;
  projectServerReachable = false;
  sharedServerReachable = false;
  auxiliaryServerReachable = false;
  markStateChanged();
}

/**
 * Call from every Firestore listener success path with the snapshot metadata.
 * Any successful snapshot also clears that channel's error state.
 */
export function markListenerSnapshot(
  channelId: CloudSyncChannelId,
  snap: { metadata?: { fromCache?: boolean } } | null | undefined,
): void {
  const channel = resolveCloudSyncChannel(channelId);
  let changed = listenerErrorChannels.delete(channel.id);
  if (snap?.metadata?.fromCache === false) {
    if (channel.reachability === 'project' && !projectServerReachable) {
      projectServerReachable = true;
      changed = true;
    } else if (channel.reachability === 'shared' && !sharedServerReachable) {
      sharedServerReachable = true;
      changed = true;
    } else if (channel.reachability === 'auxiliary' && !auxiliaryServerReachable) {
      auxiliaryServerReachable = true;
      changed = true;
    }
  }
  if (changed) markStateChanged();
}

export function markListenerError(channelId: CloudSyncChannelId): void {
  if (listenerErrorChannels.has(channelId)) return;
  listenerErrorChannels.add(channelId);
  markStateChanged();
}

export function clearListenerError(channelId: CloudSyncChannelId): void {
  if (!listenerErrorChannels.has(channelId)) return;
  listenerErrorChannels.delete(channelId);
  markStateChanged();
}

export function recordProjectFlushEnter(): void {
  projectFlushDepth += 1;
  markStateChanged();
}

export function recordProjectFlushExit(): void {
  const next = Math.max(0, projectFlushDepth - 1);
  if (next === projectFlushDepth) return;
  projectFlushDepth = next;
  markStateChanged();
}

type LocalPersistTraceContext = {
  traceId?: string;
  source?: string;
  data?: Record<string, unknown>;
};

export function recordLocalPersistStart(trace?: LocalPersistTraceContext): void {
  localWritePendingCount += 1;
  const source = trace?.source ?? 'cloudSyncStatus.recordLocalPersistStart';
  const traceId = trace?.traceId ?? beginRuntimeTrace(source);
  traceRuntimeEvent({
    traceId,
    event: 'local-persist:pending-increment',
    source,
    data: { localWritePendingCount, ...(trace?.data ?? {}) },
  });
  markStateChanged();
}

export function recordLocalPersistOk(options?: { decrementPending?: boolean; trace?: LocalPersistTraceContext }): void {
  const decrementPending = options?.decrementPending ?? true;
  const now = Date.now();
  let changed = false;
  if (decrementPending) {
    const next = Math.max(0, localWritePendingCount - 1);
    if (next !== localWritePendingCount) {
      localWritePendingCount = next;
      changed = true;
    }
  }
  if (localWriteFailed) {
    localWriteFailed = false;
    changed = true;
  }
  if (localLastWriteOkAtMs !== now) {
    localLastWriteOkAtMs = now;
    changed = true;
  }
  if (changed) markStateChanged();
  const source = options?.trace?.source ?? 'cloudSyncStatus.recordLocalPersistOk';
  const traceId = options?.trace?.traceId ?? beginRuntimeTrace(source);
  traceRuntimeEvent({
    traceId,
    event: 'local-persist:pending-decrement-success',
    source,
    data: { decrementPending, localWritePendingCount, localWriteFailed, ...(options?.trace?.data ?? {}) },
  });
}

export function recordLocalPersistError(options?: { decrementPending?: boolean; trace?: LocalPersistTraceContext }): void {
  const decrementPending = options?.decrementPending ?? true;
  let changed = false;
  if (decrementPending) {
    const next = Math.max(0, localWritePendingCount - 1);
    if (next !== localWritePendingCount) {
      localWritePendingCount = next;
      changed = true;
    }
  }
  if (!localWriteFailed) {
    localWriteFailed = true;
    changed = true;
  }
  if (changed) markStateChanged();
  const source = options?.trace?.source ?? 'cloudSyncStatus.recordLocalPersistError';
  const traceId = options?.trace?.traceId ?? beginRuntimeTrace(source);
  traceRuntimeEvent({
    traceId,
    event: 'local-persist:pending-decrement-error',
    source,
    data: { decrementPending, localWritePendingCount, localWriteFailed, ...(options?.trace?.data ?? {}) },
  });
}

export function recordProjectCloudWriteStart(): void {
  projectCloudWritePendingCount += 1;
  markStateChanged();
}

export function recordProjectFirestoreSaveOk(): void {
  const next = Math.max(0, projectCloudWritePendingCount - 1);
  const now = Date.now();
  let changed = false;
  if (next !== projectCloudWritePendingCount) {
    projectCloudWritePendingCount = next;
    changed = true;
  }
  if (projectDataWriteFailed) {
    projectDataWriteFailed = false;
    changed = true;
  }
  if (projectLastCloudWriteOkAtMs !== now) {
    projectLastCloudWriteOkAtMs = now;
    changed = true;
  }
  if (changed) markStateChanged();
}

export function recordProjectFirestoreSaveError(): void {
  const next = Math.max(0, projectCloudWritePendingCount - 1);
  let changed = false;
  if (next !== projectCloudWritePendingCount) {
    projectCloudWritePendingCount = next;
    changed = true;
  }
  if (!projectDataWriteFailed) {
    projectDataWriteFailed = true;
    changed = true;
  }
  if (changed) markStateChanged();
}

export function recordSharedCloudWriteStart(): void {
  sharedCloudWritePendingCount += 1;
  markStateChanged();
}

export function recordSharedCloudWriteOk(): void {
  const next = Math.max(0, sharedCloudWritePendingCount - 1);
  const now = Date.now();
  let changed = false;
  if (next !== sharedCloudWritePendingCount) {
    sharedCloudWritePendingCount = next;
    changed = true;
  }
  if (sharedDocWriteFailed) {
    sharedDocWriteFailed = false;
    changed = true;
  }
  if (sharedLastCloudWriteOkAtMs !== now) {
    sharedLastCloudWriteOkAtMs = now;
    changed = true;
  }
  if (changed) markStateChanged();
}

export function recordSharedCloudWriteError(): void {
  const next = Math.max(0, sharedCloudWritePendingCount - 1);
  let changed = false;
  if (next !== sharedCloudWritePendingCount) {
    sharedCloudWritePendingCount = next;
    changed = true;
  }
  if (!sharedDocWriteFailed) {
    sharedDocWriteFailed = true;
    changed = true;
  }
  if (changed) markStateChanged();
}

export function recordCollaborationMutationResult(args: {
  actionId: string;
  label: string;
  scope: SharedScope;
  channelKind: SharedChannelKind;
  storageChannel: string;
  result: SharedMutationResult;
}): void {
  const channel = ensureCollaborationChannelHealth(args);
  let changed = false;
  if (args.result.status === 'accepted') {
    const now = Date.now();
    if (channel.lastAcceptedWriteAtMs !== now) {
      channel.lastAcceptedWriteAtMs = now;
      changed = true;
    }
    if (channel.lastBlockedReason !== null) {
      channel.lastBlockedReason = null;
      changed = true;
    }
    if (channel.lastFailedReason !== null) {
      channel.lastFailedReason = null;
      changed = true;
    }
  } else if (args.result.status === 'blocked') {
    if (channel.lastBlockedReason !== args.result.reason) {
      channel.lastBlockedReason = args.result.reason;
      changed = true;
    }
  } else if (channel.lastFailedReason !== args.result.reason) {
    channel.lastFailedReason = args.result.reason;
    changed = true;
  }
  if (changed) markStateChanged();
}

export function recordCollaborationListenerApply(args: {
  actionId: string;
  label: string;
  scope: SharedScope;
  channelKind: SharedChannelKind;
  storageChannel: string;
}): void {
  const channel = ensureCollaborationChannelHealth(args);
  const now = Date.now();
  if (channel.lastListenerApplyAtMs === now) return;
  channel.lastListenerApplyAtMs = now;
  markStateChanged();
}

export function getCollaborationHealthSnapshot(): readonly CollaborationChannelHealth[] {
  return [...collaborationChannelHealth.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Call when switching projects so a prior failure does not stick to a new workspace. */
export function clearProjectPersistErrorFlag(): void {
  if (!projectDataWriteFailed) return;
  projectDataWriteFailed = false;
  markStateChanged();
}

export function resetCloudSyncStateForTests(): void {
  listenerErrorChannels.clear();
  collaborationChannelHealth.clear();
  revision = 0;
  projectServerReachable = false;
  sharedServerReachable = false;
  auxiliaryServerReachable = false;
  projectFlushDepth = 0;
  projectCloudWritePendingCount = 0;
  projectDataWriteFailed = false;
  projectLastCloudWriteOkAtMs = null;
  sharedCloudWritePendingCount = 0;
  sharedDocWriteFailed = false;
  sharedLastCloudWriteOkAtMs = null;
  localWritePendingCount = 0;
  localWriteFailed = false;
  localLastWriteOkAtMs = null;
  notifyQueued = false;
}

/** Read-only probe for recovery timers — true when the last IDB write failed. */
export function isLocalWriteFailed(): boolean {
  return localWriteFailed;
}

export type CloudSyncDerived = {
  revision: number;
  local: {
    pendingCount: number;
    failed: boolean;
    lastWriteOkAtMs: number | null;
  };
  project: {
    flushDepth: number;
    cloudWritePendingCount: number;
    writeFailed: boolean;
    lastCloudWriteOkAtMs: number | null;
    serverReachable: boolean;
    listenerErrors: readonly CloudSyncChannel[];
    criticalListenerErrors: readonly CloudSyncChannel[];
  };
  shared: {
    cloudWritePendingCount: number;
    writeFailed: boolean;
    lastCloudWriteOkAtMs: number | null;
    serverReachable: boolean;
    listenerErrors: readonly CloudSyncChannel[];
    criticalListenerErrors: readonly CloudSyncChannel[];
  };
  auxiliary: {
    serverReachable: boolean;
    listenerErrors: readonly CloudSyncChannel[];
  };
  listeners: {
    allErrors: readonly CloudSyncChannel[];
    criticalErrors: readonly CloudSyncChannel[];
    auxiliaryErrors: readonly CloudSyncChannel[];
  };
  unsafeToRefresh: boolean;
};

export function getCloudSyncSnapshot(): CloudSyncDerived {
  const allErrors = sortChannels([...listenerErrorChannels].map(resolveCloudSyncChannel));
  const criticalErrors = sortChannels(allErrors.filter((channel) => channel.headline === 'critical'));
  const auxiliaryErrors = sortChannels(allErrors.filter((channel) => channel.headline === 'auxiliary'));
  const projectErrors = sortChannels(allErrors.filter((channel) => channel.domain === 'project'));
  const sharedErrors = sortChannels(allErrors.filter((channel) => channel.domain === 'shared'));

  return {
    revision,
    local: {
      pendingCount: localWritePendingCount,
      failed: localWriteFailed,
      lastWriteOkAtMs: localLastWriteOkAtMs,
    },
    project: {
      flushDepth: projectFlushDepth,
      cloudWritePendingCount: projectCloudWritePendingCount,
      writeFailed: projectDataWriteFailed,
      lastCloudWriteOkAtMs: projectLastCloudWriteOkAtMs,
      serverReachable: projectServerReachable,
      listenerErrors: projectErrors,
      criticalListenerErrors: sortChannels(projectErrors.filter((channel) => channel.headline === 'critical')),
    },
    shared: {
      cloudWritePendingCount: sharedCloudWritePendingCount,
      writeFailed: sharedDocWriteFailed,
      lastCloudWriteOkAtMs: sharedLastCloudWriteOkAtMs,
      serverReachable: sharedServerReachable,
      listenerErrors: sharedErrors,
      criticalListenerErrors: sortChannels(sharedErrors.filter((channel) => channel.headline === 'critical')),
    },
    auxiliary: {
      serverReachable: auxiliaryServerReachable,
      listenerErrors: auxiliaryErrors,
    },
    listeners: {
      allErrors,
      criticalErrors,
      auxiliaryErrors,
    },
    unsafeToRefresh: localWritePendingCount > 0,
  };
}

export type CloudStatusTone = 'muted' | 'amber' | 'emerald' | 'rose';

export type CloudStatusLine = {
  label: string;
  tone: CloudStatusTone;
  detail?: string;
};

export type DeriveCloudStatusOptions = {
  /**
   * Lets the status bar apply hysteresis so very short start/stop write bursts
   * do not flicker the primary status line.
   */
  primaryPipelineAppearsBusy?: boolean;
};

const LAST_WRITE_CLOCK_OPTS: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
};

export function formatLastFirestoreWriteClock(lastMs: number | null): string | undefined {
  if (lastMs == null || !Number.isFinite(lastMs)) return undefined;
  return new Date(lastMs).toLocaleTimeString(undefined, LAST_WRITE_CLOCK_OPTS);
}

function detailLastOk(lastMs: number | null, prefix: string): string | undefined {
  const clock = formatLastFirestoreWriteClock(lastMs);
  return clock ? `${prefix}${clock}` : undefined;
}

export function deriveCloudStatusLine(
  browserOnline: boolean,
  snap: CloudSyncDerived,
  hasActiveProject: boolean,
  options?: DeriveCloudStatusOptions,
): CloudStatusLine {
  if (snap.local.failed) {
    return { label: 'Save failed — local data at risk', tone: 'rose' };
  }
  if (snap.local.pendingCount > 0) {
    return { label: 'Saving… don’t refresh', tone: 'amber' };
  }

  const primaryLastCloudOkAtMs = hasActiveProject
    ? snap.project.lastCloudWriteOkAtMs
    : snap.shared.lastCloudWriteOkAtMs;

  if (!browserOnline) {
    return {
      label: 'Offline — saved locally',
      tone: 'amber',
      detail: detailLastOk(
        primaryLastCloudOkAtMs,
        hasActiveProject ? 'Last project OK ' : 'Last workspace OK ',
      ),
    };
  }

  if (hasActiveProject) {
    if (snap.shared.criticalListenerErrors.length > 0) {
      return {
        label: 'Workspace sync problem — check status',
        tone: 'rose',
        detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
      };
    }
    if (snap.shared.writeFailed) {
      return {
        label: 'Cloud sync failed — needs attention',
        tone: 'rose',
        detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
      };
    }
    if (snap.listeners.auxiliaryErrors.length > 0) {
      return {
        label: 'Background sync issue',
        tone: 'amber',
        detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
      };
    }
    if (snap.project.criticalListenerErrors.length > 0) {
      return {
        label: 'Project sync problem — check status',
        tone: 'rose',
        detail: detailLastOk(snap.project.lastCloudWriteOkAtMs, 'Last project OK '),
      };
    }
    if (snap.project.writeFailed) {
      return {
        label: 'Project sync failed — needs attention',
        tone: 'rose',
        detail: detailLastOk(snap.project.lastCloudWriteOkAtMs, 'Last project OK '),
      };
    }

    const projectPipelineBusy =
      options?.primaryPipelineAppearsBusy !== undefined
        ? options.primaryPipelineAppearsBusy
        : primaryCloudBusyForProject();
    if (projectPipelineBusy) {
      return {
        label: 'Saved locally — syncing…',
        tone: 'amber',
        detail: detailLastOk(snap.project.lastCloudWriteOkAtMs, 'Last project OK '),
      };
    }
    if (!snap.project.serverReachable) {
      return {
        label: 'Connecting…',
        tone: 'amber',
        detail: detailLastOk(snap.project.lastCloudWriteOkAtMs, 'Last project OK '),
      };
    }
    const clock = formatLastFirestoreWriteClock(snap.project.lastCloudWriteOkAtMs);
    return {
      label: 'Cloud: synced',
      tone: 'emerald',
      detail: clock ? `· ${clock}` : undefined,
    };
  }

  if (snap.shared.criticalListenerErrors.length > 0) {
    return {
      label: 'Workspace sync problem — check status',
      tone: 'rose',
      detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
    };
  }
  if (snap.shared.writeFailed) {
    return {
      label: 'Cloud sync failed — needs attention',
      tone: 'rose',
      detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
    };
  }

  const sharedPipelineBusy =
    options?.primaryPipelineAppearsBusy !== undefined
      ? options.primaryPipelineAppearsBusy
      : snap.shared.cloudWritePendingCount > 0;
  if (sharedPipelineBusy) {
    return {
      label: 'Saved locally — syncing…',
      tone: 'amber',
      detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
    };
  }
  if (!snap.shared.serverReachable) {
    return {
      label: 'Connecting…',
      tone: 'amber',
      detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
    };
  }
  if (snap.listeners.auxiliaryErrors.length > 0) {
    return {
      label: 'Background sync issue',
      tone: 'amber',
      detail: detailLastOk(snap.shared.lastCloudWriteOkAtMs, 'Last workspace OK '),
    };
  }

  const clock = formatLastFirestoreWriteClock(snap.shared.lastCloudWriteOkAtMs);
  return {
    label: 'Cloud: synced',
    tone: 'emerald',
    detail: clock ? `· ${clock}` : undefined,
  };
}

export function formatCloudStatusDetailText(
  browserOnline: boolean,
  snap: CloudSyncDerived,
  hasActiveProject: boolean,
  activeProjectId: string | null,
): string {
  const projectWritesPending = Math.max(snap.project.flushDepth, snap.project.cloudWritePendingCount);
  const lines: string[] = [
    'Connection diagnostics (this tab only)',
    '—',
    `Network: ${browserOnline ? 'Online' : 'Offline'}`,
    `Firestore database: ${WORKSPACE_FIRESTORE_DATABASE_ID}`,
    `Project workspace: ${hasActiveProject ? (activeProjectId ? `Open — ${activeProjectId}` : 'Open') : 'None selected'}`,
    `Project server path: ${snap.project.serverReachable ? 'Reached (server snapshot seen)' : 'Not yet — cache-only or waiting'}`,
    `Workspace server path: ${snap.shared.serverReachable ? 'Reached (server snapshot seen)' : 'Not yet — cache-only or waiting'}`,
    `Auxiliary server path: ${snap.auxiliary.serverReachable ? 'Reached' : 'Not yet'}`,
    `Unsafe to refresh: ${snap.unsafeToRefresh || snap.local.failed ? 'Yes' : 'No'}`,
    `Local durability: ${snap.local.failed ? 'Failed — refresh may lose changes' : snap.local.pendingCount > 0 ? `Writing (${snap.local.pendingCount} pending)` : 'Succeeded'}`,
    `Project cloud writes: ${projectWritesPending > 0 ? `Writing (${projectWritesPending} pending)` : snap.project.writeFailed ? 'Failed — needs attention' : 'Idle / succeeded'}`,
    `Shared-doc writes: ${snap.shared.cloudWritePendingCount > 0 ? `Writing (${snap.shared.cloudWritePendingCount} pending)` : snap.shared.writeFailed ? 'Failed — next save required' : 'Idle / succeeded'}`,
    `Last project cloud sync: ${snap.project.lastCloudWriteOkAtMs == null ? 'None yet this session' : new Date(snap.project.lastCloudWriteOkAtMs).toLocaleString()}`,
    `Last shared-doc sync: ${snap.shared.lastCloudWriteOkAtMs == null ? 'None yet this session' : new Date(snap.shared.lastCloudWriteOkAtMs).toLocaleString()}`,
    `Last local save: ${snap.local.lastWriteOkAtMs == null ? 'None yet this session' : new Date(snap.local.lastWriteOkAtMs).toLocaleString()}`,
    `Critical listener errors: ${snap.listeners.criticalErrors.length > 0 ? snap.listeners.criticalErrors.map((channel) => channel.label).join(', ') : 'None'}`,
    `Auxiliary listener errors: ${snap.listeners.auxiliaryErrors.length > 0 ? snap.listeners.auxiliaryErrors.map((channel) => channel.label).join(', ') : 'None'}`,
  ];
  lines.push('—');
  lines.push('Details update live for this tab. The headline prioritizes the open project when one is selected.');
  return lines.join('\n');
}
