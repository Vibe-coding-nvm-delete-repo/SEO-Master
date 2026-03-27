import { describe, expect, it } from 'vitest';
import {
  effectiveProjectFolderId,
  newFolderId,
  parseProjectFoldersFromFirestore,
} from './projectFoldersUtils';
import type { Project } from './types';

describe('parseProjectFoldersFromFirestore', () => {
  it('returns sorted folders and skips invalid rows', () => {
    const parsed = parseProjectFoldersFromFirestore([
      { id: 'a', name: 'Z', order: 2 },
      { id: 'b', name: 'A', order: 1 },
      { id: '', name: 'x', order: 0 },
      'bad',
    ]);
    expect(parsed.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('returns empty for non-array', () => {
    expect(parseProjectFoldersFromFirestore(null)).toEqual([]);
  });
});

describe('effectiveProjectFolderId', () => {
  it('returns null when folder id is unknown', () => {
    const p = { id: 'p1' } as Project;
    expect(effectiveProjectFolderId(p, new Set(['x']))).toBe(null);
  });

  it('returns folder id when valid', () => {
    const p = { id: 'p1', folderId: 'x' } as Project;
    expect(effectiveProjectFolderId(p, new Set(['x']))).toBe('x');
  });
});

describe('newFolderId', () => {
  it('starts with fld_', () => {
    expect(newFolderId().startsWith('fld_')).toBe(true);
  });
});
