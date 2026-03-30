import type { CSSProperties } from 'react';
import type { ColumnDef } from './tableConstants';
import { COLUMN_DEFAULT_WIDTH_CSS } from './tableConstants';

/** Minimum width (px) for a resizable column — keeps min/max filter inputs usable */
export const COL_WIDTH_MIN_PX = 30;

/** Hard cap (px) when `window` is unavailable (SSR / tests) */
export const COL_WIDTH_MAX_PX_CAP = 1200;

export function getColumnMaxPxForViewport(): number {
  if (typeof window === 'undefined') return COL_WIDTH_MAX_PX_CAP;
  return Math.min(COL_WIDTH_MAX_PX_CAP, Math.max(240, Math.floor(window.innerWidth * 0.92)));
}

/**
 * Clamp a user-resized column width so extreme drags cannot blow up layout or filters.
 * @param maxPx — optional override for tests or fixed layout
 */
export function clampColWidth(px: number, maxPx: number = getColumnMaxPxForViewport()): number {
  if (!Number.isFinite(px)) return COL_WIDTH_MIN_PX;
  return Math.max(COL_WIDTH_MIN_PX, Math.min(maxPx, Math.round(px)));
}

/** Normalize Firestore / snapshot payloads */
export function sanitizeColumnWidths(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  const maxPx = getColumnMaxPxForViewport();
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (!Number.isFinite(n)) continue;
    out[k] = clampColWidth(n, maxPx);
  }
  return out;
}

/** `<col>` style: custom px width or default CSS width string from {@link COLUMN_DEFAULT_WIDTH_CSS} */
export function colElementStyle(col: ColumnDef, colWidths: Record<string, number>): CSSProperties {
  const custom = colWidths[col.key];
  if (custom !== undefined) {
    const w = clampColWidth(custom);
    const maxPx = getColumnMaxPxForViewport();
    return {
      width: w,
      minWidth: COL_WIDTH_MIN_PX,
      maxWidth: maxPx,
    };
  }
  const def = COLUMN_DEFAULT_WIDTH_CSS[col.key];
  if (def) {
    return { width: def, minWidth: 0 };
  }
  return { minWidth: 0 };
}
