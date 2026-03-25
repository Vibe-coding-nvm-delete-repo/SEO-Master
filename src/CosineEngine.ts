/**
 * Cosine Similarity Engine
 *
 * HOW IT WORKS (what happens when user clicks "Run"):
 *
 * Phase 1 — EMBED (API call, ~2-5 seconds):
 *   Sends all page names to OpenRouter's embedding API.
 *   Each page name becomes a 1536-dimensional number vector.
 *   "payday loans online" → [0.023, -0.041, 0.087, ...1536 numbers]
 *   Cost: ~$0.001 for 3,000 pages. Batched 100 at a time.
 *
 * Phase 2 — COMPARE (local math, ~5-15 seconds):
 *   Computes cosine similarity between every pair of page vectors.
 *   3,000 pages = 4.5M pairs. Each pair: dot product / (magnitudes).
 *   Runs in chunks of 50,000 pairs with browser yields so UI stays responsive.
 *   Keeps only pairs above the threshold (e.g., 0.85 = 85% similar).
 *
 * Phase 3 — CLUSTER (instant):
 *   Uses Union-Find to group connected pages.
 *   If A↔B (0.92) and B↔C (0.88), all three join one cluster.
 *   Each cluster = a potential semantic group.
 *
 * Result: A table of clusters with similarity scores, expandable to see pages.
 */

// Use inline type to avoid import-order issues
interface CosinePageInput {
  pageName: string;
  tokens: string;
  tokenArr: string[];
  totalVolume: number;
  keywordCount: number;
  avgKd: number | null;
}

export const DEFAULT_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';

export interface SimilarityPair {
  pageA: { name: string; tokens: string; volume: number };
  pageB: { name: string; tokens: string; volume: number };
  similarity: number;
}

export interface CosineCluster {
  id: string;
  pages: CosinePageInput[];
  pageCount: number;
  totalVolume: number;
  keywordCount: number;
  avgKd: number | null;
  maxSimilarity: number;
  minSimilarity: number;
}

export interface CosineProgress {
  phase: 'embedding' | 'computing' | 'clustering' | 'complete' | 'error';
  progress: number; // 0-100
  message: string;
  detail: string; // sub-status for the current phase
  pairsFound: number;
  clustersFormed: number;
  cost: number;
  tokensUsed: number;
  elapsedMs: number;
}

// Cosine similarity between two vectors (optimized: pre-computed magnitudes)
function cosineSim(a: number[], b: number[], magA: number, magB: number): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const denom = magA * magB;
  return denom === 0 ? 0 : dot / denom;
}

// Pre-compute magnitude for each vector (avoids recomputing per pair)
function computeMagnitudes(vectors: number[][]): number[] {
  return vectors.map(v => {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    return Math.sqrt(sum);
  });
}

// Helper: yield control back to browser so UI updates
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Get embeddings from OpenRouter (batched)
async function getEmbeddings(
  texts: string[],
  apiKey: string,
  model: string,
  signal: AbortSignal | undefined,
  onBatchDone?: (completed: number, total: number) => void
): Promise<{ vectors: number[][]; tokensUsed: number; cost: number }> {
  const BATCH_SIZE = 100;
  const allVectors: number[][] = [];
  let totalTokens = 0;
  const totalBatches = Math.ceil(texts.length / BATCH_SIZE);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Aborted');

    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
      },
      body: JSON.stringify({ model, input: batch }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Embedding API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const embeddings = data.data || [];
    embeddings.sort((a: any, b: any) => a.index - b.index);
    for (const emb of embeddings) allVectors.push(emb.embedding);
    totalTokens += data.usage?.total_tokens || data.usage?.prompt_tokens || 0;

    onBatchDone?.(batchNum, totalBatches);
  }

  // Estimate cost based on model pricing (approximate)
  const cost = totalTokens * 0.00000001; // $0.01/M default
  return { vectors: allVectors, tokensUsed: totalTokens, cost };
}

// Find similar pairs — ASYNC with chunked yields so browser doesn't freeze
async function findSimilarPairs(
  pages: CosinePageInput[],
  vectors: number[][],
  magnitudes: number[],
  threshold: number,
  signal: AbortSignal | undefined,
  onProgress?: (computed: number, total: number, pairsFound: number) => void
): Promise<SimilarityPair[]> {
  const pairs: SimilarityPair[] = [];
  const n = pages.length;
  const total = (n * (n - 1)) / 2;
  const CHUNK_SIZE = 50000; // Process 50k pairs then yield to UI
  let computed = 0;
  let lastReport = 0;

  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new Error('Aborted');

    for (let j = i + 1; j < n; j++) {
      const sim = cosineSim(vectors[i], vectors[j], magnitudes[i], magnitudes[j]);
      if (sim >= threshold) {
        pairs.push({
          pageA: { name: pages[i].pageName, tokens: pages[i].tokens, volume: pages[i].totalVolume },
          pageB: { name: pages[j].pageName, tokens: pages[j].tokens, volume: pages[j].totalVolume },
          similarity: Math.round(sim * 10000) / 10000,
        });
      }
      computed++;

      // Yield to browser every CHUNK_SIZE pairs
      if (computed - lastReport >= CHUNK_SIZE) {
        lastReport = computed;
        onProgress?.(computed, total, pairs.length);
        await yieldToUI();
      }
    }
  }

  // Final progress report
  onProgress?.(total, total, pairs.length);

  pairs.sort((a, b) => b.similarity - a.similarity);
  return pairs;
}

// Build clusters using Union-Find (connected components)
function buildClusters(pages: CosinePageInput[], pairs: SimilarityPair[]): CosineCluster[] {
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  const pageMap = new Map<string, CosinePageInput>();

  for (const p of pages) {
    parent.set(p.tokens, p.tokens);
    rank.set(p.tokens, 0);
    pageMap.set(p.tokens, p);
  }

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) || 0, rankB = rank.get(rb) || 0;
    if (rankA < rankB) parent.set(ra, rb);
    else if (rankA > rankB) parent.set(rb, ra);
    else { parent.set(rb, ra); rank.set(ra, rankA + 1); }
  }

  for (const pair of pairs) union(pair.pageA.tokens, pair.pageB.tokens);

  // Group by root
  const groups = new Map<string, CosinePageInput[]>();
  for (const p of pages) {
    const root = find(p.tokens);
    const group = groups.get(root);
    if (group) group.push(p);
    else groups.set(root, [p]);
  }

  // Track similarities per cluster
  const clusterSims = new Map<string, number[]>();
  for (const pair of pairs) {
    const root = find(pair.pageA.tokens);
    const sims = clusterSims.get(root);
    if (sims) sims.push(pair.similarity);
    else clusterSims.set(root, [pair.similarity]);
  }

  const clusters: CosineCluster[] = [];
  let idx = 0;

  for (const [root, clusterPages] of groups) {
    if (clusterPages.length < 2) continue;

    const totalVolume = clusterPages.reduce((sum, p) => sum + p.totalVolume, 0);
    const keywordCount = clusterPages.reduce((sum, p) => sum + p.keywordCount, 0);
    let totalKd = 0, kdCount = 0;
    for (const p of clusterPages) {
      if (p.avgKd !== null) { totalKd += p.avgKd * p.keywordCount; kdCount += p.keywordCount; }
    }

    const sims = clusterSims.get(root) || [];
    clusters.push({
      id: `cosine_${idx++}`,
      pages: clusterPages.sort((a, b) => b.totalVolume - a.totalVolume),
      pageCount: clusterPages.length,
      totalVolume,
      keywordCount,
      avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
      maxSimilarity: sims.length > 0 ? Math.max(...sims) : 0,
      minSimilarity: sims.length > 0 ? Math.min(...sims) : 0,
    });
  }

  clusters.sort((a, b) => b.totalVolume - a.totalVolume);
  return clusters;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
export async function runCosineSimilarity(
  pages: CosinePageInput[],
  apiKey: string,
  threshold: number,
  model: string = DEFAULT_EMBEDDING_MODEL,
  signal?: AbortSignal,
  onProgress?: (progress: CosineProgress) => void
): Promise<{
  pairs: SimilarityPair[];
  clusters: CosineCluster[];
  cost: number;
  tokensUsed: number;
  embeddingTimeMs: number;
  computeTimeMs: number;
}> {
  const startTime = performance.now();
  const totalPairs = (pages.length * (pages.length - 1)) / 2;
  const pageNames = pages.map(p => p.pageName);

  const progress = (p: Partial<CosineProgress>) => {
    onProgress?.({
      phase: 'embedding',
      progress: 0,
      message: '',
      detail: '',
      pairsFound: 0,
      clustersFormed: 0,
      cost: 0,
      tokensUsed: 0,
      elapsedMs: Math.round(performance.now() - startTime),
      ...p,
    });
  };

  // ── Phase 1: EMBED ──────────────────────────────
  progress({
    phase: 'embedding',
    progress: 5,
    message: `Phase 1/3: Embedding ${pageNames.length} pages`,
    detail: `Sending to ${model}...`,
  });

  const embStart = performance.now();
  const embResult = await getEmbeddings(
    pageNames, apiKey, model, signal,
    (done, total) => {
      progress({
        phase: 'embedding',
        progress: 5 + Math.round((done / total) * 30), // 5-35%
        message: `Phase 1/3: Embedding ${pageNames.length} pages`,
        detail: `Batch ${done}/${total} (${Math.round((done / total) * 100)}%)`,
      });
    }
  );
  const { vectors, tokensUsed, cost } = embResult;
  const embTime = performance.now() - embStart;

  if (signal?.aborted) throw new Error('Aborted');

  // Pre-compute magnitudes (optimization)
  const magnitudes = computeMagnitudes(vectors);

  // ── Phase 2: COMPARE ────────────────────────────
  progress({
    phase: 'computing',
    progress: 38,
    message: `Phase 2/3: Comparing ${totalPairs.toLocaleString()} pairs`,
    detail: 'Starting similarity computation...',
    cost,
    tokensUsed,
  });

  const compStart = performance.now();
  const pairs = await findSimilarPairs(
    pages, vectors, magnitudes, threshold, signal,
    (computed, total, pairsFound) => {
      const pct = Math.round((computed / total) * 100);
      progress({
        phase: 'computing',
        progress: 38 + Math.round(pct * 0.5), // 38-88%
        message: `Phase 2/3: Comparing ${totalPairs.toLocaleString()} pairs`,
        detail: `${pct}% done · ${pairsFound} matches found so far`,
        pairsFound,
        cost,
        tokensUsed,
      });
    }
  );
  const compTime = performance.now() - compStart;

  if (signal?.aborted) throw new Error('Aborted');

  // ── Phase 3: CLUSTER ────────────────────────────
  progress({
    phase: 'clustering',
    progress: 90,
    message: `Phase 3/3: Building clusters from ${pairs.length} pairs`,
    detail: 'Running Union-Find algorithm...',
    pairsFound: pairs.length,
    cost,
    tokensUsed,
  });

  const clusters = buildClusters(pages, pairs);

  // ── DONE ────────────────────────────────────────
  const elapsed = Math.round(performance.now() - startTime);
  progress({
    phase: 'complete',
    progress: 100,
    message: `✓ Complete`,
    detail: `${pairs.length} pairs → ${clusters.length} clusters · ${(elapsed / 1000).toFixed(1)}s · $${cost.toFixed(4)}`,
    pairsFound: pairs.length,
    clustersFormed: clusters.length,
    cost,
    tokensUsed,
    elapsedMs: elapsed,
  });

  return {
    pairs,
    clusters,
    cost,
    tokensUsed,
    embeddingTimeMs: Math.round(embTime),
    computeTimeMs: Math.round(compTime),
  };
}

