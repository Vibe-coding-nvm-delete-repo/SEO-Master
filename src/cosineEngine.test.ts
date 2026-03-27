import { describe, it, expect } from 'vitest';
import { runCosineSimilarity, trimCosineClusterMismatchPages, type CosineCluster, type CosineClusterPage } from './CosineEngine';

function makePage(partial: Partial<CosineClusterPage> & Pick<CosineClusterPage, 'pageName' | 'tokens'>): CosineClusterPage {
  return {
    pageNameLower: partial.pageName.toLowerCase(),
    pageNameLen: partial.pageName.length,
    tokenArr: (partial.tokenArr || partial.tokens.split(/\s+/)).sort(),
    keywordCount: partial.keywordCount ?? 5,
    totalVolume: partial.totalVolume ?? 100,
    avgKd: partial.avgKd ?? 40,
    representativeSimilarity: partial.representativeSimilarity ?? 1,
    ...partial,
  } as CosineClusterPage;
}

describe('runCosineSimilarity', () => {
  it('returns empty results without calling embed when fewer than 2 pages', async () => {
    const result = await runCosineSimilarity(
      [],
      'dummy-key',
      0.85,
      'qwen/qwen3-embedding-8b',
      undefined,
      () => {},
    );
    expect(result.pairs).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.embeddingTimeMs).toBe(0);
    expect(result.computeTimeMs).toBe(0);
  });
});

describe('trimCosineClusterMismatchPages', () => {
  it('returns null when only one page would remain', () => {
    const cluster: CosineCluster = {
      id: 'c1',
      pages: [
        makePage({ pageName: 'a high', tokens: 'a b', representativeSimilarity: 1, totalVolume: 200 }),
        makePage({ pageName: 'b high', tokens: 'c d', representativeSimilarity: 0.9, totalVolume: 100 }),
      ],
      pageCount: 2,
      totalVolume: 300,
      keywordCount: 10,
      avgKd: 40,
      maxSimilarity: 0.9,
      minSimilarity: 0.9,
      representativePageName: 'a high',
      representativeTokens: 'a b',
      highSimilarity: 1,
      lowSimilarity: 0.9,
      diffSimilarity: 0.1,
      outlierCount: 0,
    };
    expect(trimCosineClusterMismatchPages(cluster, new Set(['b high']))).toBeNull();
  });

  it('removes mismatched pages and preserves cluster id', () => {
    const cluster: CosineCluster = {
      id: 'cosine_0',
      pages: [
        makePage({ pageName: 'rep', tokens: 'r1', representativeSimilarity: 1, totalVolume: 300 }),
        makePage({ pageName: 'keep', tokens: 'k1', representativeSimilarity: 0.92, totalVolume: 200 }),
        makePage({ pageName: 'bad', tokens: 'x1', representativeSimilarity: 0.88, totalVolume: 150 }),
      ],
      pageCount: 3,
      totalVolume: 650,
      keywordCount: 15,
      avgKd: 40,
      maxSimilarity: 0.95,
      minSimilarity: 0.88,
      representativePageName: 'rep',
      representativeTokens: 'r1',
      highSimilarity: 1,
      lowSimilarity: 0.88,
      diffSimilarity: 0.12,
      outlierCount: 0,
    };
    const next = trimCosineClusterMismatchPages(cluster, new Set(['bad']));
    expect(next).not.toBeNull();
    expect(next!.id).toBe('cosine_0');
    expect(next!.pages.map(p => p.pageName)).toEqual(['rep', 'keep']);
    expect(next!.pageCount).toBe(2);
  });
});
