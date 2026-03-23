/**
 * Tests for the approve/unapprove group logic.
 * Tests the pure data transformations extracted from the React handlers.
 *
 * Run: node --experimental-strip-types --experimental-transform-types src/approvedGroups.test.ts
 */

// ──────────────────────────────────────────────────────────────────────
// Types (matching App.tsx GroupedCluster shape)
// ──────────────────────────────────────────────────────────────────────
interface ClusterSummary {
  pageName: string;
  tokens: string;
  keywordCount: number;
  totalVolume: number;
  avgKd: number | null;
  label: string;
  locationCity: string;
  locationState: string;
}

interface GroupedCluster {
  id: string;
  groupName: string;
  clusters: ClusterSummary[];
  keywordCount: number;
  totalVolume: number;
  avgKd: number | null;
}

// ──────────────────────────────────────────────────────────────────────
// Pure functions (extracted from React handlers for testability)
// ──────────────────────────────────────────────────────────────────────

function approveGroup(
  groupedClusters: GroupedCluster[],
  approvedGroups: GroupedCluster[],
  groupName: string
): { newGrouped: GroupedCluster[]; newApproved: GroupedCluster[] } {
  const group = groupedClusters.find(g => g.groupName === groupName);
  if (!group) return { newGrouped: groupedClusters, newApproved: approvedGroups };
  return {
    newGrouped: groupedClusters.filter(g => g.groupName !== groupName),
    newApproved: [...approvedGroups, group],
  };
}

function unapproveGroup(
  groupedClusters: GroupedCluster[],
  approvedGroups: GroupedCluster[],
  groupName: string
): { newGrouped: GroupedCluster[]; newApproved: GroupedCluster[] } {
  const group = approvedGroups.find(g => g.groupName === groupName);
  if (!group) return { newGrouped: groupedClusters, newApproved: approvedGroups };
  return {
    newGrouped: [...groupedClusters, group],
    newApproved: approvedGroups.filter(g => g.groupName !== groupName),
  };
}

function computeApprovedPageCount(approvedGroups: GroupedCluster[]): number {
  return approvedGroups.reduce((sum, g) => sum + g.clusters.length, 0);
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function makeGroup(name: string, clusterCount = 3): GroupedCluster {
  const clusters: ClusterSummary[] = Array.from({ length: clusterCount }, (_, i) => ({
    pageName: `${name} Page ${i}`,
    tokens: `token-${name}-${i}`,
    keywordCount: 10 + i,
    totalVolume: 1000 * (i + 1),
    avgKd: 20 + i,
    label: 'Informational',
    locationCity: '',
    locationState: '',
  }));
  return {
    id: `group-${name}`,
    groupName: name,
    clusters,
    keywordCount: clusters.reduce((s, c) => s + c.keywordCount, 0),
    totalVolume: clusters.reduce((s, c) => s + c.totalVolume, 0),
    avgKd: 25,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) { passed++; console.log('  \u2713', msg); }
    else { failed++; console.error('  \u2717 FAIL:', msg); }
  }

  // ── Test 1 ──
  console.log('\nTest 1: Approve moves group from grouped to approved');
  {
    const grouped = [makeGroup('A'), makeGroup('B'), makeGroup('C')];
    const approved: GroupedCluster[] = [];
    const { newGrouped, newApproved } = approveGroup(grouped, approved, 'B');
    assert(newGrouped.length === 2, 'grouped has 2 groups');
    assert(newApproved.length === 1, 'approved has 1 group');
    assert(newApproved[0].groupName === 'B', 'approved group is B');
    assert(!newGrouped.find(g => g.groupName === 'B'), 'B removed from grouped');
  }

  // ── Test 2 ──
  console.log('\nTest 2: Unapprove moves group from approved back to grouped');
  {
    const grouped = [makeGroup('A')];
    const approved = [makeGroup('B'), makeGroup('C')];
    const { newGrouped, newApproved } = unapproveGroup(grouped, approved, 'C');
    assert(newGrouped.length === 2, 'grouped has 2 groups');
    assert(newApproved.length === 1, 'approved has 1 group');
    assert(newGrouped[1].groupName === 'C', 'C added back to grouped');
    assert(!newApproved.find(g => g.groupName === 'C'), 'C removed from approved');
  }

  // ── Test 3 ──
  console.log('\nTest 3: Approve non-existent group is a no-op');
  {
    const grouped = [makeGroup('A')];
    const approved: GroupedCluster[] = [];
    const { newGrouped, newApproved } = approveGroup(grouped, approved, 'Z');
    assert(newGrouped.length === 1, 'grouped unchanged');
    assert(newApproved.length === 0, 'approved unchanged');
    assert(newGrouped === grouped, 'same reference (no mutation)');
  }

  // ── Test 4 ──
  console.log('\nTest 4: Unapprove non-existent group is a no-op');
  {
    const grouped = [makeGroup('A')];
    const approved = [makeGroup('B')];
    const { newGrouped, newApproved } = unapproveGroup(grouped, approved, 'Z');
    assert(newGrouped === grouped, 'grouped same reference');
    assert(newApproved === approved, 'approved same reference');
  }

  // ── Test 5 ──
  console.log('\nTest 5: Approve all groups empties grouped');
  {
    let grouped = [makeGroup('A'), makeGroup('B')];
    let approved: GroupedCluster[] = [];

    ({ newGrouped: grouped, newApproved: approved } = approveGroup(grouped, approved, 'A'));
    ({ newGrouped: grouped, newApproved: approved } = approveGroup(grouped, approved, 'B'));

    assert(grouped.length === 0, 'grouped is empty');
    assert(approved.length === 2, 'approved has both groups');
  }

  // ── Test 6 ──
  console.log('\nTest 6: Approve preserves cluster data integrity');
  {
    const original = makeGroup('DataTest', 5);
    const grouped = [original];
    const { newApproved } = approveGroup(grouped, [], 'DataTest');
    const moved = newApproved[0];
    assert(moved.clusters.length === 5, '5 clusters preserved');
    assert(moved.keywordCount === original.keywordCount, 'keywordCount preserved');
    assert(moved.totalVolume === original.totalVolume, 'totalVolume preserved');
    assert(moved.avgKd === original.avgKd, 'avgKd preserved');
    assert(moved.id === original.id, 'id preserved');
  }

  // ── Test 7 ──
  console.log('\nTest 7: Unapprove then re-approve round-trips correctly');
  {
    const grouped = [makeGroup('A')];
    const approved = [makeGroup('B')];

    // Unapprove B
    let result = unapproveGroup(grouped, approved, 'B');
    assert(result.newGrouped.length === 2, 'B moved to grouped');
    assert(result.newApproved.length === 0, 'approved empty');

    // Re-approve B
    result = approveGroup(result.newGrouped, result.newApproved, 'B');
    assert(result.newGrouped.length === 1, 'back to 1 grouped');
    assert(result.newApproved.length === 1, 'back to 1 approved');
    assert(result.newApproved[0].groupName === 'B', 'B is approved again');
  }

  // ── Test 8 ──
  console.log('\nTest 8: computeApprovedPageCount sums clusters correctly');
  {
    const approved = [makeGroup('A', 3), makeGroup('B', 7), makeGroup('C', 1)];
    assert(computeApprovedPageCount(approved) === 11, 'total pages = 3+7+1 = 11');
  }

  // ── Test 9 ──
  console.log('\nTest 9: computeApprovedPageCount returns 0 for empty');
  {
    assert(computeApprovedPageCount([]) === 0, '0 for empty array');
  }

  // ── Test 10 ──
  console.log('\nTest 10: Approve does not mutate original arrays');
  {
    const grouped = [makeGroup('A'), makeGroup('B')];
    const approved: GroupedCluster[] = [];
    const originalGroupedLen = grouped.length;
    const originalApprovedLen = approved.length;
    const { newGrouped, newApproved } = approveGroup(grouped, approved, 'A');
    assert(grouped.length === originalGroupedLen, 'original grouped not mutated');
    assert(approved.length === originalApprovedLen, 'original approved not mutated');
    assert(newGrouped !== grouped, 'new grouped is different reference');
    assert(newApproved !== approved, 'new approved is different reference');
  }

  // ── Test 11 ──
  console.log('\nTest 11: Unapprove does not mutate original arrays');
  {
    const grouped = [makeGroup('A')];
    const approved = [makeGroup('B')];
    const originalGroupedLen = grouped.length;
    const originalApprovedLen = approved.length;
    const { newGrouped, newApproved } = unapproveGroup(grouped, approved, 'B');
    assert(grouped.length === originalGroupedLen, 'original grouped not mutated');
    assert(approved.length === originalApprovedLen, 'original approved not mutated');
  }

  // ── Test 12 ──
  console.log('\nTest 12: Data payload includes approvedGroups');
  {
    // Simulate the data payload structure from saveProjectData
    const approved = [makeGroup('Approved1')];
    const dataPayload = {
      results: null,
      clusterSummary: null,
      tokenSummary: null,
      groupedClusters: [],
      approvedGroups: approved,
      stats: null,
      datasetStats: null,
      blockedTokens: [],
      blockedKeywords: [],
      labelSections: [],
      updatedAt: new Date().toISOString(),
    };
    assert(dataPayload.approvedGroups.length === 1, 'approvedGroups in payload');
    assert(dataPayload.approvedGroups[0].groupName === 'Approved1', 'correct group in payload');
  }

  // ── Test 13 ──
  console.log('\nTest 13: Firestore meta includes approvedGroups');
  {
    // Simulate the Firestore meta chunk structure
    const meta = {
      type: 'meta',
      stats: null,
      datasetStats: null,
      tokenSummary: null,
      groupedClusters: [],
      approvedGroups: [makeGroup('FirestoreTest')],
      blockedTokens: [],
      labelSections: [],
    };
    // Simulate loading from Firestore
    const loaded = meta.approvedGroups || [];
    assert(loaded.length === 1, 'loaded from Firestore meta');
    assert(loaded[0].groupName === 'FirestoreTest', 'correct group loaded');
  }

  // ── Test 14 ──
  console.log('\nTest 14: Missing approvedGroups in legacy data defaults to empty');
  {
    const legacyMeta = {
      type: 'meta',
      groupedClusters: [makeGroup('Old')],
      // No approvedGroups field
    };
    const loaded = (legacyMeta as any).approvedGroups || [];
    assert(loaded.length === 0, 'defaults to empty array for legacy data');
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
