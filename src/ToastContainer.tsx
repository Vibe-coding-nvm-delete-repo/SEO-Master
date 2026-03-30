import React from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useToast, type Toast, type ToastType } from './ToastContext';

const TOAST_EASTERN_TZ = 'America/New_York';

const typeStyles: Record<ToastType, { border: string; icon: string; bg: string }> = {
  success: { border: 'border-l-emerald-500', icon: 'text-emerald-600', bg: 'bg-emerald-50/90' },
  info:    { border: 'border-l-indigo-500', icon: 'text-indigo-600', bg: 'bg-indigo-50/90' },
  warning: { border: 'border-l-amber-500', icon: 'text-amber-600', bg: 'bg-amber-50/90' },
  error:   { border: 'border-l-red-500', icon: 'text-red-600', bg: 'bg-red-50/90' },
};

const ToastIcon = ({ type }: { type: ToastType }) => {
  const cls = `h-4 w-4 ${typeStyles[type].icon}`;
  if (type === 'success') return <CheckCircle2 className={cls} />;
  return <AlertCircle className={cls} />;
};

const typeLabels: Record<ToastType, string> = {
  success: 'Success',
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

export function formatToastTimeLabels(createdAtMs: number): { localLabel: string; easternLabel: string } {
  const date = new Date(createdAtMs);
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatForZone = (timeZone: string) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  return {
    localLabel: `Local | ${formatForZone(localTz)}`,
    easternLabel: `US Eastern | ${formatForZone(TOAST_EASTERN_TZ)}`,
  };
}

const ToastItem = React.memo(({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) => {
  const styles = typeStyles[toast.type];
  const { localLabel, easternLabel } = formatToastTimeLabels(toast.createdAtMs);
  return (
    <div
      className={`
        pointer-events-auto rounded-xl border border-zinc-200 border-l-[3px] ${styles.border} ${styles.bg}
        bg-white/95 shadow-md backdrop-blur-sm max-w-[352px] min-w-[264px]
        px-2.5 py-2 transition-all duration-200 ease-out
        ${toast.exiting ? 'translate-y-2 scale-[0.98] opacity-0' : 'translate-y-0 scale-100 opacity-100'}
      `}
      role="alert"
      data-state={toast.exiting ? 'exiting' : 'visible'}
    >
      <div className="flex items-start gap-2">
        <ToastIcon type={toast.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="rounded-full border border-zinc-200 bg-white px-1.5 py-[2px] text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                {typeLabels[toast.type]}
              </span>
              {toast.duplicateCount && toast.duplicateCount > 1 ? (
                <span className="rounded-full bg-zinc-900 px-1.5 py-[2px] text-[9px] font-semibold text-white">
                  x{toast.duplicateCount}
                </span>
              ) : null}
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded-md p-0.5 text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-zinc-800 break-words">{toast.message}</p>
          <div className="mt-1.5 space-y-0.5 text-[9px] leading-tight text-zinc-500 tabular-nums">
            <div>{localLabel}</div>
            <div>{easternLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
});
ToastItem.displayName = 'ToastItem';

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[9999] flex max-h-[48vh] flex-col gap-2 overflow-hidden">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
};

export default ToastContainer;
