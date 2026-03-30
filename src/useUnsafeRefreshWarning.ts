import { useEffect, useState } from 'react';
import { getCloudSyncSnapshot, subscribeCloudSync } from './cloudSyncStatus';

/**
 * Browser-native unload warning while a local durability write is still in flight,
 * or after a local save failure that puts the latest edits at risk on refresh.
 */
export function useUnsafeRefreshWarning(): void {
  const [, bump] = useState(0);

  useEffect(() => {
    const unsub = subscribeCloudSync(() => bump((n) => n + 1));
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const snap = getCloudSyncSnapshot();
      if (!snap.unsafeToRefresh && !snap.local.failed) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  });
}
