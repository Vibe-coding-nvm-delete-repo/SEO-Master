import React, { useState, useMemo } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, X } from 'lucide-react';
import type { TokenSummary } from './types';

interface MergeConfirmModalProps {
  isOpen: boolean;
  tokens: string[];
  tokenSummary: TokenSummary[];
  impact: { pagesAffected: number; groupsAffected: number; approvedGroupsAffected: number; pageCollisions: number };
  universalBlockedTokens: Set<string>;
  onConfirm: (parentToken: string) => void;
  onCancel: () => void;
}

const MergeConfirmModal: React.FC<MergeConfirmModalProps> = ({
  isOpen, tokens, tokenSummary, impact, universalBlockedTokens, onConfirm, onCancel,
}) => {
  // Default parent = highest volume token
  const tokenVolumes = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tokenSummary) map.set(t.token, t.totalVolume);
    return map;
  }, [tokenSummary]);

  const sortedTokens = useMemo(() =>
    [...tokens].sort((a, b) => (tokenVolumes.get(b) || 0) - (tokenVolumes.get(a) || 0)),
  [tokens, tokenVolumes]);

  const [parentToken, setParentToken] = useState(sortedTokens[0] || '');
  const childTokens = sortedTokens.filter(t => t !== parentToken);
  const blockedChildren = childTokens.filter(t => universalBlockedTokens.has(t));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

      {/* Modal */}
      <div className="relative bg-white border border-zinc-200 rounded-xl shadow-xl max-w-md w-full mx-4 p-5">
        {/* Close */}
        <button onClick={onCancel} className="absolute top-3 right-3 p-1 text-zinc-400 hover:text-zinc-600 transition-colors">
          <X className="w-4 h-4" />
        </button>

        <h3 className="text-sm font-semibold text-zinc-900 mb-3">Merge Tokens</h3>

        {/* Parent selector */}
        <div className="mb-3">
          <label className="text-[11px] font-medium text-zinc-500 mb-1 block">Merge into (parent token):</label>
          <div className="relative">
            <select
              value={parentToken}
              onChange={(e) => setParentToken(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none pr-8"
            >
              {sortedTokens.map(t => (
                <option key={t} value={t}>
                  {t} ({(tokenVolumes.get(t) || 0).toLocaleString()} vol)
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
          </div>
        </div>

        {/* Child tokens */}
        <div className="mb-3">
          <label className="text-[11px] font-medium text-zinc-500 mb-1 block">Will be merged:</label>
          <div className="flex flex-wrap gap-1.5">
            {childTokens.map(t => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 text-zinc-700 border border-zinc-200 rounded text-[11px] font-medium">
                {t}
                <ArrowRight className="w-2.5 h-2.5 text-zinc-400" />
                <span className="font-semibold text-indigo-600">{parentToken}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Impact preview */}
        <div className="mb-3 p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 text-[11px]">
          <div className="font-medium text-zinc-700 mb-1">Impact Preview:</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-zinc-600">
            <span>Pages affected:</span>
            <span className="font-semibold text-zinc-800">{impact.pagesAffected}</span>
            {impact.pageCollisions > 0 && <>
              <span>Pages merging together:</span>
              <span className="font-semibold text-amber-600">{impact.pageCollisions}</span>
            </>}
            <span>Groups affected:</span>
            <span className="font-semibold text-zinc-800">{impact.groupsAffected}</span>
            {impact.approvedGroupsAffected > 0 && <>
              <span>Approved groups affected:</span>
              <span className="font-semibold text-red-600">{impact.approvedGroupsAffected}</span>
            </>}
          </div>
        </div>

        {/* Warnings */}
        {impact.approvedGroupsAffected > 0 && (
          <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700">
              {impact.approvedGroupsAffected} approved group{impact.approvedGroupsAffected > 1 ? 's' : ''} will be unapproved and moved back to Pages (Grouped) for re-review.
            </p>
          </div>
        )}

        {blockedChildren.length > 0 && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700">
              Token{blockedChildren.length > 1 ? 's' : ''} <strong>{blockedChildren.join(', ')}</strong> {blockedChildren.length > 1 ? 'are' : 'is'} in the Universal Blocked list.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(parentToken)}
            className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
          >
            Merge {childTokens.length} token{childTokens.length > 1 ? 's' : ''} into "{parentToken}"
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeConfirmModal;
