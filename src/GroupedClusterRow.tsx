import React from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Copy, Loader2 } from 'lucide-react';
import { CELL, TABLE_ZEBRA } from './tableConstants';
import { normalizeMismatchedPageNames } from './GroupReviewEngine';
import {
  groupedTabChildRowKey,
  groupedTabChildCity,
  groupedTabChildState,
  kdCellDisplay,
  keywordLenForCell,
  volumeCellDisplay,
} from './clusterExpandChildRows';
import KwRatingCell from './KwRatingCell';
import type { GroupedCluster } from './types';

function groupedClusterAggregatedLabels(row: GroupedCluster): string {
  const labels = new Set<string>();
  row.clusters.forEach(c => c.labelArr.forEach(l => labels.add(l)));
  return labels.size > 0 ? Array.from(labels).join(', ') : '-';
}

function groupedClusterAggregatedCities(row: GroupedCluster): string {
  const cities = new Set<string>();
  row.clusters.forEach(c => { if (c.locationCity) cities.add(c.locationCity); });
  return cities.size > 0 ? Array.from(cities).join(', ') : '-';
}

function groupedClusterAggregatedStates(row: GroupedCluster): string {
  const states = new Set<string>();
  row.clusters.forEach(c => { if (c.locationState) states.add(c.locationState); });
  return states.size > 0 ? Array.from(states).join(', ') : '-';
}

const GroupedClusterRow = React.memo(({
  row,
  isExpanded,
  expandedSubClusters,
  toggleGroup,
  toggleSubCluster,
  selectedTokens,
  setSelectedTokens,
  setCurrentPage,
  isGroupSelected,
  selectedSubClusters,
  onGroupSelect,
  onSubClusterSelect,
  labelColorMap,
  groupActionButton,
  onBlockToken
}: {
  row: GroupedCluster;
  isExpanded: boolean;
  expandedSubClusters: Set<string>;
  toggleGroup: (id: string) => void;
  toggleSubCluster: (id: string) => void;
  selectedTokens: Set<string>;
  onBlockToken?: (token: string) => void;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  isGroupSelected: boolean;
  selectedSubClusters: Set<string>;
  onGroupSelect: (checked: boolean) => void;
  onSubClusterSelect: (subKey: string, checked: boolean) => void;
  labelColorMap: Map<string, { border: string; bg: string; text: string; sectionName: string }>;
  groupActionButton?: React.ReactNode;
}) => {
  const groupedLabelSummary = groupedClusterAggregatedLabels(row);
  const groupedCitySummary = groupedClusterAggregatedCities(row);
  const groupedStateSummary = groupedClusterAggregatedStates(row);
  return (
    <>
      <tr className="hover:bg-zinc-50/50 transition-colors">
        <td className="px-3 py-0.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            checked={isGroupSelected}
            onChange={(e) => onGroupSelect(e.target.checked)}
          />
        </td>
        <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 overflow-hidden">
          <div className="flex items-center gap-1.5 group/gname">
            <button
              onClick={(e) => { e.stopPropagation(); toggleGroup(row.id); }}
              className="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors"
              title={isExpanded ? 'Collapse group' : 'Expand group'}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            <span className="break-words">{row.groupName}</span>
            {row.groupAutoMerged && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0" title="Created by group auto-merge">Merged</span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(row.groupName)}`, '_blank'); }}
              className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/gname:opacity-100 transition-opacity shrink-0"
              title="Search Google SERPs"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.groupName); }}
              className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/gname:opacity-100 transition-opacity shrink-0"
              title="Copy group name"
            >
              <Copy className="w-3 h-3" />
            </button>
            {groupActionButton && <span onClick={(e) => e.stopPropagation()}>{groupActionButton}</span>}
          </div>
        </td>
        <td className="px-1.5 py-0.5 overflow-hidden">
          <div className="flex flex-wrap gap-1">
            {(() => {
              // Tokens from the highest volume page in the group (matches the page name)
              const topPage = row.clusters.length > 0 ? row.clusters.reduce((best, c) => c.totalVolume > best.totalVolume ? c : best, row.clusters[0]) : null;
              const groupTokens = topPage ? topPage.tokenArr : [];
              return groupTokens.map(token => {
                const labelColor = labelColorMap.get(token);
                return (
                  <button
                    key={token}
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((e.ctrlKey || e.metaKey) && onBlockToken) {
                        onBlockToken(token);
                        return;
                      }
                      const newTokens = new Set(selectedTokens);
                      if (newTokens.has(token)) newTokens.delete(token);
                      else newTokens.add(token);
                      setSelectedTokens(newTokens);
                      setCurrentPage(1);
                    }}
                    className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
                    style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
                    title={labelColor ? `${labelColor.sectionName} · Ctrl+click to block` : 'Ctrl+click to block'}
                  >
                    {token}
                  </button>
                );
              });
            })()}
          </div>
        </td>
        {/* Review Status */}
        <td className="px-1.5 py-0.5 text-center">
          {row.reviewStatus === 'pending' || row.reviewStatus === 'reviewing' ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
              <Loader2 className="w-3 h-3 animate-spin" />
            </span>
          ) : row.reviewStatus === 'approve' ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title={row.reviewReason || 'All pages match'}>{'\u2713'}</span>
          ) : row.reviewStatus === 'mismatch' ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 cursor-help" title={`Mismatched: ${(row.reviewMismatchedPages || []).join(', ')}\n${row.reviewReason || ''}`}>{'\u2717'}</span>
          ) : row.reviewStatus === 'error' ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 cursor-help" title={row.reviewReason || 'Review error'}>!</span>
          ) : (
            <span className="text-zinc-300">-</span>
          )}
        </td>
        <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">-</td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
          {row.clusters.length.toLocaleString()}
        </td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
          {row.keywordCount.toLocaleString()}
        </td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
          {row.totalVolume.toLocaleString()}
        </td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
          {row.avgKd !== null ? row.avgKd : '-'}
        </td>
        <KwRatingCell value={row.avgKwRating} />
        <td className={`${CELL.dataLabelLocation} truncate max-w-0`} title={groupedLabelSummary === '-' ? undefined : groupedLabelSummary}>
          {groupedLabelSummary}
        </td>
        <td className={`${CELL.dataLabelLocation} capitalize truncate max-w-0`} title={groupedCitySummary === '-' ? undefined : groupedCitySummary}>
          {groupedCitySummary}
        </td>
        <td className={`${CELL.dataLabelLocation} uppercase truncate max-w-0`} title={groupedStateSummary === '-' ? undefined : groupedStateSummary}>
          {groupedStateSummary}
        </td>
      </tr>
      {isExpanded && (() => {
        const pageNames = row.clusters.map(c => c.pageName);
        const mismatchNorm = new Set(
          normalizeMismatchedPageNames(pageNames, row.reviewMismatchedPages || [])
        );
        const mismatchAmbiguous =
          row.reviewStatus === 'mismatch' && mismatchNorm.size === 0;
        return row.clusters.map((cluster, cIdx) => {
          const subId = `${row.id}-${cluster.pageName}`;
          const isSubExpanded = expandedSubClusters.has(subId);
          return (
            <React.Fragment key={cIdx}>
              <tr className="bg-indigo-50/40 hover:bg-indigo-50/70 transition-colors border-b border-zinc-100">
                <td className="px-3 py-0.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="rounded border-zinc-300 text-orange-500 focus:ring-orange-400"
                    checked={selectedSubClusters.has(`${row.id}::${cluster.tokens}`)}
                    onChange={(e) => onSubClusterSelect(`${row.id}::${cluster.tokens}`, e.target.checked)}
                  />
                </td>
                <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 overflow-hidden">
                  <div className="flex items-center gap-1.5 pl-6 group/sub">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSubCluster(subId); }}
                      className="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title={isSubExpanded ? 'Collapse row' : 'Expand row'}
                    >
                      {isSubExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span className="text-[12px] break-words">{cluster.pageName}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(cluster.pageName)}`, '_blank'); }}
                      className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                      title="Search Google SERPs"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(cluster.pageName); }}
                      className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                      title="Copy page name"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </td>
                <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs overflow-hidden">
                  <div className="flex flex-wrap gap-1">
                    {cluster.tokenArr.map((token, i) => {
                      const labelColor = labelColorMap.get(token);
                      return (
                        <button
                          key={i}
                          onClick={(e) => {
                            e.stopPropagation();
                            if ((e.ctrlKey || e.metaKey) && onBlockToken) {
                              onBlockToken(token);
                              return;
                            }
                            const newTokens = new Set(selectedTokens);
                            if (newTokens.has(token)) newTokens.delete(token);
                            else newTokens.add(token);
                            setSelectedTokens(newTokens);
                            setCurrentPage(1);
                          }}
                          className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
                          style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
                          title={labelColor ? `${labelColor.sectionName} · Ctrl+click to block` : 'Ctrl+click to block'}
                        >
                          {token}
                        </button>
                      );
                    })}
                  </div>
                </td>
                {/* Sub-cluster QA: red = mismatched page; green = OK */}
                <td className="px-1.5 py-0.5 text-center">
                  {mismatchNorm.has(cluster.pageName) ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Flagged as mismatched" />
                  ) : row.reviewStatus === 'approve' ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Matches group" />
                  ) : row.reviewStatus === 'mismatch' && !mismatchAmbiguous ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Matches group theme" />
                  ) : mismatchAmbiguous ? (
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Group mismatch — page list missing or could not be matched" />
                  ) : null}
                </td>
                <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">
                  {cluster.pageNameLen}
                </td>
                <td className="px-1 py-0.5 text-zinc-400 text-right tabular-nums text-xs">-</td>
                <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
                  {cluster.keywordCount.toLocaleString()}
                </td>
                <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
                  {cluster.totalVolume.toLocaleString()}
                </td>
                <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
                  {cluster.avgKd !== null ? cluster.avgKd : '-'}
                </td>
                <KwRatingCell value={cluster.avgKwRating} />
                <td className={CELL.dataLabelLocation}>{cluster.label}</td>
                <td className={`${CELL.dataLabelLocation} capitalize`}>{cluster.locationCity || '-'}</td>
                <td className={`${CELL.dataLabelLocation} uppercase`}>{cluster.locationState || '-'}</td>
              </tr>
              {isSubExpanded && cluster.keywords.map((kw, i) => (
                <tr
                  key={groupedTabChildRowKey(subId, i, kw.keyword)}
                  className={`${i % 2 === 0 ? TABLE_ZEBRA.childBase : TABLE_ZEBRA.childAlt} border-b border-zinc-100`}
                >
                  <td className="px-3 py-px" aria-hidden />
                  <td className="px-3 py-px text-[11px] overflow-hidden min-w-0">
                    <div className="pl-10 min-w-0">
                      <span className="text-[11px] font-medium text-zinc-600 break-words" title={kw.keyword}>
                        {kw.keyword}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-px min-w-0" aria-hidden />
                  <td className="px-1.5 py-px" aria-hidden />
                  <td className="px-1 py-px text-zinc-500 text-right tabular-nums text-[11px]">{keywordLenForCell(kw.keyword)}</td>
                  <td className="px-1 py-px text-zinc-400 text-right tabular-nums text-[11px]">-</td>
                  <td className="px-1 py-px text-zinc-600 text-right tabular-nums text-[11px]">1</td>
                  <td className="px-1 py-px text-zinc-600 text-right tabular-nums text-[11px]">{volumeCellDisplay(kw.volume)}</td>
                  <td className="px-1 py-px text-zinc-600 text-right tabular-nums text-[11px]">{kdCellDisplay(kw.kd)}</td>
                  <KwRatingCell value={kw.kwRating} />
                  <td className="px-3 py-px text-[11px] text-zinc-600 whitespace-nowrap overflow-hidden text-ellipsis max-w-[90px]" title={cluster.label}>{cluster.label}</td>
                  <td className="px-3 py-px text-[11px] text-zinc-600 capitalize whitespace-nowrap">{groupedTabChildCity(kw, cluster)}</td>
                  <td className="px-3 py-px text-[11px] text-zinc-600 uppercase whitespace-nowrap">{groupedTabChildState(kw, cluster)}</td>
                </tr>
              ))}
            </React.Fragment>
          );
        });
      })()}
    </>
  );
});

export default GroupedClusterRow;
