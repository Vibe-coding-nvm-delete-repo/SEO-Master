import { describe, expect, it } from 'vitest';
import { evaluateSnapshotGuards, type SnapshotGuardInput } from './useProjectPersistence';

const base: SnapshotGuardInput = {
  hasPendingWrites: false,
  isProjectLoading: false,
  isFlushing: false,
  metaClientId: 'other_client',
  ourClientId: 'my_client',
  dataExists: true,
  localResults: 10,
  localGroupedCount: 5,
  localApprovedCount: 2,
  localClusterCount: 8,
  incomingGroupedChunkCount: 5,
  incomingApprovedChunkCount: 2,
  incomingDataGroupedCount: 5,
  incomingDataApprovedCount: 2,
  incomingResultsCount: 10,
  incomingClusterCount: 8,
  loadFence: 0,
  incomingGroupedPageMass: 50,
  incomingSaveId: 100,
  localSaveId: 50,
  incomingFromCache: false,
};

describe('evaluateSnapshotGuards', () => {
  // ── Guard 0: hasPendingWrites ──
  it('Guard 0: skips when hasPendingWrites is true', () => {
    const r = evaluateSnapshotGuards({ ...base, hasPendingWrites: true });
    expect(r).toEqual({ action: 'skip', guard: '0:hasPendingWrites' });
  });

  it('Guard 0: passes when hasPendingWrites is false', () => {
    const r = evaluateSnapshotGuards({ ...base, hasPendingWrites: false });
    expect(r.action).toBe('apply');
  });

  // ── Guard 1a: projectLoading ──
  it('Guard 1a: skips when project is loading', () => {
    const r = evaluateSnapshotGuards({ ...base, isProjectLoading: true });
    expect(r).toEqual({ action: 'skip', guard: '1a:projectLoading' });
  });

  // ── Guard 1b: isFlushing ──
  it('Guard 1b: skips when local flush is in progress', () => {
    const r = evaluateSnapshotGuards({ ...base, isFlushing: true });
    expect(r).toEqual({ action: 'skip', guard: '1b:isFlushing' });
  });

  // ── Guard 2: own echo ──
  it('Guard 2: skips our own save echoes', () => {
    const r = evaluateSnapshotGuards({ ...base, metaClientId: 'my_client' });
    expect(r).toEqual({ action: 'skip', guard: '2:ownEcho' });
  });

  it('Guard 2: passes when clientId differs', () => {
    const r = evaluateSnapshotGuards({ ...base, metaClientId: 'someone_else' });
    expect(r.action).toBe('apply');
  });

  it('Guard 2: passes when metaClientId is null (no meta doc)', () => {
    const r = evaluateSnapshotGuards({ ...base, metaClientId: null });
    expect(r.action).toBe('apply');
  });

  // ── Guard 3: empty snapshot vs local data ──
  it('Guard 3: skips empty snapshot when local has results', () => {
    const r = evaluateSnapshotGuards({ ...base, dataExists: false, localResults: 10 });
    expect(r).toEqual({ action: 'skip', guard: '3:emptySnap_hasResults' });
  });

  it('Guard 3: skips empty snapshot when local has grouped clusters', () => {
    const r = evaluateSnapshotGuards({
      ...base, dataExists: false, localResults: 0, localGroupedCount: 3,
    });
    expect(r).toEqual({ action: 'skip', guard: '3:emptySnap_hasGrouped' });
  });

  it('Guard 3: skips empty snapshot when local has approved groups', () => {
    const r = evaluateSnapshotGuards({
      ...base, dataExists: false, localResults: 0, localGroupedCount: 0, localApprovedCount: 2,
    });
    expect(r).toEqual({ action: 'skip', guard: '3:emptySnap_hasApproved' });
  });

  it('Guard 3: skips empty snapshot when local has cluster summary', () => {
    const r = evaluateSnapshotGuards({
      ...base, dataExists: false, localResults: 0, localGroupedCount: 0,
      localApprovedCount: 0, localClusterCount: 5,
    });
    expect(r).toEqual({ action: 'skip', guard: '3:emptySnap_hasClusters' });
  });

  it('Guard 3: allows empty snapshot when local is also empty', () => {
    const r = evaluateSnapshotGuards({
      ...base, dataExists: false, localResults: 0, localGroupedCount: 0,
      localApprovedCount: 0, localClusterCount: 0,
    });
    expect(r.action).toBe('apply');
  });

  it('Guard 3b: skips effective-empty payload when local has data and snapshot is not authoritative', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      dataExists: true,
      localResults: 10,
      localGroupedCount: 2,
      localApprovedCount: 1,
      localClusterCount: 4,
      incomingResultsCount: 0,
      incomingDataGroupedCount: 0,
      incomingDataApprovedCount: 0,
      incomingClusterCount: 0,
      incomingSaveId: 0,
      localSaveId: 50,
      incomingFromCache: false,
    });
    expect(r).toEqual({ action: 'skip', guard: '3b:effectiveEmpty_hasLocal' });
  });

  it('Guard 3b: allows effective-empty payload only when server-authoritative and newer', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      dataExists: true,
      localResults: 10,
      localGroupedCount: 2,
      localApprovedCount: 1,
      localClusterCount: 4,
      incomingResultsCount: 0,
      incomingDataGroupedCount: 0,
      incomingDataApprovedCount: 0,
      incomingClusterCount: 0,
      incomingGroupedChunkCount: 0,
      incomingApprovedChunkCount: 0,
      incomingSaveId: 70,
      localSaveId: 50,
      incomingFromCache: false,
    });
    expect(r.action).toBe('apply');
  });

  // ── Guard 4: partial multi-batch writes ──
  it('Guard 4: skips partial grouped snapshot (meta expects groups but data has 0)', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingGroupedChunkCount: 5, incomingDataGroupedCount: 0, localGroupedCount: 3,
    });
    expect(r).toEqual({ action: 'skip', guard: '4:partialGrouped' });
  });

  it('Guard 4: skips partial approved snapshot (meta expects approved but data has 0)', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      incomingGroupedChunkCount: 5, incomingDataGroupedCount: 5,
      incomingApprovedChunkCount: 3, incomingDataApprovedCount: 0, localApprovedCount: 2,
    });
    expect(r).toEqual({ action: 'skip', guard: '4:partialApproved' });
  });

  it('Guard 4: passes when incoming grouped data matches meta count', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingGroupedChunkCount: 5, incomingDataGroupedCount: 5, localGroupedCount: 3,
    });
    expect(r.action).toBe('apply');
  });

  it('Guard 4: passes when local has no grouped (nothing to protect)', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingGroupedChunkCount: 5, incomingDataGroupedCount: 0, localGroupedCount: 0,
    });
    expect(r.action).toBe('apply');
  });

  // ── Guard 5: load fence ──
  it('Guard 5: skips when incoming page mass < load fence', () => {
    const r = evaluateSnapshotGuards({
      ...base, loadFence: 100, incomingGroupedPageMass: 50,
    });
    expect(r).toEqual({ action: 'skip', guard: '5:loadFence' });
  });

  it('Guard 5: passes when incoming page mass >= load fence', () => {
    const r = evaluateSnapshotGuards({
      ...base, loadFence: 100, incomingGroupedPageMass: 100,
    });
    expect(r.action).toBe('apply');
  });

  it('Guard 5: passes when load fence is 0 (no fence active)', () => {
    const r = evaluateSnapshotGuards({
      ...base, loadFence: 0, incomingGroupedPageMass: 10,
    });
    expect(r.action).toBe('apply');
  });

  // ── Guard 6: stale saveId ──
  it('Guard 6: skips when incoming saveId < local saveId', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingSaveId: 30, localSaveId: 50,
    });
    expect(r).toEqual({ action: 'skip', guard: '6:staleSaveId' });
  });

  it('Guard 6: passes when incoming saveId > local saveId', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingSaveId: 100, localSaveId: 50,
    });
    expect(r.action).toBe('apply');
  });

  it('Guard 6: passes when incoming saveId == local saveId (equal is not stale)', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingSaveId: 50, localSaveId: 50,
    });
    expect(r.action).toBe('apply');
  });

  it('Guard 6: passes when incoming saveId is 0 (legacy data)', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingSaveId: 0, localSaveId: 50,
    });
    expect(r.action).toBe('apply');
  });

  it('Guard 6: passes when local saveId is 0 (fresh session)', () => {
    const r = evaluateSnapshotGuards({
      ...base, incomingSaveId: 30, localSaveId: 0,
    });
    expect(r.action).toBe('apply');
  });

  // ── REGRESSION: the exact user-reported scenario ──
  it('REGRESSION: ungroup reduces local groups — stale snapshot with MORE groups is rejected by Guard 6', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      incomingSaveId: 40,
      localSaveId: 56,
      incomingDataGroupedCount: 100,
      localGroupedCount: 5,
      incomingGroupedChunkCount: 100,
    });
    expect(r).toEqual({ action: 'skip', guard: '6:staleSaveId' });
  });

  // ── Guard priority: earlier guards win ──
  it('hasPendingWrites takes priority over all other guards', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      hasPendingWrites: true,
      isProjectLoading: true,
      isFlushing: true,
      metaClientId: 'my_client',
    });
    expect(r).toEqual({ action: 'skip', guard: '0:hasPendingWrites' });
  });

  it('projectLoading takes priority over isFlushing', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      isProjectLoading: true,
      isFlushing: true,
    });
    expect(r).toEqual({ action: 'skip', guard: '1a:projectLoading' });
  });

  it('isFlushing takes priority over ownEcho', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      isFlushing: true,
      metaClientId: 'my_client',
    });
    expect(r).toEqual({ action: 'skip', guard: '1b:isFlushing' });
  });

  // ── Happy path: everything passes ──
  it('applies when all guards pass (remote client, valid saveId, no conflicts)', () => {
    const r = evaluateSnapshotGuards(base);
    expect(r).toEqual({ action: 'apply' });
  });

  it('applies for truly empty project (both sides have nothing)', () => {
    const r = evaluateSnapshotGuards({
      ...base,
      dataExists: false,
      localResults: 0,
      localGroupedCount: 0,
      localApprovedCount: 0,
      localClusterCount: 0,
    });
    expect(r).toEqual({ action: 'apply' });
  });
});
