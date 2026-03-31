export type SharedMutationReason =
  | 'permission-denied'
  | 'lock-conflict'
  | 'revision-conflict'
  | 'schema-too-old'
  | 'canonical-unresolved'
  | 'canonical-invalid'
  | 'recovery-failed'
  | 'unknown';

export type SharedMutationResult =
  | { status: 'accepted' }
  | { status: 'blocked'; reason: SharedMutationReason }
  | { status: 'failed'; reason: SharedMutationReason };

export const SHARED_MUTATION_ACCEPTED: SharedMutationResult = { status: 'accepted' };

export function blockedSharedMutation(reason: SharedMutationReason): SharedMutationResult {
  return { status: 'blocked', reason };
}

export function failedSharedMutation(reason: SharedMutationReason): SharedMutationResult {
  return { status: 'failed', reason };
}

export function isAcceptedSharedMutation(result: SharedMutationResult): result is { status: 'accepted' } {
  return result.status === 'accepted';
}
