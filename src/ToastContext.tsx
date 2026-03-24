import React, { createContext, useContext, useCallback, useState, useRef } from 'react';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  exiting?: boolean;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
});

export const useToast = () => useContext(ToastContext);

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 4000;
const EXIT_ANIMATION_MS = 300;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Start exit animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    // Remove after animation
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, EXIT_ANIMATION_MS);
    // Clear timer
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const toast: Toast = { id, message, type };

    setToasts(prev => {
      const next = [toast, ...prev];
      // Cap at MAX_TOASTS — remove oldest
      if (next.length > MAX_TOASTS) {
        const removed = next.pop();
        if (removed) {
          const timer = timersRef.current.get(removed.id);
          if (timer) { clearTimeout(timer); timersRef.current.delete(removed.id); }
        }
      }
      return next;
    });

    // Auto-dismiss
    const timer = setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
};
