import { describe, expect, it } from 'vitest';
import { isUsableActiveProjectId } from './projectLifecyclePolicy';
import type { Project } from './types';

function p(id: string, deletedAt?: string | null): Project {
  return {
    id,
    name: 'n',
    description: '',
    createdAt: '2020-01-01T00:00:00.000Z',
    uid: 'u',
    deletedAt: deletedAt ?? undefined,
  };
}

describe('isUsableActiveProjectId', () => {
  it('returns false for missing id', () => {
    expect(isUsableActiveProjectId(null, [p('a')])).toBe(false);
    expect(isUsableActiveProjectId(undefined, [p('a')])).toBe(false);
    expect(isUsableActiveProjectId('', [p('a')])).toBe(false);
  });

  it('returns false when project is soft-deleted', () => {
    const list = [p('x', '2020-02-01T00:00:00.000Z')];
    expect(isUsableActiveProjectId('x', list)).toBe(false);
  });

  it('returns true for active project', () => {
    const list = [p('x'), p('y')];
    expect(isUsableActiveProjectId('x', list)).toBe(true);
  });
});
