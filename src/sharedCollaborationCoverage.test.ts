import { afterEach, describe, expect, it } from 'vitest';
import { getCollaborationHealthSnapshot, resetCloudSyncStateForTests } from './cloudSyncStatus';
import { performSharedMutation, trackSharedListenerApply } from './sharedCollabContract';
import { getSharedActionRegistryEntry } from './sharedCollaboration';

describe('shared collaboration coverage', () => {
  afterEach(() => {
    resetCloudSyncStateForTests();
  });

  it.each([
    ['cosine-cache-converges', 'autogroup.cosine_cache'],
    ['feedback-channel-covered', 'support.feedback'],
    ['notifications-channel-covered', 'support.notifications'],
    ['changelog-channel-covered', 'support.changelog'],
    ['build-info-channel-covered', 'support.build_info'],
  ] as const)('[%s] keeps auxiliary collaboration channels registered and traceable', async (_coverageId, actionId) => {
    const entry = getSharedActionRegistryEntry(actionId);

    await performSharedMutation(entry, async () => undefined);
    trackSharedListenerApply(entry);

    const health = getCollaborationHealthSnapshot().find((item) => item.actionId === actionId);
    expect(health?.lastAcceptedWriteAtMs).not.toBeNull();
    expect(health?.lastListenerApplyAtMs).not.toBeNull();
  });
});
