/**
 * Shared helpers for persistence / Firestore failures (REFACTOR_PLAN P0.3).
 * Console logs include full context; toasts stay short and user-safe.
 */

export type PersistToastFn = (
  msg: string,
  type: 'success' | 'info' | 'warning' | 'error',
) => void;

export function reportPersistFailure(
  addToast: PersistToastFn | undefined,
  context: string,
  err: unknown,
): void {
  console.error(`[PERSIST] ${context}:`, err);
  if (addToast) {
    const e = err as any;
    const code = typeof e?.code === 'string' ? e.code : undefined;
    const details = code ? ` [${code}]` : '';
    addToast(
      `Cloud sync failed (${context})${details}. Check your connection and try again.`,
      'error',
    );
  }
}

/** Non-toast logging for best-effort paths (e.g. IDB checkpoint). */
export function logPersistError(context: string, err: unknown): void {
  console.error(`[PERSIST] ${context}:`, err);
}
