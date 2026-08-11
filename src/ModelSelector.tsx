import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronDown, Search, Loader2, Star, Check } from 'lucide-react';

export interface ModelInfo {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length?: number;
}

interface ModelSelectorProps {
  apiKey: string;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  starredModels?: Set<string>;
  onToggleStar?: (modelId: string) => void;
  label?: string;
  compact?: boolean;
  modelFilter?: 'all' | 'embedding' | 'chat';
}

const formatCost = (perToken: string): string => {
  const price = parseFloat(perToken);
  if (isNaN(price) || price === 0) return 'Free';
  return `$${(price * 1_000_000).toFixed(2)}/M`;
};

const ModelSelector: React.FC<ModelSelectorProps> = React.memo(({
  apiKey,
  selectedModel,
  onSelectModel,
  starredModels = new Set(),
  onToggleStar,
  label = 'Model',
  compact = false,
  modelFilter = 'all',
}) => {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Fetch models when API key changes
  useEffect(() => {
    if (!apiKey || apiKey.length < 10) { setModels([]); return; }

    let cancelled = false;
    setLoading(true);
    setError('');
    fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    }).then(r => {
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.json();
    }).then(data => {
      if (cancelled) return;
      const allModels: ModelInfo[] = (data.data || [])
        .filter((m: any) => m.pricing)
        .map((m: any) => ({ id: m.id, name: m.name || m.id, pricing: m.pricing, context_length: m.context_length }))
        .sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name));
      // Filter by model type
      const parsed = modelFilter === 'embedding'
        ? allModels.filter(m => m.id.includes('embed') || m.id.includes('e5-') || m.id.includes('bge-') || m.id.includes('gte-') || m.id.includes('nomic') || m.name.toLowerCase().includes('embed'))
        : modelFilter === 'chat'
        ? allModels.filter(m => !m.id.includes('embed') && !m.name.toLowerCase().includes('embed'))
        : allModels;
      setModels(parsed);
    }).catch(e => {
      if (!cancelled) setError(e.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiKey, modelFilter]);

  // Selected model object
  const selectedObj = useMemo(() => models.find(m => m.id === selectedModel), [models, selectedModel]);

  // Filtered + sorted + starred-first
  const filteredModels = useMemo(() => {
    let filtered = models;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }

    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'price-asc') sorted.sort((a, b) => parseFloat(a.pricing.prompt) - parseFloat(b.pricing.prompt));
    else if (sort === 'price-desc') sorted.sort((a, b) => parseFloat(b.pricing.prompt) - parseFloat(a.pricing.prompt));

    // Starred first
    if (starredModels.size > 0) {
      const starred = sorted.filter(m => starredModels.has(m.id));
      const unstarred = sorted.filter(m => !starredModels.has(m.id));
      return [...starred, ...unstarred];
    }
    return sorted;
  }, [models, search, sort, starredModels]);

  const handleSelect = useCallback((modelId: string) => {
    onSelectModel(modelId);
    setIsOpen(false);
    setSearch('');
  }, [onSelectModel]);

  return (
    <div ref={dropdownRef} className="relative">
      {!compact && (
        <label className="block text-[10px] font-medium text-zinc-500 mb-1">
          {label}
          {loading && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
        </label>
      )}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg text-left flex items-center justify-between hover:bg-zinc-50 transition-colors bg-white"
      >
        <span className="truncate">
          {selectedObj ? selectedObj.name : (selectedModel || 'Select model...')}
        </span>
        <ChevronDown className="w-3 h-3 shrink-0 text-zinc-400" />
      </button>
      {error && <p className="text-[10px] text-red-500 mt-0.5">{error}</p>}
      {!compact && selectedObj && (
        <p className="text-[10px] text-zinc-400 mt-0.5">
          In: {formatCost(selectedObj.pricing.prompt)} · Out: {formatCost(selectedObj.pricing.completion)}{selectedObj.context_length ? ` · ${(selectedObj.context_length / 1000).toFixed(0)}K ctx` : ''}
        </p>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-[300px] overflow-hidden flex flex-col">
          <div className="p-2 border-b border-zinc-100 space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-6 pr-2 py-1 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                autoFocus
              />
            </div>
            {/* Sort buttons */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-400 mr-0.5">Sort:</span>
              {(['name', 'price-asc', 'price-desc'] as const).map(s => (
                <button
                  key={s}
                  onClick={(e) => { e.stopPropagation(); setSort(s); }}
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${sort === s ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                >
                  {s === 'name' ? 'Name' : s === 'price-asc' ? 'Price ↑' : 'Price ↓'}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-zinc-400">
                {models.length === 0 ? 'Enter API key to load models' : 'No models match search'}
              </div>
            ) : filteredModels.map((m, mIdx) => (
              <React.Fragment key={m.id}>
                {/* Divider between starred and unstarred */}
                {starredModels.size > 0 && mIdx > 0 && starredModels.has(filteredModels[mIdx - 1].id) && !starredModels.has(m.id) && (
                  <div className="border-t border-zinc-200 my-0.5" />
                )}
                <div className={`w-full px-3 py-1.5 text-left text-xs hover:bg-indigo-50 transition-colors flex items-center ${m.id === selectedModel ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-700'}`}>
                  {/* Star toggle */}
                  {onToggleStar && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleStar(m.id); }}
                      className="p-0.5 mr-1.5 shrink-0 transition-colors"
                      title={starredModels.has(m.id) ? 'Unstar model' : 'Star model'}
                    >
                      <Star className={`w-3 h-3 ${starredModels.has(m.id) ? 'fill-amber-400 text-amber-400' : 'text-zinc-300 hover:text-amber-400'}`} />
                    </button>
                  )}
                  {/* Model name — click to select */}
                  <button
                    onClick={() => handleSelect(m.id)}
                    className="truncate flex-1 text-left"
                  >
                    {m.name}
                  </button>
                  <span className="text-[10px] text-zinc-400 ml-2 shrink-0">
                    {formatCost(m.pricing.prompt)}
                  </span>
                  {m.id === selectedModel && <Check className="w-3 h-3 ml-1 text-indigo-600 shrink-0" />}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

ModelSelector.displayName = 'ModelSelector';
export default ModelSelector;
export { formatCost };
