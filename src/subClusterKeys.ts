/**
 * Sub-cluster selection keys are `${groupId}::${cluster.tokens}`.
 * Cluster token strings may contain "::" (e.g. cosine anchor pages), so never use
 * `split('::')` with array destructuring — only split on the first separator.
 */
export function parseSubClusterKey(subKey: string): { groupId: string; clusterTokens: string } | null {
  const i = subKey.indexOf('::');
  if (i <= 0) return null;
  return { groupId: subKey.slice(0, i), clusterTokens: subKey.slice(i + 2) };
}
