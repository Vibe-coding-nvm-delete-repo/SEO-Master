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
