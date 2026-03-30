/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ProcessedRow, ClusterSummary, TokenSummary, GroupedCluster, TokenMergeRule, AutoMergeRecommendation, ActivityAction } from '../types';
import type { GroupReviewSettingsRef, GroupReviewSettingsData } from '../GroupReviewSettings';
import type { ToastOptions } from '../ToastContext';
import {
  addAutoMergeUsage,
  fetchAutoMergeMatches,
  selectAutoMergeTokenRows,
  type AutoMergeTokenPageContext,
  type AutoMergeSettingsSlice,
} from '../AutoMergeEngine';
import { runPool, type OpenRouterUsage } from '../KeywordRatingEngine';
import {
  markRecommendationApproved,
  markRecommendationPendingAfterUndo,
  mergeRecommendationsAfterRerun,
} from '../autoMergeRecommendations';
import { executeMergeCascade } from '../tokenMerge';
import { getCloudSyncSnapshot } from '../cloudSyncStatus';

interface UseAutoMergeParams {
  results: ProcessedRow[] | null;
  tokenMergeRules: TokenMergeRule[];
  resultsRef: React.MutableRefObject<ProcessedRow[] | null>;
  tokenSummaryRef: React.MutableRefObject<TokenSummary[] | null>;
  groupedClustersRef: React.MutableRefObject<GroupedCluster[]>;
  approvedGroupsRef: React.MutableRefObject<GroupedCluster[]>;
  clusterSummaryRef: React.MutableRefObject<ClusterSummary[] | null>;
  autoMergeRecommendationsRef: React.MutableRefObject<AutoMergeRecommendation[]>;
  blockedTokensRef: React.MutableRefObject<Set<string>>;
  universalBlockedTokens: Set<string>;
  groupReviewSettingsRef: React.RefObject<GroupReviewSettingsRef | null>;
  groupReviewSettingsSnapshot: GroupReviewSettingsData | null;
  addToast: (msg: string, type: 'success' | 'info' | 'warning' | 'error', options?: ToastOptions) => void;
  logAndToast: (action: ActivityAction, details: string, count: number, toastMsg: string, toastType?: 'success' | 'info' | 'warning' | 'error') => void;
  updateAutoMergeRecommendations: (recs: AutoMergeRecommendation[]) => void;
  applyMergeCascade: (cascade: { results: ProcessedRow[] | null; clusterSummary: ClusterSummary[] | null; tokenSummary: TokenSummary[] | null; groupedClusters: GroupedCluster[]; approvedGroups: GroupedCluster[]; }, newRule: TokenMergeRule) => void;
  activeProjectId: string | null;
  flushNow: () => Promise<void>;
  setTokenMgmtSubTab: (tab: string) => void;
  setTokenMgmtPage: (page: number) => void;
  handleUndoMergeParent: (ruleId: string) => void;
}

export type AutoMergeJobState = {
  phase: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  done: number;
  total: number;
  recommendations: number;
  error: string | null;
  costUsdTotal: number;
  costReported: boolean;
  promptTokens: number;
  completionTokens: number;
  apiCalls: number;
  elapsedMs: number;
};

const INITIAL_AUTO_MERGE_JOB: AutoMergeJobState = {
  phase: 'idle',
  progress: 0,
  done: 0,
  total: 0,
  recommendations: 0,
  error: null,
  costUsdTotal: 0,
  costReported: false,
  promptTokens: 0,
  completionTokens: 0,
  apiCalls: 0,
  elapsedMs: 0,
};

export function useAutoMerge({
  results,
  tokenMergeRules,
  resultsRef,
  tokenSummaryRef,
  groupedClustersRef,
  approvedGroupsRef,
  clusterSummaryRef,
  autoMergeRecommendationsRef,
  blockedTokensRef,
  universalBlockedTokens,
  groupReviewSettingsRef,
  groupReviewSettingsSnapshot,
  addToast,
  logAndToast,
  updateAutoMergeRecommendations,
  applyMergeCascade,
  activeProjectId,
  flushNow,
  setTokenMgmtSubTab,
  setTokenMgmtPage,
  handleUndoMergeParent,
}: UseAutoMergeParams) {
  const autoMergeAbortRef = useRef<AbortController | null>(null);
  const autoMergeJobStartRef = useRef(0);

  const [autoMergeJob, setAutoMergeJob] = useState<AutoMergeJobState>(INITIAL_AUTO_MERGE_JOB);

  // Live elapsed timer while auto-merge runs
  useEffect(() => {
    if (autoMergeJob.phase !== 'running') return;
    const timer = setInterval(() => {
      setAutoMergeJob(prev => ({
        ...prev,
        elapsedMs: Math.round(performance.now() - autoMergeJobStartRef.current),
      }));
    }, 250);
    return () => clearInterval(timer);
  }, [autoMergeJob.phase]);

  const tokenTopPagesMap = useMemo(() => {
    const AUTO_MERGE_PAGE_CONTEXT_LIMIT = 5;
    const rows = (results || []) as ProcessedRow[];
    const byToken = new Map<string, Map<string, { pageName: string; keywordCount: number; totalVolume: number; kdSum: number; kdCount: number }>>();
    for (const row of rows) {
      const uniqueTokens = Array.from(new Set(row.tokenArr || []));
      for (const token of uniqueTokens) {
        let pageMap = byToken.get(token);
        if (!pageMap) {
          pageMap = new Map();
          byToken.set(token, pageMap);
        }
        const pageKey = row.pageName || row.tokens;
        const prev = pageMap.get(pageKey) || { pageName: row.pageName || row.tokens, keywordCount: 0, totalVolume: 0, kdSum: 0, kdCount: 0 };
        prev.keywordCount += 1;
        prev.totalVolume += Number.isFinite(row.searchVolume) ? row.searchVolume : 0;
        if (row.kd != null && Number.isFinite(row.kd)) {
          prev.kdSum += row.kd;
          prev.kdCount += 1;
        }
        pageMap.set(pageKey, prev);
      }
    }

    const out = new Map<string, AutoMergeTokenPageContext[]>();
    for (const [token, pageMap] of byToken.entries()) {
      const topPages = Array.from(pageMap.values())
        .map((p): AutoMergeTokenPageContext => ({
          pageName: p.pageName,
          keywordCount: p.keywordCount,
          totalVolume: p.totalVolume,
          avgKd: p.kdCount > 0 ? Math.round((p.kdSum / p.kdCount) * 10) / 10 : null,
        }))
        .sort((a, b) => {
          if (a.totalVolume !== b.totalVolume) return b.totalVolume - a.totalVolume;
          if (a.keywordCount !== b.keywordCount) return b.keywordCount - a.keywordCount;
          return a.pageName.localeCompare(b.pageName);
        })
        .slice(0, AUTO_MERGE_PAGE_CONTEXT_LIMIT);
      out.set(token, topPages);
    }
    return out;
  }, [results]);

  const tokenPagesTooltip = useCallback((token: string) => {
    const pages = tokenTopPagesMap.get(token) || [];
    if (pages.length === 0) return `${token}\nNo page context found.`;
    const lines = pages.map(
      (p, idx) => `${idx + 1}. ${p.pageName} | Vol ${p.totalVolume.toLocaleString()} | KD ${p.avgKd ?? '-'} | KWs ${p.keywordCount}`,
    );
    return `${token}\nTop ${pages.length} pages:\n${lines.join('\n')}`;
  }, [tokenTopPagesMap]);

  const buildAutoMergeRecommendations = useCallback((
    tokenRows: TokenSummary[],
    allRows: ProcessedRow[],
    responseMap: Map<string, { matches: string[]; confidence: number; reason: string }>,
  ): AutoMergeRecommendation[] => {
    if (tokenRows.length === 0) return [];
    const tokenSet = new Set(tokenRows.map(t => t.token));
    const statsByToken = new Map(tokenRows.map(t => [t.token, t]));
    const adj = new Map<string, Set<string>>();
    tokenRows.forEach(t => adj.set(t.token, new Set()));
    for (const [source, resp] of responseMap.entries()) {
      if (!tokenSet.has(source)) continue;
      for (const match of resp.matches) {
        if (!tokenSet.has(match) || match === source) continue;
        adj.get(source)!.add(match);
        adj.get(match)!.add(source);
      }
    }

    const visited = new Set<string>();
    const recs: AutoMergeRecommendation[] = [];
    const now = new Date().toISOString();
    for (const token of tokenSet) {
      if (visited.has(token)) continue;
      const stack = [token];
      const component: string[] = [];
      visited.add(token);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        component.push(cur);
        for (const nxt of adj.get(cur) || []) {
          if (visited.has(nxt)) continue;
          visited.add(nxt);
          stack.push(nxt);
        }
      }
      if (component.length < 2) continue;
      const sorted = [...component].sort((a, b) => {
        const av = statsByToken.get(a)?.totalVolume ?? 0;
        const bv = statsByToken.get(b)?.totalVolume ?? 0;
        if (av !== bv) return bv - av;
        const af = statsByToken.get(a)?.frequency ?? 0;
        const bf = statsByToken.get(b)?.frequency ?? 0;
        if (af !== bf) return bf - af;
        return a.localeCompare(b);
      });
      const canonicalToken = sorted[0];
      // Prevent transitive chain pollution (A~B~C) from auto-merging C with A
      // unless C is directly connected to the chosen canonical token.
      const canonicalNeighbors = adj.get(canonicalToken) || new Set<string>();
      const mergeTokens = sorted.slice(1).filter(t => canonicalNeighbors.has(t));
      if (mergeTokens.length === 0) continue;
      const allInvolved = new Set([canonicalToken, ...mergeTokens]);
      const affectedRows = allRows.filter(r => r.tokenArr.some(t => allInvolved.has(t)));
      const affectedKeywords = Array.from(new Set(affectedRows.map(r => r.keyword))).slice(0, 30);
      const affectedPageCount = new Set(affectedRows.map(r => r.tokens)).size;
      let confAcc = 0;
      let confN = 0;
      const reasonBits = new Set<string>();
      for (const t of component) {
        const rr = responseMap.get(t);
        if (!rr) continue;
        confAcc += rr.confidence;
        confN += 1;
        if (rr.reason) reasonBits.add(rr.reason);
      }
      const confidence = confN > 0 ? Math.max(0, Math.min(1, confAcc / confN)) : 0.5;
      recs.push({
        id: `auto_merge_${sorted.join('__')}`,
        sourceToken: token,
        canonicalToken,
        mergeTokens,
        confidence,
        reason: Array.from(reasonBits).slice(0, 2).join(' | '),
        affectedKeywordCount: affectedRows.length,
        affectedPageCount,
        affectedKeywords,
        status: 'pending',
        createdAt: now,
      });
    }
    return recs.sort((a, b) => b.affectedKeywordCount - a.affectedKeywordCount);
  }, []);

  const runAutoMergeRecommendations = useCallback(async (samplePercent: number = 100) => {
    const gs = groupReviewSettingsRef.current?.getSettings() ?? groupReviewSettingsSnapshot;
    if (!gs?.apiKey || gs.apiKey.trim().length < 10) {
      addToast('Add an OpenRouter API key in Group Review settings first.', 'error');
      return;
    }
    const allEligibleTokenRows: TokenSummary[] = ((tokenSummaryRef.current || []) as TokenSummary[])
      .filter(t => !blockedTokensRef.current.has(t.token) && !universalBlockedTokens.has(t.token));
    const rows = resultsRef.current || [];
    if (allEligibleTokenRows.length < 2 || rows.length === 0) {
      addToast('Need at least 2 non-blocked tokens with loaded keywords.', 'error');
      return;
    }
    const tokenRows = selectAutoMergeTokenRows(allEligibleTokenRows, samplePercent);
    const tokenContextByToken = new Map<string, AutoMergeTokenPageContext[]>();
    for (const t of tokenRows) {
      tokenContextByToken.set(t.token, tokenTopPagesMap.get(t.token) || []);
    }
    const isTestRun = samplePercent < 100;
    if (isTestRun) {
      addToast(
        `Auto Merge test mode: running ${tokenRows.length.toLocaleString()} of ${allEligibleTokenRows.length.toLocaleString()} tokens (${Math.min(100, Math.max(1, Math.floor(samplePercent)))}%).`,
        'info',
      );
    }

    autoMergeAbortRef.current?.abort();
    const ac = new AbortController();
    autoMergeAbortRef.current = ac;
    autoMergeJobStartRef.current = performance.now();

    const slice: AutoMergeSettingsSlice = {
      apiKey: gs.apiKey,
      model: gs.autoMergeModel,
      fallbackModel: gs.selectedModel,
      temperature: gs.autoMergeTemperature,
      maxTokens: gs.autoMergeMaxTokens,
      reasoningEffort: gs.autoMergeReasoningEffort,
      prompt: gs.autoMergePrompt,
    };

    let usageAcc: OpenRouterUsage = { promptTokens: 0, completionTokens: 0, costUsd: null };
    let costReported = false;
    let apiCalls = 0;
    const mergeUsage = (u: OpenRouterUsage) => {
      usageAcc = addAutoMergeUsage(usageAcc, u);
      if (u.costUsd != null) costReported = true;
    };
    const elapsedNow = () => Math.round(performance.now() - autoMergeJobStartRef.current);
    setAutoMergeJob({
      phase: 'running',
      progress: 1,
      done: 0,
      total: tokenRows.length,
      recommendations: 0,
      error: null,
      costUsdTotal: 0,
      costReported: false,
      promptTokens: 0,
      completionTokens: 0,
      apiCalls: 0,
      elapsedMs: 0,
    });
    try {
      // Yield once so the "running" state paints before heavier loops.
      await Promise.resolve();
      const responseMap = new Map<string, { matches: string[]; confidence: number; reason: string }>();
      const concurrency = Math.max(1, Math.min(500, gs.autoMergeConcurrency || 5));
      const allowedTokens = tokenRows.map(t => t.token);
      const allowedSet = new Set(allowedTokens);
      let done = 0;
      const previewEvery = Math.max(1, Math.floor(tokenRows.length / 40));
      await runPool(
        tokenRows,
        concurrency,
        async (row) => {
          const chunkSize = 200;
          const mergedMatches = new Set<string>();
          let confidenceAcc = 0;
          let confidenceN = 0;
          let firstReason = '';
          let chunk: string[] = [];
          for (const candidate of allowedTokens) {
            if (candidate === row.token) continue;
            chunk.push(candidate);
            if (chunk.length < chunkSize) continue;
            const candidateTopPagesByToken: Record<string, AutoMergeTokenPageContext[]> = {};
            for (const candidateToken of chunk) {
              candidateTopPagesByToken[candidateToken] = tokenContextByToken.get(candidateToken) || [];
            }
            const r = await fetchAutoMergeMatches(
              slice,
              row.token,
              chunk,
              ac.signal,
              {
                sourceTopPages: tokenContextByToken.get(row.token) || [],
                candidateTopPagesByToken,
              },
            );
            mergeUsage(r.usage);
            apiCalls += 1;
            confidenceAcc += r.result.confidence;
            confidenceN += 1;
            if (!firstReason && r.result.reason) firstReason = r.result.reason;
            for (const m of r.result.matches) {
              if (m !== row.token && allowedSet.has(m)) mergedMatches.add(m);
            }
            chunk = [];
          }
          if (chunk.length > 0) {
            const candidateTopPagesByToken: Record<string, AutoMergeTokenPageContext[]> = {};
            for (const candidateToken of chunk) {
              candidateTopPagesByToken[candidateToken] = tokenContextByToken.get(candidateToken) || [];
            }
            const r = await fetchAutoMergeMatches(
              slice,
              row.token,
              chunk,
              ac.signal,
              {
                sourceTopPages: tokenContextByToken.get(row.token) || [],
                candidateTopPagesByToken,
              },
            );
            mergeUsage(r.usage);
            apiCalls += 1;
            confidenceAcc += r.result.confidence;
            confidenceN += 1;
            if (!firstReason && r.result.reason) firstReason = r.result.reason;
            for (const m of r.result.matches) {
              if (m !== row.token && allowedSet.has(m)) mergedMatches.add(m);
            }
          }
          responseMap.set(row.token, {
            matches: Array.from(mergedMatches),
            confidence: confidenceN > 0 ? Math.max(0, Math.min(1, confidenceAcc / confidenceN)) : 0,
            reason: firstReason,
          });
          done += 1;
          const shouldPreview = done === 1 || done === tokenRows.length || done % previewEvery === 0;
          setAutoMergeJob(prev => ({
            ...prev,
            progress: Math.max(1, Math.round((done / tokenRows.length) * 100)),
            done,
            recommendations: shouldPreview ? buildAutoMergeRecommendations(tokenRows, rows, responseMap).length : prev.recommendations,
            costUsdTotal: usageAcc.costUsd ?? 0,
            costReported,
            promptTokens: usageAcc.promptTokens,
            completionTokens: usageAcc.completionTokens,
            apiCalls,
            elapsedMs: elapsedNow(),
          }));
          return null;
        },
        ac.signal,
      );
      const recs = buildAutoMergeRecommendations(tokenRows, rows, responseMap);
      const nextRecs = mergeRecommendationsAfterRerun(autoMergeRecommendationsRef.current, recs);
      autoMergeRecommendationsRef.current = nextRecs;
      updateAutoMergeRecommendations(nextRecs);
      setAutoMergeJob({
        phase: 'done',
        progress: 100,
        done: tokenRows.length,
        total: tokenRows.length,
        recommendations: nextRecs.filter(r => r.status !== 'declined').length,
        error: null,
        costUsdTotal: usageAcc.costUsd ?? 0,
        costReported,
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        apiCalls,
        elapsedMs: elapsedNow(),
      });
      setTokenMgmtSubTab('auto-merge');
      setTokenMgmtPage(1);
      const visible = nextRecs.filter(r => r.status !== 'declined').length;
      await flushNow();
      const cloud = getCloudSyncSnapshot();
      if (activeProjectId && cloud.project.writeFailed) {
        addToast(
          `${isTestRun ? 'Auto Merge test complete locally' : 'Auto Merge complete locally'}, but cloud sync failed. Check Cloud status.`,
          'warning',
          {
            notification: {
              mode: 'shared',
              source: 'group',
            },
          },
        );
      } else {
        addToast(
          `${isTestRun ? 'Auto Merge test synced' : 'Auto Merge synced'}: ${visible} recommendation${visible === 1 ? '' : 's'}.`,
          'success',
          {
            notification: {
              mode: 'shared',
              source: 'group',
            },
          },
        );
      }
    } catch (e) {
      const isAbort =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (isAbort) {
        setAutoMergeJob({
          phase: 'idle',
          progress: 0,
          done: 0,
          total: 0,
          recommendations: 0,
          error: null,
          costUsdTotal: 0,
          costReported: false,
          promptTokens: 0,
          completionTokens: 0,
          apiCalls: 0,
          elapsedMs: 0,
        });
        addToast('Auto Merge cancelled.', 'info', {
          notification: {
            mode: 'none',
            source: 'group',
          },
        });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setAutoMergeJob(prev => ({
        ...prev,
        phase: 'error',
        error: msg,
        elapsedMs: elapsedNow(),
      }));
      addToast(msg, 'error', {
        notification: {
          mode: 'shared',
          source: 'group',
        },
      });
    }
  }, [addToast, buildAutoMergeRecommendations, groupReviewSettingsSnapshot, updateAutoMergeRecommendations, setTokenMgmtPage, setTokenMgmtSubTab, tokenTopPagesMap, universalBlockedTokens]);

  const handleCancelAutoMerge = useCallback(() => {
    autoMergeAbortRef.current?.abort();
  }, []);

  const applyAutoMergeRecommendation = useCallback((recommendationId: string) => {
    const recs = autoMergeRecommendationsRef.current;
    const rec = recs.find(r => r.id === recommendationId && r.status === 'pending');
    const currentResults = resultsRef.current;
    if (!rec) {
      addToast('That merge recommendation is no longer pending.', 'info');
      return;
    }
    if (!currentResults) {
      addToast('Keyword data is not loaded yet.', 'error');
      return;
    }
    const childTokens = rec.mergeTokens.filter(t => t !== rec.canonicalToken);
    if (childTokens.length === 0) {
      addToast('Nothing to merge for this row (tokens already match canonical).', 'info');
      return;
    }
    const cascade = executeMergeCascade(
      currentResults,
      groupedClustersRef.current,
      approvedGroupsRef.current,
      rec.canonicalToken,
      childTokens,
    );
    const newRule: TokenMergeRule = {
      id: `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      parentToken: rec.canonicalToken,
      childTokens,
      createdAt: new Date().toISOString(),
      source: 'auto-merge',
      recommendationId: rec.id,
    };
    resultsRef.current = cascade.results;
    clusterSummaryRef.current = cascade.clusterSummary;
    tokenSummaryRef.current = cascade.tokenSummary;
    groupedClustersRef.current = cascade.groupedClusters;
    approvedGroupsRef.current = cascade.approvedGroups;
    applyMergeCascade(cascade, newRule);
    const nextRecs = markRecommendationApproved(recs, rec.id, new Date().toISOString());
    autoMergeRecommendationsRef.current = nextRecs;
    updateAutoMergeRecommendations(nextRecs);
    setTokenMgmtSubTab('merge');
    setTokenMgmtPage(1);
    logAndToast('merge', `Auto-merged ${childTokens.join(', ')} → ${rec.canonicalToken}`, childTokens.length, `Auto-merged into '${rec.canonicalToken}'`, 'success');
  }, [addToast, logAndToast, applyMergeCascade, updateAutoMergeRecommendations, setTokenMgmtPage, setTokenMgmtSubTab]);

  const declineAutoMergeRecommendation = useCallback((recommendationId: string) => {
    const recs = autoMergeRecommendationsRef.current;
    const next = recs.map(r => r.id === recommendationId ? { ...r, status: 'declined' as const, reviewedAt: new Date().toISOString() } : r);
    autoMergeRecommendationsRef.current = next;
    updateAutoMergeRecommendations(next);
  }, [updateAutoMergeRecommendations]);

  const applyAllAutoMergeRecommendations = useCallback(() => {
    const pending = autoMergeRecommendationsRef.current.filter(r => r.status === 'pending');
    pending.forEach(r => applyAutoMergeRecommendation(r.id));
  }, [applyAutoMergeRecommendation]);

  const undoAutoMergeRecommendation = useCallback((recommendationId: string) => {
    const rule = tokenMergeRules.find(r => r.recommendationId === recommendationId);
    if (!rule) return;
    handleUndoMergeParent(rule.id);
    const next = markRecommendationPendingAfterUndo(autoMergeRecommendationsRef.current, recommendationId);
    autoMergeRecommendationsRef.current = next;
    updateAutoMergeRecommendations(next);
  }, [handleUndoMergeParent, tokenMergeRules, updateAutoMergeRecommendations]);

  return {
    autoMergeJob,
    setAutoMergeJob,
    handleCancelAutoMerge,
    runAutoMergeRecommendations,
    buildAutoMergeRecommendations,
    applyAutoMergeRecommendation,
    declineAutoMergeRecommendation,
    applyAllAutoMergeRecommendations,
    undoAutoMergeRecommendation,
    tokenTopPagesMap,
    tokenPagesTooltip,
  };
}
