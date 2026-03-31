export interface FilteredAutoGroupQueueJob {
  id: string;
  signature: string;
}

export function enqueueLatestFilteredAutoGroupJob<T extends FilteredAutoGroupQueueJob>(
  queue: T[],
  nextJob: T,
): T[] {
  if (queue.length === 0) return [nextJob];

  const lastJob = queue[queue.length - 1];
  if (lastJob.signature === nextJob.signature) {
    return [...queue.slice(0, -1), nextJob];
  }

  return [nextJob];
}
