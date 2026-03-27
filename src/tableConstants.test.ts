import { describe, expect, it } from 'vitest';
import {
  GROUPED_COLUMNS,
  GROUPED_TABLE_COL_COUNT,
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
});
