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
