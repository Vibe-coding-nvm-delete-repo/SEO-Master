import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  FolderOpen,
  Info,
  ListTree,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { CloudSyncDerived, CloudStatusTone } from './cloudSyncStatus';
import { WORKSPACE_FIRESTORE_DATABASE_ID } from './firestoreDbConfig';

/** Panel wrapper for `InlineHelpHint` — matches app cards; no inner padding (body handles layout). */
export const CLOUD_STATUS_TOOLTIP_PANEL_CLASS =
  'z-[100] bg-white border border-zinc-200 rounded-xl shadow-md max-w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden pointer-events-none';

function Row({
  icon: Icon,
  label,
  children,
  iconClass = 'text-zinc-400',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  iconClass?: string;
}) {
  return (
    <div className="flex gap-2.5 items-start">
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconClass}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
        <div className="text-[10px] text-zinc-700 leading-snug mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function valueToneClass(tone: 'ok' | 'warn' | 'err' | 'muted'): string {
  switch (tone) {
    case 'ok':
      return 'text-emerald-700 font-medium';
    case 'warn':
      return 'text-amber-800 font-medium';
    case 'err':
      return 'text-rose-700 font-medium';
    default:
      return 'text-zinc-700';
  }
}

export type CloudStatusTooltipBodyProps = {
  browserOnline: boolean;
  snap: CloudSyncDerived;
  hasActiveProject: boolean;
  activeProjectId: string | null;
  statusLabel: string;
  tone: CloudStatusTone;
};

/**
 * Rich layout for the app bar connection tooltip — icons, sections, light theme accents.
 */
export default function CloudStatusTooltipBody({
  browserOnline,
  snap,
  hasActiveProject,
  activeProjectId,
  statusLabel,
  tone,
}: CloudStatusTooltipBodyProps) {
  const headerAccent =
    tone === 'emerald'
      ? 'from-emerald-50 to-white'
      : tone === 'rose'
        ? 'from-rose-50 to-white'
        : tone === 'amber'
          ? 'from-amber-50/80 to-white'
          : 'from-zinc-50 to-white';

  const headerIconClass =
    tone === 'emerald'
      ? 'text-emerald-600'
      : tone === 'rose'
        ? 'text-rose-600'
        : tone === 'amber'
          ? 'text-amber-600'
          : 'text-indigo-600';

  return (
    <div className="text-left">
      <div
        className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-zinc-100 bg-gradient-to-r ${headerAccent}`}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 border border-zinc-200/80 shadow-sm ${headerIconClass}`}
        >
          <ShieldCheck className="w-4 h-4" strokeWidth={2} aria-hidden />
        </div>
        <div className="min-w-0 pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Cloud className="w-3.5 h-3.5 text-indigo-500 shrink-0" aria-hidden />
            <span className="text-[11px] font-semibold text-zinc-900 tracking-tight">
              Connection diagnostics
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
            Summary: <span className="text-zinc-800 font-medium">{statusLabel}</span>
          </p>
          <p className="text-[9px] text-zinc-400 mt-1 leading-tight flex items-center gap-1">
            <Info className="w-3 h-3 shrink-0" aria-hidden />
            This browser only — details update live when you open other tabs.
          </p>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-3 bg-zinc-50/40">
        <Row icon={browserOnline ? Wifi : WifiOff} label="Network" iconClass={browserOnline ? 'text-emerald-500' : 'text-amber-500'}>
          <span className={valueToneClass(browserOnline ? 'ok' : 'warn')}>
            {browserOnline ? 'Online' : 'Offline'}
          </span>
        </Row>

        <Row icon={Database} label="Firestore" iconClass="text-indigo-500">
          <span className="font-mono text-[10px] text-zinc-800">{WORKSPACE_FIRESTORE_DATABASE_ID}</span>
        </Row>

        <Row icon={Server} label="Server data" iconClass={snap.serverReachable ? 'text-emerald-500' : 'text-amber-500'}>
          <span className={valueToneClass(snap.serverReachable ? 'ok' : 'warn')}>
            {snap.serverReachable
              ? 'Reached (snapshot not cache-only)'
              : 'Not yet — waiting or offline cache'}
          </span>
        </Row>

        <Row icon={FolderOpen} label="Project workspace" iconClass="text-indigo-400">
          {hasActiveProject ? (
            <span className="text-zinc-800 break-all">
              {activeProjectId ? (
                <>
                  Open <span className="font-mono text-[9px] text-indigo-700">{activeProjectId}</span>
                </>
              ) : (
                'Open'
              )}
            </span>
          ) : (
            <span className="text-zinc-500">None selected</span>
          )}
        </Row>

        <Row
          icon={snap.projectFlushDepth > 0 ? Loader2 : RefreshCw}
          label="Cloud save queue"
          iconClass={snap.projectFlushDepth > 0 ? 'text-amber-500 animate-spin' : 'text-zinc-400'}
        >
          <span className={valueToneClass(snap.projectFlushDepth > 0 ? 'warn' : 'muted')}>
            {snap.projectFlushDepth > 0
              ? `Writing (${snap.projectFlushDepth} active)`
              : 'Idle'}
          </span>
        </Row>

        <Row
          icon={hasActiveProject && snap.projectDataWriteFailed ? AlertCircle : CheckCircle2}
          label="Latest project save"
          iconClass={
            !hasActiveProject
              ? 'text-zinc-400'
              : snap.projectDataWriteFailed
                ? 'text-rose-500'
                : 'text-emerald-500'
          }
        >
          {!hasActiveProject ? (
            <span className="text-zinc-400">—</span>
          ) : snap.projectDataWriteFailed ? (
            <span className={valueToneClass('err')}>Failed — retry when online</span>
          ) : (
            <span className={valueToneClass('ok')}>Succeeded</span>
          )}
        </Row>

        <div className="rounded-lg border border-zinc-200/80 bg-white px-2.5 py-2 shadow-sm">
          <Row
            icon={snap.listenerErrors.length ? AlertCircle : ListTree}
            label="Listener channels"
            iconClass={snap.listenerErrors.length ? 'text-rose-500' : 'text-emerald-500'}
          >
            {snap.listenerErrors.length > 0 ? (
              <span className={valueToneClass('err')}>
                {snap.listenerErrors.length} error(s): {snap.listenerErrors.join(', ')}
              </span>
            ) : (
              <span className={valueToneClass('ok')}>No errors on active subscriptions</span>
            )}
          </Row>
        </div>
      </div>
    </div>
  );
}
