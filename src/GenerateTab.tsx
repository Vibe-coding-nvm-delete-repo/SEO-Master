/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Loader2, Play, Square, Settings, ChevronDown, Search, Check, AlertCircle, X, Trash2, RotateCcw, Copy, Clock, Download, Zap, ScrollText, RefreshCw, Globe, HelpCircle, Star } from 'lucide-react';
import { db } from './firebase';
import { doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { useToast } from './ToastContext';
import { reportPersistFailure } from './persistenceErrors';
import { clearListenerError, markListenerError, markListenerSnapshot } from './cloudSyncStatus';
import InlineHelpHint from './InlineHelpHint';

// ============ Types ============
interface GenerateRow {
  id: string;
  status: 'pending' | 'generating' | 'generated' | 'error';
  input: string;
  output: string;
  error?: string;
  generatedAt?: string; // ISO timestamp with full date+time
  durationMs?: number; // how long this row took to generate
  retries?: number; // how many times this row was retried due to len range
  promptTokens?: number;
  completionTokens?: number;
  cost?: number; // USD cost for this row
}

interface LogEntry {
  id: string;
  timestamp: string; // ISO
  action: string;
  details: string;
  model?: string;
  outputCount?: number;
  errorCount?: number;
  throttledCount?: number;
  elapsedMs?: number;
  cost?: number;
  concurrency?: number;
  avgPerSec?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface GenerateSettings {
  apiKey: string;
  selectedModel: string;
  rateLimit: number; // 1-100 concurrent
  minLen: number; // min output character count (0 = no minimum)
  maxLen: number; // max output character count (0 = no maximum)
  maxRetries: number; // max retries per row for len enforcement
  temperature: number; // 0.0-2.0, default 1.0
  maxTokens: number; // 0 = no limit, otherwise max output tokens
  webSearch: boolean; // enable OpenRouter web search plugin
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
}

const GENERATE_CACHE_PREFIX = 'kwg_generate_cache';
const rowsCacheKey = (suffix: string) => `${GENERATE_CACHE_PREFIX}:rows${suffix || '_1'}`;
const settingsCacheKey = (suffix: string) => `${GENERATE_CACHE_PREFIX}:settings${suffix || '_1'}`;
const logsCacheKey = (suffix: string) => `${GENERATE_CACHE_PREFIX}:logs${suffix || '_1'}`;
const viewStateCacheKey = (suffix: string) => `${GENERATE_CACHE_PREFIX}:view${suffix || '_1'}`;
const activeSubTabCacheKey = `${GENERATE_CACHE_PREFIX}:active_subtab`;
const compactTabRailClass = 'flex items-center gap-0.5 bg-zinc-100/80 p-0.5 rounded-lg border border-zinc-200/70 w-fit';
const compactTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all';
const compactTabBtnActive = 'bg-white shadow-sm text-zinc-900 border border-zinc-200';
const compactTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100/70';

const makeEmptyRows = (count: number): GenerateRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `row_${i}`,
    status: 'pending' as const,
    input: '',
    output: '',
  }));

// ============ Tooltip helper ============
function Tip({ text }: { text: string }) {
  return (
    <span className="inline-flex ml-0.5 align-middle cursor-help">
      <InlineHelpHint
        text={text}
        className="inline-flex items-center"
        ariaLabel={text}
      >
        <HelpCircle className="w-3 h-3 text-zinc-300 hover:text-zinc-500 transition-colors" />
      </InlineHelpHint>
    </span>
  );
}

// ============ Memoized Row Component (prevents re-render of unchanged rows) ============
interface GenerateRowComponentProps {
  row: GenerateRow;
  origIdx: number;
  isEven: boolean;
  isExpanded: boolean;
  isBusy: boolean; // parent isGenerating — controls retry button visibility
  isCopied: boolean;
  minLen: number;
  maxLen: number;
  onInputChange: (rowId: string, value: string) => void;
  onPaste: (e: React.ClipboardEvent, origIdx: number) => void;
  onClearCell: (rowId: string) => void;
  onCopyOutput: (rowId: string, text: string) => void;
  onToggleExpand: (rowId: string) => void;
  onRetry: (rowId: string) => void;
}

const statusColorMap: Record<GenerateRow['status'], string> = {
  pending: 'bg-zinc-100 text-zinc-500',
  generating: 'bg-amber-100 text-amber-700',
  generated: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

const formatDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  } catch { return iso; }
};

const GenerateRowComponent = React.memo(function GenerateRowComponent({
  row, origIdx, isEven, isExpanded, isBusy, isCopied, onInputChange, onPaste, onClearCell, onCopyOutput, onToggleExpand, onRetry,
}: GenerateRowComponentProps) {
  return (
    <tr className={`${isExpanded ? '' : 'h-[32px]'} ${isEven ? 'bg-zinc-50/60' : ''} ${row.status === 'generating' ? 'bg-amber-50/30' : ''}`}>
      <td className="px-1.5 py-0.5 text-[10px] text-zinc-400 tabular-nums align-middle">{origIdx + 1}</td>
      <td className="px-1.5 py-0.5 align-middle overflow-hidden">
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap ${statusColorMap[row.status]}`}>
          {row.status === 'generating' && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
          {row.status === 'generated' && <Check className="w-2.5 h-2.5 shrink-0" />}
          {row.status === 'error' && <AlertCircle className="w-2.5 h-2.5 shrink-0" />}
          {row.status}
        </span>
      </td>
      <td className="px-1.5 py-0.5 align-middle">
        <div className="relative group/cell">
          <input
            type="text"
            value={row.input}
            onChange={(e) => onInputChange(row.id, e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData?.getData('text/plain') ?? '';
              if (text.includes('\n') || text.includes('\r')) onPaste(e, origIdx);
            }}
            className="w-full text-[11px] h-[24px] px-1.5 pr-5 border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
            placeholder="Paste or type prompt..."
          />
          {row.input.trim() && (
            <button onClick={() => onClearCell(row.id)} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-zinc-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100 transition-opacity" title="Clear cell">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </td>
      <td className="px-1.5 py-0.5 align-top cursor-pointer" onClick={() => { if (row.output || row.status === 'error') onToggleExpand(row.id); }}>
        {row.status === 'error' && row.output ? (
          isExpanded ? (
            <div>
              <div className="text-[11px] text-zinc-700 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto py-1 leading-relaxed">{row.output}</div>
              <div className="text-[9px] text-red-500 mt-1 truncate" title={row.error}>{row.error}</div>
            </div>
          ) : (
            <div>
              <span className="text-[11px] text-zinc-700 truncate block">{row.output}</span>
              <span className="text-[9px] text-red-500 truncate block" title={row.error}>{row.error}</span>
            </div>
          )
        ) : row.status === 'error' ? (
          <span className={`text-[10px] text-red-600 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate block'}`}>{row.error}</span>
        ) : isExpanded && row.output ? (
          <div className="text-[11px] text-zinc-700 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto py-1 leading-relaxed">{row.output}</div>
        ) : (
          <span className="text-[11px] text-zinc-700 truncate block">{row.output || <span className="text-zinc-300">—</span>}</span>
        )}
      </td>
      <td className="px-0.5 py-0.5 text-center align-middle">
        {row.output.trim() && (
          <button onClick={() => onCopyOutput(row.id, row.output)} className="p-0.5 text-zinc-300 hover:text-indigo-600 transition-colors" title="Copy output">
            {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </td>
      <td className="px-0.5 py-0.5 text-center align-middle">
        {(row.status === 'error' || row.status === 'generated') && !isBusy && (
          <button onClick={(e) => { e.stopPropagation(); onRetry(row.id); }} className="p-0.5 text-zinc-300 hover:text-amber-600 transition-colors" title="Reset to pending for re-generation">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </td>
      <td className="px-1.5 py-0.5 text-right text-[10px] text-zinc-500 tabular-nums align-middle">
        {row.output ? row.output.length.toLocaleString() : '—'}
      </td>
      <td className="px-1.5 py-0.5 text-center text-[10px] tabular-nums align-middle">
        {(row.retries && row.retries > 0) ? (
          <span className={`${row.status === 'error' ? 'text-red-500' : 'text-amber-500'} font-medium`}>{row.retries}</span>
        ) : '—'}
      </td>
      <td className="px-1.5 py-0.5 text-right text-[9px] text-zinc-400 tabular-nums align-middle whitespace-nowrap">
        {row.generatedAt ? formatDateTime(row.generatedAt) : '—'}
      </td>
    </tr>
  );
});

// ============ Generation Timer (isolated to avoid parent re-renders) ============
const GenerationTimer = React.memo(function GenerationTimer({
  startTime, isActive, completionTimestampsRef, doneCount,
  formatElapsedFn,
}: {
  startTime: number | null;
  isActive: boolean;
  completionTimestampsRef: React.MutableRefObject<number[]>;
  doneCount: number;
  formatElapsedFn: (ms: number) => string;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState(0);
  const [lastElapsed, setLastElapsed] = useState(0);

  useEffect(() => {
    if (!isActive || !startTime) return;
    const updateTimerState = () => {
      setElapsed(Date.now() - startTime);
      const now = Date.now();
      const w = completionTimestampsRef.current.filter(t => now - t < 5000);
      setRate(w.length > 0 ? Math.round((w.length / ((now - w[0]) / 1000)) * 10) / 10 : 0);
    };
    const kickoff = setTimeout(updateTimerState, 0);
    const timer = setInterval(() => {
      updateTimerState();
    }, 250);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [isActive, startTime, completionTimestampsRef]);

  // Keep final elapsed time visible after generation stops
  useEffect(() => {
    if (!(isActive && elapsed > 0)) return;
    const timer = setTimeout(() => setLastElapsed(elapsed), 0);
    return () => clearTimeout(timer);
  }, [isActive, elapsed]);
  const displayElapsed = isActive ? elapsed : lastElapsed;

  if (!isActive && displayElapsed === 0) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500" title="Total elapsed time for the current/last generation batch">
        <Clock className="w-3 h-3" />
        <span className={`font-mono tabular-nums ${isActive ? 'text-amber-600 font-semibold' : 'text-emerald-600'}`}>
          {formatElapsedFn(displayElapsed)}
        </span>
        {!isActive && doneCount > 0 && (
          <span className="text-zinc-400">({doneCount} items)</span>
        )}
      </div>
      {isActive && rate > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-cyan-600 font-semibold font-mono tabular-nums" title="Current throughput — outputs completed per second">
          <Zap className="w-3 h-3" />
          {rate}/s
        </div>
      )}
    </>
  );
});

// ============ Component ============
interface GenerateTabProps {
  storageKey?: string; // '' (default) or '_2' for second sub-tab
  starredModels: Set<string>; // shared starred model IDs
  onToggleStar: (modelId: string) => void; // toggle star on/off
}

const GenerateTabInstance = React.memo(function GenerateTabInstance({ storageKey = '', starredModels, onToggleStar }: GenerateTabProps) {
  const { addToast } = useToast();
  const suffix = storageKey; // e.g. '' or '_2'
  // Table state — initialize empty, then load from IDB
  const [rows, setRows] = useState<GenerateRow[]>(makeEmptyRows(20));
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef(logs);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  const [genSubTab, setGenSubTab] = useState<'table' | 'log'>(() => {
    try {
      const raw = localStorage.getItem(viewStateCacheKey(suffix));
      if (!raw) return 'table';
      const parsed = JSON.parse(raw);
      return parsed?.genSubTab === 'log' ? 'log' : 'table';
    } catch {
      return 'table';
    }
  });
  const logsLoadedRef = useRef(false);
  const readRowsFromLocalCache = useCallback((): GenerateRow[] | null => {
    try {
      const raw = localStorage.getItem(rowsCacheKey(suffix));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed as GenerateRow[];
    } catch {
      return null;
    }
  }, [suffix]);

  // Load rows from Firestore and keep them live-synced
  useEffect(() => {
    let alive = true;
    const unsub = onSnapshot(doc(db, 'app_settings', `generate_rows${suffix}`), async (snap) => {
      markListenerSnapshot(`generate_rows${suffix}`, snap);
      try {
        if (!alive) return;
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        if (snap.exists()) {
          const data = snap.data();
          let loadedRows: GenerateRow[] = [];
          if (data.chunked && data.chunkCount > 0) {
            const chunkPromises = Array.from({ length: data.chunkCount }, (_, i) =>
              getDoc(doc(db, 'app_settings', `generate_rows${suffix}_chunk_${i}`))
            );
            const chunkSnaps = await Promise.all(chunkPromises);
            for (const cs of chunkSnaps) {
              const csData = cs.exists() ? cs.data() : null;
              if (csData && Array.isArray(csData.rows)) {
                loadedRows.push(...csData.rows);
              }
            }
          } else if (data.rows && Array.isArray(data.rows)) {
            loadedRows = data.rows;
          }
          if (!alive) return;
          setRows(
            loadedRows.length > 0
              ? loadedRows.map((r: GenerateRow) => ({ ...r, retries: r.retries || 0, status: r.status === 'generating' ? 'pending' as const : r.status }))
              : makeEmptyRows(20)
          );
          try {
            localStorage.setItem(rowsCacheKey(suffix), JSON.stringify(loadedRows));
          } catch {
            // Ignore local cache write failures.
          }
          lastSavedRowsJsonRef.current = JSON.stringify(loadedRows);
          setIsLoaded(true);
          return;
        }
      } catch {
        // Best-effort local fallback; keep default rows on read failure.
      }
      if (alive) {
        const cachedRows = readRowsFromLocalCache();
        if (cachedRows && cachedRows.length > 0) {
          setRows(
            cachedRows.map((r: GenerateRow) => ({ ...r, retries: r.retries || 0, status: r.status === 'generating' ? 'pending' as const : r.status })),
          );
          lastSavedRowsJsonRef.current = JSON.stringify(cachedRows);
        } else {
          setRows(makeEmptyRows(20));
          lastSavedRowsJsonRef.current = JSON.stringify([]);
        }
        setIsLoaded(true);
      }
    }, (err) => {
      markListenerError(`generate_rows${suffix}`);
      reportPersistFailure(addToast, 'generate rows sync', err);
      if (alive) {
        const cachedRows = readRowsFromLocalCache();
        if (cachedRows && cachedRows.length > 0) {
          setRows(
            cachedRows.map((r: GenerateRow) => ({ ...r, retries: r.retries || 0, status: r.status === 'generating' ? 'pending' as const : r.status })),
          );
          lastSavedRowsJsonRef.current = JSON.stringify(cachedRows);
        } else {
          setRows(makeEmptyRows(20));
          lastSavedRowsJsonRef.current = JSON.stringify([]);
        }
        setIsLoaded(true);
      }
    });
    return () => {
      alive = false;
      clearListenerError(`generate_rows${suffix}`);
      if (typeof unsub === 'function') unsub();
    };
  }, [suffix, addToast, readRowsFromLocalCache]);

  // Debounced save to IDB + Firestore when rows change (skip initial load)
  // During generation: save at most every 5s (interval-based, not debounced) so data isn't lost if tab closes
  // Outside generation: standard 500ms debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGeneratingRef = useRef(false);
  const lastSavedRowsJsonRef = useRef('');
  const lastSaveTimeRef = useRef(0);
  const pendingSaveRef = useRef(false);

  const persistRows = useCallback((rowsToSave: GenerateRow[], errorContext: string) => {
    const json = JSON.stringify(rowsToSave);
    const estimatedBytes = json.length;
    if (estimatedBytes > 900_000) {
      // Too large for single doc — chunk into 400-row docs (same pattern as main app)
      const CHUNK_SIZE = 400;
      const chunks: typeof rowsToSave[] = [];
      for (let i = 0; i < rowsToSave.length; i += CHUNK_SIZE) {
        chunks.push(rowsToSave.slice(i, i + CHUNK_SIZE));
      }
      const updatedAt = new Date().toISOString();
      chunks.forEach((chunk, i) => {
        setDoc(doc(db, 'app_settings', `generate_rows${suffix}_chunk_${i}`), {
          rows: chunk,
          updatedAt,
        }).catch((e) => reportPersistFailure(addToast, `${errorContext} chunk ${i}`, e));
      });
      setDoc(doc(db, 'app_settings', `generate_rows${suffix}`), {
        chunked: true,
        chunkCount: chunks.length,
        totalRows: rowsToSave.length,
        updatedAt,
      }).catch((e) => reportPersistFailure(addToast, `${errorContext} meta`, e));
      return;
    }
    setDoc(doc(db, 'app_settings', `generate_rows${suffix}`), {
      rows: rowsToSave,
      updatedAt: new Date().toISOString(),
    }).catch((e) => reportPersistFailure(addToast, errorContext, e));
  }, [suffix, addToast]);

  const doSave = useCallback(() => {
    try {
      const rowsToSave = rowsRef.current.filter(r => r.input.trim() || r.output.trim());
      // Background save to Firestore (skip if unchanged)
      const json = JSON.stringify(rowsToSave);
      if (json === lastSavedRowsJsonRef.current) return;
      lastSavedRowsJsonRef.current = json;
      try {
        localStorage.setItem(rowsCacheKey(suffix), json);
      } catch {
        // Ignore local cache write failures.
      }
      lastSaveTimeRef.current = Date.now();
      pendingSaveRef.current = false;
      persistRows(rowsToSave, 'generate rows');
    } catch (e) {
      console.warn('doSave error:', e);
    }
  }, [suffix, persistRows]);

  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    if (isGeneratingRef.current) {
      // During generation: throttle saves to every 5s to prevent data loss without hammering Firestore
      // NEVER run doSave synchronously — always defer to avoid blocking React's commit phase
      const elapsed = Date.now() - lastSaveTimeRef.current;
      const delay = elapsed >= 5000 ? 50 : (5000 - elapsed); // 50ms defer if overdue, otherwise wait for window
      pendingSaveRef.current = true;
      saveTimerRef.current = setTimeout(() => {
        if (pendingSaveRef.current) doSave();
      }, delay);
    } else {
      // Not generating: standard 500ms debounce
      saveTimerRef.current = setTimeout(doSave, 500);
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [rows, isLoaded, suffix, doSave]);

  // Load logs from Firestore and keep them live-synced
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', `generate_logs${suffix}`), (snap) => {
      markListenerSnapshot(`generate_logs${suffix}`, snap);
      const isFromCache = snap.metadata.fromCache;
      if (!snap.exists() && isFromCache) return;
      if (snap.exists()) {
        const logData = snap.data();
        if (logData?.logs && Array.isArray(logData.logs)) {
          setLogs(logData.logs);
          try {
            localStorage.setItem(logsCacheKey(suffix), JSON.stringify(logData.logs));
          } catch {
            // Ignore local cache write failures.
          }
          logsLoadedRef.current = true;
          return;
        }
      }
      try {
        const raw = localStorage.getItem(logsCacheKey(suffix));
        const cached = raw ? JSON.parse(raw) : [];
        setLogs(Array.isArray(cached) ? cached : []);
      } catch {
        setLogs([]);
      }
      logsLoadedRef.current = true;
    }, (err) => {
      markListenerError(`generate_logs${suffix}`);
      reportPersistFailure(addToast, 'generate logs sync', err);
      try {
        const raw = localStorage.getItem(logsCacheKey(suffix));
        const cached = raw ? JSON.parse(raw) : [];
        setLogs(Array.isArray(cached) ? cached : []);
      } catch {
        setLogs([]);
      }
      logsLoadedRef.current = true;
    });
    return () => {
      clearListenerError(`generate_logs${suffix}`);
      if (typeof unsub === 'function') unsub();
    };
  }, [suffix, addToast]);

  // Save logs when they change
  const logSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!logsLoadedRef.current) return;
    if (logSaveTimerRef.current) clearTimeout(logSaveTimerRef.current);
    logSaveTimerRef.current = setTimeout(async () => {
      // Keep only last 500 log entries
      const trimmed = logs.slice(-500);
      try {
        localStorage.setItem(logsCacheKey(suffix), JSON.stringify(trimmed));
      } catch {
        // Ignore local cache write failures.
      }
      setDoc(doc(db, 'app_settings', `generate_logs${suffix}`), { logs: trimmed, updatedAt: new Date().toISOString() }).catch((e) =>
        reportPersistFailure(addToast, 'generate logs', e),
      );
    }, 1000);
    return () => { if (logSaveTimerRef.current) clearTimeout(logSaveTimerRef.current); };
  }, [logs, suffix, addToast]);

  // Add a log entry with optional structured data
  const addLog = useCallback((action: string, details: string, extra?: Partial<LogEntry>) => {
    setLogs(prev => [...prev, { id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString(), action, details, ...extra }]);
  }, []);

  // Settings state
  const [settings, setSettings] = useState<GenerateSettings>({
    apiKey: '',
    selectedModel: '',
    rateLimit: 5,
    minLen: 0,
    maxLen: 0,
    maxRetries: 3,
    temperature: 1.0,
    maxTokens: 0,
    webSearch: false,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSort, setModelSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const settingsLoadedRef = useRef(false);

  // Live rateLimit ref — workers read this to dynamically scale concurrency mid-generation
  const rateLimitRef = useRef(settings.rateLimit);
  useEffect(() => { rateLimitRef.current = settings.rateLimit; }, [settings.rateLimit]);
  // Shared worker-spawning function ref — set inside handleGenerate, called by rateLimit watcher
  const spawnWorkersRef = useRef<((count: number) => void) | null>(null);

  // Balance state
  const [balance, setBalance] = useState<number | null>(null);
  const [, setBalanceLoading] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeCountRef = useRef(0);
  const [rateLimitCount, setRateLimitCount] = useState(0); // 429 errors in current batch
  const throttledToastLevelRef = useRef(0); // 0 none, 1 mild, 2 severe

  // Throughput tracking — timestamps of completed rows (shared with GenerationTimer)
  const completionTimestamps = useRef<number[]>([]);

  // Live cost ref — updated immediately in generation loop (no renders), synced to display every 3s
  const liveCostRef = useRef(0);
  const [liveCost, setLiveCost] = useState(0);
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setLiveCost(liveCostRef.current);
    }, 3000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Dynamic concurrency scaling — when user changes rateLimit mid-generation, spawn new workers
  const prevRateLimitRef = useRef(settings.rateLimit);
  useEffect(() => {
    const prev = prevRateLimitRef.current;
    prevRateLimitRef.current = settings.rateLimit;
    // Only act during active generation and when rateLimit increased
    if (isGenerating && settings.rateLimit > prev && spawnWorkersRef.current) {
      const delta = settings.rateLimit - prev;
      spawnWorkersRef.current(delta);
    }
    // Scale-down is handled inside processNext — excess workers exit naturally after their current item
  }, [settings.rateLimit, isGenerating]);

  // Surface hard-to-miss warnings when concurrency is too high for the current model/account.
  useEffect(() => {
    if (!isGenerating) {
      throttledToastLevelRef.current = 0;
      return;
    }
    const suggested = Math.max(1, Math.floor(settings.rateLimit / 2));
    if (rateLimitCount >= 3 && throttledToastLevelRef.current < 1) {
      throttledToastLevelRef.current = 1;
      addToast(
        `OpenRouter is throttling requests (429). Concurrency ${settings.rateLimit} may be too high — try ~${suggested}.`,
        'warning',
      );
    }
    if (rateLimitCount >= 10 && throttledToastLevelRef.current < 2) {
      throttledToastLevelRef.current = 2;
      addToast(
        `Heavy throttling detected (${rateLimitCount}x 429). Throughput drops due to retry backoff — lower concurrency now.`,
        'error',
      );
    }
  }, [rateLimitCount, isGenerating, settings.rateLimit, addToast]);

  // Expanded output rows — click to toggle full output view
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Timer state — only genStartTime needed, timer runs inside GenerationTimer component
  const [genStartTime, setGenStartTime] = useState<number | null>(null);

  // Header bar ref (for future use)
  const headerBarRef = useRef<HTMLDivElement>(null);

  // Clipboard copy feedback
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
  const [bulkCopied, setBulkCopied] = useState(false);

  // Undo state
  const [undoStack, setUndoStack] = useState<GenerateRow[][]>([]);

  // Status filter — auto-reset to 'all' when filtered view becomes empty
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'generated' | 'error'>(() => {
    try {
      const raw = localStorage.getItem(viewStateCacheKey(suffix));
      if (!raw) return 'all';
      const parsed = JSON.parse(raw);
      if (parsed?.statusFilter === 'pending') return 'pending';
      if (parsed?.statusFilter === 'generated') return 'generated';
      if (parsed?.statusFilter === 'error') return 'error';
      return 'all';
    } catch {
      return 'all';
    }
  });
  const displayRows = useMemo(() => {
    if (statusFilter === 'all') return rows.map((r, i) => ({ row: r, origIdx: i }));
    const filtered = rows.map((r, i) => ({ row: r, origIdx: i })).filter(({ row }) => row.status === statusFilter);
    return filtered;
  }, [rows, statusFilter]);
  useEffect(() => {
    if (statusFilter !== 'all' && displayRows.length === 0) setStatusFilter('all');
  }, [statusFilter, displayRows.length]);

  // Persist view state (table/log tab + status filter) per Generate instance.
  const viewStateLoadedRef = useRef(false);
  const lastSavedViewStateRef = useRef<string>('');
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', `generate_view_state${suffix}`), (snap) => {
      markListenerSnapshot(`generate_view_state${suffix}`, snap);
      const isFromCache = snap.metadata.fromCache;
      if (!snap.exists() && isFromCache) return;
      if (snap.exists()) {
        const data = snap.data() as { genSubTab?: 'table' | 'log'; statusFilter?: 'all' | 'pending' | 'generated' | 'error' };
        const nextGenSubTab: 'table' | 'log' = data?.genSubTab === 'log' ? 'log' : 'table';
        const nextStatus: 'all' | 'pending' | 'generated' | 'error' =
          data?.statusFilter === 'pending' || data?.statusFilter === 'generated' || data?.statusFilter === 'error'
            ? data.statusFilter
            : 'all';
        setGenSubTab(nextGenSubTab);
        setStatusFilter(nextStatus);
        const json = JSON.stringify({ genSubTab: nextGenSubTab, statusFilter: nextStatus });
        lastSavedViewStateRef.current = json;
        try {
          localStorage.setItem(viewStateCacheKey(suffix), json);
        } catch {
          // Ignore local cache write failures.
        }
        viewStateLoadedRef.current = true;
        return;
      }
      try {
        const raw = localStorage.getItem(viewStateCacheKey(suffix));
        const parsed = raw ? JSON.parse(raw) : null;
        const nextGenSubTab: 'table' | 'log' = parsed?.genSubTab === 'log' ? 'log' : 'table';
        const nextStatus: 'all' | 'pending' | 'generated' | 'error' =
          parsed?.statusFilter === 'pending' || parsed?.statusFilter === 'generated' || parsed?.statusFilter === 'error'
            ? parsed.statusFilter
            : 'all';
        setGenSubTab(nextGenSubTab);
        setStatusFilter(nextStatus);
        lastSavedViewStateRef.current = JSON.stringify({ genSubTab: nextGenSubTab, statusFilter: nextStatus });
      } catch {
        lastSavedViewStateRef.current = JSON.stringify({ genSubTab: 'table', statusFilter: 'all' });
      }
      viewStateLoadedRef.current = true;
    }, (err) => {
      markListenerError(`generate_view_state${suffix}`);
      reportPersistFailure(addToast, 'generate view state sync', err);
      viewStateLoadedRef.current = true;
    });
    return () => {
      clearListenerError(`generate_view_state${suffix}`);
      if (typeof unsub === 'function') unsub();
    };
  }, [suffix, addToast]);

  useEffect(() => {
    if (!viewStateLoadedRef.current) return;
    const json = JSON.stringify({ genSubTab, statusFilter });
    if (json === lastSavedViewStateRef.current) return;
    lastSavedViewStateRef.current = json;
    try {
      localStorage.setItem(viewStateCacheKey(suffix), json);
    } catch {
      // Ignore local cache write failures.
    }
    const timer = setTimeout(() => {
      setDoc(doc(db, 'app_settings', `generate_view_state${suffix}`), {
        genSubTab,
        statusFilter,
        updatedAt: new Date().toISOString(),
      }).catch((e) => reportPersistFailure(addToast, 'generate view state', e));
    }, 300);
    return () => clearTimeout(timer);
  }, [genSubTab, statusFilter, suffix, addToast]);

  // Clear all inputs
  const handleClearAll = useCallback(() => {
    const cur = rowsRef.current;
    const contentCount = cur.filter(r => r.input.trim() || r.output.trim()).length;
    setUndoStack(prev => [...prev.slice(-9), cur]);
    setRows(Array.from({ length: 20 }, (_, i) => ({
      id: `row_${Date.now()}_${i}`,
      status: 'pending' as const,
      input: '',
      output: '',
    })));
    addLog('clear_all', `Cleared ${contentCount} rows`);
  }, [addLog]);

  // Clear a single cell
  const handleClearCell = useCallback((rowId: string) => {
    setUndoStack(prev => [...prev.slice(-9), rowsRef.current]);
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, input: '', output: '', status: 'pending', error: undefined, generatedAt: undefined, durationMs: undefined } : r));
  }, []);

  // Undo last clear
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRows(previous);
  }, [undoStack]);

  // Copy single output to clipboard
  const handleCopyOutput = useCallback((rowId: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedRowId(rowId);
      setTimeout(() => setCopiedRowId(null), 1500);
    });
  }, []);

  // Bulk copy all outputs to clipboard — TSV format so paste into Google Sheets preserves formatting per cell
  const handleBulkCopy = useCallback(() => {
    const outputRows = rowsRef.current.filter(r => r.output.trim());
    if (outputRows.length === 0) return;
    // Build TSV: each output is a quoted cell (one per row), internal newlines preserved inside quotes
    const tsvRows = outputRows.map(r => {
      const escaped = r.output.trim().replace(/"/g, '""');
      return `"${escaped}"`;
    });
    const tsv = tsvRows.join('\n');
    // Write both text/plain and text/html so spreadsheet apps treat it as cell data
    const html = '<table>' + outputRows.map(r => {
      const cell = r.output.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      return `<tr><td>${cell}</td></tr>`;
    }).join('') + '</table>';
    const blob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([tsv], { type: 'text/plain' });
    navigator.clipboard.write([
      new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
    ]).then(() => {
      setBulkCopied(true);
      setTimeout(() => setBulkCopied(false), 2000);
    });
  }, []);

  // Export all rows to CSV
  const handleExport = useCallback(() => {
    const dataRows = rowsRef.current.filter(r => r.input.trim() || r.output.trim());
    if (dataRows.length === 0) return;
    const escCsv = (s: string) => {
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const header = '#,Status,Input,Output,Len,Retries,Cost,Prompt Tokens,Completion Tokens,Date';
    const csvRows = dataRows.map((r, i) => [
      i + 1,
      r.status,
      escCsv(r.input),
      escCsv(r.output),
      r.output ? r.output.length : '',
      r.retries || 0,
      r.cost ? r.cost.toFixed(6) : '',
      r.promptTokens || '',
      r.completionTokens || '',
      r.generatedAt || '',
    ].join(','));
    const csv = [header, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generate-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('export', `Exported ${dataRows.length} rows to CSV`);
  }, [addLog]);

  const toSharedGenerateSettings = useCallback((value: GenerateSettings) => ({
    apiKey: value.apiKey,
    selectedModel: value.selectedModel,
    rateLimit: value.rateLimit,
    minLen: value.minLen,
    maxLen: value.maxLen,
    maxRetries: value.maxRetries,
    temperature: value.temperature,
    maxTokens: value.maxTokens,
    webSearch: value.webSearch,
  }), []);

  // Persist settings to Firestore (debounced, skip if unchanged from last save/load)
  const lastSavedSettingsRef = useRef<string>(JSON.stringify(toSharedGenerateSettings(settings)));
  const settingsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    // Skip Firestore write if settings haven't actually changed (prevents write-on-load cycle)
    const json = JSON.stringify(toSharedGenerateSettings(settings));
    if (json === lastSavedSettingsRef.current) return;
    lastSavedSettingsRef.current = json;
    try {
      localStorage.setItem(settingsCacheKey(suffix), json);
    } catch {
      // Ignore local cache write failures.
    }
    if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current);
    settingsSaveTimerRef.current = setTimeout(() => {
      setDoc(doc(db, 'app_settings', `generate_settings${suffix}`), {
        ...toSharedGenerateSettings(settings),
        updatedAt: new Date().toISOString(),
      }).catch((e) => reportPersistFailure(addToast, 'generate settings', e));
    }, 500);
    return () => { if (settingsSaveTimerRef.current) clearTimeout(settingsSaveTimerRef.current); };
  }, [settings, suffix, toSharedGenerateSettings, addToast]);

  // Load settings from Firestore and keep them live-synced
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', `generate_settings${suffix}`), (snap) => {
      markListenerSnapshot(`generate_settings${suffix}`, snap);
      const isFromCache = snap.metadata.fromCache;
      if (!snap.exists() && isFromCache) return;
      if (snap.exists()) {
        const data = snap.data();
        const fsSettings: GenerateSettings = {
          apiKey: data.apiKey || '',
          selectedModel: data.selectedModel || '',
          rateLimit: Math.max(1, Math.min(100, Number(data.rateLimit) || 5)),
          minLen: data.minLen || 0,
          maxLen: data.maxLen || 0,
          maxRetries: data.maxRetries ?? 3,
          temperature: data.temperature ?? 1.0,
          maxTokens: data.maxTokens || 0,
          webSearch: data.webSearch ?? false,
        };
        try {
          localStorage.setItem(settingsCacheKey(suffix), JSON.stringify(toSharedGenerateSettings(fsSettings)));
        } catch {
          // Ignore local cache write failures.
        }
        lastSavedSettingsRef.current = JSON.stringify(toSharedGenerateSettings(fsSettings));
        setSettings(fsSettings);
        settingsLoadedRef.current = true;
        return;
      }
      const cached = (() => {
        try {
          const raw = localStorage.getItem(settingsCacheKey(suffix));
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })();
      const defaultSettings: GenerateSettings = cached ? {
        apiKey: cached.apiKey || '',
        selectedModel: cached.selectedModel || '',
        rateLimit: Math.max(1, Math.min(100, Number(cached.rateLimit) || 5)),
        minLen: cached.minLen || 0,
        maxLen: cached.maxLen || 0,
        maxRetries: cached.maxRetries ?? 3,
        temperature: cached.temperature ?? 1.0,
        maxTokens: cached.maxTokens || 0,
        webSearch: cached.webSearch ?? false,
      } : {
        apiKey: '',
        selectedModel: '',
        rateLimit: 5,
        minLen: 0,
        maxLen: 0,
        maxRetries: 3,
        temperature: 1.0,
        maxTokens: 0,
        webSearch: false,
      };
      lastSavedSettingsRef.current = JSON.stringify(toSharedGenerateSettings(defaultSettings));
      setSettings(defaultSettings);
      settingsLoadedRef.current = true;
    }, (err) => {
      markListenerError(`generate_settings${suffix}`);
      reportPersistFailure(addToast, 'generate settings sync', err);
      settingsLoadedRef.current = true;
    });
    return () => {
      clearListenerError(`generate_settings${suffix}`);
      if (typeof unsub === 'function') unsub();
    };
  }, [suffix, toSharedGenerateSettings, addToast]);

  // Close model dropdown on outside click — only listen when dropdown is actually open
  useEffect(() => {
    if (!isModelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isModelDropdownOpen]);

  // Clean up abort all in-flight requests on unmount (prevents hidden background generation)
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      abortRef.current = true;
    };
  }, []);

  // Flush all pending saves on page close or component unmount — wrapped in try/catch to never crash
  const flushAllSaves = useCallback(() => {
    try {
      // Flush pending row save timer
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Firestore save for rows (fire-and-forget)
      const rowsToSave = rowsRef.current.filter(r => r.input.trim() || r.output.trim());
      const json = JSON.stringify(rowsToSave);
      if (json !== lastSavedRowsJsonRef.current) {
        lastSavedRowsJsonRef.current = json;
        try {
          localStorage.setItem(rowsCacheKey(suffix), json);
        } catch {
          // Ignore local cache write failures.
        }
        persistRows(rowsToSave, 'generate rows (flush)');
      }
      // Flush pending log save timer
      if (logSaveTimerRef.current) {
        clearTimeout(logSaveTimerRef.current);
        logSaveTimerRef.current = null;
      }
      // Save logs (best-effort)
      if (logsLoadedRef.current && logsRef.current.length > 0) {
        const trimmed = logsRef.current.slice(-500);
        try {
          localStorage.setItem(logsCacheKey(suffix), JSON.stringify(trimmed));
        } catch {
          // Ignore local cache write failures.
        }
        setDoc(doc(db, 'app_settings', `generate_logs${suffix}`), {
          logs: trimmed,
          updatedAt: new Date().toISOString(),
        }).catch((e) => reportPersistFailure(addToast, 'generate logs (flush)', e));
      }
    } catch (e) {
      console.warn('flushAllSaves error:', e);
    }
  }, [suffix, persistRows]);

  // beforeunload — flush on tab close / browser close
  useEffect(() => {
    const handleBeforeUnload = () => flushAllSaves();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Also flush on component unmount (e.g., switching main tabs)
      flushAllSaves();
    };
  }, [flushAllSaves]);

  // Fetch models from OpenRouter
  const fetchModels = useCallback(async () => {
    if (!settings.apiKey.trim()) {
      setModelsError('Enter an API key first');
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${settings.apiKey}` },
      });
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const modelList: OpenRouterModel[] = (data.data || [])
        .filter((m: any) => m.id && m.name)
        .map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          pricing: {
            prompt: m.pricing?.prompt || '0',
            completion: m.pricing?.completion || '0',
          },
          context_length: m.context_length || 0,
        }))
        .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));
      setModels(modelList);
      if (modelList.length > 0 && !settings.selectedModel) {
        setSettings(prev => ({ ...prev, selectedModel: modelList[0].id }));
      }
    } catch (e: any) {
      setModelsError(e.message || 'Failed to fetch models');
    } finally {
      setModelsLoading(false);
    }
  }, [settings.apiKey, settings.selectedModel]);

  // Fetch balance from OpenRouter
  const fetchBalance = useCallback(async () => {
    if (!settings.apiKey.trim()) return;
    setBalanceLoading(true);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${settings.apiKey}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      // data.data.total_credits and data.data.total_usage in USD
      const remaining = (data.data?.total_credits ?? 0) - (data.data?.total_usage ?? 0);
      setBalance(remaining);
    } catch {
      // Ignore balance fetch failures to avoid noisy UI errors.
    }
    setBalanceLoading(false);
  }, [settings.apiKey]);

  // Auto-fetch models + balance when API key changes
  useEffect(() => {
    if (settings.apiKey.trim().length > 10) {
      fetchModels();
      fetchBalance();
    }
  }, [settings.apiKey]);

  // Filtered + sorted models for dropdown — starred always pinned to top
  const filteredModels = useMemo(() => {
    let result = models;
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      result = result.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    if (modelSort === 'price-asc') {
      result = [...result].sort((a, b) => (parseFloat(a.pricing?.prompt) || 0) - (parseFloat(b.pricing?.prompt) || 0));
    } else if (modelSort === 'price-desc') {
      result = [...result].sort((a, b) => (parseFloat(b.pricing?.prompt) || 0) - (parseFloat(a.pricing?.prompt) || 0));
    }
    // Pin starred models to top (preserve relative order within each group)
    if (starredModels.size > 0) {
      const starred = result.filter(m => starredModels.has(m.id));
      const unstarred = result.filter(m => !starredModels.has(m.id));
      result = [...starred, ...unstarred];
    }
    return result;
  }, [models, modelSearch, modelSort, starredModels]);

  const selectedModelObj = useMemo(() => models.find(m => m.id === settings.selectedModel), [models, settings.selectedModel]);

  // Parse Google Sheets clipboard text properly
  const parseSheetsPaste = (text: string): string[] => {
    const results: string[] = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '"') {
        let cell = '';
        i++;
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else if (text[i] === '"') {
            i++;
            break;
          } else {
            cell += text[i];
            i++;
          }
        }
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        if (text[i] === '\r') i++;
        if (text[i] === '\n') i++;
        results.push(cell.trim());
      } else {
        let cell = '';
        while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
          cell += text[i];
          i++;
        }
        if (text[i] === '\t') {
          while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        }
        if (text[i] === '\r') i++;
        if (text[i] === '\n') i++;
        if (cell.trim()) results.push(cell.trim());
      }
    }
    return results;
  };

  // Handle paste from Google Sheets
  const handlePaste = useCallback((e: React.ClipboardEvent, startRowIdx: number) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;

    const pastedCells = parseSheetsPaste(text);
    if (pastedCells.length === 0) return;

    if (pastedCells.length === 1) {
      setRows(prev => prev.map((r, idx) =>
        idx === startRowIdx ? { ...r, input: pastedCells[0], status: 'pending', output: '', error: undefined, generatedAt: undefined, durationMs: undefined } : r
      ));
      return;
    }

    setRows(prev => {
      const updated = [...prev];
      for (let i = 0; i < pastedCells.length; i++) {
        const targetIdx = startRowIdx + i;
        if (targetIdx < updated.length) {
          updated[targetIdx] = { ...updated[targetIdx], input: pastedCells[i], status: 'pending', output: '', error: undefined, generatedAt: undefined, durationMs: undefined };
        } else {
          updated.push({
            id: `row_${Date.now()}_${i}`,
            status: 'pending',
            input: pastedCells[i],
            output: '',
          });
        }
      }
      return updated;
    });
  }, []);

  // Call OpenRouter API for a single row — auto-retries on 429 with exponential backoff
  // Uses AbortSignal to cancel in-flight requests when user clicks Stop
  const generateForRow = async (rowId: string, input: string, signal: AbortSignal): Promise<{ output: string; durationMs: number; promptTokens: number; completionTokens: number; cost: number } | { error: string; durationMs: number }> => {
    const startTime = performance.now();
    const maxRateLimitRetries = 5;

    for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
      if (signal.aborted) return { error: '__aborted__', durationMs: Math.round(performance.now() - startTime) };

      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
          },
          body: JSON.stringify({
            model: settings.selectedModel,
            messages: [{ role: 'user', content: input }],
            temperature: settings.temperature ?? 1.0,
            ...(settings.maxTokens > 0 ? { max_tokens: settings.maxTokens } : {}),
            ...(settings.webSearch ? { plugins: [{ id: 'web' }] } : {}),
          }),
          signal,
        });

        // Rate limited — auto-retry with exponential backoff
        if (res.status === 429) {
          setRateLimitCount(prev => prev + 1);
          if (attempt < maxRateLimitRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // 1s, 2s, 4s, 8s, 16s max 30s
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          return { error: `Rate limited (429) — ${maxRateLimitRetries} retries exhausted. Lower concurrent requests.`, durationMs: Math.round(performance.now() - startTime) };
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          return { error: `API ${res.status}: ${errText.slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
        }

        const data = await res.json();
        // Check for API-level error in response body (some models return 200 with error in body)
        if (data.error) {
          return { error: `API error: ${typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error).slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const output = data.choices?.[0]?.message?.content || '';
        // SAFEGUARD: Never silently accept empty output — treat as error so user sees it and money isn't wasted
        if (!output.trim()) {
          console.warn('generateForRow: API returned empty output for row', rowId, 'response:', JSON.stringify(data).slice(0, 300));
          return { error: `Empty response from API (model returned no content). Response: ${JSON.stringify(data).slice(0, 150)}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const promptTokens = data.usage?.prompt_tokens || 0;
        const completionTokens = data.usage?.completion_tokens || 0;
        const model = selectedModelObj;
        const promptCost = model ? promptTokens * parseFloat(model.pricing.prompt) : 0;
        const completionCost = model ? completionTokens * parseFloat(model.pricing.completion) : 0;
        // Web search plugin costs $4 per 1,000 results; default 5 results = $0.02 per request
        const webSearchCost = settings.webSearch ? 0.02 : 0;
        const cost = promptCost + completionCost + webSearchCost;
        return { output, durationMs: Math.round(performance.now() - startTime), promptTokens, completionTokens, cost };
      } catch (e: any) {
        if (e.name === 'AbortError') {
          return { error: '__aborted__', durationMs: Math.round(performance.now() - startTime) };
        }
        return { error: e.message || 'Unknown error', durationMs: Math.round(performance.now() - startTime) };
      }
    }
    return { error: 'Rate limited — max retries exhausted', durationMs: Math.round(performance.now() - startTime) };
  };

  // Generate all pending rows with rate limiting + batched UI updates
  const handleGenerate = useCallback(async () => {
    if (!settings.apiKey.trim() || !settings.selectedModel) {
      setShowSettings(true);
      return;
    }
    // Guard against double-invocation — if already generating, don't start again
    if (isGeneratingRef.current) {
      console.warn('handleGenerate called while already generating — skipping');
      return;
    }

    const pendingRows = rowsRef.current.filter(r => r.input.trim() && (r.status === 'pending' || r.status === 'error'));
    if (pendingRows.length === 0) return;

    setIsGenerating(true);
    abortRef.current = false;
    setRateLimitCount(0);
    completionTimestamps.current = [];
    // Seed live cost with existing cost from previous runs so it accumulates correctly
    liveCostRef.current = rowsRef.current.reduce((sum, r) => sum + (r.cost || 0), 0);
    setLiveCost(liveCostRef.current);
    // Create new AbortController for this generation batch — cancels all in-flight fetch() calls on Stop
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeCountRef.current = 0;

    addLog('generate_start', `${pendingRows.length} rows queued`, {
      model: settings.selectedModel,
      concurrency: settings.rateLimit,
      outputCount: pendingRows.length,
    });

    // Start timer (GenerationTimer component handles its own interval)
    const startTs = Date.now();
    setGenStartTime(startTs);

    // Mark all pending as generating upfront (single render)
    const pendingIds = new Set(pendingRows.map(r => r.id));
    setRows(prev => prev.map(r => pendingIds.has(r.id) ? { ...r, status: 'generating' } : r));

    const queue = [...pendingRows.map(r => ({ id: r.id, input: r.input, retries: 0 }))];
    let queueIdx = 0;
    const minLen = settings.minLen || 0;
    const maxLen = settings.maxLen || 0;
    const maxRetries = settings.maxRetries ?? 3;
    const hasLenConstraint = minLen > 0 || maxLen > 0;

    // Batch update buffer — flush every 200ms to reduce renders
    const pendingUpdates = new Map<string, Partial<GenerateRow>>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushUpdates = () => {
      if (pendingUpdates.size === 0) return;
      const updates = new Map(pendingUpdates);
      pendingUpdates.clear();
      setRows(prev => {
        let changed = false;
        const next = prev.map(r => {
          const update = updates.get(r.id);
          if (update) { changed = true; return { ...r, ...update }; }
          return r;
        });
        if (!changed && updates.size > 0) {
          // CRITICAL: updates had entries but none matched any row IDs — data is being lost!
          console.error('flushUpdates: ID MISMATCH — updates had', updates.size, 'entries but matched 0 rows. Update IDs:', [...updates.keys()].slice(0, 3), 'Row IDs:', prev.slice(0, 3).map(r => r.id));
        }
        return changed ? next : prev;
      });
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushUpdates();
      }, 200);
    };

    const isOutputInRange = (output: string): boolean => {
      const len = output.length;
      if (minLen > 0 && len < minLen) return false;
      if (maxLen > 0 && len > maxLen) return false;
      return true;
    };

    let workerCount = 0; // tracks how many workers are alive (not just active on a request)

    const processNext = async (): Promise<void> => {
      try {
      while (queueIdx < queue.length && !abortRef.current) {
        // Dynamic scale-down: if more workers alive than current rateLimit, this worker exits gracefully
        if (workerCount > rateLimitRef.current) {
          return; // workerCount decremented in finally
        }
        const item = queue[queueIdx++];
        if (!item.input.trim()) continue;
        activeCountRef.current++;

        try {
          let attempts = item.retries;
          let lastResult: { output: string; durationMs: number } | { error: string; durationMs: number } | null = null;

          // Try up to maxRetries+1 times (first attempt + retries)
          while (attempts <= maxRetries && !abortRef.current) {
            lastResult = await generateForRow(item.id, item.input, controller.signal);

            // If aborted, discard result entirely — no cost, no UI update
            if ('error' in lastResult && lastResult.error === '__aborted__') {
              lastResult = null;
              break;
            }

            if ('error' in lastResult) break; // API error, don't retry

            // Check len constraint
            if (hasLenConstraint && !isOutputInRange(lastResult.output)) {
              attempts++;
              if (attempts > maxRetries) {
                // Exceeded max retries — keep the last output so it's still copyable
                const lastOutput = lastResult.output;
                const lastDuration = lastResult.durationMs;
                const lastPromptTokens = 'promptTokens' in lastResult ? (lastResult as any).promptTokens : 0;
                const lastCompletionTokens = 'completionTokens' in lastResult ? (lastResult as any).completionTokens : 0;
                const lastCostVal = 'cost' in lastResult ? (lastResult as any).cost : 0;
                pendingUpdates.set(item.id, { status: 'error', output: lastOutput, error: `Exceeded ${maxRetries} retries — output length ${lastOutput.length} outside range [${minLen || '0'}–${maxLen || '∞'}]`, generatedAt: new Date().toISOString(), durationMs: lastDuration, retries: attempts, promptTokens: lastPromptTokens, completionTokens: lastCompletionTokens, cost: lastCostVal });
                lastResult = null; // already handled
                break;
              }
              // Retry — update retries count in UI
              pendingUpdates.set(item.id, { retries: attempts, status: 'generating' });
              scheduleFlush();
              continue;
            }
            break; // Output is in range
          }

          const now = new Date().toISOString();
          if (lastResult && 'output' in lastResult) {
            const r = lastResult as { output: string; durationMs: number; promptTokens: number; completionTokens: number; cost: number };
            completionTimestamps.current.push(Date.now());
            liveCostRef.current += r.cost;
            pendingUpdates.set(item.id, { status: 'generated', output: r.output, generatedAt: now, durationMs: r.durationMs, retries: attempts, promptTokens: r.promptTokens, completionTokens: r.completionTokens, cost: r.cost });
          } else if (lastResult && 'error' in lastResult) {
            pendingUpdates.set(item.id, { status: 'error', error: (lastResult as { error: string; durationMs: number }).error, generatedAt: now, durationMs: lastResult.durationMs, retries: attempts });
          }
          scheduleFlush();
        } catch (e: any) {
          // Catch ANY unexpected error so this worker doesn't silently die and abandon remaining queue items
          console.error('processNext unexpected error for row', item.id, e);
          pendingUpdates.set(item.id, { status: 'error', error: `Unexpected: ${e.message || 'Unknown error'}`, generatedAt: new Date().toISOString(), durationMs: 0, retries: 0 });
          scheduleFlush();
        } finally {
          activeCountRef.current--;
        }
      }
      } finally {
        // ALWAYS decrement workerCount when worker exits — whether from queue exhaustion, scale-down, or abort
        workerCount--;
      }
    };

    // Track all active worker promises — including dynamically spawned ones
    const activeWorkerPromises = new Set<Promise<void>>();

    const trackWorker = (p: Promise<void>) => {
      activeWorkerPromises.add(p);
      p.finally(() => activeWorkerPromises.delete(p));
    };

    // Spawn function — single path for creating workers (both initial and dynamic scale-up)
    // Increments workerCount on creation; processNext's finally block decrements on exit
    const spawnWorkers = (count: number) => {
      for (let i = 0; i < count; i++) {
        workerCount++;
        trackWorker(processNext());
      }
    };

    // Expose spawn function so the rateLimit watcher effect can add workers mid-generation
    spawnWorkersRef.current = spawnWorkers;

    // Create initial workers — capped at queue size (no point having more workers than items)
    const initialWorkerCount = Math.min(settings.rateLimit, pendingRows.length);
    spawnWorkers(initialWorkerCount);
    // Wait for all workers — including any dynamically spawned mid-generation
    while (activeWorkerPromises.size > 0) {
      await Promise.all([...activeWorkerPromises]);
    }
    spawnWorkersRef.current = null; // cleanup

    // Final flush for any remaining updates
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushUpdates();

    const elapsed = Date.now() - startTs;
    setIsGenerating(false);
    // Log completion — read latest rows to compute accurate stats (avoid stale closure)
    const doneCount = completionTimestamps.current.length;
    const avgRate = elapsed > 0 ? Math.round((doneCount / (elapsed / 1000)) * 10) / 10 : 0;
    setRows(prev => {
      const finalCost = prev.reduce((sum, r) => sum + (r.cost || 0), 0);
      const finalErrors = prev.filter(r => r.status === 'error').length;
      const finalPromptTokens = prev.reduce((sum, r) => sum + (r.promptTokens || 0), 0);
      const finalCompletionTokens = prev.reduce((sum, r) => sum + (r.completionTokens || 0), 0);
      addLog('generate_complete', `${doneCount} generated`, {
        model: settings.selectedModel,
        outputCount: doneCount,
        errorCount: finalErrors,
        elapsedMs: elapsed,
        cost: finalCost,
        concurrency: settings.rateLimit,
        avgPerSec: avgRate,
        promptTokens: finalPromptTokens,
        completionTokens: finalCompletionTokens,
      });
      return prev;
    });
    // Refresh balance after generation
    fetchBalance();
  }, [settings, addLog]);

  // Stop generation
  const handleStop = useCallback(() => {
    abortRef.current = true;
    // Cancel ALL in-flight HTTP requests immediately — prevents hidden API costs
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setRows(prev => prev.map(r => r.status === 'generating' ? { ...r, status: 'pending' } : r));
    addLog('generate_stop', `Stopped by user`, { outputCount: completionTimestamps.current.length });
  }, [addLog]);

  // Stats — single O(n) pass instead of 9 separate filter/reduce calls
  const { totalRows, generatedCount, errorCount, pendingCount, queuedCount, generatingCount, totalCost, totalPromptTokens, totalCompletionTokens } = useMemo(() => {
    let total = 0, generated = 0, errors = 0, pending = 0, queued = 0, generating = 0;
    let cost = 0, promptTok = 0, completionTok = 0;
    for (const r of rows) {
      const hasInput = r.input.length > 0 && r.input.trim().length > 0;
      if (hasInput) total++;
      switch (r.status) {
        case 'generated': generated++; break;
        case 'error': errors++; if (hasInput) queued++; break;
        case 'generating': generating++; break;
        case 'pending': if (hasInput) { pending++; queued++; } break;
      }
      cost += r.cost || 0;
      promptTok += r.promptTokens || 0;
      completionTok += r.completionTokens || 0;
    }
    return { totalRows: total, generatedCount: generated, errorCount: errors, pendingCount: pending, queuedCount: queued, generatingCount: generating, totalCost: cost, totalPromptTokens: promptTok, totalCompletionTokens: completionTok };
  }, [rows]);

  // Format elapsed time
  const formatElapsed = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${remainSecs}s`;
  };

  // formatDateTime defined at module scope — shared with GenerateRowComponent

  // Format cost string
  const formatCost = (priceStr: string): string => {
    const price = parseFloat(priceStr);
    if (isNaN(price) || price === 0) return 'Free';
    return `$${(price * 1000000).toFixed(2)}/M`;
  };

  // ===== Stable callbacks for memoized row component =====
  const handleInputChange = useCallback((rowId: string, value: string) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, input: value } : r));
  }, []);
  const handleRetryRow = useCallback((rowId: string) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, status: 'pending' as const, output: '', error: undefined } : r));
  }, []);
  const handleToggleExpand = useCallback((rowId: string) => {
    setExpandedRows(prev => { const next = new Set(prev); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; });
  }, []);

  // ===== Virtual scrolling =====
  const ROW_HEIGHT = 32;
  const EXPANDED_ROW_HEIGHT = 150;
  const BUFFER_ROWS = 20;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Measure scroll container
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => { setContainerHeight(entries[0].contentRect.height); });
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [genSubTab]); // re-measure when switching to table tab

  // RAF-throttled scroll handler
  const rafRef = useRef(0);
  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const target = e.target as HTMLDivElement;
    rafRef.current = requestAnimationFrame(() => { setScrollTop(target.scrollTop); });
  }, []);

  // Reset scroll on filter change
  useEffect(() => {
    setScrollTop(0);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [statusFilter]);

  // Compute visible range
  const virtualState = useMemo(() => {
    const len = displayRows.length;
    if (len === 0) return { startIdx: 0, endIdx: 0, topPad: 0, bottomPad: 0 };

    // Pre-compute offsets
    const offsets = new Array<number>(len);
    let total = 0;
    for (let i = 0; i < len; i++) {
      offsets[i] = total;
      total += expandedRows.has(displayRows[i].row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT;
    }

    // Binary search for first visible row
    let lo = 0, hi = len - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const rowBottom = offsets[mid] + (expandedRows.has(displayRows[mid].row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT);
      if (rowBottom <= scrollTop) lo = mid + 1; else hi = mid - 1;
    }
    const startIdx = Math.max(0, lo - BUFFER_ROWS);

    // Scan forward for last visible row
    const viewBottom = scrollTop + containerHeight;
    let endIdx = lo;
    while (endIdx < len && offsets[endIdx] < viewBottom) endIdx++;
    endIdx = Math.min(len, endIdx + BUFFER_ROWS);

    const topPad = offsets[startIdx] || 0;
    const lastEnd = endIdx > 0 ? offsets[endIdx - 1] + (expandedRows.has(displayRows[endIdx - 1].row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT) : 0;
    const bottomPad = Math.max(0, total - lastEnd);

    return { startIdx, endIdx, topPad, bottomPad };
  }, [displayRows, expandedRows, scrollTop, containerHeight]);

  return (
    <div className="space-y-3 max-w-4xl mx-auto">
      {/* Header bar */}
      <div ref={headerBarRef} className="bg-white border border-zinc-200 rounded-xl shadow-sm px-4 py-2.5">
        {/* Row 1: Title + action buttons */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-800">Generate</h2>
          <div className="flex items-center gap-2">
            {balance !== null && (
              <span className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border ${balance > 1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : balance > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`} title="Your remaining OpenRouter credit balance">
                ${balance.toFixed(2)}
              </span>
            )}
            {undoStack.length > 0 && (
              <button
                onClick={handleUndo}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors flex items-center gap-1"
                title="Undo last clear"
              >
                <RotateCcw className="w-3 h-3" />
                Undo
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={!rows.some(r => r.output.trim())}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download all inputs and outputs as a .tsv file"
            >
              <Download className="w-3 h-3" />
              Export
            </button>
            <button
              onClick={handleClearAll}
              disabled={rows.every(r => !r.input.trim() && !r.output.trim())}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Clear all inputs and outputs (Undo available)"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
            {/* Online toggle — Generate 1 only for now (testing) */}
            {suffix === '' && (
              <button
                onClick={() => setSettings(prev => ({ ...prev, webSearch: !prev.webSearch }))}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 ${settings.webSearch ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-zinc-200 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'}`}
                title={settings.webSearch ? 'Web search enabled — click to disable. Adds real-time web results to LLM context.' : 'Enable web search (OpenRouter plugin, ~$0.02/request extra). Gives the model access to live web data.'}
              >
                <Globe className="w-3 h-3" />
                Online
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 ${showSettings ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
            >
              <Settings className="w-3 h-3" />
              Settings
            </button>
            {isGenerating ? (
              <button
                onClick={handleStop}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-center gap-1 min-w-[130px]"
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={queuedCount === 0}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1 min-w-[130px] disabled:opacity-50 disabled:cursor-not-allowed"
                title={queuedCount > 0 ? `Generate ${pendingCount} pending${errorCount > 0 ? ` + ${errorCount} error` : ''} rows` : 'No rows to generate'}
              >
                <Play className="w-3 h-3" />
                Generate ({queuedCount})
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Status filters + live stats */}
        {totalRows > 0 && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-zinc-100">
            {/* Status filter buttons */}
            <div className="flex items-center gap-1 text-[11px]">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'all' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                All ({totalRows})
              </button>
              {generatedCount > 0 && (
                <button
                  onClick={() => setStatusFilter('generated')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'generated' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                >
                  Done ({generatedCount})
                </button>
              )}
              {errorCount > 0 && (
                <button
                  onClick={() => setStatusFilter('error')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'error' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
                >
                  Errors ({errorCount})
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'pending' ? 'bg-zinc-600 text-white' : 'bg-zinc-50 text-zinc-500 hover:bg-zinc-100'}`}
                >
                  Pending ({pendingCount})
                </button>
              )}
              {generatingCount > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md font-medium animate-pulse" title="Rows currently being processed by the LLM">{generatingCount} active</span>}
              {rateLimitCount > 0 && <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded-md font-medium" title="429 rate limit errors — consider lowering concurrent requests">{rateLimitCount} throttled</span>}
            </div>

            {/* Reset filtered errors to pending */}
            {statusFilter === 'error' && errorCount > 0 && !isGenerating && (
              <button
                onClick={() => {
                  setRows(prev => prev.map(r => r.status === 'error' ? { ...r, status: 'pending' as const, error: undefined } : r));
                  setStatusFilter('all');
                }}
                className="px-2.5 py-0.5 text-[11px] font-medium rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Reset {errorCount} to Pending
              </button>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Cost + tokens — uses liveCost during generation (updates every 3s via ref), totalCost when idle */}
            {(() => {
              const displayCost = isGenerating ? liveCost : totalCost;
              return displayCost > 0 ? (
                <span className={`px-2 py-0.5 text-[11px] rounded-md font-medium ${isGenerating ? 'bg-amber-50 text-amber-700 animate-pulse' : 'bg-indigo-50 text-indigo-700'}`} title={`Total API cost this session · ${totalPromptTokens.toLocaleString()} prompt tokens + ${totalCompletionTokens.toLocaleString()} completion tokens${settings.webSearch ? ' · Includes $0.02/request web search cost' : ''}`}>
                  ${displayCost < 0.01 ? displayCost.toFixed(4) : displayCost.toFixed(2)}
                </span>
              ) : null;
            })()}

            {/* Timer + Throughput (isolated component — does NOT cause parent re-renders) */}
            <GenerationTimer
              startTime={genStartTime}
              isActive={isGenerating}
              completionTimestampsRef={completionTimestamps}
              doneCount={generatedCount}
              formatElapsedFn={formatElapsed}
            />
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <div className="mt-3 pt-3 border-t border-zinc-200 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* API Key */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">OpenRouter API Key<Tip text="Your API key from openrouter.ai — used to authenticate all LLM requests. Get one free at openrouter.ai/keys" /></label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-or-..."
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Model selector */}
              <div ref={modelDropdownRef} className="relative">
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">
                  Model<Tip text="The LLM model to use for generation. Price shown is per 1M tokens. Models load automatically when API key is entered." />
                  {modelsLoading && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
                </label>
                <button
                  onClick={() => {
                    if (models.length === 0 && settings.apiKey.trim()) fetchModels();
                    setIsModelDropdownOpen(!isModelDropdownOpen);
                  }}
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg text-left flex items-center justify-between hover:bg-zinc-50 transition-colors"
                >
                  <span className="truncate">
                    {selectedModelObj ? selectedModelObj.name : (settings.selectedModel || 'Select model...')}
                  </span>
                  <ChevronDown className="w-3 h-3 shrink-0 text-zinc-400" />
                </button>
                {modelsError && <p className="text-[10px] text-red-500 mt-0.5">{modelsError}</p>}
                {selectedModelObj && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    In: {formatCost(selectedModelObj.pricing.prompt)} · Out: {formatCost(selectedModelObj.pricing.completion)} · {(selectedModelObj.context_length / 1000).toFixed(0)}K ctx
                  </p>
                )}

                {/* Dropdown */}
                {isModelDropdownOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-[300px] overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-zinc-100 space-y-1.5">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                        <input
                          type="text"
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          placeholder="Search models..."
                          className="w-full pl-6 pr-2 py-1 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          autoFocus
                        />
                      </div>
                      {/* Sort buttons */}
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-zinc-400 mr-0.5">Sort:</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setModelSort('name'); }}
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${modelSort === 'name' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                        >
                          Name
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setModelSort('price-asc'); }}
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${modelSort === 'price-asc' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                        >
                          Price ↑
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setModelSort('price-desc'); }}
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${modelSort === 'price-desc' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                        >
                          Price ↓
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {filteredModels.map((m, mIdx) => (
                        <React.Fragment key={m.id}>
                          {/* Divider between starred and unstarred groups */}
                          {starredModels.size > 0 && mIdx > 0 && starredModels.has(filteredModels[mIdx - 1].id) && !starredModels.has(m.id) && (
                            <div className="border-t border-zinc-200 my-0.5" />
                          )}
                          <div className={`w-full px-3 py-1.5 text-left text-xs hover:bg-indigo-50 transition-colors flex items-center ${m.id === settings.selectedModel ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-700'}`}>
                            {/* Star toggle */}
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleStar(m.id); }}
                              className="p-0.5 mr-1.5 shrink-0 transition-colors"
                              title={starredModels.has(m.id) ? 'Unstar model' : 'Star model'}
                            >
                              <Star className={`w-3 h-3 ${starredModels.has(m.id) ? 'fill-amber-400 text-amber-400' : 'text-zinc-300 hover:text-amber-400'}`} />
                            </button>
                            {/* Model name — click to select */}
                            <button
                              onClick={() => {
                                setSettings(prev => ({ ...prev, selectedModel: m.id }));
                                setIsModelDropdownOpen(false);
                                setModelSearch('');
                              }}
                              className="truncate flex-1 text-left"
                            >
                              {m.name}
                            </button>
                            <span className="text-[10px] text-zinc-400 ml-2 shrink-0">
                              {formatCost(m.pricing.prompt)}
                            </span>
                            {m.id === settings.selectedModel && <Check className="w-3 h-3 ml-1 text-indigo-600 shrink-0" />}
                          </div>
                        </React.Fragment>
                      ))}
                      {filteredModels.length === 0 && (
                        <p className="px-3 py-4 text-xs text-zinc-400 text-center">
                          {models.length === 0 ? 'Enter API key to load models' : 'No models match search'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Rate limit */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Concurrent Requests ({settings.rateLimit})<Tip text="How many API requests run in parallel. Higher = faster but may hit rate limits (429 errors). Lower if you see 'throttled' warnings." /></label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={settings.rateLimit}
                  onChange={(e) => setSettings(prev => ({ ...prev, rateLimit: parseInt(e.target.value) }))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>1</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>
            </div>

            {/* Len range + retries row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-zinc-100">
              {/* Min len */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Min Output Length (chars)<Tip text="Minimum character count for the output. If the output is shorter, it will be retried up to Max Retries times. Set to 0 to disable." /></label>
                <input
                  type="number"
                  min={0}
                  value={settings.minLen || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, minLen: parseInt(e.target.value) || 0 }))}
                  placeholder="0 (no min)"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Max len */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Output Length (chars)<Tip text="Maximum character count for the output. If the output exceeds this, it will be retried up to Max Retries times. Set to 0 to disable." /></label>
                <input
                  type="number"
                  min={0}
                  value={settings.maxLen || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, maxLen: parseInt(e.target.value) || 0 }))}
                  placeholder="0 (no max)"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Max retries */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Retries ({settings.maxRetries})<Tip text="How many times to retry if the output length falls outside the Min/Max range. After exhausting retries, the last attempt is kept and marked as an error." /></label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.maxRetries}
                  onChange={(e) => setSettings(prev => ({ ...prev, maxRetries: Math.min(500, Math.max(0, parseInt(e.target.value) || 0)) }))}
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-400 mt-0.5">Retries when output length is outside min/max range</p>
              </div>
            </div>

            {/* Temperature + Max tokens row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-zinc-100">
              {/* Temperature */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Temperature ({(settings.temperature ?? 1.0).toFixed(1)})<Tip text="Controls randomness. 0.0 = deterministic/precise, 1.0 = balanced, 2.0 = highly creative/random. Lower for factual tasks, higher for creative writing." /></label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.temperature ?? 1.0}
                  onChange={(e) => setSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[9px] text-zinc-400">
                  <span>0.0 (precise)</span>
                  <span>1.0 (balanced)</span>
                  <span>2.0 (creative)</span>
                </div>
              </div>

              {/* Max tokens */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Output Tokens<Tip text="Maximum number of tokens the model can generate per response. Leave at 0 for the model's default limit. 1 token ≈ 4 characters." /></label>
                <input
                  type="number"
                  min={0}
                  value={settings.maxTokens || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 0 }))}
                  placeholder="0 (no limit)"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-400 mt-0.5">API-level limit on output length. More reliable than char-based retries.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Rate limit warning */}
      {rateLimitCount >= 3 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-orange-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span><strong>{rateLimitCount} rate limit hits</strong> — requests are being auto-retried with backoff, but you should lower concurrent requests (currently {settings.rateLimit}) for better throughput.</span>
        </div>
      )}

      {/* Subtab switcher */}
      <div className={compactTabRailClass}>
        <button
          onClick={() => setGenSubTab('table')}
          className={`${compactTabBtnBase} ${genSubTab === 'table' ? compactTabBtnActive : compactTabBtnInactive}`}
        >
          Table
        </button>
        <button
          onClick={() => setGenSubTab('log')}
          className={`${compactTabBtnBase} flex items-center gap-1 ${genSubTab === 'log' ? compactTabBtnActive : compactTabBtnInactive}`}
        >
          <ScrollText className="w-3 h-3" />
          Log ({logs.length})
        </button>
      </div>

      {/* Table */}
      {genSubTab === 'table' && <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
        <div ref={scrollContainerRef} onScroll={handleTableScroll} className="overflow-auto max-h-[75vh]">
          <table className="text-sm w-full table-fixed">
            <thead className="bg-zinc-50 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(228,228,231)]">
              <tr className="border-b border-zinc-200">
                <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[28px]" title="Row number (original position)">#</th>
                <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[80px]">Status<Tip text="Pending = waiting to generate · Generating = in progress · Generated = complete · Error = failed after retries" /></th>
                <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[22%]">Input<Tip text="Your prompt for each row. Paste from Google Sheets or type directly. Each row is sent as a separate LLM request." /></th>
                <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500">
                  <div className="flex items-center justify-between">
                    <span>Output<Tip text="The LLM response. Click a row to expand/collapse. Error rows show the last attempted output + error message." /></span>
                    {generatedCount > 0 && (
                      <button
                        onClick={handleBulkCopy}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-zinc-200 text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                        title="Copy all outputs"
                      >
                        {bulkCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        {bulkCopied ? 'Copied!' : `Copy All (${generatedCount})`}
                      </button>
                    )}
                  </div>
                </th>
                <th className="px-1.5 py-1.5 text-center text-[10px] font-semibold text-zinc-500 w-[28px]" title="Copy individual output to clipboard"></th>
                <th className="px-1.5 py-1.5 text-center text-[10px] font-semibold text-zinc-500 w-[28px]" title="Reset row to pending for re-generation"></th>
                <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[36px]">Len<Tip text="Character count of the output. Highlighted in red/amber if outside your Min/Max length range." /></th>
                <th className="px-1.5 py-1.5 text-center text-[10px] font-semibold text-zinc-500 w-[32px]">R<Tip text="Number of retry attempts. Shows when output length was outside the Min/Max range and had to be regenerated." /></th>
                <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[130px]">Date<Tip text="Timestamp when this output was generated." /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {virtualState.topPad > 0 && <tr style={{ height: virtualState.topPad }} aria-hidden="true"><td colSpan={9} /></tr>}
              {displayRows.slice(virtualState.startIdx, virtualState.endIdx).map(({ row, origIdx }, i) => (
                <GenerateRowComponent
                  key={row.id}
                  row={row}
                  origIdx={origIdx}
                  isEven={(virtualState.startIdx + i) % 2 === 1}
                  isExpanded={expandedRows.has(row.id)}
                  isBusy={isGenerating}
                  isCopied={copiedRowId === row.id}
                  minLen={settings.minLen}
                  maxLen={settings.maxLen}
                  onInputChange={handleInputChange}
                  onPaste={handlePaste}
                  onClearCell={handleClearCell}
                  onCopyOutput={handleCopyOutput}
                  onToggleExpand={handleToggleExpand}
                  onRetry={handleRetryRow}
                />
              ))}
              {virtualState.bottomPad > 0 && <tr style={{ height: virtualState.bottomPad }} aria-hidden="true"><td colSpan={9} /></tr>}
            </tbody>
          </table>
        </div>
      </div>}

      {/* Log view */}
      {genSubTab === 'log' && (
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-auto max-h-[75vh]">
            <table className="text-sm w-full">
              <thead className="bg-zinc-50 sticky top-0 z-10">
                <tr className="border-b border-zinc-200">
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[140px]">Timestamp</th>
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[90px]">Action</th>
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[140px]">Model</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[50px]">Output</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[40px]">Err</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[55px]">Time</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[50px]">Cost</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[40px]">Avg/s</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[35px]">Con</th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[70px]">Tokens</th>
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {logs.length === 0 ? (
                  <tr><td colSpan={11} className="px-2 py-8 text-center text-xs text-zinc-400">No log entries yet. Generate some outputs to see activity here.</td></tr>
                ) : (
                  [...logs].reverse().map((log, idx) => (
                    <tr key={log.id} className={`hover:bg-zinc-50/50 ${idx % 2 === 1 ? 'bg-zinc-50/40' : ''}`}>
                      <td className="px-1.5 py-1 text-[9px] text-zinc-500 tabular-nums whitespace-nowrap">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-1.5 py-1">
                        <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap ${
                          log.action === 'generate_start' ? 'bg-indigo-100 text-indigo-700' :
                          log.action === 'generate_complete' ? 'bg-emerald-100 text-emerald-700' :
                          log.action === 'generate_stop' ? 'bg-amber-100 text-amber-700' :
                          log.action === 'clear_all' ? 'bg-red-100 text-red-700' :
                          log.action === 'export' ? 'bg-cyan-100 text-cyan-700' :
                          'bg-zinc-100 text-zinc-600'
                        }`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-1.5 py-1 text-[9px] text-zinc-500 truncate max-w-[140px]" title={log.model}>
                        {log.model ? log.model.split('/').pop() : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.outputCount != null ? log.outputCount.toLocaleString() : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums">
                        {log.errorCount != null && log.errorCount > 0 ? <span className="text-red-600">{log.errorCount}</span> : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600 whitespace-nowrap">
                        {log.elapsedMs != null ? formatElapsed(log.elapsedMs) : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.cost != null ? `$${log.cost < 0.01 ? log.cost.toFixed(4) : log.cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.avgPerSec != null ? log.avgPerSec.toFixed(1) : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.concurrency != null ? log.concurrency : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[9px] tabular-nums text-zinc-500 whitespace-nowrap" title={log.promptTokens != null ? `${log.promptTokens.toLocaleString()} in / ${log.completionTokens?.toLocaleString() || 0} out` : ''}>
                        {log.promptTokens != null ? `${((log.promptTokens + (log.completionTokens || 0)) / 1000).toFixed(1)}K` : '—'}
                      </td>
                      <td className="px-1.5 py-1 text-[10px] text-zinc-500">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
});

// ============ Wrapper with sub-tabs ============
export default function GenerateTab() {
  const { addToast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<'1' | '2'>(() => {
    try {
      const raw = localStorage.getItem(activeSubTabCacheKey);
      return raw === '2' ? '2' : '1';
    } catch {
      return '1';
    }
  });
  const tabRef = useRef(activeSubTab);
  const [gen2Activated, setGen2Activated] = useState(() => activeSubTab === '2');

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'generate_active_subtab'), (snap) => {
      markListenerSnapshot('generate_active_subtab', snap);
      if (!snap.exists()) return;
      const tab = snap.data()?.tab;
      if (tab === '1' || tab === '2') {
        try {
          localStorage.setItem(activeSubTabCacheKey, tab);
        } catch {
          // Ignore local cache write failures.
        }
        tabRef.current = tab;
        setActiveSubTab(tab);
        if (tab === '2') setGen2Activated(true);
      }
    }, (err) => {
      markListenerError('generate_active_subtab');
      reportPersistFailure(addToast, 'generate active subtab sync', err);
    });
    return () => {
      clearListenerError('generate_active_subtab');
      if (typeof unsub === 'function') unsub();
    };
  }, [addToast]);

  // Starred models — shared across both instances, persisted to Firestore
  const [starredModels, setStarredModels] = useState<Set<string>>(() => new Set());
  const starredLoadedRef = useRef(false);

  // Load from Firestore and keep it live-synced
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'starred_models'), (snap) => {
      markListenerSnapshot('starred_models', snap);
      const ids: string[] = snap.exists() ? (snap.data().ids || []) : [];
      setStarredModels(new Set(ids));
      starredLoadedRef.current = true;
    }, (err) => {
      markListenerError('starred_models');
      reportPersistFailure(addToast, 'starred models sync (generate)', err);
      starredLoadedRef.current = true;
    });
    return () => {
      clearListenerError('starred_models');
      if (typeof unsub === 'function') unsub();
    };
  }, [addToast]);

  const toggleStarModel = useCallback((modelId: string) => {
    setStarredModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      const arr = [...next];
      // Persist to Firestore in background
      setDoc(doc(db, 'app_settings', 'starred_models'), { ids: arr }).catch((e) =>
        reportPersistFailure(addToast, 'save starred models (generate)', e),
      );
      return next;
    });
  }, [addToast]);

  const switchTab = useCallback((tab: '1' | '2') => {
    if (tabRef.current === tab) return; // Already on this tab — skip entirely
    tabRef.current = tab;
    try {
      localStorage.setItem(activeSubTabCacheKey, tab);
    } catch {
      // Ignore local cache write failures.
    }
    setDoc(doc(db, 'app_settings', 'generate_active_subtab'), {
      tab,
      updatedAt: new Date().toISOString(),
    }).catch((e) => reportPersistFailure(addToast, 'generate active subtab', e));
    if (tab === '2') setGen2Activated(true);
    setActiveSubTab(tab);
  }, [addToast]);

  return (
    <>
      {/* Sub-tab switcher */}
      <div className={`max-w-4xl mx-auto ${compactTabRailClass} mt-2 mb-1`}>
        <button
          onClick={() => switchTab('1')}
          className={`${compactTabBtnBase} ${
            activeSubTab === '1'
              ? compactTabBtnActive
              : compactTabBtnInactive
          }`}
        >
          Generate 1
        </button>
        <button
          onClick={() => switchTab('2')}
          className={`${compactTabBtnBase} ${
            activeSubTab === '2'
              ? compactTabBtnActive
              : compactTabBtnInactive
          }`}
        >
          Generate 2
        </button>
      </div>

      {/* Both use CSS visibility — no layout recalc, GPU-composited hide/show */}
      <div style={activeSubTab === '1' ? undefined : { display: 'none' }}>
        <GenerateTabInstance storageKey="" starredModels={starredModels} onToggleStar={toggleStarModel} />
      </div>
      {gen2Activated && (
        <div style={activeSubTab === '2' ? undefined : { display: 'none' }}>
          <GenerateTabInstance storageKey="_2" starredModels={starredModels} onToggleStar={toggleStarModel} />
        </div>
      )}
    </>
  );
}
