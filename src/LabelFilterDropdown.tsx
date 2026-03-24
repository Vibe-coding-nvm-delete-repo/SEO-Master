import React from 'react';
import { Filter } from 'lucide-react';
import { LABEL_LIST } from './tableConstants';

interface LabelFilterDropdownProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  excludedLabels: Set<string>;
  setExcludedLabels: (labels: Set<string>) => void;
  setCurrentPage: (page: number) => void;
  labelCounts: Record<string, number>;
}

const LabelFilterDropdown = React.memo(({
  isOpen, setIsOpen, excludedLabels, setExcludedLabels, setCurrentPage, labelCounts,
}: LabelFilterDropdownProps) => (
  <div className="relative">
    <button
      onClick={() => setIsOpen(!isOpen)}
      className="px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white hover:bg-zinc-50 flex items-center gap-1 w-full"
    >
      <Filter className="w-3 h-3 text-zinc-400" />
      <span className="text-zinc-500 truncate">{excludedLabels.size > 0 ? `${excludedLabels.size} hidden` : 'All'}</span>
    </button>
    {isOpen && (
      <>
        <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
        <div className="absolute left-0 mt-1 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 p-2 flex flex-col gap-0.5">
          {LABEL_LIST.map(label => (
            <label key={label} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-zinc-50 rounded-lg cursor-pointer">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!excludedLabels.has(label)}
                  onChange={(e) => {
                    const newLabels = new Set(excludedLabels);
                    if (!e.target.checked) newLabels.add(label);
                    else newLabels.delete(label);
                    setExcludedLabels(newLabels);
                    setCurrentPage(1);
                  }}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-zinc-700">{label}</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">{(labelCounts[label] || 0).toLocaleString()}</span>
            </label>
          ))}
        </div>
      </>
    )}
  </div>
));

LabelFilterDropdown.displayName = 'LabelFilterDropdown';
export default LabelFilterDropdown;
