import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react';
import { useToast } from './ToastContext';
import {
  buildNotificationCopyText,
  computeNotificationStats,
  filterNotifications,
  formatNotificationEasternTime,
  formatNotificationLocalTime,
  formatRelativeTime,
  humanizeNotification,
  NOTIFICATION_SOURCE_LABELS,
  type NotificationSourceFilter,
  type NotificationStats,
  type NotificationTypeFilter,
} from './notificationHelpers';
import {
  loadNotificationsFromIDB,
  subscribeNotifications,
  type NotificationEntry,
  type NotificationSource,
  type NotificationType,
} from './notificationStorage';

const PAGE_SIZE = 50;
const TRUNCATE_LENGTH = 120;

const typeBadgeClasses: Record<NotificationTypeFilter, string> = {
  all: 'bg-zinc-100 text-zinc-600 border border-zinc-200',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  info: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200',
  error: 'bg-red-50 text-red-700 border border-red-200',
};

const statBadgeClasses: Record<NotificationType, string> = {
  error: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  warning: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
  info: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
};

const statLabels: Record<NotificationType, string> = {
  error: 'errors',
  warning: 'warnings',
  success: 'success',
  info: 'info',
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
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const setTypeFilterAndReset = useCallback((v: NotificationTypeFilter) => {
    setTypeFilter(v);
    setCurrentPage(1);
  }, []);
  const setSourceFilterAndReset = useCallback((v: NotificationSourceFilter) => {
    setSourceFilter(v);
    setCurrentPage(1);
  }, []);
  const setSearchTextAndReset = useCallback((v: string) => {
    setSearchText(v);
    setCurrentPage(1);
  }, []);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;

  const paginated = useMemo(
    () => filtered.slice(startIdx, endIdx),
    [filtered, startIdx, endIdx],
  );

  const stats = useMemo(() => computeNotificationStats(items), [items]);

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

  const toggleRow = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleStatClick = useCallback((type: NotificationType) => {
    setTypeFilter((prev) => (prev === type ? 'all' : type));
    setCurrentPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setTypeFilter('all');
    setSourceFilter('all');
    setSearchText('');
    setCurrentPage(1);
  }, []);

  const hasActiveFilters = typeFilter !== 'all' || sourceFilter !== 'all' || searchText.trim() !== '';

  return (
    <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
      {/* Header */}
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

      {/* Stats bar */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {(Object.keys(statLabels) as NotificationType[]).map((type) => {
            const count = stats[type as keyof NotificationStats];
            if (count === 0) return null;
            const isActive = typeFilter === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => handleStatClick(type)}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border transition-all cursor-pointer ${statBadgeClasses[type]} ${isActive ? 'ring-1 ring-offset-1 ring-zinc-400' : ''}`}
                title={`${isActive ? 'Clear filter' : `Show only ${statLabels[type]}`}`}
              >
                {count} {statLabels[type]}
              </button>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 p-3 bg-zinc-50/80 border border-zinc-100 rounded-lg">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilterAndReset(e.target.value as NotificationTypeFilter)}
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
          onChange={(e) => setSourceFilterAndReset(e.target.value as NotificationSourceFilter)}
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
          onChange={(e) => setSearchTextAndReset(e.target.value)}
          placeholder="Search message, source, or project\u2026"
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white min-w-[220px] flex-1"
        />
        <span className="text-[11px] text-zinc-500 self-center">
          {filtered.length === items.length
            ? `${items.length} total`
            : `${filtered.length} of ${items.length} match`}
        </span>
      </div>

      {/* Content */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center py-12 border border-dashed border-zinc-200 rounded-lg">
          <Bell className="w-8 h-8 text-zinc-300 mb-3" />
          <p className="text-sm font-medium text-zinc-600 mb-1">No notifications yet</p>
          <p className="text-xs text-zinc-400 max-w-xs text-center">
            Shared alerts will appear here as you and your team use the app. Actions like syncing data, merging groups, and saving feedback are logged automatically.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 border border-dashed border-zinc-200 rounded-lg">
          <Search className="w-8 h-8 text-zinc-300 mb-3" />
          <p className="text-sm font-medium text-zinc-600 mb-1">No matching notifications</p>
          <p className="text-xs text-zinc-400 mb-3">Try adjusting your filters or search text.</p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 px-3 py-1 rounded-md border border-indigo-200 hover:bg-indigo-50 transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <>
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
                {paginated.map((entry) => {
                  const typeClass = typeBadgeClasses[entry.type];
                  const scopeLabel = entry.projectName || entry.projectId
                    ? `${entry.projectName || 'Unnamed project'}${entry.projectId ? ` (${entry.projectId})` : ''}`
                    : 'Global';
                  const humanized = humanizeNotification(entry.message);
                  const isLong = entry.message.length > TRUNCATE_LENGTH;
                  const isExpanded = expandedRows.has(entry.id);
                  const showFull = !isLong || isExpanded;

                  return (
                    <tr key={entry.id} className="hover:bg-zinc-50/80 align-top">
                      <td className="px-2 py-2 text-zinc-500 whitespace-nowrap">
                        <div className="text-zinc-700 font-medium">{formatRelativeTime(entry.createdAt)}</div>
                        <div className="text-[11px] text-zinc-400">{formatNotificationLocalTime(entry.createdAt)}</div>
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
                        <div className="max-w-[620px]">
                          {isLong && !isExpanded ? (
                            <button
                              type="button"
                              onClick={() => toggleRow(entry.id)}
                              className="text-left w-full group"
                            >
                              <p className="whitespace-pre-wrap break-words">
                                {entry.message.slice(0, TRUNCATE_LENGTH)}&hellip;
                                <span className="text-indigo-500 text-[11px] ml-1 group-hover:underline inline-flex items-center gap-0.5">
                                  more <ChevronRight className="w-3 h-3" />
                                </span>
                              </p>
                            </button>
                          ) : (
                            <>
                              <p className="whitespace-pre-wrap break-words">{entry.message}</p>
                              {isLong && (
                                <button
                                  type="button"
                                  onClick={() => toggleRow(entry.id)}
                                  className="text-indigo-500 text-[11px] mt-0.5 hover:underline inline-flex items-center gap-0.5"
                                >
                                  less <ChevronDown className="w-3 h-3 rotate-180" />
                                </button>
                              )}
                            </>
                          )}
                          {(showFull || !isLong) && humanized && (
                            <p className="text-[11px] text-zinc-400 italic mt-0.5">{humanized}</p>
                          )}
                        </div>
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-[11px] text-zinc-500">
                Showing {startIdx + 1}&ndash;{Math.min(endIdx, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-800 hover:bg-zinc-50 text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </button>
                <span className="text-[11px] text-zinc-600 px-2">
                  Page {safeCurrentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-800 hover:bg-zinc-50 text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default React.memo(NotificationsTab);
