import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollaborationDiagnostics,
  getCollaborationDiagnostics,
  markListenerError,
  markListenerSnapshot,
  recordCollaborationListenerApply,
  recordCollaborationMutationResult,
  resetCloudSyncStateForTests,
  setProjectAuthoritativeSyncState,
  setSharedProjectSyncState,
} from './cloudSyncStatus';

describe('cloudSyncStatus diagnostics journal', () => {
  beforeEach(() => {
    resetCloudSyncStateForTests();
    clearCollaborationDiagnostics();
  });

  it('records authoritative/shared sync transitions', () => {
    setProjectAuthoritativeSyncState({
      enabled: true,
      ready: false,
      phase: 'connecting',
      pendingTargets: ['collab/meta'],
    });
    setSharedProjectSyncState({
      activeProjectId: 'project-1',
      bootstrapSource: 'local-cache',
      authoritativeReady: false,
      pendingKeys: ['collab/meta'],
    });

    const kinds = getCollaborationDiagnostics().map((entry) => entry.kind);
    expect(kinds).toContain('authoritative-sync-state');
    expect(kinds).toContain('shared-project-sync-state');
  });

  it('records listener and mutation events', () => {
    markListenerError('project_chunks');
    markListenerSnapshot('project_chunks', { metadata: { fromCache: false } });
    recordCollaborationListenerApply({
      actionId: 'project_v2.listener',
      label: 'Shared project listener',
      scope: 'project_group_v2',
      channelKind: 'project_v2_listener',
      storageChannel: 'projects/{projectId}/listeners/*',
    });
    recordCollaborationMutationResult({
      actionId: 'project_v2.entity',
      label: 'Shared project entity',
      scope: 'project_group_v2',
      channelKind: 'project_v2_entity',
      storageChannel: 'projects/{projectId}/{entity}/*',
      result: { status: 'blocked', reason: 'canonical-unresolved' },
    });

    const kinds = getCollaborationDiagnostics().map((entry) => entry.kind);
    expect(kinds).toContain('listener-error');
    expect(kinds).toContain('listener-snapshot-server');
    expect(kinds).toContain('listener-apply');
    expect(kinds).toContain('mutation-blocked');
  });
});
