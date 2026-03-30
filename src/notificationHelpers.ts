import type { NotificationEntry, NotificationSource, NotificationType } from './notificationStorage';

export type NotificationTypeFilter = 'all' | NotificationType;
export type NotificationSourceFilter = 'all' | NotificationSource;

const EASTERN_TZ = 'America/New_York';

export const NOTIFICATION_SOURCE_LABELS: Record<NotificationSource, string> = {
  group: 'Group',
  generate: 'Generate',
  content: 'Content',
  feedback: 'Feedback',
  projects: 'Projects',
  settings: 'Settings',
  system: 'System',
};

export function formatNotificationLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export function formatNotificationEasternTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: EASTERN_TZ,
    timeZoneName: 'short',
  }).format(date);
}

export function filterNotifications(
  entries: NotificationEntry[],
  typeFilter: NotificationTypeFilter,
  sourceFilter: NotificationSourceFilter,
  searchText: string,
): NotificationEntry[] {
  const needle = searchText.trim().toLowerCase();
  return entries.filter((entry) => {
    if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
    if (!needle) return true;
    const haystack = [
      entry.message,
      entry.copyText,
      entry.projectName ?? '',
      entry.projectId ?? '',
      NOTIFICATION_SOURCE_LABELS[entry.source],
      entry.source,
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/* ------------------------------------------------------------------ */
/*  Humanized descriptions                                            */
/* ------------------------------------------------------------------ */

type HumanizeRule = { pattern: RegExp; humanize: (m: RegExpMatchArray) => string };

const HUMANIZE_RULES: HumanizeRule[] = [
  {
    pattern: /^Auto-synced (\d+) H2 rows? from upstream step\.?$/i,
    humanize: (m) => `${m[1]} heading outlines were automatically pulled from the previous step.`,
  },
  {
    pattern: /^Synced (\d+) rows? from upstream step\.?$/i,
    humanize: (m) => `${m[1]} rows were pulled from the previous step.`,
  },
  {
    pattern: /^Keyword rating synced:\s*(\d+)\s*relevant\s*\(1\),?\s*(\d+)\s*unsure\s*\(2\),?\s*(\d+)\s*not relevant\s*\(3\)$/i,
    humanize: (m) => `Keyword ratings saved \u2014 ${m[1]} relevant, ${m[2]} uncertain, ${m[3]} not relevant.`,
  },
  {
    pattern: /^Keyword rating complete locally, but cloud sync failed/i,
    humanize: () => 'Ratings saved on this device but couldn\u2019t sync to the cloud. Check Cloud status.',
  },
  {
    pattern: /^Auto Merge finished with (\d+) recommendations?\.?$/i,
    humanize: (m) => `Found ${m[1]} groups that could be merged together.`,
  },
  {
    pattern: /^Auto Merge finished\.\s*No semantic duplicate/i,
    humanize: () => 'No merge candidates found at the current similarity threshold.',
  },
  {
    pattern: /^Auto Merge finished, but grouped data changed/i,
    humanize: () => 'Groups changed while merging was running \u2014 results may be outdated. Run Embed again.',
  },
  {
    pattern: /^Auto Merge cancelled\.?$/i,
    humanize: () => 'The merge scan was stopped before finishing.',
  },
  {
    pattern: /^Cloud sync failed \(data persistence\)/i,
    humanize: () => 'Changes couldn\u2019t save to the cloud \u2014 they\u2019re safe locally for now.',
  },
  {
    pattern: /^Local save failed \(workspace cache\)/i,
    humanize: () => 'Local cache write failed \u2014 a refresh may lose your latest changes.',
  },
  {
    pattern: /^Reset (\d+) H2 rows? for rewrite\.?$/i,
    humanize: (m) => `${m[1]} heading outlines were cleared and queued for regeneration.`,
  },
  {
    pattern: /^Feedback saved, but screenshot upload failed\.?$/i,
    humanize: () => 'Your feedback was saved but the attached image couldn\u2019t upload.',
  },
  {
    pattern: /^Could not save feedback/i,
    humanize: () => 'Feedback failed to save \u2014 please try again.',
  },
  {
    pattern: /^Thanks .* feedback saved!?$/i,
    humanize: () => 'Your feedback was submitted successfully.',
  },
  {
    pattern: /^No data found in upstream step\.?$/i,
    humanize: () => 'The previous workflow step has no data to pull from yet.',
  },
  {
    pattern: /^Upstream sync failed/i,
    humanize: () => 'Couldn\u2019t pull data from the previous step \u2014 it may still be processing.',
  },
];

export function humanizeNotification(message: string): string | null {
  for (const rule of HUMANIZE_RULES) {
    const m = message.match(rule.pattern);
    if (m) return rule.humanize(m);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Relative timestamps                                               */
/* ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function formatRelativeTime(iso: string, now?: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const ref = now ?? new Date();
  const diff = ref.getTime() - date.getTime();
  if (diff < 0) return 'just now';
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

/* ------------------------------------------------------------------ */
/*  Summary stats                                                     */
/* ------------------------------------------------------------------ */

export interface NotificationStats {
  success: number;
  info: number;
  warning: number;
  error: number;
}

export function computeNotificationStats(entries: NotificationEntry[]): NotificationStats {
  const stats: NotificationStats = { success: 0, info: 0, warning: 0, error: 0 };
  for (const e of entries) {
    if (e.type in stats) stats[e.type]++;
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/*  Copy text builder                                                 */
/* ------------------------------------------------------------------ */

export function buildNotificationCopyText(entry: NotificationEntry): string {
  const sourceLabel = NOTIFICATION_SOURCE_LABELS[entry.source];
  const scopeLabel = entry.projectName || entry.projectId
    ? `${entry.projectName || 'Unnamed project'}${entry.projectId ? ` (${entry.projectId})` : ''}`
    : 'Global';
  return [
    `Type: ${entry.type}`,
    `Source: ${sourceLabel}`,
    `Scope: ${scopeLabel}`,
    `Created (local): ${formatNotificationLocalTime(entry.createdAt)}`,
    `Created (US Eastern): ${formatNotificationEasternTime(entry.createdAt)}`,
    '',
    'Notification:',
    entry.copyText || entry.message,
  ].join('\n');
}
