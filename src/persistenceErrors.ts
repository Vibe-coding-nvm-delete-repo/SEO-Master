/**
 * Shared helpers for persistence / Firestore failures (REFACTOR_PLAN P0.3).
 * Console logs include full context; toasts stay short and user-safe.
 */

import type { ToastOptions } from './ToastContext';

export type PersistToastFn = (
  msg: string,
  type: 'success' | 'info' | 'warning' | 'error',
  options?: ToastOptions,
) => void;

function buildPersistFailureMessage(context: string, err: unknown): string {
  const e = err as any;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const details = code ? ` [${code}]` : '';
  if (code === 'invalid-argument') {
    return `Cloud sync failed (${context})${details}. Firestore rejected the data payload.`;
  }
  return `Cloud sync failed (${context})${details}. Check your connection and try again.`;
}

export function reportPersistFailure(
  addToast: PersistToastFn | undefined,
  context: string,
  err: unknown,
): void {
  console.error(`[PERSIST] ${context}:`, err);
  if (addToast) {
    addToast(buildPersistFailureMessage(context, err), 'error', {
      notification: {
        mode: 'shared',
        source: 'system',
      },
    });
  }
}

export function reportLocalPersistFailure(
  addToast: PersistToastFn | undefined,
  context: string,
  err: unknown,
): void {
  console.error(`[PERSIST][LOCAL] ${context}:`, err);
  if (addToast) {
    const e = err as any;
    const code = typeof e?.code === 'string' ? e.code : undefined;
    const details = code ? ` [${code}]` : '';
    addToast(
      `Local save failed (${context})${details}. Refresh may lose your latest changes.`,
      'error',
      {
        notification: {
          mode: 'local',
          source: 'system',
        },
      },
    );
  }
}

/** Non-toast logging for best-effort paths (e.g. IDB checkpoint). */
export function logPersistError(context: string, err: unknown): void {
  console.error(`[PERSIST] ${context}:`, err);
}

import { WriteBlockedError, EpochMismatchError } from './collabV2WriteGuard';

/**
 * Check if an error is a V2 write guard error (not a crash, but an expected block).
 * Callers can use this to show a toast instead of an error boundary.
 */
export function isV2WriteGuardError(err: unknown): err is WriteBlockedError | EpochMismatchError {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'write-blocked' || code === 'epoch-mismatch';
}

/**
 * Format a V2 error into a user-friendly toast message.
 */
export function formatV2ErrorForUser(err: WriteBlockedError | EpochMismatchError): string {
  if (err instanceof WriteBlockedError) {
    return `Save paused: ${err.message.replace('[V2 Write Guard] ', '')}`;
  }
  if (err instanceof EpochMismatchError) {
    return 'Project data has been refreshed. Your changes will sync with the latest version.';
  }
  return 'An unexpected sync error occurred.';
}
