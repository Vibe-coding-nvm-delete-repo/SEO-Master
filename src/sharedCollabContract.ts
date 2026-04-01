import type { Unsubscribe } from 'firebase/firestore';
import {
  recordCollaborationListenerApply,
  recordCollaborationMutationResult,
} from './cloudSyncStatus';
import {
  failedSharedMutation,
  SHARED_MUTATION_ACCEPTED,
  type SharedMutationReason,
  type SharedMutationResult,
} from './sharedMutation';
import type { SharedActionRegistryEntry } from './sharedCollaboration';

export type SharedListenerSubscription = () => Unsubscribe;

function normalizeMutationError(err: unknown): SharedMutationReason {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
  const message = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message ?? '') : '';
  if (code.includes('permission-denied')) return 'permission-denied';
  if (message.includes('permission-denied')) return 'permission-denied';
  if (message.includes('schema-too-old')) return 'schema-too-old';
  if (message.includes('canonical-unresolved')) return 'canonical-unresolved';
  if (message.includes('canonical-invalid')) return 'canonical-invalid';
  if (message.includes('recovery-failed')) return 'recovery-failed';
  return 'unknown';
}

function normalizeMutationResult(result: SharedMutationResult | void): SharedMutationResult {
  if (result === undefined) return SHARED_MUTATION_ACCEPTED;
  return result as SharedMutationResult;
}

export async function performSharedMutation(
  entry: SharedActionRegistryEntry,
  execute: () => Promise<SharedMutationResult | void> | SharedMutationResult | void,
): Promise<SharedMutationResult> {
  try {
    const result = normalizeMutationResult(await execute());
    recordCollaborationMutationResult({
      actionId: entry.id,
      label: entry.label,
      scope: entry.scope,
      channelKind: entry.channelKind,
      storageChannel: entry.storageChannel,
      result,
    });
    return result;
  } catch (error) {
    const result = failedSharedMutation(normalizeMutationError(error));
    recordCollaborationMutationResult({
      actionId: entry.id,
      label: entry.label,
      scope: entry.scope,
      channelKind: entry.channelKind,
      storageChannel: entry.storageChannel,
      result,
    });
    throw error;
  }
}

export function subscribeSharedChannel(
  _entry: SharedActionRegistryEntry,
  subscribe: SharedListenerSubscription,
): Unsubscribe {
  const unsubscribe = subscribe();
  return () => {
    unsubscribe();
  };
}

export function trackSharedListenerApply(entry: SharedActionRegistryEntry): void {
  recordCollaborationListenerApply({
    actionId: entry.id,
    label: entry.label,
    scope: entry.scope,
    channelKind: entry.channelKind,
    storageChannel: entry.storageChannel,
  });
}
