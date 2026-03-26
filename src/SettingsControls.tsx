import React from 'react';

export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high';

interface SettingsControlsProps {
  temperature: number;
  onTemperatureChange: (val: number) => void;
  concurrency: number;
  onConcurrencyChange: (val: number) => void;
  maxConcurrency?: number;
  reasoning?: boolean | ReasoningLevel;
  onReasoningChange?: (val: boolean | ReasoningLevel) => void;
  maxTokens?: number;
  onMaxTokensChange?: (val: number) => void;
  showMaxTokens?: boolean;
}

const SettingsControls: React.FC<SettingsControlsProps> = React.memo(({
  temperature,
  onTemperatureChange,
  concurrency,
  onConcurrencyChange,
  maxConcurrency = 250,
  reasoning,
  onReasoningChange,
  maxTokens,
  onMaxTokensChange,
  showMaxTokens = false,
}) => {
  // Normalize reasoning to a level string for the dropdown
  const reasoningLevel: ReasoningLevel = reasoning === true ? 'medium' : reasoning === false ? 'off' : (reasoning || 'off');

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="flex-1 min-w-[120px]">
        <label className="block text-[10px] font-medium text-zinc-500 mb-0.5">Temperature ({temperature})</label>
        <input
          type="range"
          min="0" max="2" step="0.1"
          value={temperature}
          onChange={e => onTemperatureChange(parseFloat(e.target.value))}
          className="w-full h-1.5 accent-indigo-500"
        />
      </div>
      <div className="flex-1 min-w-[120px]">
        <label className="block text-[10px] font-medium text-zinc-500 mb-0.5">Concurrency ({concurrency})</label>
        <input
          type="range"
          min="1" max={maxConcurrency} step="1"
          value={concurrency}
          onChange={e => onConcurrencyChange(parseInt(e.target.value))}
          className="w-full h-1.5 accent-indigo-500"
        />
      </div>
      {showMaxTokens && onMaxTokensChange && (
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] font-medium text-zinc-500 mb-0.5">Max Tokens ({maxTokens || 'auto'})</label>
          <input
            type="range"
            min="0" max="16000" step="256"
            value={maxTokens || 0}
            onChange={e => onMaxTokensChange(parseInt(e.target.value))}
            className="w-full h-1.5 accent-indigo-500"
          />
        </div>
      )}
      {onReasoningChange !== undefined && (
        <div className="min-w-[100px]">
          <label className="block text-[10px] font-medium text-zinc-500 mb-0.5">Reasoning</label>
          <select
            value={reasoningLevel}
            onChange={e => {
              const val = e.target.value as ReasoningLevel;
              onReasoningChange(val === 'off' ? false : val);
            }}
            className="w-full px-2 py-1 text-xs border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      )}
    </div>
  );
});

SettingsControls.displayName = 'SettingsControls';
export default SettingsControls;
