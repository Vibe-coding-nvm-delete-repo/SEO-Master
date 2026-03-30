/* eslint-disable react-hooks/exhaustive-deps */
import { useMemo } from 'react';
import type { ProcessedRow, ClusterSummary, TokenSummary, GroupedCluster, BlockedKeyword, LabelSection } from '../types';
import { getLabelColor } from '../processing';

interface UseFilteredTableDataParams {
  results: ProcessedRow[] | null;
  clusterSummary: ClusterSummary[] | null;
  tokenSummary: TokenSummary[] | null;
  groupedClusters: GroupedCluster[];
  approvedGroups: GroupedCluster[];
  blockedKeywords: BlockedKeyword[];
  blockedTokens: Set<string>;
  labelSections: LabelSection[];
  hasBlockedToken: (tokenArr: string[]) => boolean;
  pendingFilteredAutoGroupTokens: Set<string>;
  selectedTokens: Set<string>;
  debouncedSearchQuery: string;
  activeTab: string;
  isLabelDropdownOpen: boolean;
  minClusterCount: string;
  maxClusterCount: string;
  minLen: string;
  maxLen: string;
  minKwInCluster: string;
  maxKwInCluster: string;
  minVolume: string;
  maxVolume: string;
  minKd: string;
  maxKd: string;
  minKwRating: string;
  maxKwRating: string;
  filterCity: string;
  filterState: string;
  excludedLabels: Set<string>;
  minTokenLen: string;
  maxTokenLen: string;
  sortConfig: Array<{ key: keyof ClusterSummary; direction: 'asc' | 'desc' }>;
  tokenSortConfig: { key: keyof TokenSummary; direction: 'asc' | 'desc' };
  keywordsSortConfig: Array<{ key: string; direction: 'asc' | 'desc' }>;
  blockedSortConfig: { key: string; direction: 'asc' | 'desc' };
  currentPage: number;
  itemsPerPage: number;
}

export function useFilteredTableData({
  results,
  clusterSummary,
  tokenSummary,
  groupedClusters,
  approvedGroups,
  blockedKeywords,
  blockedTokens,
  labelSections,
  hasBlockedToken,
  pendingFilteredAutoGroupTokens,
  selectedTokens,
  debouncedSearchQuery,
  activeTab,
  isLabelDropdownOpen,
  minClusterCount,
  maxClusterCount,
  minLen,
  maxLen,
  minKwInCluster,
  maxKwInCluster,
  minVolume,
  maxVolume,
  minKd,
  maxKd,
  minKwRating,
  maxKwRating,
  filterCity,
  filterState,
  excludedLabels,
  minTokenLen,
  maxTokenLen,
  sortConfig,
  tokenSortConfig,
  keywordsSortConfig,
  blockedSortConfig,
  currentPage,
  itemsPerPage,
}: UseFilteredTableDataParams) {
  // Effective results: filter out keywords whose tokens contain a blocked token
  const effectiveResults = useMemo(() => {
    if (!results || blockedTokens.size === 0) return results;
    return results.filter(r => !hasBlockedToken(r.tokenArr));
  }, [results, blockedTokens, hasBlockedToken]);

  // Effective clusters: filter out clusters whose tokens contain a blocked token
  // Ungrouped pages = all clusters MINUS those already in groups or approved
  const effectiveClusters = useMemo(() => {
    if (!clusterSummary) return clusterSummary;
    // Collect all token signatures that are in grouped or approved
    const groupedTokens = new Set<string>();
    for (const g of groupedClusters) {
      for (const c of g.clusters) {
        groupedTokens.add(c.tokens);
      }
    }
    for (const g of approvedGroups) {
      for (const c of g.clusters) {
        groupedTokens.add(c.tokens);
      }
    }
    for (const token of pendingFilteredAutoGroupTokens) {
      groupedTokens.add(token);
    }
    let filtered = clusterSummary.filter(c => !groupedTokens.has(c.tokens));
    if (blockedTokens.size > 0) {
      filtered = filtered.filter(c => !hasBlockedToken(c.tokenArr));
    }
    return filtered;
  }, [clusterSummary, groupedClusters, approvedGroups, pendingFilteredAutoGroupTokens, blockedTokens, hasBlockedToken]);

  // Effective grouped: filter out sub-clusters with blocked tokens, remove empty groups
  const effectiveGrouped = useMemo(() => {
    if (blockedTokens.size === 0) return groupedClusters;
    return groupedClusters.map(g => {
      const remaining = g.clusters.filter(c => !hasBlockedToken(c.tokenArr));
      if (remaining.length === 0) return null;
      return {
        ...g,
        clusters: remaining,
        keywordCount: remaining.reduce((sum, c) => sum + c.keywordCount, 0),
        totalVolume: remaining.reduce((sum, c) => sum + c.totalVolume, 0),
        avgKd: (() => { let total = 0, count = 0; remaining.forEach(c => { if (c.avgKd !== null) { total += c.avgKd; count++; } }); return count > 0 ? Math.round(total / count) : null; })(),
        avgKwRating: (() => { let total = 0, count = 0; remaining.forEach(c => { if (c.avgKwRating != null) { total += c.avgKwRating; count++; } }); return count > 0 ? Math.round(total / count) : null; })(),
      };
    }).filter(Boolean) as GroupedCluster[];
  }, [groupedClusters, blockedTokens, hasBlockedToken]);

  // Keywords blocked by token blocking (for the Blocked tab)
  const tokenBlockedKeywords = useMemo((): BlockedKeyword[] => {
    if (!results || blockedTokens.size === 0) return [];
    const blocked: BlockedKeyword[] = [];
    for (const r of results) {
      const matchedTokens = r.tokenArr.filter(t => blockedTokens.has(t));
      if (matchedTokens.length > 0) {
        blocked.push({
          keyword: r.keyword,
          volume: r.searchVolume,
          kd: r.kd,
          kwRating: r.kwRating ?? undefined,
          reason: `Token: ${matchedTokens.join(', ')}`,
          tokenArr: r.tokenArr,
        });
      }
    }
    blocked.sort((a, b) => b.volume - a.volume);
    return blocked;
  }, [results, blockedTokens]);

  // Combined blocked keywords (foreign + token-blocked)
  const allBlockedKeywords = useMemo(() => {
    return [...blockedKeywords, ...tokenBlockedKeywords].sort((a, b) => b.volume - a.volume);
  }, [blockedKeywords, tokenBlockedKeywords]);

  const { min, max, hasMin, hasMax } = useMemo(() => {
    const mn = parseInt(minClusterCount, 10);
    const mx = parseInt(maxClusterCount, 10);
    return { min: mn, max: mx, hasMin: !isNaN(mn), hasMax: !isNaN(mx) };
  }, [minClusterCount, maxClusterCount]);

  const validClusterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (effectiveClusters) {
      for (const c of effectiveClusters) {
        counts.set(c.pageName, c.keywordCount);
      }
    }
    return counts;
  }, [effectiveClusters]);

  const clusterByTokens = useMemo(() => {
    const map = new Map<string, ClusterSummary>();
    if (clusterSummary) {
      for (const c of clusterSummary) {
        map.set(c.tokens, c);
      }
    }
    return map;
  }, [clusterSummary]);

  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!isLabelDropdownOpen) return counts;

    const data = activeTab === 'pages' ? clusterSummary : tokenSummary;
    if (!data) return counts;

    const searchLower = debouncedSearchQuery.toLowerCase();
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const len = data.length;

    for (let i = 0; i < len; i++) {
      const item = data[i];

      // Apply other filters
      if (activeTab === 'pages') {
        const c = item as ClusterSummary;
        if (hasMin && c.keywordCount < min) continue;
        if (hasMax && c.keywordCount > max) continue;
        if (hasTokens) {
          let hasAll = true;
          const cTokens = c.tokenArr;
          for (let j = 0; j < tokensArr.length; j++) {
            if (!cTokens.includes(tokensArr[j])) { hasAll = false; break; }
          }
          if (!hasAll) continue;
        }
        if (searchLower && !c.pageNameLower.includes(searchLower)) continue;
      } else {
        const t = item as TokenSummary;
        const minL = minTokenLen ? parseInt(minTokenLen, 10) : 0;
        const maxL = maxTokenLen ? parseInt(maxTokenLen, 10) : Infinity;
        if (!isNaN(minL) && t.length < minL) continue;
        if (!isNaN(maxL) && t.length > maxL) continue;
        if (hasTokens) {
          let hasAll = true;
          for (let j = 0; j < tokensArr.length; j++) {
            if (t.token !== tokensArr[j]) { hasAll = false; break; }
          }
          if (!hasAll) continue;
        }
        if (searchLower && !t.token.toLowerCase().includes(searchLower)) continue;
      }

      // Count labels
      const labels = item.labelArr;
      for (let j = 0; j < labels.length; j++) {
        const l = labels[j];
        counts[l] = (counts[l] || 0) + 1;
      }
    }
    return counts;
  }, [activeTab, clusterSummary, tokenSummary, debouncedSearchQuery, min, max, hasMin, hasMax, minTokenLen, maxTokenLen, selectedTokens, isLabelDropdownOpen]);

  // Cached parsed range filter integers — shared between filteredClusters and filteredResultsData
  const rangeFilters = useMemo(() => ({
    cityLower: filterCity.toLowerCase(),
    stateLower: filterState.toLowerCase(),
    lenMin: minLen ? parseInt(minLen, 10) : NaN,
    lenMax: maxLen ? parseInt(maxLen, 10) : NaN,
    kwMin: minKwInCluster ? parseInt(minKwInCluster, 10) : NaN,
    kwMax: maxKwInCluster ? parseInt(maxKwInCluster, 10) : NaN,
    volMin: minVolume ? parseInt(minVolume, 10) : NaN,
    volMax: maxVolume ? parseInt(maxVolume, 10) : NaN,
    kdMin: minKd ? parseInt(minKd, 10) : NaN,
    kdMax: maxKd ? parseInt(maxKd, 10) : NaN,
    ratingMin: minKwRating ? parseInt(minKwRating, 10) : NaN,
    ratingMax: maxKwRating ? parseInt(maxKwRating, 10) : NaN,
  }), [filterCity, filterState, minLen, maxLen, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating]);

  const filteredClusters = useMemo(() => {
    if (!effectiveClusters) return [];
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const searchLower = debouncedSearchQuery.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;

    const { cityLower, stateLower, lenMin, lenMax, kwMin, kwMax, volMin, volMax, kdMin, kdMax, ratingMin, ratingMax } = rangeFilters;

    const filtered: ClusterSummary[] = [];
    const len = effectiveClusters.length;

    for (let i = 0; i < len; i++) {
      const c = effectiveClusters[i];
      if (hasMin && c.keywordCount < min) continue;
      if (hasMax && c.keywordCount > max) continue;

      // Column-level filters
      if (!isNaN(lenMin) && c.pageNameLen < lenMin) continue;
      if (!isNaN(lenMax) && c.pageNameLen > lenMax) continue;
      if (!isNaN(kwMin) && c.keywordCount < kwMin) continue;
      if (!isNaN(kwMax) && c.keywordCount > kwMax) continue;
      if (!isNaN(volMin) && c.totalVolume < volMin) continue;
      if (!isNaN(volMax) && c.totalVolume > volMax) continue;
      if (!isNaN(kdMin) && (c.avgKd === null || c.avgKd < kdMin)) continue;
      if (!isNaN(kdMax) && (c.avgKd === null || c.avgKd > kdMax)) continue;
      if (!isNaN(ratingMin) && (c.avgKwRating == null || c.avgKwRating < ratingMin)) continue;
      if (!isNaN(ratingMax) && (c.avgKwRating == null || c.avgKwRating > ratingMax)) continue;
      if (cityLower && !(c.locationCity || '').toLowerCase().includes(cityLower)) continue;
      if (stateLower && !(c.locationState || '').toLowerCase().includes(stateLower)) continue;

      if (hasExcluded) {
        let isExcluded = false;
        const labels = c.labelArr;
        for (let j = 0; j < labels.length; j++) {
          if (excludedLabels.has(labels[j])) {
            isExcluded = true;
            break;
          }
        }
        if (isExcluded) continue;
      }

      if (hasTokens) {
        let hasAll = true;
        const cTokens = c.tokenArr;
        for (let j = 0; j < tokensArr.length; j++) {
          if (!cTokens.includes(tokensArr[j])) { hasAll = false; break; }
        }
        if (!hasAll) continue;
      }

      if (searchLower && !c.pageNameLower.includes(searchLower)) continue;

      filtered.push(c);
    }

    return filtered;
  }, [effectiveClusters, debouncedSearchQuery, min, max, hasMin, hasMax, excludedLabels, selectedTokens, rangeFilters]);

  const filteredResultsData = useMemo(() => {
    if (!effectiveResults) return { filtered: [], totalVolume: 0 };
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const searchLower = debouncedSearchQuery.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;

    const { cityLower, stateLower, lenMin, lenMax, volMin, volMax, kdMin: kdMinVal, kdMax: kdMaxVal, ratingMin, ratingMax } = rangeFilters;

    const filtered: ProcessedRow[] = [];
    let totalVolume = 0;
    const len = effectiveResults.length;

    for (let i = 0; i < len; i++) {
      const r = effectiveResults[i];

      // Filter by cluster count
      if (hasMin || hasMax) {
        const count = validClusterCounts.get(r.pageName) || 0;
        if (hasMin && count < min) continue;
        if (hasMax && count > max) continue;
      }

      // Column-level filters
      if (!isNaN(lenMin) && r.pageNameLen < lenMin) continue;
      if (!isNaN(lenMax) && r.pageNameLen > lenMax) continue;
      if (!isNaN(volMin) && r.searchVolume < volMin) continue;
      if (!isNaN(volMax) && r.searchVolume > volMax) continue;
      if (!isNaN(kdMinVal) && (r.kd === null || r.kd < kdMinVal)) continue;
      if (!isNaN(kdMaxVal) && (r.kd === null || r.kd > kdMaxVal)) continue;
      if (!isNaN(ratingMin) && (r.kwRating == null || r.kwRating < ratingMin)) continue;
      if (!isNaN(ratingMax) && (r.kwRating == null || r.kwRating > ratingMax)) continue;
      if (cityLower && !(r.locationCity || '').toLowerCase().includes(cityLower)) continue;
      if (stateLower && !(r.locationState || '').toLowerCase().includes(stateLower)) continue;

      // Filter by labels
      if (hasExcluded) {
        let isExcluded = false;
        const labels = r.labelArr;
        for (let j = 0; j < labels.length; j++) {
          if (excludedLabels.has(labels[j])) {
            isExcluded = true;
            break;
          }
        }
        if (isExcluded) continue;
      }

      // Filter by tokens
      if (hasTokens) {
        let hasAllTokens = true;
        const rowTokens = r.tokenArr;
        for (let j = 0; j < tokensArr.length; j++) {
          if (!rowTokens.includes(tokensArr[j])) {
            hasAllTokens = false;
            break;
          }
        }
        if (!hasAllTokens) continue;
      }

      // Filter by search query
      if (searchLower) {
        if (!(r.keywordLower.includes(searchLower) || r.pageNameLower.includes(searchLower))) continue;
      }

      filtered.push(r);
      totalVolume += r.searchVolume;
    }

    return { filtered, totalVolume };
  }, [effectiveResults, debouncedSearchQuery, min, max, hasMin, hasMax, validClusterCounts, excludedLabels, selectedTokens, rangeFilters]);

  const filteredResults = filteredResultsData.filtered;

  const sortedKeywordRows = useMemo(() => {
    if (activeTab !== 'keywords') return filteredResults;
    const rows = [...filteredResults];
    const getVal = (row: ProcessedRow, key: string): string | number => {
      switch (key) {
        case 'pageName': return row.pageNameLower;
        case 'tokens': return row.tokens;
        case 'pageNameLen': return row.pageNameLen;
        case 'keyword': return row.keywordLower;
        case 'searchVolume': return row.searchVolume;
        case 'kd': return row.kd ?? -1;
        case 'kwRating': return row.kwRating ?? -1;
        case 'label': return row.label;
        case 'locationCity': return (row.locationCity || '').toLowerCase();
        case 'locationState': return (row.locationState || '').toLowerCase();
        default: return '';
      }
    };
    rows.sort((a, b) => {
      for (const { key, direction } of keywordsSortConfig) {
        const av = getVal(a, key);
        const bv = getVal(b, key);
        const na = typeof av === 'number';
        const nb = typeof bv === 'number';
        let cmp: number;
        if (na && nb) cmp = (av as number) - (bv as number);
        else cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
    return rows;
  }, [activeTab, filteredResults, keywordsSortConfig]);

  const sortedClusters = useMemo(() => {
    if (sortConfig.length === 0) return filteredClusters;
    return [...filteredClusters].sort((a, b) => {
      for (const { key, direction } of sortConfig) {
        const aVal = a[key] ?? (direction === 'asc' ? Infinity : -Infinity);
        const bVal = b[key] ?? (direction === 'asc' ? Infinity : -Infinity);
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [filteredClusters, sortConfig]);

  const filteredTokens = useMemo(() => {
    if (!tokenSummary) return [];
    const minL = minTokenLen ? parseInt(minTokenLen, 10) : 0;
    const maxL = maxTokenLen ? parseInt(maxTokenLen, 10) : Infinity;
    const searchLower = debouncedSearchQuery.toLowerCase();
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const hasExcluded = excludedLabels.size > 0;

    const filtered: TokenSummary[] = [];
    const len = tokenSummary.length;

    for (let i = 0; i < len; i++) {
      const t = tokenSummary[i];
      if (blockedTokens.has(t.token)) continue;
      if (!isNaN(minL) && t.length < minL) continue;
      if (!isNaN(maxL) && t.length > maxL) continue;

      if (hasExcluded) {
        let isExcluded = false;
        const labels = t.labelArr;
        for (let j = 0; j < labels.length; j++) {
          if (excludedLabels.has(labels[j])) {
            isExcluded = true;
            break;
          }
        }
        if (isExcluded) continue;
      }

      if (hasTokens) {
        let hasAll = true;
        for (let j = 0; j < tokensArr.length; j++) {
          if (t.token !== tokensArr[j]) { hasAll = false; break; }
        }
        if (!hasAll) continue;
      }

      if (searchLower && !t.token.toLowerCase().includes(searchLower)) continue;

      filtered.push(t);
    }

    return filtered;
  }, [tokenSummary, debouncedSearchQuery, minTokenLen, maxTokenLen, excludedLabels, selectedTokens, blockedTokens]);

  const sortedTokens = useMemo(() => {
    return [...filteredTokens].sort((a, b) => {
      const aVal = a[tokenSortConfig.key] ?? (tokenSortConfig.direction === 'asc' ? Infinity : -Infinity);
      const bVal = b[tokenSortConfig.key] ?? (tokenSortConfig.direction === 'asc' ? Infinity : -Infinity);
      if (aVal < bVal) return tokenSortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return tokenSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredTokens, tokenSortConfig]);

  const displayedValid = useMemo(
    () => (debouncedSearchQuery || minClusterCount || maxClusterCount || excludedLabels.size > 0 || selectedTokens.size > 0) ? filteredResults.length : effectiveResults?.length || 0,
    [debouncedSearchQuery, minClusterCount, maxClusterCount, excludedLabels, selectedTokens, filteredResults, effectiveResults],
  );
  const displayedClusters = useMemo(
    () => (debouncedSearchQuery || minClusterCount || maxClusterCount || excludedLabels.size > 0 || selectedTokens.size > 0) ? filteredClusters.length : effectiveClusters?.length || 0,
    [debouncedSearchQuery, minClusterCount, maxClusterCount, excludedLabels, selectedTokens, filteredClusters, effectiveClusters],
  );
  const displayedTokens = useMemo(
    () => (debouncedSearchQuery || minTokenLen || maxTokenLen || excludedLabels.size > 0 || selectedTokens.size > 0) ? filteredTokens.length : tokenSummary?.length || 0,
    [debouncedSearchQuery, minTokenLen, maxTokenLen, excludedLabels, selectedTokens, filteredTokens, tokenSummary],
  );

  const displayedVolume = useMemo(() => {
    return (debouncedSearchQuery || minClusterCount || maxClusterCount || excludedLabels.size > 0 || selectedTokens.size > 0)
      ? filteredResultsData.totalVolume
      : results?.reduce((sum, row) => sum + row.searchVolume, 0) || 0;
  }, [filteredResultsData.totalVolume, results, debouncedSearchQuery, minClusterCount, maxClusterCount, excludedLabels, selectedTokens]);

  // Label color map: token → { colorIndex, border, bg, text, sectionName }
  const labelColorMap = useMemo(() => {
    const map = new Map<string, { border: string; bg: string; text: string; sectionName: string }>();
    labelSections.forEach(section => {
      const colors = getLabelColor(section.colorIndex);
      section.tokens.forEach(token => {
        if (!map.has(token)) {
          map.set(token, { ...colors, sectionName: section.name });
        }
      });
    });
    return map;
  }, [labelSections]);

  // Label section stats: sectionId → { totalVol, avgKd }
  const labelSectionStats = useMemo(() => {
    const statsMap = new Map<string, { totalVol: number; avgKd: number | null }>();
    if (!tokenSummary) return statsMap;
    const tokenMap = new Map<string, TokenSummary>(tokenSummary.map(t => [t.token, t]));
    labelSections.forEach(section => {
      let totalVol = 0, totalKd = 0, kdCount = 0;
      section.tokens.forEach(token => {
        const ts = tokenMap.get(token);
        if (ts) {
          totalVol += ts.totalVolume;
          if (ts.avgKd !== null) { totalKd += ts.avgKd; kdCount++; }
        }
      });
      statsMap.set(section.id, { totalVol, avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null });
    });
    return statsMap;
  }, [labelSections, tokenSummary]);

  // Count how many times each token appears in the currently filtered keyword results
  const filteredTokenCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!filteredResults) return counts;
    for (const row of filteredResults) {
      for (const token of row.tokenArr) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
    }
    return counts;
  }, [filteredResults]);

  const paginatedResults = useMemo(
    () => sortedKeywordRows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [sortedKeywordRows, currentPage, itemsPerPage],
  );
  const paginatedClusters = useMemo(() => sortedClusters.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [sortedClusters, currentPage, itemsPerPage]);
  const paginatedTokens = useMemo(() => sortedTokens.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [sortedTokens, currentPage, itemsPerPage]);

  // Filtered + sorted grouped clusters
  const filteredSortedGrouped = useMemo(() => {
    let groups = effectiveGrouped;
    // Filter by unified search (searches group name / page names)
    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      groups = groups.filter(g =>
        g.groupName.toLowerCase().includes(q) ||
        g.clusters.some(c => c.pageNameLower.includes(q))
      );
    }
    // Column-level filters — same as Pages (Ungrouped) but applied at group aggregate level
    const kwMin = minKwInCluster ? parseInt(minKwInCluster, 10) : NaN;
    const kwMax = maxKwInCluster ? parseInt(maxKwInCluster, 10) : NaN;
    const volMin = minVolume ? parseInt(minVolume, 10) : NaN;
    const volMax = maxVolume ? parseInt(maxVolume, 10) : NaN;
    const kdMin = minKd ? parseInt(minKd, 10) : NaN;
    const kdMax = maxKd ? parseInt(maxKd, 10) : NaN;
    const ratingMin = minKwRating ? parseInt(minKwRating, 10) : NaN;
    const ratingMax = maxKwRating ? parseInt(maxKwRating, 10) : NaN;
    const cityLower = filterCity.toLowerCase();
    const stateLower = filterState.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokenFilter = tokensArr.length > 0;
    const hasColumnFilters = !isNaN(kwMin) || !isNaN(kwMax) || !isNaN(volMin) || !isNaN(volMax) || !isNaN(kdMin) || !isNaN(kdMax) || !isNaN(ratingMin) || !isNaN(ratingMax) || cityLower || stateLower || hasExcluded || hasTokenFilter;
    if (hasColumnFilters) {
      groups = groups.filter(g => {
        if (!isNaN(kwMin) && g.keywordCount < kwMin) return false;
        if (!isNaN(kwMax) && g.keywordCount > kwMax) return false;
        if (!isNaN(volMin) && g.totalVolume < volMin) return false;
        if (!isNaN(volMax) && g.totalVolume > volMax) return false;
        if (!isNaN(kdMin) && (g.avgKd === null || g.avgKd < kdMin)) return false;
        if (!isNaN(kdMax) && (g.avgKd === null || g.avgKd > kdMax)) return false;
        if (!isNaN(ratingMin) && (g.avgKwRating == null || g.avgKwRating < ratingMin)) return false;
        if (!isNaN(ratingMax) && (g.avgKwRating == null || g.avgKwRating > ratingMax)) return false;
        if (cityLower) {
          const hasCityMatch = g.clusters.some(c => (c.locationCity || '').toLowerCase().includes(cityLower));
          if (!hasCityMatch) return false;
        }
        if (stateLower) {
          const hasStateMatch = g.clusters.some(c => (c.locationState || '').toLowerCase().includes(stateLower));
          if (!hasStateMatch) return false;
        }
        if (hasExcluded) {
          const allLabels = new Set<string>();
          g.clusters.forEach(c => c.labelArr.forEach(l => allLabels.add(l)));
          const allExcluded = allLabels.size > 0 && Array.from(allLabels).every(l => excludedLabels.has(l));
          if (allExcluded) return false;
        }
        if (hasTokenFilter) {
          const groupTokens = new Set<string>();
          g.clusters.forEach(c => (c.tokenArr || c.tokens.split(' ')).forEach(t => groupTokens.add(t)));
          if (!tokensArr.every(t => groupTokens.has(t))) return false;
        }
        return true;
      });
    }
    return [...groups].sort((a, b) => {
      if (b.totalVolume !== a.totalVolume) return b.totalVolume - a.totalVolume;
      if (b.keywordCount !== a.keywordCount) return b.keywordCount - a.keywordCount;
      return a.groupName.localeCompare(b.groupName);
    });
  }, [effectiveGrouped, debouncedSearchQuery, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating, filterCity, filterState, excludedLabels, selectedTokens]);

  const paginatedGroupedClusters = useMemo(() => filteredSortedGrouped.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredSortedGrouped, currentPage, itemsPerPage]);

  // Filtered approved groups — same column-level filters as grouped tab
  const filteredApprovedGroups = useMemo(() => {
    let groups = approvedGroups as GroupedCluster[];
    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      groups = groups.filter(g =>
        g.groupName.toLowerCase().includes(q) ||
        g.clusters.some(c => c.pageNameLower.includes(q))
      );
    }
    const kwMin = minKwInCluster ? parseInt(minKwInCluster, 10) : NaN;
    const kwMax = maxKwInCluster ? parseInt(maxKwInCluster, 10) : NaN;
    const volMin = minVolume ? parseInt(minVolume, 10) : NaN;
    const volMax = maxVolume ? parseInt(maxVolume, 10) : NaN;
    const kdMin = minKd ? parseInt(minKd, 10) : NaN;
    const kdMax = maxKd ? parseInt(maxKd, 10) : NaN;
    const ratingMin = minKwRating ? parseInt(minKwRating, 10) : NaN;
    const ratingMax = maxKwRating ? parseInt(maxKwRating, 10) : NaN;
    const cityLower = filterCity.toLowerCase();
    const stateLower = filterState.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokenFilter = tokensArr.length > 0;
    const hasColumnFilters = !isNaN(kwMin) || !isNaN(kwMax) || !isNaN(volMin) || !isNaN(volMax) || !isNaN(kdMin) || !isNaN(kdMax) || !isNaN(ratingMin) || !isNaN(ratingMax) || cityLower || stateLower || hasExcluded || hasTokenFilter;
    if (hasColumnFilters) {
      groups = groups.filter(g => {
        if (!isNaN(kwMin) && g.keywordCount < kwMin) return false;
        if (!isNaN(kwMax) && g.keywordCount > kwMax) return false;
        if (!isNaN(volMin) && g.totalVolume < volMin) return false;
        if (!isNaN(volMax) && g.totalVolume > volMax) return false;
        if (!isNaN(kdMin) && (g.avgKd === null || g.avgKd < kdMin)) return false;
        if (!isNaN(kdMax) && (g.avgKd === null || g.avgKd > kdMax)) return false;
        if (!isNaN(ratingMin) && (g.avgKwRating == null || g.avgKwRating < ratingMin)) return false;
        if (!isNaN(ratingMax) && (g.avgKwRating == null || g.avgKwRating > ratingMax)) return false;
        if (cityLower && !g.clusters.some(c => (c.locationCity || '').toLowerCase().includes(cityLower))) return false;
        if (stateLower && !g.clusters.some(c => (c.locationState || '').toLowerCase().includes(stateLower))) return false;
        if (hasExcluded) {
          const allLabels = new Set<string>();
          g.clusters.forEach(c => c.labelArr.forEach(l => allLabels.add(l)));
          if (allLabels.size > 0 && Array.from(allLabels).every(l => excludedLabels.has(l))) return false;
        }
        if (hasTokenFilter) {
          const groupTokens = new Set<string>();
          g.clusters.forEach(c => (c.tokenArr || c.tokens.split(' ')).forEach(t => groupTokens.add(t)));
          if (!tokensArr.every(t => groupTokens.has(t))) return false;
        }
        return true;
      });
    }
    return groups;
  }, [approvedGroups, debouncedSearchQuery, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating, filterCity, filterState, excludedLabels, selectedTokens]);

  // Filtered blocked keywords (search + column filters)
  const filteredBlocked = useMemo(() => {
    const q = debouncedSearchQuery.toLowerCase();
    const volMin = minVolume ? parseInt(minVolume, 10) : NaN;
    const volMax = maxVolume ? parseInt(maxVolume, 10) : NaN;
    const kdMin = minKd ? parseInt(minKd, 10) : NaN;
    const kdMax = maxKd ? parseInt(maxKd, 10) : NaN;
    const ratingMin = minKwRating ? parseInt(minKwRating, 10) : NaN;
    const ratingMax = maxKwRating ? parseInt(maxKwRating, 10) : NaN;
    return allBlockedKeywords.filter(b => {
      if (q && !b.keyword.toLowerCase().includes(q)) return false;
      if (!isNaN(volMin) && b.volume < volMin) return false;
      if (!isNaN(volMax) && b.volume > volMax) return false;
      if (!isNaN(kdMin) && (b.kd === null || b.kd < kdMin)) return false;
      if (!isNaN(kdMax) && (b.kd === null || b.kd > kdMax)) return false;
      if (!isNaN(ratingMin) && (b.kwRating == null || b.kwRating < ratingMin)) return false;
      if (!isNaN(ratingMax) && (b.kwRating == null || b.kwRating > ratingMax)) return false;
      return true;
    });
  }, [allBlockedKeywords, debouncedSearchQuery, minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating]);

  const sortedBlocked = useMemo(() => {
    const { key, direction } = blockedSortConfig;
    const arr = [...filteredBlocked];
    const mul = direction === 'asc' ? 1 : -1;
    const cmpNum = (a: number | null | undefined, b: number | null | undefined) => {
      const av = a ?? -1e9;
      const bv = b ?? -1e9;
      return (av - bv) * mul;
    };
    arr.sort((a, b) => {
      if (key === 'keyword') return a.keyword.localeCompare(b.keyword) * mul;
      if (key === 'tokens') {
        const as = (a.tokenArr || []).join(' ');
        const bs = (b.tokenArr || []).join(' ');
        return as.localeCompare(bs) * mul;
      }
      if (key === 'volume') return cmpNum(a.volume, b.volume);
      if (key === 'kd') return cmpNum(a.kd, b.kd);
      if (key === 'kwRating') return cmpNum(a.kwRating, b.kwRating);
      if (key === 'reason') return a.reason.localeCompare(b.reason) * mul;
      return 0;
    });
    return arr;
  }, [filteredBlocked, blockedSortConfig]);

  // Memoize grouped stats to avoid 5 reduce() calls on every render
  const groupedStats = useMemo(() => {
    const pagesGrouped = effectiveGrouped.reduce((sum, g) => sum + g.clusters.length, 0);
    const groupedKeywords = effectiveGrouped.reduce((sum, g) => sum + g.keywordCount, 0);
    const groupedVolume = effectiveGrouped.reduce((sum, g) => sum + g.totalVolume, 0);
    const totalPagesAll = (effectiveClusters?.length || 0) + pagesGrouped;
    const pctGrouped = totalPagesAll > 0 ? ((pagesGrouped / totalPagesAll) * 100).toFixed(2) : '0.00';
    return { pagesGrouped, groupedKeywords, groupedVolume, totalPagesAll, pctGrouped };
  }, [effectiveGrouped, effectiveClusters]);

  const approvedPageCount = useMemo(
    () => approvedGroups.reduce((sum, g) => sum + g.clusters.length, 0),
    [approvedGroups]
  );

  const keywordGroupingProgress = useMemo(() => {
    const groupedPageCount = effectiveGrouped.reduce((sum, g) => sum + g.clusters.length, 0);
    const completedPages = groupedPageCount + approvedPageCount;
    const ungroupedPages = effectiveClusters?.length || 0;
    const totalPages = completedPages + ungroupedPages;
    const percent = totalPages > 0 ? (completedPages / totalPages) * 100 : 0;
    return {
      completedPages,
      ungroupedPages,
      totalPages,
      percent,
      percentLabel: `${percent.toFixed(1)}%`,
    };
  }, [effectiveGrouped, approvedPageCount, effectiveClusters]);

  return {
    effectiveResults,
    effectiveClusters,
    effectiveGrouped,
    tokenBlockedKeywords,
    allBlockedKeywords,
    min,
    max,
    hasMin,
    hasMax,
    validClusterCounts,
    clusterByTokens,
    labelCounts,
    filteredClusters,
    filteredResultsData,
    filteredResults,
    sortedKeywordRows,
    sortedClusters,
    filteredTokens,
    sortedTokens,
    displayedValid,
    displayedClusters,
    displayedTokens,
    displayedVolume,
    labelColorMap,
    labelSectionStats,
    filteredTokenCounts,
    paginatedResults,
    paginatedClusters,
    paginatedTokens,
    filteredSortedGrouped,
    paginatedGroupedClusters,
    filteredApprovedGroups,
    filteredBlocked,
    sortedBlocked,
    groupedStats,
    approvedPageCount,
    keywordGroupingProgress,
  };
}
