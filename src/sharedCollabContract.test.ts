import { afterEach, describe, expect, it } from 'vitest';
import { getCollaborationHealthSnapshot, resetCloudSyncStateForTests } from './cloudSyncStatus';
import { performSharedMutation, trackSharedListenerApply } from './sharedCollabContract';
import { getSharedActionRegistryEntry } from './sharedCollaboration';
import { blockedSharedMutation } from './sharedMutation';

describe('sharedCollabContract', () => {
  afterEach(() => {
    resetCloudSyncStateForTests();
  });

  it('records accepted mutations in collaboration diagnostics', async () => {
    const entry = getSharedActionRegistryEntry('project.metadata');

    await performSharedMutation(entry, async () => undefined);

    const diagnostics = getCollaborationHealthSnapshot();
    const channel = diagnostics.find((item) => item.actionId === entry.id);
    expect(channel?.lastAcceptedWriteAtMs).not.toBeNull();
    expect(channel?.lastFailedReason).toBeNull();
  });

  it('records blocked mutations in collaboration diagnostics', async () => {
    const entry = getSharedActionRegistryEntry('project.metadata');

    const result = await performSharedMutation(entry, async () => blockedSharedMutation('lock-conflict'));

    const diagnostics = getCollaborationHealthSnapshot();
    const channel = diagnostics.find((item) => item.actionId === entry.id);
    expect(result.status).toBe('blocked');
    expect(channel?.lastBlockedReason).toBe('lock-conflict');
  });

  it('records listener applications in collaboration diagnostics', () => {
    const entry = getSharedActionRegistryEntry('project.collection');

    trackSharedListenerApply(entry);

    const diagnostics = getCollaborationHealthSnapshot();
    const channel = diagnostics.find((item) => item.actionId === entry.id);
    expect(channel?.lastListenerApplyAtMs).not.toBeNull();
  });
});
