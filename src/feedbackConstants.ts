/** Max screenshots per feedback item (Firebase Storage + Firestore). */
export const FEEDBACK_MAX_ATTACHMENTS = 3;
/** Per-image size limit before upload (bytes). */
export const FEEDBACK_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export function isAcceptableFeedbackImage(file: File): boolean {
  if (file.size > FEEDBACK_MAX_IMAGE_BYTES) return false;
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(file.name);
}

/** Bug / issue severity (1–4): how disruptive the problem is. */
export const BUG_SEVERITY_LABELS: Record<1 | 2 | 3 | 4, { short: string; hint: string }> = {
  1: { short: 'Minor', hint: 'Cosmetic, typo, or tiny annoyance; easy workaround.' },
  2: { short: 'Moderate', hint: 'Noticeable bug or friction; occasional impact.' },
  3: { short: 'Major', hint: 'Blocks important workflow or happens often.' },
  4: { short: 'Critical', hint: 'App unusable, data at risk, or show-stopper.' },
};

/** Feature importance / impact (1–4): how valuable the change would be. */
export const FEATURE_IMPACT_LABELS: Record<1 | 2 | 3 | 4, { short: string; hint: string }> = {
  1: { short: 'Low', hint: 'Nice-to-have polish or small quality-of-life.' },
  2: { short: 'Medium', hint: 'Would help regularly; meaningful improvement.' },
  3: { short: 'High', hint: 'Important for core workflows or many users.' },
  4: { short: 'Critical', hint: 'Strategic, must-have, or large user impact.' },
};

/**
 * Where in the app the feedback applies (dropdown value). Stored as the sole `tags[]` entry.
 * Grouped for the UI optgroups — mirrors main tabs, Group sub-tabs, Settings segments, Generate.
 */
export const FEEDBACK_AREA_GROUPS: { groupLabel: string; areas: { id: string; label: string }[] }[] = [
  {
    groupLabel: 'Group — Projects & data',
    areas: [
      { id: 'group-projects', label: 'Projects (list, open, create)' },
      { id: 'group-data', label: 'Data (keyword table, CSV, grouping, review)' },
    ],
  },
  {
    groupLabel: 'Group — Settings',
    areas: [
      { id: 'group-settings-general', label: 'Settings → General' },
      { id: 'group-settings-how-it-works', label: 'Settings → How it works' },
      { id: 'group-settings-dictionaries', label: 'Settings → Dictionaries' },
      { id: 'group-settings-blocked', label: 'Settings → Blocked keywords' },
    ],
  },
  {
    groupLabel: 'Group — Other',
    areas: [{ id: 'group-log', label: 'Activity log' }],
  },
  {
    groupLabel: 'Generate',
    areas: [
      { id: 'generate-tab-1', label: 'Generate → Generate 1' },
      { id: 'generate-tab-2', label: 'Generate → Generate 2' },
    ],
  },
  {
    groupLabel: 'Feedback & app chrome',
    areas: [
      { id: 'feedback-queue', label: 'Feedback tab (this queue)' },
      { id: 'header-nav', label: 'Header, tabs, breadcrumbs, address bar' },
    ],
  },
  {
    groupLabel: 'Cross-cutting',
    areas: [
      { id: 'sync-persistence', label: 'Save, sync, projects (cloud / IndexedDB)' },
      { id: 'other', label: 'Other / not sure' },
    ],
  },
];

const AREA_LABEL_CACHE = new Map<string, string>();
for (const g of FEEDBACK_AREA_GROUPS) {
  for (const a of g.areas) {
    AREA_LABEL_CACHE.set(a.id, a.label);
  }
}

export function getFeedbackAreaLabel(areaId: string): string {
  return AREA_LABEL_CACHE.get(areaId) ?? areaId;
}

/** Visual ramp for severity / impact (1 = calm → 4 = urgent). */
export const FEEDBACK_RATING_LEVEL_STYLES: Record<
  1 | 2 | 3 | 4,
  { selected: string; unselected: string }
> = {
  1: {
    selected: 'border-emerald-500 bg-emerald-50 text-emerald-950 shadow-sm ring-2 ring-emerald-300/80',
    unselected: 'border-emerald-200/80 bg-white text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50/40',
  },
  2: {
    selected: 'border-amber-500 bg-amber-50 text-amber-950 shadow-sm ring-2 ring-amber-300/80',
    unselected: 'border-amber-200/80 bg-white text-zinc-700 hover:border-amber-300 hover:bg-amber-50/40',
  },
  3: {
    selected: 'border-orange-500 bg-orange-50 text-orange-950 shadow-sm ring-2 ring-orange-400/70',
    unselected: 'border-orange-200/80 bg-white text-zinc-700 hover:border-orange-300 hover:bg-orange-50/40',
  },
  4: {
    selected: 'border-red-600 bg-red-50 text-red-950 shadow-sm ring-2 ring-red-400/80',
    unselected: 'border-red-200/80 bg-white text-zinc-700 hover:border-red-300 hover:bg-red-50/40',
  },
};

export function composeIssueFeedbackBody(
  areaId: string,
  fields: { tryingTo: string; whatHappened: string; expected: string; steps: string },
): string {
  const areaLabel = getFeedbackAreaLabel(areaId);
  const parts: string[] = [
    `Area: ${areaLabel}`,
    '',
    `What were you trying to do?\n${fields.tryingTo.trim()}`,
    '',
    `What went wrong?\n${fields.whatHappened.trim()}`,
  ];
  if (fields.expected.trim()) {
    parts.push('', `What did you expect instead?\n${fields.expected.trim()}`);
  }
  if (fields.steps.trim()) {
    parts.push('', `Steps to reproduce:\n${fields.steps.trim()}`);
  }
  return parts.join('\n');
}

export function composeFeatureFeedbackBody(
  areaId: string,
  fields: { need: string; idea: string; extra: string },
): string {
  const areaLabel = getFeedbackAreaLabel(areaId);
  const parts = [
    `Area: ${areaLabel}`,
    '',
    `What problem or need does this address?\n${fields.need.trim()}`,
    '',
    `Describe the idea or change:\n${fields.idea.trim()}`,
  ];
  if (fields.extra.trim()) {
    parts.push('', `Anything else we should know?\n${fields.extra.trim()}`);
  }
  return parts.join('\n');
}

/** Legacy: comma-separated tags from older UI — kept for tests / any migration. */
export function normalizeFeedbackTags(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .slice(0, 12)
    .map((t) => (t.length > 32 ? t.slice(0, 32) : t));
}
