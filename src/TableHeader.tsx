import React, { useCallback, useRef, useState, useEffect } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { ColumnDef } from './tableConstants';
import { CELL } from './tableConstants';
import LabelFilterDropdown from './LabelFilterDropdown';
import { clampColWidth, colElementStyle, sanitizeColumnWidths } from './tableColumnWidths';
import { useToast } from './ToastContext';
import {
  appSettingsIdbKey,
  loadCachedState,
  persistLocalCachedState,
} from './appSettingsPersistence';

export interface FilterBag {
  minLen: string; setMinLen: (v: string) => void;
  maxLen: string; setMaxLen: (v: string) => void;
  minKwInCluster: string; setMinKwInCluster: (v: string) => void;
  maxKwInCluster: string; setMaxKwInCluster: (v: string) => void;
  minVolume: string; setMinVolume: (v: string) => void;
  maxVolume: string; setMaxVolume: (v: string) => void;
  minKd: string; setMinKd: (v: string) => void;
  maxKd: string; setMaxKd: (v: string) => void;
  minKwRating: string; setMinKwRating: (v: string) => void;
  maxKwRating: string; setMaxKwRating: (v: string) => void;
  filterCity: string; setFilterCity: (v: string) => void;
  filterState: string; setFilterState: (v: string) => void;
  excludedLabels: Set<string>; setExcludedLabels: (s: Set<string>) => void;
  isLabelDropdownOpen: boolean; setIsLabelDropdownOpen: (b: boolean) => void;
  labelCounts: Record<string, number>;
}

interface TableHeaderProps {
  columns: ColumnDef[];
  showCheckbox: boolean;
  allChecked?: boolean;
  onCheckAll?: (checked: boolean) => void;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc';
  sortStack?: Array<{key: string, direction: 'asc' | 'desc'}>; // Multi-sort support
  onSort: (key: string, additive?: boolean) => void;
  filters: FilterBag;
  setCurrentPage: (page: number) => void;
}

/** Legacy Firestore doc id — only used as IDB key segment; widths are per-browser, not cloud-synced. */
const WIDTHS_DOC = 'table_column_widths';

// Map filterKey → [getter, setter] pairs in FilterBag
const getFilterPair = (filters: FilterBag, filterKey: string): { min: string; setMin: (v: string) => void; max: string; setMax: (v: string) => void } | null => {
  switch (filterKey) {
    case 'len': return { min: filters.minLen, setMin: filters.setMinLen, max: filters.maxLen, setMax: filters.setMaxLen };
    case 'kws': case 'pages': return { min: filters.minKwInCluster, setMin: filters.setMinKwInCluster, max: filters.maxKwInCluster, setMax: filters.setMaxKwInCluster };
    case 'vol': return { min: filters.minVolume, setMin: filters.setMinVolume, max: filters.maxVolume, setMax: filters.setMaxVolume };
    case 'kd': return { min: filters.minKd, setMin: filters.setMinKd, max: filters.maxKd, setMax: filters.setMaxKd };
    case 'kwRating': return { min: filters.minKwRating, setMin: filters.setMinKwRating, max: filters.maxKwRating, setMax: filters.setMaxKwRating };
    default: return null;
  }
};

const getTextFilter = (filters: FilterBag, filterKey: string): { value: string; setValue: (v: string) => void } | null => {
  switch (filterKey) {
    case 'city': return { value: filters.filterCity, setValue: filters.setFilterCity };
    case 'state': return { value: filters.filterState, setValue: filters.setFilterState };
    default: return null;
  }
};

const SortIcon = ({ columnKey, sortKey, sortDirection, sortStack }: { columnKey: string; sortKey: string | null; sortDirection: 'asc' | 'desc'; sortStack?: Array<{key: string, direction: 'asc' | 'desc'}> }) => {
  // Multi-sort: show priority number if in sort stack
  if (sortStack && sortStack.length > 1) {
    const idx = sortStack.findIndex(s => s.key === columnKey);
    if (idx >= 0) {
      const dir = sortStack[idx].direction;
      return (
        <span className="inline-flex items-center gap-0.5">
          {dir === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />}
          <span className="text-[8px] font-bold text-indigo-500 -ml-0.5">{idx + 1}</span>
        </span>
      );
    }
    return <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />;
  }
  // Single sort fallback
  if (sortKey !== columnKey) return <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />;
  return sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />;
};

const hasFilters = (columns: ColumnDef[]) => columns.some(c => c.filterType && c.filterType !== 'none');

const TableHeader = React.memo(({
  columns, showCheckbox, allChecked, onCheckAll, sortKey, sortDirection, sortStack, onSort, filters, setCurrentPage,
}: TableHeaderProps) => {
  const { addToast } = useToast();
  const showFilterRow = hasFilters(columns);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const colWidthsRef = useRef(colWidths);
  const dragRef = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);
  const isDraggingRef = useRef(false);
  const rafResizeRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{ colKey: string; width: number } | null>(null);
  const thRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  useEffect(() => {
    colWidthsRef.current = colWidths;
  }, [colWidths]);

  useEffect(() => {
    let alive = true;
    void loadCachedState<Record<string, number> | { widths?: unknown }>({
      idbKey: appSettingsIdbKey(WIDTHS_DOC),
    }).then((cached) => {
      if (!alive || !cached || isDraggingRef.current) return;
      const rawWidths =
        cached && typeof cached === 'object' && 'widths' in cached
          ? (cached as { widths?: unknown }).widths
          : cached;
      setColWidths(sanitizeColumnWidths(rawWidths));
    });
    return () => {
      alive = false;
    };
  }, []);

  const persistColumnWidthsToDisk = useCallback(
    async (widths: Record<string, number>) => {
      await persistLocalCachedState({
        idbKey: appSettingsIdbKey(WIDTHS_DOC),
        value: widths,
        addToast,
        localContext: 'table column widths',
      });
    },
    [addToast],
  );

  const onMouseDown = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = thRefs.current.get(colKey);
    if (!th) return;
    isDraggingRef.current = true;
    const startWidth = colWidthsRef.current[colKey] ?? th.getBoundingClientRect().width;
    dragRef.current = { colKey, startX: e.clientX, startWidth };

    const applyPendingWidth = () => {
      const p = pendingResizeRef.current;
      if (!p) return;
      setColWidths(prev => {
        if (prev[p.colKey] === p.width) return prev;
        const next = { ...prev, [p.colKey]: p.width };
        colWidthsRef.current = next;
        return next;
      });
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const diff = ev.clientX - dragRef.current.startX;
      const newWidth = clampColWidth(dragRef.current.startWidth + diff);
      const colKey = dragRef.current.colKey;
      pendingResizeRef.current = { colKey, width: newWidth };
      if (rafResizeRef.current != null) return;
      rafResizeRef.current = requestAnimationFrame(() => {
        rafResizeRef.current = null;
        applyPendingWidth();
      });
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      dragRef.current = null;
      if (rafResizeRef.current != null) {
        cancelAnimationFrame(rafResizeRef.current);
        rafResizeRef.current = null;
      }
      applyPendingWidth();
      pendingResizeRef.current = null;

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const latest = colWidthsRef.current;
      if (Object.keys(latest).length > 0) {
        void persistColumnWidthsToDisk(latest).catch(() => {});
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [persistColumnWidthsToDisk]);

  const checkboxColStyle = { width: 48, minWidth: 48 } as const;

  return (
    <>
      <colgroup>
        {showCheckbox && <col style={checkboxColStyle} />}
        {columns.map(col => (
          <col key={col.key} style={colElementStyle(col, colWidths)} />
        ))}
      </colgroup>
      <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7]">
        {/* Header row */}
        <tr>
          {showCheckbox && (
            <th className={`${CELL.headerBase} ${CELL.headerNormal} w-12 text-center`} rowSpan={showFilterRow ? 2 : 1}>
              <input
                type="checkbox"
                className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                checked={!!allChecked}
                onChange={(e) => onCheckAll?.(e.target.checked)}
              />
            </th>
          )}
          {columns.map(col => {
            const isSortable = !!col.sortKey;
            const isCompact = col.textSize === 'text-xs';
            const alignCls = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
            const padCls = isCompact ? CELL.headerCompact : CELL.headerNormal;
            const sortCls = isSortable ? CELL.headerSortable : '';

            return (
              <th
                key={col.key}
                ref={(el) => { if (el) thRefs.current.set(col.key, el); else thRefs.current.delete(col.key); }}
                className={`${CELL.headerBase} ${padCls} ${alignCls} ${sortCls} ${col.textSize || ''} relative box-border min-w-0`}
                onClick={isSortable ? (e) => onSort(col.sortKey!, e.shiftKey) : undefined}
              >
                <div className={`flex items-center min-w-0 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''} gap-1`}>
                  {col.label}
                  {isSortable && <SortIcon columnKey={col.sortKey!} sortKey={sortKey} sortDirection={sortDirection} sortStack={sortStack} />}
                </div>
                {/* Resize handle — right edge of header */}
                <div
                  onMouseDown={(e) => onMouseDown(e, col.key)}
                  className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-indigo-400/40 transition-colors z-20"
                  title="Drag to resize"
                />
              </th>
            );
          })}
        </tr>

        {/* Filter row — widths come from <colgroup>; min-w-0 keeps inputs from overlapping adjacent columns */}
        {showFilterRow && (
          <tr className="bg-zinc-100/50">
            {columns.map(col => {
              // Min/max number filter
              if (col.filterType === 'minmax' && col.filterKey) {
                const pair = getFilterPair(filters, col.filterKey);
                if (!pair) return <td key={col.key} className="px-0.5 py-0.5 min-w-0" />;
                return (
                  <td key={col.key} className="px-0.5 py-0.5 min-w-0 align-top">
                    <div className="flex items-center gap-0.5 min-w-0 max-w-full">
                      <input
                        type="number"
                        placeholder="↓"
                        value={pair.min}
                        onChange={(e) => { pair.setMin(e.target.value); setCurrentPage(1); }}
                        className={`${col.filterWidth || 'w-8'} min-w-0 shrink ${CELL.filterInput}`}
                        title={`Min ${col.label}`}
                      />
                      <input
                        type="number"
                        placeholder="↑"
                        value={pair.max}
                        onChange={(e) => { pair.setMax(e.target.value); setCurrentPage(1); }}
                        className={`${col.filterWidth || 'w-8'} min-w-0 shrink ${CELL.filterInput}`}
                        title={`Max ${col.label}`}
                      />
                    </div>
                  </td>
                );
              }

              // Text filter (city, state)
              if (col.filterType === 'text' && col.filterKey) {
                const tf = getTextFilter(filters, col.filterKey);
                if (!tf) return <td key={col.key} className="px-0.5 py-0.5 min-w-0" />;
                return (
                  <td key={col.key} className="px-1 py-0.5 min-w-0 align-top">
                    <input
                      type="text"
                      placeholder={`🔍 ${col.label.toLowerCase()}...`}
                      value={tf.value}
                      onChange={(e) => { tf.setValue(e.target.value); setCurrentPage(1); }}
                      className={`${col.filterWidth || 'w-20'} w-full min-w-0 max-w-full px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400`}
                    />
                  </td>
                );
              }

              // Label dropdown
              if (col.filterType === 'label-dropdown') {
                return (
                  <td key={col.key} className="px-1 py-0.5 min-w-0 align-top overflow-hidden">
                    <LabelFilterDropdown
                      isOpen={filters.isLabelDropdownOpen}
                      setIsOpen={filters.setIsLabelDropdownOpen}
                      excludedLabels={filters.excludedLabels}
                      setExcludedLabels={filters.setExcludedLabels}
                      setCurrentPage={setCurrentPage}
                      labelCounts={filters.labelCounts}
                    />
                  </td>
                );
              }

              // Empty cell (no filter for this column)
              return <td key={col.key} className="px-0.5 py-0.5 min-w-0" />;
            })}
          </tr>
        )}
      </thead>
    </>
  );
});

TableHeader.displayName = 'TableHeader';
export default TableHeader;
