import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLOUD_SYNC_CHANNELS,
  deriveCloudStatusLine,
  formatCloudStatusDetailText,
  formatLastFirestoreWriteClock,
  getCloudSyncSnapshot,
  makeAppSettingsChannel,
  markListenerError,
  markListenerSnapshot,
  recordLocalPersistError,
  recordLocalPersistOk,
  recordLocalPersistStart,
  recordSharedCloudWriteError,
  recordSharedCloudWriteOk,
  recordSharedCloudWriteStart,
  resetCloudSyncStateForTests,
  subscribeCloudSync,
  type CloudSyncDerived,
} from './cloudSyncStatus';

beforeEach(() => {
  resetCloudSyncStateForTests();
});

afterEach(() => {
  resetCloudSyncStateForTests();
});

function makeBase(): CloudSyncDerived {
  return {
    revision: 0,
    local: {
      pendingCount: 0,
      failed: false,
      lastWriteOkAtMs: null,
    },
    project: {
      flushDepth: 0,
      cloudWritePendingCount: 0,
      writeFailed: false,
      lastCloudWriteOkAtMs: null,
      serverReachable: true,
      listenerErrors: [],
      criticalListenerErrors: [],
    },
    shared: {
      cloudWritePendingCount: 0,
      writeFailed: false,
      lastCloudWriteOkAtMs: null,
      serverReachable: true,
      listenerErrors: [],
      criticalListenerErrors: [],
    },
    auxiliary: {
      serverReachable: false,
      listenerErrors: [],
    },
    listeners: {
      allErrors: [],
      criticalErrors: [],
      auxiliaryErrors: [],
    },
    unsafeToRefresh: false,
  };
}

/** Flush the microtask-coalesced notify queue. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('deriveCloudStatusLine', () => {
  it('prefers offline when browser is offline', () => {
    const r = deriveCloudStatusLine(false, makeBase(), true);
    expect(r.label).toBe('Offline — saved locally');
    expect(r.tone).toBe('amber');
  });

  it('prefers local save failure over all other states', () => {
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      local: {
        pendingCount: 0,
        failed: true,
        lastWriteOkAtMs: null,
      },
    }, true);
    expect(r.label).toBe('Save failed — local data at risk');
    expect(r.tone).toBe('rose');
  });

  it('shows saving while the local durability barrier is still pending', () => {
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      local: {
        pendingCount: 1,
        failed: false,
        lastWriteOkAtMs: null,
      },
      unsafeToRefresh: true,
    }, true);
    expect(r.label).toBe('Saving… don’t refresh');
    expect(r.tone).toBe('amber');
  });

  it('does not turn the active-project headline red for auxiliary listener issues', () => {
    const auxiliaryChannel = {
      id: CLOUD_SYNC_CHANNELS.notifications,
      label: 'Notifications',
      domain: 'auxiliary' as const,
      headline: 'auxiliary' as const,
      reachability: 'auxiliary' as const,
    };
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      auxiliary: {
        serverReachable: true,
        listenerErrors: [auxiliaryChannel],
      },
      listeners: {
        allErrors: [auxiliaryChannel],
        criticalErrors: [],
        auxiliaryErrors: [auxiliaryChannel],
      },
    }, true);
    expect(r.label).toBe('Cloud: synced');
    expect(r.tone).toBe('emerald');
  });

  it('turns the headline red for critical project listener issues', () => {
    const criticalChannel = {
      id: CLOUD_SYNC_CHANNELS.projectChunks,
      label: 'Project workspace',
      domain: 'project' as const,
      headline: 'critical' as const,
      reachability: 'project' as const,
    };
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      project: {
        ...makeBase().project,
        criticalListenerErrors: [criticalChannel],
        listenerErrors: [criticalChannel],
      },
      listeners: {
        allErrors: [criticalChannel],
        criticalErrors: [criticalChannel],
        auxiliaryErrors: [],
      },
    }, true);
    expect(r.label).toBe('Project sync problem — check status');
    expect(r.tone).toBe('rose');
  });

  it('uses the project cloud timestamp for active-project detail instead of shared-doc sync', () => {
    const projectMs = new Date('2026-06-15T12:00:00').getTime();
    const sharedMs = new Date('2026-06-15T18:30:45').getTime();
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      project: {
        ...makeBase().project,
        lastCloudWriteOkAtMs: projectMs,
      },
      shared: {
        ...makeBase().shared,
        lastCloudWriteOkAtMs: sharedMs,
      },
    }, true);
    expect(r.label).toBe('Cloud: synced');
    expect(r.detail).toBe(`· ${formatLastFirestoreWriteClock(projectMs)}`);
  });

  it('keeps the active-project headline in connecting state until the project path reaches the server', () => {
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      project: {
        ...makeBase().project,
        serverReachable: false,
      },
      auxiliary: {
        serverReachable: true,
        listenerErrors: [],
      },
    }, true);
    expect(r.label).toBe('Connecting…');
    expect(r.tone).toBe('amber');
  });

  it('treats shared-doc failure as primary only when no project is open', () => {
    const snap: CloudSyncDerived = {
      ...makeBase(),
      shared: {
        ...makeBase().shared,
        writeFailed: true,
      },
    };
    expect(deriveCloudStatusLine(true, snap, false).label).toBe('Cloud sync failed — needs attention');
    expect(deriveCloudStatusLine(true, snap, true).label).toBe('Cloud: synced');
  });

  it('shows background sync issue when only auxiliary listeners are failing without an active project', () => {
    const auxiliaryChannel = {
      id: makeAppSettingsChannel('overview', 'pages'),
      label: 'Overview input (pages)',
      domain: 'auxiliary' as const,
      headline: 'auxiliary' as const,
      reachability: 'auxiliary' as const,
    };
    const r = deriveCloudStatusLine(true, {
      ...makeBase(),
      listeners: {
        allErrors: [auxiliaryChannel],
        criticalErrors: [],
        auxiliaryErrors: [auxiliaryChannel],
      },
      auxiliary: {
        serverReachable: true,
        listenerErrors: [auxiliaryChannel],
      },
    }, false);
    expect(r.label).toBe('Background sync issue');
    expect(r.tone).toBe('amber');
  });
});

describe('formatLastFirestoreWriteClock', () => {
  it('returns undefined for null', () => {
    expect(formatLastFirestoreWriteClock(null)).toBeUndefined();
  });

  it('returns a non-empty locale time string for valid ms', () => {
    const s = formatLastFirestoreWriteClock(Date.UTC(2026, 0, 1, 14, 5, 6));
    expect(s).toBeTruthy();
    expect(String(s).length).toBeGreaterThan(3);
  });
});

describe('markListenerSnapshot', () => {
  it('does not notify subscribers on duplicate server snapshots when state is unchanged', async () => {
    let notifications = 0;
    const unsub = subscribeCloudSync(() => {
      notifications += 1;
    });
    markListenerSnapshot(CLOUD_SYNC_CHANNELS.projects, { metadata: { fromCache: false } });
    await tick();
    expect(notifications).toBe(1);
    markListenerSnapshot(CLOUD_SYNC_CHANNELS.projects, { metadata: { fromCache: false } });
    await tick();
    expect(notifications).toBe(1);
    unsub();
  });

  it('notifies when clearing a listener error', async () => {
    let notifications = 0;
    const unsub = subscribeCloudSync(() => {
      notifications += 1;
    });
    markListenerError(CLOUD_SYNC_CHANNELS.notifications);
    await tick();
    expect(notifications).toBe(1);
    markListenerSnapshot(CLOUD_SYNC_CHANNELS.notifications, { metadata: { fromCache: true } });
    await tick();
    expect(notifications).toBe(2);
    unsub();
  });
});

describe('formatCloudStatusDetailText', () => {
  it('includes split server paths and sync sections', () => {
    const text = formatCloudStatusDetailText(true, makeBase(), true, 'proj_1');
    expect(text).toContain('first-db');
    expect(text).toContain('Connection diagnostics (this tab only)');
    expect(text).toContain('Project server path:');
    expect(text).toContain('Workspace server path:');
    expect(text).toContain('Last project cloud sync:');
    expect(text).toContain('Last shared-doc sync:');
    expect(text).toContain('Auxiliary listener errors:');
  });

  it('lists auxiliary listener errors when present', () => {
    markListenerError(makeAppSettingsChannel('overview', 'pages'));
    const text = formatCloudStatusDetailText(true, getCloudSyncSnapshot(), false, null);
    expect(text).toContain('Auxiliary listener errors:');
    expect(text).toContain('Overview input (pages)');
  });
});

describe('subscribeCloudSync', () => {
  it('returns unsubscribe that stops notifications', async () => {
    let notifications = 0;
    const unsub = subscribeCloudSync(() => {
      notifications += 1;
    });
    markListenerError(CLOUD_SYNC_CHANNELS.notifications);
    await tick();
    expect(notifications).toBe(1);
    unsub();
    const previous = notifications;
    markListenerError(CLOUD_SYNC_CHANNELS.feedback);
    await tick();
    expect(notifications).toBe(previous);
  });
});

describe('local/cloud trackers', () => {
  it('exposes unsafe refresh while local writes are pending', () => {
    recordLocalPersistStart();
    const pendingSnap = getCloudSyncSnapshot();
    expect(pendingSnap.unsafeToRefresh).toBe(true);
    const pending = deriveCloudStatusLine(true, pendingSnap, true);
    expect(pending.label).toBe('Saving… don’t refresh');
    recordLocalPersistOk();
  });

  it('clears shared cloud failure after a later success', () => {
    recordSharedCloudWriteStart();
    recordSharedCloudWriteError();
    let text = formatCloudStatusDetailText(true, getCloudSyncSnapshot(), false, null);
    expect(text).toContain('Failed — next save required');

    recordSharedCloudWriteStart();
    recordSharedCloudWriteOk();
    text = formatCloudStatusDetailText(true, getCloudSyncSnapshot(), false, null);
    expect(text).toContain('Idle / succeeded');
  });

  it('clears a prior local failure when a later tracked local write succeeds', () => {
    recordLocalPersistStart();
    recordLocalPersistError();
    expect(getCloudSyncSnapshot().local.failed).toBe(true);

    recordLocalPersistOk({ decrementPending: false });
    const snap = getCloudSyncSnapshot();
    expect(snap.local.failed).toBe(false);
    expect(snap.local.lastWriteOkAtMs).not.toBeNull();
  });
});
