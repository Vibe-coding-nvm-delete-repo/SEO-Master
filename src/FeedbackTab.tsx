import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, ClipboardList, ArrowUpDown, Images, Copy } from 'lucide-react';
import type { FeedbackEntry } from './types';
import { BUG_SEVERITY_LABELS, FEATURE_IMPACT_LABELS, getFeedbackAreaLabel } from './feedbackConstants';
import { loadFeedbackFromIDB, subscribeFeedback, swapFeedbackPriority } from './feedbackStorage';
import { useToast } from './ToastContext';

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

type SortKey = 'priority' | 'date' | 'rating' | 'kind';
type SortDir = 'asc' | 'desc';
type KindFilter = 'all' | 'issue' | 'feature';

/** 1–4 from Firestore, or null for legacy rows without severity / impact. */
function ratingValue(item: FeedbackEntry): number | null {
  if (item.kind === 'issue') return item.issueSeverity ?? null;
  return item.featureImpact ?? null;
}

/** Unknown ratings sort after 4 when ascending (sentinel 5). */
function ratingSortKey(item: FeedbackEntry): number {
  const v = ratingValue(item);
  return v === null ? 5 : v;
}

function sortRows(list: FeedbackEntry[], sortKey: SortKey, sortDir: SortDir): FeedbackEntry[] {
  const m = sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    switch (sortKey) {
      case 'priority':
        return (a.priority - b.priority) * m;
      case 'date':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * m;
      case 'rating': {
        const ra = ratingSortKey(a);
        const rb = ratingSortKey(b);
        return (ra - rb) * m;
      }
      case 'kind': {
        const oa = a.kind === 'issue' ? 0 : 1;
        const ob = b.kind === 'issue' ? 0 : 1;
        return (oa - ob) * m;
      }
      default:
        return 0;
    }
  });
}

const FeedbackTab: React.FC = () => {
  const { addToast } = useToast();
  const [items, setItems] = useState<FeedbackEntry[]>([]);
  const [swapping, setSwapping] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [minRating, setMinRating] = useState<'any' | '1' | '2' | '3' | '4'>('any');

  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    let cancelled = false;
    void loadFeedbackFromIDB().then((cached) => {
      if (cancelled || !cached?.length) return;
      setItems(cached);
    });
    const unsub = subscribeFeedback((next) => {
      setItems(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const filtered = useMemo(() => {
    const tagNeedle = tagFilter.trim().toLowerCase();
    const textNeedle = searchText.trim().toLowerCase();
    let list = items;

    if (kindFilter !== 'all') {
      list = list.filter((i) => i.kind === kindFilter);
    }
    if (tagNeedle) {
      list = list.filter((i) => i.tags.some((t) => t.includes(tagNeedle)));
    }
    if (textNeedle) {
      list = list.filter(
        (i) =>
          i.body.toLowerCase().includes(textNeedle) ||
          i.tags.some((t) => t.includes(textNeedle)),
      );
    }
    if (minRating !== 'any') {
      const min = Number(minRating) as 1 | 2 | 3 | 4;
      list = list.filter((i) => {
        const r = ratingValue(i);
        if (r === null) return false;
        return r >= min;
      });
    }

    return list;
  }, [items, kindFilter, tagFilter, searchText, minRating]);

  const rows = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir(key === 'date' || key === 'rating' ? 'desc' : 'asc');
      return key;
    });
  }, []);

  const move = useCallback(
    async (index: number, dir: -1 | 1) => {
      const j = index + dir;
      if (j < 0 || j >= rows.length) return;
      const a = rows[index];
      const b = rows[j];
      const key = `${a.id}:${b.id}`;
      setSwapping(key);
      try {
        await swapFeedbackPriority(a, b);
      } catch (e) {
        console.warn('Reorder failed:', e);
        addToast('Could not update priority. Try again.', 'error', {
          notification: {
            mode: 'none',
            source: 'feedback',
          },
        });
      } finally {
        setSwapping(null);
      }
    },
    [rows, addToast],
  );

  const SortBtn = ({ col, label }: { col: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(col)}
      className={`inline-flex items-center gap-0.5 font-medium hover:text-zinc-800 ${
        sortKey === col ? 'text-indigo-700' : 'text-zinc-600'
      }`}
    >
      {label}
      {sortKey === col ? (
        sortDir === 'asc' ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 opacity-40" />
      )}
    </button>
  );

  const ratingLabel = (item: FeedbackEntry) => {
    if (item.kind === 'issue') {
      if (item.issueSeverity == null) return '—';
      const L = BUG_SEVERITY_LABELS[item.issueSeverity];
      return `${item.issueSeverity} · ${L.short}`;
    }
    if (item.featureImpact == null) return '—';
    const L = FEATURE_IMPACT_LABELS[item.featureImpact];
    return `${item.featureImpact} · ${L.short}`;
  };

  const copyFeedback = useCallback(
    async (item: FeedbackEntry) => {
      const kindLabel = item.kind === 'issue' ? 'Issue' : 'Feature';
      const content = [
        `Type: ${kindLabel}`,
        `Rating: ${ratingLabel(item)}`,
        `Area: ${item.tags?.length ? item.tags.map((t) => getFeedbackAreaLabel(t)).join(', ') : '—'}`,
        `Author: ${item.authorEmail || '—'}`,
        `Created: ${formatWhen(item.createdAt)}`,
        '',
        'Feedback:',
        item.body,
      ].join('\n');

      try {
        await navigator.clipboard.writeText(content);
        addToast('Copied full feedback.', 'success', {
          notification: {
            mode: 'none',
            source: 'feedback',
          },
        });
      } catch (e) {
        console.warn('Copy feedback failed:', e);
        addToast('Could not copy feedback. Try again.', 'error', {
          notification: {
            mode: 'none',
            source: 'feedback',
          },
        });
      }
    },
    [addToast],
  );

  return (
    <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ClipboardList className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-zinc-900">Feedback queue</h2>
          </div>
          <p className="text-xs text-zinc-500">
            Filter and sort below. Queue arrows use Firestore priority (top = tackle first). Ratings: issues = severity, features = impact.
            Older items may show <span className="font-medium text-zinc-600">—</span> (no rating stored); they are omitted when you filter by minimum rating.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 p-3 bg-zinc-50/80 border border-zinc-100 rounded-lg">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white text-zinc-800"
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="issue">Issues only</option>
          <option value="feature">Features only</option>
        </select>
        <select
          value={minRating}
          onChange={(e) => setMinRating(e.target.value as typeof minRating)}
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white text-zinc-800"
          aria-label="Minimum rating"
        >
          <option value="any">Any rating</option>
          <option value="4">Rating 4 only</option>
          <option value="3">Rating 3+</option>
          <option value="2">Rating 2+</option>
          <option value="1">Rating 1+</option>
        </select>
        <input
          type="search"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="Filter by area…"
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white min-w-[120px] flex-1 max-w-[200px]"
        />
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search text…"
          className="text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white min-w-[140px] flex-1 max-w-[240px]"
        />
        <span className="text-[11px] text-zinc-500 self-center">
          {rows.length} / {items.length} shown
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-200 rounded-lg">
          No feedback yet. Use <span className="font-medium text-zinc-700">Send feedback</span> in the header to add one.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center border border-dashed border-zinc-200 rounded-lg">
          No items match your filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-left text-xs min-w-[820px]">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-2 py-2 w-10 whitespace-nowrap">#</th>
                <th className="px-2 py-2 whitespace-nowrap">
                  <SortBtn col="kind" label="Type" />
                </th>
                <th className="px-2 py-2 whitespace-nowrap">
                  <SortBtn col="rating" label="Rating" />
                </th>
                <th className="px-2 py-2 min-w-[120px]">Area</th>
                <th className="px-2 py-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 text-zinc-600">
                    <Images className="w-3.5 h-3.5 text-emerald-600" />
                    Photos
                  </span>
                </th>
                <th className="px-2 py-2 min-w-[320px]">Feedback</th>
                <th className="px-2 py-2 whitespace-nowrap">Who</th>
                <th className="px-2 py-2 whitespace-nowrap">
                  <SortBtn col="date" label="When" />
                </th>
                <th className="px-2 py-2 whitespace-nowrap">Copy</th>
                <th className="px-2 py-2 whitespace-nowrap">
                  <SortBtn col="priority" label="Queue" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((item, index) => (
                <tr key={item.id} className="hover:bg-zinc-50/80 align-top">
                  <td className="px-2 py-2 text-zinc-400">{index + 1}</td>
                  <td className="px-2 py-2">
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                        item.kind === 'feature'
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                          : 'bg-amber-50 text-amber-800 border border-amber-100'
                      }`}
                    >
                      {item.kind === 'feature' ? 'Feature' : 'Issue'}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-zinc-800 whitespace-nowrap" title={ratingLabel(item)}>
                    {ratingLabel(item)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(item.tags?.length ? item.tags : []).slice(0, 6).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-900 border border-sky-200 max-w-[200px] truncate"
                          title={getFeedbackAreaLabel(t)}
                        >
                          {getFeedbackAreaLabel(t)}
                        </span>
                      ))}
                      {item.tags && item.tags.length > 6 && (
                        <span className="text-[10px] text-zinc-400">+{item.tags.length - 6}</span>
                      )}
                      {(!item.tags || item.tags.length === 0) && <span className="text-zinc-300">—</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 align-top">
                    {item.attachmentUrls?.length ? (
                      <div className="flex flex-wrap gap-1 max-w-[140px]">
                        {item.attachmentUrls.map((url, imgIdx) => (
                          <a
                            key={`${item.id}-${imgIdx}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open screenshot"
                            className="block w-11 h-11 shrink-0 rounded-md border border-emerald-200 overflow-hidden bg-zinc-50 shadow-sm hover:ring-2 hover:ring-emerald-300/80 transition-shadow"
                          >
                            <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-zinc-800">
                    <p className="whitespace-pre-wrap break-words max-w-[560px]">
                      {item.body}
                    </p>
                  </td>
                  <td className="px-2 py-2 text-zinc-500 max-w-[140px] truncate" title={item.authorEmail || ''}>
                    {item.authorEmail || '—'}
                  </td>
                  <td className="px-2 py-2 text-zinc-500 whitespace-nowrap">{formatWhen(item.createdAt)}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => void copyFeedback(item)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-800 hover:bg-zinc-50 text-[11px] font-medium whitespace-nowrap"
                      title="Copy full feedback content"
                      aria-label="Copy full feedback content"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        title="Move up in queue"
                        disabled={index === 0 || swapping !== null}
                        onClick={() => void move(index, -1)}
                        className="p-0.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/60 disabled:opacity-30 disabled:pointer-events-none"
                        aria-label="Move up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Move down in queue"
                        disabled={index === rows.length - 1 || swapping !== null}
                        onClick={() => void move(index, 1)}
                        className="p-0.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/60 disabled:opacity-30 disabled:pointer-events-none"
                        aria-label="Move down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 p-3 bg-zinc-50 border border-zinc-100 rounded-lg text-[11px] text-zinc-600 space-y-2">
        <p className="font-medium text-zinc-700">Rating scales</p>
        <p>
          <span className="text-amber-800 font-medium">Issue severity:</span> 1 Minor — 2 Moderate — 3 Major — 4 Critical.
        </p>
        <p>
          <span className="text-indigo-800 font-medium">Feature impact:</span> 1 Low — 2 Medium — 3 High — 4 Critical importance.
        </p>
      </div>
    </div>
  );
};

export default FeedbackTab;
