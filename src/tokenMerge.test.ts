import { describe, it, expect } from 'vitest';
import {
  mergeTokenArr,
  computeSignature,
  applyMergeToRows,
  rebuildClusters,
  updateGroupsAfterMerge,
  refreshGroupsFromClusterSummaries,
  updateApprovedAfterMerge,
  handleCrossGroupConflict,
  rebuildTokenSummary,
  computeMergeImpact,
  applyMergeRulesToTokenArr,
  executeMergeCascade,
} from './tokenMerge';
import type { ProcessedRow, ClusterSummary, GroupedCluster } from './types';

// Helper to create a minimal ProcessedRow
function makeRow(keyword: string, tokens: string[], volume: number, kd: number | null = null): ProcessedRow {
  return {
    pageName: keyword, pageNameLower: keyword.toLowerCase(), pageNameLen: keyword.length,
    tokens: tokens.sort().join(' '), tokenArr: tokens.sort(),
    keyword, keywordLower: keyword.toLowerCase(), searchVolume: volume, kd,
    label: '', labelArr: [], locationCity: null, locationState: null,
  };
}

// Helper to create a minimal ClusterSummary
function makeCluster(pageName: string, tokens: string[], volume: number, kwCount: number = 1): ClusterSummary {
  return {
    pageName, pageNameLower: pageName.toLowerCase(), pageNameLen: pageName.length,
    tokens: tokens.sort().join(' '), tokenArr: tokens.sort(),
    keywordCount: kwCount, totalVolume: volume, avgKd: null, avgKwRating: null,
    label: '', labelArr: [], locationCity: null, locationState: null,
    keywords: [{ keyword: pageName, volume, kd: null, locationCity: null, locationState: null }],
  };
}

// Helper to create a minimal GroupedCluster
function makeGroup(name: string, clusters: ClusterSummary[]): GroupedCluster {
  return {
    id: `${name}-1`, groupName: name, clusters,
    totalVolume: clusters.reduce((s, c) => s + c.totalVolume, 0),
    keywordCount: clusters.reduce((s, c) => s + c.keywordCount, 0),
    avgKd: null,
    avgKwRating: null,
  };
}

describe('mergeTokenArr', () => {
  it('should replace child tokens with parent', () => {
    expect(mergeTokenArr(['automobile', 'best', 'insurance'], 'car', ['automobile'])).toEqual(['best', 'car', 'insurance']);
  });

  it('should deduplicate when parent already exists', () => {
    expect(mergeTokenArr(['car', 'fast', 'vehicle'], 'car', ['vehicle'])).toEqual(['car', 'fast']);
  });

  it('should handle multiple children', () => {
    expect(mergeTokenArr(['automobile', 'fast', 'vehicle'], 'car', ['automobile', 'vehicle'])).toEqual(['car', 'fast']);
  });

  it('should return sorted array', () => {
    expect(mergeTokenArr(['zebra', 'automobile'], 'car', ['automobile'])).toEqual(['car', 'zebra']);
  });
});

describe('applyMergeToRows', () => {
  it('should update affected rows and store originalTokenArr', () => {
    const rows = [
      makeRow('best automobile insurance', ['automobile', 'best', 'insurance'], 1000),
      makeRow('fast car', ['car', 'fast'], 500),
    ];

    const { updatedResults, signatureMap } = applyMergeToRows(rows, 'car', ['automobile']);

    // First row should be updated
    expect(updatedResults[0].tokenArr).toEqual(['best', 'car', 'insurance']);
    expect(updatedResults[0].tokens).toBe('best car insurance');
    expect(updatedResults[0].originalTokenArr).toEqual(['automobile', 'best', 'insurance']);

    // Second row unchanged
    expect(updatedResults[1].tokenArr).toEqual(['car', 'fast']);
    expect(updatedResults[1].originalTokenArr).toBeUndefined();

    // Signature map tracks the change
    expect(signatureMap.get('automobile best insurance')).toBe('best car insurance');
  });
});

describe('rebuildClusters', () => {
  it('should merge rows with same signature into one cluster', () => {
    const rows = [
      makeRow('best car insurance', ['best', 'car', 'insurance'], 1000),
      makeRow('best automobile insurance', ['best', 'car', 'insurance'], 500), // Same sig after merge
    ];

    const clusters = rebuildClusters(rows);
    expect(clusters.length).toBe(1);
    expect(clusters[0].pageName).toBe('best car insurance'); // Higher volume wins
    expect(clusters[0].totalVolume).toBe(1500);
    expect(clusters[0].keywordCount).toBe(2);
  });

  it('should keep separate clusters for different signatures', () => {
    const rows = [
      makeRow('best car', ['best', 'car'], 1000),
      makeRow('fast car', ['car', 'fast'], 500),
    ];

    const clusters = rebuildClusters(rows);
    expect(clusters.length).toBe(2);
  });
});

describe('refreshGroupsFromClusterSummaries', () => {
  it('should replace cluster refs and recalc group avgKwRating', () => {
    const c1 = makeCluster('page a', ['a', 'b'], 100, 2);
    const c2 = { ...c1, avgKwRating: 2 as number | null };
    const g = makeGroup('G', [c1]);
    const rebuilt = [c2];
    const { groupedClusters } = refreshGroupsFromClusterSummaries([g], [], rebuilt);
    expect(groupedClusters[0].clusters[0].avgKwRating).toBe(2);
    expect(groupedClusters[0].avgKwRating).toBe(2);
  });
});

describe('updateGroupsAfterMerge', () => {
  it('should update group clusters with new signatures', () => {
    const oldCluster = makeCluster('best automobile', ['automobile', 'best'], 1000);
    const newCluster = makeCluster('best car', ['best', 'car'], 1500);
    const group = makeGroup('insurance', [oldCluster]);

    const sigMap = new Map([['automobile best', 'best car']]);
    const clusterMap = new Map([['best car', newCluster]]);

    const { updatedGroups, emptyGroupNames } = updateGroupsAfterMerge([group], sigMap, clusterMap);

    expect(updatedGroups.length).toBe(1);
    expect(updatedGroups[0].clusters[0].tokens).toBe('best car');
    expect(updatedGroups[0].totalVolume).toBe(1500);
    expect(emptyGroupNames.length).toBe(0);
  });

  it('should deduplicate within a group when two clusters merge to same signature', () => {
    const cluster1 = makeCluster('best automobile', ['automobile', 'best'], 1000);
    const cluster2 = makeCluster('best car', ['best', 'car'], 500);
    const group = makeGroup('vehicles', [cluster1, cluster2]);

    const sigMap = new Map([['automobile best', 'best car']]);
    const mergedCluster = makeCluster('best car', ['best', 'car'], 1500, 2);
    const clusterMap = new Map([['best car', mergedCluster]]);

    const { updatedGroups } = updateGroupsAfterMerge([group], sigMap, clusterMap);

    expect(updatedGroups[0].clusters.length).toBe(1); // Deduplicated
  });

  it('should handle group where all clusters merge into another group', () => {
    // Group has one cluster that merges to a new signature
    const cluster = makeCluster('best automobile', ['automobile', 'best'], 1000);
    const group = makeGroup('test-group', [cluster]);

    const newCluster = makeCluster('best car', ['best', 'car'], 1500);
    const sigMap = new Map([['automobile best', 'best car']]);
    const clusterMap = new Map([['best car', newCluster]]);

    const { updatedGroups } = updateGroupsAfterMerge([group], sigMap, clusterMap);

    // Group should still exist with the new cluster
    expect(updatedGroups.length).toBe(1);
    expect(updatedGroups[0].clusters[0].tokens).toBe('best car');
  });
});

describe('updateApprovedAfterMerge', () => {
  it('should return affected approved groups for unapproval', () => {
    const cluster = makeCluster('best automobile', ['automobile', 'best'], 1000);
    const approved = makeGroup('approved-group', [cluster]);

    const newCluster = makeCluster('best car', ['best', 'car'], 1000);
    const sigMap = new Map([['automobile best', 'best car']]);
    const clusterMap = new Map([['best car', newCluster]]);

    const { unaffected, affected } = updateApprovedAfterMerge([approved], sigMap, clusterMap);

    expect(unaffected.length).toBe(0);
    expect(affected.length).toBe(1);
    expect(affected[0].mergeAffected).toBe(true);
    expect(affected[0].reviewStatus).toBeUndefined();
  });

  it('should leave unaffected approved groups alone', () => {
    const cluster = makeCluster('unrelated', ['other', 'tokens'], 500);
    const approved = makeGroup('safe-group', [cluster]);

    const sigMap = new Map([['automobile best', 'best car']]);
    const clusterMap = new Map<string, ClusterSummary>();

    const { unaffected, affected } = updateApprovedAfterMerge([approved], sigMap, clusterMap);

    expect(unaffected.length).toBe(1);
    expect(affected.length).toBe(0);
  });
});

describe('handleCrossGroupConflict', () => {
  it('should keep page in group with higher total volume', () => {
    const sharedCluster = makeCluster('shared page', ['car', 'fast'], 500);
    const bigGroup = makeGroup('big', [sharedCluster, makeCluster('extra', ['extra'], 2000)]);
    const smallGroup = makeGroup('small', [sharedCluster]);

    // Recalc totals
    bigGroup.totalVolume = 2500;
    smallGroup.totalVolume = 500;

    const result = handleCrossGroupConflict([bigGroup, smallGroup]);

    // Big group keeps the shared page, small group loses it
    const bigResult = result.find(g => g.groupName === 'big');
    const smallResult = result.find(g => g.groupName === 'small');

    expect(bigResult?.clusters.some(c => c.tokens === 'car fast')).toBe(true);
    // Small group either has no clusters (removed) or doesn't have the shared one
    if (smallResult) {
      expect(smallResult.clusters.some(c => c.tokens === 'car fast')).toBe(false);
    }
  });
});

describe('computeMergeImpact', () => {
  it('should correctly count affected pages and groups', () => {
    const rows = [
      makeRow('best automobile', ['automobile', 'best'], 1000),
      makeRow('fast vehicle', ['fast', 'vehicle'], 500),
      makeRow('cheap car', ['car', 'cheap'], 200),
    ];

    const cluster1 = makeCluster('best automobile', ['automobile', 'best'], 1000);
    const group = makeGroup('test', [cluster1]);

    const impact = computeMergeImpact(rows, [group], [], 'car', ['automobile', 'vehicle']);

    expect(impact.pagesAffected).toBe(2); // automobile and vehicle rows
    expect(impact.groupsAffected).toBe(1); // group contains automobile cluster
    expect(impact.approvedGroupsAffected).toBe(0);
  });
});

describe('applyMergeRulesToTokenArr', () => {
  it('should apply single rule', () => {
    const result = applyMergeRulesToTokenArr(
      ['automobile', 'best'],
      [{ id: '1', parentToken: 'car', childTokens: ['automobile'], createdAt: '' }]
    );
    expect(result).toEqual(['best', 'car']);
  });

  it('should apply multiple rules', () => {
    const result = applyMergeRulesToTokenArr(
      ['automobile', 'fast', 'vehicle'],
      [
        { id: '1', parentToken: 'car', childTokens: ['automobile'], createdAt: '' },
        { id: '2', parentToken: 'quick', childTokens: ['fast'], createdAt: '' },
      ]
    );
    expect(result).toEqual(['car', 'quick', 'vehicle']); // automobile→car, fast→quick, vehicle stays
  });

  it('should handle chained rules (A→B, B→C)', () => {
    const result = applyMergeRulesToTokenArr(
      ['automobile'],
      [
        { id: '1', parentToken: 'vehicle', childTokens: ['automobile'], createdAt: '' },
        { id: '2', parentToken: 'car', childTokens: ['vehicle'], createdAt: '' },
      ]
    );
    expect(result).toEqual(['car']); // automobile→vehicle→car
  });
});

describe('executeMergeCascade (full integration)', () => {
  it('should run complete cascade without errors', () => {
    const rows = [
      makeRow('best automobile insurance', ['automobile', 'best', 'insurance'], 1000, 50),
      makeRow('best car insurance', ['best', 'car', 'insurance'], 2000, 60),
      makeRow('fast vehicle', ['fast', 'vehicle'], 300),
    ];

    const cluster1 = makeCluster('best automobile insurance', ['automobile', 'best', 'insurance'], 1000);
    const group = makeGroup('insurance-group', [cluster1]);
    const approved = makeGroup('approved-group', [makeCluster('fast vehicle', ['fast', 'vehicle'], 300)]);

    const result = executeMergeCascade(rows, [group], [approved], 'car', ['automobile', 'vehicle']);

    // automobile→car: "best automobile insurance" now has same sig as "best car insurance" → merge
    // vehicle→car: "fast vehicle" → "car fast"
    expect(result.results.length).toBe(3); // Same rows, different tokens
    expect(result.clusterSummary.length).toBe(2); // 3 pages → 2 (automobile+car merged)

    // The merged cluster should have combined volume
    const insuranceCluster = result.clusterSummary.find(c => c.tokens.includes('insurance'));
    expect(insuranceCluster?.totalVolume).toBe(3000); // 1000 + 2000
    expect(insuranceCluster?.keywordCount).toBe(2);

    // Approved group should be affected (vehicle → car)
    expect(result.unapprovedGroups.length).toBe(1);
    expect(result.unapprovedGroups[0].mergeAffected).toBe(true);
    expect(result.approvedGroups.length).toBe(0);
  });
});

describe('Edge cases', () => {
  it('should handle tokenArr with both parent and child', () => {
    // Edge: row already has parent token AND a child token
    const result = mergeTokenArr(['automobile', 'car', 'fast'], 'car', ['automobile']);
    expect(result).toEqual(['car', 'fast']); // Deduplicated
  });

  it('should preserve originalTokenArr immutability during undo comparison', () => {
    // The bug: .sort() mutating originalTokenArr
    const original = ['zebra', 'apple', 'mango'];
    const row = makeRow('test', ['apple', 'mango', 'zebra'], 100);
    row.originalTokenArr = [...original];

    // Simulate the comparison without mutation
    const sorted = [...row.originalTokenArr].sort().join(' ');
    expect(sorted).toBe('apple mango zebra');
    // Original should NOT be mutated
    expect(row.originalTokenArr).toEqual(['zebra', 'apple', 'mango']);
  });

  it('should handle merge where all tokens become the same', () => {
    // Merging the only token into itself shouldn't break
    const rows = [makeRow('car fast', ['car', 'fast'], 100)];
    const { updatedResults } = applyMergeToRows(rows, 'car', ['fast']);
    expect(updatedResults[0].tokenArr).toEqual(['car']);
    expect(updatedResults[0].tokens).toBe('car');
  });

  it('should not affect rows without child tokens', () => {
    const rows = [
      makeRow('unrelated keyword', ['other', 'stuff'], 500),
    ];
    const { updatedResults } = applyMergeToRows(rows, 'car', ['automobile']);
    expect(updatedResults[0]).toBe(rows[0]); // Same reference — not cloned
    expect(updatedResults[0].originalTokenArr).toBeUndefined();
  });
});
