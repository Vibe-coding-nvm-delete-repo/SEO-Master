import React, { useEffect, useState } from 'react';
import { History, Tag, Calendar } from 'lucide-react';
import { subscribeChangelog, subscribeBuildName, type ChangelogEntry } from './changelogStorage';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

const UpdatesTab: React.FC = () => {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [buildName, setBuildName] = useState('');

  useEffect(() => {
    const unsub = subscribeChangelog(setEntries);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeBuildName(setBuildName);
    return unsub;
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Current build header */}
      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Tag className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">Current Build</p>
            <p className="text-sm font-semibold text-zinc-900">
              {buildName || <span className="text-zinc-400 italic font-normal">No build name set</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Changelog entries */}
      {entries.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-8 text-center">
          <History className="w-8 h-8 text-zinc-300 mx-auto mb-2" aria-hidden />
          <p className="text-sm text-zinc-500">No updates logged yet.</p>
          <p className="text-xs text-zinc-400 mt-1">Entries will appear here after each code change session.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4"
            >
              {/* Header row: build name + date */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {entry.buildName && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      {entry.buildName}
                    </span>
                  )}
                  <p className="text-sm font-medium text-zinc-900 truncate">{entry.summary}</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-400 shrink-0">
                  <Calendar className="w-3 h-3" aria-hidden />
                  <span>{formatDate(entry.timestamp)}</span>
                  <span className="text-zinc-300 mx-0.5">&middot;</span>
                  <span>{formatTime(entry.timestamp)}</span>
                </div>
              </div>

              {/* Change list */}
              {entry.changes.length > 0 && (
                <ul className="space-y-1 mt-2">
                  {entry.changes.map((change, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-zinc-600">
                      <span className="text-emerald-500 mt-0.5 shrink-0">&bull;</span>
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(UpdatesTab);
