import { describe, it, expect } from 'vitest';
import { formatStatusBarNow } from './AppStatusBar';

describe('formatStatusBarNow', () => {
  it('returns date and two time lines with Eastern label', () => {
    const labels = formatStatusBarNow(new Date('2025-06-15T17:30:45.000Z'));
    expect(labels.dateLabel.length).toBeGreaterThan(5);
    expect(labels.localLine).toMatch(/^Local:/);
    expect(labels.localLine).toMatch(/\d/);
    expect(labels.easternLine).toMatch(/^US Eastern \(EST\/EDT\):/);
  });
});
