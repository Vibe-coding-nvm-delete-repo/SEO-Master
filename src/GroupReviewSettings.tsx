// GroupReviewSettings.tsx — Settings panel for AI group review
// Separate settings from Generate tab. Persists to localStorage + Firestore.

import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Settings, Star, Check, ChevronDown, Search, Eye, EyeOff, Loader2 } from 'lucide-react';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { DEFAULT_SYSTEM_PROMPT } from './GroupReviewEngine';
import { DEFAULT_AUTO_GROUP_PROMPT } from './AutoGroupEngine';

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
const LS_KEY = 'kwg_group_review_settings';
const FS_DOC = 'group_review_settings';
const STARRED_LS_KEY = 'kwg_starred_models'; // shared with Generate tab

// ============ Component ============

const GroupReviewSettings = forwardRef<GroupReviewSettingsRef, {
  isOpen: boolean;
  onToggle: () => void;
  starredModels: Set<string>;
  onToggleStar: (modelId: string) => void;
}>(({ isOpen, onToggle, starredModels, onToggleStar }, ref) => {
  // Settings state
  const [settings, setSettings] = useState<GroupReviewSettingsData>(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      apiKey: '',
      selectedModel: '',
      concurrency: 5,
      temperature: 0.3,
      maxTokens: 0,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      autoGroupPrompt: DEFAULT_AUTO_GROUP_PROMPT,
      reasoningEffort: 'none' as const,
    };
  });

  // Models
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSort, setModelSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  // Save debounce
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(JSON.stringify(settings));

  // Expose settings to parent via ref
  const selectedModelObj = useMemo(() => models.find(m => m.id === settings.selectedModel), [models, settings.selectedModel]);

  useImperativeHandle(ref, () => ({
    getSettings: () => settings,
    getSelectedModelObj: () => selectedModelObj,
    hasApiKey: () => settings.apiKey.trim().length > 10,
    updateSettings: (newSettings: GroupReviewSettingsData) => setSettings(newSettings),
  }), [settings, selectedModelObj]);

  // Persist settings — localStorage immediate + Firestore debounced
  useEffect(() => {
    const json = JSON.stringify(settings);
    if (json === lastSavedRef.current) return;
    lastSavedRef.current = json;

    // localStorage immediate
    try { localStorage.setItem(LS_KEY, json); } catch {}

    // Firestore debounced
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setDoc(doc(db, 'app_settings', FS_DOC), {
        ...settings,
        updatedAt: new Date().toISOString(),
      }).catch(e => console.warn('Firestore group review settings save error:', e));
    }, 1000);
  }, [settings]);

  // Load from Firestore on mount (override localStorage if Firestore has data)
  useEffect(() => {
    getDoc(doc(db, 'app_settings', FS_DOC)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        const fsSettings: GroupReviewSettingsData = {
          apiKey: data.apiKey || '',
          selectedModel: data.selectedModel || '',
          concurrency: data.concurrency || 5,
          temperature: data.temperature ?? 0.3,
          maxTokens: data.maxTokens || 0,
          systemPrompt: data.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          autoGroupPrompt: data.autoGroupPrompt || DEFAULT_AUTO_GROUP_PROMPT,
          reasoningEffort: data.reasoningEffort || 'none',
        };
        lastSavedRef.current = JSON.stringify(fsSettings);
        setSettings(fsSettings);
        try { localStorage.setItem(LS_KEY, JSON.stringify(fsSettings)); } catch {}
      }
    }).catch(() => {});
  }, []);

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
    if (settings.apiKey.trim().length > 10) fetchModels();
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

      {/* Row 1: API Key + Model + Concurrency */}
      <div className="grid grid-cols-3 gap-3">
        {/* API Key */}
        <div>
          <label className="block text-[10px] font-medium text-zinc-500 mb-1">API Key</label>
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
          <label className="block text-[10px] font-medium text-zinc-500 mb-1">Model {isFetchingModels && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}</label>
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
          <label className="block text-[10px] font-medium text-zinc-500 mb-1">Concurrency ({settings.concurrency})</label>
          <input
            type="range"
            min={1}
            max={100}
            value={settings.concurrency}
            onChange={(e) => setSettings(prev => ({ ...prev, concurrency: parseInt(e.target.value) }))}
            className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
      </div>

      {/* Row 2: Temperature + Max Tokens + Reasoning */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-medium text-zinc-500 mb-1">Temperature ({settings.temperature})</label>
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
          <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Tokens (0 = auto)</label>
          <input
            type="number"
            value={settings.maxTokens}
            onChange={(e) => setSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 0 }))}
            className="w-full px-2 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-zinc-500 mb-1">Reasoning ({settings.reasoningEffort})</label>
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
        <label className="block text-[10px] font-medium text-zinc-500 mb-1">Review Prompt</label>
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
        <label className="block text-[10px] font-medium text-zinc-500 mb-1">Auto-Group Prompt</label>
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
    </div>
  );
});

GroupReviewSettings.displayName = 'GroupReviewSettings';

export default GroupReviewSettings;
