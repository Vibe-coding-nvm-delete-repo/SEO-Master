import { useMemo } from 'react';
import type { TokenSummary, ClusterSummary, GroupedCluster, ProcessedRow } from '../types';
import { parseTokenMgmtSearchTerms, tokenIncludesAnyTerm } from '../tokenMgmtSearch';

interface UseTokenMgmtFilteringParams {
  tokenSummary: TokenSummary[] | null;
  tokenMgmtSubTab: 'current' | 'all' | 'merge' | 'auto-merge' | 'blocked';
  blockedTokens: Set<string>;
  universalBlockedTokens: Set<string>;
  activeTab: string;
  filteredClusters: ClusterSummary[];
  filteredSortedGrouped: GroupedCluster[];
  filteredApprovedGroups: GroupedCluster[];
  filteredResults: ProcessedRow[];
  debouncedTokenMgmtSearch: string;
  tokenMgmtSort: { key: 'token' | 'totalVolume' | 'frequency' | 'avgKd'; direction: 'asc' | 'desc' };
}

export function useTokenMgmtFiltering({
  tokenSummary,
  tokenMgmtSubTab,
  blockedTokens,
  universalBlockedTokens,
  activeTab,
  filteredClusters,
  filteredSortedGrouped,
  filteredApprovedGroups,
  filteredResults,
  debouncedTokenMgmtSearch,
  tokenMgmtSort,
}: UseTokenMgmtFilteringParams): TokenSummary[] {
  // Stage 1: Expensive base computation — builds token stats from filtered data.
  // Does NOT depend on search or sort, so typing in search won't re-trigger this.
  const mgmtTokenBase = useMemo(() => {
    if (tokenMgmtSubTab === 'merge' || tokenMgmtSubTab === 'auto-merge') return [];
    if (!tokenSummary) return [];

    if (tokenMgmtSubTab === 'blocked') {
      return tokenSummary.filter(t => blockedTokens.has(t.token) || universalBlockedTokens.has(t.token));
    }

    if (tokenMgmtSubTab === 'current') {
      const tokenStatsMap = new Map<string, { token: string; totalVolume: number; frequency: number; kdSum: number; kdCount: number }>();

      const clusters: { tokenArr: string[]; keywords: { keyword: string; volume: number; kd: number | null }[] }[] = [];
      if (activeTab === 'pages') {
        clusters.push(...filteredClusters);
      } else if (activeTab === 'grouped') {
        for (const g of filteredSortedGrouped) clusters.push(...g.clusters);
      } else if (activeTab === 'approved') {
        for (const g of filteredApprovedGroups) clusters.push(...g.clusters);
      }

      if (activeTab === 'pages' || activeTab === 'grouped' || activeTab === 'approved') {
        for (const c of clusters) {
          for (const t of c.tokenArr) {
            if (blockedTokens.has(t)) continue;
            const existing = tokenStatsMap.get(t);
            if (existing) {
              existing.totalVolume += c.keywords.reduce((s, kw) => s + kw.volume, 0);
              existing.frequency += c.keywords.length;
              c.keywords.forEach(kw => { if (kw.kd !== null) { existing.kdSum += kw.kd; existing.kdCount++; } });
            } else {
              const vol = c.keywords.reduce((s, kw) => s + kw.volume, 0);
              let kdS = 0, kdC = 0;
              c.keywords.forEach(kw => { if (kw.kd !== null) { kdS += kw.kd; kdC++; } });
              tokenStatsMap.set(t, { token: t, totalVolume: vol, frequency: c.keywords.length, kdSum: kdS, kdCount: kdC });
            }
          }
        }
      }

      if (activeTab === 'keywords') {
        for (const r of filteredResults) {
          for (const t of r.tokenArr) {
            if (blockedTokens.has(t)) continue;
            const existing = tokenStatsMap.get(t);
            if (existing) {
              existing.totalVolume += r.searchVolume;
              existing.frequency += 1;
              if (r.kd !== null) { existing.kdSum += r.kd; existing.kdCount++; }
            } else {
              tokenStatsMap.set(t, {
                token: t,
                totalVolume: r.searchVolume,
                frequency: 1,
                kdSum: r.kd ?? 0,
                kdCount: r.kd !== null ? 1 : 0,
              });
            }
          }
        }
      }

      const globalMap = new Map<string, TokenSummary>((tokenSummary || []).map(t => [t.token, t]));
      return Array.from(tokenStatsMap.values()).map(s => {
        const global = globalMap.get(s.token);
        return {
          token: s.token,
          totalVolume: s.totalVolume,
          frequency: s.frequency,
          avgKd: s.kdCount > 0 ? Math.round(s.kdSum / s.kdCount) : null,
          length: global?.length ?? s.token.length,
          label: global?.label ?? '',
          labelArr: global?.labelArr ?? [],
          locationCity: global?.locationCity ?? '',
          locationState: global?.locationState ?? '',
        };
      });
    }

    // 'all' — show all non-blocked tokens
    return tokenSummary.filter(t => !blockedTokens.has(t.token) && !universalBlockedTokens.has(t.token));
  }, [tokenSummary, tokenMgmtSubTab, blockedTokens, universalBlockedTokens, activeTab, filteredClusters, filteredSortedGrouped, filteredApprovedGroups, filteredResults]);

  // Stage 2: Cheap search filter — only reruns when debounced search changes
  const mgmtTokenSearched = useMemo(() => {
    const terms = parseTokenMgmtSearchTerms(debouncedTokenMgmtSearch);
    if (terms.length === 0) return mgmtTokenBase;
    return mgmtTokenBase.filter(t => tokenIncludesAnyTerm(t.token, terms));
  }, [mgmtTokenBase, debouncedTokenMgmtSearch]);

  // Stage 3: Cheap sort — only reruns when sort config or searched list changes
  const filteredMgmtTokens = useMemo(() => {
    const tokens = [...mgmtTokenSearched];
    const { key, direction } = tokenMgmtSort;
    tokens.sort((a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return direction === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return tokens;
  }, [mgmtTokenSearched, tokenMgmtSort]);

  return filteredMgmtTokens;
}
