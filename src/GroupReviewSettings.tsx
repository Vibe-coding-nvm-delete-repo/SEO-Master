// GroupReviewSettings.tsx — Settings panel for AI group review
// Shared settings live in Firestore.

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Star, Check, ChevronDown, Search, Eye, EyeOff, Loader2 } from 'lucide-react';
import { DEFAULT_SYSTEM_PROMPT } from './GroupReviewEngine';
import { DEFAULT_AUTO_GROUP_PROMPT } from './AutoGroupEngine';
import { DEFAULT_KEYWORD_RATING_PROMPT } from './KeywordRatingEngine';
import { DEFAULT_AUTO_MERGE_PROMPT } from './AutoMergeEngine';
import { DEFAULT_EMBEDDING_MODEL } from './CosineEngine';
import type { PersistToastFn } from './persistenceErrors';
import { reportPersistFailure } from './persistenceErrors';
import InlineHelpHint from './InlineHelpHint';
import {
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  loadCachedState,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
} from './appSettingsPersistence';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  normalizePreferredOpenRouterModel,
} from './modelDefaults';
import { useLatestPersistQueue } from './useLatestPersistQueue';
import { CLOUD_SYNC_CHANNELS } from './cloudSyncStatus';

// ============ Types ============

export interface GroupReviewSettingsData {
  apiKey: string;
  selectedModel: string;
  concurrency: number;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  autoGroupPrompt: string;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  /** Keyword relevance job — same OpenRouter API key; separate model/params */
  keywordRatingModel: string;
  keywordRatingTemperature: number;
  keywordRatingMaxTokens: number;
  keywordRatingConcurrency: number;
  keywordRatingReasoningEffort: 'none' | 'low' | 'medium' | 'high';
  keywordRatingPrompt: string;
  keywordCoreIntentSummary: string;
  keywordCoreIntentSummaryUpdatedAt: string;
  autoMergeModel: string;
  autoMergeTemperature: number;
  autoMergeMaxTokens: number;
  autoMergeConcurrency: number;
  autoMergeReasoningEffort: 'none' | 'low' | 'medium' | 'high';
  autoMergePrompt: string;
  groupAutoMergeEmbeddingModel: string;
  groupAutoMergeMinSimilarity: number;
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
}

export interface GroupReviewSettingsRef {
  getSettings: () => GroupReviewSettingsData;
  getSelectedModelObj: () => OpenRouterModel | undefined;
  hasApiKey: () => boolean;
  updateSettings: (newSettings: GroupReviewSettingsData) => void;
}

// ============ Storage keys ============
const FS_DOC = 'group_review_settings';
const LS_SETTINGS_KEY = 'kwg_group_review_settings';

const toSharedSettings = (settings: GroupReviewSettingsData) => ({
  apiKey: settings.apiKey,
  selectedModel: settings.selectedModel,
  concurrency: settings.concurrency,
  temperature: settings.temperature,
  maxTokens: settings.maxTokens,
  systemPrompt: settings.systemPrompt,
  autoGroupPrompt: settings.autoGroupPrompt,
  reasoningEffort: settings.reasoningEffort,
  keywordRatingModel: settings.keywordRatingModel,
  keywordRatingTemperature: settings.keywordRatingTemperature,
  keywordRatingMaxTokens: settings.keywordRatingMaxTokens,
  keywordRatingConcurrency: settings.keywordRatingConcurrency,
  keywordRatingReasoningEffort: settings.keywordRatingReasoningEffort,
  keywordRatingPrompt: settings.keywordRatingPrompt,
  keywordCoreIntentSummary: settings.keywordCoreIntentSummary,
  keywordCoreIntentSummaryUpdatedAt: settings.keywordCoreIntentSummaryUpdatedAt,
  autoMergeModel: settings.autoMergeModel,
  autoMergeTemperature: settings.autoMergeTemperature,
  autoMergeMaxTokens: settings.autoMergeMaxTokens,
  autoMergeConcurrency: settings.autoMergeConcurrency,
  autoMergeReasoningEffort: settings.autoMergeReasoningEffort,
  autoMergePrompt: settings.autoMergePrompt,
  groupAutoMergeEmbeddingModel: settings.groupAutoMergeEmbeddingModel,
  groupAutoMergeMinSimilarity: settings.groupAutoMergeMinSimilarity,
});

function normalizeOptionalOverrideModel(modelId: string, availableModelIds: readonly string[]): string {
  const trimmed = modelId.trim();
  if (!trimmed) return '';
  return normalizePreferredOpenRouterModel(trimmed, availableModelIds);
}

function isEmbeddingModel(model: OpenRouterModel): boolean {
  const haystack = `${model.id} ${model.name}`.toLowerCase();
  return haystack.includes('embed') || haystack.includes('e5-') || haystack.includes('bge-') || haystack.includes('gte-') || haystack.includes('nomic');
}

const HelpLabel = ({ label, help, trailing }: { label: string; help: string; trailing?: React.ReactNode }) => (
  <div className="flex items-center gap-1 mb-1">
    <label className="block text-[10px] font-medium text-zinc-500">{label}</label>
    <InlineHelpHint
      text={help}
      ariaLabel={`${label} help: ${help}`}
      className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-zinc-300 px-1 text-[9px] font-semibold text-zinc-500 cursor-help bg-white"
    >
      ?
    </InlineHelpHint>
    {trailing}
  </div>
);

function ModelPicker(props: {
  label: string;
  help: string;
  value: string;
  onChange: (modelId: string) => void;
  models: OpenRouterModel[];
  starredModels: Set<string>;
  onToggleStar: (modelId: string) => void;
  loading?: boolean;
}) {
  const { label, help, value, onChange, models, starredModels, onToggleStar, loading } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const selected = useMemo(() => models.find(m => m.id === value), [models, value]);

  const filteredModels = useMemo(() => {
    let list = models;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    if (sort === 'price-asc') {
      list = [...list].sort((a, b) => parseFloat(a.pricing.prompt) - parseFloat(b.pricing.prompt));
    } else if (sort === 'price-desc') {
      list = [...list].sort((a, b) => parseFloat(b.pricing.prompt) - parseFloat(a.pricing.prompt));
    }
    const starred = list.filter(m => starredModels.has(m.id));
    const unstarred = list.filter(m => !starredModels.has(m.id));
    return starred.length > 0
      ? [...starred, { id: '__divider__', name: '', pricing: { prompt: '0', completion: '0' }, context_length: 0 } as OpenRouterModel, ...unstarred]
      : unstarred;
  }, [models, search, sort, starredModels]);

  return (
    <div>
      <HelpLabel
        label={label}
        help={help}
        trailing={loading ? <Loader2 className="w-3 h-3 animate-spin text-zinc-400" /> : null}
      />
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg text-left flex items-center justify-between hover:border-zinc-400 transition-colors bg-white"
        >
          <span className="truncate text-zinc-700">{selected?.name || value || 'Select model...'}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        </button>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-[300px] overflow-hidden flex flex-col">
              <div className="p-2 border-b border-zinc-100 flex gap-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models..."
                    className="w-full pl-7 pr-2 py-1 text-[11px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    autoFocus
                  />
                </div>
                <button onClick={() => setSort('name')} className={`px-1.5 py-0.5 text-[10px] rounded ${sort === 'name' ? 'bg-indigo-100 text-indigo-700' : 'text-zinc-500 hover:bg-zinc-100'}`}>Name</button>
                <button onClick={() => setSort(sort === 'price-asc' ? 'price-desc' : 'price-asc')} className={`px-1.5 py-0.5 text-[10px] rounded ${sort.startsWith('price') ? 'bg-indigo-100 text-indigo-700' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                  Price {sort === 'price-asc' ? '↑' : sort === 'price-desc' ? '↓' : ''}
                </button>
              </div>
              <div className="overflow-y-auto max-h-[250px]">
                {filteredModels.map((m, i) => {
                  if (m.id === '__divider__') return <div key={`div-${i}`} className="border-t border-zinc-200 my-0.5" />;
                  const isSelected = m.id === value;
                  const isStarred = starredModels.has(m.id);
                  const inPrice = parseFloat(m.pricing.prompt) * 1_000_000;
                  const outPrice = parseFloat(m.pricing.completion) * 1_000_000;
                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-50 ${isSelected ? 'bg-indigo-50' : ''}`}
                      onClick={() => { onChange(m.id); setIsOpen(false); }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleStar(m.id); }}
                        className={`shrink-0 ${isStarred ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400'}`}
                      >
                        <Star className="w-3 h-3" fill={isStarred ? 'currentColor' : 'none'} />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-zinc-800 truncate">{m.name}</div>
                        <div className="text-[9px] text-zinc-400">
                          ${inPrice < 0.01 ? inPrice.toFixed(4) : inPrice.toFixed(2)}/M in · ${outPrice < 0.01 ? outPrice.toFixed(4) : outPrice.toFixed(2)}/M out · {(m.context_length / 1000).toFixed(0)}k ctx
                        </div>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                    </div>
                  );
                })}
                {filteredModels.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-zinc-400">
                    {models.length === 0 ? 'Enter API key to load models' : 'No models match search'}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Component ============

const GroupReviewSettings = forwardRef<GroupReviewSettingsRef, {
  isOpen: boolean;
  onToggle: () => void;
  starredModels: Set<string>;
  onToggleStar: (modelId: string) => void;
  onSettingsChange?: (settings: GroupReviewSettingsData) => void;
  onHydratedChange?: (hydrated: boolean) => void;
  /** User-visible toast for Firestore sync failures (REFACTOR_PLAN P0.3 / P0.4) */
  addToast?: PersistToastFn;
}>(({ isOpen, onToggle, starredModels, onToggleStar, onSettingsChange, onHydratedChange, addToast }, ref) => {
  // Settings state
  const [settings, setSettings] = useState<GroupReviewSettingsData>(() => {
    // Hydrate from localStorage immediately (sync) so API key is available before Firestore loads
    try {
      const cached = localStorage.getItem(LS_SETTINGS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          apiKey: parsed.apiKey || '',
          selectedModel: parsed.selectedModel || DEFAULT_OPENROUTER_MODEL_ID,
          concurrency: parsed.concurrency ?? 5,
          temperature: parsed.temperature ?? 0.3,
          maxTokens: parsed.maxTokens ?? 0,
          systemPrompt: parsed.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          autoGroupPrompt: parsed.autoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT,
          reasoningEffort: parsed.reasoningEffort || 'none',
          keywordRatingModel: parsed.keywordRatingModel || '',
          keywordRatingTemperature: parsed.keywordRatingTemperature ?? 0.3,
          keywordRatingMaxTokens: parsed.keywordRatingMaxTokens ?? 0,
          keywordRatingConcurrency: parsed.keywordRatingConcurrency ?? 5,
          keywordRatingReasoningEffort: parsed.keywordRatingReasoningEffort || 'none',
          keywordRatingPrompt: parsed.keywordRatingPrompt || DEFAULT_KEYWORD_RATING_PROMPT,
          keywordCoreIntentSummary: parsed.keywordCoreIntentSummary || '',
          keywordCoreIntentSummaryUpdatedAt: parsed.keywordCoreIntentSummaryUpdatedAt || '',
          autoMergeModel: parsed.autoMergeModel || '',
          autoMergeTemperature: parsed.autoMergeTemperature ?? 0.2,
          autoMergeMaxTokens: parsed.autoMergeMaxTokens ?? 0,
          autoMergeConcurrency: parsed.autoMergeConcurrency ?? 5,
          autoMergeReasoningEffort: parsed.autoMergeReasoningEffort || 'none',
          autoMergePrompt: parsed.autoMergePrompt || DEFAULT_AUTO_MERGE_PROMPT,
          groupAutoMergeEmbeddingModel: parsed.groupAutoMergeEmbeddingModel || DEFAULT_EMBEDDING_MODEL,
          groupAutoMergeMinSimilarity: parsed.groupAutoMergeMinSimilarity ?? 0.88,
        };
      }
    } catch { /* ignore parse errors */ }
    return {
      apiKey: '',
      selectedModel: DEFAULT_OPENROUTER_MODEL_ID,
      concurrency: 5,
      temperature: 0.3,
      maxTokens: 0,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      autoGroupPrompt: DEFAULT_AUTO_GROUP_PROMPT,
      reasoningEffort: 'none' as const,
      keywordRatingModel: '',
      keywordRatingTemperature: 0.3,
      keywordRatingMaxTokens: 0,
      keywordRatingConcurrency: 5,
      keywordRatingReasoningEffort: 'none' as const,
      keywordRatingPrompt: DEFAULT_KEYWORD_RATING_PROMPT,
      keywordCoreIntentSummary: '',
      keywordCoreIntentSummaryUpdatedAt: '',
      autoMergeModel: '',
      autoMergeTemperature: 0.2,
      autoMergeMaxTokens: 0,
      autoMergeConcurrency: 5,
      autoMergeReasoningEffort: 'none' as const,
      autoMergePrompt: DEFAULT_AUTO_MERGE_PROMPT,
      groupAutoMergeEmbeddingModel: DEFAULT_EMBEDDING_MODEL,
      groupAutoMergeMinSimilarity: 0.88,
    };
  });

  // Models
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [hasHydratedSharedSettings, setHasHydratedSharedSettings] = useState(false);
  const embeddingModels = useMemo(() => models.filter(isEmbeddingModel), [models]);

  const lastSharedSavedRef = useRef(JSON.stringify(toSharedSettings(settings)));
  const suppressSnapshotRef = useRef(false);
  const lastWrittenAtRef = useRef('');
  const persistSharedSettings = useCallback(async () => {
    if (!hasHydratedSharedSettings) return;
    const shared = toSharedSettings(settings);
    const json = JSON.stringify(shared);
    if (json === lastSharedSavedRef.current) return;
    lastSharedSavedRef.current = json;
    const updatedAt = new Date().toISOString();
    lastWrittenAtRef.current = updatedAt;
    suppressSnapshotRef.current = true;
    await persistAppSettingsDoc({
      docId: FS_DOC,
      data: {
        ...shared,
        updatedAt,
      },
      addToast,
      localContext: 'group review settings',
      cloudContext: 'group review settings',
      localStorageKey: LS_SETTINGS_KEY,
      localStorageValue: json,
    }).then(() => {
      suppressSnapshotRef.current = false;
    }).catch((err) => {
      suppressSnapshotRef.current = false;
      reportPersistFailure(addToast, 'group review settings', err);
    });
  }, [addToast, hasHydratedSharedSettings, settings]);
  const { schedule: scheduleSharedSettingsPersist } = useLatestPersistQueue(persistSharedSettings);

  // Expose settings to parent via ref
  const selectedModelObj = useMemo(() => models.find(m => m.id === settings.selectedModel), [models, settings.selectedModel]);

  useImperativeHandle(ref, () => ({
    getSettings: () => settings,
    getSelectedModelObj: () => selectedModelObj,
    hasApiKey: () => settings.apiKey.trim().length > 10,
    updateSettings: (newSettings: GroupReviewSettingsData) => setSettings(newSettings),
  }), [settings, selectedModelObj]);

  useEffect(() => {
    onSettingsChange?.(settings);
  }, [onSettingsChange, settings]);

  useEffect(() => {
    onHydratedChange?.(hasHydratedSharedSettings);
  }, [hasHydratedSharedSettings, onHydratedChange]);

  // Persist shared settings to Firestore + localStorage
  useEffect(() => {
    scheduleSharedSettingsPersist();
  }, [settings, scheduleSharedSettingsPersist]);

  // Load shared settings from Firestore on mount
  useEffect(() => {
    let alive = true;
    const firestoreLoadedRef = { current: false };
    const applyCachedSettings = async () => {
      const cached = await loadCachedState<Partial<GroupReviewSettingsData>>({
        idbKey: appSettingsIdbKey(FS_DOC),
        localStorageKey: LS_SETTINGS_KEY,
      });
      if (!alive || firestoreLoadedRef.current || !cached) {
        setHasHydratedSharedSettings(true);
        return;
      }
      setSettings((prev) => {
        const merged = {
          ...prev,
          ...cached,
          selectedModel: cached.selectedModel?.trim() || prev.selectedModel || DEFAULT_OPENROUTER_MODEL_ID,
        };
        lastSharedSavedRef.current = JSON.stringify(toSharedSettings(merged));
        return merged;
      });
      setHasHydratedSharedSettings(true);
    };

    void applyCachedSettings();

    const unsub = subscribeAppSettingsDoc({
      docId: FS_DOC,
      channel: CLOUD_SYNC_CHANNELS.groupReviewSettings,
      onData: (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        firestoreLoadedRef.current = true;
        const remote = snap.exists() ? snap.data() : null;
        // Suppress own-write echoes to prevent overwriting concurrent remote changes
        const incomingUpdatedAt = typeof remote?.updatedAt === 'string' ? remote.updatedAt : '';
        if (suppressSnapshotRef.current && incomingUpdatedAt && lastWrittenAtRef.current && incomingUpdatedAt <= lastWrittenAtRef.current) {
          return;
        }
        suppressSnapshotRef.current = false;
        setSettings(() => {
          const merged: GroupReviewSettingsData = {
            apiKey: remote?.apiKey || '',
            selectedModel: remote?.selectedModel || DEFAULT_OPENROUTER_MODEL_ID,
            concurrency: remote?.concurrency ?? 5,
            temperature: remote?.temperature ?? 0.3,
            maxTokens: remote?.maxTokens ?? 0,
            systemPrompt: remote?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            autoGroupPrompt: remote?.autoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT,
            reasoningEffort: remote?.reasoningEffort || 'none',
            keywordRatingModel: remote?.keywordRatingModel || '',
            keywordRatingTemperature: remote?.keywordRatingTemperature ?? 0.3,
            keywordRatingMaxTokens: remote?.keywordRatingMaxTokens ?? 0,
            keywordRatingConcurrency: remote?.keywordRatingConcurrency ?? 5,
            keywordRatingReasoningEffort: remote?.keywordRatingReasoningEffort || 'none',
            keywordRatingPrompt: remote?.keywordRatingPrompt || DEFAULT_KEYWORD_RATING_PROMPT,
            keywordCoreIntentSummary: remote?.keywordCoreIntentSummary || '',
            keywordCoreIntentSummaryUpdatedAt: remote?.keywordCoreIntentSummaryUpdatedAt || '',
            autoMergeModel: remote?.autoMergeModel || '',
            autoMergeTemperature: remote?.autoMergeTemperature ?? 0.2,
            autoMergeMaxTokens: remote?.autoMergeMaxTokens ?? 0,
            autoMergeConcurrency: remote?.autoMergeConcurrency ?? 5,
            autoMergeReasoningEffort: remote?.autoMergeReasoningEffort || 'none',
            autoMergePrompt: remote?.autoMergePrompt || DEFAULT_AUTO_MERGE_PROMPT,
            groupAutoMergeEmbeddingModel: remote?.groupAutoMergeEmbeddingModel || DEFAULT_EMBEDDING_MODEL,
            groupAutoMergeMinSimilarity: remote?.groupAutoMergeMinSimilarity ?? 0.88,
          };
          const mergedShared = toSharedSettings(merged);
          const mergedSharedJson = JSON.stringify(mergedShared);
          lastSharedSavedRef.current = mergedSharedJson;
          cacheStateLocallyBestEffort({
            idbKey: appSettingsIdbKey(FS_DOC),
            value: mergedShared,
            localStorageKey: LS_SETTINGS_KEY,
            localStorageValue: mergedSharedJson,
          });
          return merged;
        });
        setHasHydratedSharedSettings(true);
      },
      onError: (err) => {
        reportPersistFailure(addToast, 'group review settings sync', err);
        firestoreLoadedRef.current = true;
        setHasHydratedSharedSettings(true);
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [addToast]);

  // Fetch models when API key changes
  const fetchModels = useCallback(async () => {
    if (!settings.apiKey.trim() || settings.apiKey.trim().length < 10) return;
    setIsFetchingModels(true);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${settings.apiKey}` },
      });
      if (!res.ok) { setIsFetchingModels(false); return; }
      const data = await res.json();
      const mapped: OpenRouterModel[] = (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        pricing: { prompt: m.pricing?.prompt || '0', completion: m.pricing?.completion || '0' },
        context_length: m.context_length || 0,
      }));
      mapped.sort((a, b) => a.name.localeCompare(b.name));
      setModels(mapped);
      const availableModelIds = mapped.map((model) => model.id);
      const availableEmbeddingModelIds = mapped.filter(isEmbeddingModel).map((model) => model.id);
      if (availableModelIds.length > 0) {
        setSettings((prev) => {
          const next = {
            ...prev,
            selectedModel: normalizePreferredOpenRouterModel(prev.selectedModel, availableModelIds),
            keywordRatingModel: normalizeOptionalOverrideModel(prev.keywordRatingModel, availableModelIds),
            autoMergeModel: normalizeOptionalOverrideModel(prev.autoMergeModel, availableModelIds),
            groupAutoMergeEmbeddingModel: availableEmbeddingModelIds.length > 0
              ? normalizePreferredOpenRouterModel(prev.groupAutoMergeEmbeddingModel || DEFAULT_EMBEDDING_MODEL, availableEmbeddingModelIds)
              : (prev.groupAutoMergeEmbeddingModel || DEFAULT_EMBEDDING_MODEL),
          };
          if (
            next.selectedModel === prev.selectedModel &&
            next.keywordRatingModel === prev.keywordRatingModel &&
            next.autoMergeModel === prev.autoMergeModel &&
            next.groupAutoMergeEmbeddingModel === prev.groupAutoMergeEmbeddingModel
          ) {
            return prev;
          }
          return next;
        });
      }
    } catch (e) {
      console.warn('Failed to fetch models:', e);
    }
    setIsFetchingModels(false);
  }, [settings.apiKey]);

  useEffect(() => {
    if (settings.apiKey.trim().length <= 10) return;
    const timer = setTimeout(() => {
      void fetchModels();
    }, 0);
    return () => clearTimeout(timer);
  }, [settings.apiKey, fetchModels]);

  if (!isOpen) return null;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-zinc-700">Group Review Settings</h4>
        <button onClick={onToggle} className="text-zinc-400 hover:text-zinc-600 text-xs">Close</button>
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-[11px] text-zinc-700">
        <span className="font-semibold text-zinc-800">Prompt usage in this workflow:</span>{' '}
        <span><span className="font-medium">Auto-Group Prompt</span> is used first when you click <span className="font-medium">Auto Group</span> in Pages/Ungrouped. <span className="font-medium">Review Prompt</span> is used later for QA/review of groups that already exist.</span>
      </div>

      {/* Row 1: API Key + Model + Concurrency */}
      <div className="grid grid-cols-3 gap-3">
        {/* API Key */}
        <div>
          <HelpLabel
            label="API Key"
            help="Shared OpenRouter API key used for Auto Group, Review, QA, group auto-merge embeddings, Cosine summaries, and other AI actions in this project."
          />
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey}
              onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="sk-or-..."
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 pr-8"
            />
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <ModelPicker
          label="Model"
          help="The AI model used for this project's grouping and review calls. Faster models reduce latency; stronger models usually improve grouping accuracy."
          value={settings.selectedModel}
          onChange={(modelId) => setSettings(prev => ({ ...prev, selectedModel: modelId }))}
          models={models}
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          loading={isFetchingModels}
        />

        {/* Concurrency */}
        <div>
          <HelpLabel
            label={`Concurrency (${settings.concurrency})`}
            help="How many supported AI jobs can run in parallel. This mainly affects review/QA and summary queues. It does not speed up strictly sequential workflows."
          />
          <input
            type="range"
            min={1}
            max={500}
            value={settings.concurrency}
            onChange={(e) => setSettings(prev => ({ ...prev, concurrency: parseInt(e.target.value) }))}
            className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
      </div>

      {/* Row 2: Temperature + Max Tokens + Reasoning */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <HelpLabel
            label={`Temperature (${settings.temperature})`}
            help="Controls output variation. Lower values are more deterministic and usually better for strict grouping and JSON output."
          />
          <input
            type="range"
            min={0}
            max={200}
            value={Math.round(settings.temperature * 100)}
            onChange={(e) => setSettings(prev => ({ ...prev, temperature: parseInt(e.target.value) / 100 }))}
            className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
        <div>
          <HelpLabel
            label="Max Tokens (0 = auto)"
            help="Maximum completion length for the model response. Leave at 0 to let the provider choose automatically."
          />
          <input
            type="number"
            value={settings.maxTokens}
            onChange={(e) => setSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 0 }))}
            className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <HelpLabel
            label={`Reasoning (${settings.reasoningEffort})`}
            help="Extra reasoning effort for models that support it. Higher values can improve quality but usually make runs slower and more expensive."
          />
          <select
            value={settings.reasoningEffort}
            onChange={(e) => setSettings(prev => ({ ...prev, reasoningEffort: e.target.value as GroupReviewSettingsData['reasoningEffort'] }))}
            className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          >
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      {/* Row 3: System Prompt */}
      <div>
        <HelpLabel
          label="Review Prompt"
          help="Used for QA and review after groups already exist. It decides whether pages inside a group still belong there or should be marked mismatches."
        />
        <textarea
          value={settings.systemPrompt}
          onChange={(e) => setSettings(prev => ({ ...prev, systemPrompt: e.target.value }))}
          rows={4}
          className="w-full px-2.5 py-2 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y leading-relaxed"
          placeholder="System prompt for reviewing group semantic consistency..."
        />
        {settings.systemPrompt !== DEFAULT_SYSTEM_PROMPT && (
          <button
            onClick={() => setSettings(prev => ({ ...prev, systemPrompt: DEFAULT_SYSTEM_PROMPT }))}
            className="mt-1 text-[10px] text-indigo-600 hover:text-indigo-700"
          >
            Reset to default prompt
          </button>
        )}
      </div>

      {/* Row 4: Auto-Group Prompt */}
      <div>
        <HelpLabel
          label="Auto-Group Prompt"
          help="Used when you click Auto Group from Pages/Ungrouped. It tells the model how to partition the current filtered pages into one or more semantic groups."
        />
        <textarea
          value={settings.autoGroupPrompt}
          onChange={(e) => setSettings(prev => ({ ...prev, autoGroupPrompt: e.target.value }))}
          rows={4}
          className="w-full px-2.5 py-2 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y leading-relaxed"
          placeholder="System prompt for auto-grouping pages by semantic similarity..."
        />
        {settings.autoGroupPrompt !== DEFAULT_AUTO_GROUP_PROMPT && (
          <button
            onClick={() => setSettings(prev => ({ ...prev, autoGroupPrompt: DEFAULT_AUTO_GROUP_PROMPT }))}
            className="mt-1 text-[10px] text-indigo-600 hover:text-indigo-700"
          >
            Reset to default prompt
          </button>
        )}
      </div>

      {/* Keyword relevance rating — same API key, separate model/params */}
      <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 space-y-2">
        <h4 className="text-xs font-semibold text-zinc-700">Keyword relevance rating</h4>
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Used by <span className="font-medium">Rate KWs</span> on the All Keywords tab. Phase 1 generates a core-intent summary of all keywords; phase 2 scores each keyword 1–3. Same OpenRouter key as above; pick a dedicated model if you want.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModelPicker
            label="Keyword rating model"
            help="If empty, the main Model above is used. Otherwise this model runs summary + per-keyword JSON ratings."
            value={settings.keywordRatingModel}
            onChange={(modelId) => setSettings(prev => ({ ...prev, keywordRatingModel: modelId }))}
            models={models}
            starredModels={starredModels}
            onToggleStar={onToggleStar}
          />
          <div>
            <HelpLabel
              label={`KW rating concurrency (${settings.keywordRatingConcurrency})`}
              help="Parallel OpenRouter requests during phase 2 (per-keyword ratings). Lower if you hit rate limits."
            />
            <input
              type="range"
              min={1}
              max={500}
              value={settings.keywordRatingConcurrency}
              onChange={(e) => setSettings(prev => ({ ...prev, keywordRatingConcurrency: parseInt(e.target.value, 10) }))}
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <HelpLabel
              label={`KW rating temperature (${settings.keywordRatingTemperature})`}
              help="Temperature for summary + rating calls. Lower is usually better for stable JSON."
            />
            <input
              type="range"
              min={0}
              max={200}
              value={Math.round(settings.keywordRatingTemperature * 100)}
              onChange={(e) => setSettings(prev => ({ ...prev, keywordRatingTemperature: parseInt(e.target.value, 10) / 100 }))}
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
            />
          </div>
          <div>
            <HelpLabel label="KW max tokens (0 = auto)" help="Max completion tokens for keyword rating calls." />
            <input
              type="number"
              value={settings.keywordRatingMaxTokens}
              onChange={(e) => setSettings(prev => ({ ...prev, keywordRatingMaxTokens: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <HelpLabel label="KW reasoning" help="Reasoning effort for models that support it (keyword rating only)." />
            <select
              value={settings.keywordRatingReasoningEffort}
              onChange={(e) => setSettings(prev => ({ ...prev, keywordRatingReasoningEffort: e.target.value as GroupReviewSettingsData['keywordRatingReasoningEffort'] }))}
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div>
          <HelpLabel
            label="Rating prompt"
            help="Explains the 1–3 scale to the model. The final user message also includes the stored core-intent summary and the keyword being rated."
          />
          <textarea
            value={settings.keywordRatingPrompt}
            onChange={(e) => setSettings(prev => ({ ...prev, keywordRatingPrompt: e.target.value }))}
            rows={5}
            className="w-full px-2.5 py-2 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y leading-relaxed"
            placeholder="Rules for 1 = relevant, 2 = unsure, 3 = not relevant..."
          />
          {settings.keywordRatingPrompt !== DEFAULT_KEYWORD_RATING_PROMPT && (
            <button
              type="button"
              onClick={() => setSettings(prev => ({ ...prev, keywordRatingPrompt: DEFAULT_KEYWORD_RATING_PROMPT }))}
              className="mt-1 text-[10px] text-emerald-700 hover:text-emerald-800"
            >
              Reset to default rating prompt
            </button>
          )}
        </div>
        <div>
          <HelpLabel
            label="Core intent summary (from last Rate KWs run)"
            help="Generated before per-keyword ratings. Stored here so you can inspect or reuse it."
          />
          <textarea
            value={settings.keywordCoreIntentSummary}
            readOnly
            rows={4}
            className="w-full px-2.5 py-2 text-xs border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-700 resize-y leading-relaxed"
            placeholder="Run Rate KWs on the All Keywords tab to populate..."
          />
          {settings.keywordCoreIntentSummaryUpdatedAt ? (
            <p className="mt-0.5 text-[10px] text-zinc-400">
              Updated {new Date(settings.keywordCoreIntentSummaryUpdatedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 space-y-2">
        <h4 className="text-xs font-semibold text-zinc-700">Auto Merge KWs</h4>
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Used by <span className="font-medium">Auto Merge KWs</span> in token management. The model receives one source token and all non-blocked tokens, then returns only exact lexical/semantic equivalents.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModelPicker
            label="Auto merge model"
            help="If empty, the main Model above is used. Otherwise this dedicated model runs Auto Merge."
            value={settings.autoMergeModel}
            onChange={(modelId) => setSettings(prev => ({ ...prev, autoMergeModel: modelId }))}
            models={models}
            starredModels={starredModels}
            onToggleStar={onToggleStar}
          />
          <div>
            <HelpLabel
              label={`Auto merge concurrency (${settings.autoMergeConcurrency})`}
              help="Parallel token comparisons for Auto Merge. Lower this if you hit rate limits."
            />
            <input
              type="range"
              min={1}
              max={500}
              value={settings.autoMergeConcurrency}
              onChange={(e) => setSettings(prev => ({ ...prev, autoMergeConcurrency: parseInt(e.target.value, 10) }))}
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <HelpLabel
              label={`Auto merge temperature (${settings.autoMergeTemperature})`}
              help="Lower values are recommended for strict exact-match JSON output."
            />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.autoMergeTemperature * 100)}
              onChange={(e) => setSettings(prev => ({ ...prev, autoMergeTemperature: parseInt(e.target.value, 10) / 100 }))}
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
          </div>
          <div>
            <HelpLabel label="Auto merge max tokens (0 = auto)" help="Max completion tokens for Auto Merge calls." />
            <input
              type="number"
              value={settings.autoMergeMaxTokens}
              onChange={(e) => setSettings(prev => ({ ...prev, autoMergeMaxTokens: parseInt(e.target.value, 10) || 0 }))}
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <HelpLabel label="Auto merge reasoning" help="Reasoning effort for models that support it (Auto Merge only)." />
            <select
              value={settings.autoMergeReasoningEffort}
              onChange={(e) => setSettings(prev => ({ ...prev, autoMergeReasoningEffort: e.target.value as GroupReviewSettingsData['autoMergeReasoningEffort'] }))}
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div>
          <HelpLabel
            label="Auto Merge Prompt"
            help="Strict prompt requiring exact identity (not broad similarity). The run compares each token against all other non-blocked tokens."
          />
          <textarea
            value={settings.autoMergePrompt}
            onChange={(e) => setSettings(prev => ({ ...prev, autoMergePrompt: e.target.value }))}
            rows={6}
            className="w-full px-2.5 py-2 text-xs font-mono border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y leading-relaxed"
          />
          {settings.autoMergePrompt !== DEFAULT_AUTO_MERGE_PROMPT && (
            <button
              type="button"
              onClick={() => setSettings(prev => ({ ...prev, autoMergePrompt: DEFAULT_AUTO_MERGE_PROMPT }))}
              className="mt-1 text-[10px] text-indigo-700 hover:text-indigo-800"
            >
              Reset to default auto merge prompt
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-sky-100 bg-sky-50/50 px-3 py-2 space-y-2">
        <h4 className="text-xs font-semibold text-zinc-700">Group Auto Merge</h4>
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Used by the <span className="font-medium">Auto Merge</span> tab in keyword management. The app embeds current grouped group names plus top page names, compares every group pair locally, and recommends likely semantic duplicates for manual merge review.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModelPicker
            label="Embedding model"
            help="Embedding model used to vectorize grouped group names plus page context before all-pairs similarity comparison."
            value={settings.groupAutoMergeEmbeddingModel}
            onChange={(modelId) => setSettings(prev => ({ ...prev, groupAutoMergeEmbeddingModel: modelId }))}
            models={embeddingModels}
            starredModels={starredModels}
            onToggleStar={onToggleStar}
          />
          <div>
            <HelpLabel
              label={`Min similarity (${Math.round(settings.groupAutoMergeMinSimilarity * 100)}%)`}
              help="Only keep recommendation pairs at or above this cosine similarity score after location guardrails. Higher values improve precision and reduce noise."
            />
            <input
              type="range"
              min={70}
              max={99}
              value={Math.round(settings.groupAutoMergeMinSimilarity * 100)}
              onChange={(e) => setSettings(prev => ({ ...prev, groupAutoMergeMinSimilarity: parseInt(e.target.value, 10) / 100 }))}
              className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-sky-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
});

GroupReviewSettings.displayName = 'GroupReviewSettings';

export default GroupReviewSettings;
