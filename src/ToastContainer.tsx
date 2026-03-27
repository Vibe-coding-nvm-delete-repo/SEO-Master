import React from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useToast, type Toast, type ToastType } from './ToastContext';

const typeStyles: Record<ToastType, { border: string; icon: string; bg: string }> = {
  success: { border: 'border-l-emerald-500', icon: 'text-emerald-500', bg: 'bg-emerald-50' },
  info:    { border: 'border-l-indigo-500', icon: 'text-indigo-500', bg: 'bg-indigo-50' },
  warning: { border: 'border-l-amber-500', icon: 'text-amber-500', bg: 'bg-amber-50' },
  error:   { border: 'border-l-red-500', icon: 'text-red-500', bg: 'bg-red-50' },
};

const ToastIcon = ({ type }: { type: ToastType }) => {
  const cls = `w-3.5 h-3.5 ${typeStyles[type].icon}`;
  if (type === 'success') return <CheckCircle2 className={cls} />;
  return <AlertCircle className={cls} />;
};

const ToastItem = React.memo(({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) => {
  const styles = typeStyles[toast.type];
  return (
    <div
      className={`
        flex items-start gap-2 px-2 py-1.5 rounded-md border-l-3 ${styles.border} ${styles.bg}
        bg-white shadow-sm border border-zinc-200 max-w-[320px] min-w-[240px]
      `}
      role="alert"
    >
      <ToastIcon type={toast.type} />
      <p className="flex-1 text-[11px] text-zinc-700 leading-snug">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-0.5 text-zinc-400 hover:text-zinc-600 shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});
ToastItem.displayName = 'ToastItem';

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 pointer-events-auto max-h-[40vh] overflow-hidden">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};

export default ToastContainer;
