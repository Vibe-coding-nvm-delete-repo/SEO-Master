import { useEffect, useRef, useState } from 'react';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
} from '../cloudSyncStatus';
import { reportPersistFailure, type PersistToastFn } from '../persistenceErrors';
import {
  cacheStateLocallyBestEffort,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
} from '../appSettingsPersistence';

export function useWorkspacePrefsSync(activeProjectId: string | null, addToast?: PersistToastFn) {
  const [savedClusters, setSavedClusters] = useState<any[]>([]);
  const savedClustersHashRef = useRef('');
  const lastPersistedPrefsRef = useRef('');

  useEffect(() => {
    try {
      savedClustersHashRef.current = JSON.stringify(savedClusters ?? []);
    } catch {
      savedClustersHashRef.current = '';
    }
  }, [savedClusters]);

  useEffect(() => {
    const unsub = subscribeAppSettingsDoc({
      docId: 'user_preferences',
      channel: CLOUD_SYNC_CHANNELS.userPreferences,
      onData: (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as any;
      const remoteSavedClusters = Array.isArray(data?.savedClusters) ? data.savedClusters : [];
      const remoteHash = (() => {
        try {
          return JSON.stringify(remoteSavedClusters);
        } catch {
          return '';
        }
      })();
      if (remoteHash !== savedClustersHashRef.current) {
        setSavedClusters(remoteSavedClusters);
      }
      lastPersistedPrefsRef.current = JSON.stringify({
        activeProjectId: data?.activeProjectId ?? null,
        savedClusters: remoteSavedClusters,
      });
      cacheStateLocallyBestEffort({
        idbKey: '__app_prefs__',
        value: {
          activeProjectId: data?.activeProjectId ?? null,
          savedClusters: remoteSavedClusters,
          updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
        },
      });
      },
      onError: (err) => {
        markListenerError(CLOUD_SYNC_CHANNELS.userPreferences);
        reportPersistFailure(addToast, 'user preferences sync', err);
      },
    });

    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.userPreferences);
      if (typeof unsub === 'function') unsub();
    };
  }, [addToast]);

  useEffect(() => {
    const payloadJson = JSON.stringify({ activeProjectId, savedClusters });
    if (payloadJson === lastPersistedPrefsRef.current) return;
    lastPersistedPrefsRef.current = payloadJson;
    void persistAppSettingsDoc({
      docId: 'user_preferences',
      data: {
        activeProjectId,
        savedClusters,
        updatedAt: new Date().toISOString(),
      },
      addToast,
      idbKey: '__app_prefs__',
      localContext: 'workspace preferences',
      cloudContext: 'workspace preferences',
    });
  }, [activeProjectId, savedClusters]);

  return { savedClusters, setSavedClusters };
}
