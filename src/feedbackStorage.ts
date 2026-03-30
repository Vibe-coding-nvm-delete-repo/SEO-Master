import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from './firebase';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
} from './cloudSyncStatus';
import { FEEDBACK_MAX_ATTACHMENTS } from './feedbackConstants';
import type { FeedbackEntry } from './types';
import { loadFromIDB, saveToIDB, saveToLS } from './projectStorage';

const FEEDBACK_COLLECTION = 'feedback';
const IDB_FEEDBACK_KEY = '__feedback__';
const LS_FEEDBACK_META_KEY = 'kwg_feedback_meta';

function toIso(t: unknown): string {
  if (t == null) return new Date().toISOString();
  if (typeof t === 'string') return t;
  if (typeof t === 'object' && t !== null && 'toDate' in t && typeof (t as { toDate: () => Date }).toDate === 'function') {
    return (t as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof t === 'object' && t !== null && 'seconds' in t) {
    return new Date((t as { seconds: number }).seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function parseRating(v: unknown): 1 | 2 | 3 | 4 | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
}

function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').map((t) => t.trim()).filter(Boolean);
}

function parseAttachmentUrls(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const urls = v
    .filter((x): x is string => typeof x === 'string' && (x.startsWith('http://') || x.startsWith('https://')))
    .slice(0, FEEDBACK_MAX_ATTACHMENTS);
  return urls.length ? urls : undefined;
}

function mapDoc(id: string, data: Record<string, unknown>): FeedbackEntry {
  const kind = data.kind === 'feature' ? 'feature' : 'issue';
  const attachmentUrls = parseAttachmentUrls(data.attachmentUrls);
  return {
    id,
    kind,
    body: typeof data.body === 'string' ? data.body : '',
    priority: typeof data.priority === 'number' ? data.priority : Number.MAX_SAFE_INTEGER,
    createdAt: toIso(data.createdAt),
    authorEmail: typeof data.authorEmail === 'string' ? data.authorEmail : null,
    tags: parseTags(data.tags),
    issueSeverity: kind === 'issue' ? parseRating(data.issueSeverity) : null,
    featureImpact: kind === 'feature' ? parseRating(data.featureImpact) : null,
    ...(attachmentUrls ? { attachmentUrls } : {}),
  };
}

export async function loadFeedbackFromIDB(): Promise<FeedbackEntry[] | null> {
  const row = await loadFromIDB<{ projectId: string; items?: FeedbackEntry[] }>(IDB_FEEDBACK_KEY);
  if (!row || !Array.isArray(row.items)) return null;
  return row.items;
}

async function persistFeedbackCache(items: FeedbackEntry[]) {
  try {
    await saveToIDB(IDB_FEEDBACK_KEY, {
      items,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* feedback cache is best-effort */
  }
  try {
    saveToLS(LS_FEEDBACK_META_KEY, { count: items.length, updatedAt: new Date().toISOString() });
  } catch {
    /* ignore */
  }
}

/**
 * Live subscription: updates React state and mirrors to IndexedDB + small localStorage metadata.
 */
export function subscribeFeedback(onItems: (items: FeedbackEntry[]) => void): () => void {
  const q = query(collection(db, FEEDBACK_COLLECTION), orderBy('priority', 'asc'));
  const unsub = onSnapshot(
    q,
    (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.feedback, snap);
      const items: FeedbackEntry[] = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
      void persistFeedbackCache(items);
      onItems(items);
    },
    (err) => {
      markListenerError(CLOUD_SYNC_CHANNELS.feedback);
      console.warn('Feedback snapshot error:', err);
    },
  );
  return () => {
    clearListenerError(CLOUD_SYNC_CHANNELS.feedback);
    unsub();
  };
}

function extForImage(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  const t = file.type?.toLowerCase() ?? '';
  if (t.includes('png')) return 'png';
  if (t.includes('gif')) return 'gif';
  if (t.includes('webp')) return 'webp';
  return 'jpg';
}

/** Firebase error code from catch value (e.g. auth/operation-not-allowed). */
function firebaseErrorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return null;
}

/**
 * Storage rules require a signed-in user for feedback screenshots. Anonymous sign-in is
 * silent when the user has not used Google sign-in.
 */
async function ensureAuthForFeedbackImages(): Promise<void> {
  if (auth.currentUser) return;
  try {
    await signInAnonymously(auth);
  } catch (e) {
    const code = firebaseErrorCode(e);
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'AUTH_ANONYMOUS_DISABLED: Enable Anonymous sign-in in Firebase Console (Authentication → Sign-in method) to attach screenshots.',
        { cause: e },
      );
    }
    throw new Error('AUTH_FEEDBACK_IMAGE_SIGNIN_FAILED', { cause: e });
  }
}

async function deleteFeedbackStoragePaths(paths: string[]): Promise<void> {
  for (const p of paths.slice().reverse()) {
    try {
      await deleteObject(ref(storage, p));
    } catch {
      /* best-effort cleanup */
    }
  }
}

export async function addFeedback(
  kind: 'issue' | 'feature',
  body: string,
  authorEmail: string | null,
  options: { tags: string[]; rating: 1 | 2 | 3 | 4; imageFiles?: File[] },
): Promise<{ imagesRequested: number; imagesSaved: boolean }> {
  const trimmed = body.trim();
  if (!trimmed) return { imagesRequested: 0, imagesSaved: false };

  const imageFiles = (options.imageFiles ?? []).slice(0, FEEDBACK_MAX_ATTACHMENTS);

  const snap = await getDocs(collection(db, FEEDBACK_COLLECTION));
  let maxP = 0;
  snap.forEach((d) => {
    const p = d.data()?.priority;
    if (typeof p === 'number' && p > maxP) maxP = p;
  });

  const docRef = doc(collection(db, FEEDBACK_COLLECTION));

  const basePayload = {
    kind,
    body: trimmed,
    tags: options.tags,
    issueSeverity: kind === 'issue' ? options.rating : null,
    featureImpact: kind === 'feature' ? options.rating : null,
    priority: maxP + 1,
    createdAt: new Date().toISOString(),
    authorEmail,
  };

  if (imageFiles.length === 0) {
    await setDoc(docRef, basePayload);
    return { imagesRequested: 0, imagesSaved: false };
  }

  const uploadedPaths: string[] = [];
  try {
    await ensureAuthForFeedbackImages();

    const urls: string[] = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const ext = extForImage(file);
      const path = `feedback/${docRef.id}/${i}.${ext}`;
      const storageRef = ref(storage, path);
      const contentType = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
      await uploadBytes(storageRef, file, { contentType });
      uploadedPaths.push(path);
      urls.push(await getDownloadURL(storageRef));
    }
    await setDoc(docRef, { ...basePayload, attachmentUrls: urls });
    return { imagesRequested: imageFiles.length, imagesSaved: true };
  } catch (e) {
    // Never lose the written feedback because image auth/storage is unavailable.
    // Best-effort cleanup for any partial uploads that might exist.
    await deleteFeedbackStoragePaths(uploadedPaths);
    console.warn('Feedback image upload failed; saving feedback without images.', e);
    await setDoc(docRef, basePayload);
    return { imagesRequested: imageFiles.length, imagesSaved: false };
  }
}

export async function swapFeedbackPriority(a: FeedbackEntry, b: FeedbackEntry): Promise<void> {
  const batch = writeBatch(db);
  const refA = doc(db, FEEDBACK_COLLECTION, a.id);
  const refB = doc(db, FEEDBACK_COLLECTION, b.id);
  batch.update(refA, { priority: b.priority });
  batch.update(refB, { priority: a.priority });
  await batch.commit();
}
