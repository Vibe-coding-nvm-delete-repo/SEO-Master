import React from 'react';
import type { ActivityLogEntry, ActivityAction } from './types';

const actionStyles: Record<ActivityAction, { label: string; bg: string; text: string }> = {
  'group':           { label: 'Group',     bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'ungroup':         { label: 'Ungroup',   bg: 'bg-orange-100', text: 'text-orange-700' },
  'approve':         { label: 'Approve',   bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'unapprove':       { label: 'Unapprove', bg: 'bg-amber-100', text: 'text-amber-700' },
  'block':           { label: 'Block',     bg: 'bg-red-100', text: 'text-red-700' },
  'unblock':         { label: 'Unblock',   bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'qa-review':       { label: 'QA',        bg: 'bg-blue-100', text: 'text-blue-700' },
  'remove-approved': { label: 'Remove',    bg: 'bg-orange-100', text: 'text-orange-700' },
  'merge':           { label: 'Merge',     bg: 'bg-purple-100', text: 'text-purple-700' },
  'unmerge':         { label: 'Unmerge',   bg: 'bg-purple-100', text: 'text-purple-700' },
  'auto-group':      { label: 'Auto',      bg: 'bg-violet-100', text: 'text-violet-700' },
};

const formatTimestamp = (iso: string): string => {
  try {
    const date = new Date(iso);
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' EST';
  } catch {
    return iso;
  }
};

interface ActivityLogProps {
  entries: ActivityLogEntry[];
  onClear?: () => void;
}

const ActivityLog: React.FC<ActivityLogProps> = React.memo(({ entries, onClear }) => {
  if (entries.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-12 text-center">
        <p className="text-zinc-400 text-sm">No activity yet. Actions like grouping, approving, and blocking will appear here.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-200 bg-zinc-50/50">
        <h3 className="text-sm font-semibold text-zinc-900">Activity Log</h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400">{entries.length} entries</span>
          {onClear && (
            <button
              onClick={onClear}
              className="text-[11px] text-zinc-400 hover:text-red-500 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="overflow-auto max-h-[60vh]">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7]">
            <tr>
              <th className="px-3 py-2 w-[180px]">Time (EST)</th>
              <th className="px-3 py-2 w-[90px]">Action</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2 w-[50px] text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {entries.map(entry => {
              const style = actionStyles[entry.action] || actionStyles['group'];
              return (
                <tr key={entry.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-3 py-1.5 text-zinc-500 tabular-nums whitespace-nowrap">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-zinc-700">{entry.details}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-600 tabular-nums">{entry.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

ActivityLog.displayName = 'ActivityLog';
export default ActivityLog;
