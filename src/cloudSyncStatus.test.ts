import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveCloudStatusLine,
  formatCloudStatusDetailText,
  markListenerError,
  resetCloudSyncStateForTests,
  subscribeCloudSync,
  type CloudSyncDerived,
} from './cloudSyncStatus';

afterEach(() => {
  resetCloudSyncStateForTests();
});

const base: CloudSyncDerived = {
  serverReachable: true,
  listenerErrorCount: 0,
  listenerErrors: [],
  projectFlushDepth: 0,
  projectDataWriteFailed: false,
};

describe('deriveCloudStatusLine', () => {
  it('prefers offline when browser is offline', () => {
    const r = deriveCloudStatusLine(false, { ...base, serverReachable: false }, true);
    expect(r.label).toBe('Offline — saved locally');
    expect(r.tone).toBe('amber');
  });

  it('shows sync problem when any listener errors', () => {
    const r = deriveCloudStatusLine(
      true,
      {
        ...base,
        listenerErrorCount: 1,
        listenerErrors: ['projects'],
      },
      false,
    );
    expect(r.label).toBe('Sync problem — retry');
    expect(r.tone).toBe('rose');
  });

  it('shows project save failure when active project and flag set', () => {
    const r = deriveCloudStatusLine(
      true,
      { ...base, projectDataWriteFailed: true },
      true,
    );
    expect(r.label).toBe('Sync problem — retry');
  });

  it('ignores project save failure when no active project', () => {
    const r = deriveCloudStatusLine(
      true,
      { ...base, projectDataWriteFailed: true },
      false,
    );
    expect(r.label).toBe('Cloud: synced');
  });

  it('shows syncing when flush in flight', () => {
    const r = deriveCloudStatusLine(true, { ...base, projectFlushDepth: 1 }, true);
    expect(r.label).toBe('Syncing…');
    expect(r.tone).toBe('amber');
  });

  it('shows connecting when online but no server snapshot yet', () => {
    const r = deriveCloudStatusLine(true, { ...base, serverReachable: false }, false);
    expect(r.label).toBe('Connecting…');
  });

  it('shows synced when healthy', () => {
    const r = deriveCloudStatusLine(true, base, false);
    expect(r.label).toBe('Cloud: synced');
    expect(r.tone).toBe('emerald');
  });
});

describe('formatCloudStatusDetailText', () => {
  it('includes database id and key sections', () => {
    const text = formatCloudStatusDetailText(true, base, false, null);
    expect(text).toContain('first-db');
    expect(text).toContain('Network:');
    expect(text).toContain('Listener channels:');
  });

  it('lists listener errors when present', () => {
    const text = formatCloudStatusDetailText(
      true,
      { ...base, listenerErrorCount: 1, listenerErrors: ['projects'] },
      true,
      'proj_1',
    );
    expect(text).toContain('projects');
    expect(text).toContain('error');
  });
});

describe('subscribeCloudSync', () => {
  it('returns unsubscribe that stops notifications', () => {
    let n = 0;
    const unsub = subscribeCloudSync(() => {
      n += 1;
    });
    markListenerError('__chan_a__');
    expect(n).toBe(1);
    unsub();
    const prev = n;
    markListenerError('__chan_b__');
    expect(n).toBe(prev);
  });
});
