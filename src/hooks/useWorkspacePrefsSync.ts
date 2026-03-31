import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  clearListenerError,
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
} from '../cloudSyncStatus';
import { reportPersistFailure, type PersistToastFn } from '../persistenceErrors';
import { saveAppPrefsToFirestore, saveAppPrefsToIDB } from '../projectStorage';

export function useWorkspacePrefsSync(activeProjectId: string | null, addToast?: PersistToastFn) {
  const [savedClusters, setSavedClusters] = useState<any[]>([]);
  const savedClustersHashRef = useRef('');

  useEffect(() => {
    try {
      savedClustersHashRef.current = JSON.stringify(savedClusters ?? []);
    } catch {
      savedClustersHashRef.current = '';
    }
  }, [savedClusters]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'user_preferences'), (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.userPreferences, snap);
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
    }, (err) => {
      markListenerError(CLOUD_SYNC_CHANNELS.userPreferences);
      reportPersistFailure(addToast, 'user preferences sync', err);
    });

    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.userPreferences);
      if (typeof unsub === 'function') unsub();
    };
  }, [addToast]);

  useEffect(() => {
    try {
      saveAppPrefsToFirestore(activeProjectId, savedClusters)?.catch(() => undefined);
    } catch {
      /* ignore preference mirror failures */
    }
    try {
      saveAppPrefsToIDB(activeProjectId, savedClusters)?.catch(() => undefined);
    } catch {
      /* ignore preference mirror failures */
    }
  }, [activeProjectId, savedClusters]);

  return { savedClusters, setSavedClusters };
}
