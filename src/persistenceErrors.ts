/**
 * Shared helpers for persistence / Firestore failures (REFACTOR_PLAN P0.3).
 * Console logs include full context; toasts stay short and user-safe.
 */

import type { ToastOptions } from './ToastContext';
import type { NotificationSource } from './notificationStorage';

export type PersistToastFn = (
  msg: string,
  type: 'success' | 'info' | 'warning' | 'error',
  options?: ToastOptions,
) => void;

type PersistErrorKind =
  | 'invalid-argument'
  | 'permission-denied'
  | 'unavailable'
  | 'other';

export interface PersistErrorInfo {
  code?: string;
  kind: PersistErrorKind;
  step?: string;
}

export interface PersistFailureOptions {
  channel?: 'write' | 'listener' | 'lock' | 'legacy-mirror';
  projectId?: string | null;
  projectName?: string | null;
  notificationSource?: NotificationSource;
}

function normalizePersistErrorCode(code: unknown): string | undefined {
  if (typeof code !== 'string' || !code.trim()) return undefined;
  return code.startsWith('firestore/') ? code.slice('firestore/'.length) : code;
}

export function getPersistErrorInfo(err: unknown): PersistErrorInfo {
  const e = err as { code?: unknown; persistStep?: unknown } | null | undefined;
  const code = normalizePersistErrorCode(e?.code);
  const step = typeof e?.persistStep === 'string' && e.persistStep.trim() ? e.persistStep : undefined;
  if (code === 'invalid-argument') {
    return { code, kind: 'invalid-argument', step };
  }
  if (code === 'permission-denied') {
    return { code, kind: 'permission-denied', step };
  }
  if (code === 'unavailable') {
    return { code, kind: 'unavailable', step };
  }
  return { code, kind: 'other', step };
}

export function tagPersistErrorStep(err: unknown, step: string): Error {
  const source = err as { code?: unknown; message?: unknown } | null | undefined;
  const tagged = (err instanceof Error
    ? err
    : new Error(
      typeof err === 'string'
        ? err
        : typeof source?.message === 'string' && source.message.trim()
          ? source.message
          : 'Unknown persistence error',
    )) as Error & {
    code?: string;
    persistStep?: string;
    cause?: unknown;
  };
  const code = normalizePersistErrorCode(source?.code);
  if (code) {
    tagged.code = code;
  }
  tagged.persistStep = step;
  if (tagged.cause === undefined && err !== tagged) {
    tagged.cause = err;
  }
  return tagged;
}

function buildPersistFailureMessage(context: string, err: unknown, options?: PersistFailureOptions): string {
  const errorInfo = getPersistErrorInfo(err);
  const details = errorInfo.code ? ` [${errorInfo.code}]` : '';
  const channel = options?.channel ?? 'write';
  if (errorInfo.kind === 'invalid-argument') {
    if (channel === 'legacy-mirror') {
      return `Cloud mirror save failed (${context})${details}. Firestore rejected the legacy project snapshot payload. Latest state is still cached locally.`;
    }
    return `Cloud sync failed (${context})${details}. Firestore rejected the data payload.`;
  }
  if (errorInfo.kind === 'permission-denied') {
    if (channel === 'listener') {
      return `Shared sync listener blocked (${context})${details}. Firestore denied access to this shared channel.`;
    }
    if (channel === 'lock') {
      return `Project lock sync blocked (${context})${details}. Firestore denied the operation-lock update.`;
    }
    if (channel === 'legacy-mirror') {
      return `Cloud mirror save blocked (${context})${details}. Firestore denied the legacy project snapshot write. Latest state is still cached locally, but it was not mirrored to the cloud.`;
    }
    return `Cloud sync blocked (${context})${details}. Firestore denied this write. Check shared-project recovery or deployed rules.`;
  }
  if (channel === 'listener') {
    return `Shared sync listener failed (${context})${details}. Check your connection and try again.`;
  }
  if (channel === 'lock') {
    return `Project lock sync failed (${context})${details}. Check your connection and try again.`;
  }
  if (channel === 'legacy-mirror') {
    return `Cloud mirror save failed (${context})${details}. Latest state is still cached locally, but it was not mirrored to the cloud.`;
  }
  return `Cloud sync failed (${context})${details}. Check your connection and try again.`;
}

export function reportPersistFailure(
  addToast: PersistToastFn | undefined,
  context: string,
  err: unknown,
  options?: PersistFailureOptions,
): void {
  console.error(`[PERSIST] ${context}:`, err);
  if (addToast) {
    addToast(buildPersistFailureMessage(context, err, options), 'error', {
      notification: {
        mode: 'shared',
        source: options?.notificationSource ?? 'system',
        projectId: options?.projectId ?? null,
        projectName: options?.projectName ?? null,
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
