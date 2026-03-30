import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Sparkles, X } from 'lucide-react';
import type { GroupAutoMergeJobState } from './hooks/useGroupAutoMerge';
import type { GroupMergeRecommendation, GroupedCluster } from './types';

interface GroupAutoMergePanelProps {
  groupedClusters: GroupedCluster[];
  recommendations: GroupMergeRecommendation[];
  recommendationsAreStale: boolean;
  job: GroupAutoMergeJobState;
  onRun: () => Promise<void> | void;
  onCancel: () => void;
  onDismiss: (recommendationIds: Iterable<string>) => void;
  onApply: (recommendationIds: Iterable<string>) => Promise<boolean> | boolean;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPhase(phase: GroupAutoMergeJobState['phase']): string {
  if (phase === 'embedding') return 'Embedding';
  if (phase === 'comparing') return 'Comparing';
  if (phase === 'ranking') return 'Ranking';
  if (phase === 'complete') return 'Complete';
  if (phase === 'error') return 'Error';
  return 'Idle';
}

function similarityTone(similarity: number): string {
  if (similarity >= 0.94) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (similarity >= 0.9) return 'text-sky-700 bg-sky-50 border-sky-100';
  return 'text-amber-700 bg-amber-50 border-amber-100';
}

const GroupAutoMergePanel: React.FC<GroupAutoMergePanelProps> = React.memo(({
  groupedClusters,
  recommendations,
  recommendationsAreStale,
  job,
  onRun,
  onCancel,
  onDismiss,
  onApply,
}) => {
  const [selectedIdsState, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIdsState, setExpandedIds] = useState<Set<string>>(new Set());

  const pendingRecommendations = useMemo(
    () => recommendations.filter((recommendation) => recommendation.status === 'pending'),
    [recommendations],
  );
  const visibleRecommendationIds = useMemo(
    () => new Set(pendingRecommendations.map((recommendation) => recommendation.id)),
    [pendingRecommendations],
  );
  const selectedIds = useMemo(
    () => new Set([...selectedIdsState].filter((id) => visibleRecommendationIds.has(id))),
    [selectedIdsState, visibleRecommendationIds],
  );
  const expandedIds = useMemo(
    () => new Set([...expandedIdsState].filter((id) => visibleRecommendationIds.has(id))),
    [expandedIdsState, visibleRecommendationIds],
  );
  const groupsById = useMemo(
    () => new Map(groupedClusters.map((group) => [group.id, group])),
    [groupedClusters],
  );

  const handleApply = async (recommendationIds: string[]) => {
    if (recommendationIds.length === 0) return;
    const confirmed = window.confirm(
      `Merge ${recommendationIds.length} recommendation${recommendationIds.length === 1 ? '' : 's'}? This rewrites current grouped groups and there is no persisted undo history for v1.`,
    );
    if (!confirmed) return;
    const applied = await onApply(recommendationIds);
    if (applied) {
      setSelectedIds((prev) => new Set([...prev].filter((id) => !recommendationIds.includes(id))));
    }
  };

  const handleDismiss = (recommendationIds: string[]) => {
    if (recommendationIds.length === 0) return;
    onDismiss(recommendationIds);
    setSelectedIds((prev) => new Set([...prev].filter((id) => !recommendationIds.includes(id))));
  };

  if (groupedClusters.length < 2) {
    return (
      <div className="border-t border-zinc-100">
        <div className="py-14 text-center text-sm text-zinc-400">
          Need at least 2 groups in <span className="font-medium text-zinc-500">Grouped</span> before Auto Merge can compare them.
        </div>
      </div>
    );
  }

  const running = job.phase === 'embedding' || job.phase === 'comparing' || job.phase === 'ranking';
  const allSelected = pendingRecommendations.length > 0 && pendingRecommendations.every((recommendation) => selectedIds.has(recommendation.id));

  return (
    <div className="border-t border-zinc-100 flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50/40 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {!running ? (
            <button
              type="button"
              onClick={() => void onRun()}
              className="px-3 py-1.5 text-xs font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3" />
              Embed
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1.5"
            >
              Cancel
            </button>
          )}

          <span className="text-[11px] text-zinc-500">
            Compares all current grouped groups using embeddings of the group name, location summary, and top pages.
          </span>

          {pendingRecommendations.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleApply([...selectedIds])}
                disabled={selectedIds.size === 0 || recommendationsAreStale}
                className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3 h-3" />
                Merge Selected
              </button>
              <button
                type="button"
                onClick={() => handleDismiss([...selectedIds])}
                disabled={selectedIds.size === 0}
                className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                <X className="w-3 h-3" />
                Dismiss Selected
              </button>
            </div>
          )}
        </div>

        {recommendationsAreStale && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Grouped data changed after this recommendation run. Click <span className="font-semibold">Embed</span> again before merging.</span>
          </div>
        )}

        {(running || job.phase === 'complete' || job.phase === 'error') && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-600">
            <div className="flex items-center gap-2 min-w-[240px]">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" /> : null}
              <div className="relative w-36 h-3.5 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200">
                <div
                  className={`h-full transition-all duration-300 ${job.phase === 'error' ? 'bg-red-400' : job.phase === 'complete' ? 'bg-emerald-400' : 'bg-sky-400'}`}
                  style={{ width: `${job.progress}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-zinc-700">
                  {job.progress}%
                </span>
              </div>
              <span className="font-medium text-zinc-700">{formatPhase(job.phase)}</span>
            </div>
            <span>{job.groupsScanned.toLocaleString()} groups</span>
            <span>{job.pairsCompared.toLocaleString()} pairs</span>
            <span>{job.matchesKept.toLocaleString()} kept</span>
            <span>{job.tokensUsed.toLocaleString()} tokens</span>
            <span>${job.costUsdTotal.toFixed(4)}</span>
            <span>{(job.elapsedMs / 1000).toFixed(1)}s</span>
            {job.error ? <span className="text-red-600">{job.error}</span> : null}
          </div>
        )}
      </div>

      {pendingRecommendations.length === 0 ? (
        <div className="py-14 text-center text-sm text-zinc-400">
          {job.phase === 'complete'
            ? 'No pending auto-merge recommendations to review.'
            : 'Click Embed to generate semantic duplicate group recommendations.'}
        </div>
      ) : (
        <div className="overflow-auto flex-1">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-zinc-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-3 py-2 w-[56px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedIds(new Set(pendingRecommendations.map((recommendation) => recommendation.id)));
                      } else {
                        setSelectedIds(new Set());
                      }
                    }}
                    disabled={recommendationsAreStale}
                    className="rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                  />
                </th>
                <th className="px-2 py-2 w-[110px]">Similarity</th>
                <th className="px-3 py-2">Group A</th>
                <th className="px-3 py-2">Group B</th>
                <th className="px-3 py-2 w-[220px]">Signals</th>
                <th className="px-3 py-2 w-[170px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingRecommendations.map((recommendation) => {
                const isExpanded = expandedIds.has(recommendation.id);
                const groupA = groupsById.get(recommendation.groupA.id);
                const groupB = groupsById.get(recommendation.groupB.id);
                return (
                  <React.Fragment key={recommendation.id}>
                    <tr className="border-t border-zinc-100 align-top">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(recommendation.id)) next.delete(recommendation.id);
                                else next.add(recommendation.id);
                                return next;
                              });
                            }}
                            className="text-zinc-400 hover:text-zinc-700"
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(recommendation.id)}
                            onChange={(event) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (event.target.checked) next.add(recommendation.id);
                                else next.delete(recommendation.id);
                                return next;
                              });
                            }}
                            disabled={recommendationsAreStale}
                            className="rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 font-semibold ${similarityTone(recommendation.similarity)}`}>
                          {formatPercent(recommendation.similarity)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-800">{recommendation.groupA.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {recommendation.groupA.pageCount} pages · {recommendation.groupA.totalVolume.toLocaleString()} vol
                        </div>
                        <div className="text-[11px] text-zinc-400">{recommendation.groupA.locationSummary}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-zinc-800">{recommendation.groupB.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {recommendation.groupB.pageCount} pages · {recommendation.groupB.totalVolume.toLocaleString()} vol
                        </div>
                        <div className="text-[11px] text-zinc-400">{recommendation.groupB.locationSummary}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {recommendation.exactNameMatch ? <SignalChip label="Exact group name" tone="emerald" /> : null}
                          {recommendation.sharedPageNameCount > 0 ? <SignalChip label={`${recommendation.sharedPageNameCount} shared page${recommendation.sharedPageNameCount === 1 ? '' : 's'}`} tone="sky" /> : null}
                          <SignalChip label={recommendation.locationCompatible ? 'Location compatible' : 'Location mismatch'} tone={recommendation.locationCompatible ? 'zinc' : 'amber'} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleApply([recommendation.id])}
                            disabled={recommendationsAreStale}
                            className="px-2.5 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            Merge
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDismiss([recommendation.id])}
                            className="px-2.5 py-1 text-[11px] font-medium text-zinc-700 bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors"
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-zinc-100 bg-zinc-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <ExpandedGroupColumn title={recommendation.groupA.name} group={groupA} />
                            <ExpandedGroupColumn title={recommendation.groupB.name} group={groupB} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

function SignalChip({ label, tone }: { label: string; tone: 'emerald' | 'sky' | 'amber' | 'zinc' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    zinc: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  } as const;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}

function ExpandedGroupColumn({ title, group }: { title: string; group?: GroupedCluster }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="px-3 py-2 border-b border-zinc-100">
        <div className="text-[11px] font-semibold text-zinc-800">{title}</div>
        {group ? (
          <div className="text-[10px] text-zinc-500">
            {group.clusters.length} pages · {group.totalVolume.toLocaleString()} volume
          </div>
        ) : (
          <div className="text-[10px] text-amber-600">Group no longer exists in current grouped data.</div>
        )}
      </div>
      <div className="max-h-[260px] overflow-auto">
        {group ? group.clusters.map((cluster) => (
          <div key={`${group.id}::${cluster.tokens}`} className="px-3 py-2 border-t border-zinc-100 first:border-t-0">
            <div className="text-[11px] font-medium text-zinc-700">{cluster.pageName}</div>
            <div className="text-[10px] text-zinc-500">
              {cluster.keywordCount} KWs · {cluster.totalVolume.toLocaleString()} vol · {cluster.locationCity || cluster.locationState || 'No location'}
            </div>
          </div>
        )) : (
          <div className="px-3 py-3 text-[11px] text-zinc-400">Re-run Embed to regenerate valid pairs.</div>
        )}
      </div>
    </div>
  );
}

GroupAutoMergePanel.displayName = 'GroupAutoMergePanel';

export default GroupAutoMergePanel;
