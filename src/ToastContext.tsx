import React, { createContext, useContext, useCallback, useState, useRef, useEffect } from 'react';
import { addNotificationEntry, type NotificationSource } from './notificationStorage';

export type ToastType = 'success' | 'info' | 'warning' | 'error';
export type ToastNotificationMode = 'shared' | 'local' | 'none';

export interface ToastOptions {
  notification?: {
    mode?: ToastNotificationMode;
    source?: NotificationSource;
    copyText?: string;
    projectId?: string | null;
    projectName?: string | null;
  };
}

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAtMs: number;
  duplicateCount?: number;
  exiting?: boolean;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
});

export const useToast = () => useContext(ToastContext);

const MAX_TOASTS = 5;
export const AUTO_DISMISS_MS = 4500;
export const TOAST_EXIT_MS = 220;

function shouldPersistSharedNotification(options?: ToastOptions): boolean {
  return options?.notification?.mode === 'shared';
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastsRef = useRef<Toast[]>([]);
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    toastsRef.current = toasts;
  }, [toasts]);

  useEffect(() => {
    const dismissTimers = dismissTimersRef.current;
    const exitTimers = exitTimersRef.current;
    return () => {
      dismissTimers.forEach(timer => clearTimeout(timer));
      dismissTimers.clear();
      exitTimers.forEach(timer => clearTimeout(timer));
      exitTimers.clear();
    };
  }, []);

  const clearTimersForToast = useCallback((id: string) => {
    const dismissTimer = dismissTimersRef.current.get(id);
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimersRef.current.delete(id);
    }
    const exitTimer = exitTimersRef.current.get(id);
    if (exitTimer) {
      clearTimeout(exitTimer);
      exitTimersRef.current.delete(id);
    }
  }, []);

  const finalizeRemoveToast = useCallback((id: string) => {
    clearTimersForToast(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, [clearTimersForToast]);

  const removeToast = useCallback((id: string) => {
    const current = toastsRef.current.find(t => t.id === id);
    if (!current) {
      clearTimersForToast(id);
      return;
    }
    const dismissTimer = dismissTimersRef.current.get(id);
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimersRef.current.delete(id);
    }
    if (current.exiting || exitTimersRef.current.has(id)) return;
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t)));
    const exitTimer = setTimeout(() => finalizeRemoveToast(id), TOAST_EXIT_MS);
    exitTimersRef.current.set(id, exitTimer);
  }, [clearTimersForToast, finalizeRemoveToast]);

  const addToast = useCallback((message: string, type: ToastType = 'info', options?: ToastOptions) => {
    const createdAtMs = Date.now();
    const existing = toastsRef.current.find(
      toast => toast.message === message && toast.type === type && !toast.exiting,
    );
    const id = existing?.id ?? `toast_${createdAtMs}_${Math.random().toString(36).slice(2, 6)}`;

    if (existing) {
      clearTimersForToast(existing.id);
      setToasts(prev => {
        const current = prev.find(toast => toast.id === existing.id);
        if (!current) return prev;
        return [
          {
            ...current,
            createdAtMs,
            duplicateCount: (current.duplicateCount ?? 1) + 1,
            exiting: false,
          },
          ...prev.filter(toast => toast.id !== existing.id),
        ];
      });
    } else {
      const toast: Toast = { id, message, type, createdAtMs };
      setToasts(prev => {
        const next = [toast, ...prev];
        if (next.length <= MAX_TOASTS) return next;
        const removed = next.slice(MAX_TOASTS);
        removed.forEach(item => clearTimersForToast(item.id));
        return next.slice(0, MAX_TOASTS);
      });
    }

    if (shouldPersistSharedNotification(options)) {
      void addNotificationEntry({
        createdAt: new Date(createdAtMs).toISOString(),
        type,
        source: options?.notification?.source ?? 'system',
        message,
        copyText: options?.notification?.copyText?.trim() || message,
        projectId: options?.notification?.projectId ?? null,
        projectName: options?.notification?.projectName ?? null,
      }).catch((err) => {
        console.warn('Failed to persist notification entry:', err);
      });
    }

    const timer = setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
    dismissTimersRef.current.set(id, timer);
  }, [clearTimersForToast, removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
};
