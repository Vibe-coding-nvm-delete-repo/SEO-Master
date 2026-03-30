import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { loadFromIDB, saveToIDB } from './projectStorage';
import { persistAppSettingsDoc, subscribeAppSettingsDoc } from './appSettingsPersistence';
import { CLOUD_SYNC_CHANNELS } from './cloudSyncStatus';
import {
  buildDefaultRows,
  buildSeedKeywords,
  consolidateRows,
  resolveLoanTopicsRows,
  normalizeRank,
  normalizeSeedKeywords,
  parseListInput,
  parseTopicRow,
  stringifyListInput,
  type LeadRank,
  type LoanTopicRow,
} from './topicsLoansUtils';
import { CANONICAL_LOAN_TOPICS_SEED, LOAN_TOPICS_SCHEMA_VERSION } from './topicsLoansSeed';

const FS_DOC = 'topics_loans';
const IDB_KEY = '__topics_loans__';

const rankBadgeClass: Record<LeadRank, string> = {
  1: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  2: 'bg-amber-100/90 text-amber-900 border-amber-200/80',
  3: 'bg-indigo-100/90 text-indigo-900 border-indigo-200/80',
  4: 'bg-emerald-100/90 text-emerald-900 border-emerald-200/80',
};

const intentBadgeClass: Record<LeadRank, string> = {
  1: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  2: 'bg-rose-100/90 text-rose-900 border-rose-200/80',
  3: 'bg-amber-100/90 text-amber-900 border-amber-200/80',
  4: 'bg-emerald-100/90 text-emerald-900 border-emerald-200/80',
};

type SortKey =
  | 'subtopic'
  | 'sourceRank'
  | 'leadIntentRank'
  | 'average'
  | 'seedKeywordsSource'
  | 'seedKeywordsIntent'
  | 'ahrefsLinks'
  | 'notes';
type SortDir = 'asc' | 'desc';

const thButtonClass = 'inline-flex items-center gap-1 hover:text-zinc-700 transition-colors';

export default function TopicsSubTab() {
  const [rows, setRows] = useState<LoanTopicRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('average');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceMin, setSourceMin] = useState('');
  const [sourceMax, setSourceMax] = useState('');
  const [intentMin, setIntentMin] = useState('');
  const [intentMax, setIntentMax] = useState('');
  const [avgMin, setAvgMin] = useState('');
  const [avgMax, setAvgMax] = useState('');
  const hydratedRef = useRef(false);
  const hasSeedNormalizedRef = useRef(false);
  const suppressSnapshotRef = useRef(false);
  const lastWrittenAtRef = useRef<string>('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const idb = await loadFromIDB<{ rows?: unknown[]; schemaVersion?: number; value?: { rows?: unknown[]; schemaVersion?: number } }>(IDB_KEY);
        if (!mounted) return;
        const payload = idb?.value ?? idb;
        const parsed = (payload?.rows || []).map(parseTopicRow).filter((r): r is LoanTopicRow => r !== null);
        const resolved = resolveLoanTopicsRows(parsed.length > 0 ? parsed : null, payload?.schemaVersion, CANONICAL_LOAN_TOPICS_SEED, LOAN_TOPICS_SCHEMA_VERSION);
        setRows(resolved);
      } catch {
        if (!mounted) return;
        setRows(buildDefaultRows(CANONICAL_LOAN_TOPICS_SEED));
      } finally {
        hydratedRef.current = true;
      }
    })();

    const unsub = subscribeAppSettingsDoc({
      docId: FS_DOC,
      channel: CLOUD_SYNC_CHANNELS.topicsLoans,
      onData: (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as { rows?: unknown[]; updatedAt?: string; schemaVersion?: number };
        const incomingUpdatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : '';
        if (suppressSnapshotRef.current && incomingUpdatedAt && lastWrittenAtRef.current && incomingUpdatedAt <= lastWrittenAtRef.current) {
          return;
        }
        suppressSnapshotRef.current = false;
        const parsed = (data?.rows || []).map(parseTopicRow).filter((r): r is LoanTopicRow => r !== null);
        if (parsed.length === 0) return;
        const resolved = resolveLoanTopicsRows(parsed, data.schemaVersion, CANONICAL_LOAN_TOPICS_SEED, LOAN_TOPICS_SCHEMA_VERSION);
        setRows(resolved);
        void saveToIDB(IDB_KEY, {
          rows: resolved,
          updatedAt: new Date().toISOString(),
          schemaVersion: LOAN_TOPICS_SCHEMA_VERSION,
        });
      },
      onError: (err) => {
        console.warn('[Topics] Firestore sync error:', err);
      },
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const updatedAt = new Date().toISOString();
      const payload = { rows: rowsRef.current, updatedAt, schemaVersion: LOAN_TOPICS_SCHEMA_VERSION };
      lastWrittenAtRef.current = updatedAt;
      suppressSnapshotRef.current = true;
      void persistAppSettingsDoc({
        docId: FS_DOC,
        idbKey: IDB_KEY,
        data: payload,
        merge: true,
        localContext: 'topics loans',
        cloudContext: 'topics loans',
      }).then(({ cloudOk }) => {
        if (cloudOk) return;
        suppressSnapshotRef.current = false;
      }).catch((err) => {
        suppressSnapshotRef.current = false;
        console.warn('[Topics] Firestore save failed:', err);
      });
    }, 500);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [rows]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (hasSeedNormalizedRef.current) return;
    if (rows.length === 0) return;
    hasSeedNormalizedRef.current = true;
    let changed = false;
    const normalized = rows.map((row) => {
      const nextSource = normalizeSeedKeywords(row.seedKeywordsSource);
      const nextIntent = normalizeSeedKeywords(row.seedKeywordsIntent);
      if (
        nextSource.join('|') !== row.seedKeywordsSource.join('|') ||
        nextIntent.join('|') !== row.seedKeywordsIntent.join('|')
      ) {
        changed = true;
        return { ...row, seedKeywordsSource: nextSource, seedKeywordsIntent: nextIntent, updatedAt: new Date().toISOString() };
      }
      return row;
    });
    if (changed) setRows(normalized);
  }, [rows]);

  const rowAverage = useCallback((row: LoanTopicRow) => {
    return (row.sourceRank + row.leadIntentRank) / 2;
  }, []);

  const bestAverage = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.max(...rows.map(rowAverage));
  }, [rows, rowAverage]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const toNum = (v: string) => {
      if (v.trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const sMin = toNum(sourceMin);
    const sMax = toNum(sourceMax);
    const iMin = toNum(intentMin);
    const iMax = toNum(intentMax);
    const aMin = toNum(avgMin);
    const aMax = toNum(avgMax);

    return rows.filter((row) => {
      const avg = rowAverage(row);
      if (q) {
        const hay = [
          row.subtopic,
          row.rationale,
          row.notes,
          row.seedKeywordsSource.join(' '),
          row.seedKeywordsIntent.join(' '),
          row.ahrefsLinks.join(' '),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (sMin !== null && row.sourceRank < sMin) return false;
      if (sMax !== null && row.sourceRank > sMax) return false;
      if (iMin !== null && row.leadIntentRank < iMin) return false;
      if (iMax !== null && row.leadIntentRank > iMax) return false;
      if (aMin !== null && avg < aMin) return false;
      if (aMax !== null && avg > aMax) return false;
      return true;
    });
  }, [avgMax, avgMin, intentMax, intentMin, rowAverage, rows, searchQuery, sourceMax, sourceMin]);

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      const avgA = rowAverage(a);
      const avgB = rowAverage(b);
      let cmp = 0;
      switch (sortKey) {
        case 'subtopic':
          cmp = a.subtopic.localeCompare(b.subtopic);
          break;
        case 'sourceRank':
          cmp = a.sourceRank - b.sourceRank;
          break;
        case 'leadIntentRank':
          cmp = a.leadIntentRank - b.leadIntentRank;
          break;
        case 'average':
          cmp = avgA - avgB;
          break;
        case 'seedKeywordsSource':
          cmp = a.seedKeywordsSource.length - b.seedKeywordsSource.length;
          break;
        case 'seedKeywordsIntent':
          cmp = a.seedKeywordsIntent.length - b.seedKeywordsIntent.length;
          break;
        case 'ahrefsLinks':
          cmp = a.ahrefsLinks.length - b.ahrefsLinks.length;
          break;
        case 'notes':
          cmp = a.notes.localeCompare(b.notes);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filteredRows, rowAverage, sortDir, sortKey]);

  const stats = useMemo(() => {
    const total = rows.length;
    const source4 = rows.filter((r) => r.sourceRank === 4).length;
    const intent4 = rows.filter((r) => r.leadIntentRank === 4).length;
    const bestOfBoth = rows.filter((r) => rowAverage(r) >= 3.5).length;
    const avgCombined = total > 0 ? rows.reduce((sum, r) => sum + rowAverage(r), 0) / total : 0;
    const withAhrefs = rows.filter((r) => r.ahrefsLinks.some((x) => x.trim().length > 0)).length;
    const withNotes = rows.filter((r) => r.notes.trim().length > 0).length;
    return { total, source4, intent4, bestOfBoth, avgCombined, withAhrefs, withNotes };
  }, [rowAverage, rows]);

  const setSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const updateRow = useCallback((id: string, updater: (row: LoanTopicRow) => LoanTopicRow) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        return { ...updater(row), updatedAt: new Date().toISOString() };
      }),
    );
  }, []);

  const addRow = useCallback(() => {
    const subtopic = 'New loan subtopic';
    setRows((prev) => [
      {
        id: `loan_topic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        subtopic,
        sourceRank: 3,
        leadIntentRank: 3,
        rationale: '',
        seedKeywordsSource: buildSeedKeywords(subtopic, 'source'),
        seedKeywordsIntent: buildSeedKeywords(subtopic, 'intent'),
        ahrefsLinks: [''],
        notes: '',
        updatedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const consolidateSimilarSubtopics = useCallback(() => {
    setRows((prev) => consolidateRows(prev));
  }, []);

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '');

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Topics</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Starting topic: <span className="font-medium text-zinc-700">Loans</span>. Both scoring columns use 1-4.
              {' '}Best of both = average of source relevance + lead intent.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add subtopic
          </button>
          <button
            type="button"
            onClick={consolidateSimilarSubtopics}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Consolidate similar
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
        <p className="text-xs text-zinc-500">
          Edit any cell inline. Ahrefs links support multiple URLs per subtopic.
          {' '}Rows with the highest average are tagged as best of both.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">Subtopics</div>
          <div className="text-base font-semibold text-zinc-900 tabular-nums">{stats.total}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">Source Rank = 4</div>
          <div className="text-base font-semibold text-emerald-700 tabular-nums">{stats.source4}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">Lead Intent = 4</div>
          <div className="text-base font-semibold text-emerald-700 tabular-nums">{stats.intent4}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">Best of Both (≥3.5)</div>
          <div className="text-base font-semibold text-indigo-700 tabular-nums">{stats.bestOfBoth}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">Avg Combined</div>
          <div className="text-base font-semibold text-zinc-900 tabular-nums">{stats.avgCombined.toFixed(2)}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">With Ahrefs Links</div>
          <div className="text-base font-semibold text-zinc-900 tabular-nums">{stats.withAhrefs}</div>
        </div>
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
          <div className="text-[10px] text-zinc-500">With Notes</div>
          <div className="text-base font-semibold text-zinc-900 tabular-nums">{stats.withNotes}</div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-100 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">Loans Subtopics</h3>
          <span className="text-[11px] text-zinc-500">{sortedRows.length} shown / {rows.length} total</span>
        </div>
        <div className="px-3 py-2 border-b border-zinc-100 bg-zinc-50/40">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subtopic/rationale/seed keywords/notes..."
              className="w-full px-2.5 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 shrink-0">Source</span>
              <input value={sourceMin} onChange={(e) => setSourceMin(e.target.value)} placeholder="min" className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md" />
              <input value={sourceMax} onChange={(e) => setSourceMax(e.target.value)} placeholder="max" className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 shrink-0">Intent</span>
              <input value={intentMin} onChange={(e) => setIntentMin(e.target.value)} placeholder="min" className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md" />
              <input value={intentMax} onChange={(e) => setIntentMax(e.target.value)} placeholder="max" className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 shrink-0">Avg</span>
              <input value={avgMin} onChange={(e) => setAvgMin(e.target.value)} placeholder="min" className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md" />
              <input value={avgMax} onChange={(e) => setAvgMax(e.target.value)} placeholder="max" className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md" />
            </div>
          </div>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr className="text-left text-[11px] font-medium text-zinc-500">
                <th className="px-3 py-2 font-medium min-w-[220px] sticky top-0 left-0 z-30 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('subtopic')}>
                    Subtopic {sortIndicator('subtopic')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[120px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('sourceRank')}>
                    Source Rank {sortIndicator('sourceRank')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[120px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('leadIntentRank')}>
                    Lead Intent {sortIndicator('leadIntentRank')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[150px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('average')}>
                    Best of Both Avg {sortIndicator('average')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[220px] sticky top-0 z-20 bg-zinc-50">Rationale</th>
                <th className="px-3 py-2 font-medium min-w-[240px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('seedKeywordsSource')}>
                    Seed KWs (Source) {sortIndicator('seedKeywordsSource')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[240px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('seedKeywordsIntent')}>
                    Seed KWs (Intent) {sortIndicator('seedKeywordsIntent')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[260px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('ahrefsLinks')}>
                    Ahrefs Links {sortIndicator('ahrefsLinks')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium min-w-[220px] sticky top-0 z-20 bg-zinc-50">
                  <button type="button" className={thButtonClass} onClick={() => setSort('notes')}>
                    Notes {sortIndicator('notes')}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium w-[64px] sticky top-0 z-20 bg-zinc-50">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const average = rowAverage(row);
                const isTop = average === bestAverage;
                return (
                  <tr key={row.id} className="border-b border-zinc-100 align-top last:border-b-0 odd:bg-white even:bg-zinc-50/50 hover:bg-zinc-100/60">
                    <td className="px-3 py-2 sticky left-0 z-10 bg-inherit border-r border-zinc-100">
                      <input
                        value={row.subtopic}
                        onChange={(e) => {
                          const next = e.target.value;
                          updateRow(row.id, (r) => ({
                            ...r,
                            subtopic: next,
                            seedKeywordsSource: r.seedKeywordsSource.length > 0 ? r.seedKeywordsSource : buildSeedKeywords(next, 'source'),
                            seedKeywordsIntent: r.seedKeywordsIntent.length > 0 ? r.seedKeywordsIntent : buildSeedKeywords(next, 'intent'),
                          }));
                        }}
                        className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={row.sourceRank}
                          onChange={(e) => updateRow(row.id, (r) => ({ ...r, sourceRank: normalizeRank(e.target.value) }))}
                          className="px-2 py-1.5 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                        >
                          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-md border ${rankBadgeClass[row.sourceRank]}`}>
                          {row.sourceRank}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={row.leadIntentRank}
                          onChange={(e) => updateRow(row.id, (r) => ({ ...r, leadIntentRank: normalizeRank(e.target.value) }))}
                          className="px-2 py-1.5 text-xs border border-zinc-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                        >
                          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-md border ${intentBadgeClass[row.leadIntentRank]}`}>
                          {row.leadIntentRank}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-zinc-700 tabular-nums">{average.toFixed(2)}</span>
                        {isTop && (
                          <span className="inline-flex w-fit items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-md border bg-emerald-100 text-emerald-900 border-emerald-200">
                            Best of both
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        value={row.rationale}
                        onChange={(e) => updateRow(row.id, (r) => ({ ...r, rationale: e.target.value }))}
                        className="w-full min-h-[84px] px-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-y"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        value={stringifyListInput(row.seedKeywordsSource)}
                        onChange={(e) => updateRow(row.id, (r) => ({ ...r, seedKeywordsSource: parseListInput(e.target.value) }))}
                        className="w-full min-h-[100px] px-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-y"
                        placeholder="One per line or comma-separated"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        value={stringifyListInput(row.seedKeywordsIntent)}
                        onChange={(e) => updateRow(row.id, (r) => ({ ...r, seedKeywordsIntent: parseListInput(e.target.value) }))}
                        className="w-full min-h-[100px] px-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-y"
                        placeholder="One per line or comma-separated"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1.5">
                        {(row.ahrefsLinks.length > 0 ? row.ahrefsLinks : ['']).map((link, idx) => (
                          <div key={`${row.id}_ahrefs_${idx}`} className="flex items-center gap-1.5">
                            <input
                              value={link}
                              onChange={(e) =>
                                updateRow(row.id, (r) => {
                                  const next = [...(r.ahrefsLinks.length > 0 ? r.ahrefsLinks : [''])];
                                  next[idx] = e.target.value;
                                  return { ...r, ahrefsLinks: next };
                                })
                              }
                              placeholder="https://app.ahrefs.com/..."
                              className="w-full px-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateRow(row.id, (r) => {
                                  const next = [...(r.ahrefsLinks.length > 0 ? r.ahrefsLinks : [''])];
                                  next.splice(idx, 1);
                                  return { ...r, ahrefsLinks: next };
                                })
                              }
                              className="p-1 text-zinc-400 hover:text-red-600 transition-colors"
                              title="Remove link"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => updateRow(row.id, (r) => ({ ...r, ahrefsLinks: [...r.ahrefsLinks, ''] }))}
                          className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-700"
                        >
                          <Plus className="w-3 h-3" /> Add Ahrefs link
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        value={row.notes}
                        onChange={(e) => updateRow(row.id, (r) => ({ ...r, notes: e.target.value }))}
                        className="w-full min-h-[100px] px-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-y"
                        placeholder="Notes..."
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Delete subtopic"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-3">
        <p className="text-sm text-zinc-500 mt-1">
          Rank guidance: 1 = weakest opportunity, 4 = strongest. Highest combined average indicates strongest blend of source relevance and intent.
        </p>
      </div>
    </div>
  );
}
