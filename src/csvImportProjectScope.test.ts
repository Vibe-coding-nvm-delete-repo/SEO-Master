import { describe, expect, it } from 'vitest';
import { csvImportProjectMismatch } from './csvImportProjectScope';

describe('csvImportProjectMismatch', () => {
  it('returns false when current project matches pinned id', () => {
    expect(csvImportProjectMismatch('proj_a', 'proj_a')).toBe(false);
  });

  it('returns true when user switched to another project', () => {
    expect(csvImportProjectMismatch('proj_a', 'proj_b')).toBe(true);
  });

  it('returns true when user cleared active project', () => {
    expect(csvImportProjectMismatch('proj_a', null)).toBe(true);
  });
});
