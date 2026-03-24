import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Play, Square, CheckCircle2, AlertCircle, Loader2, ExternalLink, Copy, Settings, Zap, Search } from 'lucide-react';
import ModelSelector from './ModelSelector';
import SettingsControls from './SettingsControls';
import { DEFAULT_AUTO_GROUP_PROMPT } from './AutoGroupEngine';
import type { ClusterSummary, GroupedCluster, AutoGroupCluster, AutoGroupSuggestion, ActivityAction } from './types';
import type { GroupReviewSettingsRef } from './GroupReviewSettings';
import { buildTokenClusters, countCoveredPages, estimateCost, processAutoGroupQueue, setAutoGroupPrompt } from './AutoGroupEngine';
import { processReviewQueue, type ReviewRequest } from './GroupReviewEngine';
import { db } from './firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';

interface AutoGroupPanelProps {
  effectiveClusters: ClusterSummary[] | null;
  onApproveGroups: (groups: GroupedCluster[]) => void;
  groupReviewSettingsRef: React.RefObject<GroupReviewSettingsRef | null>;
  logAndToast: (action: ActivityAction, details: string, count: number, toastMsg: string, toastType?: 'success' | 'info' | 'warning' | 'error') => void;
  persistedSuggestions?: AutoGroupSuggestion[];
  onSuggestionsChange?: (suggestions: AutoGroupSuggestion[]) => void;
}

const AutoGroupPanel: React.FC<AutoGroupPanelProps> = React.memo(({
  effectiveClusters,
  onApproveGroups,
  groupReviewSettingsRef,
  logAndToast,
  persistedSuggestions,
  onSuggestionsChange,
}) => {
  const [subTab, setSubTab] = useState<'clusters' | 'auto-group'>('clusters');
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  // Initialize from persisted suggestions if available
  const [suggestions, setSuggestionsInternal] = useState<AutoGroupSuggestion[]>(persistedSuggestions || []);
  // Sync from persisted data when project loads (async)
  const initializedRef = useRef(false);
  React.useEffect(() => {
    if (persistedSuggestions && persistedSuggestions.length > 0 && !initializedRef.current) {
      setSuggestionsInternal(persistedSuggestions);
      initializedRef.current = true;
    }
  }, [persistedSuggestions]);
  // Wrapper that syncs to parent for persistence
  const setSuggestions = useCallback((update: AutoGroupSuggestion[] | ((prev: AutoGroupSuggestion[]) => AutoGroupSuggestion[])) => {
    setSuggestionsInternal(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (onSuggestionsChange) onSuggestionsChange(next);
      return next;
    });
  }, [onSuggestionsChange]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  // Sort state for Token Clusters
  const [clusterSort, setClusterSort] = useState<{ key: 'pages' | 'volume' | 'kws' | 'kd' | 'confidence' | 'tokens'; dir: 'asc' | 'desc' }>({ key: 'pages', dir: 'desc' });
  // Sort state for Suggestions
  const [sugSort, setSugSort] = useState<{ key: 'name' | 'pages' | 'kws' | 'volume' | 'kd' | 'status' | 'qa'; dir: 'asc' | 'desc' }>({ key: 'volume', dir: 'desc' });
  const [sugSearch, setSugSearch] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [processedCount, setProcessedCount] = useState(0); // completed (API responded)
  const [inFlightCount, setInFlightCount] = useState(0); // started but not yet completed
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  // Dedicated Auto-Group settings (independent from QA settings)
  const [showSettings, setShowSettings] = useState(false);
  const [agApiKey, setAgApiKey] = useState(() => {
    try { return localStorage.getItem('kwg_autogroup_apikey') || ''; } catch { return ''; }
  });
  const [agModel, setAgModel] = useState(() => {
    try { return localStorage.getItem('kwg_autogroup_model') || 'google/gemini-2.0-flash-001'; } catch { return 'google/gemini-2.0-flash-001'; }
  });
  const [agTemperature, setAgTemperature] = useState(() => {
    try { return parseFloat(localStorage.getItem('kwg_autogroup_temperature') || '0.3'); } catch { return 0.3; }
  });
  const [agConcurrency, setAgConcurrency] = useState(() => {
    try { return parseInt(localStorage.getItem('kwg_autogroup_concurrency') || '5'); } catch { return 5; }
  });
  const [agReasoning, setAgReasoning] = useState<boolean | string>(() => {
    try {
      const saved = localStorage.getItem('kwg_autogroup_reasoning');
      if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
      if (saved === 'true') return 'medium'; // migrate old boolean
      return false;
    } catch { return false; }
  });
  const [agModels, setAgModels] = useState<Array<{ id: string; name: string; pricing: { prompt: string; completion: string } }>>([]);
  const [agModelsLoading, setAgModelsLoading] = useState(false);
  const [agModelSearch, setAgModelSearch] = useState('');

  // Persist auto-group settings to localStorage + Firestore
  const saveAgSettings = useCallback(() => {
    const data = {
      apiKey: agApiKey,
      model: agModel,
      temperature: agTemperature,
      concurrency: agConcurrency,
      reasoning: agReasoning === false ? 'off' : String(agReasoning),
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem('kwg_autogroup_apikey', agApiKey);
      localStorage.setItem('kwg_autogroup_model', agModel);
      localStorage.setItem('kwg_autogroup_temperature', String(agTemperature));
      localStorage.setItem('kwg_autogroup_concurrency', String(agConcurrency));
      localStorage.setItem('kwg_autogroup_reasoning', agReasoning === false ? 'off' : String(agReasoning));
    } catch {}
    // Also save to Firestore for cloud persistence
    setDoc(doc(db, 'app_settings', 'autogroup_settings'), data).catch(() => {});
  }, [agApiKey, agModel, agTemperature, agConcurrency, agReasoning]);

  // Auto-save whenever settings change
  useEffect(() => { saveAgSettings(); }, [saveAgSettings]);

  // Load settings from Firestore on mount (overrides localStorage if newer)
  const fsLoadedRef = useRef(false);
  useEffect(() => {
    if (fsLoadedRef.current) return;
    fsLoadedRef.current = true;
    getDoc(doc(db, 'app_settings', 'autogroup_settings')).then(snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.apiKey && !agApiKey) setAgApiKey(d.apiKey);
      if (d.model) setAgModel(d.model);
      if (d.temperature !== undefined) setAgTemperature(Number(d.temperature));
      if (d.concurrency !== undefined) setAgConcurrency(Number(d.concurrency));
      if (d.reasoning) {
        if (d.reasoning === 'off') setAgReasoning(false);
        else if (['low', 'medium', 'high'].includes(d.reasoning)) setAgReasoning(d.reasoning);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch models when API key changes
  React.useEffect(() => {
    if (!agApiKey || agApiKey.length < 10) { setAgModels([]); return; }
    let cancelled = false;
    setAgModelsLoading(true);
    fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${agApiKey}` },
    }).then(r => r.json()).then(data => {
      if (cancelled) return;
      const models = (data.data || [])
        .filter((m: any) => m.pricing)
        .map((m: any) => ({ id: m.id, name: m.name || m.id, pricing: m.pricing }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      setAgModels(models);
    }).catch(() => {}).finally(() => { if (!cancelled) setAgModelsLoading(false); });
    return () => { cancelled = true; };
  }, [agApiKey]);

  const agHasApiKey = agApiKey.trim().length > 10 && agModel.trim().length > 0;
  const agSelectedModelObj = useMemo(() => agModels.find(m => m.id === agModel), [agModels, agModel]);

  // Real-time stats during auto-group run
  const [totalCost, setTotalCost] = useState(0);
  const [totalPromptTokens, setTotalPromptTokens] = useState(0);
  const [totalCompletionTokens, setTotalCompletionTokens] = useState(0);
  // QA cost tracking
  const [qaCost, setQaCost] = useState(0);
  const [qaTokens, setQaTokens] = useState(0);
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  // Timer for elapsed time
  React.useEffect(() => {
    if (!runStartTime || !isRunning) return;
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - runStartTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [runStartTime, isRunning]);

  // QA review state
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [localPrompt, setLocalPrompt] = useState('');
  const [isRunningQA, setIsRunningQA] = useState(false);
  const [qaProcessedCount, setQaProcessedCount] = useState(0);
  const [qaTotalCount, setQaTotalCount] = useState(0);
  const [qaResults, setQaResults] = useState<Map<string, 'approve' | 'mismatch' | 'error'>>(new Map());
  const [qaMismatchPages, setQaMismatchPages] = useState<Map<string, string[]>>(new Map());
  const qaAbortRef = useRef<AbortController | null>(null);

  // Compute token clusters from ungrouped pages
  const clusters = useMemo(() => {
    if (!effectiveClusters || effectiveClusters.length < 2) return [];
    return buildTokenClusters(effectiveClusters);
  }, [effectiveClusters]);

  const coveredPages = useMemo(() => countCoveredPages(clusters), [clusters]);
  const totalPages = effectiveClusters?.length || 0;
  const coveragePercent = totalPages > 0 ? Math.round((coveredPages / totalPages) * 100) : 0;

  // Sorted clusters
  const sortedClusters = useMemo(() => {
    const sorted = [...clusters];
    const dir = clusterSort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (clusterSort.key) {
        case 'pages': return (a.pageCount - b.pageCount) * dir;
        case 'volume': return (a.totalVolume - b.totalVolume) * dir;
        case 'kws': return (a.keywordCount - b.keywordCount) * dir;
        case 'kd': return ((a.avgKd || 0) - (b.avgKd || 0)) * dir;
        case 'tokens': return (a.sharedTokens.length - b.sharedTokens.length) * dir;
        case 'confidence': {
          const order = { high: 3, medium: 2, review: 1 };
          return ((order[a.confidence] || 0) - (order[b.confidence] || 0)) * dir;
        }
        default: return 0;
      }
    });
    return sorted;
  }, [clusters, clusterSort]);

  // Sorted suggestions
  const sortedSuggestions = useMemo(() => {
    let filtered = suggestions;
    if (sugSearch.trim()) {
      const q = sugSearch.toLowerCase();
      filtered = suggestions.filter(s => s.groupName.toLowerCase().includes(q) || s.pages.some(p => p.pageName.toLowerCase().includes(q)));
    }
    const sorted = [...filtered];
    const dir = sugSort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sugSort.key) {
        case 'name': return a.groupName.localeCompare(b.groupName) * dir;
        case 'pages': return (a.pages.length - b.pages.length) * dir;
        case 'kws': return (a.keywordCount - b.keywordCount) * dir;
        case 'volume': return (a.totalVolume - b.totalVolume) * dir;
        case 'kd': return ((a.avgKd || 0) - (b.avgKd || 0)) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
        case 'qa': {
          const qaOrder = { approve: 3, mismatch: 2, error: 1, undefined: 0 };
          return ((qaOrder[(a as any).qaStatus || 'undefined'] || 0) - (qaOrder[(b as any).qaStatus || 'undefined'] || 0)) * dir;
        }
        default: return 0;
      }
    });
    return sorted;
  }, [suggestions, sugSort, sugSearch]);

  // Use dedicated auto-group API key (fall back to QA settings if not set)
  const hasApiKey = agHasApiKey || (groupReviewSettingsRef.current?.hasApiKey() ?? false);
  const getActiveSettings = useCallback(() => {
    if (agHasApiKey) return { apiKey: agApiKey, model: agModel, temperature: agTemperature, concurrency: agConcurrency, reasoning: agReasoning };
    const qs = groupReviewSettingsRef.current?.getSettings();
    if (qs) return { apiKey: qs.apiKey, model: qs.selectedModel, temperature: qs.temperature, concurrency: qs.rateLimit || 5, reasoning: (qs as any).reasoning || false };
    return null;
  }, [agHasApiKey, agApiKey, agModel, agTemperature, agConcurrency, agReasoning, groupReviewSettingsRef]);
  const getActiveModelObj = useCallback(() => {
    if (agHasApiKey && agSelectedModelObj) return agSelectedModelObj;
    return groupReviewSettingsRef.current?.getSelectedModelObj() || null;
  }, [agHasApiKey, agSelectedModelObj, groupReviewSettingsRef]);

  // Sort helpers
  const toggleClusterSort = useCallback((key: typeof clusterSort.key) => {
    setClusterSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }, []);
  const toggleSugSort = useCallback((key: typeof sugSort.key) => {
    setSugSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  }, []);
  const SortIcon = ({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) => (
    <span className={`text-[8px] ml-0.5 ${active ? 'text-violet-600' : 'text-zinc-300'}`}>{active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
  );

  // Toggle cluster expansion
  const toggleCluster = useCallback((id: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSuggestion = useCallback((id: string) => {
    setExpandedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Run auto-group
  const handleRunAutoGroup = useCallback(async () => {
    if (!hasApiKey || clusters.length === 0) return;
    const activeSettings = getActiveSettings();
    const modelObj = getActiveModelObj();
    if (!activeSettings) return;

    // Apply custom auto-group prompt if set
    const qaSettings = groupReviewSettingsRef.current?.getSettings();
    if (qaSettings?.autoGroupPrompt) setAutoGroupPrompt(qaSettings.autoGroupPrompt);

    // Cost estimate
    const pricing = modelObj?.pricing || { prompt: '0.000001', completion: '0.000002' };
    const est = estimateCost(clusters, pricing);
    const proceed = window.confirm(`Auto-group will process ${clusters.length} clusters (~${clusters.reduce((s, c) => s + c.pageCount, 0)} pages).\n\nEstimated cost: $${est < 0.01 ? est.toFixed(4) : est.toFixed(2)}\n\nProceed?`);
    if (!proceed) return;

    setIsRunning(true);
    setIsComplete(false);
    setProcessedCount(0);
    setInFlightCount(0);
    setTotalToProcess(clusters.length);
    setSuggestions([]);
    setSelectedSuggestions(new Set());
    setTotalCost(0);
    setTotalPromptTokens(0);
    setTotalCompletionTokens(0);
    setErrorCount(0);
    setRunStartTime(Date.now());

    const controller = new AbortController();
    abortRef.current = controller;

    let sugCount = 0;

    await processAutoGroupQueue(
      clusters,
      {
        apiKey: activeSettings.apiKey,
        model: activeSettings.model,
        temperature: activeSettings.temperature,
        maxTokens: 4096,
        systemPrompt: '',
        concurrency: activeSettings.concurrency,
        modelPricing: pricing,
        reasoningEffort: activeSettings.reasoning && activeSettings.reasoning !== false ? (typeof activeSettings.reasoning === 'string' ? activeSettings.reasoning : 'medium') as 'low' | 'medium' | 'high' : undefined,
      },
      {
        onProcessing: () => setInFlightCount(p => p + 1),
        onCompleted: () => { setProcessedCount(p => p + 1); setInFlightCount(p => Math.max(0, p - 1)); },
        onSuggestions: (_clusterId, newSuggestions) => {
          sugCount += newSuggestions.length;
          setSuggestions(prev => [...prev, ...newSuggestions]);
        },
        onError: (clusterId, error) => {
          console.warn('Auto-group error for cluster', clusterId, error);
          setErrorCount(p => p + 1);
        },
        onCost: (pt, ct, cost) => {
          setTotalPromptTokens(p => p + pt);
          setTotalCompletionTokens(p => p + ct);
          setTotalCost(p => p + cost);
        },
        onComplete: (processed, totalSugs) => {
          setIsComplete(true);
          logAndToast('auto-group', `Auto-group completed: ${totalSugs} groups from ${processed} clusters`, totalSugs, `Auto-group complete: ${totalSugs} groups created from ${processed} clusters`, 'success');
        },
      },
      controller.signal
    );

    setIsRunning(false);
    setIsComplete(true);
    abortRef.current = null;
  }, [hasApiKey, clusters, groupReviewSettingsRef, logAndToast, suggestions.length, getActiveSettings, getActiveModelObj]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  // Run QA review on all suggestions
  const handleRunQA = useCallback(async () => {
    if (suggestions.length === 0 || !hasApiKey) return;
    const activeSettings = getActiveSettings();
    const modelObj = getActiveModelObj();
    if (!activeSettings) return;

    setIsRunningQA(true);
    setQaProcessedCount(0);
    setQaTotalCount(suggestions.length);
    setQaResults(new Map());
    setQaMismatchPages(new Map());
    setQaCost(0);
    setQaTokens(0);

    const controller = new AbortController();
    qaAbortRef.current = controller;

    const pricing = modelObj?.pricing || { prompt: '0.000001', completion: '0.000002' };

    // Build review requests from suggestions — include groupId and page tokens
    const requests: ReviewRequest[] = suggestions.map(s => ({
      groupId: s.id,
      groupName: s.groupName,
      pages: s.pages.map(p => ({ pageName: p.pageName, tokens: p.tokenArr })),
    }));

    // Build id→suggestion lookup for fast matching
    const sugLookup = new Map<string, AutoGroupSuggestion>(suggestions.map(s => [s.id, s]));

    await processReviewQueue(
      requests,
      {
        apiKey: activeSettings.apiKey,
        model: activeSettings.model,
        temperature: activeSettings.temperature,
        maxTokens: 4096,
        systemPrompt: groupReviewSettingsRef.current?.getSettings()?.systemPrompt || '',
        concurrency: activeSettings.concurrency,
        modelPricing: pricing,
        reasoningEffort: activeSettings.reasoning && activeSettings.reasoning !== false ? (typeof activeSettings.reasoning === 'string' ? activeSettings.reasoning : 'medium') as 'low' | 'medium' | 'high' : undefined,
      },
      {
        onReviewing: () => {},
        onResult: (result) => {
          setQaProcessedCount(p => p + 1);
          // Track QA cost
          if (result.cost) {
            setQaCost(prev => prev + result.cost);
            setQaTokens(prev => prev + (result.promptTokens || 0) + (result.completionTokens || 0));
          }
          const suggestion = sugLookup.get(result.groupId);
          if (suggestion) {
            setQaResults(prev => {
              const next = new Map(prev);
              next.set(suggestion.id, result.status);
              return next;
            });
            if (result.status === 'mismatch' && result.mismatchedPages) {
              setQaMismatchPages(prev => {
                const next = new Map(prev);
                next.set(suggestion.id, result.mismatchedPages);
                return next;
              });
            }
            setSuggestions(prev => prev.map(s =>
              s.id === suggestion.id
                ? { ...s, qaStatus: result.status as 'approve' | 'mismatch', qaMismatchedPages: result.mismatchedPages }
                : s
            ));
          }
        },
        onError: (error) => {
          setQaProcessedCount(p => p + 1);
          const suggestion = sugLookup.get(error.groupId);
          if (suggestion) {
            setQaResults(prev => {
              const next = new Map(prev);
              next.set(suggestion.id, 'error');
              return next;
            });
            setSuggestions(prev => prev.map(s =>
              s.id === suggestion.id ? { ...s, qaStatus: 'error' as const } : s
            ));
          }
        },
      },
      controller.signal
    );

    setIsRunningQA(false);
    qaAbortRef.current = null;

    // Read final counts from the refs/state that were updated during callbacks
    // Use a functional read of qaResults to avoid stale closure
    setQaResults(prev => {
      const approveCount = [...prev.values()].filter(s => s === 'approve').length;
      const mismatchCount = [...prev.values()].filter(s => s === 'mismatch').length;
      logAndToast('qa-review', `QA: ${approveCount} approved, ${mismatchCount} mismatched`, prev.size, `QA complete: ${approveCount} ✓, ${mismatchCount} ✗`, mismatchCount > 0 ? 'warning' : 'success');
      return prev; // Don't change state, just read it
    });
  }, [suggestions, hasApiKey, groupReviewSettingsRef, logAndToast, getActiveSettings, getActiveModelObj]);

  const handleStopQA = useCallback(() => {
    qaAbortRef.current?.abort();
    setIsRunningQA(false);
  }, []);

  // Approve selected suggestions
  const handleApprove = useCallback((ids: Set<string>) => {
    const toApprove = suggestions.filter(s => ids.has(s.id));
    if (toApprove.length === 0) return;

    const newGroups: GroupedCluster[] = toApprove.map(s => ({
      id: `autogroup_${s.id}`,
      groupName: s.groupName,
      clusters: s.pages,
      totalVolume: s.totalVolume,
      keywordCount: s.keywordCount,
      avgKd: s.avgKd,
      reviewStatus: (s.qaStatus || qaResults.get(s.id) || 'pending') as 'approve' | 'mismatch' | 'pending' | 'error',
      reviewMismatchedPages: s.qaMismatchedPages || qaMismatchPages.get(s.id),
    }));

    onApproveGroups(newGroups);

    // Remove approved from suggestions
    setSuggestions(prev => prev.filter(s => !ids.has(s.id)));
    setSelectedSuggestions(new Set());
    logAndToast('auto-group', `Approved ${newGroups.length} auto-groups`, newGroups.length, `Approved ${newGroups.length} auto-groups (${newGroups.reduce((s, g) => s + g.clusters.length, 0)} pages)`, 'success');
  }, [suggestions, onApproveGroups, logAndToast]);

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col flex-1 min-w-0">
      <div className="px-4 py-2 border-b border-zinc-200 bg-zinc-50/50">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-violet-500" />Auto-Group</h3>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span>{clusters.length} clusters</span>
            <span>·</span>
            <span>{coveredPages.toLocaleString()} / {totalPages.toLocaleString()} pages ({coveragePercent}%)</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSubTab('clusters')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${subTab === 'clusters' ? 'bg-white shadow-sm text-zinc-900 border border-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Token Clusters ({clusters.length})
          </button>
          <button
            onClick={() => setSubTab('auto-group')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${subTab === 'auto-group' ? 'bg-white shadow-sm text-zinc-900 border border-zinc-200' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            Auto-Group {suggestions.length > 0 && `(${suggestions.length})`}
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`p-1 rounded-md transition-colors ml-1 ${showSettings ? 'bg-indigo-100 text-indigo-600' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'}`}
            title="Auto-Group Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Panel — API key, model, temperature, concurrency, reasoning */}
      {showSettings && (
        <div className="mx-4 mb-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700">Auto-Group Settings</span>
            {agHasApiKey && <span className="text-[10px] text-emerald-600 font-medium">✓ Connected</span>}
          </div>
          {/* API Key */}
          <div>
            <label className="block text-[10px] font-medium text-zinc-500 mb-0.5">OpenRouter API Key</label>
            <input
              type="password"
              value={agApiKey}
              onChange={e => setAgApiKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full px-2 py-1 text-xs border border-zinc-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
            />
          </div>
          {/* Model selector — shared component */}
          <ModelSelector
            apiKey={agApiKey}
            selectedModel={agModel}
            onSelectModel={setAgModel}
            label="Model"
          />
          {/* Temperature + Concurrency + Reasoning — shared component */}
          <SettingsControls
            temperature={agTemperature}
            onTemperatureChange={setAgTemperature}
            concurrency={agConcurrency}
            onConcurrencyChange={setAgConcurrency}
            maxConcurrency={100}
            reasoning={agReasoning}
            onReasoningChange={setAgReasoning}
          />
        </div>
      )}

      {/* Sub-tab 1: Token Clusters */}
      {subTab === 'clusters' && (
        <div className="overflow-auto flex-1 max-h-[65vh]">
          {clusters.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-400">
              {totalPages < 2 ? 'Need at least 2 ungrouped pages to find clusters.' : 'No pages share 4+ tokens. Try grouping manually or adjust your processing settings.'}
            </div>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleClusterSort('tokens')}>
                    Shared Tokens <SortIcon active={clusterSort.key === 'tokens'} dir={clusterSort.dir} />
                  </th>
                  <th className="px-2 py-2 text-right w-[50px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleClusterSort('pages')}>
                    Pages <SortIcon active={clusterSort.key === 'pages'} dir={clusterSort.dir} />
                  </th>
                  <th className="px-2 py-2 text-right w-[50px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleClusterSort('kws')}>
                    KWs <SortIcon active={clusterSort.key === 'kws'} dir={clusterSort.dir} />
                  </th>
                  <th className="px-2 py-2 text-right w-[70px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleClusterSort('volume')}>
                    Vol. <SortIcon active={clusterSort.key === 'volume'} dir={clusterSort.dir} />
                  </th>
                  <th className="px-2 py-2 text-right w-[40px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleClusterSort('kd')}>
                    KD <SortIcon active={clusterSort.key === 'kd'} dir={clusterSort.dir} />
                  </th>
                  <th className="px-2 py-2 text-center w-[60px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleClusterSort('confidence')}>
                    Confidence <SortIcon active={clusterSort.key === 'confidence'} dir={clusterSort.dir} />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sortedClusters.map(cluster => (
                  <React.Fragment key={cluster.id}>
                    <tr
                      className="hover:bg-zinc-50/50 transition-colors cursor-pointer"
                      onClick={() => toggleCluster(cluster.id)}
                    >
                      <td className="px-3 py-1.5">
                        {expandedClusters.has(cluster.id) ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {cluster.sharedTokens.map(t => (
                            <span key={t} className="px-1.5 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded text-[10px] font-medium">{t}</span>
                          ))}
                          {cluster.isIdentical && <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded text-[9px] font-semibold">100% match</span>}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{cluster.pageCount}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{cluster.keywordCount.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{cluster.totalVolume.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{cluster.avgKd !== null ? cluster.avgKd : '-'}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                          cluster.confidence === 'high' ? 'bg-emerald-50 text-emerald-700' :
                          cluster.confidence === 'medium' ? 'bg-amber-50 text-amber-700' :
                          'bg-red-50 text-red-700'
                        }`}>
                          {cluster.confidence}
                        </span>
                      </td>
                    </tr>
                    {expandedClusters.has(cluster.id) && cluster.pages.map(page => (
                      <tr key={page.tokens} className="bg-zinc-50/30">
                        <td></td>
                        <td className="px-3 py-1 pl-8 text-[11px] text-zinc-700">
                          <div className="flex items-center gap-1.5 group/subpage">
                            <span className="truncate">{page.pageName}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(page.pageName)}`, '_blank'); }}
                              className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/subpage:opacity-100 transition-opacity shrink-0"
                              title="Search Google SERPs"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(page.pageName); }}
                              className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/subpage:opacity-100 transition-opacity shrink-0"
                              title="Copy"
                            >
                              <Copy className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-[11px] text-zinc-500">{page.keywordCount}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[11px] text-zinc-500">{page.keywordCount}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[11px] text-zinc-500">{page.totalVolume.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-[11px] text-zinc-500">{page.avgKd !== null ? page.avgKd : '-'}</td>
                        <td className="px-2 py-1 text-center text-[10px] text-zinc-400">{page.tokenArr.length} tok</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Sub-tab 2: Auto-Group */}
      {subTab === 'auto-group' && (
        <div className="flex-1 flex flex-col">
          {/* Row 1: Run button + progress bar + stats — always single line */}
          <div className="px-3 py-1.5 border-b border-zinc-100 flex items-center gap-2 min-h-[36px] overflow-hidden">
            {!isRunning ? (
              <button
                onClick={handleRunAutoGroup}
                disabled={!hasApiKey || clusters.length === 0}
                className="px-3 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Play className="w-3 h-3" />
                Run ({clusters.length})
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <Square className="w-3 h-3" />
                Stop
              </button>
            )}

            {/* Progress bar — only when running or complete */}
            {(isRunning || isComplete) && (() => {
              const agPct = totalToProcess > 0 ? Math.round((processedCount / totalToProcess) * 100) : 0;
              return (
                <div className="relative w-28 h-4 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200 shrink-0">
                  <div className={`h-full rounded-full transition-all duration-500 ${isComplete ? 'bg-emerald-400' : 'bg-violet-400'}`} style={{ width: `${agPct}%` }} />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-zinc-700">{agPct}%{isComplete ? ' ✓' : ''}</span>
                </div>
              );
            })()}

            {/* Inline stats — tight, no wrapping */}
            {(isRunning || isComplete) && (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 shrink-0 whitespace-nowrap">
                {isRunning && <Loader2 className="w-3 h-3 animate-spin text-violet-500" />}
                {suggestions.length > 0 && <span className="text-violet-600 font-semibold">{suggestions.length} groups</span>}
                {errorCount > 0 && <span className="text-red-500 font-semibold" title="Clusters with errors (invalid JSON, API error)">{errorCount} err</span>}
                <span className="tabular-nums">{Math.floor(elapsedMs / 1000)}s</span>
                <span className={`px-1 py-0.5 rounded font-medium ${isRunning ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'}`}>
                  ${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}
                </span>
              </div>
            )}

            {/* QA inline — only when running QA */}
            {isRunningQA && (() => {
              const qaPct = qaTotalCount > 0 ? Math.round((qaProcessedCount / qaTotalCount) * 100) : 0;
              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="relative w-20 h-4 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200">
                    <div className="h-full rounded-full transition-all duration-500 bg-blue-400" style={{ width: `${qaPct}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-zinc-700">QA {qaPct}%</span>
                  </div>
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                  <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700">${qaCost < 0.01 ? qaCost.toFixed(4) : qaCost.toFixed(2)}</span>
                  <button onClick={handleStopQA} className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors">Stop</button>
                </div>
              );
            })()}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action buttons — right side */}
            {suggestions.length > 0 && !isRunning && !isRunningQA && (
              <div className="flex items-center gap-1.5 shrink-0">
                {/* QA button */}
                {qaResults.size < suggestions.length && (
                  <button
                    onClick={handleRunQA}
                    disabled={!hasApiKey}
                    className="px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    QA ({suggestions.length})
                  </button>
                )}
                {/* QA stats */}
                {qaResults.size > 0 && (
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-emerald-600 font-semibold">{[...qaResults.values()].filter(s => s === 'approve').length}✓</span>
                    <span className="text-red-600 font-semibold">{[...qaResults.values()].filter(s => s === 'mismatch').length}✗</span>
                    {qaCost > 0 && <span className="px-1 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">${qaCost < 0.01 ? qaCost.toFixed(4) : qaCost.toFixed(2)}</span>}
                  </div>
                )}
                {/* Approve / Dismiss */}
                <button
                  onClick={() => handleApprove(new Set(suggestions.map(s => s.id)))}
                  className="px-2.5 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  Approve All ({suggestions.length})
                </button>
                {selectedSuggestions.size > 0 && (
                  <button
                    onClick={() => handleApprove(selectedSuggestions)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Approve Selected ({selectedSuggestions.size})
                  </button>
                )}
                <button
                  onClick={() => { setSuggestions([]); setSelectedSuggestions(new Set()); setQaResults(new Map()); setQaMismatchPages(new Map()); }}
                  className="px-3 py-1.5 text-xs font-medium text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"
                >
                  Dismiss All
                </button>
              </div>
            )}

            {!hasApiKey && (
              <span className="text-[11px] text-amber-600">Configure API key in Settings → Group Review to enable</span>
            )}

            {/* Prompt toggle */}
            <div className="flex-1" />
            <button
              onClick={() => {
                if (!showPromptEditor) {
                  // Load current prompt from settings
                  const settings = groupReviewSettingsRef.current?.getSettings();
                  setLocalPrompt(settings?.autoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT);
                }
                setShowPromptEditor(prev => !prev);
              }}
              className={`p-1.5 rounded-lg transition-colors ${showPromptEditor ? 'bg-violet-100 text-violet-700' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'}`}
              title="Auto-Group Prompt Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Collapsible Prompt Editor */}
          {showPromptEditor && (
            <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50/30">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-zinc-700">Auto-Group Prompt</label>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-zinc-400 italic">Auto-saves</span>
                  {localPrompt !== DEFAULT_AUTO_GROUP_PROMPT && (
                    <button
                      onClick={() => {
                        setLocalPrompt(DEFAULT_AUTO_GROUP_PROMPT);
                        setAutoGroupPrompt(DEFAULT_AUTO_GROUP_PROMPT);
                        const settingsRef = groupReviewSettingsRef.current;
                        if (settingsRef) {
                          const current = settingsRef.getSettings();
                          if (current) settingsRef.updateSettings({ ...current, autoGroupPrompt: DEFAULT_AUTO_GROUP_PROMPT });
                        }
                      }}
                      className="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
              <textarea
                value={localPrompt}
                onChange={(e) => {
                  const val = e.target.value;
                  setLocalPrompt(val);
                  // Auto-save on change (debounced via the component's own state)
                  setAutoGroupPrompt(val);
                  const settingsRef = groupReviewSettingsRef.current;
                  if (settingsRef) {
                    const current = settingsRef.getSettings();
                    if (current) settingsRef.updateSettings({ ...current, autoGroupPrompt: val });
                  }
                }}
                rows={8}
                className="w-full text-[11px] px-3 py-2 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 bg-white resize-y font-mono leading-relaxed"
                placeholder="Enter the system prompt for auto-grouping..."
              />
              <p className="mt-1.5 text-[10px] text-zinc-400">
                This prompt instructs the LLM how to split token clusters into semantic groups. Be specific about when pages should be grouped vs. separated.
              </p>
            </div>
          )}

          {/* Results */}
          <div className="overflow-auto flex-1 max-h-[60vh]">
            {suggestions.length === 0 && !isRunning ? (
              <div className="py-12 text-center text-sm text-zinc-400">
                {clusters.length === 0 ? 'No clusters available. Upload a CSV with more data.' : 'Click "Run Auto-Group" to generate semantic groups from token clusters.'}
              </div>
            ) : (
              <table className="w-full text-left text-[12px]">
                <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                        checked={suggestions.length > 0 && suggestions.every(s => selectedSuggestions.has(s.id))}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedSuggestions(new Set(suggestions.map(s => s.id)));
                          else setSelectedSuggestions(new Set());
                        }}
                      />
                    </th>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('name')}>
                          Group Name <SortIcon active={sugSort.key === 'name'} dir={sugSort.dir} />
                        </span>
                        <div className="relative ml-auto">
                          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-300" />
                          <input
                            type="text"
                            value={sugSearch}
                            onChange={e => setSugSearch(e.target.value)}
                            placeholder="Search..."
                            className="w-24 pl-5 pr-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
                          />
                        </div>
                      </div>
                    </th>
                    <th className="px-2 py-2 text-right w-[50px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('pages')}>
                      Pages <SortIcon active={sugSort.key === 'pages'} dir={sugSort.dir} />
                    </th>
                    <th className="px-2 py-2 text-right w-[50px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('kws')}>
                      KWs <SortIcon active={sugSort.key === 'kws'} dir={sugSort.dir} />
                    </th>
                    <th className="px-2 py-2 text-right w-[70px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('volume')}>
                      Vol. <SortIcon active={sugSort.key === 'volume'} dir={sugSort.dir} />
                    </th>
                    <th className="px-2 py-2 text-right w-[40px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('kd')}>
                      KD <SortIcon active={sugSort.key === 'kd'} dir={sugSort.dir} />
                    </th>
                    <th className="px-2 py-2 text-center w-[60px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('status')}>
                      Status <SortIcon active={sugSort.key === 'status'} dir={sugSort.dir} />
                    </th>
                    <th className="px-2 py-2 text-center w-[40px] cursor-pointer select-none hover:text-zinc-700" onClick={() => toggleSugSort('qa')}>
                      QA <SortIcon active={sugSort.key === 'qa'} dir={sugSort.dir} />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {sortedSuggestions.map(suggestion => (
                    <React.Fragment key={suggestion.id}>
                      <tr
                        className="hover:bg-zinc-50/50 transition-colors cursor-pointer"
                        onClick={() => toggleSuggestion(suggestion.id)}
                      >
                        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                            checked={selectedSuggestions.has(suggestion.id)}
                            onChange={(e) => {
                              const next = new Set(selectedSuggestions);
                              if (e.target.checked) next.add(suggestion.id); else next.delete(suggestion.id);
                              setSelectedSuggestions(next);
                            }}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          {expandedSuggestions.has(suggestion.id) ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                        </td>
                        <td className="px-3 py-1.5 font-medium text-zinc-700">{suggestion.groupName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{suggestion.pages.length}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{suggestion.keywordCount.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{suggestion.totalVolume.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">{suggestion.avgKd !== null ? suggestion.avgKd : '-'}</td>
                        <td className="px-2 py-1.5 text-center">
                          {suggestion.status === 'pending' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 font-medium">Pending</span>}
                          {suggestion.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-violet-500 mx-auto" />}
                          {suggestion.status === 'approved' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />}
                          {suggestion.status === 'mismatch' && <AlertCircle className="w-3.5 h-3.5 text-red-500 mx-auto" title={suggestion.reviewReason} />}
                          {suggestion.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-amber-500 mx-auto" title={suggestion.reviewReason} />}
                          {suggestion.status === 'manual-review' && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">Manual</span>}
                        </td>
                        {/* QA status */}
                        <td className="px-2 py-1.5 text-center">
                          {suggestion.qaStatus === 'approve' && <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" title="QA Approved" />}
                          {suggestion.qaStatus === 'mismatch' && (
                            <span className="inline-block w-3 h-3 rounded-full bg-red-500 cursor-help" title={`Mismatched: ${(suggestion.qaMismatchedPages || []).join(', ')}`} />
                          )}
                          {suggestion.qaStatus === 'error' && <span className="inline-block w-3 h-3 rounded-full bg-amber-500" title="QA Error" />}
                          {!suggestion.qaStatus && <span className="text-zinc-300">-</span>}
                        </td>
                      </tr>
                      {expandedSuggestions.has(suggestion.id) && suggestion.pages.map(page => {
                        const isMismatched = suggestion.qaMismatchedPages?.includes(page.pageName);
                        return (
                          <tr key={page.tokens} className={`${isMismatched ? 'bg-red-50/50' : 'bg-violet-50/30'}`}>
                            <td></td>
                            <td></td>
                            <td className="px-3 py-1 pl-6 text-[11px] text-zinc-600" colSpan={3}>
                              <div className="flex items-center gap-1.5">
                                {isMismatched && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Mismatched" />}
                                <span className={`truncate ${isMismatched ? 'text-red-600 line-through' : ''}`}>{page.pageName}</span>
                                <span className="text-zinc-400">·</span>
                                <span className="text-zinc-400 tabular-nums">{page.totalVolume.toLocaleString()} vol</span>
                              </div>
                            </td>
                            <td></td>
                            <td></td>
                            <td></td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

AutoGroupPanel.displayName = 'AutoGroupPanel';
export default AutoGroupPanel;
