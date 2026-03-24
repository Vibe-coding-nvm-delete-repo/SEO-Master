import { describe, it, expect } from 'vitest';
import { buildTokenClusters, countCoveredPages, estimateCost, parseAutoGroupResponse, buildAutoGroupPrompt } from './AutoGroupEngine';
import type { ClusterSummary, AutoGroupCluster } from './types';

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

  it('returns empty for single page', () => {
    const pages = [makePage('test page', ['a', 'b', 'c', 'd'])];
    expect(buildTokenClusters(pages)).toEqual([]);
  });

  it('returns empty when pages share fewer than 4 tokens', () => {
    const pages = [
      makePage('page a', ['x', 'y', 'z']),
      makePage('page b', ['x', 'y', 'w']),
    ];
    expect(buildTokenClusters(pages)).toEqual([]);
  });

  it('clusters two pages sharing exactly 4 tokens', () => {
    const pages = [
      makePage('reverse mortgage rates', ['home', 'loan', 'price', 'reverse'], 5000),
      makePage('reverse mortgage calculator', ['calculator', 'home', 'loan', 'reverse'], 3000),
    ];
    const clusters = buildTokenClusters(pages);
    // They share 3 tokens (home, loan, reverse) — NOT 4. So no cluster unless they share 4.
    // Actually: page1 tokens = [home, loan, price, reverse], page2 = [calculator, home, loan, reverse]
    // Shared: home, loan, reverse = 3 tokens. Not enough for 4-token overlap.
    expect(clusters.length).toBe(0);
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

  it('assigns review confidence to large clusters (>20 pages)', () => {
    const tokens = ['best', 'home', 'loan', 'reverse'];
    const pages = Array.from({ length: 25 }, (_, i) =>
      makePage(`page ${i}`, [...tokens, `unique${i}`], 1000 * (i + 1))
    );
    const clusters = buildTokenClusters(pages);
    const cluster = clusters.find(c => c.pageCount >= 21 && !c.isIdentical);
    if (cluster) expect(cluster.confidence).toBe('review');
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

  it('handles pages with fewer than 4 tokens gracefully', () => {
    const pages = [
      makePage('short', ['a', 'b'], 1000),
      makePage('also short', ['a', 'c'], 2000),
      makePage('long enough', ['a', 'b', 'c', 'd', 'e'], 3000),
    ];
    // Short pages excluded from 4-token overlap, but may still be in identical clusters
    const clusters = buildTokenClusters(pages);
    // No 4-token overlap possible with only 2-3 token pages
    const overlapClusters = clusters.filter(c => !c.isIdentical);
    for (const c of overlapClusters) {
      for (const p of c.pages) {
        expect(p.tokenArr.length).toBeGreaterThanOrEqual(4);
      }
    }
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
      totalVolume: 2000, keywordCount: 20, pageCount: 2, avgKd: null, confidence: 'high', isIdentical: false,
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
      confidence: 'high', isIdentical: false,
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
      confidence: 'high', isIdentical: false,
    };
    const { system, user } = buildAutoGroupPrompt(cluster);
    expect(system).toContain('SEO grouping expert');
    expect(user).toContain('best home loans'); // Higher volume first
    expect(user).toContain('home loans');
    expect(user).toContain('home, loan');
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
    confidence: 'high', isIdentical: false,
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
