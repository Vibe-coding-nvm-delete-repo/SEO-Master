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
  label: 'w-[72px]',
  city: 'w-[52px]',
  state: 'w-[44px]',
  reason: 'w-[80px]',
} as const;

// Shared cell classes — all text is 12px for consistency
export const CELL = {
  headerBase: 'py-2 whitespace-nowrap transition-colors select-none text-[12px]',
  headerSortable: 'cursor-pointer hover:bg-zinc-100',
  headerCompact: 'px-1',                   // Len, KWs, Pages, Vol, KD
  headerNormal: 'px-3',                    // Name, Tokens, Label, City, State
  dataCompact: 'px-1 py-0.5 text-right tabular-nums text-[12px]',  // Len, KWs, Pages, Vol, KD
  dataNormal: 'px-3 py-0.5 text-[12px]',   // Name, Tokens, Label, City, State
  filterInput: 'px-0.5 py-0.5 text-[11px] border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400',
} as const;

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
  labelCol,
  textFilterCol('city', 'City', 'locationCity', 'city'),
  textFilterCol('state', 'State', 'locationState', 'state'),
];

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
  labelCol,
  textFilterCol('city', 'City', 'locationCity', 'city'),
  textFilterCol('state', 'State', 'locationState', 'state'),
];

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
  { key: 'reason', label: 'Reason', sortKey: 'reason', align: 'left', width: COL.reason },
];
