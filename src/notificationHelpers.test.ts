import { describe, expect, it } from 'vitest';
import {
  buildNotificationCopyText,
  filterNotifications,
  formatNotificationEasternTime,
  formatNotificationLocalTime,
} from './notificationHelpers';
import type { NotificationEntry } from './notificationStorage';

const baseEntry: NotificationEntry = {
  id: 'n1',
  createdAt: '2026-03-30T03:17:13.000Z',
  type: 'error',
  source: 'generate',
  message: 'Cloud sync failed while saving generated rows.',
  copyText: 'Full generated row sync failure details.',
  projectId: 'proj-1',
  projectName: 'Loan Pages',
};

describe('notificationHelpers', () => {
  it('formats local and eastern timestamps', () => {
    expect(formatNotificationLocalTime(baseEntry.createdAt)).toBeTruthy();
    expect(formatNotificationEasternTime(baseEntry.createdAt)).toMatch(/E[SD]T/);
  });

  it('filters by type, source, and search text', () => {
    const other: NotificationEntry = {
      ...baseEntry,
      id: 'n2',
      type: 'success',
      source: 'feedback',
      message: 'Feedback saved.',
      copyText: 'Feedback body here.',
      projectId: null,
      projectName: null,
    };

    expect(filterNotifications([baseEntry, other], 'error', 'all', '').map((entry) => entry.id)).toEqual(['n1']);
    expect(filterNotifications([baseEntry, other], 'all', 'feedback', '').map((entry) => entry.id)).toEqual(['n2']);
    expect(filterNotifications([baseEntry, other], 'all', 'all', 'loan pages').map((entry) => entry.id)).toEqual(['n1']);
    expect(filterNotifications([baseEntry, other], 'all', 'all', 'feedback body').map((entry) => entry.id)).toEqual(['n2']);
  });

  it('builds a full copy payload with fallback metadata', () => {
    const copyText = buildNotificationCopyText(baseEntry);
    expect(copyText).toContain('Type: error');
    expect(copyText).toContain('Source: Generate');
    expect(copyText).toContain('Scope: Loan Pages (proj-1)');
    expect(copyText).toContain('Full generated row sync failure details.');
  });
});
