import { useEffect, useRef, useState } from 'react';
import { CLOUD_SYNC_CHANNELS } from '../cloudSyncStatus';
import {
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  loadCachedState,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
} from '../appSettingsPersistence';
import { reportPersistFailure, type PersistToastFn } from '../persistenceErrors';

export function useUniversalBlockedTokens(addToast?: PersistToastFn) {
  const [universalBlockedTokens, setUniversalBlockedTokens] = useState<Set<string>>(new Set<string>());
  const universalBlockedHydratedRef = useRef(false);
  const lastUniversalBlockedSavedRef = useRef<string>('');
  const suppressSnapshotRef = useRef(false);
  const lastWrittenAtRef = useRef('');

  useEffect(() => {
    if (!universalBlockedHydratedRef.current) return;
    const arr = Array.from(universalBlockedTokens);
    const payloadJson = JSON.stringify(arr);
    if (payloadJson === lastUniversalBlockedSavedRef.current) return;
    lastUniversalBlockedSavedRef.current = payloadJson;
    const updatedAt = new Date().toISOString();
    lastWrittenAtRef.current = updatedAt;
    suppressSnapshotRef.current = true;
    void persistAppSettingsDoc({
      docId: 'universal_blocked',
      data: { tokens: arr, updatedAt },
      addToast,
      localContext: 'universal blocked tokens',
      cloudContext: 'universal blocked tokens',
    }).then(() => {
      suppressSnapshotRef.current = false;
    }).catch((err) => {
      suppressSnapshotRef.current = false;
      reportPersistFailure(addToast, 'universal blocked tokens', err);
    });
  }, [universalBlockedTokens, addToast]);

  useEffect(() => {
    let alive = true;
    const firestoreLoadedRef = { current: false };

    void loadCachedState<{ tokens?: string[] }>({
      idbKey: appSettingsIdbKey('universal_blocked'),
    }).then((cached) => {
      if (!alive || firestoreLoadedRef.current || !cached) {
        universalBlockedHydratedRef.current = true;
        return;
      }
      const tokens = Array.isArray(cached.tokens) ? cached.tokens : [];
      lastUniversalBlockedSavedRef.current = JSON.stringify(tokens);
      setUniversalBlockedTokens(new Set<string>(tokens));
      universalBlockedHydratedRef.current = true;
    });

    const unsub = subscribeAppSettingsDoc({
      docId: 'universal_blocked',
      channel: CLOUD_SYNC_CHANNELS.universalBlocked,
      onData: (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        firestoreLoadedRef.current = true;
        const data = snap.exists() ? snap.data() : null;
        const tokens: string[] = data && Array.isArray(data.tokens) ? data.tokens : [];
        // Suppress own-write echoes to prevent overwriting concurrent remote changes
        const incomingUpdatedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : '';
        if (suppressSnapshotRef.current && incomingUpdatedAt && lastWrittenAtRef.current && incomingUpdatedAt <= lastWrittenAtRef.current) {
          return;
        }
        suppressSnapshotRef.current = false;
        lastUniversalBlockedSavedRef.current = JSON.stringify(tokens);
        cacheStateLocallyBestEffort({
          idbKey: appSettingsIdbKey('universal_blocked'),
          value: { tokens, updatedAt: new Date().toISOString() },
        });
        setUniversalBlockedTokens(new Set<string>(tokens));
        universalBlockedHydratedRef.current = true;
      },
      onError: (err) => {
        firestoreLoadedRef.current = true;
        universalBlockedHydratedRef.current = true;
        reportPersistFailure(addToast, 'universal blocked tokens sync', err);
      },
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [addToast]);

  return { universalBlockedTokens, setUniversalBlockedTokens };
}
