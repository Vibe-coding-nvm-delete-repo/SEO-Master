import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNotificationsFromIDB, mapNotificationDoc, subscribeNotifications } from './notificationStorage';

const cloudSyncMocks = vi.hoisted(() => ({
  CLOUD_SYNC_CHANNELS: {
    notifications: 'notifications',
  },
  markListenerSnapshot: vi.fn(),
  markListenerError: vi.fn(),
  clearListenerError: vi.fn(),
  recordSharedCloudWriteStart: vi.fn(),
  recordSharedCloudWriteOk: vi.fn(),
  recordSharedCloudWriteError: vi.fn(),
}));

const idbMocks = vi.hoisted(() => ({
  loadFromIDB: vi.fn(),
  saveToIDB: vi.fn(() => Promise.resolve()),
  saveToLS: vi.fn(),
}));

const firestoreMocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  query: vi.fn(() => 'query'),
  collection: vi.fn(() => 'collection'),
  orderBy: vi.fn(() => 'orderBy'),
}));

vi.mock('./cloudSyncStatus', () => cloudSyncMocks);
vi.mock('./projectStorage', () => idbMocks);
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => firestoreMocks);

describe('notificationStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Firestore docs into normalized notification entries', () => {
    const entry = mapNotificationDoc('notif-1', {
      createdAt: { seconds: 1_744_080_000 },
      type: 'warning',
      source: 'content',
      message: 'Redo failed.',
      copyText: '',
      projectId: 'proj-1',
      projectName: 'Content Work',
    });

    expect(entry.id).toBe('notif-1');
    expect(entry.type).toBe('warning');
    expect(entry.source).toBe('content');
    expect(entry.copyText).toBe('Redo failed.');
    expect(entry.projectName).toBe('Content Work');
  });

  it('loads cached notifications from IDB', async () => {
    idbMocks.loadFromIDB.mockResolvedValueOnce({
      items: [{ id: 'n1' }],
    });

    await expect(loadNotificationsFromIDB()).resolves.toEqual([{ id: 'n1' }]);
  });

  it('subscribes, maps docs, and caches the newest-first list', () => {
    const unsub = vi.fn();
    firestoreMocks.onSnapshot.mockImplementation((_query: unknown, onData: (snap: unknown) => void) => {
      onData({
        docs: [
          {
            id: 'n1',
            data: () => ({
              createdAt: '2026-03-30T03:17:13.000Z',
              type: 'error',
              source: 'system',
              message: 'Cloud sync failed.',
              copyText: 'Cloud sync failed.',
              projectId: null,
              projectName: null,
            }),
          },
        ],
      });
      return unsub;
    });

    const onItems = vi.fn();
    const stop = subscribeNotifications(onItems);

    expect(onItems).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'n1',
        type: 'error',
        source: 'system',
        message: 'Cloud sync failed.',
      }),
    ]);
    expect(idbMocks.saveToIDB).toHaveBeenCalled();

    stop();
    expect(cloudSyncMocks.clearListenerError).toHaveBeenCalledWith('notifications');
    expect(unsub).toHaveBeenCalled();
  });
});
