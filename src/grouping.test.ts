import { describe, it, expect } from 'vitest';
import type { ClusterSummary, GroupedCluster, ProcessedRow } from './types';
import { parseSubClusterKey } from './subClusterKeys';

// ──────────────────────────────────────────────────────────────────────
// Pure logic functions extracted from App.tsx
// ──────────────────────────────────────────────────────────────────────

function computeGroupStats(clusters: ClusterSummary[]): { totalVolume: number; keywordCount: number; avgKd: number | null } {
  const totalVolume = clusters.reduce((sum, c) => sum + c.totalVolume, 0);
  const keywordCount = clusters.reduce((sum, c) => sum + c.keywordCount, 0);
  let totalKd = 0;
  let kdCount = 0;
  clusters.forEach(c => {
    if (c.avgKd !== null) {
      totalKd += c.avgKd * c.keywordCount;
      kdCount += c.keywordCount;
    }
  });
  const avgKd = kdCount > 0 ? Math.round(totalKd / kdCount) : null;
  return { totalVolume, keywordCount, avgKd };
}

function groupClusters(
  clusterSummary: ClusterSummary[],
  selectedTokens: Set<string>,
  groupName: string
): { newGroup: GroupedCluster; remainingClusters: ClusterSummary[] } {
  const clustersToGroup = clusterSummary.filter(c => selectedTokens.has(c.tokens));
  const remainingClusters = clusterSummary.filter(c => !selectedTokens.has(c.tokens));
  const { totalVolume, keywordCount, avgKd } = computeGroupStats(clustersToGroup);
  const newGroup: GroupedCluster = {
    id: `${groupName}-${Date.now()}`,
    groupName: groupName.trim(),
    clusters: clustersToGroup,
    totalVolume,
    keywordCount,
    avgKd,
  };
  return { newGroup, remainingClusters };
}

function ungroupEntireGroups(
  groupedClusters: GroupedCluster[],
  selectedGroupIds: Set<string>,
  clusterSummary: ClusterSummary[]
): { newGrouped: GroupedCluster[]; newClusters: ClusterSummary[]; returnedClusters: ClusterSummary[] } {
  const returnedClusters: ClusterSummary[] = [];
  for (const groupId of selectedGroupIds) {
    const group = groupedClusters.find(g => g.id === groupId);
    if (group) returnedClusters.push(...group.clusters);
  }
  const newGrouped = groupedClusters.filter(g => !selectedGroupIds.has(g.id));
  const newClusters = [...clusterSummary, ...returnedClusters];
  return { newGrouped, newClusters, returnedClusters };
}

function ungroupSubClusters(
  groupedClusters: GroupedCluster[],
  selectedSubKeys: Set<string>, // "groupId::clusterTokens"
  clusterSummary: ClusterSummary[]
): { newGrouped: GroupedCluster[]; newClusters: ClusterSummary[]; returnedClusters: ClusterSummary[] } {
  const returnedClusters: ClusterSummary[] = [];
  const newGrouped = [...groupedClusters];

  for (const subKey of selectedSubKeys) {
    const parsed = parseSubClusterKey(subKey);
    if (!parsed) continue;
    const { groupId, clusterTokens } = parsed;
    const groupIdx = newGrouped.findIndex(g => g.id === groupId);
    if (groupIdx === -1) continue;
    const group = newGrouped[groupIdx];
    const clusterToReturn = group.clusters.find(c => c.tokens === clusterTokens);
    if (clusterToReturn) {
      returnedClusters.push(clusterToReturn);
      const remainingInGroup = group.clusters.filter(c => c.tokens !== clusterTokens);
      if (remainingInGroup.length === 0) {
        newGrouped.splice(groupIdx, 1);
      } else {
        const { totalVolume, keywordCount, avgKd } = computeGroupStats(remainingInGroup);
        newGrouped[groupIdx] = {
          ...group,
          clusters: remainingInGroup,
          totalVolume,
          keywordCount,
          avgKd,
        };
      }
    }
  }
  const newClusters = [...clusterSummary, ...returnedClusters];
  return { newGrouped, newClusters, returnedClusters };
}

function deselecFilteredOut(selectedClusters: Set<string>, filteredClusters: ClusterSummary[]): Set<string> {
  const visibleTokens = new Set(filteredClusters.map(c => c.tokens));
  const newSelected = new Set<string>();
  for (const t of selectedClusters) {
    if (visibleTokens.has(t)) newSelected.add(t);
  }
  return newSelected;
}

function getHighestVolumeName(selectedTokens: Set<string>, clusters: ClusterSummary[]): string {
  let highest: ClusterSummary | null = null;
  for (const tokens of selectedTokens) {
    const c = clusters.find(cl => cl.tokens === tokens);
    if (c && (!highest || c.totalVolume > highest.totalVolume)) highest = c;
  }
  return highest ? highest.pageName : '';
}

function reconstructRows(clusters: ClusterSummary[]): ProcessedRow[] {
  const rows: ProcessedRow[] = [];
  for (const cluster of clusters) {
    for (const kw of cluster.keywords) {
      rows.push({
        pageName: cluster.pageName,
        pageNameLower: cluster.pageNameLower,
        pageNameLen: cluster.pageNameLen,
        tokens: cluster.tokens,
        tokenArr: cluster.tokenArr,
        keyword: kw.keyword,
        keywordLower: kw.keyword.toLowerCase(),
        searchVolume: kw.volume,
        kd: kw.kd,
        label: cluster.label,
        labelArr: cluster.labelArr,
        locationCity: kw.locationCity,
        locationState: kw.locationState,
      });
    }
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────────────
// Test Data Factory
// ──────────────────────────────────────────────────────────────────────

function makeCluster(
  pageName: string,
  tokens: string,
  keywords: { keyword: string; volume: number; kd: number | null }[],
  opts?: { label?: string; locationCity?: string; locationState?: string }
): ClusterSummary {
  const totalVolume = keywords.reduce((s, k) => s + k.volume, 0);
  const kdVals = keywords.filter(k => k.kd !== null);
  const avgKd = kdVals.length > 0 ? Math.round(kdVals.reduce((s, k) => s + (k.kd ?? 0), 0) / kdVals.length) : null;
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: keywords.length,
    totalVolume,
    avgKd,
    label: opts?.label ?? '',
    labelArr: opts?.label ? [opts.label] : [],
    locationCity: opts?.locationCity ?? null,
    locationState: opts?.locationState ?? null,
    keywords: keywords.map(k => ({ ...k, locationCity: opts?.locationCity ?? null, locationState: opts?.locationState ?? null })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// TESTS
// ──────────────────────────────────────────────────────────────────────

describe('Group Statistics Calculation', () => {
  const clusterA = makeCluster('payday loans', 'loan payday', [
    { keyword: 'payday loans', volume: 10000, kd: 50 },
    { keyword: 'payday loan', volume: 8000, kd: 45 },
    { keyword: 'pay day loans', volume: 5000, kd: 55 },
  ]);

  const clusterB = makeCluster('fast payday loans', 'fast loan payday', [
    { keyword: 'fast payday loans', volume: 3000, kd: 40 },
    { keyword: 'quick payday loans', volume: 2000, kd: 30 },
  ]);

  const clusterC = makeCluster('no kd cluster', 'no kd', [
    { keyword: 'mystery keyword', volume: 500, kd: null },
    { keyword: 'another mystery', volume: 300, kd: null },
  ]);

  it('should correctly sum totalVolume across clusters', () => {
    const { totalVolume } = computeGroupStats([clusterA, clusterB]);
    expect(totalVolume).toBe(10000 + 8000 + 5000 + 3000 + 2000);
    expect(totalVolume).toBe(28000);
  });

  it('should correctly sum keywordCount across clusters', () => {
    const { keywordCount } = computeGroupStats([clusterA, clusterB]);
    expect(keywordCount).toBe(3 + 2);
    expect(keywordCount).toBe(5);
  });

  it('should correctly compute weighted average KD', () => {
    // clusterA: avgKd=50 (weighted: (50*3)=150), keywordCount=3
    // clusterB: avgKd=36 (weighted: (36*2)=72), keywordCount=2  
    // Actually let me compute: A has (50+45+55)/3=50, B has (40+30)/2=35
    // Weighted avg = (50*3 + 35*2) / (3+2) = (150+70)/5 = 220/5 = 44
    const { avgKd } = computeGroupStats([clusterA, clusterB]);
    const expectedAvg = Math.round((clusterA.avgKd! * clusterA.keywordCount + clusterB.avgKd! * clusterB.keywordCount) / (clusterA.keywordCount + clusterB.keywordCount));
    expect(avgKd).toBe(expectedAvg);
  });

  it('should return null avgKd when all clusters have null KD', () => {
    const { avgKd } = computeGroupStats([clusterC]);
    expect(avgKd).toBeNull();
  });

  it('should ignore null-KD clusters in the weighted average', () => {
    // clusterA has avgKd=50, keywordCount=3
    // clusterC has avgKd=null
    // Only clusterA contributes to the average
    const { avgKd } = computeGroupStats([clusterA, clusterC]);
    expect(avgKd).toBe(clusterA.avgKd);
  });

  it('should handle a single cluster', () => {
    const { totalVolume, keywordCount, avgKd } = computeGroupStats([clusterA]);
    expect(totalVolume).toBe(23000);
    expect(keywordCount).toBe(3);
    expect(avgKd).toBe(50);
  });

  it('should handle empty cluster list', () => {
    const { totalVolume, keywordCount, avgKd } = computeGroupStats([]);
    expect(totalVolume).toBe(0);
    expect(keywordCount).toBe(0);
    expect(avgKd).toBeNull();
  });
});

describe('Grouping Clusters', () => {
  const clusters = [
    makeCluster('page a', 'a', [{ keyword: 'kw1', volume: 100, kd: 10 }]),
    makeCluster('page b', 'b', [{ keyword: 'kw2', volume: 200, kd: 20 }]),
    makeCluster('page c', 'c', [{ keyword: 'kw3', volume: 300, kd: 30 }]),
    makeCluster('page d', 'd', [{ keyword: 'kw4', volume: 400, kd: 40 }]),
  ];

  it('should move selected clusters into a group and leave the rest', () => {
    const selected = new Set(['a', 'c']);
    const { newGroup, remainingClusters } = groupClusters(clusters, selected, 'My Group');
    expect(newGroup.clusters.length).toBe(2);
    expect(newGroup.clusters.map(c => c.tokens).sort()).toEqual(['a', 'c']);
    expect(remainingClusters.length).toBe(2);
    expect(remainingClusters.map(c => c.tokens).sort()).toEqual(['b', 'd']);
  });

  it('should compute correct group stats', () => {
    const selected = new Set(['a', 'c']);
    const { newGroup } = groupClusters(clusters, selected, 'My Group');
    expect(newGroup.totalVolume).toBe(100 + 300);
    expect(newGroup.keywordCount).toBe(2);
    // Weighted avg: (10*1 + 30*1) / 2 = 20
    expect(newGroup.avgKd).toBe(20);
  });

  it('should set the group name correctly', () => {
    const selected = new Set(['b']);
    const { newGroup } = groupClusters(clusters, selected, '  Trimmed Name  ');
    expect(newGroup.groupName).toBe('Trimmed Name');
  });

  it('should handle grouping all clusters', () => {
    const selected = new Set(['a', 'b', 'c', 'd']);
    const { newGroup, remainingClusters } = groupClusters(clusters, selected, 'All');
    expect(newGroup.clusters.length).toBe(4);
    expect(remainingClusters.length).toBe(0);
    expect(newGroup.totalVolume).toBe(1000);
    expect(newGroup.keywordCount).toBe(4);
  });
});

describe('Ungrouping Entire Groups', () => {
  const cluster1 = makeCluster('page 1', 'tok1', [{ keyword: 'kw1', volume: 500, kd: 25 }]);
  const cluster2 = makeCluster('page 2', 'tok2', [{ keyword: 'kw2', volume: 300, kd: 35 }]);
  const cluster3 = makeCluster('page 3', 'tok3', [{ keyword: 'kw3', volume: 200, kd: 15 }]);

  const groups: GroupedCluster[] = [
    { id: 'g1', groupName: 'Group 1', clusters: [cluster1, cluster2], totalVolume: 800, keywordCount: 2, avgKd: 30 },
    { id: 'g2', groupName: 'Group 2', clusters: [cluster3], totalVolume: 200, keywordCount: 1, avgKd: 15 },
  ];

  it('should return clusters from ungrouped groups back to clusterSummary', () => {
    const { newGrouped, newClusters, returnedClusters } = ungroupEntireGroups(groups, new Set(['g1']), []);
    expect(newGrouped.length).toBe(1);
    expect(newGrouped[0].id).toBe('g2');
    expect(returnedClusters.length).toBe(2);
    expect(newClusters.length).toBe(2); // 0 existing + 2 returned
    expect(newClusters.map(c => c.tokens).sort()).toEqual(['tok1', 'tok2']);
  });

  it('should handle ungrouping all groups', () => {
    const { newGrouped, newClusters } = ungroupEntireGroups(groups, new Set(['g1', 'g2']), []);
    expect(newGrouped.length).toBe(0);
    expect(newClusters.length).toBe(3);
  });

  it('should preserve existing clusters when adding returned ones', () => {
    const existing = [makeCluster('existing', 'ext', [{ keyword: 'kw0', volume: 100, kd: 5 }])];
    const { newClusters } = ungroupEntireGroups(groups, new Set(['g2']), existing);
    expect(newClusters.length).toBe(2); // 1 existing + 1 returned
    expect(newClusters.map(c => c.tokens)).toContain('ext');
    expect(newClusters.map(c => c.tokens)).toContain('tok3');
  });
});

describe('Ungrouping Individual Sub-Clusters', () => {
  const cluster1 = makeCluster('page 1', 'tok1', [
    { keyword: 'kw1', volume: 500, kd: 25 },
    { keyword: 'kw1b', volume: 100, kd: 30 },
  ]);
  const cluster2 = makeCluster('page 2', 'tok2', [{ keyword: 'kw2', volume: 300, kd: 35 }]);
  const cluster3 = makeCluster('page 3', 'tok3', [{ keyword: 'kw3', volume: 200, kd: 15 }]);

  it('should remove one sub-cluster and update group stats', () => {
    const group: GroupedCluster = {
      id: 'g1', groupName: 'Group 1', clusters: [cluster1, cluster2, cluster3],
      totalVolume: 1100, keywordCount: 4, avgKd: 26,
    };
    const { newGrouped, returnedClusters, newClusters } = ungroupSubClusters(
      [group], new Set(['g1::tok2']), []
    );
    expect(returnedClusters.length).toBe(1);
    expect(returnedClusters[0].tokens).toBe('tok2');
    expect(newGrouped.length).toBe(1);
    expect(newGrouped[0].clusters.length).toBe(2);
    // New total = 500+100+200 = 800 (removed 300)
    expect(newGrouped[0].totalVolume).toBe(800);
    // New keyword count = 2+1 = 3 (removed 1)
    expect(newGrouped[0].keywordCount).toBe(3);
    // New avg KD: cluster1 has avgKd=28 (rounded (25+30)/2), cluster3 has avgKd=15
    // Weighted: (28*2 + 15*1) / 3 = 71/3 = 23.67 → 24
    const expectedKd = Math.round((cluster1.avgKd! * cluster1.keywordCount + cluster3.avgKd! * cluster3.keywordCount) / (cluster1.keywordCount + cluster3.keywordCount));
    expect(newGrouped[0].avgKd).toBe(expectedKd);
    expect(newClusters.length).toBe(1); // returned to clusters
  });

  it('should dissolve group when last sub-cluster is removed', () => {
    const group: GroupedCluster = {
      id: 'g1', groupName: 'Single', clusters: [cluster1],
      totalVolume: 600, keywordCount: 2, avgKd: 28,
    };
    const { newGrouped, returnedClusters } = ungroupSubClusters(
      [group], new Set(['g1::tok1']), []
    );
    expect(newGrouped.length).toBe(0);
    expect(returnedClusters.length).toBe(1);
  });
});

describe('Filter Deselection', () => {
  const clusters = [
    makeCluster('page a', 'a', [{ keyword: 'kw1', volume: 100, kd: 10 }]),
    makeCluster('page b', 'b', [{ keyword: 'kw2', volume: 200, kd: 20 }]),
    makeCluster('page c', 'c', [{ keyword: 'kw3', volume: 300, kd: 30 }]),
  ];

  it('should keep selected items that are still visible', () => {
    const selected = new Set(['a', 'b', 'c']);
    const filtered = clusters.filter(c => c.tokens !== 'b'); // 'b' filtered out
    const result = deselecFilteredOut(selected, filtered);
    expect(result.size).toBe(2);
    expect(result.has('a')).toBe(true);
    expect(result.has('c')).toBe(true);
    expect(result.has('b')).toBe(false);
  });

  it('should deselect all when all are filtered out', () => {
    const selected = new Set(['a', 'b']);
    const filtered: ClusterSummary[] = []; // everything filtered
    const result = deselecFilteredOut(selected, filtered);
    expect(result.size).toBe(0);
  });

  it('should return empty set when nothing was selected', () => {
    const result = deselecFilteredOut(new Set(), clusters);
    expect(result.size).toBe(0);
  });
});

describe('Group Name Auto-Update (Highest Volume)', () => {
  const clusters = [
    makeCluster('low volume page', 'low', [{ keyword: 'kw1', volume: 100, kd: 10 }]),
    makeCluster('high volume page', 'high', [{ keyword: 'kw2', volume: 50000, kd: 20 }]),
    makeCluster('mid volume page', 'mid', [{ keyword: 'kw3', volume: 5000, kd: 30 }]),
  ];

  it('should return the highest volume page name', () => {
    const selected = new Set(['low', 'high', 'mid']);
    const name = getHighestVolumeName(selected, clusters);
    expect(name).toBe('high volume page');
  });

  it('should update when highest volume is deselected', () => {
    const selected = new Set(['low', 'mid']);
    const name = getHighestVolumeName(selected, clusters);
    expect(name).toBe('mid volume page');
  });

  it('should return empty string when nothing selected', () => {
    const name = getHighestVolumeName(new Set(), clusters);
    expect(name).toBe('');
  });

  it('should work with single selection', () => {
    const name = getHighestVolumeName(new Set(['low']), clusters);
    expect(name).toBe('low volume page');
  });
});

describe('Row Reconstruction from Clusters', () => {
  const cluster = makeCluster('test page', 'test tokens', [
    { keyword: 'keyword one', volume: 1000, kd: 50 },
    { keyword: 'keyword two', volume: 2000, kd: 60 },
    { keyword: 'keyword three', volume: 500, kd: null },
  ], { label: 'FAQ', locationCity: 'New York', locationState: 'NY' });

  it('should create one ProcessedRow per keyword', () => {
    const rows = reconstructRows([cluster]);
    expect(rows.length).toBe(3);
  });

  it('should preserve page metadata on each row', () => {
    const rows = reconstructRows([cluster]);
    rows.forEach(row => {
      expect(row.pageName).toBe('test page');
      expect(row.pageNameLower).toBe('test page');
      expect(row.tokens).toBe('test tokens');
      expect(row.label).toBe('FAQ');
      expect(row.locationCity).toBe('New York');
      expect(row.locationState).toBe('NY');
    });
  });

  it('should set keyword-level data correctly', () => {
    const rows = reconstructRows([cluster]);
    expect(rows[0].keyword).toBe('keyword one');
    expect(rows[0].searchVolume).toBe(1000);
    expect(rows[0].kd).toBe(50);
    expect(rows[2].kd).toBeNull();
  });

  it('should set keywordLower correctly', () => {
    const rows = reconstructRows([cluster]);
    expect(rows[0].keywordLower).toBe('keyword one');
  });
});

describe('Full Round-Trip: Group → Ungroup Data Integrity', () => {
  const originalClusters = [
    makeCluster('page alpha', 'alpha', [
      { keyword: 'alpha kw1', volume: 1000, kd: 20 },
      { keyword: 'alpha kw2', volume: 2000, kd: 30 },
    ]),
    makeCluster('page beta', 'beta', [
      { keyword: 'beta kw1', volume: 500, kd: 40 },
    ]),
    makeCluster('page gamma', 'gamma', [
      { keyword: 'gamma kw1', volume: 3000, kd: 10 },
      { keyword: 'gamma kw2', volume: 1500, kd: 15 },
      { keyword: 'gamma kw3', volume: 800, kd: 25 },
    ]),
  ];

  it('should preserve total volume after group → ungroup round-trip', () => {
    const originalTotal = originalClusters.reduce((s, c) => s + c.totalVolume, 0);

    // Step 1: Group alpha + beta
    const selected = new Set(['alpha', 'beta']);
    const { newGroup, remainingClusters } = groupClusters(originalClusters, selected, 'AB Group');
    
    const afterGroupingTotal = remainingClusters.reduce((s, c) => s + c.totalVolume, 0) + newGroup.totalVolume;
    expect(afterGroupingTotal).toBe(originalTotal);

    // Step 2: Ungroup
    const { newClusters } = ungroupEntireGroups([newGroup], new Set([newGroup.id]), remainingClusters);
    const afterUngroupingTotal = newClusters.reduce((s, c) => s + c.totalVolume, 0);
    expect(afterUngroupingTotal).toBe(originalTotal);
  });

  it('should preserve total keyword count after round-trip', () => {
    const originalKeywords = originalClusters.reduce((s, c) => s + c.keywordCount, 0);

    const selected = new Set(['alpha', 'gamma']);
    const { newGroup, remainingClusters } = groupClusters(originalClusters, selected, 'AG Group');
    
    const afterGrouping = remainingClusters.reduce((s, c) => s + c.keywordCount, 0) + newGroup.keywordCount;
    expect(afterGrouping).toBe(originalKeywords);

    const { newClusters } = ungroupEntireGroups([newGroup], new Set([newGroup.id]), remainingClusters);
    const afterUnGrouping = newClusters.reduce((s, c) => s + c.keywordCount, 0);
    expect(afterUnGrouping).toBe(originalKeywords);
  });

  it('should preserve cluster count after round-trip', () => {
    const originalCount = originalClusters.length;

    const selected = new Set(['beta']);
    const { newGroup, remainingClusters } = groupClusters(originalClusters, selected, 'B');
    expect(remainingClusters.length + newGroup.clusters.length).toBe(originalCount);

    const { newClusters } = ungroupEntireGroups([newGroup], new Set([newGroup.id]), remainingClusters);
    expect(newClusters.length).toBe(originalCount);
  });

  it('should correctly reconstruct ProcessedRows after ungrouping', () => {
    const selected = new Set(['alpha']);
    const { newGroup, remainingClusters } = groupClusters(originalClusters, selected, 'Alpha');
    const { returnedClusters } = ungroupEntireGroups([newGroup], new Set([newGroup.id]), remainingClusters);
    const rows = reconstructRows(returnedClusters);
    expect(rows.length).toBe(2); // alpha had 2 keywords
    expect(rows.every(r => r.pageName === 'page alpha')).toBe(true);
    expect(rows.reduce((s, r) => s + r.searchVolume, 0)).toBe(3000); // 1000 + 2000
  });
});

describe('Partial Ungrouping Data Integrity', () => {
  const clusters = [
    makeCluster('page one', 'tok1', [{ keyword: 'k1', volume: 100, kd: 10 }]),
    makeCluster('page two', 'tok2', [{ keyword: 'k2', volume: 200, kd: 20 }]),
    makeCluster('page three', 'tok3', [{ keyword: 'k3', volume: 300, kd: 30 }]),
  ];

  it('should correctly update group stats after partial ungroup', () => {
    const group: GroupedCluster = {
      id: 'grp', groupName: 'Test', clusters,
      totalVolume: 600, keywordCount: 3, avgKd: 20,
    };
    // Remove page two (tok2, volume 200, kd 20)
    const { newGrouped } = ungroupSubClusters([group], new Set(['grp::tok2']), []);
    expect(newGrouped.length).toBe(1);
    expect(newGrouped[0].totalVolume).toBe(400); // 100 + 300
    expect(newGrouped[0].keywordCount).toBe(2);
    // Weighted avg: (10*1 + 30*1) / 2 = 20
    expect(newGrouped[0].avgKd).toBe(20);
  });

  it('should preserve total volume across partial ungroup', () => {
    const group: GroupedCluster = {
      id: 'grp', groupName: 'Test', clusters,
      totalVolume: 600, keywordCount: 3, avgKd: 20,
    };
    const { newGrouped, newClusters } = ungroupSubClusters([group], new Set(['grp::tok2']), []);
    const totalAfter = newGrouped.reduce((s, g) => s + g.totalVolume, 0) + newClusters.reduce((s, c) => s + c.totalVolume, 0);
    expect(totalAfter).toBe(600);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Auto-Grouping Logic (replicates the CSV post-processing in App.tsx)
// ──────────────────────────────────────────────────────────────────────

function autoGroupLocations(summaryData: ClusterSummary[]): {
  autoGroups: GroupedCluster[];
  noLocationClusters: ClusterSummary[];
  groupedTokenSigs: Set<string>;
} {
  const cityMap = new Map<string, ClusterSummary[]>();
  const stateMap2 = new Map<string, ClusterSummary[]>();
  const noLocationClusters: ClusterSummary[] = [];

  for (const c of summaryData) {
    if (c.locationCity) {
      const key = c.locationCity;
      if (!cityMap.has(key)) cityMap.set(key, []);
      cityMap.get(key)!.push(c);
    } else if (c.locationState) {
      const key = c.locationState;
      if (!stateMap2.has(key)) stateMap2.set(key, []);
      stateMap2.get(key)!.push(c);
    } else {
      noLocationClusters.push(c);
    }
  }

  const buildGroup = (label: string, clusters: ClusterSummary[]): GroupedCluster => {
    const totalVolume = clusters.reduce((sum, c) => sum + c.totalVolume, 0);
    const keywordCount = clusters.reduce((sum, c) => sum + c.keywordCount, 0);
    let tKd = 0, kCount = 0;
    clusters.forEach(c => { if (c.avgKd !== null) { tKd += c.avgKd * c.keywordCount; kCount += c.keywordCount; } });
    const highest = clusters.reduce((best, c) => c.totalVolume > best.totalVolume ? c : best, clusters[0]);
    return {
      id: `auto-${label}-${Date.now()}`,
      groupName: highest.pageName,
      clusters,
      totalVolume,
      keywordCount,
      avgKd: kCount > 0 ? Math.round(tKd / kCount) : null,
    };
  };

  const autoGroups: GroupedCluster[] = [];
  for (const [city, clusters] of cityMap) {
    if (clusters.length > 0) autoGroups.push(buildGroup(`city-${city}`, clusters));
  }
  for (const [state, clusters] of stateMap2) {
    if (clusters.length > 0) autoGroups.push(buildGroup(`state-${state}`, clusters));
  }

  const groupedTokenSigs = new Set<string>();
  autoGroups.forEach(g => g.clusters.forEach(c => groupedTokenSigs.add(c.tokens)));

  return { autoGroups, noLocationClusters, groupedTokenSigs };
}

// ──────────────────────────────────────────────────────────────────────
// Auto-Grouping Tests
// ──────────────────────────────────────────────────────────────────────

describe('Auto-Grouping Location Clusters', () => {
  const cityCluster1 = makeCluster('plumber los angeles', 'angeles lo plumber', [
    { keyword: 'plumber los angeles', volume: 5000, kd: 30 },
  ], { locationCity: 'Los Angeles', locationState: 'California' });

  const cityCluster2 = makeCluster('best plumber la', 'angeles lo plumber top', [
    { keyword: 'best plumber la', volume: 3000, kd: 25 },
  ], { locationCity: 'Los Angeles', locationState: 'California' });

  const cityCluster3 = makeCluster('plumber new york city', 'nyc plumber', [
    { keyword: 'plumber new york city', volume: 8000, kd: 40 },
  ], { locationCity: 'New York City', locationState: 'New York' });

  const stateCluster1 = makeCluster('plumber california', 'ca plumber', [
    { keyword: 'plumber california', volume: 4000, kd: 35 },
  ], { locationState: 'California' });

  const stateCluster2 = makeCluster('california plumbing', 'ca plumbing', [
    { keyword: 'california plumbing', volume: 2000, kd: 20 },
  ], { locationState: 'California' });

  const stateCluster3 = makeCluster('plumber texas', 'plumber tx', [
    { keyword: 'plumber texas', volume: 6000, kd: 30 },
  ], { locationState: 'Texas' });

  const noLocCluster1 = makeCluster('best plumber', 'plumber top', [
    { keyword: 'best plumber', volume: 10000, kd: 50 },
  ]);

  const noLocCluster2 = makeCluster('emergency plumber', 'emergency plumber', [
    { keyword: 'emergency plumber', volume: 7000, kd: 45 },
  ]);

  const allClusters = [cityCluster1, cityCluster2, cityCluster3, stateCluster1, stateCluster2, stateCluster3, noLocCluster1, noLocCluster2];

  it('should separate clusters into city groups, state groups, and no-location', () => {
    const { autoGroups, noLocationClusters } = autoGroupLocations(allClusters);
    // City groups: Los Angeles (2 clusters), New York City (1 cluster)
    // State groups: California (2 clusters), Texas (1 cluster)
    // No location: 2 clusters
    expect(noLocationClusters.length).toBe(2);
    expect(autoGroups.length).toBe(4); // 2 city + 2 state
  });

  it('should group city clusters by city name', () => {
    const { autoGroups } = autoGroupLocations(allClusters);
    const laGroup = autoGroups.find(g => g.clusters.some(c => c.locationCity === 'Los Angeles'));
    expect(laGroup).toBeDefined();
    expect(laGroup!.clusters.length).toBe(2);
    expect(laGroup!.clusters.every(c => c.locationCity === 'Los Angeles')).toBe(true);
  });

  it('should put clusters with both city AND state into city group, not state group', () => {
    const { autoGroups } = autoGroupLocations(allClusters);
    // cityCluster1 has city=Los Angeles, state=California → should be in LA city group
    const laGroup = autoGroups.find(g => g.clusters.some(c => c.locationCity === 'Los Angeles'));
    expect(laGroup!.clusters).toContain(cityCluster1);
    // California state group should NOT contain cityCluster1
    const caGroup = autoGroups.find(g =>
      g.clusters.some(c => c.locationState === 'California') &&
      !g.clusters.some(c => c.locationCity)
    );
    expect(caGroup).toBeDefined();
    expect(caGroup!.clusters).not.toContain(cityCluster1);
    expect(caGroup!.clusters).not.toContain(cityCluster2);
  });

  it('should group state-only clusters by state name', () => {
    const { autoGroups } = autoGroupLocations(allClusters);
    const caGroup = autoGroups.find(g =>
      g.clusters.some(c => c.locationState === 'California') &&
      !g.clusters.some(c => c.locationCity)
    );
    expect(caGroup).toBeDefined();
    expect(caGroup!.clusters.length).toBe(2);
    expect(caGroup!.clusters).toContain(stateCluster1);
    expect(caGroup!.clusters).toContain(stateCluster2);
  });

  it('should use highest volume cluster pageName as group name', () => {
    const { autoGroups } = autoGroupLocations(allClusters);
    // LA group: cityCluster1 (5000) > cityCluster2 (3000) → name = "plumber los angeles"
    const laGroup = autoGroups.find(g => g.clusters.some(c => c.locationCity === 'Los Angeles'));
    expect(laGroup!.groupName).toBe('plumber los angeles');
    // CA state group: stateCluster1 (4000) > stateCluster2 (2000) → name = "plumber california"
    const caGroup = autoGroups.find(g =>
      g.clusters.some(c => c.locationState === 'California') &&
      !g.clusters.some(c => c.locationCity)
    );
    expect(caGroup!.groupName).toBe('plumber california');
  });

  it('should compute correct group stats', () => {
    const { autoGroups } = autoGroupLocations(allClusters);
    const laGroup = autoGroups.find(g => g.clusters.some(c => c.locationCity === 'Los Angeles'));
    expect(laGroup!.totalVolume).toBe(5000 + 3000);
    expect(laGroup!.keywordCount).toBe(2);
  });

  it('should not include no-location clusters in any group', () => {
    const { autoGroups, noLocationClusters } = autoGroupLocations(allClusters);
    const allGrouped = autoGroups.flatMap(g => g.clusters);
    expect(allGrouped).not.toContain(noLocCluster1);
    expect(allGrouped).not.toContain(noLocCluster2);
    expect(noLocationClusters).toContain(noLocCluster1);
    expect(noLocationClusters).toContain(noLocCluster2);
  });

  it('should track grouped token signatures for result filtering', () => {
    const { groupedTokenSigs } = autoGroupLocations(allClusters);
    expect(groupedTokenSigs.has(cityCluster1.tokens)).toBe(true);
    expect(groupedTokenSigs.has(stateCluster1.tokens)).toBe(true);
    expect(groupedTokenSigs.has(noLocCluster1.tokens)).toBe(false);
  });

  it('should preserve total volume across all groups + ungrouped', () => {
    const { autoGroups, noLocationClusters } = autoGroupLocations(allClusters);
    const groupedVol = autoGroups.reduce((s, g) => s + g.totalVolume, 0);
    const ungroupedVol = noLocationClusters.reduce((s, c) => s + c.totalVolume, 0);
    const originalVol = allClusters.reduce((s, c) => s + c.totalVolume, 0);
    expect(groupedVol + ungroupedVol).toBe(originalVol);
  });

  it('should preserve total keyword count across all groups + ungrouped', () => {
    const { autoGroups, noLocationClusters } = autoGroupLocations(allClusters);
    const groupedKw = autoGroups.reduce((s, g) => s + g.keywordCount, 0);
    const ungroupedKw = noLocationClusters.reduce((s, c) => s + c.keywordCount, 0);
    const originalKw = allClusters.reduce((s, c) => s + c.keywordCount, 0);
    expect(groupedKw + ungroupedKw).toBe(originalKw);
  });

  it('should handle dataset with no location clusters at all', () => {
    const { autoGroups, noLocationClusters } = autoGroupLocations([noLocCluster1, noLocCluster2]);
    expect(autoGroups.length).toBe(0);
    expect(noLocationClusters.length).toBe(2);
  });

  it('should handle dataset with all location clusters', () => {
    const { autoGroups, noLocationClusters } = autoGroupLocations([cityCluster1, stateCluster1]);
    expect(autoGroups.length).toBe(2);
    expect(noLocationClusters.length).toBe(0);
  });

  it('should create single-cluster groups for unique locations', () => {
    const { autoGroups } = autoGroupLocations(allClusters);
    const nycGroup = autoGroups.find(g => g.clusters.some(c => c.locationCity === 'New York City'));
    expect(nycGroup).toBeDefined();
    expect(nycGroup!.clusters.length).toBe(1);
    expect(nycGroup!.groupName).toBe('plumber new york city');
  });
});
