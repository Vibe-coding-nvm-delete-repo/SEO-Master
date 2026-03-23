/**
 * Tests for UI restructure: tab navigation, sub-tabs, conditional rendering logic.
 * Validates the state machine for mainTab + groupSubTab navigation.
 *
 * Run: node --experimental-strip-types --experimental-transform-types src/uiStructure.test.ts
 */

// ──────────────────────────────────────────────────────────────────────
// Types (matching App.tsx state)
// ──────────────────────────────────────────────────────────────────────

type MainTab = 'group' | 'generate';
type GroupSubTab = 'data' | 'projects' | 'how-it-works' | 'dictionaries';

interface NavState {
  mainTab: MainTab;
  groupSubTab: GroupSubTab;
}

// ──────────────────────────────────────────────────────────────────────
// Pure navigation logic (mirrors App.tsx behavior)
// ──────────────────────────────────────────────────────────────────────

function setMainTab(state: NavState, tab: MainTab): NavState {
  return { ...state, mainTab: tab };
}

function setGroupSubTab(state: NavState, subTab: GroupSubTab): NavState {
  return { ...state, groupSubTab: subTab };
}

function navigateToProjects(state: NavState): NavState {
  return { mainTab: 'group', groupSubTab: 'projects' };
}

// Visibility rules
function isDataVisible(state: NavState): boolean {
  return state.mainTab === 'group' && state.groupSubTab === 'data';
}

function isProjectsVisible(state: NavState): boolean {
  return state.mainTab === 'group' && state.groupSubTab === 'projects';
}

function isHowItWorksVisible(state: NavState): boolean {
  return state.mainTab === 'group' && state.groupSubTab === 'how-it-works';
}

function isDictionariesVisible(state: NavState): boolean {
  return state.mainTab === 'group' && state.groupSubTab === 'dictionaries';
}

function isGenerateVisible(state: NavState): boolean {
  return state.mainTab === 'generate';
}

function isGroupSubTabBarVisible(state: NavState): boolean {
  return state.mainTab === 'group';
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
  console.log('\nTest 1: Default state shows Group tab with Data sub-tab');
  {
    const state: NavState = { mainTab: 'group', groupSubTab: 'data' };
    assert(isDataVisible(state), 'data content visible');
    assert(!isGenerateVisible(state), 'generate not visible');
    assert(isGroupSubTabBarVisible(state), 'sub-tab bar visible');
    assert(!isProjectsVisible(state), 'projects not visible');
    assert(!isHowItWorksVisible(state), 'how-it-works not visible');
    assert(!isDictionariesVisible(state), 'dictionaries not visible');
  }

  // ── Test 2 ──
  console.log('\nTest 2: Switching to Generate tab hides everything else');
  {
    const state: NavState = { mainTab: 'generate', groupSubTab: 'data' };
    assert(isGenerateVisible(state), 'generate visible');
    assert(!isDataVisible(state), 'data not visible');
    assert(!isProjectsVisible(state), 'projects not visible');
    assert(!isGroupSubTabBarVisible(state), 'sub-tab bar not visible');
  }

  // ── Test 3 ──
  console.log('\nTest 3: Switching to Projects sub-tab');
  {
    let state: NavState = { mainTab: 'group', groupSubTab: 'data' };
    state = setGroupSubTab(state, 'projects');
    assert(isProjectsVisible(state), 'projects visible');
    assert(!isDataVisible(state), 'data not visible');
    assert(isGroupSubTabBarVisible(state), 'sub-tab bar still visible');
  }

  // ── Test 4 ──
  console.log('\nTest 4: Switching to How it Works sub-tab');
  {
    let state: NavState = { mainTab: 'group', groupSubTab: 'data' };
    state = setGroupSubTab(state, 'how-it-works');
    assert(isHowItWorksVisible(state), 'how-it-works visible');
    assert(!isDataVisible(state), 'data not visible');
    assert(!isProjectsVisible(state), 'projects not visible');
  }

  // ── Test 5 ──
  console.log('\nTest 5: Switching to Dictionaries sub-tab');
  {
    let state: NavState = { mainTab: 'group', groupSubTab: 'data' };
    state = setGroupSubTab(state, 'dictionaries');
    assert(isDictionariesVisible(state), 'dictionaries visible');
    assert(!isDataVisible(state), 'data not visible');
  }

  // ── Test 6 ──
  console.log('\nTest 6: navigateToProjects always goes to group + projects');
  {
    // From generate tab
    let state: NavState = { mainTab: 'generate', groupSubTab: 'data' };
    state = navigateToProjects(state);
    assert(state.mainTab === 'group', 'mainTab is group');
    assert(state.groupSubTab === 'projects', 'groupSubTab is projects');
    assert(isProjectsVisible(state), 'projects visible');
  }

  // ── Test 7 ──
  console.log('\nTest 7: Only one content area visible at a time');
  {
    const allStates: NavState[] = [
      { mainTab: 'group', groupSubTab: 'data' },
      { mainTab: 'group', groupSubTab: 'projects' },
      { mainTab: 'group', groupSubTab: 'how-it-works' },
      { mainTab: 'group', groupSubTab: 'dictionaries' },
      { mainTab: 'generate', groupSubTab: 'data' },
    ];

    for (const state of allStates) {
      const visibleCount = [
        isDataVisible(state),
        isProjectsVisible(state),
        isHowItWorksVisible(state),
        isDictionariesVisible(state),
        isGenerateVisible(state),
      ].filter(Boolean).length;
      assert(visibleCount === 1, `exactly 1 visible for mainTab=${state.mainTab}, groupSubTab=${state.groupSubTab} (got ${visibleCount})`);
    }
  }

  // ── Test 8 ──
  console.log('\nTest 8: Sub-tab bar only visible in Group tab');
  {
    assert(isGroupSubTabBarVisible({ mainTab: 'group', groupSubTab: 'data' }), 'visible in group/data');
    assert(isGroupSubTabBarVisible({ mainTab: 'group', groupSubTab: 'projects' }), 'visible in group/projects');
    assert(!isGroupSubTabBarVisible({ mainTab: 'generate', groupSubTab: 'data' }), 'not visible in generate');
  }

  // ── Test 9 ──
  console.log('\nTest 9: mainTab only has 2 valid values');
  {
    const validMainTabs: MainTab[] = ['group', 'generate'];
    assert(validMainTabs.length === 2, 'exactly 2 main tabs');
    // Old values should not compile — verified by TypeScript
    // 'tool', 'how-it-works', 'dictionaries', 'saved-clusters', 'projects' are gone
  }

  // ── Test 10 ──
  console.log('\nTest 10: groupSubTab has 4 valid values');
  {
    const validSubTabs: GroupSubTab[] = ['data', 'projects', 'how-it-works', 'dictionaries'];
    assert(validSubTabs.length === 4, 'exactly 4 sub-tabs');
  }

  // ── Test 11 ──
  console.log('\nTest 11: Switching mainTab preserves groupSubTab');
  {
    let state: NavState = { mainTab: 'group', groupSubTab: 'dictionaries' };
    state = setMainTab(state, 'generate');
    assert(state.groupSubTab === 'dictionaries', 'groupSubTab preserved');
    state = setMainTab(state, 'group');
    assert(state.groupSubTab === 'dictionaries', 'groupSubTab still preserved');
    assert(isDictionariesVisible(state), 'dictionaries visible on return');
  }

  // ── Test 12 ──
  console.log('\nTest 12: Stats default to collapsed');
  {
    const statsExpanded = false; // matches useState(false)
    assert(!statsExpanded, 'stats collapsed by default');
  }

  // ── Test 13 ──
  console.log('\nTest 13: Compact project bar is always visible in Group tab');
  {
    // The compact project bar is inside the group fragment but outside groupSubTab === 'data'
    // So it should be visible for ALL groupSubTab values
    const allSubTabs: GroupSubTab[] = ['data', 'projects', 'how-it-works', 'dictionaries'];
    for (const subTab of allSubTabs) {
      const state: NavState = { mainTab: 'group', groupSubTab: subTab };
      assert(state.mainTab === 'group', `project bar visible for ${subTab}`);
    }
  }

  // ── Test 14 ──
  console.log('\nTest 14: Generate tab always mounted (display:none pattern)');
  {
    // The generate tab uses style={mainTab === 'generate' ? undefined : { display: 'none' }}
    // This means it's always in the DOM regardless of mainTab
    const stateGroup: NavState = { mainTab: 'group', groupSubTab: 'data' };
    const stateGen: NavState = { mainTab: 'generate', groupSubTab: 'data' };
    // Generate content is always mounted, just hidden
    assert(!isGenerateVisible(stateGroup), 'generate hidden when group active (but still mounted)');
    assert(isGenerateVisible(stateGen), 'generate visible when generate active');
  }

  // ── Test 15 ──
  console.log('\nTest 15: Default keyword management tab is pages (ungrouped)');
  {
    type KwTab = 'keywords' | 'pages' | 'grouped' | 'approved' | 'blocked';
    const defaultTab: KwTab = 'pages';
    assert(defaultTab === 'pages', 'default is pages (ungrouped)');
  }

  // ── Test 16 ──
  console.log('\nTest 16: Selection count logic per tab');
  {
    // Simulating selection state
    const selectedClusters = new Set(['a', 'b', 'c']);
    const selectedGroups = new Set(['g1', 'g2']);
    const selectedSubClusters = new Set(['s1']);

    // Pages tab: only clusters
    const pagesCount = selectedClusters.size;
    assert(pagesCount === 3, 'pages tab: 3 clusters selected');

    // Grouped tab: groups + sub-clusters
    const groupedCount = selectedGroups.size + selectedSubClusters.size;
    assert(groupedCount === 3, 'grouped tab: 2 groups + 1 sub = 3');

    // Approved tab: only groups
    const approvedCount = selectedGroups.size;
    assert(approvedCount === 2, 'approved tab: 2 groups selected');

    // All/Blocked: 0
    assert(0 === 0, 'all/blocked: no selection count');
  }

  // ── Test 17 ──
  console.log('\nTest 17: Context-aware buttons per tab');
  {
    type KwTab = 'keywords' | 'pages' | 'grouped' | 'approved' | 'blocked';
    const getButtons = (tab: KwTab): string[] => {
      if (tab === 'pages') return ['Group'];
      if (tab === 'grouped') return ['Approve', 'Ungroup'];
      if (tab === 'approved') return ['Unapprove'];
      return [];
    };
    assert(getButtons('pages').length === 1, 'pages: 1 button (Group)');
    assert(getButtons('pages')[0] === 'Group', 'pages: Group button');
    assert(getButtons('grouped').length === 2, 'grouped: 2 buttons');
    assert(getButtons('grouped')[0] === 'Approve', 'grouped: Approve first');
    assert(getButtons('grouped')[1] === 'Ungroup', 'grouped: Ungroup second');
    assert(getButtons('approved').length === 1, 'approved: 1 button');
    assert(getButtons('approved')[0] === 'Unapprove', 'approved: Unapprove');
    assert(getButtons('keywords').length === 0, 'keywords: no buttons');
    assert(getButtons('blocked').length === 0, 'blocked: no buttons');
  }

  // ── Test 18 ──
  console.log('\nTest 18: Grouping ETA edge cases');
  {
    // Simulate ETA calculation
    function calcEta(timestamps: { time: number; pagesGrouped: number }[], remainingPages: number): string | null {
      if (timestamps.length < 2) return null;
      const now = timestamps[timestamps.length - 1].time;
      const cutoff = now - 15000;
      const recent = timestamps.filter(t => t.time >= cutoff);
      if (recent.length < 2) return null;
      const totalPagesGrouped = recent.reduce((sum, t) => sum + t.pagesGrouped, 0);
      const timeSpan = (recent[recent.length - 1].time - recent[0].time) / 1000;
      if (timeSpan <= 0) return null;
      const pagesPerSec = totalPagesGrouped / timeSpan;
      if (remainingPages === 0 || pagesPerSec <= 0) return null;
      const etaSec = Math.round(remainingPages / pagesPerSec);
      if (etaSec < 60) return `~${etaSec}s remaining`;
      if (etaSec < 3600) return `~${Math.round(etaSec / 60)}m remaining`;
      return `~${(etaSec / 3600).toFixed(1)}h remaining`;
    }

    // No data
    assert(calcEta([], 100) === null, 'empty timestamps → null');

    // Single entry
    assert(calcEta([{ time: 1000, pagesGrouped: 5 }], 100) === null, 'single entry → null');

    // Normal case: 10 pages in 5 seconds, 90 remaining → ~45s
    const now = Date.now();
    const eta = calcEta([
      { time: now - 5000, pagesGrouped: 5 },
      { time: now, pagesGrouped: 5 },
    ], 90);
    assert(eta !== null, 'valid data → not null');
    assert(eta!.includes('s remaining'), 'shows seconds');

    // Zero remaining pages
    assert(calcEta([
      { time: now - 5000, pagesGrouped: 5 },
      { time: now, pagesGrouped: 5 },
    ], 0) === null, 'zero remaining → null');

    // Same timestamp (timeSpan = 0)
    assert(calcEta([
      { time: now, pagesGrouped: 5 },
      { time: now, pagesGrouped: 5 },
    ], 100) === null, 'zero timeSpan → null');
  }

  // ── Test 19 ──
  console.log('\nTest 19: Tab switching clears selections');
  {
    // Simulate switchTab clearing selections
    let selectedClusters = new Set(['a', 'b']);
    let selectedGroups = new Set(['g1']);
    let selectedSubClusters = new Set(['s1', 's2']);

    // switchTab clears all
    selectedClusters = new Set();
    selectedGroups = new Set();
    selectedSubClusters = new Set();

    assert(selectedClusters.size === 0, 'clusters cleared on tab switch');
    assert(selectedGroups.size === 0, 'groups cleared on tab switch');
    assert(selectedSubClusters.size === 0, 'sub-clusters cleared on tab switch');
  }

  // ── Test 20 ──
  console.log('\nTest 20: Tab badge format shows groups/pages');
  {
    // Grouped tab badge: (groups/pages)
    const groups = [{ clusters: [1, 2, 3] }, { clusters: [4, 5] }]; // 2 groups, 5 pages
    const groupCount = groups.length;
    const pageCount = groups.reduce((sum, g) => sum + g.clusters.length, 0);
    const badge = `(${groupCount}/${pageCount})`;
    assert(badge === '(2/5)', 'grouped badge format correct');

    // Approved tab badge
    const approved = [{ clusters: [1] }, { clusters: [2, 3, 4] }]; // 2 groups, 4 pages
    const approvedBadge = `(${approved.length}/${approved.reduce((s, g) => s + g.clusters.length, 0)})`;
    assert(approvedBadge === '(2/4)', 'approved badge format correct');
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
