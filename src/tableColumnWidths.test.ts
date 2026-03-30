import { describe, it, expect } from 'vitest';
import {
  clampColWidth,
  sanitizeColumnWidths,
  colElementStyle,
  COL_WIDTH_MIN_PX,
  COL_WIDTH_MAX_PX_CAP,
} from './tableColumnWidths';
import type { ColumnDef } from './tableConstants';

describe('clampColWidth', () => {
  it('enforces minimum', () => {
    expect(clampColWidth(5, 500)).toBe(COL_WIDTH_MIN_PX);
  });

  it('respects max override', () => {
    expect(clampColWidth(9999, 400)).toBe(400);
  });

  it('caps at explicit max argument', () => {
    expect(clampColWidth(5000, COL_WIDTH_MAX_PX_CAP)).toBe(COL_WIDTH_MAX_PX_CAP);
  });

  it('rounds finite values', () => {
    expect(clampColWidth(100.6, 500)).toBe(101);
  });

  it('handles NaN as minimum', () => {
    expect(clampColWidth(Number.NaN, 500)).toBe(COL_WIDTH_MIN_PX);
  });
});

describe('sanitizeColumnWidths', () => {
  it('drops invalid entries and clamps numbers', () => {
    const out = sanitizeColumnWidths({
      len: 12,
      bad: 'x',
      vol: '500',
      n: Number.NaN,
    });
    expect(out.len).toBe(COL_WIDTH_MIN_PX);
    expect(out.vol).toBe(500);
    expect(out.bad).toBeUndefined();
    expect(out.n).toBeUndefined();
  });

  it('returns empty for non-objects', () => {
    expect(sanitizeColumnWidths(null)).toEqual({});
    expect(sanitizeColumnWidths('x')).toEqual({});
  });
});

describe('colElementStyle', () => {
  const nameCol = (key: string): ColumnDef => ({
    key,
    label: 'L',
    sortKey: key,
    align: 'left',
  });

  it('uses custom px width when set', () => {
    const s = colElementStyle(nameCol('len'), { len: 200 });
    expect(s.width).toBe(200);
    expect(s.minWidth).toBe(COL_WIDTH_MIN_PX);
    expect(typeof s.maxWidth).toBe('number');
  });

  it('falls back to default CSS width for known keys', () => {
    const s = colElementStyle(nameCol('name'), {});
    expect(s.width).toBe('27%');
  });
});
