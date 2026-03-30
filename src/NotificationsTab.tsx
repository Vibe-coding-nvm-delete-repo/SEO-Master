import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Copy } from 'lucide-react';
import { useToast } from './ToastContext';
import {
  buildNotificationCopyText,
  filterNotifications,
  formatNotificationEasternTime,
  formatNotificationLocalTime,
  NOTIFICATION_SOURCE_LABELS,
  type NotificationSourceFilter,
  type NotificationTypeFilter,
} from './notificationHelpers';
import {
  loadNotificationsFromIDB,
  subscribeNotifications,
  type NotificationEntry,
  type NotificationSource,
} from './notificationStorage';

const typeBadgeClasses: Record<NotificationTypeFilter, string> = {
  all: 'bg-zinc-100 text-zinc-600 border border-zinc-200',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  info: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200',
  error: 'bg-red-50 text-red-700 border border-red-200',
};

const sourceOptions: NotificationSource[] = [
  'group',
  'generate',
  'content',
  'feedback',
  'projects',
  'settings',
  'system',
];

const NotificationsTab: React.FC = () => {
  const { addToast } = useToast();
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<NotificationTypeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<NotificationSourceFilter>('all');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadNotificationsFromIDB().then((cached) => {
      if (cancelled || !cached?.length) return;
      setItems(cached);
    });
    const unsub = subscribeNotifications((next) => {
      setItems(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const filtered = useMemo(
    () => filterNotifications(items, typeFilter, sourceFilter, searchText),
    [items, typeFilter, sourceFilter, searchText],
  );

  const copyNotification = useCallback(async (entry: NotificationEntry) => {
    try {
      await navigator.clipboard.writeText(buildNotificationCopyText(entry));
      addToast('Copied full notification.', 'success', {
        notification: {
          mode: 'none',
          source: 'system',
        },
      });
    } catch (err) {
      console.warn('Copy notification failed:', err);
      addToast('Could not copy notification. Try again.', 'error', {
        notification: {
          mode: 'none',
          source: 'system',
        },
      });
    }
  }, [addToast]);

  return (
    <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-zinc-900">Notifications</h2>
          </div>
          <p className="text-xs text-zinc-500">
            Shared app alerts only. This feed starts collecting from this rollout forward and keeps Updates and the Group activity log separate.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 p-3 bg-zinc-50/80 border border-zinc-100 rounded-lg">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as NotificationTypeFilter)}
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white text-zinc-800"
          aria-label="Filter by notification type"
        >
          <option value="all">All types</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="success">Success</option>
          <option value="info">Info</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as NotificationSourceFilter)}
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white text-zinc-800"
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {NOTIFICATION_SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search message, source, or project…"
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white min-w-[220px] flex-1"
        />
        <span className="text-[11px] text-zinc-500 self-center">
          {filtered.length} / {items.length} shown
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-200 rounded-lg">
          No shared notifications yet. Meaningful alerts will start appearing here from this release forward.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-200 rounded-lg">
          No notifications match your current filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-left text-xs min-w-[980px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2 py-2 whitespace-nowrap">When</th>
                <th className="px-2 py-2 whitespace-nowrap">Type</th>
                <th className="px-2 py-2 whitespace-nowrap">Source</th>
                <th className="px-2 py-2 whitespace-nowrap">Scope</th>
                <th className="px-2 py-2 min-w-[420px]">Notification</th>
                <th className="px-2 py-2 whitespace-nowrap">Copy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((entry) => {
                const typeClass = typeBadgeClasses[entry.type];
                const scopeLabel = entry.projectName || entry.projectId
                  ? `${entry.projectName || 'Unnamed project'}${entry.projectId ? ` (${entry.projectId})` : ''}`
                  : 'Global';
                return (
                  <tr key={entry.id} className="hover:bg-zinc-50/80 align-top">
                    <td className="px-2 py-2 text-zinc-500 whitespace-nowrap">
                      <div>{formatNotificationLocalTime(entry.createdAt)}</div>
                      <div className="text-[11px] text-zinc-400">
                        US Eastern | {formatNotificationEasternTime(entry.createdAt)}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${typeClass}`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-zinc-700 whitespace-nowrap">
                      {NOTIFICATION_SOURCE_LABELS[entry.source]}
                    </td>
                    <td className="px-2 py-2 text-zinc-500 max-w-[220px] break-words">
                      {scopeLabel}
                    </td>
                    <td className="px-2 py-2 text-zinc-800">
                      <p className="whitespace-pre-wrap break-words max-w-[620px]">{entry.message}</p>
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => void copyNotification(entry)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-800 hover:bg-zinc-50 text-[11px] font-medium whitespace-nowrap"
                        title="Copy full notification"
                        aria-label="Copy full notification"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default React.memo(NotificationsTab);
