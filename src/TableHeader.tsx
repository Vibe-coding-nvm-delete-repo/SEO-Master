import React, { useCallback, useRef, useState, useEffect } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { ColumnDef } from './tableConstants';
import { CELL } from './tableConstants';
import LabelFilterDropdown from './LabelFilterDropdown';
import { db } from './firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

export interface FilterBag {
  minLen: string; setMinLen: (v: string) => void;
  maxLen: string; setMaxLen: (v: string) => void;
  minKwInCluster: string; setMinKwInCluster: (v: string) => void;
  maxKwInCluster: string; setMaxKwInCluster: (v: string) => void;
  minVolume: string; setMinVolume: (v: string) => void;
  maxVolume: string; setMaxVolume: (v: string) => void;
  minKd: string; setMinKd: (v: string) => void;
  maxKd: string; setMaxKd: (v: string) => void;
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

const WIDTHS_DOC = 'table_column_widths';

// Map filterKey → [getter, setter] pairs in FilterBag
const getFilterPair = (filters: FilterBag, filterKey: string): { min: string; setMin: (v: string) => void; max: string; setMax: (v: string) => void } | null => {
  switch (filterKey) {
    case 'len': return { min: filters.minLen, setMin: filters.setMinLen, max: filters.maxLen, setMax: filters.setMaxLen };
    case 'kws': case 'pages': return { min: filters.minKwInCluster, setMin: filters.setMinKwInCluster, max: filters.maxKwInCluster, setMax: filters.setMaxKwInCluster };
    case 'vol': return { min: filters.minVolume, setMin: filters.setMinVolume, max: filters.maxVolume, setMax: filters.setMaxVolume };
    case 'kd': return { min: filters.minKd, setMin: filters.setMinKd, max: filters.maxKd, setMax: filters.setMaxKd };
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
  const showFilterRow = hasFilters(columns);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{ colKey: string; startX: number; startWidth: number } | null>(null);
  const thRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', WIDTHS_DOC), (snap) => {
      if (!snap.exists()) return;
      const widths = snap.data()?.widths;
      if (widths && typeof widths === 'object') setColWidths(widths as Record<string, number>);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  // Persist on change
  useEffect(() => {
    if (Object.keys(colWidths).length === 0) return;
    setDoc(doc(db, 'app_settings', WIDTHS_DOC), {
      widths: colWidths,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }, [colWidths]);

  const onMouseDown = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = thRefs.current.get(colKey);
    if (!th) return;
    const startWidth = colWidths[colKey] || th.offsetWidth;
    dragRef.current = { colKey, startX: e.clientX, startWidth };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const diff = ev.clientX - dragRef.current.startX;
      const newWidth = Math.max(30, dragRef.current.startWidth + diff);
      setColWidths(prev => ({ ...prev, [dragRef.current!.colKey]: newWidth }));
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

  return (
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
          // Use persisted width if available, otherwise fall back to column def width
          const hasCustomWidth = colWidths[col.key] !== undefined;
          const widthCls = hasCustomWidth ? '' : (col.width || '');
          const sortCls = isSortable ? CELL.headerSortable : '';

          return (
            <th
              key={col.key}
              ref={(el) => { if (el) thRefs.current.set(col.key, el); }}
              className={`${CELL.headerBase} ${padCls} ${alignCls} ${widthCls} ${sortCls} ${col.textSize || ''} relative`}
              style={hasCustomWidth ? { width: colWidths[col.key] } : undefined}
              onClick={isSortable ? (e) => onSort(col.sortKey!, e.shiftKey) : undefined}
            >
              <div className={`flex items-center ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''} gap-1`}>
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

      {/* Filter row */}
      {showFilterRow && (
        <tr className="bg-zinc-100/50">
          {columns.map(col => {
            // Min/max number filter
            if (col.filterType === 'minmax' && col.filterKey) {
              const pair = getFilterPair(filters, col.filterKey);
              if (!pair) return <td key={col.key} className="px-0.5 py-0.5" />;
              return (
                <td key={col.key} className="px-0.5 py-0.5">
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      placeholder="↓"
                      value={pair.min}
                      onChange={(e) => { pair.setMin(e.target.value); setCurrentPage(1); }}
                      className={`${col.filterWidth || 'w-8'} ${CELL.filterInput}`}
                      title={`Min ${col.label}`}
                    />
                    <input
                      type="number"
                      placeholder="↑"
                      value={pair.max}
                      onChange={(e) => { pair.setMax(e.target.value); setCurrentPage(1); }}
                      className={`${col.filterWidth || 'w-8'} ${CELL.filterInput}`}
                      title={`Max ${col.label}`}
                    />
                  </div>
                </td>
              );
            }

            // Text filter (city, state)
            if (col.filterType === 'text' && col.filterKey) {
              const tf = getTextFilter(filters, col.filterKey);
              if (!tf) return <td key={col.key} className="px-0.5 py-0.5" />;
              return (
                <td key={col.key} className="px-1 py-0.5">
                  <input
                    type="text"
                    placeholder={`🔍 ${col.label.toLowerCase()}...`}
                    value={tf.value}
                    onChange={(e) => { tf.setValue(e.target.value); setCurrentPage(1); }}
                    className={`${col.filterWidth || 'w-20'} px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400`}
                  />
                </td>
              );
            }

            // Label dropdown
            if (col.filterType === 'label-dropdown') {
              return (
                <td key={col.key} className="px-1 py-0.5">
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
            return <td key={col.key} className="px-0.5 py-0.5" />;
          })}
        </tr>
      )}
    </thead>
  );
});

TableHeader.displayName = 'TableHeader';
export default TableHeader;
