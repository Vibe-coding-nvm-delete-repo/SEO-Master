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

  useEffect(() => {
    if (!universalBlockedHydratedRef.current) return;
    const arr = Array.from(universalBlockedTokens);
    const payloadJson = JSON.stringify(arr);
    if (payloadJson === lastUniversalBlockedSavedRef.current) return;
    lastUniversalBlockedSavedRef.current = payloadJson;
    void persistAppSettingsDoc({
      docId: 'universal_blocked',
      data: { tokens: arr, updatedAt: new Date().toISOString() },
      addToast,
      localContext: 'universal blocked tokens',
      cloudContext: 'universal blocked tokens',
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
        const tokens = snap.exists() && Array.isArray(snap.data()?.tokens) ? snap.data()?.tokens : [];
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
