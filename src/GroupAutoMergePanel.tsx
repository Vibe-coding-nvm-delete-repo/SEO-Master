import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Sparkles, X, Zap, BarChart3, Layers, TrendingUp } from 'lucide-react';
import type { GroupAutoMergeJobState } from './hooks/useGroupAutoMerge';
import type { GroupMergeRecommendation, GroupedCluster } from './types';

interface GroupAutoMergePanelProps {
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  recommendations: GroupMergeRecommendation[];
  recommendationsAreStale: boolean;
  job: GroupAutoMergeJobState;
  isBulkSharedEditBlocked?: boolean;
  onRun: () => Promise<void> | void;
  onCancel: () => void;
  onDismiss: (recommendationIds: Iterable<string>) => void;
  onApply: (recommendationIds: Iterable<string>) => Promise<boolean> | boolean;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function phaseLabel(phase: GroupAutoMergeJobState['phase']): string {
  if (phase === 'embedding') return 'Embedding groups...';
  if (phase === 'comparing') return 'Comparing pairs...';
  if (phase === 'ranking') return 'Ranking matches...';
  if (phase === 'complete') return 'Complete';
  if (phase === 'error') return 'Error';
  return 'Idle';
}

function similarityColor(similarity: number): string {
  if (similarity >= 0.94) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (similarity >= 0.9) return 'text-sky-700 bg-sky-50 border-sky-200';
  return 'text-amber-700 bg-amber-50 border-amber-200';
}

function progressBarColor(phase: GroupAutoMergeJobState['phase']): string {
  if (phase === 'error') return 'bg-red-500';
  if (phase === 'complete') return 'bg-emerald-500';
  return 'bg-sky-500';
}

/* ─── Metric pill used in stats bars ─── */
function MetricPill({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] ${muted ? 'text-zinc-400' : 'text-zinc-600'}`}>
      <span className="font-medium text-zinc-800">{value}</span>
      <span>{label}</span>
    </div>
  );
}

/* ─── Signal chip ─── */
function SignalChip({ label, tone }: { label: string; tone: 'emerald' | 'sky' | 'amber' | 'zinc' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    zinc: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  } as const;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {label}
    </span>
  );
}

/* ─── Expanded group detail column ─── */
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

const GroupAutoMergePanel: React.FC<GroupAutoMergePanelProps> = React.memo(({
  groupedClusters,
  approvedGroups,
  recommendations,
  recommendationsAreStale,
  job,
  isBulkSharedEditBlocked = false,
  onRun,
  onCancel,
  onDismiss,
  onApply,
}) => {
  const [selectedIdsState, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIdsState, setExpandedIds] = useState<Set<string>>(new Set());

  const pendingRecommendations = useMemo(
    () => recommendations.filter((r) => r.status === 'pending'),
    [recommendations],
  );
  const visibleRecommendationIds = useMemo(
    () => new Set(pendingRecommendations.map((r) => r.id)),
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
    () => new Map([...groupedClusters, ...approvedGroups].map((g) => [g.id, g])),
    [groupedClusters, approvedGroups],
  );

  /* ─── Summary stats for recommendation set ─── */
  const summaryStats = useMemo(() => {
    if (pendingRecommendations.length === 0) return null;
    const similarities = pendingRecommendations.map((r) => r.similarity);
    const avgSimilarity = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
    const highSimilarity = Math.max(...similarities);
    const lowSimilarity = Math.min(...similarities);
    let totalPages = 0;
    let totalVolume = 0;
    const uniqueGroupIds = new Set<string>();
    for (const r of pendingRecommendations) {
      if (!uniqueGroupIds.has(r.groupA.id)) {
        totalPages += r.groupA.pageCount;
        totalVolume += r.groupA.totalVolume;
        uniqueGroupIds.add(r.groupA.id);
      }
      if (!uniqueGroupIds.has(r.groupB.id)) {
        totalPages += r.groupB.pageCount;
        totalVolume += r.groupB.totalVolume;
        uniqueGroupIds.add(r.groupB.id);
      }
    }
    return {
      count: pendingRecommendations.length,
      avgSimilarity,
      highSimilarity,
      lowSimilarity,
      totalPages,
      totalVolume,
      uniqueGroups: uniqueGroupIds.size,
    };
  }, [pendingRecommendations]);

  const handleApply = async (recommendationIds: string[]) => {
    if (recommendationIds.length === 0) return;
    const confirmed = window.confirm(
      `Merge ${recommendationIds.length} recommendation${recommendationIds.length === 1 ? '' : 's'}? Merged groups land in the Grouped tab. Any approved groups involved will lose their approved status.`,
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

  if (groupedClusters.length + approvedGroups.length < 2) {
    return (
      <div className="flex flex-col h-full">
        <div className="py-14 text-center text-sm text-zinc-400">
          Need at least 2 groups across <span className="font-medium text-zinc-500">Grouped</span> and <span className="font-medium text-zinc-500">Approved</span> before Auto Merge can compare them.
        </div>
      </div>
    );
  }

  const running = job.phase === 'embedding' || job.phase === 'comparing' || job.phase === 'ranking';
  const showProgress = running || job.phase === 'complete' || job.phase === 'error';
  const allSelected = pendingRecommendations.length > 0 && pendingRecommendations.every((r) => selectedIds.has(r.id));
  const isActionBlocked = isBulkSharedEditBlocked || recommendationsAreStale;

  return (
    <div className="flex flex-col h-full">

      {/* ─── Header ─── */}
      <div className="px-4 py-3 border-b border-zinc-100 space-y-3">

        {/* Action row */}
        <div className="flex items-center gap-3">
          {!running ? (
            <button
              type="button"
              onClick={() => void onRun()}
              disabled={isBulkSharedEditBlocked}
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Embed & Compare
            </button>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors flex items-center gap-1.5"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          )}

          <span className="text-[11px] text-zinc-400">
            Embeds all Grouped + Approved groups, then finds semantic duplicates by cosine similarity.
          </span>
        </div>

        {/* Stale warning */}
        {recommendationsAreStale && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-700 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-500" />
            <span>Group data changed since last run. Click <span className="font-semibold">Embed & Compare</span> to refresh recommendations.</span>
          </div>
        )}

        {/* Progress section */}
        {showProgress && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 space-y-2">
            {/* Progress bar */}
            <div className="flex items-center gap-3">
              {running && <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500 shrink-0" />}
              {job.phase === 'complete' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
              {job.phase === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
              <div className="flex-1">
                <div className="h-2 bg-zinc-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${progressBarColor(job.phase)}`}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
              <span className="text-[11px] font-semibold text-zinc-700 tabular-nums w-10 text-right">{job.progress}%</span>
              <span className="text-[11px] text-zinc-500 w-[110px]">{phaseLabel(job.phase)}</span>
            </div>

            {/* Run stats */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <MetricPill label="groups" value={job.groupsScanned.toLocaleString()} />
              <MetricPill label="pairs" value={job.pairsCompared.toLocaleString()} />
              <MetricPill label="matches" value={job.matchesKept.toLocaleString()} />
              <MetricPill label="tokens" value={job.tokensUsed.toLocaleString()} muted />
              <MetricPill label="" value={`$${job.costUsdTotal.toFixed(4)}`} muted />
              <MetricPill label="" value={`${(job.elapsedMs / 1000).toFixed(1)}s`} muted />
              {job.error && <span className="text-[11px] text-red-600">{job.error}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ─── Recommendations ─── */}
      {pendingRecommendations.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-14">
            <div className="text-zinc-300 mb-3">
              <Layers className="w-8 h-8 mx-auto" />
            </div>
            <div className="text-sm text-zinc-400">
              {job.phase === 'complete'
                ? 'No semantic duplicates found at the current similarity threshold.'
                : 'Click Embed & Compare to find semantic duplicate groups.'}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Summary stats bar + bulk actions */}
          <div className="px-4 py-2.5 border-b border-zinc-100 bg-white">
            <div className="flex items-center gap-3">
              {/* Summary stats */}
              {summaryStats && (
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="flex items-center gap-1.5 text-zinc-800 font-semibold">
                    <Zap className="w-3 h-3 text-sky-500" />
                    {summaryStats.count} recommendation{summaryStats.count !== 1 ? 's' : ''}
                  </div>
                  <div className="w-px h-3.5 bg-zinc-200" />
                  <div className="flex items-center gap-1 text-zinc-600">
                    <TrendingUp className="w-3 h-3 text-zinc-400" />
                    avg {formatPercent(summaryStats.avgSimilarity)}
                    <span className="text-zinc-400">({formatPercent(summaryStats.lowSimilarity)}–{formatPercent(summaryStats.highSimilarity)})</span>
                  </div>
                  <div className="w-px h-3.5 bg-zinc-200" />
                  <div className="flex items-center gap-1 text-zinc-600">
                    <BarChart3 className="w-3 h-3 text-zinc-400" />
                    {summaryStats.uniqueGroups} groups · {summaryStats.totalPages.toLocaleString()} pages · {summaryStats.totalVolume.toLocaleString()} vol
                  </div>
                </div>
              )}

              {/* Bulk actions */}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleApply([...selectedIds])}
                  disabled={selectedIds.size === 0 || isActionBlocked}
                  className="px-2.5 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Merge ({selectedIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss([...selectedIds])}
                  disabled={selectedIds.size === 0 || isBulkSharedEditBlocked}
                  className="px-2.5 py-1 text-[11px] font-medium text-zinc-600 bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Dismiss ({selectedIds.size})
                </button>
              </div>
            </div>
          </div>

          {/* Recommendation table */}
          <div className="overflow-auto flex-1">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-zinc-50 border-b border-zinc-200">
                <tr className="text-zinc-500 uppercase tracking-wider text-[10px]">
                  <th className="px-3 py-2 w-[52px]">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(pendingRecommendations.map((r) => r.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      disabled={isActionBlocked}
                      className="rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                    />
                  </th>
                  <th className="px-2 py-2 w-[90px]">Match</th>
                  <th className="px-3 py-2">Group A</th>
                  <th className="px-3 py-2">Group B</th>
                  <th className="px-3 py-2 w-[120px]">Merged Result</th>
                  <th className="px-3 py-2 w-[190px]">Signals</th>
                  <th className="px-3 py-2 w-[140px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingRecommendations.map((rec) => {
                  const isExpanded = expandedIds.has(rec.id);
                  const groupA = groupsById.get(rec.groupA.id);
                  const groupB = groupsById.get(rec.groupB.id);
                  const combinedPages = rec.groupA.pageCount + rec.groupB.pageCount;
                  const combinedVolume = rec.groupA.totalVolume + rec.groupB.totalVolume;
                  return (
                    <React.Fragment key={rec.id}>
                      <tr className={`border-t border-zinc-100 align-top hover:bg-zinc-50/50 transition-colors ${isExpanded ? 'bg-zinc-50/40' : ''}`}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(rec.id)) next.delete(rec.id);
                                  else next.add(rec.id);
                                  return next;
                                });
                              }}
                              className="text-zinc-400 hover:text-zinc-700 transition-colors"
                            >
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(rec.id)}
                              onChange={(e) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(rec.id);
                                  else next.delete(rec.id);
                                  return next;
                                });
                              }}
                              disabled={isActionBlocked}
                              className="rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${similarityColor(rec.similarity)}`}>
                            {formatPercent(rec.similarity)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-zinc-800 flex items-center gap-1.5">
                            {rec.groupA.name}
                            {rec.groupA.source === 'approved' && (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Approved</span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {rec.groupA.pageCount} pages · {rec.groupA.totalVolume.toLocaleString()} vol
                          </div>
                          {rec.groupA.locationSummary && (
                            <div className="text-[10px] text-zinc-400">{rec.groupA.locationSummary}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-zinc-800 flex items-center gap-1.5">
                            {rec.groupB.name}
                            {rec.groupB.source === 'approved' && (
                              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Approved</span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {rec.groupB.pageCount} pages · {rec.groupB.totalVolume.toLocaleString()} vol
                          </div>
                          {rec.groupB.locationSummary && (
                            <div className="text-[10px] text-zinc-400">{rec.groupB.locationSummary}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-[11px] font-semibold text-zinc-800">{combinedPages} pages</div>
                          <div className="text-[11px] text-zinc-500">{combinedVolume.toLocaleString()} vol</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {rec.exactNameMatch && <SignalChip label="Exact name" tone="emerald" />}
                            {rec.sharedPageNameCount > 0 && (
                              <SignalChip label={`${rec.sharedPageNameCount} shared`} tone="sky" />
                            )}
                            <SignalChip
                              label={rec.locationCompatible ? 'Loc. match' : 'Loc. mismatch'}
                              tone={rec.locationCompatible ? 'zinc' : 'amber'}
                            />
                            {(rec.groupA.source === 'approved' || rec.groupB.source === 'approved') && (
                              <SignalChip label="Reverts" tone="amber" />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleApply([rec.id])}
                              disabled={recommendationsAreStale}
                              className="px-2.5 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Merge
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDismiss([rec.id])}
                              disabled={isBulkSharedEditBlocked}
                              className="px-2.5 py-1 text-[11px] font-medium text-zinc-600 bg-white border border-zinc-200 rounded-md hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Dismiss
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-zinc-50/60">
                          <td colSpan={7} className="px-4 py-3 border-t border-zinc-100">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <ExpandedGroupColumn title={rec.groupA.name} group={groupA} />
                              <ExpandedGroupColumn title={rec.groupB.name} group={groupB} />
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
        </>
      )}
    </div>
  );
});

GroupAutoMergePanel.displayName = 'GroupAutoMergePanel';

export default GroupAutoMergePanel;
