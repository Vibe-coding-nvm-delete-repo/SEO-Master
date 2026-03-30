import { describe, expect, it } from 'vitest';
import {
  BLOCKED_COLUMNS,
  COLUMN_DEFAULT_WIDTH_CSS,
  GROUPED_COLUMNS,
  GROUPED_TABLE_COL_COUNT,
  KEYWORDS_COLUMNS,
  PAGES_COLUMNS,
  PAGES_TABLE_COL_COUNT,
} from './tableConstants';

describe('tableConstants', () => {
  it('detail row colSpan helpers match checkbox + column defs (expanded rows must span full table width)', () => {
    expect(PAGES_TABLE_COL_COUNT).toBe(1 + PAGES_COLUMNS.length);
    expect(GROUPED_TABLE_COL_COUNT).toBe(1 + GROUPED_COLUMNS.length);
    expect(PAGES_TABLE_COL_COUNT).toBe(11);
    expect(GROUPED_TABLE_COL_COUNT).toBe(13);
  });

  it('COLUMN_DEFAULT_WIDTH_CSS has a default for every column key used in tab column defs', () => {
    const keys = new Set<string>();
    for (const c of [...PAGES_COLUMNS, ...GROUPED_COLUMNS, ...KEYWORDS_COLUMNS, ...BLOCKED_COLUMNS]) {
      keys.add(c.key);
    }
    for (const k of keys) {
      expect(COLUMN_DEFAULT_WIDTH_CSS[k], `add COLUMN_DEFAULT_WIDTH_CSS["${k}"]`).toBeDefined();
    }
  });
});
