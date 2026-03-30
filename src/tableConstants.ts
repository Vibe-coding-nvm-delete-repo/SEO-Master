// Shared table column definitions — single source of truth for all keyword management tabs
// When changing widths/styles here, all tabs update automatically

export interface ColumnDef {
  key: string;
  label: string;
  sortKey?: string;           // If sortable, which data key to sort by
  align?: 'left' | 'right' | 'center';
  width?: string;             // Tailwind width class
  textSize?: string;          // e.g. 'text-xs' for compact numeric columns
  filterType?: 'minmax' | 'text' | 'label-dropdown' | 'none';
  filterKey?: string;         // Which filter state key this maps to (e.g. 'len', 'vol', 'kd')
  filterWidth?: string;       // Input width class, e.g. 'w-8'
}

// Standardized column widths — name and tokens are equal width
export const COL = {
  checkbox: 'w-10 text-center',
  name: 'w-[27%]',
  tokens: 'w-[27%]',
  keyword: 'w-[18%]',
  status: 'w-[36px]',
  len: 'w-[44px]',
  kws: 'w-[44px]',
  pages: 'w-[44px]',
  vol: 'w-[58px]',
  kd: 'w-[36px]',
  kwRating: 'w-[52px]',
  label: 'w-[72px]',
  city: 'w-[52px]',
  state: 'w-[44px]',
  reason: 'w-[80px]',
} as const;

/**
 * Default `<col>` widths when the user has not set a custom pixel width.
 * Keeps header row, filter row, and body cells aligned under `table-fixed`.
 * Values mirror `COL` (percent vs px); update when adding columns.
 */
export const COLUMN_DEFAULT_WIDTH_CSS: Record<string, string> = {
  name: '27%',
  tokens: '27%',
  keyword: '18%',
  qa: '36px',
  len: '44px',
  kws: '44px',
  pages: '44px',
  vol: '58px',
  kd: '36px',
  kwRating: '52px',
  label: '72px',
  city: '52px',
  state: '44px',
  reason: '80px',
};

// Shared cell classes — all text is 12px for consistency
export const CELL = {
  headerBase: 'py-2 whitespace-nowrap transition-colors select-none text-[12px] overflow-hidden',
  headerSortable: 'cursor-pointer hover:bg-zinc-100',
  headerCompact: 'px-1',                   // Len, KWs, Pages, Vol, KD
  headerNormal: 'px-3',                    // Name, Tokens, Label, City, State
  dataCompact: 'px-1 py-0.5 text-right tabular-nums text-[12px]',  // Len, KWs, Pages, Vol, KD
  dataNormal: 'px-3 py-0.5 text-[12px]',   // Name, Tokens, Keyword, etc.
  /** Label / City / State — explicit 12px so cells do not inherit table `text-sm` (14px) */
  dataLabelLocation: 'px-3 py-0.5 text-[12px] text-zinc-600',
  filterInput: 'px-0.5 py-0.5 text-[11px] border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400',
} as const;

/** Zebra striping: main tbody even rows + expanded child keyword rows (same palette) */
export const TABLE_ZEBRA = {
  /** Expanded child row — 0-based even index (lighter band) */
  childBase: 'bg-white',
  /** Expanded child row — 0-based odd index (alternate stripe) */
  childAlt: 'bg-zinc-100/60',
} as const;

/** Full tbody class so Tailwind JIT sees the nth-child variant (do not split) */
export const TABLE_TBODY_ZEBRA_CLASS = 'divide-y divide-zinc-100 [&>tr:nth-child(even)]:bg-zinc-100/45';

// Labels used across all label filter dropdowns
export const LABEL_LIST = ['Location', 'Number', 'FAQ', 'Commercial', 'Local', 'Year', 'Informational', 'Navigational'] as const;

// --- Column definitions per tab ---

const nameCol = (label: string, sortKey: string): ColumnDef => ({
  key: 'name', label, sortKey, align: 'left', width: COL.name,
});

const tokensCol: ColumnDef = {
  key: 'tokens', label: 'Tokens', sortKey: 'tokens', align: 'left', width: COL.tokens,
};

const numCol = (key: string, label: string, sortKey: string, filterKey: string, filterWidth = 'w-8'): ColumnDef => ({
  key, label, sortKey, align: 'right', filterType: 'minmax', filterKey, filterWidth,
  width: (COL as Record<string, string>)[key] || undefined,
});

const labelCol: ColumnDef = {
  key: 'label', label: 'Label', sortKey: 'label', align: 'left', filterType: 'label-dropdown', width: COL.label,
};

const textFilterCol = (key: string, label: string, sortKey: string, filterKey: string): ColumnDef => ({
  key, label, sortKey, align: 'left', filterType: 'text', filterKey, filterWidth: 'w-full',
  width: (COL as Record<string, string>)[key] || undefined,
});

// Pages (Ungrouped)
export const PAGES_COLUMNS: ColumnDef[] = [
  nameCol('Page Name', 'pageName'),
  tokensCol,
  numCol('len', 'Len', 'pageNameLen', 'len'),
  numCol('kws', 'KWs', 'keywordCount', 'kws'),
  numCol('vol', 'Vol.', 'totalVolume', 'vol', 'w-10'),
  numCol('kd', 'KD', 'avgKd', 'kd'),
  numCol('kwRating', 'Rating', 'avgKwRating', 'kwRating', 'w-9'),
  labelCol,
  textFilterCol('city', 'City', 'locationCity', 'city'),
  textFilterCol('state', 'State', 'locationState', 'state'),
];

/** Checkbox + data columns — expanded detail rows must use this `colSpan` */
export const PAGES_TABLE_COL_COUNT = 1 + PAGES_COLUMNS.length;

// Pages (Grouped) — same as ungrouped but Group Name + QA + Pages column
export const GROUPED_COLUMNS: ColumnDef[] = [
  nameCol('Group Name', 'groupName'),
  tokensCol,
  { key: 'qa', label: 'QA', align: 'center', width: COL.status, filterType: 'none' },
  numCol('len', 'Len', 'pageNameLen', 'len'),
  numCol('pages', 'Pages', 'clusterCount', 'pages'),
  numCol('kws', 'KWs', 'keywordCount', 'kws'),
  numCol('vol', 'Vol.', 'totalVolume', 'vol', 'w-10'),
  numCol('kd', 'KD', 'avgKd', 'kd'),
  numCol('kwRating', 'Rating', 'avgKwRating', 'kwRating', 'w-9'),
  labelCol,
  textFilterCol('city', 'City', 'locationCity', 'city'),
  textFilterCol('state', 'State', 'locationState', 'state'),
];

/** Checkbox + data columns — expanded detail rows must use this `colSpan` */
export const GROUPED_TABLE_COL_COUNT = 1 + GROUPED_COLUMNS.length;

// Pages (Approved) — identical to grouped
export const APPROVED_COLUMNS: ColumnDef[] = [...GROUPED_COLUMNS];

// All Keywords
export const KEYWORDS_COLUMNS: ColumnDef[] = [
  nameCol('Page Name', 'pageName'),
  tokensCol,
  numCol('len', 'Len', 'pageNameLen', 'len'),
  { key: 'keyword', label: 'Keyword', align: 'left', width: COL.keyword },
  numCol('vol', 'Vol.', 'searchVolume', 'vol', 'w-10'),
  numCol('kd', 'KD', 'kd', 'kd'),
  numCol('kwRating', 'Rating', 'kwRating', 'kwRating', 'w-9'),
  labelCol,
  textFilterCol('city', 'City', 'locationCity', 'city'),
  textFilterCol('state', 'State', 'locationState', 'state'),
];

// Blocked — uses same 'name' key so resize widths are shared with other tabs
export const BLOCKED_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Keyword', sortKey: 'keyword', align: 'left', width: COL.name },
  tokensCol,
  numCol('vol', 'Vol.', 'volume', 'vol', 'w-10'),
  numCol('kd', 'KD', 'kd', 'kd'),
  numCol('kwRating', 'Rating', 'kwRating', 'kwRating', 'w-9'),
  { key: 'reason', label: 'Reason', sortKey: 'reason', align: 'left', width: COL.reason },
];
