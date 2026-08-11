import React from 'react';
import { CELL } from './tableConstants';
import type { TokenSummary } from './types';

const TokenRow = React.memo(({ row, selectedTokens, setSelectedTokens, setCurrentPage, switchToPages }: {
  row: TokenSummary;
  selectedTokens: Set<string>;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  switchToPages?: () => void;
}) => (
  <tr className="hover:bg-zinc-50/50 transition-colors">
    <td className="px-3 py-0.5 font-medium text-zinc-700 font-mono text-[12px]">
      <button
        onClick={() => {
          const newTokens = new Set(selectedTokens);
          if (newTokens.has(row.token)) newTokens.delete(row.token);
          else newTokens.add(row.token);
          setSelectedTokens(newTokens);
          setCurrentPage(1);
          // Switch to Pages (Ungrouped) to show filtered results
          if (switchToPages && newTokens.size > 0) switchToPages();
        }}
        className={`${selectedTokens.has(row.token) ? 'bg-purple-100 text-purple-700 font-semibold' : 'hover:text-indigo-600 hover:bg-indigo-50'} px-1 rounded transition-colors`}
        title="Click to filter keyword management by this token"
      >
        {row.token}
      </button>
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.length}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.frequency.toLocaleString()}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.totalVolume.toLocaleString()}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.avgKd !== null ? row.avgKd : '-'}
    </td>
    <td className={CELL.dataLabelLocation}>{row.label}</td>
    <td className={CELL.dataLabelLocation}>{row.locationCity || '-'}</td>
    <td className={CELL.dataLabelLocation}>{row.locationState || '-'}</td>
  </tr>
));

export default TokenRow;
