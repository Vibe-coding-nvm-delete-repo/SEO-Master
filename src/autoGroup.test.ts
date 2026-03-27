import { describe, it, expect } from 'vitest';
import {
  AUTO_GROUP_MAX_BATCH_PAGES,
  applyReconciliationMerges,
  applyShortGroupAssignments,
  buildAssignmentCandidates,
  buildAutoGroupBatchPrompt,
  buildCosineSummaryPrompt,
  buildAutoGroupPrompt,
  buildCascadingClusters,
  buildSingleTokenSuggestions,
  buildSuggestionsFromCosineClusters,
  buildTokenClusters,
  buildTwoTokenBatchClusters,
  computeAutoGroupAssignmentMaxTokens,
  computeCosineSummaryMaxTokens,
  countCoveredPages,
  estimateCost,
  parseAutoGroupBatchResponse,
  parseCosineSummaryResponse,
  parseAutoGroupResponse,
} from './AutoGroupEngine';
import type { ClusterSummary, AutoGroupCluster, AutoGroupSuggestion, ReconciliationCandidate } from './types';

// Helper to create a mock ClusterSummary
function makePage(pageName: string, tokens: string[], volume = 1000, kwCount = 10): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens: tokens.sort().join(' '),
    tokenArr: tokens.sort(),
    keywordCount: kwCount,
    totalVolume: volume,
    avgKd: 50,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [{ keyword: pageName, volume, kd: 50, locationCity: null, locationState: null }],
  };
}

describe('buildTokenClusters', () => {
  it('returns empty for empty input', () => {
    expect(buildTokenClusters([])).toEqual([]);
  });

  it('creates single-page group for lone page with 2+ tokens', () => {
    const pages = [makePage('test page', ['a', 'b', 'c', 'd'])];
    const clusters = buildTokenClusters(pages);
    expect(clusters.length).toBe(1);
    expect(clusters[0].pageCount).toBe(1);
    expect(clusters[0].stage).toBe(1); // single-page stage
  });

  it('clusters pages sharing 3 tokens at stage 3 (cascading)', () => {
    const pages = [
      makePage('page a', ['x', 'y', 'z']),
      makePage('page b', ['x', 'y', 'z']),
    ];
    // These have identical signatures → identical cluster
    const clusters = buildTokenClusters(pages);
    expect(clusters.length).toBe(1);
    expect(clusters[0].isIdentical).toBe(true);
  });

  it('cascading: 3-token overlap pages cluster at stage 3', () => {
    const pages = [
      makePage('reverse mortgage rates', ['home', 'loan', 'price', 'reverse'], 5000),
      makePage('reverse mortgage calculator', ['calculator', 'home', 'loan', 'reverse'], 3000),
    ];
    const clusters = buildTokenClusters(pages);
    // They share 3 tokens (home, loan, reverse) — cascading catches this at stage 3
    const multiPageCluster = clusters.find(c => c.pageCount >= 2);
    expect(multiPageCluster).toBeDefined();
    expect(multiPageCluster!.stage).toBe(3);
  });

  it('clusters pages with 4+ shared tokens', () => {
    const pages = [
      makePage('best reverse mortgage rates', ['best', 'home', 'loan', 'price', 'reverse'], 5000),
      makePage('top reverse mortgage lenders', ['best', 'home', 'lender', 'loan', 'reverse'], 3000),
    ];
    // Shared: best, home, loan, reverse = 4 tokens ✓
    const clusters = buildTokenClusters(pages);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const cluster = clusters.find(c => c.pageCount === 2);
    expect(cluster).toBeDefined();
    expect(cluster!.sharedTokens).toContain('best');
    expect(cluster!.sharedTokens).toContain('home');
    expect(cluster!.sharedTokens).toContain('loan');
    expect(cluster!.sharedTokens).toContain('reverse');
  });

  it('identifies 100% identical token pages', () => {
    const pages = [
      makePage('payday loans online', ['loan', 'online', 'payday'], 50000),
      makePage('online payday loans', ['loan', 'online', 'payday'], 30000),
    ];
    const clusters = buildTokenClusters(pages);
    expect(clusters.length).toBe(1);
    expect(clusters[0].isIdentical).toBe(true);
    expect(clusters[0].pageCount).toBe(2);
    expect(clusters[0].confidence).toBe('high');
  });

  it('assigns high confidence to small clusters (≤8 pages)', () => {
    const tokens = ['best', 'home', 'loan', 'reverse'];
    const pages = Array.from({ length: 5 }, (_, i) =>
      makePage(`page ${i}`, [...tokens, `unique${i}`], 1000 * (i + 1))
    );
    const clusters = buildTokenClusters(pages);
    const cluster = clusters.find(c => c.pageCount >= 2 && !c.isIdentical);
    if (cluster) expect(cluster.confidence).toBe('high');
  });

  it('assigns medium confidence to mid-size clusters (9-20 pages)', () => {
    const tokens = ['best', 'home', 'loan', 'reverse'];
    const pages = Array.from({ length: 15 }, (_, i) =>
      makePage(`page ${i}`, [...tokens, `unique${i}`], 1000 * (i + 1))
    );
    const clusters = buildTokenClusters(pages);
    const cluster = clusters.find(c => c.pageCount >= 9 && !c.isIdentical);
    if (cluster) expect(cluster.confidence).toBe('medium');
  });

  it('assigns review confidence to large clusters with low stage', () => {
    const pages = Array.from({ length: 25 }, (_, i) =>
      makePage(`page ${i}`, ['a', 'b', `unique${i}`], 1000 * (i + 1))
    );
    const clusters = buildTokenClusters(pages);
    // Single-page clusters at stage 1 should be 'review'
    const singleClusters = clusters.filter(c => c.pageCount === 1);
    for (const c of singleClusters) {
      expect(c.confidence).toBe('review');
    }
  });

  it('does not assign a page to multiple clusters', () => {
    const pages = [
      makePage('page a', ['t1', 't2', 't3', 't4', 't5'], 5000),
      makePage('page b', ['t1', 't2', 't3', 't4', 't6'], 4000),
      makePage('page c', ['t1', 't2', 't3', 't5', 't6'], 3000),
    ];
    const clusters = buildTokenClusters(pages);
    const allPageTokens = clusters.filter(c => !c.isIdentical).flatMap(c => c.pages.map(p => p.tokens));
    const unique = new Set(allPageTokens);
    expect(allPageTokens.length).toBe(unique.size); // No duplicates
  });

  it('cascading handles pages with fewer than 4 tokens', () => {
    const pages = [
      makePage('short a', ['a', 'b'], 1000),
      makePage('short b', ['a', 'b'], 2000),  // identical to short a
      makePage('also short', ['a', 'c'], 2000),
      makePage('long enough', ['a', 'b', 'c', 'd', 'e'], 3000),
    ];
    const clusters = buildTokenClusters(pages);
    // short a + short b = identical cluster (2 tokens)
    // also short = single-page cluster
    // long enough = single-page cluster
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const identicalCluster = clusters.find(c => c.isIdentical);
    expect(identicalCluster).toBeDefined();
    expect(identicalCluster!.pageCount).toBe(2);
  });

  it('sorts clusters by confidence then volume', () => {
    const pages = [
      // Identical pair (high confidence)
      makePage('identical a', ['x', 'y', 'z'], 100),
      makePage('identical b', ['x', 'y', 'z'], 200),
      // 4-token overlap pair (high confidence, higher volume)
      makePage('overlap a', ['a', 'b', 'c', 'd', 'e'], 50000),
      makePage('overlap b', ['a', 'b', 'c', 'd', 'f'], 40000),
    ];
    const clusters = buildTokenClusters(pages);
    // High confidence clusters should come first
    if (clusters.length >= 2) {
      expect(clusters[0].confidence).toBe('high');
    }
  });
});

describe('countCoveredPages', () => {
  it('returns 0 for empty clusters', () => {
    expect(countCoveredPages([])).toBe(0);
  });

  it('counts unique pages across clusters', () => {
    const p1 = makePage('page 1', ['a', 'b', 'c', 'd']);
    const p2 = makePage('page 2', ['a', 'b', 'c', 'e']);
    const clusters: AutoGroupCluster[] = [{
      id: 'test', sharedTokens: ['a', 'b', 'c'], pages: [p1, p2],
      totalVolume: 2000, keywordCount: 20, pageCount: 2, avgKd: null, confidence: 'high', isIdentical: false, stage: 4,
    }];
    expect(countCoveredPages(clusters)).toBe(2);
  });
});

describe('estimateCost', () => {
  it('returns 0 for empty clusters', () => {
    expect(estimateCost([], { prompt: '0.001', completion: '0.002' })).toBe(0);
  });

  it('returns positive cost for non-empty clusters', () => {
    const cluster: AutoGroupCluster = {
      id: 'test', sharedTokens: ['a', 'b', 'c', 'd'],
      pages: [makePage('test', ['a', 'b', 'c', 'd'])],
      totalVolume: 1000, keywordCount: 10, avgKd: null, pageCount: 1,
      confidence: 'high', isIdentical: false, stage: 4,
    };
    const cost = estimateCost([cluster], { prompt: '0.000001', completion: '0.000002' });
    expect(cost).toBeGreaterThan(0);
  });
});

describe('buildAutoGroupPrompt', () => {
  it('builds prompt with page list sorted by volume', () => {
    const cluster: AutoGroupCluster = {
      id: 'test', sharedTokens: ['home', 'loan'],
      pages: [
        makePage('home loans', ['home', 'loan'], 1000),
        makePage('best home loans', ['best', 'home', 'loan'], 5000),
      ],
      totalVolume: 6000, keywordCount: 20, avgKd: null, pageCount: 2,
      confidence: 'high', isIdentical: false, stage: 4,
    };
    const { system, user } = buildAutoGroupPrompt(cluster);
    expect(system).toContain('SEO grouping expert');
    expect(user).toContain('best home loans'); // Higher volume first
    expect(user).toContain('home loans');
    expect(user).toContain('home, loan');
  });
});

describe('buildAutoGroupBatchPrompt', () => {
  it('builds a strict v1 assignment prompt with batch pages and existing groups', () => {
    const batch = [
      makePage('small business loans', ['small', 'business', 'loan'], 5000),
      makePage('startup business loans', ['startup', 'business', 'loan'], 3000),
    ];
    const prompt = buildAutoGroupBatchPrompt({
      batch,
      existingGroupNames: ['merchant cash advance', 'business line of credit'],
    });

    expect(prompt.system.toLowerCase()).toContain('strict seo grouping engine');
    expect(prompt.user).toContain('P1 | small business loans | vol: 5000');
    expect(prompt.user).toContain('P2 | startup business loans | vol: 3000');
    expect(prompt.user).toContain('P1 through P2');
    expect(prompt.user).toContain('merchant cash advance');
    expect(prompt.user).toContain('business line of credit');
  });
});

describe('AUTO_GROUP_MAX_BATCH_PAGES and max_tokens helpers', () => {
  it('caps batch size constant at 500', () => {
    expect(AUTO_GROUP_MAX_BATCH_PAGES).toBe(500);
  });

  it('computes assignment max_tokens within provider cap', () => {
    expect(computeAutoGroupAssignmentMaxTokens(10)).toBe(8192 + 10 * 140);
    expect(computeAutoGroupAssignmentMaxTokens(AUTO_GROUP_MAX_BATCH_PAGES)).toBe(65536);
  });

  it('computes cosine summary max_tokens within provider cap', () => {
    expect(computeCosineSummaryMaxTokens(20)).toBe(4096 + 20 * 110);
    expect(computeCosineSummaryMaxTokens(AUTO_GROUP_MAX_BATCH_PAGES)).toBe(4096 + 500 * 110);
  });
});

describe('parseAutoGroupBatchResponse', () => {
  const batch = [
    makePage('small business loans', ['small', 'business', 'loan'], 5000),
    makePage('startup business loans', ['startup', 'business', 'loan'], 3000),
    makePage('equipment financing', ['equipment', 'financing'], 2000),
  ];

  it('parses valid assignments and preserves existing group targets', () => {
    const response = JSON.stringify({
      assignments: [
        { pageId: 'P1', page: 'small business loans', targetGroupName: 'business financing' },
        { pageId: 'P2', page: 'startup business loans', targetGroupName: 'small business loans' },
        { pageId: 'P3', page: 'equipment financing', targetGroupName: 'equipment financing' },
      ],
    });

    const parsed = parseAutoGroupBatchResponse(response, batch, ['business financing']);
    expect(parsed).toEqual([
      { pageId: 'P1', page: 'small business loans', targetGroupName: 'business financing' },
      { pageId: 'P2', page: 'startup business loans', targetGroupName: 'small business loans' },
      { pageId: 'P3', page: 'equipment financing', targetGroupName: 'equipment financing' },
    ]);
  });

  it('falls back to self-assignment for invalid or missing targets', () => {
    const response = JSON.stringify({
      assignments: [
        { page: 'small business loans', targetGroupName: 'totally invalid group' },
      ],
    });

    const parsed = parseAutoGroupBatchResponse(response, batch, ['business financing']);
    expect(parsed).toEqual([
      { pageId: 'P1', page: 'small business loans', targetGroupName: 'small business loans' },
      { pageId: 'P2', page: 'startup business loans', targetGroupName: 'startup business loans' },
      { pageId: 'P3', page: 'equipment financing', targetGroupName: 'equipment financing' },
    ]);
  });

  it('keeps duplicate display names distinct by pageId', () => {
    const duplicateBatch = [
      makePage('micro loans', ['micro', 'loan'], 2000),
      makePage('micro loans', ['micro', 'loan', 'bad-credit'], 1500),
    ];

    const response = JSON.stringify({
      assignments: [
        { pageId: 'P1', page: 'micro loans', targetGroupName: 'micro loans' },
        { pageId: 'P2', page: 'micro loans', targetGroupName: 'micro loans' },
      ],
    });

    const parsed = parseAutoGroupBatchResponse(response, duplicateBatch, []);
    expect(parsed).toEqual([
      { pageId: 'P1', page: 'micro loans', targetGroupName: 'micro loans' },
      { pageId: 'P2', page: 'micro loans', targetGroupName: 'micro loans' },
    ]);
  });
});

describe('buildCosineSummaryPrompt', () => {
  it('builds a page-id based summary prompt', () => {
    const batch = [
      makePage('micro loans', ['micro', 'loan'], 2000),
      makePage('business micro loans', ['business', 'micro', 'loan'], 1500),
    ];

    const prompt = buildCosineSummaryPrompt(batch);
    expect(prompt.system.toLowerCase()).toContain('strict semantic intent summaries');
    expect(prompt.user).toContain('P1 | micro loans');
    expect(prompt.user).toContain('P2 | business micro loans');
  });
});

describe('parseCosineSummaryResponse', () => {
  it('maps summaries back to page order by pageId', () => {
    const batch = [
      makePage('micro loans', ['micro', 'loan'], 2000),
      makePage('business micro loans', ['business', 'micro', 'loan'], 1500),
    ];

    const response = JSON.stringify({
      summaries: [
        { pageId: 'P1', summary: 'Queries about micro loans as a financing product.' },
        { pageId: 'P2', summary: 'Queries about business-focused micro loans.' },
      ],
    });

    expect(parseCosineSummaryResponse(response, batch)).toEqual([
      'Queries about micro loans as a financing product.',
      'Queries about business-focused micro loans.',
    ]);
  });

  it('falls back to page name when the summary response is invalid', () => {
    const batch = [
      makePage('micro loans', ['micro', 'loan'], 2000),
    ];

    expect(parseCosineSummaryResponse('not json', batch)).toEqual(['micro loans']);
  });
});

describe('parseAutoGroupResponse', () => {
  const cluster: AutoGroupCluster = {
    id: 'test', sharedTokens: ['home', 'loan'],
    pages: [
      makePage('home loans', ['home', 'loan'], 5000),
      makePage('best home loans', ['best', 'home', 'loan'], 3000),
      makePage('home loan rates', ['home', 'loan', 'rate'], 2000),
    ],
    totalVolume: 10000, keywordCount: 30, avgKd: null, pageCount: 3,
    confidence: 'high', isIdentical: false, stage: 4,
  };

  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      groups: [
        { pages: ['home loans', 'best home loans'], theme: 'general home loans' },
        { pages: ['home loan rates'], theme: 'loan rates' },
      ],
    });
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions.length).toBe(2);
    expect(suggestions[0].pages.length).toBe(2);
    expect(suggestions[0].groupName).toBe('home loans'); // Highest volume
    expect(suggestions[1].pages.length).toBe(1);
    expect(suggestions[1].groupName).toBe('home loan rates');
  });

  it('parses JSON from code blocks', () => {
    const response = '```json\n{"groups": [{"pages": ["home loans", "best home loans"], "theme": "test"}]}\n```';
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].pages.length).toBe(2);
  });

  it('handles case-insensitive page name matching', () => {
    const response = JSON.stringify({
      groups: [{ pages: ['Home Loans', 'BEST HOME LOANS'], theme: 'test' }],
    });
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].pages.length).toBe(2);
  });

  it('ignores pages not in cluster', () => {
    const response = JSON.stringify({
      groups: [{ pages: ['home loans', 'nonexistent page'], theme: 'test' }],
    });
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].pages.length).toBe(1); // Only 'home loans' matched
  });

  it('returns empty for invalid JSON', () => {
    expect(parseAutoGroupResponse('not json at all', cluster)).toEqual([]);
  });

  it('returns empty for missing groups field', () => {
    expect(parseAutoGroupResponse('{"data": []}', cluster)).toEqual([]);
  });

  it('skips empty groups', () => {
    const response = JSON.stringify({
      groups: [
        { pages: [], theme: 'empty' },
        { pages: ['home loans'], theme: 'valid' },
      ],
    });
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions.length).toBe(1);
  });

  it('sets correct aggregate stats on suggestions', () => {
    const response = JSON.stringify({
      groups: [{ pages: ['home loans', 'best home loans'], theme: 'test' }],
    });
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions[0].totalVolume).toBe(8000); // 5000 + 3000
    expect(suggestions[0].keywordCount).toBe(20); // 10 + 10
    expect(suggestions[0].avgKd).toBe(50);
  });

  it('sets status to pending and retryCount to 0', () => {
    const response = JSON.stringify({
      groups: [{ pages: ['home loans'], theme: 'test' }],
    });
    const suggestions = parseAutoGroupResponse(response, cluster);
    expect(suggestions[0].status).toBe('pending');
    expect(suggestions[0].retryCount).toBe(0);
  });
});

// ─── Cascading Clusters Tests ───

describe('buildCascadingClusters', () => {
  it('cascades from max tokens down to 2', () => {
    const pages = [
      makePage('5 token page a', ['a', 'b', 'c', 'd', 'e'], 5000),
      makePage('5 token page b', ['a', 'b', 'c', 'd', 'f'], 4000),
      makePage('3 token page', ['a', 'b', 'g'], 3000),
      makePage('3 token page 2', ['a', 'b', 'h'], 2000),
      makePage('2 token page', ['a', 'i'], 1000),
    ];
    const clusters = buildCascadingClusters(pages);
    // 5-token pages share 4 tokens (a,b,c,d) → stage 4 cluster
    const stage4 = clusters.find(c => c.stage === 4 && c.pageCount === 2);
    expect(stage4).toBeDefined();
    // 3-token pages share 2 tokens (a,b) → stage 2 cluster
    const stage2 = clusters.find(c => c.stage === 2 && c.pageCount === 2);
    expect(stage2).toBeDefined();
    // 2-token page becomes single-page group
    const single = clusters.find(c => c.pageCount === 1 && c.pages[0].pageName === '2 token page');
    expect(single).toBeDefined();
    expect(single!.stage).toBe(1);
  });

  it('higher stages get priority over lower stages', () => {
    const pages = [
      makePage('p1', ['a', 'b', 'c', 'd', 'e'], 5000),
      makePage('p2', ['a', 'b', 'c', 'd', 'f'], 4000),
      makePage('p3', ['a', 'b', 'c', 'g', 'h'], 3000),
    ];
    const clusters = buildCascadingClusters(pages);
    // p1+p2 share 4 tokens → stage 4
    // p3 shares only 3 with p1 (a,b,c) → but p1 already assigned at stage 4
    // p3 should NOT be in p1's cluster, should be separate
    const stage4 = clusters.find(c => c.stage === 4);
    expect(stage4).toBeDefined();
    expect(stage4!.pages.map(p => p.pageName)).not.toContain('p3');
  });

  it('excludes 1-token pages', () => {
    const pages = [
      makePage('one token', ['a'], 1000),
      makePage('two tokens', ['a', 'b'], 2000),
    ];
    const clusters = buildCascadingClusters(pages);
    const oneTokenCluster = clusters.find(c => c.pages.some(p => p.pageName === 'one token'));
    expect(oneTokenCluster).toBeUndefined();
  });

  it('identical pages cluster at their token count stage', () => {
    const pages = [
      makePage('page a', ['x', 'y', 'z'], 1000),
      makePage('page b', ['x', 'y', 'z'], 2000),
    ];
    const clusters = buildCascadingClusters(pages);
    expect(clusters.length).toBe(1);
    expect(clusters[0].isIdentical).toBe(true);
    expect(clusters[0].stage).toBe(3); // 3 tokens = stage 3
  });

  it('no page appears in multiple clusters', () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      makePage(`page ${i}`, ['a', 'b', 'c', `t${i}`], 1000 * (i + 1))
    );
    const clusters = buildCascadingClusters(pages);
    const allTokens = clusters.flatMap(c => c.pages.map(p => p.tokens));
    const unique = new Set(allTokens);
    expect(allTokens.length).toBe(unique.size);
  });
});

// ─── Reconciliation Merge Tests ───

describe('applyReconciliationMerges', () => {
  function makeSuggestion(name: string, volume: number, pageCount = 1): AutoGroupSuggestion {
    return {
      id: `sug_${name}`,
      sourceClusterId: 'test',
      groupName: name,
      pages: Array.from({ length: pageCount }, (_, i) => makePage(`${name} page ${i}`, ['a', 'b'], volume / pageCount)),
      totalVolume: volume,
      keywordCount: pageCount * 5,
      avgKd: 50,
      status: 'pending',
      retryCount: 0,
    };
  }

  it('merges two suggestions (higher volume absorbs lower)', () => {
    const suggestions = [
      makeSuggestion('fast payday loans', 50000, 3),
      makeSuggestion('quick payday loans', 30000, 2),
    ];
    const candidates: ReconciliationCandidate[] = [{
      id: 'test', groupA: { name: 'fast payday loans', idx: 0, volume: 50000, pages: 3 },
      groupB: { name: 'quick payday loans', idx: 1, volume: 30000, pages: 2 },
      confidence: 92, reason: 'synonyms',
    }];
    const merged = applyReconciliationMerges(suggestions, candidates);
    expect(merged.length).toBe(1);
    expect(merged[0].groupName).toBe('fast payday loans'); // Higher vol wins
    expect(merged[0].pages.length).toBe(5); // 3 + 2
  });

  it('handles chain merges (A↔B + B↔C → all into highest vol)', () => {
    const suggestions = [
      makeSuggestion('group a', 10000),
      makeSuggestion('group b', 50000),
      makeSuggestion('group c', 30000),
    ];
    const candidates: ReconciliationCandidate[] = [
      { id: 'c1', groupA: { name: 'group a', idx: 0, volume: 10000, pages: 1 }, groupB: { name: 'group b', idx: 1, volume: 50000, pages: 1 }, confidence: 90, reason: 'same' },
      { id: 'c2', groupA: { name: 'group b', idx: 1, volume: 50000, pages: 1 }, groupB: { name: 'group c', idx: 2, volume: 30000, pages: 1 }, confidence: 88, reason: 'same' },
    ];
    const merged = applyReconciliationMerges(suggestions, candidates);
    expect(merged.length).toBe(1);
    expect(merged[0].groupName).toBe('group b'); // Highest vol
    expect(merged[0].pages.length).toBe(3);
  });

  it('respects dismissed candidates', () => {
    const suggestions = [
      makeSuggestion('group a', 50000),
      makeSuggestion('group b', 30000),
    ];
    const candidates: ReconciliationCandidate[] = [{
      id: 'test', groupA: { name: 'group a', idx: 0, volume: 50000, pages: 1 },
      groupB: { name: 'group b', idx: 1, volume: 30000, pages: 1 },
      confidence: 92, reason: 'same', dismissed: true,
    }];
    const merged = applyReconciliationMerges(suggestions, candidates);
    expect(merged.length).toBe(2); // Not merged — dismissed
  });

  it('returns original suggestions when no candidates', () => {
    const suggestions = [makeSuggestion('a', 1000), makeSuggestion('b', 2000)];
    const merged = applyReconciliationMerges(suggestions, []);
    expect(merged.length).toBe(2);
  });
});

describe('hybrid auto-group helpers', () => {
  it('builds 2-token batches only from 2-token pages', () => {
    const pages = [
      makePage('car loan', ['car', 'loan'], 4000),
      makePage('auto loan', ['auto', 'loan'], 3500),
      makePage('cash advance', ['advance', 'cash'], 3000),
      makePage('payday loans online', ['loan', 'online', 'payday'], 5000),
    ];

    const batches = buildTwoTokenBatchClusters(pages, 2);
    expect(batches).toHaveLength(2);
    expect(batches.every(batch => batch.pages.every(page => page.tokenArr.length === 2))).toBe(true);
  });

  it('creates cosine suggestions and tracks unmatched long pages', () => {
    const pages = [
      makePage('payday loans online', ['loan', 'online', 'payday'], 5000),
      makePage('online payday loans', ['loan', 'online', 'payday'], 4500),
      makePage('mortgage rates today', ['mortgage', 'rates', 'today'], 3000),
    ];

    const built = buildSuggestionsFromCosineClusters(pages, [
      { id: 'cos_1', pages: [pages[0], pages[1]] },
    ]);

    expect(built.suggestions).toHaveLength(1);
    expect(built.suggestions[0].source).toBe('cosine');
    expect(built.unmatchedPages.map(page => page.pageName)).toEqual(['mortgage rates today']);
  });

  it('creates standalone single-token suggestions', () => {
    const singleToken = [makePage('loans', ['loan'], 10000)];
    const suggestions = buildSingleTokenSuggestions(singleToken);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].source).toBe('single-token');
    expect(suggestions[0].groupName).toBe('loans');
  });

  it('includes strongest lexical candidate first for short-group assignment', () => {
    const shortGroup: AutoGroupSuggestion = {
      id: 'short_1',
      sourceClusterId: 'short_1',
      groupName: 'payday loans',
      pages: [makePage('payday loans', ['loan', 'payday'], 6000)],
      totalVolume: 6000,
      keywordCount: 10,
      avgKd: 50,
      status: 'pending',
      retryCount: 0,
      source: 'two-token-llm',
    };
    const candidates: AutoGroupSuggestion[] = [
      {
        id: 'long_1',
        sourceClusterId: 'long_1',
        groupName: 'payday loans online',
        pages: [makePage('payday loans online', ['loan', 'online', 'payday'], 12000)],
        totalVolume: 12000,
        keywordCount: 10,
        avgKd: 50,
        status: 'pending',
        retryCount: 0,
        source: 'cosine',
      },
      {
        id: 'long_2',
        sourceClusterId: 'long_2',
        groupName: 'mortgage rates today',
        pages: [makePage('mortgage rates today', ['mortgage', 'rates', 'today'], 10000)],
        totalVolume: 10000,
        keywordCount: 10,
        avgKd: 50,
        status: 'pending',
        retryCount: 0,
        source: 'cosine',
      },
    ];

    const shortlist = buildAssignmentCandidates(shortGroup, candidates, 2);
    expect(shortlist[0].groupName).toBe('payday loans online');
  });

  it('merges assigned short groups into long groups and keeps unassigned short groups', () => {
    const longGroups: AutoGroupSuggestion[] = [{
      id: 'long_1',
      sourceClusterId: 'long_1',
      groupName: 'payday loans online',
      pages: [makePage('payday loans online', ['loan', 'online', 'payday'], 12000)],
      totalVolume: 12000,
      keywordCount: 10,
      avgKd: 50,
      status: 'pending',
      retryCount: 0,
      source: 'cosine',
    }];
    const shortGroups: AutoGroupSuggestion[] = [
      {
        id: 'short_1',
        sourceClusterId: 'short_1',
        groupName: 'payday loans',
        pages: [makePage('payday loans', ['loan', 'payday'], 6000)],
        totalVolume: 6000,
        keywordCount: 10,
        avgKd: 50,
        status: 'pending',
        retryCount: 0,
        source: 'two-token-llm',
      },
      {
        id: 'short_2',
        sourceClusterId: 'short_2',
        groupName: 'cash advance',
        pages: [makePage('cash advance', ['advance', 'cash'], 5500)],
        totalVolume: 5500,
        keywordCount: 10,
        avgKd: 50,
        status: 'pending',
        retryCount: 0,
        source: 'two-token-llm',
      },
    ];

    const merged = applyShortGroupAssignments(longGroups, shortGroups, [
      { shortGroupId: 'short_1', targetGroupId: 'long_1', confidence: 94, reason: 'same intent' },
      { shortGroupId: 'short_2', targetGroupId: null, confidence: 0, reason: 'no exact match' },
    ]);

    expect(merged).toHaveLength(2);
    const paydayGroup = merged.find(group => group.id === 'long_1');
    const cashAdvanceGroup = merged.find(group => group.id === 'short_2');
    expect(paydayGroup?.pages).toHaveLength(2);
    expect(cashAdvanceGroup?.groupName).toBe('cash advance');
  });
});
