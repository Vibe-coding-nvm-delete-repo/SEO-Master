/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { citySet, cityFirstWords, stateSet, capitalizeWords, normalizeState, detectForeignEntity, normalizeKeywordToTokenArr } from '../processing';
import { stateFullNames, stateAbbrToFull, stopWords } from '../dictionaries';
import { applyMergeRulesToTokenArr } from '../tokenMerge';
import { csvImportProjectMismatch } from '../csvImportProjectScope';
import { createGenerationGuard } from '../collabV2WriteGuard';
import { isAcceptedSharedMutation, SHARED_MUTATION_ACCEPTED, type SharedMutationResult } from '../sharedMutation';
import type { ProcessedRow, Cluster, ClusterSummary, TokenSummary, BlockedKeyword, TokenMergeRule, ProjectOperationLockDoc } from '../types';

interface UseCsvImportParams {
  activeProjectIdRef: React.MutableRefObject<string | null>;
  storageMode: string;
  runWithExclusiveOperation?: <T>(operationType: ProjectOperationLockDoc['type'], operation: () => Promise<T>) => Promise<T | null>;
  tokenMergeRules: TokenMergeRule[];
  syncFileNameLocal: (name: string) => void;
  bulkSet: (data: {
    results: ProcessedRow[];
    clusterSummary: ClusterSummary[];
    tokenSummary: TokenSummary[];
    groupedClusters: never[];
    stats: { original: number; valid: number; clusters: number; tokens: number; totalVolume: number };
    datasetStats: {
      cities: number; states: number; numbers: number; faqs: number;
      commercial: number; local: number; year: number; informational: number; navigational: number;
    };
    fileName: string;
    blockedKeywords: BlockedKeyword[];
    blockedTokens: never[];
    approvedGroups: never[];
    activityLog: never[];
    tokenMergeRules: never[];
    autoGroupSuggestions: never[];
    autoMergeRecommendations: never[];
    groupMergeRecommendations: never[];
    labelSections: never[];
  }) => Promise<SharedMutationResult>;
  setActiveTab: (tab: string) => void;
  setResults: (r: ProcessedRow[] | null) => void;
  setClusterSummary: (c: ClusterSummary[] | null) => void;
  setTokenSummary: (t: TokenSummary[] | null) => void;
  setAutoMergeRecommendations: (r: never[]) => void;
  setGroupMergeRecommendations: (r: never[]) => void;
  setStats: (s: { original: number; valid: number; clusters: number; tokens: number; totalVolume: number } | null) => void;
  setDatasetStats: (d: {
    cities: number; states: number; numbers: number; faqs: number;
    commercial: number; local: number; year: number; informational: number; navigational: number;
  } | null) => void;
  addToast: (msg: string, type: string) => void;
  setError: (msg: string | null) => void;
}

export function useCsvImport({
  activeProjectIdRef,
  storageMode,
  runWithExclusiveOperation,
  tokenMergeRules,
  syncFileNameLocal,
  bulkSet,
  setActiveTab,
  setResults,
  setClusterSummary,
  setTokenSummary,
  setAutoMergeRecommendations,
  setGroupMergeRecommendations,
  setStats,
  setDatasetStats,
  addToast,
  setError,
}: UseCsvImportParams) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);

  const processCSV = (file: File): Promise<void> => {
    const importProjectId = activeProjectIdRef.current;
    if (!importProjectId) {
      setError('Select a project before importing a CSV file.');
      return Promise.resolve();
    }

    // V2: Capture generation to detect project switch during async processing
    const importGuard = createGenerationGuard(importProjectId);

    let importCancelledNotified = false;
    const notifyImportCancelled = () => {
      if (importCancelledNotified) return;
      importCancelledNotified = true;
      addToast('Import cancelled — you switched projects before the file finished processing.', 'warning');
    };

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    syncFileNameLocal(file.name);

    return new Promise<void>((resolve) => {
      Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const data = results.data as string[][];

          if (data.length === 0) {
            throw new Error("The CSV file is empty.");
          }

          // Check if first row is header by looking at column E (index 4)
          let startIndex = 0;
          let kdIndex = -1;
          const firstRowVolStr = data[0][4]?.replace(/,/g, '').trim();
          const firstRowVol = parseInt(firstRowVolStr, 10);
          if (isNaN(firstRowVol)) {
            startIndex = 1; // Skip header
            const headers = data[0];
            kdIndex = headers.findIndex((h: string) => {
              const lower = h?.toLowerCase()?.trim() || '';
              return lower === 'kd' || lower === 'keyword difficulty' || lower === 'difficulty';
            });
          }

          const clusters = new Map<string, Cluster>();
          const tokenMap = new Map<string, { frequency: number, totalVolume: number, totalKd: number, kdCount: number }>();
          const allCities = new Set<string>();
          const allStates = new Set<string>();
          let originalCount = 0;
          let validCount = 0;
          let totalSearchVolume = 0;
          const blockedRows: BlockedKeyword[] = [];

          let i = startIndex;
          const chunkSize = 2000;

          const processChunk = async () => {
            try {
              if (csvImportProjectMismatch(importProjectId, activeProjectIdRef.current)) {
                notifyImportCancelled();
                setIsProcessing(false);
                resolve();
                return;
              }

              const end = Math.min(i + chunkSize, data.length);
              for (; i < end; i++) {
                const row = data[i];
                originalCount++;

                // We need at least columns A, B, C, D, E (indices 0, 1, 2, 3, 4)
                // Column B is keyword (index 1), Column E is search volume (index 4)
                if (row.length < 5) continue;

                const keyword = row[1]?.trim();
                const volumeStr = row[4]?.replace(/,/g, '').trim();
                const volume = parseInt(volumeStr, 10);

                let kd: number | null = null;
                if (kdIndex !== -1 && row[kdIndex] !== undefined) {
                  const kdStr = row[kdIndex]?.replace(/,/g, '').trim();
                  const parsedKd = parseFloat(kdStr);
                  if (!isNaN(parsedKd)) {
                    kd = parsedKd;
                  }
                }

                if (!keyword || isNaN(volume)) continue;
                validCount++;
                totalSearchVolume += volume;

                // Check for foreign countries/cities — block these keywords
                const foreignEntity = detectForeignEntity(keyword.toLowerCase());
                if (foreignEntity) {
                  blockedRows.push({ keyword, volume, kd, reason: foreignEntity });
                  continue;
                }

                // Check for non-English, weird characters, or URL-like strings
                const isNonEnglishOrUrl = /[^\u0020-\u007E]/.test(keyword) ||
                                          /\b(www\b|http|\.com\b|\.org\b|\.net\b|\.online\b|\.co\b|\.us\b|\.io\b)/i.test(keyword);

                if (isNonEnglishOrUrl) {
                  const signature = "__N_A__";
                  if (!clusters.has(signature)) {
                    clusters.set(signature, {
                      signature,
                      pageName: "n/a",
                      pageNameLower: "n/a",
                      pageNameLen: 3,
                      maxVolume: volume,
                      locationCity: null,
                      locationState: null,
                      rows: []
                    });
                  }
                  const cluster = clusters.get(signature)!;
                  cluster.rows.push({ keyword, keywordLower: keyword.toLowerCase(), volume, kd, locationCity: null, locationState: null });
                  if (volume > cluster.maxVolume) {
                    cluster.maxVolume = volume;
                  }
                  continue;
                }

                // Extract location before normalization
                let locationCity: string | null = null;
                let locationState: string | null = null;

                const keywordLower = keyword.toLowerCase();
                const rawTokens = keywordLower.split(/[^a-z0-9]+/);

                // Check for NYC aliases → city "New York City", state "New York"
                const isNycAlias = keywordLower.includes('nyc') || keywordLower.includes('new york city');
                if (isNycAlias) {
                  locationCity = 'New York City';
                  locationState = 'New York';
                }

                // Check for LA alias → city "Los Angeles", state "California"
                if (!locationCity && /\bla\b/.test(keywordLower)) {
                  locationCity = 'Los Angeles';
                  locationState = 'California';
                }

                // Look for state first (skip if already set by NYC alias)
                if (!locationState) {
                  for (let j = 0; j < rawTokens.length; j++) {
                    const token = rawTokens[j];
                    if (!token) continue;

                    // Try 2-word state
                    if (j < rawTokens.length - 1) {
                      const nextToken = rawTokens[j + 1];
                      if (nextToken) {
                        const twoWord = `${token} ${nextToken}`;
                        if (stateSet.has(twoWord) && !stopWords.has(twoWord)) {
                          locationState = normalizeState(twoWord);
                          break;
                        }
                      }
                    }
                    // Try 1-word state (skip "la" — almost always means Los Angeles, not Louisiana)
                    if (stateSet.has(token) && !stopWords.has(token) && token !== 'la') {
                      locationState = normalizeState(token);
                      break;
                    }
                  }
                }

                // Look for city (skip if already found via NYC alias)
                if (!locationCity) {
                  for (let j = 0; j < rawTokens.length; j++) {
                    const token = rawTokens[j];
                    if (!token) continue;

                    const maxWords = cityFirstWords.get(token);
                    if (maxWords !== undefined) {
                      let foundCity = false;
                      // Try from longest possible city starting with this word down to 1 word
                      for (let wordCount = Math.min(maxWords, rawTokens.length - j); wordCount >= 1; wordCount--) {
                        const candidate = wordCount === 1 ? token : rawTokens.slice(j, j + wordCount).join(' ');
                        if (citySet.has(candidate)) {
                          // Reject if this "city" is actually a US state name or abbreviation
                          if (stateFullNames.has(candidate) || stateAbbrToFull[candidate]) {
                            // Assign as state instead if no state was found yet
                            if (!locationState) {
                              locationState = normalizeState(candidate);
                            }
                            continue; // Don't assign as city
                          }
                          locationCity = capitalizeWords(candidate);
                          foundCity = true;
                          break;
                        }
                      }
                      if (foundCity) break;
                    }
                  }
                }

                if (locationCity) allCities.add(locationCity);
                if (locationState) allStates.add(locationState);

                let tokenArr = normalizeKeywordToTokenArr(keywordLower);

                // Apply token merge rules (permanent project-level synonyms)
                if (tokenMergeRules.length > 0) {
                  tokenArr = applyMergeRulesToTokenArr(tokenArr, tokenMergeRules);
                }

                const signature = [...new Set(tokenArr)].sort().join(' ');

                if (!signature) continue;

                // Track individual tokens
                const uniqueTokens = new Set(signature.split(' ').filter(t => t.length > 0));
                for (const token of uniqueTokens) {
                  if (!tokenMap.has(token)) {
                    tokenMap.set(token, { frequency: 0, totalVolume: 0, totalKd: 0, kdCount: 0 });
                  }
                  const stats = tokenMap.get(token)!;
                  stats.frequency += 1;
                  stats.totalVolume += volume;
                  if (kd !== null) {
                    stats.totalKd += kd;
                    stats.kdCount += 1;
                  }
                }

                if (!clusters.has(signature)) {
                  clusters.set(signature, {
                    signature,
                    pageName: keyword,
                    pageNameLower: keywordLower,
                    pageNameLen: keyword.length,
                    maxVolume: volume,
                    locationCity,
                    locationState,
                    rows: []
                  });
                }

                const cluster = clusters.get(signature)!;
                cluster.rows.push({ keyword, keywordLower, volume, kd, locationCity, locationState });

                if (volume > cluster.maxVolume) {
                  cluster.maxVolume = volume;
                  cluster.pageName = keyword;
                  cluster.pageNameLower = keywordLower;
                  cluster.pageNameLen = keyword.length;
                  cluster.locationCity = locationCity;
                  cluster.locationState = locationState;
                }
              }

              if (i < data.length) {
                setProgress(Math.round((i / data.length) * 100));
                requestAnimationFrame(() => {
                  void processChunk();
                });
              } else {
                setProgress(100);
                // Finished processing all chunks
                if (validCount === 0) {
                  throw new Error("No valid keyword and search volume data found in columns B and E.");
                }

                const outputData: ProcessedRow[] = [];

                // Convert map to array and sort clusters by max volume descending
                const sortedClusters = Array.from(clusters.values()).sort((a, b) => b.maxVolume - a.maxVolume);
                const summaryData: ClusterSummary[] = [];

                let datasetCities = 0;
                let datasetStates = 0;
                let datasetNumbers = 0;
                let datasetFaqs = 0;
                let datasetCommercial = 0;
                let datasetLocal = 0;
                let datasetYear = 0;
                let datasetInformational = 0;
                let datasetNavigational = 0;

                const faqRegex = /\b(who|what|where|when|why|how|can|vs\.?|compare|is|are|do|does|will|would|should|could|which)\b/i;
                const commercialRegex = /\b(buy|price|cost|cheap|best|review|discount|coupon|sale|order|hire|service|services)\b/i;
                const localRegex = /\b(near me|nearby|close to)\b/i;
                const yearRegex = /\b(202\d|201\d)\b/i;
                const informationalRegex = /\b(guide|tutorial|tips|examples|meaning|definition|learn|course|training)\b/i;
                const navigationalRegex = /\b(login|sign in|contact|support|phone number|address|customer service|account)\b/i;

                for (const cluster of sortedClusters) {
                  // Sort rows by volume descending within cluster
                  cluster.rows.sort((a, b) => b.volume - a.volume);

                  let clusterTotalVolume = 0;
                  let clusterTotalKd = 0;
                  let clusterKdCount = 0;

                  const isFaq = faqRegex.test(cluster.pageName);
                  const isCommercial = commercialRegex.test(cluster.pageName);
                  const isLocal = localRegex.test(cluster.pageName);
                  const isYear = yearRegex.test(cluster.pageName);
                  const isInformational = informationalRegex.test(cluster.pageName);
                  const isNavigational = navigationalRegex.test(cluster.pageName);

                  if (cluster.locationCity) datasetCities++;
                  if (cluster.locationState) datasetStates++;
                  if (/\d/.test(cluster.pageName)) datasetNumbers++;
                  if (isFaq) datasetFaqs++;
                  if (isCommercial) datasetCommercial++;
                  if (isLocal) datasetLocal++;
                  if (isYear) datasetYear++;
                  if (isInformational) datasetInformational++;
                  if (isNavigational) datasetNavigational++;

                  const clusterTokenArr = cluster.signature.split(' ').filter(Boolean);
                  const clusterLabels = [];
                  if (cluster.locationCity || cluster.locationState) clusterLabels.push('Location');
                  if (/\d/.test(cluster.pageName)) clusterLabels.push('Number');
                  if (isFaq) clusterLabels.push('FAQ');
                  if (isCommercial) clusterLabels.push('Commercial');
                  if (isLocal) clusterLabels.push('Local');
                  if (isYear) clusterLabels.push('Year');
                  if (isInformational) clusterLabels.push('Informational');
                  if (isNavigational) clusterLabels.push('Navigational');

                  for (const row of cluster.rows) {
                    clusterTotalVolume += row.volume;
                    if (row.kd !== null) {
                      clusterTotalKd += row.kd;
                      clusterKdCount += 1;
                    }
                    const rowLabels = [];
                    if (row.locationCity || row.locationState) rowLabels.push('Location');
                    if (/\d/.test(row.keyword)) rowLabels.push('Number');
                    if (faqRegex.test(row.keyword)) rowLabels.push('FAQ');
                    if (commercialRegex.test(row.keyword)) rowLabels.push('Commercial');
                    if (localRegex.test(row.keyword)) rowLabels.push('Local');
                    if (yearRegex.test(row.keyword)) rowLabels.push('Year');
                    if (informationalRegex.test(row.keyword)) rowLabels.push('Informational');
                    if (navigationalRegex.test(row.keyword)) rowLabels.push('Navigational');

                    outputData.push({
                      pageName: cluster.pageName,
                      pageNameLower: cluster.pageNameLower,
                      pageNameLen: cluster.pageName.length,
                      tokens: cluster.signature,
                      tokenArr: clusterTokenArr,
                      keyword: row.keyword,
                      keywordLower: row.keywordLower,
                      searchVolume: row.volume,
                      kd: row.kd,
                      label: rowLabels.join(', '),
                      labelArr: rowLabels,
                      locationCity: row.locationCity,
                      locationState: row.locationState
                    });
                  }

                  summaryData.push({
                    pageName: cluster.pageName,
                    pageNameLower: cluster.pageNameLower,
                    pageNameLen: cluster.pageName.length,
                    tokens: cluster.signature,
                    tokenArr: clusterTokenArr,
                    keywordCount: cluster.rows.length,
                    totalVolume: clusterTotalVolume,
                    avgKd: clusterKdCount > 0 ? Math.round(clusterTotalKd / clusterKdCount) : null,
                    avgKwRating: null,
                    label: clusterLabels.join(', '),
                    labelArr: clusterLabels,
                    locationCity: cluster.locationCity,
                    locationState: cluster.locationState,
                    keywords: cluster.rows.map(r => ({ keyword: r.keyword, volume: r.volume, kd: r.kd, locationCity: r.locationCity, locationState: r.locationState }))
                  });
                }

                // Default sort: highest keyword clusters first
                summaryData.sort((a, b) => b.keywordCount - a.keywordCount);

                // Pre-calculate token-to-location mappings for performance
                const cityTokens = new Set<string>();
                for (const city of allCities) {
                  city.toLowerCase().split(/[^a-z0-9]+/).forEach(t => { if (t.length > 0) cityTokens.add(t); });
                }
                const stateTokens = new Set<string>();
                for (const state of allStates) {
                  state.toLowerCase().split(/[^a-z0-9]+/).forEach(t => { if (t.length > 0) stateTokens.add(t); });
                }

                const tokenSummaryData: TokenSummary[] = Array.from(tokenMap.entries())
                  .map(([token, stats]) => {
                    const isCityToken = cityTokens.has(token);
                    const isStateToken = stateTokens.has(token);

                    const hasLocation = isCityToken || isStateToken;
                    const tokenLabels = [];
                    if (hasLocation) tokenLabels.push('Location');
                    if (/\d/.test(token)) tokenLabels.push('Number');
                    if (faqRegex.test(token)) tokenLabels.push('FAQ');
                    if (commercialRegex.test(token)) tokenLabels.push('Commercial');
                    if (localRegex.test(token)) tokenLabels.push('Local');
                    if (yearRegex.test(token)) tokenLabels.push('Year');
                    if (informationalRegex.test(token)) tokenLabels.push('Informational');
                    if (navigationalRegex.test(token)) tokenLabels.push('Navigational');

                    return {
                      token,
                      length: token.length,
                      frequency: stats.frequency,
                      totalVolume: stats.totalVolume,
                      avgKd: stats.kdCount > 0 ? Math.round(stats.totalKd / stats.kdCount) : null,
                      label: tokenLabels.join(', '),
                      labelArr: tokenLabels,
                      locationCity: isCityToken ? 'Yes' : 'No',
                      locationState: isStateToken ? 'Yes' : 'No'
                    };
                  })
                  .sort((a, b) => b.frequency - a.frequency);

                // No auto-grouping — all pages start in Pages (Ungrouped). User groups manually.
                const statsObj = {
                  original: originalCount,
                  valid: outputData.length,
                  clusters: sortedClusters.length,
                  tokens: tokenSummaryData.length,
                  totalVolume: totalSearchVolume
                };
                const datasetStatsObj = {
                  cities: datasetCities,
                  states: datasetStates,
                  numbers: datasetNumbers,
                  faqs: datasetFaqs,
                  commercial: datasetCommercial,
                  local: datasetLocal,
                  year: datasetYear,
                  informational: datasetInformational,
                  navigational: datasetNavigational
                };

                if (csvImportProjectMismatch(importProjectId, activeProjectIdRef.current)) {
                  notifyImportCancelled();
                  setIsProcessing(false);
                  return;
                }

                // V2: If project switched during CSV processing, abort the import
                if (!importGuard.isCurrent()) {
                  notifyImportCancelled();
                  setIsProcessing(false);
                  return;
                }

                // Single atomic path: bulkSet updates latest ref + React state + persist
                const persistResult = await bulkSet({
                  results: outputData,
                  clusterSummary: summaryData,
                  tokenSummary: tokenSummaryData,
                  groupedClusters: [],
                  stats: statsObj,
                  datasetStats: datasetStatsObj,
                  fileName: file.name,
                  blockedKeywords: blockedRows,
                  blockedTokens: [],
                  approvedGroups: [],
                  activityLog: [],
                  tokenMergeRules: [],
                  autoGroupSuggestions: [],
                  autoMergeRecommendations: [],
                  groupMergeRecommendations: [],
                  labelSections: []
                });

                if (!isAcceptedSharedMutation(persistResult)) {
                  const message = persistResult.status === 'blocked'
                    ? 'CSV import could not be saved because the shared project is temporarily locked or read-only.'
                    : 'CSV import could not be saved to the shared project.';
                  setError(message);
                  addToast(message, 'error');
                  setIsProcessing(false);
                  resolve();
                  return;
                }

                setActiveTab('pages');
                setIsProcessing(false);
                resolve();
              }
            } catch (err: any) {
              setError(err.message || "An error occurred while processing the CSV.");
              setResults(null);
              setClusterSummary(null);
              setTokenSummary(null);
              setAutoMergeRecommendations([]);
              setGroupMergeRecommendations([]);
              setStats(null);
              setDatasetStats(null);
              setIsProcessing(false);
              resolve();
            }
          };

          void processChunk();
        } catch (err: any) {
          setError(err.message || "An error occurred while processing the CSV.");
          setResults(null);
          setClusterSummary(null);
          setTokenSummary(null);
          setAutoMergeRecommendations([]);
          setGroupMergeRecommendations([]);
          setStats(null);
          setDatasetStats(null);
          setIsProcessing(false);
          resolve();
        }
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
        setIsProcessing(false);
        setResults(null);
        setClusterSummary(null);
        setTokenSummary(null);
        setAutoMergeRecommendations([]);
        setGroupMergeRecommendations([]);
        setStats(null);
        setDatasetStats(null);
        resolve();
      }
    });
    });
  };

  const runCsvImport = useCallback((file: File) => {
    const runImport = async () => {
      await processCSV(file);
      return SHARED_MUTATION_ACCEPTED;
    };

    if (storageMode === 'v2' && runWithExclusiveOperation) {
      void runWithExclusiveOperation('csv-import', runImport);
      return;
    }

    void runImport();
  }, [processCSV, runWithExclusiveOperation, storageMode]);

  // Ref to always call the latest processCSV (avoids stale closure in useCallback)
  const processCSVRef = useRef(runCsvImport);
  processCSVRef.current = runCsvImport;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        processCSVRef.current(file);
      } else {
        setError("Please upload a valid CSV file.");
      }
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processCSVRef.current(e.target.files[0]);
    }
  }, []);

  return {
    isDragging,
    isProcessing,
    progress,
    processCSV,
    runCsvImport,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInput,
  };
}
