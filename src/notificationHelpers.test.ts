import { describe, expect, it } from 'vitest';
import {
  buildNotificationCopyText,
  computeNotificationStats,
  filterNotifications,
  formatNotificationEasternTime,
  formatNotificationLocalTime,
  formatRelativeTime,
  humanizeNotification,
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

describe('humanizeNotification', () => {
  it('humanizes auto-synced H2 rows', () => {
    expect(humanizeNotification('Auto-synced 130 H2 rows from upstream step.')).toBe(
      '130 heading outlines were automatically pulled from the previous step.',
    );
  });

  it('humanizes synced rows', () => {
    expect(humanizeNotification('Synced 10 rows from upstream step.')).toBe(
      '10 rows were pulled from the previous step.',
    );
  });

  it('humanizes keyword rating synced', () => {
    expect(
      humanizeNotification('Keyword rating synced: 15 relevant (1), 8 unsure (2), 3 not relevant (3)'),
    ).toBe('Keyword ratings saved \u2014 15 relevant, 8 uncertain, 3 not relevant.');
  });

  it('humanizes auto merge with recommendations', () => {
    expect(humanizeNotification('Auto Merge finished with 5 recommendations.')).toBe(
      'Found 5 groups that could be merged together.',
    );
  });

  it('humanizes auto merge no duplicates', () => {
    expect(
      humanizeNotification('Auto Merge finished. No semantic duplicate recommendations met the current threshold.'),
    ).toBe('No merge candidates found at the current similarity threshold.');
  });

  it('humanizes auto merge cancelled', () => {
    expect(humanizeNotification('Auto Merge cancelled.')).toBe('The merge scan was stopped before finishing.');
  });

  it('humanizes cloud sync failure', () => {
    expect(humanizeNotification('Cloud sync failed (data persistence). Firestore rejected the data payload.')).toBe(
      'Changes couldn\u2019t save to the cloud \u2014 they\u2019re safe locally for now.',
    );
  });

  it('humanizes H2 row reset', () => {
    expect(humanizeNotification('Reset 2 H2 rows for rewrite.')).toBe(
      '2 heading outlines were cleared and queued for regeneration.',
    );
  });

  it('humanizes feedback screenshot failure', () => {
    expect(humanizeNotification('Feedback saved, but screenshot upload failed.')).toBe(
      'Your feedback was saved but the attached image couldn\u2019t upload.',
    );
  });

  it('returns null for unknown messages', () => {
    expect(humanizeNotification('Some unknown message.')).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-03-30T12:00:00.000Z');

  it('returns "just now" for < 1 minute', () => {
    expect(formatRelativeTime('2026-03-30T11:59:30.000Z', now)).toBe('just now');
  });

  it('returns minutes for < 1 hour', () => {
    expect(formatRelativeTime('2026-03-30T11:45:00.000Z', now)).toBe('15m ago');
  });

  it('returns hours for < 1 day', () => {
    expect(formatRelativeTime('2026-03-30T05:00:00.000Z', now)).toBe('7h ago');
  });

  it('returns "yesterday" for 1-2 days', () => {
    expect(formatRelativeTime('2026-03-29T10:00:00.000Z', now)).toBe('yesterday');
  });

  it('returns days for < 7 days', () => {
    expect(formatRelativeTime('2026-03-26T12:00:00.000Z', now)).toBe('4d ago');
  });

  it('returns date for >= 7 days', () => {
    const result = formatRelativeTime('2026-03-01T12:00:00.000Z', now);
    expect(result).toMatch(/Mar/);
  });

  it('returns "just now" for future dates', () => {
    expect(formatRelativeTime('2026-03-30T13:00:00.000Z', now)).toBe('just now');
  });
});

describe('computeNotificationStats', () => {
  it('counts by type', () => {
    const entries: NotificationEntry[] = [
      { ...baseEntry, id: '1', type: 'success' },
      { ...baseEntry, id: '2', type: 'success' },
      { ...baseEntry, id: '3', type: 'error' },
      { ...baseEntry, id: '4', type: 'warning' },
      { ...baseEntry, id: '5', type: 'info' },
      { ...baseEntry, id: '6', type: 'info' },
    ];
    expect(computeNotificationStats(entries)).toEqual({
      success: 2,
      info: 2,
      warning: 1,
      error: 1,
    });
  });

  it('returns zeros for empty array', () => {
    expect(computeNotificationStats([])).toEqual({
      success: 0,
      info: 0,
      warning: 0,
      error: 0,
    });
  });
});
