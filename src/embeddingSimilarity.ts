export function cosineSimilarity(a: number[], b: number[], magA: number, magB: number): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  const denom = magA * magB;
  return denom === 0 ? 0 : dot / denom;
}

export function computeVectorMagnitudes(vectors: number[][]): number[] {
  return vectors.map((vector) => {
    let sum = 0;
    for (let i = 0; i < vector.length; i += 1) sum += vector[i] * vector[i];
    return Math.sqrt(sum);
  });
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function fetchOpenRouterEmbeddings(
  texts: string[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  onBatchDone?: (completed: number, total: number) => void,
): Promise<{ vectors: number[][]; tokensUsed: number; cost: number }> {
  const batchSize = 100;
  const concurrency = 4;
  const totalBatches = Math.ceil(texts.length / batchSize);
  const batchResults: number[][][] = [];
  let completedBatches = 0;
  let totalTokens = 0;

  const batchInputs = Array.from({ length: totalBatches }, (_, batchIndex) => ({
    batchIndex,
    batch: texts.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
  }));

  async function fetchBatch(batchIndex: number, batch: string[]) {
    if (signal?.aborted) throw new Error('Aborted');
    // Combine user cancellation signal with a 60s per-batch timeout
    const timeoutSignal = AbortSignal.timeout(60_000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
      },
      body: JSON.stringify({ model, input: batch }),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const embeddings = data.data || [];
    embeddings.sort((a: any, b: any) => a.index - b.index);

    batchResults[batchIndex] = embeddings.map((embedding: any) => embedding.embedding);
    totalTokens += data.usage?.total_tokens || data.usage?.prompt_tokens || 0;
    completedBatches += 1;
    onBatchDone?.(completedBatches, totalBatches);
  }

  let nextBatch = 0;
  async function worker() {
    while (nextBatch < batchInputs.length) {
      const current = nextBatch;
      nextBatch += 1;
      const { batchIndex, batch } = batchInputs[current];
      await fetchBatch(batchIndex, batch);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, totalBatches) }, () => worker()),
  );

  const allVectors = batchResults.flat();
  const cost = totalTokens * 0.00000001;
  return { vectors: allVectors, tokensUsed: totalTokens, cost };
}
