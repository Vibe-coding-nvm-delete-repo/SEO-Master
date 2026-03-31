import { useCallback, useEffect, useState } from 'react';
import { CLOUD_SYNC_CHANNELS } from '../cloudSyncStatus';
import {
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  loadCachedState,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
} from '../appSettingsPersistence';
import { reportPersistFailure, type PersistToastFn } from '../persistenceErrors';

export function useStarredModels(addToast?: PersistToastFn) {
  const [starredModels, setStarredModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const firestoreLoadedRef = { current: false };

    void loadCachedState<{ ids?: string[] }>({
      idbKey: appSettingsIdbKey('starred_models'),
    }).then((cached) => {
      if (!alive || firestoreLoadedRef.current || !cached) return;
      setStarredModels(new Set(Array.isArray(cached.ids) ? cached.ids : []));
    });

    const unsub = subscribeAppSettingsDoc({
      docId: 'starred_models',
      channel: CLOUD_SYNC_CHANNELS.starredModels,
      onData: (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        firestoreLoadedRef.current = true;
        const ids: string[] = snap.exists() && Array.isArray(snap.data()?.ids) ? snap.data()?.ids : [];
        cacheStateLocallyBestEffort({
          idbKey: appSettingsIdbKey('starred_models'),
          value: { ids, updatedAt: new Date().toISOString() },
        });
        setStarredModels(new Set(ids));
      },
      onError: (err) => {
        firestoreLoadedRef.current = true;
        reportPersistFailure(addToast, 'starred models sync', err);
      },
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [addToast]);

  const toggleStarModel = useCallback((modelId: string) => {
    setStarredModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      void persistAppSettingsDoc({
        docId: 'starred_models',
        data: { ids: [...next], updatedAt: new Date().toISOString() },
        addToast,
        localContext: 'starred models',
        cloudContext: 'starred models',
      });
      return next;
    });
  }, [addToast]);

  return { starredModels, toggleStarModel };
}
