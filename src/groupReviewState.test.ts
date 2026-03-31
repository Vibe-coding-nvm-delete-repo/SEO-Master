import { describe, expect, it } from 'vitest';
import { healReviewingGroups } from './groupReviewState';
import type { GroupedCluster } from './types';

function makeGroup(id: string, reviewStatus?: GroupedCluster['reviewStatus']): GroupedCluster {
  return {
    id,
    groupName: `Group ${id}`,
    clusters: [],
    totalVolume: 0,
    keywordCount: 0,
    avgKd: null,
    reviewStatus,
  };
}

describe('healReviewingGroups', () => {
  it('returns the original array when nothing is reviewing', () => {
    const groups = [makeGroup('1', 'pending'), makeGroup('2', 'approve')];

    expect(healReviewingGroups(groups)).toBe(groups);
  });

  it('resets reviewing groups back to pending', () => {
    const groups = [makeGroup('1', 'reviewing'), makeGroup('2', 'mismatch')];

    expect(healReviewingGroups(groups)).toEqual([
      makeGroup('1', 'pending'),
      makeGroup('2', 'mismatch'),
    ]);
  });
});
