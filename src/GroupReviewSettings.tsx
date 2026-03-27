// GroupReviewSettings.tsx — Settings panel for AI group review
// Shared settings live in Firestore.

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Star, Check, ChevronDown, Search, Eye, EyeOff, Loader2 } from 'lucide-react';
import { db } from './firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { DEFAULT_SYSTEM_PROMPT } from './GroupReviewEngine';
import { DEFAULT_AUTO_GROUP_PROMPT } from './AutoGroupEngine';
import { DEFAULT_KEYWORD_RATING_PROMPT } from './KeywordRatingEngine';
import { DEFAULT_AUTO_MERGE_PROMPT } from './AutoMergeEngine';
import type { PersistToastFn } from './persistenceErrors';
import { reportPersistFailure } from './persistenceErrors';
import { clearListenerError, markListenerError, markListenerSnapshot } from './cloudSyncStatus';
import InlineHelpHint from './InlineHelpHint';

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
  autoMergePrompt: string;
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
  autoMergePrompt: settings.autoMergePrompt,
});

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
          selectedModel: parsed.selectedModel || '',
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
          autoMergePrompt: parsed.autoMergePrompt || DEFAULT_AUTO_MERGE_PROMPT,
        };
      }
    } catch { /* ignore parse errors */ }
    return {
      apiKey: '',
      selectedModel: '',
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
      autoMergePrompt: DEFAULT_AUTO_MERGE_PROMPT,
    };
  });

  // Models
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSort, setModelSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [hasHydratedSharedSettings, setHasHydratedSharedSettings] = useState(false);

  const lastSharedSavedRef = useRef(JSON.stringify(toSharedSettings(settings)));

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
    const shared = toSharedSettings(settings);
    const json = JSON.stringify(shared);
    if (json === lastSharedSavedRef.current) return;
    lastSharedSavedRef.current = json;
    // Always save to localStorage (sync, reliable, offline-capable)
    try { localStorage.setItem(LS_SETTINGS_KEY, json); } catch { /* quota */ }
    // Also persist to Firestore (cloud sync)
    setDoc(doc(db, 'app_settings', FS_DOC), {
      ...shared,
      updatedAt: new Date().toISOString(),
    }).catch((e) => reportPersistFailure(addToast, 'group review settings', e));
  }, [settings, addToast]);

  // Load shared settings from Firestore on mount
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', FS_DOC), (snap) => {
      markListenerSnapshot('group_review_settings', snap);
      const remote = snap.exists() ? snap.data() : null;
      setSettings(() => {
        const merged: GroupReviewSettingsData = {
          apiKey: remote?.apiKey || '',
          selectedModel: remote?.selectedModel || '',
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
          autoMergePrompt: remote?.autoMergePrompt || DEFAULT_AUTO_MERGE_PROMPT,
        };

        const mergedSharedJson = JSON.stringify(toSharedSettings(merged));
        lastSharedSavedRef.current = mergedSharedJson;

        const remoteSharedJson = JSON.stringify(toSharedSettings({
          apiKey: remote?.apiKey || '',
          selectedModel: remote?.selectedModel || '',
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
          autoMergePrompt: remote?.autoMergePrompt || DEFAULT_AUTO_MERGE_PROMPT,
        }));

        if (mergedSharedJson !== remoteSharedJson) {
          setDoc(doc(db, 'app_settings', FS_DOC), {
            ...toSharedSettings(merged),
            updatedAt: new Date().toISOString(),
          }).catch((e) => reportPersistFailure(addToast, 'group review settings backfill', e));
        }

        return merged;
      });
      // Cache remote settings to localStorage so next load is instant
      if (remote) {
        try {
          localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(toSharedSettings({
            apiKey: remote.apiKey || '',
            selectedModel: remote.selectedModel || '',
            concurrency: remote.concurrency ?? 5,
            temperature: remote.temperature ?? 0.3,
            maxTokens: remote.maxTokens ?? 0,
            systemPrompt: remote.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            autoGroupPrompt: remote.autoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT,
            reasoningEffort: remote.reasoningEffort || 'none',
            keywordRatingModel: remote.keywordRatingModel || '',
            keywordRatingTemperature: remote.keywordRatingTemperature ?? 0.3,
            keywordRatingMaxTokens: remote.keywordRatingMaxTokens ?? 0,
            keywordRatingConcurrency: remote.keywordRatingConcurrency ?? 5,
            keywordRatingReasoningEffort: remote.keywordRatingReasoningEffort || 'none',
            keywordRatingPrompt: remote.keywordRatingPrompt || DEFAULT_KEYWORD_RATING_PROMPT,
            keywordCoreIntentSummary: remote.keywordCoreIntentSummary || '',
            keywordCoreIntentSummaryUpdatedAt: remote.keywordCoreIntentSummaryUpdatedAt || '',
            autoMergePrompt: remote.autoMergePrompt || DEFAULT_AUTO_MERGE_PROMPT,
          })));
        } catch { /* quota */ }
      }
      setHasHydratedSharedSettings(true);
    }, (err) => {
      markListenerError('group_review_settings');
      reportPersistFailure(addToast, 'group review settings sync', err);
      setHasHydratedSharedSettings(true);
    });
    return () => {
      clearListenerError('group_review_settings');
      if (typeof unsub === 'function') unsub();
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

  // Filtered + sorted models
  const filteredModels = useMemo(() => {
    let list = models;
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    if (modelSort === 'price-asc') {
      list = [...list].sort((a, b) => parseFloat(a.pricing.prompt) - parseFloat(b.pricing.prompt));
    } else if (modelSort === 'price-desc') {
      list = [...list].sort((a, b) => parseFloat(b.pricing.prompt) - parseFloat(a.pricing.prompt));
    }
    // Pin starred models to top
    const starred = list.filter(m => starredModels.has(m.id));
    const unstarred = list.filter(m => !starredModels.has(m.id));
    return starred.length > 0 ? [...starred, { id: '__divider__', name: '', pricing: { prompt: '0', completion: '0' }, context_length: 0 } as OpenRouterModel, ...unstarred] : unstarred;
  }, [models, modelSearch, modelSort, starredModels]);

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
            help="Shared OpenRouter API key used for Auto Group, Review, QA, Cosine summaries, and other AI actions in this project."
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

        {/* Model Dropdown */}
        <div>
          <HelpLabel
            label="Model"
            help="The AI model used for this project's grouping and review calls. Faster models reduce latency; stronger models usually improve grouping accuracy."
            trailing={isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin text-zinc-400" /> : null}
          />
          <div className="relative">
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg text-left flex items-center justify-between hover:border-zinc-400 transition-colors bg-white"
            >
              <span className="truncate text-zinc-700">{selectedModelObj?.name || settings.selectedModel || 'Select model...'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            </button>
            {isModelDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsModelDropdownOpen(false)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-[300px] overflow-hidden flex flex-col">
                  {/* Search + Sort */}
                  <div className="p-2 border-b border-zinc-100 flex gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models..."
                        className="w-full pl-7 pr-2 py-1 text-[11px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        autoFocus
                      />
                    </div>
                    <button onClick={() => setModelSort('name')} className={`px-1.5 py-0.5 text-[10px] rounded ${modelSort === 'name' ? 'bg-indigo-100 text-indigo-700' : 'text-zinc-500 hover:bg-zinc-100'}`}>Name</button>
                    <button onClick={() => setModelSort(modelSort === 'price-asc' ? 'price-desc' : 'price-asc')} className={`px-1.5 py-0.5 text-[10px] rounded ${modelSort.startsWith('price') ? 'bg-indigo-100 text-indigo-700' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                      Price {modelSort === 'price-asc' ? '↑' : modelSort === 'price-desc' ? '↓' : ''}
                    </button>
                  </div>
                  {/* Model list */}
                  <div className="overflow-y-auto max-h-[250px]">
                    {filteredModels.map((m, i) => {
                      if (m.id === '__divider__') return <div key={`div-${i}`} className="border-t border-zinc-200 my-0.5" />;
                      const isSelected = m.id === settings.selectedModel;
                      const isStarred = starredModels.has(m.id);
                      const inPrice = parseFloat(m.pricing.prompt) * 1_000_000;
                      const outPrice = parseFloat(m.pricing.completion) * 1_000_000;
                      return (
                        <div
                          key={m.id}
                          className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-zinc-50 ${isSelected ? 'bg-indigo-50' : ''}`}
                          onClick={() => { setSettings(prev => ({ ...prev, selectedModel: m.id })); setIsModelDropdownOpen(false); }}
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

        {/* Concurrency */}
        <div>
          <HelpLabel
            label={`Concurrency (${settings.concurrency})`}
            help="How many supported AI jobs can run in parallel. This mainly affects review/QA and summary queues. It does not speed up strictly sequential workflows."
          />
          <input
            type="range"
            min={1}
            max={250}
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
          <div>
            <HelpLabel
              label="Keyword rating model"
              help="If empty, the main Model above is used. Otherwise this model runs summary + per-keyword JSON ratings."
            />
            <select
              value={settings.keywordRatingModel}
              onChange={(e) => setSettings(prev => ({ ...prev, keywordRatingModel: e.target.value }))}
              className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
            >
              <option value="">Same as main model</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <HelpLabel
              label={`KW rating concurrency (${settings.keywordRatingConcurrency})`}
              help="Parallel OpenRouter requests during phase 2 (per-keyword ratings). Lower if you hit rate limits."
            />
            <input
              type="range"
              min={1}
              max={50}
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
    </div>
  );
});

GroupReviewSettings.displayName = 'GroupReviewSettings';

export default GroupReviewSettings;
