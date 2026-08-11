import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendCollaborationDiagnostic,
  clearCollaborationDiagnostics,
  getCollaborationDiagnostics,
} from './collabDiagnosticsLog';

describe('collabDiagnosticsLog', () => {
  beforeEach(() => {
    clearCollaborationDiagnostics();
  });

  it('persists and reads diagnostics with session/run context', () => {
    appendCollaborationDiagnostic({
      kind: 'mutation-accepted',
      projectId: 'project-1',
      actionId: 'project_v2.entity',
      channelId: 'project_chunks',
      data: { reason: 'ok' },
    });

    const entries = getCollaborationDiagnostics();
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('mutation-accepted');
    expect(entries[0]?.projectId).toBe('project-1');
    expect(entries[0]?.sessionId).toBeTruthy();
    expect(entries[0]?.runId).toBeTruthy();
  });

  it('clears diagnostics', () => {
    appendCollaborationDiagnostic({ kind: 'listener-error', channelId: 'project_chunks' });
    expect(getCollaborationDiagnostics().length).toBe(1);
    clearCollaborationDiagnostics();
    expect(getCollaborationDiagnostics().length).toBe(0);
  });
});
