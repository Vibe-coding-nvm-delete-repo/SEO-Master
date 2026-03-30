import React from 'react';
import { CELL } from './tableConstants';

/** Single-cell display for aggregate or per-keyword relevance (1–3) */
const KwRatingCell = React.memo(({ value }: { value: number | null | undefined }) => (
  <td className={CELL.dataCompact}>
    {value != null ? (
      <span
        className={`inline-flex min-w-[1.5rem] justify-center px-1 py-0.5 rounded text-[11px] font-semibold tabular-nums border ${
          value === 1
            ? 'bg-emerald-100/90 text-emerald-900 border-emerald-200/80'
            : value === 2
              ? 'bg-amber-100/90 text-amber-950 border-amber-200/70'
              : 'bg-rose-100/90 text-rose-900 border-rose-200/70'
        }`}
      >
        {value}
      </span>
    ) : (
      <span className="text-zinc-300">—</span>
    )}
  </td>
));

export default KwRatingCell;
