import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
  recordSharedCloudWriteError,
  recordSharedCloudWriteOk,
  recordSharedCloudWriteStart,
} from './cloudSyncStatus';
import { loadFromIDB, saveToIDB, saveToLS } from './projectStorage';

export type NotificationSource =
  | 'group'
  | 'generate'
  | 'content'
  | 'feedback'
  | 'projects'
  | 'settings'
  | 'system';

export type NotificationType = 'success' | 'info' | 'warning' | 'error';

export interface NotificationEntry {
  id: string;
  createdAt: string;
  type: NotificationType;
  source: NotificationSource;
  message: string;
  copyText: string;
  projectId?: string | null;
  projectName?: string | null;
}

type NotificationDoc = Omit<NotificationEntry, 'id'>;

const NOTIFICATIONS_COLLECTION = 'notifications';
const IDB_NOTIFICATIONS_KEY = '__notifications__';
const LS_NOTIFICATIONS_META_KEY = 'kwg_notifications_meta';

function toIso(value: unknown): string {
  if (value == null) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return undefined;
}

export function mapNotificationDoc(id: string, data: Record<string, unknown>): NotificationEntry {
  const projectId = normalizeNullableString(data.projectId);
  const projectName = normalizeNullableString(data.projectName);
  return {
    id,
    createdAt: toIso(data.createdAt),
    type:
      data.type === 'success' || data.type === 'warning' || data.type === 'error'
        ? data.type
        : 'info',
    source:
      data.source === 'group' ||
      data.source === 'generate' ||
      data.source === 'content' ||
      data.source === 'feedback' ||
      data.source === 'projects' ||
      data.source === 'settings'
        ? data.source
        : 'system',
    message: typeof data.message === 'string' ? data.message : '',
    copyText:
      typeof data.copyText === 'string' && data.copyText.trim().length > 0
        ? data.copyText
        : typeof data.message === 'string'
          ? data.message
          : '',
    ...(projectId !== undefined ? { projectId } : {}),
    ...(projectName !== undefined ? { projectName } : {}),
  };
}

async function persistNotificationsCache(items: NotificationEntry[]): Promise<void> {
  try {
    await saveToIDB(IDB_NOTIFICATIONS_KEY, {
      items,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* cache is best-effort */
  }
  try {
    saveToLS(LS_NOTIFICATIONS_META_KEY, {
      count: items.length,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* ignore */
  }
}

export async function loadNotificationsFromIDB(): Promise<NotificationEntry[] | null> {
  const cached = await loadFromIDB<{ items?: NotificationEntry[] }>(IDB_NOTIFICATIONS_KEY);
  if (!cached || !Array.isArray(cached.items)) return null;
  return cached.items;
}

export async function addNotificationEntry(entry: NotificationDoc): Promise<string> {
  recordSharedCloudWriteStart();
  try {
    const docRef = await addDoc(collection(db, NOTIFICATIONS_COLLECTION), {
      createdAt: entry.createdAt || new Date().toISOString(),
      type: entry.type,
      source: entry.source,
      message: entry.message,
      copyText: entry.copyText,
      projectId: entry.projectId ?? null,
      projectName: entry.projectName ?? null,
    });
    recordSharedCloudWriteOk();
    return docRef.id;
  } catch (err) {
    recordSharedCloudWriteError();
    throw err;
  }
}

export function subscribeNotifications(
  onItems: (items: NotificationEntry[]) => void,
): () => void {
  const q = query(collection(db, NOTIFICATIONS_COLLECTION), orderBy('createdAt', 'desc'));
  const unsub = onSnapshot(
    q,
    (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.notifications, snap);
      const items = snap.docs.map((d) => mapNotificationDoc(d.id, d.data() as Record<string, unknown>));
      void persistNotificationsCache(items);
      onItems(items);
    },
    (err) => {
      markListenerError(CLOUD_SYNC_CHANNELS.notifications);
      console.warn('Notifications snapshot error:', err);
    },
  );
  return () => {
    clearListenerError(CLOUD_SYNC_CHANNELS.notifications);
    unsub();
  };
}
