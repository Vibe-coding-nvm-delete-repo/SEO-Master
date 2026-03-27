export type LeadRank = 1 | 2 | 3 | 4;
export type LeadBand = 'High' | 'Medium' | 'Low';

export interface SeedLoanTopicLeadRow {
  subtopic: string;
  rank: LeadRank;
  leadIntent: LeadBand;
  rationale: string;
}

export interface LoanTopicRow {
  id: string;
  subtopic: string;
  sourceRank: LeadRank;
  leadIntentRank: LeadRank;
  rationale: string;
  seedKeywordsSource: string[];
  seedKeywordsIntent: string[];
  ahrefsLinks: string[];
  notes: string;
  updatedAt: string;
}

export function normalizeRank(n: unknown): LeadRank {
  const v = Number(n);
  if (v === 1 || v === 2 || v === 3 || v === 4) return v;
  return 2;
}

export function leadBandToRank(band: LeadBand): LeadRank {
  if (band === 'High') return 4;
  if (band === 'Medium') return 3;
  return 2;
}

export function toKeywordSlug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function phraseKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(value: string): string[] {
  return phraseKey(value).split(' ').filter(Boolean);
}

function overlapByContainment(a: string, b: string): boolean {
  const ak = phraseKey(a);
  const bk = phraseKey(b);
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  return ak.includes(bk) || bk.includes(ak);
}

export function normalizeSeedKeywords(items: string[]): string[] {
  const unique = Array.from(new Set(items.map((v) => v.trim()).filter(Boolean)));
  const sorted = [...unique].sort((a, b) => tokensOf(b).length - tokensOf(a).length || b.length - a.length);
  const kept: string[] = [];
  for (const cand of sorted) {
    if (kept.some((k) => overlapByContainment(cand, k))) continue;
    kept.push(cand);
  }
  return kept;
}

export function buildSeedKeywords(subtopic: string, type: 'source' | 'intent'): string[] {
  const base = toKeywordSlug(subtopic);
  if (!base) return [];
  if (type === 'source') {
    return normalizeSeedKeywords([
      base,
      `${base} direct lender online`,
      `${base} no credit check guaranteed approval`,
      `${base} same day funding instant decision`,
      `${base} requirements eligibility criteria`,
      `${base} minimum credit score needed`,
      `${base} denial reasons and alternatives`,
      `${base} after bankruptcy or collections`,
      `${base} no cosigner no collateral options`,
      `${base} bad credit low income self employed`,
      `${base} monthly payment calculator`,
      `${base} apr rates and fees comparison`,
      `${base} best lenders by credit score`,
    ]);
  }
  return normalizeSeedKeywords([
    `${base} improve approval odds fast`,
    `${base} credit score needed to qualify`,
    `${base} denied now what next steps`,
    `${base} remove collections before applying`,
    `${base} remove charge offs before applying`,
    `${base} dispute errors before loan application`,
    `${base} how to boost score in 30 days`,
    `${base} how to boost score in 60 days`,
    `${base} how to boost score in 90 days`,
    `${base} high interest rate due to low score`,
    `${base} rapid rescore and credit optimization`,
    `${base} credit repair strategy before approval`,
  ]);
}

export function normalizeStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseListInput(value: string): string[] {
  return normalizeSeedKeywords(value
    .split(/\r?\n|,/g)
    .map((x) => x.trim())
    .filter(Boolean));
}

export function stringifyListInput(items: string[]): string {
  return items.join('\n');
}

export function normalizeSubtopicForMerge(subtopic: string): string {
  return subtopic
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(can i|get|how to|best|options|for|with|after|before|due to|because of|now what|needed|need)\b/g, ' ')
    .replace(/\bloan|loans|financing|credit|score|scores|bad|low|poor\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeStringLists(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b].map((v) => v.trim()).filter(Boolean)));
}

export function consolidateRows(input: LoanTopicRow[]): LoanTopicRow[] {
  const byKey = new Map<string, LoanTopicRow>();
  for (const row of input) {
    const key = normalizeSubtopicForMerge(row.subtopic) || toKeywordSlug(row.subtopic);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const existingAvg = (existing.sourceRank + existing.leadIntentRank) / 2;
    const nextAvg = (row.sourceRank + row.leadIntentRank) / 2;
    const preferred = nextAvg > existingAvg ? row : existing;
    const merged: LoanTopicRow = {
      ...preferred,
      sourceRank: Math.max(existing.sourceRank, row.sourceRank) as LeadRank,
      leadIntentRank: Math.max(existing.leadIntentRank, row.leadIntentRank) as LeadRank,
      rationale: [existing.rationale, row.rationale].filter(Boolean).join(' | '),
      seedKeywordsSource: normalizeSeedKeywords(mergeStringLists(existing.seedKeywordsSource, row.seedKeywordsSource)),
      seedKeywordsIntent: normalizeSeedKeywords(mergeStringLists(existing.seedKeywordsIntent, row.seedKeywordsIntent)),
      ahrefsLinks: mergeStringLists(existing.ahrefsLinks, row.ahrefsLinks),
      notes: [existing.notes, row.notes].filter(Boolean).join('\n'),
      updatedAt: new Date().toISOString(),
    };
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

export function parseTopicRow(raw: unknown): LoanTopicRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const subtopic = typeof row.subtopic === 'string' ? row.subtopic.trim() : '';
  if (!subtopic) return null;
  const sourceRank = normalizeRank(row.sourceRank);
  const leadIntentRank = normalizeRank(row.leadIntentRank);
  const rationale = typeof row.rationale === 'string' ? row.rationale : '';
  const seedKeywordsSource = normalizeStringList(row.seedKeywordsSource);
  const seedKeywordsIntent = normalizeStringList(row.seedKeywordsIntent);
  const ahrefsLinks = normalizeStringList(row.ahrefsLinks);
  const notes = typeof row.notes === 'string' ? row.notes : '';
  const id =
    typeof row.id === 'string' && row.id.trim().length > 0
      ? row.id
      : `loan_topic_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    subtopic,
    sourceRank,
    leadIntentRank,
    rationale,
    seedKeywordsSource: seedKeywordsSource.length > 0 ? normalizeSeedKeywords(seedKeywordsSource) : buildSeedKeywords(subtopic, 'source'),
    seedKeywordsIntent: seedKeywordsIntent.length > 0 ? normalizeSeedKeywords(seedKeywordsIntent) : buildSeedKeywords(subtopic, 'intent'),
    ahrefsLinks,
    notes,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

export function buildDefaultRows(seed: SeedLoanTopicLeadRow[]): LoanTopicRow[] {
  return seed.map((row) => ({
    id: `loan_topic_${row.subtopic.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    subtopic: row.subtopic,
    sourceRank: row.rank,
    leadIntentRank: leadBandToRank(row.leadIntent),
    rationale: row.rationale,
    seedKeywordsSource: buildSeedKeywords(row.subtopic, 'source'),
    seedKeywordsIntent: buildSeedKeywords(row.subtopic, 'intent'),
    ahrefsLinks: [],
    notes: '',
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * When `schemaVersion` matches the app, keep stored rows.
 * On upgrade or missing version, replace with the canonical default set only (drops legacy duplicate rows).
 */
export function resolveLoanTopicsRows(
  existing: LoanTopicRow[] | null | undefined,
  storedVersion: number | undefined,
  seed: SeedLoanTopicLeadRow[],
  schemaVersion: number,
): LoanTopicRow[] {
  if (storedVersion === schemaVersion && existing && existing.length > 0) {
    return existing;
  }
  return buildDefaultRows(seed);
}
