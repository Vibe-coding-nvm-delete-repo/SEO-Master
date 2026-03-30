import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
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
  'z-[100] bg-white border border-zinc-200 rounded-xl shadow-md max-w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden pointer-events-none';

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

function formatTimestamp(value: number | null): string {
  if (value == null) return 'None yet this session';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export type CloudStatusTooltipBodyProps = {
  browserOnline: boolean;
  snap: CloudSyncDerived;
  hasActiveProject: boolean;
  activeProjectId: string | null;
  statusLabel: string;
  statusDetail?: string;
  tone: CloudStatusTone;
};

export default function CloudStatusTooltipBody({
  browserOnline,
  snap,
  hasActiveProject,
  activeProjectId,
  statusLabel,
  statusDetail,
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

  const projectWritesPending = Math.max(snap.project.flushDepth, snap.project.cloudWritePendingCount);
  const sharedWritesPending = snap.shared.cloudWritePendingCount;

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
            Summary:{' '}
            <span className="text-zinc-800 font-medium">
              {statusLabel}
              {statusDetail ? <span className="text-zinc-500 font-normal"> {statusDetail}</span> : null}
            </span>
          </p>
          <p className="text-[9px] text-zinc-400 mt-1 leading-tight flex items-center gap-1">
            <Info className="w-3 h-3 shrink-0" aria-hidden />
            This tab only — the headline prioritizes the open project when one is selected.
          </p>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-3 bg-zinc-50/40">
        <Row
          icon={browserOnline ? Wifi : WifiOff}
          label="Network"
          iconClass={browserOnline ? 'text-emerald-500' : 'text-amber-500'}
        >
          <span className={valueToneClass(browserOnline ? 'ok' : 'warn')}>
            {browserOnline ? 'Online' : 'Offline'}
          </span>
        </Row>

        <Row icon={Database} label="Firestore" iconClass="text-indigo-500">
          <span className="font-mono text-[10px] text-zinc-800">{WORKSPACE_FIRESTORE_DATABASE_ID}</span>
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
          icon={Server}
          label="Project server path"
          iconClass={snap.project.serverReachable ? 'text-emerald-500' : 'text-amber-500'}
        >
          <span className={valueToneClass(snap.project.serverReachable ? 'ok' : 'warn')}>
            {snap.project.serverReachable
              ? 'Reached (project snapshot not cache-only)'
              : 'Not yet — waiting or cache-only'}
          </span>
        </Row>

        <Row
          icon={Server}
          label="Workspace server path"
          iconClass={snap.shared.serverReachable ? 'text-emerald-500' : 'text-amber-500'}
        >
          <span className={valueToneClass(snap.shared.serverReachable ? 'ok' : 'warn')}>
            {snap.shared.serverReachable
              ? 'Reached (core workspace snapshot not cache-only)'
              : 'Not yet — waiting or cache-only'}
          </span>
        </Row>

        <Row
          icon={Server}
          label="Auxiliary server path"
          iconClass={snap.auxiliary.serverReachable ? 'text-emerald-500' : 'text-zinc-400'}
        >
          <span className={valueToneClass(snap.auxiliary.serverReachable ? 'ok' : 'muted')}>
            {snap.auxiliary.serverReachable ? 'Reached by at least one auxiliary listener' : 'No auxiliary server snapshot yet'}
          </span>
        </Row>

        <Row
          icon={snap.unsafeToRefresh || snap.local.failed ? AlertCircle : CheckCircle2}
          label="Refresh safety"
          iconClass={snap.unsafeToRefresh || snap.local.failed ? 'text-amber-500' : 'text-emerald-500'}
        >
          <span className={valueToneClass(snap.unsafeToRefresh || snap.local.failed ? 'warn' : 'ok')}>
            {snap.local.failed
              ? 'At risk until a local save succeeds'
              : snap.unsafeToRefresh
                ? `Unsafe — ${snap.local.pendingCount} local write pending`
                : 'Safe to refresh'}
          </span>
        </Row>

        <Row
          icon={snap.local.pendingCount > 0 ? Loader2 : snap.local.failed ? AlertCircle : CheckCircle2}
          label="Local durability"
          iconClass={
            snap.local.pendingCount > 0
              ? 'text-amber-500 animate-spin'
              : snap.local.failed
                ? 'text-rose-500'
                : 'text-emerald-500'
          }
        >
          <div className="space-y-0.5">
            <div>
              {snap.local.pendingCount > 0 ? (
                <span className={valueToneClass('warn')}>Writing ({snap.local.pendingCount} pending)</span>
              ) : snap.local.failed ? (
                <span className={valueToneClass('err')}>Failed — refresh may lose changes</span>
              ) : (
                <span className={valueToneClass('ok')}>Succeeded</span>
              )}
            </div>
            <div className="text-[9px] text-zinc-500">
              Last local save: {formatTimestamp(snap.local.lastWriteOkAtMs)}
            </div>
          </div>
        </Row>

        {hasActiveProject ? (
          <Row
            icon={projectWritesPending > 0 ? Loader2 : snap.project.writeFailed ? AlertCircle : RefreshCw}
            label="Project cloud writes"
            iconClass={
              projectWritesPending > 0
                ? 'text-amber-500 animate-spin'
                : snap.project.writeFailed
                  ? 'text-rose-500'
                  : 'text-zinc-400'
            }
          >
            {projectWritesPending > 0 ? (
              <span className={valueToneClass('warn')}>Writing ({projectWritesPending} pending)</span>
            ) : snap.project.writeFailed ? (
              <span className={valueToneClass('err')}>Failed — needs attention</span>
            ) : (
              <span className={valueToneClass('ok')}>Idle / succeeded</span>
            )}
          </Row>
        ) : null}

        <Row
          icon={sharedWritesPending > 0 ? Loader2 : snap.shared.writeFailed ? AlertCircle : RefreshCw}
          label="Shared-doc writes"
          iconClass={
            sharedWritesPending > 0
              ? 'text-amber-500 animate-spin'
              : snap.shared.writeFailed
                ? 'text-rose-500'
                : 'text-zinc-400'
          }
        >
          {sharedWritesPending > 0 ? (
            <span className={valueToneClass('warn')}>Writing ({sharedWritesPending} pending)</span>
          ) : snap.shared.writeFailed ? (
            <span className={valueToneClass('err')}>Failed — next save required</span>
          ) : (
            <span className={valueToneClass('ok')}>Idle / succeeded</span>
          )}
        </Row>

        {hasActiveProject ? (
          <Row
            icon={Clock}
            label="Last project cloud sync"
            iconClass={snap.project.lastCloudWriteOkAtMs ? 'text-emerald-500' : 'text-zinc-400'}
          >
            <span className={snap.project.lastCloudWriteOkAtMs ? valueToneClass('ok') : 'text-zinc-500'}>
              {formatTimestamp(snap.project.lastCloudWriteOkAtMs)}
            </span>
          </Row>
        ) : null}

        <Row
          icon={Clock}
          label={hasActiveProject ? 'Last shared-doc sync' : 'Last workspace cloud sync'}
          iconClass={snap.shared.lastCloudWriteOkAtMs ? 'text-emerald-500' : 'text-zinc-400'}
        >
          <span className={snap.shared.lastCloudWriteOkAtMs ? valueToneClass('ok') : 'text-zinc-500'}>
            {formatTimestamp(snap.shared.lastCloudWriteOkAtMs)}
          </span>
        </Row>

        <div className="rounded-lg border border-zinc-200/80 bg-white px-2.5 py-2 shadow-sm space-y-2.5">
          <Row
            icon={snap.listeners.criticalErrors.length ? AlertCircle : ListTree}
            label="Critical listeners"
            iconClass={snap.listeners.criticalErrors.length ? 'text-rose-500' : 'text-emerald-500'}
          >
            {snap.listeners.criticalErrors.length > 0 ? (
              <span className={valueToneClass('err')}>
                {snap.listeners.criticalErrors.length} error(s):{' '}
                {snap.listeners.criticalErrors.map((channel) => channel.label).join(', ')}
              </span>
            ) : (
              <span className={valueToneClass('ok')}>No critical listener errors</span>
            )}
          </Row>

          <Row
            icon={snap.listeners.auxiliaryErrors.length ? AlertCircle : ListTree}
            label="Auxiliary listeners"
            iconClass={snap.listeners.auxiliaryErrors.length ? 'text-amber-500' : 'text-emerald-500'}
          >
            {snap.listeners.auxiliaryErrors.length > 0 ? (
              <span className={valueToneClass('warn')}>
                {snap.listeners.auxiliaryErrors.length} error(s):{' '}
                {snap.listeners.auxiliaryErrors.map((channel) => channel.label).join(', ')}
              </span>
            ) : (
              <span className={valueToneClass('ok')}>No auxiliary listener errors</span>
            )}
          </Row>
        </div>
      </div>
    </div>
  );
}
