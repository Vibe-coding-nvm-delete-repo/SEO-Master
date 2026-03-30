import React from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Copy } from 'lucide-react';
import { CELL, TABLE_ZEBRA } from './tableConstants';
import {
  pagesTabChildRowKey,
  pagesTabChildCity,
  pagesTabChildState,
  kdCellDisplay,
  keywordLenForCell,
  volumeCellDisplay,
} from './clusterExpandChildRows';
import KwRatingCell from './KwRatingCell';
import type { ClusterSummary } from './types';

const ClusterRow = React.memo(({
  row,
  isExpanded,
  isSelected,
  selectedTokens,
  toggleCluster,
  onSelect,
  setSelectedTokens,
  setCurrentPage,
  onMiddleClick,
  labelColorMap,
  onBlockToken
}: {
  row: ClusterSummary;
  isExpanded: boolean;
  isSelected: boolean;
  selectedTokens: Set<string>;
  toggleCluster: (p: string) => void;
  onSelect: (checked: boolean) => void;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onBlockToken?: (token: string) => void;
  labelColorMap: Map<string, { border: string; bg: string; text: string; sectionName: string }>;
}) => (
  <>
    <tr
      className="hover:bg-zinc-50/50 transition-colors"
      onAuxClick={onMiddleClick}
    >
      <td className="px-3 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          checked={isSelected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 overflow-hidden">
        <div className="flex items-center gap-1.5 group/name">
          <button
            onClick={(e) => { e.stopPropagation(); toggleCluster(row.pageName); }}
            className="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors"
            title={isExpanded ? 'Collapse row' : 'Expand row'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <span className="break-words">{row.pageName}</span>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(row.pageName)}`, '_blank'); }}
            className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0"
            title="Search Google SERPs"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.pageName); }}
            className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0"
            title="Copy page name"
          >
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </td>
      <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs overflow-hidden">
        <div className="flex flex-wrap gap-1">
          {row.tokenArr.map((token, i) => {
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
                title={labelColor ? `${labelColor ? `Label: ${labelColor.sectionName} · ` : ''}Ctrl+click to block` : 'Ctrl+click to block'}
              >
                {token}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">
        {row.pageNameLen}
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
      <td className={`${CELL.dataLabelLocation} truncate max-w-0`} title={row.label}>{row.label}</td>
      <td className={`${CELL.dataLabelLocation} capitalize`}>{row.locationCity || '-'}</td>
      <td className={`${CELL.dataLabelLocation} uppercase`}>{row.locationState || '-'}</td>
    </tr>
    {isExpanded && row.keywords.map((kw, i) => (
      <tr
        key={pagesTabChildRowKey(row.pageName, i, kw.keyword)}
        className={`${i % 2 === 0 ? TABLE_ZEBRA.childBase : TABLE_ZEBRA.childAlt} border-b border-zinc-100`}
      >
        <td className="px-3 py-px" aria-hidden />
        <td className="px-3 py-px text-[11px] overflow-hidden min-w-0">
          <div className="pl-7 min-w-0">
            <span className="text-[11px] font-medium text-zinc-600 break-words" title={kw.keyword}>
              {kw.keyword}
            </span>
          </div>
        </td>
        <td className="px-3 py-px min-w-0" aria-hidden />
        <td className="px-1 py-px text-zinc-500 text-right tabular-nums text-[11px]">{keywordLenForCell(kw.keyword)}</td>
        <td className="px-1 py-px text-zinc-600 text-right tabular-nums text-[11px]">1</td>
        <td className="px-1 py-px text-zinc-600 text-right tabular-nums text-[11px]">{volumeCellDisplay(kw.volume)}</td>
        <td className="px-1 py-px text-zinc-600 text-right tabular-nums text-[11px]">{kdCellDisplay(kw.kd)}</td>
        <KwRatingCell value={kw.kwRating} />
        <td className="px-3 py-px text-[11px] text-zinc-600 whitespace-nowrap overflow-hidden text-ellipsis max-w-[90px]" title={row.label}>{row.label}</td>
        <td className="px-3 py-px text-[11px] text-zinc-600 capitalize whitespace-nowrap">{pagesTabChildCity(kw, row)}</td>
        <td className="px-3 py-px text-[11px] text-zinc-600 uppercase whitespace-nowrap">{pagesTabChildState(kw, row)}</td>
      </tr>
    ))}
  </>
));

export default ClusterRow;
