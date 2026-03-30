/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable prefer-const */
import React, { useState, useCallback, useMemo, useEffect, useTransition, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { UploadCloud, Download, FileText, Loader2, AlertCircle, RefreshCw, Database, CheckCircle2, Layers, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Hash, TrendingUp, MapPin, Map as MapIcon, HelpCircle, ShoppingCart, Navigation, Calendar, Filter, BookOpen, Compass, LogIn, LogOut, Save, Bookmark, Sparkles, X, Plus, Folder, Trash2, Lock, Settings, Star, ExternalLink, Copy, Zap, Globe, ClipboardList, Cloud, CloudOff, Lightbulb, List, Check, DollarSign, Inbox, Bell } from 'lucide-react';
import { numberMap, stateMap, stateAbbrToFull, stateFullNames, stopWords, ignoredTokens, synonymMap, countries } from './dictionaries';
import { citySet, cityFirstWords, stateSet, capitalizeWords, normalizeState, detectForeignEntity, normalizeKeywordToTokenArr, getLabelColor } from './processing';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, deleteDoc, onSnapshot, query, where, getDoc, getDocFromServer, addDoc, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import GenerateTab from './GenerateTab';
import ContentTab from './ContentTab';
import FeedbackTab from './FeedbackTab';
import FeatureIdeasTab from './FeatureIdeasTab';
import NotificationsTab from './NotificationsTab';
import UpdatesTab from './UpdatesTab';
import FeedbackModalHost from './FeedbackModalHost';
import AppStatusBar from './AppStatusBar';
import {
  clearListenerError,
  clearProjectPersistErrorFlag,
  CLOUD_SYNC_CHANNELS,
  getCloudSyncSnapshot,
  markListenerError,
  markListenerSnapshot,
} from './cloudSyncStatus';
import GroupReviewSettings, { type GroupReviewSettingsRef, type GroupReviewSettingsData } from './GroupReviewSettings';
import { getFilteredAutoGroupSettingsStatus } from './filteredAutoGroupSettingsStatus';
import { processReviewQueue, normalizeMismatchedPageNames, type ReviewRequest, type ReviewResult, type ReviewError } from './GroupReviewEngine';
import type { ProcessedRow, Cluster, ClusterSummary, TokenSummary, GroupedCluster, GroupMergeRecommendation, BlockedKeyword, LabelSection, Project, Stats, ActivityLogEntry, ActivityAction, TokenMergeRule, AutoGroupSuggestion, AutoMergeRecommendation } from './types';
import { computeMergeImpact, applyMergeRulesToTokenArr, computeSignature, mergeTokenArr } from './tokenMerge';
import MergeConfirmModal from './MergeConfirmModal';
import { useToast } from './ToastContext';
import ActivityLog from './ActivityLog';
import AutoGroupPanel from './AutoGroupPanel';
import GroupAutoMergePanel from './GroupAutoMergePanel';
import { OPENROUTER_REQUEST_TIMEOUT_MS, runWithOpenRouterTimeout } from './openRouterTimeout';
import TopicsSubTab from './TopicsSubTab';
import ProjectsTab from './ProjectsTab';
import InlineHelpHint from './InlineHelpHint';
import TableHeader, { type FilterBag } from './TableHeader';
import { PAGES_COLUMNS, GROUPED_COLUMNS, APPROVED_COLUMNS, BLOCKED_COLUMNS, KEYWORDS_COLUMNS, CELL } from './tableConstants';
import { buildGroupedClusterFromPages, mergeGroupedClustersByName } from './groupedClusterUtils';
import {
  groupedTabChildCity,
  groupedTabChildRowKey,
  groupedTabChildState,
  kdCellDisplay,
  keywordLenForCell,
  pagesTabChildCity,
  pagesTabChildRowKey,
  pagesTabChildState,
  volumeCellDisplay,
} from './clusterExpandChildRows';
import {
  formatKeywordRatingDuration,
} from './KeywordRatingEngine';
import {
  buildProjectDataPayloadFromChunkDocs,
  loadProjectDataFromFirestore,
  saveAppPrefsToFirestore,
  saveAppPrefsToIDB,
  saveToIDB,
  type ProjectDataPayload,
} from './projectStorage';
import {
  createEmptyProjectViewState,
  loadProjectDataForView,
  loadSavedWorkspacePrefs,
  toProjectViewState,
  type ProjectViewState,
} from './projectWorkspace';
import { useProjectPersistence } from './useProjectPersistence';
import {
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  loadCachedState,
  persistAppSettingsDoc,
  subscribeAppSettingsDoc,
} from './appSettingsPersistence';
import { parseTokenMgmtSearchTerms, tokenIncludesAnyTerm } from './tokenMgmtSearch';
import { parseSubClusterKey } from './subClusterKeys';
import { reportPersistFailure } from './persistenceErrors';
import {
  buildMainPath,
  type MainTab,
  type GroupSubTab,
  type SettingsSubTab,
} from './appRouting';
import { useProjectLifecycle } from './hooks/useProjectLifecycle';
import { useNavigationState } from './hooks/useNavigationState';
import { useKeywordWorkspace } from './hooks/useKeywordWorkspace';
import { useGroupingActions } from './hooks/useGroupingActions';
import { useTokenActions } from './hooks/useTokenActions';
import { useKeywordRating } from './hooks/useKeywordRating';
import { useTokenMerge } from './hooks/useTokenMerge';
import { useAutoMerge } from './hooks/useAutoMerge';
import { useGroupAutoMerge } from './hooks/useGroupAutoMerge';
import { useFilteredTableData } from './hooks/useFilteredTableData';

// Error boundary â€" catches any unhandled React error and shows recovery UI instead of white screen
// Must be a class component (React requires it for error boundaries)
const ErrorBoundary = (() => {
  type Props = { children: React.ReactNode; fallbackLabel?: string };
  type State = { hasError: boolean; error: Error | null };
  const Comp: any = class extends React.Component<Props, State> {
    constructor(p: Props) { super(p); (this as any).state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('ErrorBoundary caught:', error, info.componentStack); }
    render() {
      const s = (this as any).state as State;
      const p = (this as any).props as Props;
      if (s.hasError) {
        return (
          <div className="max-w-4xl mx-auto mt-8 p-6 bg-white border border-red-200 rounded-xl shadow-sm text-center">
            <div className="text-red-500 text-lg font-semibold mb-2">Something went wrong</div>
            <p className="text-sm text-zinc-500 mb-1">{p.fallbackLabel || 'An unexpected error occurred.'}</p>
            <p className="text-xs text-zinc-400 mb-4 font-mono">{s.error?.message}</p>
            <button
              onClick={() => (this as any).setState({ hasError: false, error: null })}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              Try Again
            </button>
          </div>
        );
      }
      return p.children;
    }
  };
  return Comp as React.ComponentType<Props>;
})();

interface FilteredAutoGroupRunStats {
  status: 'idle' | 'running' | 'complete' | 'error';
  totalPages: number;
  groupsCreated: number;
  pagesGrouped: number;
  pagesRemaining: number;
  totalVolumeGrouped: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
  error?: string;
}

interface FilteredAutoGroupJob {
  id: string;
  pages: ClusterSummary[];
  filterSummary: string;
  settings: GroupReviewSettingsData;
  modelPricing?: { prompt: string; completion: string };
}

function escapeJsonFromModelResponse(content: string): string | null {
  const trimmed = content.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

function parseFilteredAutoGroupResponse(
  content: string,
  pages: ClusterSummary[]
): ClusterSummary[][] {
  const json = escapeJsonFromModelResponse(content);
  if (!json) return [];

  const idToPage = new Map<string, ClusterSummary>(pages.map((page, idx) => [`P${idx + 1}`, page]));
  const nameToPages = new Map<string, ClusterSummary[]>();
  for (const page of pages) {
    const key = page.pageName.trim().toLowerCase();
    const existing = nameToPages.get(key);
    if (existing) existing.push(page);
    else nameToPages.set(key, [page]);
  }

  const consumed = new Set<string>();
  const resolvedGroups: ClusterSummary[][] = [];

  const takePageByRef = (pageRef: unknown): ClusterSummary | null => {
    const pageKey = String(pageRef ?? '').trim();
    if (!pageKey) return null;
    const byId = idToPage.get(pageKey);
    if (byId && !consumed.has(byId.tokens)) return byId;
    const candidates = nameToPages.get(pageKey.toLowerCase()) || [];
    return candidates.find(candidate => !consumed.has(candidate.tokens)) || null;
  };

  const parsed = JSON.parse(json) as {
    groups?: Array<{ pageIds?: string[]; pages?: string[]; pageNames?: string[]; page_names?: string[] }>;
    assignments?: Array<{
      pageId?: string;
      page?: string;
      targetGroupName?: string;
      groupName?: string;
    }>;
  };

  if (!Array.isArray(parsed.groups) && !Array.isArray(parsed.assignments)) return [];

  if (Array.isArray(parsed.groups)) {
    for (const group of parsed.groups) {
      let resolvedPages: ClusterSummary[] = [];

      if (Array.isArray(group.pageIds) && group.pageIds.length > 0) {
        resolvedPages = group.pageIds
          .map(pageId => takePageByRef(pageId))
          .filter((page): page is ClusterSummary => !!page);
      } else {
        const refs = Array.isArray(group.pages) && group.pages.length > 0
          ? group.pages
          : Array.isArray(group.pageNames) && group.pageNames.length > 0
            ? group.pageNames
            : Array.isArray(group.page_names) && group.page_names.length > 0
              ? group.page_names
              : [];
        for (const pageName of refs) {
          const nextPage = takePageByRef(pageName);
          if (nextPage) resolvedPages.push(nextPage);
        }
      }

      const dedupedPages = resolvedPages.filter(page => {
        if (consumed.has(page.tokens)) return false;
        consumed.add(page.tokens);
        return true;
      });

      if (dedupedPages.length > 0) resolvedGroups.push(dedupedPages);
    }
  }

  if (resolvedGroups.length === 0 && Array.isArray(parsed.assignments)) {
    const groupedAssignments = new Map<string, ClusterSummary[]>();
    for (const assignment of parsed.assignments) {
      const page = takePageByRef(assignment.pageId || assignment.page);
      if (!page) continue;
      const rawTarget = String(assignment.targetGroupName || assignment.groupName || page.pageName).trim();
      const key = rawTarget.toLowerCase();
      const existing = groupedAssignments.get(key) || [];
      existing.push(page);
      groupedAssignments.set(key, existing);
      consumed.add(page.tokens);
    }
    for (const groupPages of groupedAssignments.values()) {
      if (groupPages.length > 0) resolvedGroups.push(groupPages);
    }
  }

  return resolvedGroups;
}

/** Single-cell display for aggregate or per-keyword relevance (1–3) */
const KwRatingCell = React.memo(({ value }: { value: number | null | undefined }) => (
  <td className={CELL.dataCompact}>
    {value != null ? (
      <span
        className={`inline-flex min-w-[1.5rem] justify-center px-1 py-0.5 rounded text-[11px] font-semibold tabular-nums border ${
          value === 1
            ? 'bg-emerald-100/90 text-emerald-900 border-emerald-200/80'
            : value === 2
              ? 'bg-amber-100/90 text-amber-950 border-amber-200/70'
              : 'bg-rose-100/90 text-rose-900 border-rose-200/70'
        }`}
      >
        {value}
      </span>
    ) : (
      <span className="text-zinc-300">—</span>
    )}
  </td>
));

const ClusterRow = React.memo(({
  row,
  isExpanded,
  isSelected,
  selectedTokens,
  toggleCluster,
  onSelect,
  setSelectedTokens,
  setCurrentPage,
  onMiddleClick,
  labelColorMap,
  onBlockToken
}: {
  row: ClusterSummary;
  isExpanded: boolean;
  isSelected: boolean;
  selectedTokens: Set<string>;
  toggleCluster: (p: string) => void;
  onSelect: (checked: boolean) => void;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  onMiddleClick: (e: React.MouseEvent) => void;
  onBlockToken?: (token: string) => void;
  labelColorMap: Map<string, { border: string; bg: string; text: string; sectionName: string }>;
}) => (
  <>
    <tr 
      className="hover:bg-zinc-50/50 transition-colors"
      onAuxClick={onMiddleClick}
    >
      <td className="px-3 py-0.5 text-center" onClick={(e) => e.stopPropagation()}>
        <input 
          type="checkbox" 
          className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          checked={isSelected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 overflow-hidden">
        <div className="flex items-center gap-1.5 group/name">
          <button
            onClick={(e) => { e.stopPropagation(); toggleCluster(row.pageName); }}
            className="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors"
            title={isExpanded ? 'Collapse row' : 'Expand row'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <span className="break-words">{row.pageName}</span>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(row.pageName)}`, '_blank'); }}
            className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0"
            title="Search Google SERPs"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.pageName); }}
            className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0"
            title="Copy page name"
          >
            <Copy className="w-3 h-3" />
          </button>
        </div>
      </td>
      <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs overflow-hidden">
        <div className="flex flex-wrap gap-1">
          {row.tokenArr.map((token, i) => {
            const labelColor = labelColorMap.get(token);
            return (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && onBlockToken) {
                  onBlockToken(token);
                  return;
                }
                const newTokens = new Set(selectedTokens);
                if (newTokens.has(token)) newTokens.delete(token);
                else newTokens.add(token);
                setSelectedTokens(newTokens);
                setCurrentPage(1);
              }}
              className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
              style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
              title={labelColor ? `${labelColor ? `Label: ${labelColor.sectionName} · ` : ''}Ctrl+click to block` : 'Ctrl+click to block'}
            >
              {token}
            </button>
            );
          })}
        </div>
      </td>
      <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">
        {row.pageNameLen}
      </td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.keywordCount.toLocaleString()}
      </td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.totalVolume.toLocaleString()}
      </td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.avgKd !== null ? row.avgKd : '-'}
      </td>
      <KwRatingCell value={row.avgKwRating} />
      <td className="px-3 py-0.5 text-zinc-600">
        {row.label}
      </td>
      <td className="px-3 py-0.5 text-zinc-600 capitalize">
        {row.locationCity || '-'}
      </td>
      <td className="px-3 py-0.5 text-zinc-600 uppercase">
        {row.locationState || '-'}
      </td>
    </tr>
    {isExpanded && row.keywords.map((kw, i) => (
      <tr
        key={pagesTabChildRowKey(row.pageName, i, kw.keyword)}
        className="bg-zinc-50/70 border-b border-zinc-100"
      >
        <td className="px-3 py-0.5" aria-hidden />
        <td className="px-3 py-0.5 text-[12px] overflow-hidden min-w-0">
          <div className="pl-7 min-w-0">
            <span className="text-[11px] font-medium text-zinc-600 break-words" title={kw.keyword}>
              {kw.keyword}
            </span>
          </div>
        </td>
        <td className="px-3 py-0.5 min-w-0" aria-hidden />
        <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">{keywordLenForCell(kw.keyword)}</td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">1</td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">{volumeCellDisplay(kw.volume)}</td>
        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">{kdCellDisplay(kw.kd)}</td>
        <KwRatingCell value={kw.kwRating} />
        <td className="px-3 py-0.5 text-zinc-600 text-[12px]">{row.label}</td>
        <td className="px-3 py-0.5 text-zinc-600 capitalize text-[12px]">{pagesTabChildCity(kw, row)}</td>
        <td className="px-3 py-0.5 text-zinc-600 uppercase text-[12px]">{pagesTabChildState(kw, row)}</td>
      </tr>
    ))}
  </>
));

const TokenRow = React.memo(({ row, selectedTokens, setSelectedTokens, setCurrentPage, switchToPages }: {
  row: TokenSummary;
  selectedTokens: Set<string>;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  switchToPages?: () => void;
}) => (
  <tr className="hover:bg-zinc-50/50 transition-colors">
    <td className="px-3 py-0.5 font-medium text-zinc-700 font-mono text-sm">
      <button
        onClick={() => {
          const newTokens = new Set(selectedTokens);
          if (newTokens.has(row.token)) newTokens.delete(row.token);
          else newTokens.add(row.token);
          setSelectedTokens(newTokens);
          setCurrentPage(1);
          // Switch to Pages (Ungrouped) to show filtered results
          if (switchToPages && newTokens.size > 0) switchToPages();
        }}
        className={`${selectedTokens.has(row.token) ? 'bg-purple-100 text-purple-700 font-semibold' : 'hover:text-indigo-600 hover:bg-indigo-50'} px-1 rounded transition-colors`}
        title="Click to filter keyword management by this token"
      >
        {row.token}
      </button>
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.length}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.frequency.toLocaleString()}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.totalVolume.toLocaleString()}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.avgKd !== null ? row.avgKd : '-'}
    </td>
    <td className="px-3 py-0.5 text-zinc-600">{row.label}</td>
    <td className="px-3 py-0.5 text-zinc-600">{row.locationCity || '-'}</td>
    <td className="px-3 py-0.5 text-zinc-600">{row.locationState || '-'}</td>
  </tr>
));

const GroupedClusterRow = React.memo(({
  row,
  isExpanded,
  expandedSubClusters,
  toggleGroup,
  toggleSubCluster,
  selectedTokens,
  setSelectedTokens,
  setCurrentPage,
  isGroupSelected,
  selectedSubClusters,
  onGroupSelect,
  onSubClusterSelect,
  labelColorMap,
  groupActionButton,
  onBlockToken
}: {
  row: GroupedCluster;
  isExpanded: boolean;
  expandedSubClusters: Set<string>;
  toggleGroup: (id: string) => void;
  toggleSubCluster: (id: string) => void;
  selectedTokens: Set<string>;
  onBlockToken?: (token: string) => void;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  isGroupSelected: boolean;
  selectedSubClusters: Set<string>;
  onGroupSelect: (checked: boolean) => void;
  onSubClusterSelect: (subKey: string, checked: boolean) => void;
  labelColorMap: Map<string, { border: string; bg: string; text: string; sectionName: string }>;
  groupActionButton?: React.ReactNode;
}) => (
  <>
    <tr 
      className="hover:bg-zinc-50/50 transition-colors"
    >
      <td className="px-3 py-0.5" onClick={(e) => e.stopPropagation()}>
        <input 
          type="checkbox" 
          className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          checked={isGroupSelected}
          onChange={(e) => onGroupSelect(e.target.checked)}
        />
      </td>
      <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 overflow-hidden">
        <div className="flex items-center gap-1.5 group/gname">
          <button
            onClick={(e) => { e.stopPropagation(); toggleGroup(row.id); }}
            className="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors"
            title={isExpanded ? 'Collapse group' : 'Expand group'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <span className="break-words">{row.groupName}</span>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(row.groupName)}`, '_blank'); }}
            className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/gname:opacity-100 transition-opacity shrink-0"
            title="Search Google SERPs"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.groupName); }}
            className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/gname:opacity-100 transition-opacity shrink-0"
            title="Copy group name"
          >
            <Copy className="w-3 h-3" />
          </button>
          {groupActionButton && <span onClick={(e) => e.stopPropagation()}>{groupActionButton}</span>}
        </div>
      </td>
      <td className="px-1.5 py-0.5 overflow-hidden">
        <div className="flex flex-wrap gap-1">
          {(() => {
            // Tokens from the highest volume page in the group (matches the page name)
            const topPage = row.clusters.length > 0 ? row.clusters.reduce((best, c) => c.totalVolume > best.totalVolume ? c : best, row.clusters[0]) : null;
            const groupTokens = topPage ? topPage.tokenArr : [];
            return groupTokens.map(token => {
              const labelColor = labelColorMap.get(token);
              return (
                <button
                  key={token}
                  onClick={(e) => {
                    e.stopPropagation();
                    if ((e.ctrlKey || e.metaKey) && onBlockToken) {
                      onBlockToken(token);
                      return;
                    }
                    const newTokens = new Set(selectedTokens);
                    if (newTokens.has(token)) newTokens.delete(token);
                    else newTokens.add(token);
                    setSelectedTokens(newTokens);
                    setCurrentPage(1);
                  }}
                  className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
                  style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
                  title={labelColor ? `${labelColor.sectionName} · Ctrl+click to block` : 'Ctrl+click to block'}
                >
                  {token}
                </button>
              );
            });
          })()}
        </div>
      </td>
      {/* Review Status */}
      <td className="px-1.5 py-0.5 text-center">
        {row.reviewStatus === 'pending' || row.reviewStatus === 'reviewing' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
            <Loader2 className="w-3 h-3 animate-spin" />
          </span>
        ) : row.reviewStatus === 'approve' ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title={row.reviewReason || 'All pages match'}>{'\u2713'}</span>
        ) : row.reviewStatus === 'mismatch' ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 cursor-help" title={`Mismatched: ${(row.reviewMismatchedPages || []).join(', ')}\n${row.reviewReason || ''}`}>{'\u2717'}</span>
        ) : row.reviewStatus === 'error' ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 cursor-help" title={row.reviewReason || 'Review error'}>!</span>
        ) : (
          <span className="text-zinc-300">-</span>
        )}
      </td>
      <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">-</td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.clusters.length.toLocaleString()}
      </td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.keywordCount.toLocaleString()}
      </td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.totalVolume.toLocaleString()}
      </td>
      <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
        {row.avgKd !== null ? row.avgKd : '-'}
      </td>
      <KwRatingCell value={row.avgKwRating} />
      <td className="px-3 py-0.5 text-zinc-600 text-xs">
        {(() => {
          const labels = new Set<string>();
          row.clusters.forEach(c => c.labelArr.forEach(l => labels.add(l)));
          return labels.size > 0 ? Array.from(labels).join(', ') : '-';
        })()}
      </td>
      <td className="px-3 py-0.5 text-zinc-600 text-xs">
        {(() => {
          const cities = new Set<string>();
          row.clusters.forEach(c => { if (c.locationCity) cities.add(c.locationCity); });
          return cities.size > 0 ? Array.from(cities).join(', ') : '-';
        })()}
      </td>
      <td className="px-3 py-0.5 text-zinc-600 text-xs">
        {(() => {
          const states = new Set<string>();
          row.clusters.forEach(c => { if (c.locationState) states.add(c.locationState); });
          return states.size > 0 ? Array.from(states).join(', ') : '-';
        })()}
      </td>
    </tr>
    {isExpanded && (() => {
      const pageNames = row.clusters.map(c => c.pageName);
      const mismatchNorm = new Set(
        normalizeMismatchedPageNames(pageNames, row.reviewMismatchedPages || [])
      );
      const mismatchAmbiguous =
        row.reviewStatus === 'mismatch' && mismatchNorm.size === 0;
      return row.clusters.map((cluster, cIdx) => {
      const subId = `${row.id}-${cluster.pageName}`;
      const isSubExpanded = expandedSubClusters.has(subId);
      return (
        <React.Fragment key={cIdx}>
          <tr 
            className="bg-indigo-50/40 hover:bg-indigo-50/70 transition-colors border-b border-zinc-100"
          >
            <td className="px-3 py-0.5" onClick={(e) => e.stopPropagation()}>
              <input 
                type="checkbox" 
                className="rounded border-zinc-300 text-orange-500 focus:ring-orange-400"
                checked={selectedSubClusters.has(`${row.id}::${cluster.tokens}`)}
                onChange={(e) => onSubClusterSelect(`${row.id}::${cluster.tokens}`, e.target.checked)}
              />
            </td>
            <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 overflow-hidden">
              <div className="flex items-center gap-1.5 pl-6 group/sub">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSubCluster(subId); }}
                  className="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors"
                  title={isSubExpanded ? 'Collapse row' : 'Expand row'}
                >
                  {isSubExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
                <span className="text-[12px] break-words">{cluster.pageName}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent(cluster.pageName)}`, '_blank'); }}
                  className="p-0.5 text-zinc-300 hover:text-blue-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                  title="Search Google SERPs"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(cluster.pageName); }}
                  className="p-0.5 text-zinc-300 hover:text-indigo-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                  title="Copy page name"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </td>
            <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs overflow-hidden">
              <div className="flex flex-wrap gap-1">
                {cluster.tokenArr.map((token, i) => {
                  const labelColor = labelColorMap.get(token);
                  return (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((e.ctrlKey || e.metaKey) && onBlockToken) {
                        onBlockToken(token);
                        return;
                      }
                      const newTokens = new Set(selectedTokens);
                      if (newTokens.has(token)) newTokens.delete(token);
                      else newTokens.add(token);
                      setSelectedTokens(newTokens);
                      setCurrentPage(1);
                    }}
                    className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
                    style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
                    title={labelColor ? `${labelColor.sectionName} · Ctrl+click to block` : 'Ctrl+click to block'}
                  >
                    {token}
                  </button>
                  );
                })}
              </div>
            </td>
            {/* Sub-cluster QA: red = mismatched page; green = OK (approve group, or non-mismatch pages in a mismatch group) */}
            <td className="px-1.5 py-0.5 text-center">
              {mismatchNorm.has(cluster.pageName) ? (
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Flagged as mismatched" />
              ) : row.reviewStatus === 'approve' ? (
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Matches group" />
              ) : row.reviewStatus === 'mismatch' && !mismatchAmbiguous ? (
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Matches group theme" />
              ) : mismatchAmbiguous ? (
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Group mismatch — page list missing or could not be matched" />
              ) : null}
            </td>
            <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">
              {cluster.pageNameLen}
            </td>
            <td className="px-1 py-0.5 text-zinc-400 text-right tabular-nums text-xs">-</td>
            <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
              {cluster.keywordCount.toLocaleString()}
            </td>
            <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
              {cluster.totalVolume.toLocaleString()}
            </td>
            <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
              {cluster.avgKd !== null ? cluster.avgKd : '-'}
            </td>
            <KwRatingCell value={cluster.avgKwRating} />
            <td className="px-3 py-0.5 text-zinc-600">{cluster.label}</td>
            <td className="px-3 py-0.5 text-zinc-600">{cluster.locationCity || '-'}</td>
            <td className="px-3 py-0.5 text-zinc-600">{cluster.locationState || '-'}</td>
          </tr>
          {isSubExpanded && cluster.keywords.map((kw, i) => (
            <tr
              key={groupedTabChildRowKey(subId, i, kw.keyword)}
              className="bg-zinc-50/70 border-b border-zinc-100"
            >
              <td className="px-3 py-0.5" aria-hidden />
              <td className="px-3 py-0.5 text-[12px] overflow-hidden min-w-0">
                <div className="pl-10 min-w-0">
                  <span className="text-[11px] font-medium text-zinc-600 break-words" title={kw.keyword}>
                    {kw.keyword}
                  </span>
                </div>
              </td>
              <td className="px-3 py-0.5 min-w-0" aria-hidden />
              <td className="px-1.5 py-0.5" aria-hidden />
              <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">{keywordLenForCell(kw.keyword)}</td>
              <td className="px-1 py-0.5 text-zinc-400 text-right tabular-nums text-xs">-</td>
              <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">1</td>
              <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">{volumeCellDisplay(kw.volume)}</td>
              <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">{kdCellDisplay(kw.kd)}</td>
              <KwRatingCell value={kw.kwRating} />
              <td className="px-3 py-0.5 text-zinc-600 text-[12px]">{cluster.label}</td>
              <td className="px-3 py-0.5 text-zinc-600 capitalize text-[12px]">{groupedTabChildCity(kw, cluster)}</td>
              <td className="px-3 py-0.5 text-zinc-600 uppercase text-[12px]">{groupedTabChildState(kw, cluster)}</td>
            </tr>
          ))}
        </React.Fragment>
      );
    });
    })()}
  </>
));

// Auto-clear stale caches when the Firebase project changes
const CURRENT_PROJECT_ID = 'new-final-8edfc';
(() => {
  const key = 'kwg_firebase_project';
  const stored = localStorage.getItem(key);
  if (stored && stored !== CURRENT_PROJECT_ID) {
    // Firebase project changed — nuke all local caches to prevent stale data
    console.log('[MIGRATION] Firebase project changed from', stored, 'to', CURRENT_PROJECT_ID, '— clearing caches');
    localStorage.clear();
    indexedDB.deleteDatabase('kwg_database');
  }
  localStorage.setItem(key, CURRENT_PROJECT_ID);
})();

export default function App() {
  const projectsNavRef = useRef<Project[]>([]);
  const activeProjectIdNavRef = useRef<string | null>(null);
  const {
    mainTab,
    setMainTab,
    groupSubTab,
    setGroupSubTab,
    settingsSubTab,
    setSettingsSubTab,
    navigateMainTab,
    navigateGroupSub,
    navigateSettingsSub,
  } = useNavigationState({ activeProjectIdRef: activeProjectIdNavRef, projectsRef: projectsNavRef });
  // Starred models â€” shared across Generate tab and Group Review
  const [starredModels, setStarredModels] = useState<Set<string>>(new Set());
  const { addToast } = useToast();
  useEffect(() => {
    let alive = true;
    const firestoreLoadedRef = { current: false };

    void loadCachedState<{ ids?: string[] }>({
      idbKey: appSettingsIdbKey('starred_models'),
    }).then((cached) => {
      if (!alive || firestoreLoadedRef.current || !cached) return;
      setStarredModels(new Set(Array.isArray(cached.ids) ? cached.ids : []));
    });

    const unsub = subscribeAppSettingsDoc({
      docId: 'starred_models',
      channel: CLOUD_SYNC_CHANNELS.starredModels,
      onData: (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        firestoreLoadedRef.current = true;
        const ids: string[] = snap.exists() && Array.isArray(snap.data()?.ids) ? snap.data()?.ids : [];
        cacheStateLocallyBestEffort({
          idbKey: appSettingsIdbKey('starred_models'),
          value: { ids, updatedAt: new Date().toISOString() },
        });
        setStarredModels(new Set(ids));
      },
      onError: (err) => {
        firestoreLoadedRef.current = true;
        reportPersistFailure(addToast, 'starred models sync', err);
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [addToast]);
  const toggleStarModel = useCallback((modelId: string) => {
    setStarredModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      const arr = [...next];
      void persistAppSettingsDoc({
        docId: 'starred_models',
        data: { ids: arr, updatedAt: new Date().toISOString() },
        addToast,
        localContext: 'starred models',
        cloudContext: 'starred models',
      });
      return next;
    });
  }, [addToast]);
  const [projects, setProjects] = useState<Project[]>([]);

  // -- Project persistence hook -- single source of truth for all 14 persisted state variables --
  const persistence = useProjectPersistence({ projects, setProjects, addToast });
  const {
    results, clusterSummary, tokenSummary, groupedClusters,
    approvedGroups, blockedKeywords, activityLog, stats,
    datasetStats, autoGroupSuggestions, autoMergeRecommendations, groupMergeRecommendations, tokenMergeRules,
    blockedTokens, labelSections, fileName,
    activeProjectId, setActiveProjectId,
    loadProject, clearProject, syncFileNameLocal, flushNow,
    removeFromApproved, ungroupPages,
    addActivityEntry,
    updateGroupMergeRecommendations,
    bulkSet,
    // Transitional setters (will be removed as mutations replace them)
    setResults, setClusterSummary, setTokenSummary, setGroupedClusters,
    setApprovedGroups, setBlockedKeywords, setActivityLog, setStats,
    setDatasetStats, setAutoGroupSuggestions, setAutoMergeRecommendations, setGroupMergeRecommendations, setTokenMergeRules,
    setBlockedTokens, setLabelSections, setFileName,
    refs: persistenceRefs,
  } = persistence;

  useEffect(() => {
    clearProjectPersistErrorFlag();
  }, [activeProjectId]);

  // Convenience aliases for transitional refs (used by legacy code during migration)
  const activeProjectIdRef = persistenceRefs.activeProjectId;
  const resultsRef = persistenceRefs.results;
  const clusterSummaryRef = persistenceRefs.clusterSummary;
  const tokenSummaryRef = persistenceRefs.tokenSummary;
  const groupedClustersRef = persistenceRefs.groupedClusters;
  const approvedGroupsRef = persistenceRefs.approvedGroups;
  const blockedKeywordsRef = persistenceRefs.blockedKeywords;
  const statsRef = persistenceRefs.stats;
  const datasetStatsRef = persistenceRefs.datasetStats;
  const autoGroupSuggestionsRef = persistenceRefs.autoGroupSuggestions;
  const autoMergeRecommendationsRef = persistenceRefs.autoMergeRecommendations;
  const groupMergeRecommendationsRef = persistenceRefs.groupMergeRecommendations;
  const tokenMergeRulesRef = persistenceRefs.tokenMergeRules;
  const blockedTokensRef = persistenceRefs.blockedTokens;
  const labelSectionsRef = persistenceRefs.labelSections;
  const fileNameRef = persistenceRefs.fileName;

  projectsNavRef.current = projects;
  activeProjectIdNavRef.current = activeProjectId;

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isProjectCardCollapsed, setIsProjectCardCollapsed] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
  const [groupNameInput, setGroupNameInput] = useState<string>('');
  const [expandedGroupedClusters, setExpandedGroupedClusters] = useState<Set<string>>(new Set());
  const [expandedGroupedSubClusters, setExpandedGroupedSubClusters] = useState<Set<string>>(new Set());
  // AI Group Review
  const [showGroupReviewSettings, setShowGroupReviewSettings] = useState(false);
  const groupReviewSettingsRef = useRef<GroupReviewSettingsRef>(null);
  const [groupReviewSettingsSnapshot, setGroupReviewSettingsSnapshot] = useState<GroupReviewSettingsData | null>(null);
  const [groupReviewSettingsHydrated, setGroupReviewSettingsHydrated] = useState(false);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const reviewProcessingRef = useRef(false);
  const filteredAutoGroupAbortRef = useRef<AbortController | null>(null);
  const [autoMergeSortConfig, setAutoMergeSortConfig] = useState<{
    key: 'canonical' | 'mergeTokens' | 'impact' | 'confidence' | 'status';
    direction: 'asc' | 'desc';
  }>({ key: 'confidence', direction: 'desc' });
  const activeFilteredAutoGroupJobRef = useRef<FilteredAutoGroupJob | null>(null);
  const [isRunningFilteredAutoGroup, setIsRunningFilteredAutoGroup] = useState(false);
  const [pendingFilteredAutoGroupTokens, setPendingFilteredAutoGroupTokens] = useState<Set<string>>(new Set());
  const [filteredAutoGroupQueue, setFilteredAutoGroupQueue] = useState<FilteredAutoGroupJob[]>([]);
  const [filteredAutoGroupStats, setFilteredAutoGroupStats] = useState<FilteredAutoGroupRunStats>({
    status: 'idle',
    totalPages: 0,
    groupsCreated: 0,
    pagesGrouped: 0,
    pagesRemaining: 0,
    totalVolumeGrouped: 0,
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
    elapsedMs: 0,
  });
  // Debounced QA re-review
  const reReviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reReviewGroupIds = useRef<Set<string>>(new Set());
  // Ungrouping: track selected groups and sub-clusters within groups (see useKeywordWorkspace)
  const [, startTransition] = useTransition();
  const {
    selectedGroups,
    setSelectedGroups,
    selectedSubClusters,
    setSelectedSubClusters,
    activeTab,
    setActiveTab,
    switchTab,
    statsExpanded,
    setStatsExpanded,
    error,
    setError,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    setDebouncedSearchQuery,
    setSearchImmediate,
    minClusterCount,
    setMinClusterCount,
    maxClusterCount,
    setMaxClusterCount,
    minTokenLen,
    setMinTokenLen,
    maxTokenLen,
    setMaxTokenLen,
    excludedLabels,
    setExcludedLabels,
    selectedTokens,
    setSelectedTokens,
    isLabelDropdownOpen,
    setIsLabelDropdownOpen,
    sortConfig,
    setSortConfig,
    tokenSortConfig,
    setTokenSortConfig,
    groupedSortConfig,
    setGroupedSortConfig,
    keywordsSortConfig,
    setKeywordsSortConfig,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    expandedClusters,
    setExpandedClusters,
    filterCity,
    setFilterCity,
    filterState,
    setFilterState,
    minLen,
    setMinLen,
    maxLen,
    setMaxLen,
    minKwInCluster,
    setMinKwInCluster,
    maxKwInCluster,
    setMaxKwInCluster,
    minVolume,
    setMinVolume,
    maxVolume,
    setMaxVolume,
    minKd,
    setMinKd,
    maxKd,
    setMaxKd,
    minKwRating,
    setMinKwRating,
    maxKwRating,
    setMaxKwRating,
    tokenMgmtSearch,
    setTokenMgmtSearch,
    tokenMgmtSort,
    setTokenMgmtSort,
    selectedMgmtTokens,
    setSelectedMgmtTokens,
    tokenMgmtPage,
    setTokenMgmtPage,
    tokenMgmtPerPage,
    tokenMgmtSubTab,
    setTokenMgmtSubTab,
    expandedMergeParents,
    setExpandedMergeParents,
  } = useKeywordWorkspace({ setSelectedClusters });

  // Universal blocked tokens â€” persists across ALL projects (global, not project-specific)
  const [universalBlockedTokens, setUniversalBlockedTokens] = useState<Set<string>>(new Set<string>());
  const universalBlockedHydratedRef = useRef(false);
  const lastUniversalBlockedSavedRef = useRef<string>('');

  // Persist universal blocked to Firestore on every change
  useEffect(() => {
    if (!universalBlockedHydratedRef.current) return;
    const arr = Array.from(universalBlockedTokens);
    const payloadJson = JSON.stringify(arr);
    if (payloadJson === lastUniversalBlockedSavedRef.current) return;
    lastUniversalBlockedSavedRef.current = payloadJson;
    void persistAppSettingsDoc({
      docId: 'universal_blocked',
      data: { tokens: arr, updatedAt: new Date().toISOString() },
      addToast,
      localContext: 'universal blocked tokens',
      cloudContext: 'universal blocked tokens',
    });
  }, [universalBlockedTokens, addToast]);

  // Load universal blocked from Firestore on mount
  useEffect(() => {
    let alive = true;
    const firestoreLoadedRef = { current: false };

    void loadCachedState<{ tokens?: string[] }>({
      idbKey: appSettingsIdbKey('universal_blocked'),
    }).then((cached) => {
      if (!alive || firestoreLoadedRef.current || !cached) {
        universalBlockedHydratedRef.current = true;
        return;
      }
      const tokens = Array.isArray(cached.tokens) ? cached.tokens : [];
      lastUniversalBlockedSavedRef.current = JSON.stringify(tokens);
      setUniversalBlockedTokens(new Set<string>(tokens));
      universalBlockedHydratedRef.current = true;
    });

    const unsub = subscribeAppSettingsDoc({
      docId: 'universal_blocked',
      channel: CLOUD_SYNC_CHANNELS.universalBlocked,
      onData: (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        firestoreLoadedRef.current = true;
        const tokens = snap.exists() && Array.isArray(snap.data()?.tokens) ? snap.data()?.tokens : [];
        lastUniversalBlockedSavedRef.current = JSON.stringify(tokens);
        cacheStateLocallyBestEffort({
          idbKey: appSettingsIdbKey('universal_blocked'),
          value: { tokens, updatedAt: new Date().toISOString() },
        });
        setUniversalBlockedTokens(new Set<string>(tokens));
        universalBlockedHydratedRef.current = true;
      },
      onError: (err) => {
        firestoreLoadedRef.current = true;
        universalBlockedHydratedRef.current = true;
        reportPersistFailure(addToast, 'universal blocked tokens sync', err);
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [addToast]);

  const [isLabelSidebarOpen, setIsLabelSidebarOpen] = useState(true);
  const [labelSortConfigs, setLabelSortConfigs] = useState<Record<string, { key: 'token' | 'kws' | 'vol' | 'kd'; direction: 'asc' | 'desc' }>>({});

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [savedClusters, setSavedClusters] = useState<any[]>([]);
  const [isGenerateBusy, setIsGenerateBusy] = useState(false);
  const [isContentBusy, setIsContentBusy] = useState(false);
  const isProjectWorkspaceBusy = isGenerateBusy || isContentBusy;
  const handleProjectChangeBlocked = useCallback(() => {
    addToast('Stop or wait for Generate/Content to finish before switching projects.', 'warning');
  }, [addToast]);
  const { createProject, deleteProject, reviveProject, permanentlyDeleteProject, selectProject } = useProjectLifecycle({
    projects,
    setProjects,
    activeProjectId,
    activeProjectIdRef,
    setActiveProjectId,
    loadProject,
    clearProject,
    syncFileNameLocal,
    mainTab,
    groupSubTab,
    setMainTab,
    setGroupSubTab,
    setSettingsSubTab,
    setIsProjectLoading,
    setIsAuthReady,
    setSavedClusters,
    newProjectName,
    newProjectDescription,
    setNewProjectName,
    setNewProjectDescription,
    setProjectError,
    setIsCreatingProject,
    canChangeProject: () => !isProjectWorkspaceBusy,
    onProjectChangeBlocked: handleProjectChangeBlocked,
  });

  // Realtime workspace prefs (shared between collaborators).
  // These control *which* project we're focusing on plus the saved cluster list.
  const savedClustersHashRef = useRef<string>('');
  useEffect(() => {
    try { savedClustersHashRef.current = JSON.stringify(savedClusters ?? []); } catch { savedClustersHashRef.current = ''; }
  }, [savedClusters]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'app_settings', 'user_preferences'), (snap) => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.userPreferences, snap);
      if (!snap.exists()) return;
      const data = snap.data() as any;
      const remoteSavedClusters = Array.isArray(data?.savedClusters) ? data.savedClusters : [];

      const remoteHash = (() => {
        try { return JSON.stringify(remoteSavedClusters); } catch { return ''; }
      })();

      if (remoteHash !== savedClustersHashRef.current) {
        setSavedClusters(remoteSavedClusters);
      }
      // Do not apply `remoteActiveProjectId` from this shared doc: it would let another
      // collaborator's focus overwrite the local session (see App.shared-projects.integration.test).
      // Active project is resolved at init (URL + IDB) and pushed to Firestore locally only.
    }, (err) => {
      markListenerError(CLOUD_SYNC_CHANNELS.userPreferences);
      reportPersistFailure(addToast, 'user preferences sync', err);
    });
    return () => {
      clearListenerError(CLOUD_SYNC_CHANNELS.userPreferences);
      if (typeof unsub === 'function') unsub();
    };
  }, [addToast]);

  const handleLogin = async () => {};
  const handleLogout = async () => {};

  // Persist active project ID whenever it changes (both fire-and-forget in parallel)
  useEffect(() => {
    try {
      saveAppPrefsToFirestore(activeProjectId, savedClusters)?.catch(() => undefined);
    } catch (_error) {
      // Ignore sync preference-save exceptions; normal writes use project persistence.
    }
    try {
      saveAppPrefsToIDB(activeProjectId, savedClusters)?.catch(() => undefined);
    } catch (_error) {
      // Ignore sync preference-save exceptions; normal writes use project persistence.
    }
  }, [activeProjectId, savedClusters]);

  const processCSV = (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    setError(null);
    if (activeProjectId) {
      syncFileNameLocal(file.name);
    } else {
      setFileName(file.name);
    }

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

          const processChunk = () => {
            try {
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

                // Check for foreign countries/cities â€" block these keywords
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
                
                // Check for NYC aliases â†' city "New York City", state "New York"
                const isNycAlias = keywordLower.includes('nyc') || keywordLower.includes('new york city');
                if (isNycAlias) {
                  locationCity = 'New York City';
                  locationState = 'New York';
                }

                // Check for LA alias â†' city "Los Angeles", state "California"
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
                      const nextToken = rawTokens[j+1];
                      if (nextToken) {
                        const twoWord = `${token} ${nextToken}`;
                        if (stateSet.has(twoWord) && !stopWords.has(twoWord)) {
                          locationState = normalizeState(twoWord);
                          break;
                        }
                      }
                    }
                    // Try 1-word state (skip "la" â€" almost always means Los Angeles, not Louisiana)
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
                requestAnimationFrame(processChunk);
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

    // No auto-grouping â€" all pages start in Pages (Ungrouped). User groups manually.
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

    if (activeProjectId) {
      // Single atomic path: bulkSet updates latest ref + React state + persist (REFACTOR_PLAN P0.1)
      persistence.bulkSet({
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
    } else {
      setResults(outputData);
      setClusterSummary(summaryData);
      setGroupedClusters([]);
      setTokenSummary(tokenSummaryData);
      setBlockedKeywords(blockedRows);
      setTokenMergeRules([]);
      setAutoGroupSuggestions([]);
      setAutoMergeRecommendations([]);
      setGroupMergeRecommendations([]);
      setFileName(file.name);
      setStats(statsObj);
      setDatasetStats(datasetStatsObj);
    }

                setActiveTab('pages');
                setIsProcessing(false);
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
            }
          };

          processChunk();
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
      }
    });
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Ref to always call the latest processCSV (avoids stale closure in useCallback)
  const processCSVRef = useRef(processCSV);
  processCSVRef.current = processCSV;

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

  const exportCSV = () => {
    if (!results || !clusterSummary || !tokenSummary) return;

    const timestamp = new Date().getTime();
    const appNamePart = 'seo-magic';
    const rawProjectName = activeProjectId ? projects.find(p => p.id === activeProjectId)?.name : null;
    const slugifyFilePart = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const projectNamePart = slugifyFilePart(rawProjectName || 'project');
    const iso = new Date(timestamp).toISOString();
    const datePart = iso.slice(0, 10); // YYYY-MM-DD

    const downloadCSV = (csv: string, filename: string) => {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    const downloadXlsx = (workbook: XLSX.WorkBook, filename: string) => {
      const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    const groupLabelsToString = (group: GroupedCluster) => {
      const labels = new Set<string>();
      group.clusters.forEach(c => {
        if (Array.isArray(c.labelArr) && c.labelArr.length > 0) {
          c.labelArr.forEach(l => labels.add(l));
        } else if (c.label) {
          labels.add(c.label);
        }
      });
      return Array.from(labels).sort((a, b) => a.localeCompare(b)).join('; ');
    };

    if (activeTab === 'pages') {
      const csv = Papa.unparse({
        fields: ['Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Rating', 'Label', 'City', 'State'],
        data: clusterSummary.map(row => [
          row.pageName,
          row.pageNameLen,
          row.tokens,
          row.keywordCount,
          row.totalVolume,
          row.avgKd !== null ? row.avgKd : '',
          row.avgKwRating != null ? row.avgKwRating : '',
          row.label,
          row.locationCity || '',
          row.locationState || ''
        ])
      });

      downloadCSV(
        csv,
        `${appNamePart}_${projectNamePart}_${activeTab}_export_${datePart}_${timestamp}.csv`
      );
      return;
    }

    if (activeTab === 'grouped') {
      // 1) Per-page rows
      const rowsHeader = ['Group Name', 'Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Rating', 'Label', 'City', 'State'];
      const rowsData: any[][] = [];
      groupedClusters.forEach(group => {
        group.clusters.forEach(cluster => {
          rowsData.push([
            group.groupName,
            cluster.pageName,
            cluster.pageNameLen,
            cluster.tokens,
            cluster.keywordCount,
            cluster.totalVolume,
            cluster.avgKd !== null ? cluster.avgKd : '',
            cluster.avgKwRating != null ? cluster.avgKwRating : '',
            cluster.label,
            cluster.locationCity || '',
            cluster.locationState || ''
          ]);
        });
      });
      
      // 2) Unique group summary
      const groupsHeader = ['Group Name', 'Page #', 'Summed KWs', 'Volume', 'Avg KD', 'Avg Rating', 'Labels'];
      const groupsData: any[][] = groupedClusters.map(group => ([
        group.groupName,
        group.clusters?.length ?? 0,
        group.keywordCount,
        group.totalVolume,
        group.avgKd !== null ? group.avgKd : '',
        group.avgKwRating != null ? group.avgKwRating : '',
        groupLabelsToString(group),
      ]));

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet([rowsHeader, ...rowsData]);
      const ws2 = XLSX.utils.aoa_to_sheet([groupsHeader, ...groupsData]);
      XLSX.utils.book_append_sheet(wb, ws1, 'Rows');
      XLSX.utils.book_append_sheet(wb, ws2, 'Unique Groups');

      downloadXlsx(wb, `${appNamePart}_${projectNamePart}_grouped_export_${datePart}_${timestamp}.xlsx`);
      return;
    }

    if (activeTab === 'approved') {
      // 1) Per-page rows
      const rowsHeader = ['Group Name', 'Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Rating', 'Label', 'City', 'State'];
      const rowsData: any[][] = [];
      approvedGroups.forEach(group => {
        group.clusters.forEach(cluster => {
          rowsData.push([
            group.groupName,
            cluster.pageName,
            cluster.pageNameLen,
            cluster.tokens,
            cluster.keywordCount,
            cluster.totalVolume,
            cluster.avgKd !== null ? cluster.avgKd : '',
            cluster.avgKwRating != null ? cluster.avgKwRating : '',
            cluster.label,
            cluster.locationCity || '',
            cluster.locationState || ''
          ]);
        });
      });

      // 2) Unique group summary
      const groupsHeader = ['Group Name', 'Page #', 'Summed KWs', 'Volume', 'Avg KD', 'Avg Rating', 'Labels'];
      const groupsData: any[][] = approvedGroups.map(group => ([
        group.groupName,
        group.clusters?.length ?? 0,
        group.keywordCount,
        group.totalVolume,
        group.avgKd !== null ? group.avgKd : '',
        group.avgKwRating != null ? group.avgKwRating : '',
        groupLabelsToString(group),
      ]));

      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.aoa_to_sheet([rowsHeader, ...rowsData]);
      const ws2 = XLSX.utils.aoa_to_sheet([groupsHeader, ...groupsData]);
      XLSX.utils.book_append_sheet(wb, ws1, 'Rows');
      XLSX.utils.book_append_sheet(wb, ws2, 'Unique Groups');

      downloadXlsx(wb, `${appNamePart}_${projectNamePart}_approved_export_${datePart}_${timestamp}.xlsx`);
      return;
    }
  };

  const reset = () => {
    if (activeProjectId) {
      clearProject();
    } else {
      setResults(null);
      setClusterSummary(null);
      setTokenSummary(null);
      setAutoMergeRecommendations([]);
      setGroupMergeRecommendations([]);
      setStats(null);
      setFileName(null);
      setGroupedClusters([]);
      setApprovedGroups([]);
      setActivityLog([]);
      setAutoGroupSuggestions([]);
      setTokenMergeRules([]);
      setBlockedTokens(new Set());
    }
    setError(null);
    setActiveTab('pages');
    setSearchImmediate('');
    setMinClusterCount('');
    setMaxClusterCount('');
    setMinTokenLen('');
    setMaxTokenLen('');
    setSortConfig({ key: 'keywordCount', direction: 'desc' });
    setTokenSortConfig({ key: 'frequency', direction: 'desc' });
    setCurrentPage(1);
    setExpandedClusters(new Set());
    setExcludedLabels(new Set());
    setSelectedTokens(new Set());
    setIsLabelDropdownOpen(false);
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('all');
    setGroupedSortConfig({ key: 'keywordCount', direction: 'desc' });
  };

  // Check if a row's tokens contain any blocked token
  // Check both project-specific AND universal blocked token sets
  const hasBlockedToken = useCallback((tokenArr: string[]) => {
    if (blockedTokens.size === 0 && universalBlockedTokens.size === 0) return false;
    for (const t of tokenArr) {
      if (blockedTokens.has(t) || universalBlockedTokens.has(t)) return true;
    }
    return false;
  }, [blockedTokens, universalBlockedTokens]);

  const {
    kwRatingJob, setKwRatingJob, runKeywordRating, handleCancelKeywordRating,
  } = useKeywordRating({
    resultsRef, groupedClustersRef, approvedGroupsRef, clusterSummaryRef,
    groupReviewSettingsRef, groupReviewSettingsSnapshot,
    results, hasBlockedToken, addToast, bulkSet: persistence.bulkSet, activeProjectId, flushNow,
  });

  // Effective results: filter out keywords whose tokens contain a blocked token
  // Multi-sort handler: regular click = replace sort, Shift+click = add/toggle secondary sort
  const handleSort = useCallback((key: keyof ClusterSummary, additive?: boolean) => {
    setSortConfig(current => {
      const existingIdx = current.findIndex(s => s.key === key);
      if (additive) {
        // Shift+click: add as secondary sort or toggle direction if already in list
        if (existingIdx >= 0) {
          const updated = [...current];
          updated[existingIdx] = { key, direction: updated[existingIdx].direction === 'desc' ? 'asc' : 'desc' };
          return updated;
        }
        return [...current, { key, direction: 'desc' }];
      }
      // Regular click: if already primary, toggle direction. Otherwise replace all with this one.
      if (existingIdx === 0 && current.length === 1) {
        return [{ key, direction: current[0].direction === 'desc' ? 'asc' : 'desc' }];
      }
      return [{ key, direction: 'desc' }];
    });
    setCurrentPage(1);
  }, []);

  const handleTokenSort = useCallback((key: keyof TokenSummary) => {
    setTokenSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
    setCurrentPage(1);
  }, []);

  const toggleCluster = useCallback((pageName: string) => {
    setExpandedClusters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageName)) {
        newSet.delete(pageName);
      } else {
        newSet.add(pageName);
      }
      return newSet;
    });
  }, []);

  const SortIcon = ({ columnKey }: { columnKey: keyof ClusterSummary }) => {
    if (sortConfig.length > 1) {
      const idx = sortConfig.findIndex(s => s.key === columnKey);
      if (idx >= 0) {
        const dir = sortConfig[idx].direction;
        return <span className="inline-flex items-center gap-0.5">{dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 text-indigo-600" /> : <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />}<span className="text-[8px] font-bold text-indigo-500">{idx + 1}</span></span>;
      }
      return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    }
    const primary = sortConfig[0];
    if (!primary || primary.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    return primary.direction === 'asc' ? <ArrowUp className="w-4 h-4 text-indigo-600" /> : <ArrowDown className="w-4 h-4 text-indigo-600" />;
  };

  // Unified sort handler for grouped/approved tabs
  const handleGroupedSort = useCallback((key: string, additive?: boolean) => {
    setGroupedSortConfig(current => {
      const existingIdx = current.findIndex(s => s.key === key);
      if (additive) {
        if (existingIdx >= 0) {
          const updated = [...current];
          updated[existingIdx] = { key, direction: updated[existingIdx].direction === 'desc' ? 'asc' : 'desc' };
          return updated;
        }
        return [...current, { key, direction: 'desc' }];
      }
      if (existingIdx === 0 && current.length === 1) {
        return [{ key, direction: current[0].direction === 'desc' ? 'asc' : 'desc' }];
      }
      return [{ key, direction: 'desc' }];
    });
    setCurrentPage(1);
  }, []);

  // Blocked tab sort
  const [blockedSortConfig, setBlockedSortConfig] = useState<{key: string, direction: 'asc' | 'desc'}>({ key: 'volume', direction: 'desc' });
  const handleBlockedSort = useCallback((key: string) => {
    setBlockedSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
    setCurrentPage(1);
  }, []);

  const handleKeywordsSort = useCallback((key: string, additive?: boolean) => {
    setKeywordsSortConfig(current => {
      const existingIdx = current.findIndex(s => s.key === key);
      if (additive) {
        if (existingIdx >= 0) {
          const updated = [...current];
          updated[existingIdx] = { key, direction: updated[existingIdx].direction === 'desc' ? 'asc' : 'desc' };
          return updated;
        }
        return [...current, { key, direction: 'desc' }];
      }
      if (existingIdx === 0 && current.length === 1) {
        return [{ key, direction: current[0].direction === 'desc' ? 'asc' : 'desc' }];
      }
      return [{ key, direction: 'desc' }];
    });
    setCurrentPage(1);
  }, []);


  const filteredData = useFilteredTableData({
    results, clusterSummary, tokenSummary, groupedClusters, approvedGroups,
    blockedKeywords, blockedTokens, labelSections,
    hasBlockedToken, pendingFilteredAutoGroupTokens, selectedTokens,
    debouncedSearchQuery, activeTab, isLabelDropdownOpen,
    minClusterCount, maxClusterCount,
    minLen, maxLen, minKwInCluster, maxKwInCluster,
    minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating,
    filterCity, filterState, excludedLabels,
    minTokenLen, maxTokenLen,
    sortConfig, tokenSortConfig, keywordsSortConfig, blockedSortConfig,
    currentPage, itemsPerPage,
  });

  const {
    effectiveResults, effectiveClusters, effectiveGrouped,
    tokenBlockedKeywords, allBlockedKeywords,
    min, max, hasMin, hasMax, validClusterCounts, clusterByTokens,
    labelCounts, filteredClusters, filteredResultsData, filteredResults,
    sortedKeywordRows, sortedClusters, filteredTokens, sortedTokens,
    displayedValid, displayedClusters, displayedTokens, displayedVolume,
    labelColorMap, labelSectionStats, filteredTokenCounts,
    paginatedResults, paginatedClusters, paginatedTokens,
    filteredSortedGrouped, paginatedGroupedClusters,
    filteredApprovedGroups, filteredBlocked, sortedBlocked,
    groupedStats, approvedPageCount, keywordGroupingProgress,
  } = filteredData;

  // Shared filter bag for TableHeader — single object passed to all tabs
  const filterBag = useMemo((): FilterBag => ({
    minLen, setMinLen, maxLen, setMaxLen,
    minKwInCluster, setMinKwInCluster, maxKwInCluster, setMaxKwInCluster,
    minVolume, setMinVolume, maxVolume, setMaxVolume,
    minKd, setMinKd, maxKd, setMaxKd,
    minKwRating, setMinKwRating, maxKwRating, setMaxKwRating,
    filterCity, setFilterCity, filterState, setFilterState,
    excludedLabels, setExcludedLabels,
    isLabelDropdownOpen, setIsLabelDropdownOpen,
    labelCounts,
  }), [minLen, maxLen, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, minKwRating, maxKwRating, filterCity, filterState, excludedLabels, isLabelDropdownOpen, labelCounts]);

  const TokenSortIcon = ({ columnKey }: { columnKey: keyof TokenSummary }) => {
    if (tokenSortConfig.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    return tokenSortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 text-indigo-600" /> : <ArrowDown className="w-4 h-4 text-indigo-600" />;
  };


  type MergeTokenStats = { frequency: number; totalVolume: number; avgKd: number | null };
  type MergeRuleRow = {
    ruleId: string;
    parentToken: string;
    childTokens: string[];
    parentStats: MergeTokenStats;
    childStats: Record<string, MergeTokenStats>;
  };

  const tokenMgmtMergeSearchTerms = useMemo(() => parseTokenMgmtSearchTerms(tokenMgmtSearch), [tokenMgmtSearch]);

  // Merge subtab rows: 1 row per parent token + collapsible children underneath.
  // We compute token stats by simulating merges in rule order on a per-row tokenArr basis,
  // and measuring child token stats from the "stage before" the rule is applied.
  const mergeMgmtRuleRows = useMemo<MergeRuleRow[]>(() => {
    if (tokenMgmtSubTab !== 'merge') return [];
    if (!results || tokenMergeRules.length === 0) return [];

    const tokensByRow: string[][] = results.map(r => [...(r.originalTokenArr ?? r.tokenArr)]);
    const mergeRows: MergeRuleRow[] = [];

    for (const rule of tokenMergeRules) {
      const childSet = new Set(rule.childTokens);

      // Group rows into "clusters" based on the token signature at this stage.
      const signatureToCluster = new Map<string, { tokensArr: string[]; volume: number; kd: number | null }>();
      for (let i = 0; i < results.length; i++) {
        const signature = computeSignature(tokensByRow[i]);
        const existing = signatureToCluster.get(signature);
        if (!existing) {
          signatureToCluster.set(signature, {
            tokensArr: signature ? signature.split(' ') : [],
            volume: results[i].searchVolume,
            kd: results[i].kd,
          });
        } else {
          existing.volume += results[i].searchVolume;
          if (results[i].kd !== null && existing.kd === null) existing.kd = results[i].kd;
        }
      }

      // Token stats for each child token are computed from clusters where that child exists.
      const rawChildStats = new Map<string, { frequency: number; totalVolume: number; totalKd: number; kdCount: number }>();
      for (const cluster of signatureToCluster.values()) {
        // Match rebuildTokenSummary: frequency = number of clusters containing the token.
        for (const token of cluster.tokensArr) {
          if (!childSet.has(token)) continue;
          const existing = rawChildStats.get(token);
          if (!existing) rawChildStats.set(token, { frequency: 1, totalVolume: cluster.volume, totalKd: cluster.kd !== null ? cluster.kd : 0, kdCount: cluster.kd !== null ? 1 : 0 });
          else {
            existing.frequency++;
            existing.totalVolume += cluster.volume;
            if (cluster.kd !== null) { existing.totalKd += cluster.kd; existing.kdCount++; }
          }
        }
      }

      const childStats: Record<string, MergeTokenStats> = {};
      let parentFrequency = 0;
      let parentTotalVolume = 0;
      let parentTotalKd = 0;
      let parentKdCount = 0;

      for (const child of rule.childTokens) {
        const st = rawChildStats.get(child);
        if (!st) {
          childStats[child] = { frequency: 0, totalVolume: 0, avgKd: null };
          continue;
        }
        childStats[child] = {
          frequency: st.frequency,
          totalVolume: st.totalVolume,
          avgKd: st.kdCount > 0 ? Math.round(st.totalKd / st.kdCount) : null,
        };
        parentFrequency += st.frequency;
        parentTotalVolume += st.totalVolume;
        parentTotalKd += st.totalKd;
        parentKdCount += st.kdCount;
      }

      const parentStats: MergeTokenStats = {
        frequency: parentFrequency,
        totalVolume: parentTotalVolume,
        avgKd: parentKdCount > 0 ? Math.round(parentTotalKd / parentKdCount) : null,
      };

      mergeRows.push({
        ruleId: rule.id,
        parentToken: rule.parentToken,
        childTokens: [...rule.childTokens],
        parentStats,
        childStats,
      });

      // Apply this rule so the next iteration measures the stage after.
      for (let i = 0; i < results.length; i++) {
        if (tokensByRow[i].some(t => childSet.has(t))) {
          tokensByRow[i] = mergeTokenArr(tokensByRow[i], rule.parentToken, rule.childTokens);
        }
      }
    }

    return mergeRows;
  }, [tokenMgmtSubTab, results, tokenMergeRules]);

  const filteredMergeRuleRows = useMemo(() => {
    if (tokenMgmtSubTab !== 'merge') return [];
    if (mergeMgmtRuleRows.length === 0) return [];
    if (tokenMgmtMergeSearchTerms.length === 0) return mergeMgmtRuleRows;

    return mergeMgmtRuleRows.filter(r => {
      if (tokenIncludesAnyTerm(r.parentToken, tokenMgmtMergeSearchTerms)) return true;
      return r.childTokens.some(c => tokenIncludesAnyTerm(c, tokenMgmtMergeSearchTerms));
    });
  }, [tokenMgmtSubTab, mergeMgmtRuleRows, tokenMgmtMergeSearchTerms]);

  const sortedMergeRuleRows = useMemo(() => {
    if (tokenMgmtSubTab !== 'merge') return [];
    const { key, direction } = tokenMgmtSort;

    const dir = direction === 'asc' ? 1 : -1;
    const cmp = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * dir;
    };

    return [...filteredMergeRuleRows].sort((a, b) => {
      if (key === 'token') return dir * a.parentToken.localeCompare(b.parentToken);
      if (key === 'frequency') return cmp(a.parentStats.frequency, b.parentStats.frequency);
      if (key === 'totalVolume') return cmp(a.parentStats.totalVolume, b.parentStats.totalVolume);
      if (key === 'avgKd') return cmp(a.parentStats.avgKd, b.parentStats.avgKd);
      return 0;
    });
  }, [tokenMgmtSubTab, filteredMergeRuleRows, tokenMgmtSort]);

  const mergeMgmtTotalPages = Math.max(1, Math.ceil(sortedMergeRuleRows.length / tokenMgmtPerPage));
  const safeMergeMgmtPage = Math.min(tokenMgmtPage, mergeMgmtTotalPages);
  const paginatedMergeRuleRows = useMemo(
    () =>
      sortedMergeRuleRows.slice((safeMergeMgmtPage - 1) * tokenMgmtPerPage, safeMergeMgmtPage * tokenMgmtPerPage),
    [sortedMergeRuleRows, safeMergeMgmtPage]
  );

  const autoMergeRows = useMemo(() => {
    if (tokenMgmtSubTab !== 'auto-merge') return [];
    const statusRank = (status: AutoMergeRecommendation['status']) =>
      status === 'pending' ? 0 : status === 'approved' ? 1 : 2;
    const dir = autoMergeSortConfig.direction === 'asc' ? 1 : -1;
    return (autoMergeRecommendations || [])
      .filter(r => r.status !== 'declined')
      .sort((a, b) => {
        let base: number;
        if (autoMergeSortConfig.key === 'canonical') {
          base = a.canonicalToken.localeCompare(b.canonicalToken);
        } else if (autoMergeSortConfig.key === 'mergeTokens') {
          if (a.mergeTokens.length !== b.mergeTokens.length) base = a.mergeTokens.length - b.mergeTokens.length;
          else base = a.mergeTokens.join(',').localeCompare(b.mergeTokens.join(','));
        } else if (autoMergeSortConfig.key === 'impact') {
          if (a.affectedKeywordCount !== b.affectedKeywordCount) base = a.affectedKeywordCount - b.affectedKeywordCount;
          else base = a.affectedPageCount - b.affectedPageCount;
        } else if (autoMergeSortConfig.key === 'status') {
          base = statusRank(a.status) - statusRank(b.status);
        } else {
          base = a.confidence - b.confidence;
        }
        if (base !== 0) return base * dir;
        // Stable fallback keeps highest confidence near top unless explicitly inverted by chosen sort.
        if (a.confidence !== b.confidence) return b.confidence - a.confidence;
        if (a.affectedKeywordCount !== b.affectedKeywordCount) return b.affectedKeywordCount - a.affectedKeywordCount;
        return a.canonicalToken.localeCompare(b.canonicalToken);
      });
  }, [tokenMgmtSubTab, autoMergeRecommendations, autoMergeSortConfig]);
  const autoMergeTotalPages = Math.max(1, Math.ceil(autoMergeRows.length / tokenMgmtPerPage));
  const safeAutoMergePage = Math.min(tokenMgmtPage, autoMergeTotalPages);
  const paginatedAutoMergeRows = useMemo(
    () => autoMergeRows.slice((safeAutoMergePage - 1) * tokenMgmtPerPage, safeAutoMergePage * tokenMgmtPerPage),
    [autoMergeRows, safeAutoMergePage],
  );
  const autoMergeSortIcon = (key: 'canonical' | 'mergeTokens' | 'impact' | 'confidence' | 'status') => {
    if (autoMergeSortConfig.key !== key) return <ArrowUpDown className="w-3 h-3" />;
    return autoMergeSortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // Token Management panel: filtered, sorted, paginated with subtab support
  const filteredMgmtTokens = useMemo(() => {
    if (tokenMgmtSubTab === 'merge' || tokenMgmtSubTab === 'auto-merge') return [];
    if (!tokenSummary) return [];
    let base: TokenSummary[];
    if (tokenMgmtSubTab === 'blocked') {
      base = tokenSummary.filter(t => blockedTokens.has(t.token) || universalBlockedTokens.has(t.token));
    } else if (tokenMgmtSubTab === 'current') {
      // Compute token stats FROM SCRATCH using only currently visible clusters (not global tokenSummary)
      // This ensures "current" shows different data than "all" when filters are active
      const tokenStatsMap = new Map<string, { token: string; totalVolume: number; frequency: number; kdSum: number; kdCount: number }>();

      // Collect clusters based on active keyword management tab
      const clusters: { tokenArr: string[]; keywords: { keyword: string; volume: number; kd: number | null }[] }[] = [];
      if (activeTab === 'pages') {
        clusters.push(...filteredClusters);
      } else if (activeTab === 'grouped') {
        for (const g of filteredSortedGrouped) clusters.push(...g.clusters);
      } else if (activeTab === 'approved') {
        for (const g of filteredApprovedGroups) clusters.push(...g.clusters);
      }

      // Build stats from clusters (for pages/grouped/approved tabs)
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

      // Convert to TokenSummary format â€" pull extra fields from global tokenSummary if available
      const globalMap = new Map<string, TokenSummary>((tokenSummary || []).map(t => [t.token, t]));
      base = Array.from(tokenStatsMap.values()).map(s => {
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
    } else {
      // 'all' â€" show all non-blocked tokens
      base = tokenSummary.filter(t => !blockedTokens.has(t.token) && !universalBlockedTokens.has(t.token));
    }
    const terms = parseTokenMgmtSearchTerms(tokenMgmtSearch);
    let tokens = terms.length ? base.filter(t => tokenIncludesAnyTerm(t.token, terms)) : [...base];
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
  }, [tokenSummary, tokenMgmtSearch, tokenMgmtSort, tokenMgmtSubTab, blockedTokens, universalBlockedTokens, activeTab, filteredClusters, filteredSortedGrouped, filteredApprovedGroups, filteredResults]);

  const tokenMgmtTotalPages = Math.max(1, Math.ceil(filteredMgmtTokens.length / tokenMgmtPerPage));
  const safeMgmtPage = Math.min(tokenMgmtPage, tokenMgmtTotalPages);
  const paginatedMgmtTokens = useMemo(() => filteredMgmtTokens.slice((safeMgmtPage - 1) * tokenMgmtPerPage, safeMgmtPage * tokenMgmtPerPage), [filteredMgmtTokens, safeMgmtPage]);

  // Activity log + toast — persists via addActivityEntry (IDB + Firestore for active project)
  const logAndToast = useCallback((action: ActivityAction, details: string, count: number, toastMsg: string, toastType: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    const entry: ActivityLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      details,
      count,
    };
    addActivityEntry(entry);
    addToast(toastMsg, toastType);
  }, [addActivityEntry, addToast]);

  const {
    isMergeModalOpen, setIsMergeModalOpen,
    mergeModalTokens, setMergeModalTokens,
    handleOpenMergeModal,
    handleMergeTokens,
    handleUndoMergeChild,
    handleUndoMergeParent,
  } = useTokenMerge({
    results, clusterSummary, groupedClusters, approvedGroups,
    tokenMergeRules, selectedMgmtTokens, selectedTokens,
    resultsRef, groupedClustersRef, approvedGroupsRef, clusterSummaryRef, tokenSummaryRef,
    logAndToast,
    applyMergeCascade: persistence.applyMergeCascade,
    undoMerge: persistence.undoMerge,
    setSelectedTokens, setSelectedMgmtTokens,
  });

  const {
    autoMergeJob, setAutoMergeJob, handleCancelAutoMerge,
    runAutoMergeRecommendations, buildAutoMergeRecommendations,
    applyAutoMergeRecommendation,
    declineAutoMergeRecommendation,
    applyAllAutoMergeRecommendations,
    undoAutoMergeRecommendation,
    tokenTopPagesMap, tokenPagesTooltip,
  } = useAutoMerge({
    results, tokenMergeRules,
    resultsRef, tokenSummaryRef, groupedClustersRef, approvedGroupsRef, clusterSummaryRef,
    autoMergeRecommendationsRef, blockedTokensRef, universalBlockedTokens,
    groupReviewSettingsRef, groupReviewSettingsSnapshot,
    addToast, logAndToast,
    updateAutoMergeRecommendations: persistence.updateAutoMergeRecommendations,
    applyMergeCascade: persistence.applyMergeCascade,
    activeProjectId, flushNow,
    setTokenMgmtSubTab, setTokenMgmtPage,
    handleUndoMergeParent,
  });

  const {
    job: groupAutoMergeJob,
    recommendationsAreStale: groupAutoMergeRecommendationsAreStale,
    runRecommendations: runGroupAutoMergeRecommendations,
    cancelRun: cancelGroupAutoMerge,
    dismissRecommendations: dismissGroupAutoMergeRecommendations,
    applyRecommendations: applyGroupAutoMergeRecommendations,
  } = useGroupAutoMerge({
    groupedClusters,
    groupedClustersRef,
    groupMergeRecommendations,
    groupMergeRecommendationsRef,
    groupReviewSettingsRef,
    groupReviewSettingsSnapshot,
    updateGroupMergeRecommendations,
    bulkSet,
    addToast,
    logAndToast: (action, details, count, toastMsg, toastType) => {
      logAndToast(action, details, count, toastMsg, toastType);
    },
    flushNow,
  });

  const exportTokensCSV = useCallback(() => {
    if (!tokenSummary || tokenSummary.length === 0) return;

    const csv = Papa.unparse({
      fields: ['Token', 'Vol.', 'Frequency', 'Avg KD', 'Length', 'Label', 'Labels', 'City', 'State', 'Blocked', 'Universal Blocked'],
      data: tokenSummary.map(token => [
        token.token,
        token.totalVolume,
        token.frequency,
        token.avgKd !== null ? token.avgKd : '',
        token.length,
        token.label || '',
        token.labelArr.join(', '),
        token.locationCity || '',
        token.locationState || '',
        blockedTokens.has(token.token) ? 'Yes' : 'No',
        universalBlockedTokens.has(token.token) ? 'Yes' : 'No',
      ]),
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `token-management_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    logAndToast('export', `Exported ${tokenSummary.length} tokens from token management`, tokenSummary.length, `Exported ${tokenSummary.length} tokens`, 'success');
  }, [tokenSummary, blockedTokens, universalBlockedTokens, logAndToast]);

  // Debounced QA re-review â€" when pages are removed from groups, wait 5s then re-trigger QA
  const scheduleReReview = useCallback((groupIds: string[]) => {
    groupIds.forEach(id => reReviewGroupIds.current.add(id));
    if (reReviewTimerRef.current) clearTimeout(reReviewTimerRef.current);
    reReviewTimerRef.current = setTimeout(() => {
      reReviewTimerRef.current = null;
      const ids = new Set(reReviewGroupIds.current);
      reReviewGroupIds.current.clear();
      if (ids.size === 0) return;
      const hasReviewApi = groupReviewSettingsRef.current?.hasApiKey() ?? false;
      if (!hasReviewApi) return;
      persistence.updateGroups(groups =>
        groups.map(g =>
          ids.has(g.id) && g.clusters.length > 0
            ? { ...g, reviewStatus: 'pending' as const, reviewMismatchedPages: undefined, reviewReason: undefined }
            : g
        )
      );
      logAndToast('qa-review', `Re-reviewing ${ids.size} group${ids.size > 1 ? 's' : ''} after page removal`, ids.size, `QA re-review queued for ${ids.size} group${ids.size > 1 ? 's' : ''}`, 'info');
    }, 5000);
  }, [logAndToast, persistence.updateGroups]);

  const {
    handleBlockSingleToken,
    handleBlockTokens,
    handleUnblockTokens,
  } = useTokenActions({
    logAndToast,
    setSelectedMgmtTokens,
    setTokenMgmtSubTab,
    setTokenMgmtPage,
    switchTab,
    blockTokens: persistence.blockTokens,
    unblockTokens: persistence.unblockTokens,
  });


  // AI Group Review â€" process pending groups automatically
  useEffect(() => {
    if (reviewProcessingRef.current) return;
    const groupsToReview = groupedClusters.filter(g =>
      g.reviewStatus === 'pending' || (!!g.mergeAffected && g.clusters.length > 0)
    );
    if (groupsToReview.length === 0) return;
    const settingsData = groupReviewSettingsRef.current?.getSettings();
    const modelObj = groupReviewSettingsRef.current?.getSelectedModelObj();
    if (!settingsData || !settingsData.apiKey.trim() || !settingsData.selectedModel) return;

    reviewProcessingRef.current = true;

    // Mark as reviewing — use functional update so we merge against latest persisted state,
    // not groupedClustersRef (ref can lag one frame behind rapid addGroupsAndRemovePages).
    persistence.updateGroups(groups =>
      groups.map(g =>
        g.reviewStatus === 'pending' ? { ...g, reviewStatus: 'reviewing' as const } : g
      )
    );

    // Build queue
    const queue: ReviewRequest[] = groupsToReview.map(g => ({
      groupId: g.id,
      groupName: g.groupName,
      pages: g.clusters.map(c => ({ pageName: c.pageName, tokens: c.tokenArr || c.tokens.split(' ') })),
    }));

    const runReviewBatch = (batchQueue: ReviewRequest[], batchGroups: GroupedCluster[]) => {
      const controller = new AbortController();
      reviewAbortRef.current = controller;

      processReviewQueue(
        batchQueue,
        {
          apiKey: settingsData.apiKey,
          model: settingsData.selectedModel,
          temperature: settingsData.temperature,
          maxTokens: settingsData.maxTokens,
          systemPrompt: settingsData.systemPrompt,
          concurrency: settingsData.concurrency,
          modelPricing: modelObj?.pricing,
          reasoningEffort: settingsData.reasoningEffort,
        },
        {
          onReviewing: () => {},
          onResult: (result: ReviewResult) => {
            persistence.updateGroups(groups =>
              groups.map(g =>
                g.id === result.groupId ? {
                  ...g,
                  reviewStatus: result.status,
                  reviewMismatchedPages: result.mismatchedPages,
                  reviewReason: result.reason,
                  reviewCost: result.cost,
                  reviewedAt: result.reviewedAt,
                  mergeAffected: false,
                } : g
              )
            );
            const groupName = batchGroups.find(g => g.id === result.groupId)?.groupName || result.groupId;
            if (result.status === 'approve') {
              logAndToast('qa-review', `QA: '${groupName}' \u2014 Approved`, 1, `QA: '${groupName}' \u2014 Approved \u2713`, 'success');
            } else {
              logAndToast('qa-review', `QA: '${groupName}' \u2014 Mismatch (${(result.mismatchedPages || []).join(', ')})`, result.mismatchedPages?.length || 1, `QA: '${groupName}' \u2014 Mismatch \u2717`, 'error');
            }
          },
          onError: (error: ReviewError) => {
            persistence.updateGroups(groups =>
              groups.map(g =>
                g.id === error.groupId ? {
                  ...g,
                  // For merge-driven re-reviews, keep the last known approve/mismatch
                  // so the badge does not flicker down on transient failures.
                  ...(g.mergeAffected
                    ? { mergeAffected: false }
                    : {
                      reviewStatus: 'error' as const,
                      reviewReason: error.error,
                      reviewedAt: new Date().toISOString(),
                      mergeAffected: false,
                    }),
                } : g
              )
            );
            const groupName = batchGroups.find(g => g.id === error.groupId)?.groupName || error.groupId;
            logAndToast('qa-review', `QA error: '${groupName}' \u2014 ${error.error}`, 1, `QA error: '${groupName}'`, 'error');
          },
        },
        controller.signal
      ).finally(() => {
        reviewAbortRef.current = null;
        // Workers are done — any row still 'reviewing' is orphaned (stale ref / lost callback).
        // Snap those back to 'pending', then pick up all pending (including new groups from fast grouping).
        let remaining: GroupedCluster[] = [];
        persistence.updateGroups(groups => {
          const healed = groups.map(g =>
            g.reviewStatus === 'reviewing'
              ? { ...g, reviewStatus: 'pending' as const }
              : g
          );
          remaining = healed.filter(g => g.reviewStatus === 'pending');
          if (remaining.length > 0) {
            return healed.map(g =>
              g.reviewStatus === 'pending' ? { ...g, reviewStatus: 'reviewing' as const } : g
            );
          }
          return healed;
        });
        if (remaining.length > 0) {
          const nextQueue: ReviewRequest[] = remaining.map(g => ({
            groupId: g.id,
            groupName: g.groupName,
            pages: g.clusters.map(c => ({ pageName: c.pageName, tokens: c.tokenArr || c.tokens.split(' ') })),
          }));
          runReviewBatch(nextQueue, remaining);
        } else {
          reviewProcessingRef.current = false;
        }
      });
    };

    runReviewBatch(queue, groupsToReview);
  }, [groupedClusters, logAndToast, persistence.updateGroups]);

  // One-time heal after load: reset stuck 'reviewing' to 'pending' (uses latest state in updater)
  useEffect(() => {
    persistence.updateGroups(groups => {
      if (!groups.some(g => g.reviewStatus === 'reviewing')) return groups;
      return groups.map(g =>
        g.reviewStatus === 'reviewing' ? { ...g, reviewStatus: 'pending' as const } : g
      );
    });
  }, []);

  // Grouping rate tracker â€" estimates remaining time to group all ungrouped pages
  const groupingTimestamps = useRef<{ time: number; pagesGrouped: number }[]>([]);
  const [groupingEta, setGroupingEta] = useState<string | null>(null);

  // Record a grouping event and recalculate ETA
  const recordGroupingEvent = useCallback((pagesInBatch: number) => {
    const now = Date.now();
    groupingTimestamps.current.push({ time: now, pagesGrouped: pagesInBatch });
    // Keep only last 15 seconds of data
    const cutoff = now - 15000;
    groupingTimestamps.current = groupingTimestamps.current.filter(t => t.time >= cutoff);
  }, []);

  const {
    handleApproveGroup,
    handleUnapproveGroup,
    handleRemoveFromApproved,
    handleGroupClusters,
    handleAutoGroupApprove,
    handleUngroupClusters,
    approveSelectedGrouped,
  } = useGroupingActions({
    selectedClusters,
    setSelectedClusters,
    groupNameInput,
    setGroupNameInput,
    clusterSummary,
    selectedGroups,
    setSelectedGroups,
    selectedSubClusters,
    setSelectedSubClusters,
    groupedClusters,
    setCurrentPage,
    logAndToast,
    recordGroupingEvent,
    scheduleReReview,
    hasReviewApi: () => groupReviewSettingsRef.current?.hasApiKey() ?? false,
    addGroupsAndRemovePages: persistence.addGroupsAndRemovePages,
    approveGroup: persistence.approveGroup,
    unapproveGroup: persistence.unapproveGroup,
    removeFromApproved,
    ungroupPages,
  });

  // Update ETA every 10 seconds based on rolling average
  useEffect(() => {
    const interval = setInterval(() => {
      const timestamps = groupingTimestamps.current;
      if (timestamps.length < 2) { setGroupingEta(null); return; }
      const now = Date.now();
      const cutoff = now - 15000;
      const recent = timestamps.filter(t => t.time >= cutoff);
      if (recent.length < 2) { setGroupingEta(null); return; }
      const totalPagesGrouped = recent.reduce((sum, t) => sum + t.pagesGrouped, 0);
      const timeSpan = (recent[recent.length - 1].time - recent[0].time) / 1000; // seconds
      if (timeSpan <= 0) { setGroupingEta(null); return; }
      const pagesPerSec = totalPagesGrouped / timeSpan;
      const remainingPages = effectiveClusters?.length || 0;
      if (remainingPages === 0 || pagesPerSec <= 0) { setGroupingEta(null); return; }
      const etaSec = Math.round(remainingPages / pagesPerSec);
      const rateStr = `${pagesPerSec.toFixed(pagesPerSec >= 10 ? 0 : 1)}/s`;
      if (etaSec < 60) setGroupingEta(`~${etaSec}s left (${rateStr})`);
      else if (etaSec < 3600) setGroupingEta(`~${Math.round(etaSec / 60)}m left (${rateStr})`);
      else setGroupingEta(`~${(etaSec / 3600).toFixed(1)}h left (${rateStr})`);
    }, 10000);
    return () => clearInterval(interval);
  }, [effectiveClusters?.length]);

  const filteredAutoGroupFilterSummary = useMemo(() => {
    const active: string[] = [];
    if (debouncedSearchQuery.trim()) active.push(`search="${debouncedSearchQuery.trim()}"`);
    if (selectedTokens.size > 0) active.push(`tokens=${Array.from(selectedTokens).join(', ')}`);
    if (excludedLabels.size > 0) active.push(`excluded_labels=${Array.from(excludedLabels).join(', ')}`);
    if (filterCity.trim()) active.push(`city=${filterCity.trim()}`);
    if (filterState.trim()) active.push(`state=${filterState.trim()}`);
    if (minKwInCluster.trim()) active.push(`min_kws=${minKwInCluster.trim()}`);
    if (maxKwInCluster.trim()) active.push(`max_kws=${maxKwInCluster.trim()}`);
    if (minVolume.trim()) active.push(`min_volume=${minVolume.trim()}`);
    if (maxVolume.trim()) active.push(`max_volume=${maxVolume.trim()}`);
    if (minKd.trim()) active.push(`min_kd=${minKd.trim()}`);
    if (maxKd.trim()) active.push(`max_kd=${maxKd.trim()}`);
    if (minKwRating.trim()) active.push(`min_kw_rating=${minKwRating.trim()}`);
    if (maxKwRating.trim()) active.push(`max_kw_rating=${maxKwRating.trim()}`);
    if (minLen.trim()) active.push(`min_len=${minLen.trim()}`);
    if (maxLen.trim()) active.push(`max_len=${maxLen.trim()}`);
    return active.length > 0 ? active.join(' | ') : 'No additional filters active';
  }, [
    debouncedSearchQuery,
    selectedTokens,
    excludedLabels,
    filterCity,
    filterState,
    minKwInCluster,
    maxKwInCluster,
    minVolume,
    maxVolume,
    minKd,
    maxKd,
    minKwRating,
    maxKwRating,
    minLen,
    maxLen,
  ]);

  const isFilteredAutoGroupFilterActive =
    filteredAutoGroupFilterSummary !== 'No additional filters active';

  const filteredAutoGroupSettingsStatus = useMemo(
    () =>
      getFilteredAutoGroupSettingsStatus(groupReviewSettingsHydrated, groupReviewSettingsSnapshot),
    [groupReviewSettingsHydrated, groupReviewSettingsSnapshot]
  );

  const buildFilteredAutoGroupPrompt = useCallback((
    pages: ClusterSummary[],
    filterSummary: string,
    basePrompt: string
  ) => {
    const pageLines = pages.map((page, idx) => (
      `P${idx + 1} | ${page.pageName} | volume=${page.totalVolume} | kd=${page.avgKd ?? 'n/a'} | kws=${page.keywordCount}`
    )).join('\n');

    const system = `${basePrompt}

You are reviewing the currently filtered ungrouped pages from the keyword management tab.

STRICT REQUIREMENTS:
1. Review all provided pages together and group them by COMPLETE core semantic intent only.
2. Use strict matching. Do not merge pages unless their underlying search intent is effectively identical.
3. Minor lexical variation is fine only if it does not change meaning at all.
4. Volume and KD are context signals. They can help determine the strongest representative page, but semantic intent is the deciding factor.
5. You must partition the full filtered page set into as MANY distinct semantic groups as needed. There is no group limit.
6. Never force unrelated pages into one catch-all group. Returning one massive group is WRONG unless every single page has the exact same intent.
7. For each distinct semantic intent, create a separate group. Distinct intents must become separate groups.
8. Single-page groups are allowed and must still be returned as valid groups when no exact semantic match exists.
9. The highest-volume page inside each group will become the final group name in the app, so group pages strictly and intelligently.
10. Every page must appear exactly once in exactly one group.
11. Return valid JSON only.

JSON SCHEMA:
{
  "groups": [
    { "pageIds": ["P1", "P4"] },
    { "pageIds": ["P2", "P3", "P8"] },
    { "pageIds": ["P5"] }
  ]
}

LEGACY-COMPATIBLE SCHEMA ALSO ACCEPTED:
{
  "groups": [
    { "pages": ["exact page name 1", "exact page name 2"] },
    { "pages": ["exact page name 3", "exact page name 4", "exact page name 5"] },
    { "pages": ["exact page name 6"] }
  ]
}

FAILURE CONDITIONS TO AVOID:
- Do not return one giant group just because the pages share a broad topic.
- Do not merge informational, comparison, review, pricing, legal, tool, local, and transactional intents together.
- Do not merge broad head terms with narrower sub-intents unless they are truly the exact same search intent.
- If two pages would deserve different landing pages, they must be different groups.`;

    const user = `Current filters:\n${filterSummary}\n\nFiltered ungrouped pages (${pages.length}):\n${pageLines}\n\nGroup ALL of these pages in one pass. Create multiple groups whenever the semantic intent differs. Prefer pageIds. If you do not use pageIds, use exact page names. Return every page exactly once inside groups[].`;
    return { system, user };
  }, []);

  const runFilteredAutoGroupJob = useCallback(async (job: FilteredAutoGroupJob) => {
    const pagesToReview = job.pages;
    const controller = new AbortController();
    activeFilteredAutoGroupJobRef.current = job;
    filteredAutoGroupAbortRef.current = controller;
    setIsRunningFilteredAutoGroup(true);
    setFilteredAutoGroupStats({
      status: 'running',
      totalPages: pagesToReview.length,
      groupsCreated: 0,
      pagesGrouped: 0,
      pagesRemaining: 0,
      totalVolumeGrouped: 0,
      cost: 0,
      promptTokens: 0,
      completionTokens: 0,
      elapsedMs: 0,
    });
    logAndToast('auto-group', `Filtered Auto Group started on ${pagesToReview.length} pages`, pagesToReview.length, `Auto Group started for ${pagesToReview.length} filtered pages`, 'info');

    const startedAt = performance.now();

    try {
      const { system, user } = buildFilteredAutoGroupPrompt(
        pagesToReview,
        job.filterSummary,
        job.settings.autoGroupPrompt
      );

      const timedResponse = await runWithOpenRouterTimeout({
        signal: controller.signal,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
        run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${job.settings.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': window.location.origin,
          },
          body: JSON.stringify({
            model: job.settings.selectedModel,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: job.settings.temperature,
            ...(job.settings.maxTokens > 0 ? { max_tokens: job.settings.maxTokens } : {}),
            ...(job.settings.reasoningEffort && job.settings.reasoningEffort !== 'none'
              ? { reasoning: { effort: job.settings.reasoningEffort } }
              : {}),
            response_format: { type: 'json_object' },
          }),
          signal: requestSignal,
        }),
      });
      const res = timedResponse.result;

      if (!res.ok) {
        const errText = (await runWithOpenRouterTimeout({
          signal: controller.signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async () => res.text().catch(() => ''),
        }).catch(() => ({ result: '' }))).result;
        throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = (await runWithOpenRouterTimeout({
        signal: controller.signal,
        timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
        run: async () => res.json(),
      })).result;
      const content = data.choices?.[0]?.message?.content || '';
      const parsedGroups = parseFilteredAutoGroupResponse(content, pagesToReview);
      if (parsedGroups.length === 0) throw new Error('Model returned no usable groups');

      const hasReviewApi = groupReviewSettingsRef.current?.hasApiKey() ?? false;
      const generatedGroups: GroupedCluster[] = parsedGroups
        .filter(groupPages => groupPages.length >= 1)
        .map(groupPages => buildGroupedClusterFromPages(
          groupPages,
          hasReviewApi,
          { id: `filtered_auto_group_${Date.now()}_${groupPages[0].tokens}` }
        ));

      const groupedTokens = new Set(generatedGroups.flatMap(group => group.clusters.map(page => page.tokens)));
      const groupedVolume = generatedGroups.reduce((sum, group) => sum + group.totalVolume, 0);
      const promptTokens = data.usage?.prompt_tokens || 0;
      const completionTokens = data.usage?.completion_tokens || 0;
      const cost = job.modelPricing
        ? (promptTokens * parseFloat(job.modelPricing.prompt || '0')) + (completionTokens * parseFloat(job.modelPricing.completion || '0'))
        : 0;

      if (generatedGroups.length > 0) {
        persistence.mergeGroupsByName({ incoming: generatedGroups, removedTokens: groupedTokens, hasReviewApi, mergeFn: mergeGroupedClustersByName });
        startTransition(() => {
          setSelectedClusters(new Set());
          setCurrentPage(1);
        });
      }

      setPendingFilteredAutoGroupTokens(prev => {
        const next = new Set(prev);
        for (const page of pagesToReview) next.delete(page.tokens);
        return next;
      });

      const elapsedMs = Math.round(performance.now() - startedAt);
      setFilteredAutoGroupStats({
        status: 'complete',
        totalPages: pagesToReview.length,
        groupsCreated: generatedGroups.length,
        pagesGrouped: groupedTokens.size,
        pagesRemaining: pagesToReview.length - groupedTokens.size,
        totalVolumeGrouped: groupedVolume,
        cost,
        promptTokens,
        completionTokens,
        elapsedMs,
      });

      if (groupedTokens.size > 0) recordGroupingEvent(groupedTokens.size);
      if (groupedTokens.size > 0) {
        logAndToast(
          'auto-group',
          `Filtered Auto Group created ${generatedGroups.length} groups from ${pagesToReview.length} filtered pages`,
          groupedTokens.size,
          `Auto Group grouped ${groupedTokens.size}/${pagesToReview.length} filtered pages into ${generatedGroups.length} groups`,
          'success'
        );
      } else {
        logAndToast(
          'auto-group',
          'Filtered Auto Group returned only singleton/no-op results',
          0,
          `Auto Group reviewed ${pagesToReview.length} pages but did not return any usable groups. Adjust the Auto-Group Prompt or filters.`,
          'info'
        );
      }
    } catch (e: any) {
      setPendingFilteredAutoGroupTokens(prev => {
        const next = new Set(prev);
        for (const page of pagesToReview) next.delete(page.tokens);
        return next;
      });
      if (e.name === 'AbortError') {
        setFilteredAutoGroupStats(prev => ({
          ...prev,
          status: 'idle',
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
      } else {
        setFilteredAutoGroupStats(prev => ({
          ...prev,
          status: 'error',
          error: e.message || 'Unknown error',
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
        logAndToast('auto-group', `Filtered Auto Group error: ${e.message}`, 0, `Auto Group error: ${e.message}`, 'error');
      }
    } finally {
      setIsRunningFilteredAutoGroup(false);
      filteredAutoGroupAbortRef.current = null;
      activeFilteredAutoGroupJobRef.current = null;
    }
  }, [
    groupedClusters,
    clusterSummary,
    results,
    tokenSummary,
    stats,
    datasetStats,
    fileName,
    activeProjectId,
    buildFilteredAutoGroupPrompt,
    logAndToast,
    recordGroupingEvent,
    startTransition,
  ]);

  const handleRunFilteredAutoGroup = useCallback(() => {
    if (!isFilteredAutoGroupFilterActive) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group blocked: activate filters first',
        0,
        'Activate at least one filter (search/tokens/city/state/keyword/volume/KD/len) before using Auto Group.',
        'info'
      );
      return;
    }

    if (filteredClusters.length < 1) {
      logAndToast(
        'auto-group',
        'Filtered Auto Group blocked: no matching pages',
        0,
        'No ungrouped pages match your current filters. Adjust filters and try again.',
        'info'
      );
      return;
    }
    if (!groupReviewSettingsHydrated) {
      logAndToast('auto-group', 'Filtered Auto Group waiting for shared AI settings', 0, 'Shared Group Review settings are still loading. Try again in a moment.', 'info');
      return;
    }
    const settingsData = groupReviewSettingsRef.current?.getSettings();
    const modelObj = groupReviewSettingsRef.current?.getSelectedModelObj();
    if (!settingsData || !settingsData.apiKey.trim() || !settingsData.selectedModel) {
      logAndToast('auto-group', 'Filtered Auto Group blocked: missing shared AI settings', 0, 'Set an API key and model in Group Review settings before using Auto Group.', 'error');
      return;
    }

    const pagesToReview = [...filteredClusters];
    const job: FilteredAutoGroupJob = {
      id: `filtered-auto-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pages: pagesToReview,
      filterSummary: filteredAutoGroupFilterSummary,
      settings: { ...settingsData },
      modelPricing: modelObj?.pricing,
    };

    setPendingFilteredAutoGroupTokens(prev => {
      const next = new Set(prev);
      for (const page of pagesToReview) next.add(page.tokens);
      return next;
    });

    if (isRunningFilteredAutoGroup || filteredAutoGroupQueue.length > 0) {
      setFilteredAutoGroupQueue(prev => [...prev, job]);
      logAndToast(
        'auto-group',
        `Queued Auto Group job for ${pagesToReview.length} pages`,
        pagesToReview.length,
        `Auto Group queue now has ${filteredAutoGroupQueue.length + 1} waiting job(s)`,
        'info'
      );
      return;
    }

    void runFilteredAutoGroupJob(job);
  }, [
    filteredClusters,
    isFilteredAutoGroupFilterActive,
    filteredAutoGroupFilterSummary,
    filteredAutoGroupQueue.length,
    groupReviewSettingsHydrated,
    isRunningFilteredAutoGroup,
    logAndToast,
    runFilteredAutoGroupJob,
  ]);

  const handleStopFilteredAutoGroup = useCallback(() => {
    filteredAutoGroupAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (isRunningFilteredAutoGroup) return;
    if (activeFilteredAutoGroupJobRef.current) return;
    if (filteredAutoGroupQueue.length === 0) return;

    const [nextJob, ...rest] = filteredAutoGroupQueue;
    setFilteredAutoGroupQueue(rest);
    void runFilteredAutoGroupJob(nextJob);
  }, [filteredAutoGroupQueue, isRunningFilteredAutoGroup, runFilteredAutoGroupJob]);

  // Global Tab key shortcut: press Tab anywhere to group selected pages
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingTarget = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );

      if (e.shiftKey && e.code === 'Digit1') {
        if (activeTab === 'pages' && !isTypingTarget && isFilteredAutoGroupFilterActive && filteredClusters.length >= 1) {
          e.preventDefault();
          e.stopPropagation();
          handleRunFilteredAutoGroup();
          return;
        }
      }

      if (e.key === 'Tab' || e.key === 'Shift') {
        // Tab or Shift in Pages (Ungrouped) â†' Group selected clusters
        if (activeTab === 'pages' && selectedClusters.size > 0 && groupNameInput.trim()) {
          e.preventDefault();
          e.stopPropagation();
          handleGroupClusters();
          return;
        }
        // Tab in Pages (Grouped) â†' Approve selected groups
        if (activeTab === 'grouped' && selectedGroups.size > 0) {
          e.preventDefault();
          e.stopPropagation();
          approveSelectedGrouped();
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleGroupClusters, selectedClusters.size, groupNameInput, activeTab, selectedGroups, approveSelectedGrouped, handleRunFilteredAutoGroup, filteredClusters.length, isFilteredAutoGroupFilterActive]);

  const pendingGroupMergeRecommendationsCount = groupMergeRecommendations.filter(
    (recommendation) => recommendation.status === 'pending',
  ).length;
  const totalGroupMergeRecommendationsCount = groupMergeRecommendations.length;

  const totalPages = Math.max(1, Math.ceil(
    (activeTab === 'pages' ? sortedClusters.length :
     activeTab === 'keywords' ? sortedKeywordRows.length :
     activeTab === 'grouped' ? filteredSortedGrouped.length :
     activeTab === 'group-auto-merge' ? 1 :
     activeTab === 'approved' ? approvedGroups.length :
     sortedBlocked.length) / itemsPerPage
  ));

  // Auto-correct page if it exceeds total (e.g. after filtering reduces results)
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages]);

  const filteredCount = activeTab === 'pages' ? sortedClusters.length :
                       activeTab === 'keywords' ? sortedKeywordRows.length :
                       activeTab === 'grouped' ? filteredSortedGrouped.length :
                       activeTab === 'group-auto-merge' ? pendingGroupMergeRecommendationsCount :
                       activeTab === 'approved' ? filteredApprovedGroups.length :
                       sortedBlocked.length;

  const totalCount = activeTab === 'pages' ? (effectiveClusters?.length || 0) :
                    activeTab === 'keywords' ? (effectiveResults?.length || 0) :
                    activeTab === 'grouped' ? effectiveGrouped.length :
                    activeTab === 'group-auto-merge' ? totalGroupMergeRecommendationsCount :
                    activeTab === 'approved' ? approvedGroups.length :
                    allBlockedKeywords.length;

  const tabRailClass = 'flex items-center gap-0.5 bg-zinc-100/80 p-0.5 rounded-lg border border-zinc-200/70';
  const mainTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5';
  const mainTabBtnActive = 'bg-white text-zinc-900 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#6366f1]';
  const mainTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/60';
  const subTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all';
  const subTabBtnActive = 'bg-white text-zinc-900 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#6366f1]';
  const subTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100/70';
  const stateTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1';

  // Approved stats
  return (
    <div className="min-h-screen bg-[#f8f9fa] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-[1600px] mx-auto px-3 py-2.5">
        <AppStatusBar activeProjectId={activeProjectId} />

        <header className="mb-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex shrink-0 items-center gap-1.5">
                <h1 className="text-lg font-semibold tracking-tight text-zinc-900 flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden />
                  SEO Magic
                </h1>
              </div>
              <nav
                className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-zinc-400 leading-tight"
                aria-label="Breadcrumb"
              >
                <span className="text-zinc-600 font-medium">
                  {mainTab === 'group'
                    ? 'Group'
                    : mainTab === 'generate'
                      ? 'Generate'
                      : mainTab === 'content'
                        ? 'Content'
                        : mainTab === 'feedback'
                          ? 'Feedback'
                          : mainTab === 'notifications'
                            ? 'Notifications'
                          : mainTab === 'updates'
                            ? 'Updates'
                            : 'Feature ideas'}
                </span>
                {mainTab === 'group' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <span className="text-zinc-600 font-medium capitalize">
                      {groupSubTab === 'data'
                        ? (activeProjectId ? 'Data' : 'Projects')
                        : groupSubTab === 'topics'
                          ? 'Topics'
                          : groupSubTab === 'settings'
                            ? 'Settings'
                            : groupSubTab === 'log'
                              ? 'Log'
                              : groupSubTab}
                    </span>
                    {groupSubTab === 'settings' && (
                      <>
                        <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                        <span className="text-zinc-600 font-medium">
                          {settingsSubTab === 'general'
                            ? 'General'
                            : settingsSubTab === 'how-it-works'
                              ? 'How it works'
                              : settingsSubTab === 'dictionaries'
                                ? 'Dictionaries'
                                : 'Blocked'}
                        </span>
                      </>
                    )}
                    {groupSubTab === 'data' && activeProjectId && (
                      <>
                        <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                        {editingProjectName ? (
                          <input
                            autoFocus
                            type="text"
                            defaultValue={projects.find(p => p.id === activeProjectId)?.name || ''}
                            className="px-1 py-0.5 text-[10px] border border-indigo-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 w-40 max-w-[min(100%,10rem)]"
                            onBlur={(e) => {
                              const newName = e.target.value.trim();
                              if (newName && newName !== projects.find(p => p.id === activeProjectId)?.name) {
                                const updated = projects.map(p => p.id === activeProjectId ? { ...p, name: newName } : p);
                                setProjects(updated);
                                setDoc(doc(db, 'projects', activeProjectId), { name: newName }, { merge: true }).catch((err) =>
                                  reportPersistFailure(addToast, 'rename project', err),
                                );
                              }
                              setEditingProjectName(false);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              if (e.key === 'Escape') setEditingProjectName(false);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingProjectName(true)}
                            className="hover:text-zinc-700 transition-colors text-zinc-600 font-medium hover:underline text-left max-w-[10rem] truncate"
                            title="Click to rename project"
                          >
                            {projects.find(p => p.id === activeProjectId)?.name || '...'}
                          </button>
                        )}
                        <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                        <span className="text-zinc-600 font-medium capitalize">
                          {activeTab === 'pages' ? 'Pages (Ungrouped)' : activeTab === 'keywords' ? 'All Keywords' : activeTab === 'grouped' ? 'Pages (Grouped)' : activeTab === 'approved' ? 'Pages (Approved)' : 'Blocked'}
                        </span>
                      </>
                    )}
                  </>
                )}
                {mainTab === 'generate' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <span className="text-zinc-600 font-medium">Generate 1</span>
                  </>
                )}
                {mainTab === 'feedback' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <span className="text-zinc-600 font-medium">Queue</span>
                  </>
                )}
                {mainTab === 'feature-ideas' && (
                  <>
                    <ChevronRight className="w-2.5 h-2.5 shrink-0 text-zinc-300" aria-hidden />
                    <span className="text-zinc-600 font-medium">Backlog</span>
                  </>
                )}
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <FeedbackModalHost authorEmail={user?.email ?? null} />
              <div className={tabRailClass}>
                <button
                  type="button"
                  onClick={() => navigateMainTab('group')}
                  className={`${mainTabBtnBase} ${mainTab === 'group' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Layers className="w-3 h-3 shrink-0" aria-hidden />
                  Group
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('generate')}
                  className={`${mainTabBtnBase} ${mainTab === 'generate' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Sparkles className="w-3 h-3 shrink-0" aria-hidden />
                  Generate
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('content')}
                  className={`${mainTabBtnBase} ${mainTab === 'content' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <FileText className="w-3 h-3 shrink-0" aria-hidden />
                  Content
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('feedback')}
                  className={`${mainTabBtnBase} ${mainTab === 'feedback' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <ClipboardList className="w-3 h-3 shrink-0" aria-hidden />
                  Feedback
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('feature-ideas')}
                  className={`${mainTabBtnBase} ${mainTab === 'feature-ideas' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Lightbulb className="w-3 h-3 shrink-0" aria-hidden />
                  Feature ideas
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('notifications')}
                  className={`${mainTabBtnBase} ${mainTab === 'notifications' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <Bell className="w-3 h-3 shrink-0" aria-hidden />
                  Notifications
                </button>
                <button
                  type="button"
                  onClick={() => navigateMainTab('updates')}
                  className={`${mainTabBtnBase} ${mainTab === 'updates' ? mainTabBtnActive : mainTabBtnInactive}`}
                >
                  <RefreshCw className="w-3 h-3 shrink-0" aria-hidden />
                  Updates
                </button>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 mt-1 leading-snug max-w-3xl">
            Keyword clustering, page grouping, approval workflows & AI content generation
          </p>
        </header>

        {mainTab === 'group' && (
          <>
            {/* Compact project + import bar + group sub-tabs */}
            <div className="flex flex-wrap items-center justify-between gap-y-1.5 mb-1.5">
              {/* Left: Project badge + Import */}
              <div className="flex items-center gap-1.5">
                {activeProjectId ? (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-zinc-200 rounded-md shadow-sm text-[10px]">
                    <Folder className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="font-semibold text-zinc-800 truncate max-w-[150px]">
                      {projects.find(p => p.id === activeProjectId)?.name || '...'}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                    <button type="button" onClick={() => navigateGroupSub('projects')} className="text-[10px] text-zinc-400 hover:text-zinc-600 ml-1">Switch</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => navigateGroupSub('projects')} className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                    <AlertCircle className="w-3 h-3" /> Select Project
                  </button>
                )}
                {activeProjectId && !results && !isProcessing && !isProjectLoading && (
                  <label className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900 text-white rounded-md text-xs font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                    <UploadCloud className="w-3 h-3" /> Upload CSV
                    <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileInput} disabled={!activeProjectId} />
                  </label>
                )}
                {/* File info + actions — inline when data is loaded */}
                {results && fileName && (
                  <>
                    <span className="text-zinc-300 mx-1">|</span>
                    <FileText className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span className="text-[11px] text-zinc-500 truncate overflow-hidden">{fileName}</span>
                    <button onClick={reset} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 bg-zinc-100 border border-zinc-200 rounded hover:bg-zinc-200 transition-colors">
                      <UploadCloud className="w-2.5 h-2.5" /> New
                    </button>
                    <button onClick={exportCSV} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 transition-colors">
                      <Download className="w-2.5 h-2.5" /> Export
                    </button>
                  </>
                )}
              </div>
              {/* Right: Group sub-tabs */}
              <div className={tabRailClass}>
                <button type="button" onClick={() => navigateGroupSub('data')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'data' ? subTabBtnActive : subTabBtnInactive}`}>
                  <Database className="w-2.5 h-2.5 shrink-0" aria-hidden />Data
                </button>
                <button type="button" onClick={() => navigateGroupSub('projects')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'projects' ? subTabBtnActive : subTabBtnInactive}`}>
                  <Folder className="w-2.5 h-2.5 shrink-0" aria-hidden />Projects
                </button>
                <button type="button" onClick={() => navigateGroupSub('topics')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'topics' ? subTabBtnActive : subTabBtnInactive}`}>
                  <List className="w-2.5 h-2.5 shrink-0" aria-hidden />Topics
                </button>
                <button type="button" onClick={() => navigateGroupSub('settings')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'settings' ? subTabBtnActive : subTabBtnInactive}`}>
                  <Settings className="w-2.5 h-2.5 shrink-0" aria-hidden />Settings
                </button>
                <button type="button" onClick={() => navigateGroupSub('log')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'log' ? subTabBtnActive : subTabBtnInactive}`}>
                  <ClipboardList className="w-2.5 h-2.5 shrink-0" aria-hidden />Log {activityLog.length > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({activityLog.length})</span>}
                </button>
              </div>
            </div>

            {groupSubTab === 'data' && (
            <>
            {!results && !isProcessing && !isProjectLoading && (
          <div
            className={`
              relative border-2 border-dashed rounded-2xl p-12 transition-all duration-200 ease-in-out
              flex flex-col items-center justify-center text-center bg-white
              ${!activeProjectId ? 'opacity-50 cursor-not-allowed grayscale' : isDragging ? 'border-indigo-500 bg-indigo-50/50' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/50'}
            `}
            onDragOver={activeProjectId ? handleDragOver : undefined}
            onDragLeave={activeProjectId ? handleDragLeave : undefined}
            onDrop={activeProjectId ? handleDrop : undefined}
          >
            {!activeProjectId && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[1px] rounded-2xl">
                <div className="bg-white p-4 rounded-xl shadow-xl border border-zinc-200 flex flex-col items-center gap-3 max-w-xs">
                  <Lock className="w-8 h-8 text-amber-500" />
                  <p className="text-sm font-medium text-zinc-900">Create or select a project first</p>
                  <button 
                    onClick={() => navigateGroupSub('projects')}
                    className="w-full px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all"
                  >
                    Go to Projects
                  </button>
                </div>
              </div>
            )}
            <div className={`p-4 rounded-full mb-4 ${isDragging ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-500'}`}>
              <UploadCloud className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-medium text-zinc-900 mb-1">Upload your CSV file</h3>
            <p className="text-sm text-zinc-500 mb-6">Drag and drop your file here, or click to browse</p>
            
            <label className={`relative cursor-pointer bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-colors shadow-sm ${!activeProjectId ? 'pointer-events-none opacity-50' : ''}`}>
              <span>Select File</span>
              <input 
                type="file" 
                className="sr-only" 
                accept=".csv,text/csv" 
                onChange={handleFileInput}
                disabled={!activeProjectId}
              />
            </label>
          </div>
        )}

        {isProjectLoading && groupSubTab === 'data' && !isProcessing && (
          <div className="bg-white border border-zinc-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-sm">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <h3 className="text-lg font-medium text-zinc-900 mb-1">Loading project...</h3>
            <p className="text-sm text-zinc-500 mb-0">Restoring your uploaded CSV and clustering state.</p>
          </div>
        )}

        {isProcessing && (
          <div className="bg-white border border-zinc-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-sm">
            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
            <h3 className="text-lg font-medium text-zinc-900 mb-1">Processing Keywords...</h3>
            <p className="text-sm text-zinc-500 mb-4">Tokenizing, matching, and clustering your data.</p>
            <div className="w-full max-w-md bg-zinc-100 rounded-full h-2.5 overflow-hidden">
              <div 
                className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-xs text-zinc-400 mt-2">{progress}% Complete</p>
          </div>
        )}

        {error && !isProcessing && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-800">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-sm">Processing Error</h4>
              <p className="text-sm mt-1 opacity-90">{error}</p>
            </div>
          </div>
        )}

        {results && stats && clusterSummary && !isProcessing && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Stats Grid â€" collapsible */}
            <div>
              <button
                onClick={() => setStatsExpanded(!statsExpanded)}
                className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition-colors mb-2"
              >
                {statsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Stats
              </button>
              {statsExpanded && (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="text-zinc-400">Original</span>
                    <span className="font-semibold text-zinc-800 tabular-nums">{stats.original.toLocaleString()}</span>
                    <span className="text-zinc-300">|</span>
                    <span className="text-zinc-400">Valid</span>
                    <span className="font-semibold text-zinc-800 tabular-nums">{displayedValid.toLocaleString()}</span>
                    <span className="text-zinc-300">|</span>
                    <span className="text-zinc-400">Pages</span>
                    <span className="font-semibold text-zinc-800 tabular-nums">{displayedClusters.toLocaleString()}</span>
                    <span className="text-zinc-300">|</span>
                    <span className="text-zinc-400">Tokens</span>
                    <span className="font-semibold text-zinc-800 tabular-nums">{displayedTokens.toLocaleString()}</span>
                    <span className="text-zinc-300">|</span>
                    <span className="text-zinc-400">Vol.</span>
                    <span className="font-semibold text-zinc-800 tabular-nums">{displayedVolume.toLocaleString()}</span>
                    {datasetStats && (
                      <>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">Cities</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.cities.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">States</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.states.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">#s</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.numbers.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">FAQ</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.faqs.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">Commercial</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.commercial.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">Local</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.local.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">Year</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.year.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">Info</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.informational.toLocaleString()}</span>
                        <span className="text-zinc-300">|</span>
                        <span className="text-zinc-400">Nav</span>
                        <span className="font-semibold text-zinc-800 tabular-nums">{datasetStats.navigational.toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Labels Sidebar + Keyword Management + Token Management side by side */}
            <div className="flex gap-4 h-[900px] max-h-[98vh]">

              {/* Labels Sidebar */}
              {isLabelSidebarOpen && (
              <div className="bg-white border border-zinc-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col w-[280px] shrink-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between shrink-0">
                  <span className="text-sm font-semibold text-zinc-700 uppercase tracking-wide flex items-center gap-1.5"><Bookmark className="w-3.5 h-3.5" />Labels</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const nextIndex = labelSections.reduce((max, s) => Math.max(max, s.colorIndex), -1) + 1;
                        const newSection: LabelSection = {
                          id: `label_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                          name: '',
                          tokens: [],
                          colorIndex: nextIndex % 100,
                        };
                        persistence.updateLabelSections([...labelSections, newSection]);
                      }}
                      className="p-1 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                      title="Add label section"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setIsLabelSidebarOpen(false)}
                      className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors"
                      title="Hide labels"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {labelSections.length === 0 && (
                    <p className="text-xs text-zinc-400 text-center py-4">Click + to create a label section</p>
                  )}
                  {labelSections.map((section, sIdx) => {
                    const colors = getLabelColor(section.colorIndex);
                    const sectionStats = labelSectionStats.get(section.id);
                    return (
                      <div key={section.id} className="border rounded-xl overflow-hidden" style={{ borderColor: colors.border }}>
                        {/* Section header */}
                        <div className="px-3 py-2 flex items-center gap-2" style={{ backgroundColor: colors.bg }}>
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colors.border }} />
                          <input
                            type="text"
                            value={section.name}
                            onChange={(e) => {
                              const updated = [...labelSections];
                              updated[sIdx] = { ...section, name: e.target.value };
                              persistence.updateLabelSections(updated);
                            }}
                            onBlur={() => {}}
                            placeholder="Section name..."
                            className="flex-1 text-xs font-semibold bg-transparent border-none outline-none text-zinc-700 placeholder-zinc-400"
                          />
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete label section "${section.name || 'Untitled'}" and all its tokens?`)) {
                                persistence.updateLabelSections(labelSections.filter(s => s.id !== section.id));
                              }
                            }}
                            className="p-0.5 text-zinc-400 hover:text-red-500 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        {/* Token table */}
                        <div className="px-2 py-1.5">
                          {section.tokens.length > 0 && (() => {
                            const sortCfg = labelSortConfigs[section.id] || { key: 'vol', direction: 'desc' };
                            const tokenLookup = new Map<string, TokenSummary>(tokenSummary?.map(t => [t.token, t]) || []);
                            const toggleSort = (key: 'token' | 'kws' | 'vol' | 'kd') => {
                              setLabelSortConfigs(prev => ({
                                ...prev,
                                [section.id]: {
                                  key,
                                  direction: prev[section.id]?.key === key && prev[section.id]?.direction === 'desc' ? 'asc' : 'desc',
                                },
                              }));
                            };
                            const sortedTokens = [...section.tokens].sort((a, b) => {
                              const aData = tokenLookup.get(a);
                              const bData = tokenLookup.get(b);
                              let cmp = 0;
                              if (sortCfg.key === 'token') {
                                cmp = a.localeCompare(b);
                              } else if (sortCfg.key === 'kws') {
                                cmp = (aData?.frequency || 0) - (bData?.frequency || 0);
                              } else if (sortCfg.key === 'vol') {
                                cmp = (aData?.totalVolume || 0) - (bData?.totalVolume || 0);
                              } else if (sortCfg.key === 'kd') {
                                cmp = (aData?.avgKd ?? -1) - (bData?.avgKd ?? -1);
                              }
                              return sortCfg.direction === 'asc' ? cmp : -cmp;
                            });
                            const thClass = "py-0.5 font-medium cursor-pointer hover:text-zinc-600 select-none transition-colors";
                            const indicator = (key: string) => sortCfg.key === key ? (sortCfg.direction === 'asc' ? ' \u2191' : ' \u2193') : '';
                            return (
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-zinc-400 border-b border-zinc-100">
                                  <th className={`text-left ${thClass}`} onClick={() => toggleSort('token')}>Token{indicator('token')}</th>
                                  <th className={`text-right ${thClass} w-[50px]`} onClick={() => toggleSort('kws')}>KWs{indicator('kws')}</th>
                                  <th className={`text-right ${thClass} w-[55px]`} onClick={() => toggleSort('vol')}>Vol.{indicator('vol')}</th>
                                  <th className={`text-right ${thClass} w-[30px]`} onClick={() => toggleSort('kd')}>KD{indicator('kd')}</th>
                                  <th className="w-[16px]"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedTokens.map((token) => {
                                  const tokenData = tokenLookup.get(token);
                                  return (
                                    <tr key={token} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                                      <td className="py-0.5">
                                        <span className="inline-flex items-center gap-1">
                                          <span
                                            className="inline-block px-1 py-0 rounded text-[10px] font-medium border"
                                            style={{ borderColor: colors.border, backgroundColor: colors.bg, color: colors.text }}
                                          >
                                            {token}
                                          </span>
                                          <span className="text-[9px] text-zinc-400 tabular-nums">({filteredTokenCounts.get(token) || 0})</span>
                                        </span>
                                      </td>
                                      <td className="text-right py-0.5 text-zinc-600 tabular-nums">{tokenData?.frequency?.toLocaleString() || '-'}</td>
                                      <td className="text-right py-0.5 text-zinc-600 tabular-nums">{tokenData?.totalVolume?.toLocaleString() || '-'}</td>
                                      <td className="text-right py-0.5 text-zinc-600 tabular-nums">{tokenData?.avgKd !== null && tokenData?.avgKd !== undefined ? tokenData.avgKd : '-'}</td>
                                      <td className="text-right py-0.5">
                                        <button
                                          onClick={() => {
                                            const updated = [...labelSections];
                                            const sectionIdx = updated.findIndex(s => s.id === section.id);
                                            if (sectionIdx >= 0) {
                                              updated[sectionIdx] = { ...section, tokens: section.tokens.filter(t => t !== token) };
                                              persistence.updateLabelSections(updated);
                                            }
                                          }}
                                          className="text-zinc-300 hover:text-red-500 transition-colors"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              {sectionStats && (
                                <tfoot>
                                  <tr className="border-t border-zinc-200 font-semibold text-zinc-700">
                                    <td className="py-0.5">Total</td>
                                    <td className="text-right py-0.5 tabular-nums">{section.tokens.length}</td>
                                    <td className="text-right py-0.5 tabular-nums">{sectionStats.totalVol.toLocaleString()}</td>
                                    <td className="text-right py-0.5 tabular-nums">{sectionStats.avgKd !== null ? sectionStats.avgKd : '-'}</td>
                                    <td></td>
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                            );
                          })()}
                          {/* Add token input */}
                          <input
                            type="text"
                            placeholder="Type token + Enter"
                            className="w-full text-[11px] px-2 py-1 mt-1.5 border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const input = e.currentTarget;
                                const val = input.value.toLowerCase().trim();
                                if (!val) return;
                                const exists = tokenSummary?.some(t => t.token === val);
                                if (!exists) {
                                  input.style.borderColor = 'red';
                                  setTimeout(() => { input.style.borderColor = ''; }, 1000);
                                  return;
                                }
                                if (section.tokens.includes(val)) {
                                  input.value = '';
                                  return;
                                }
                                const updated = [...labelSections];
                                updated[sIdx] = { ...section, tokens: [...section.tokens, val] };
                                persistence.updateLabelSections(updated);
                                input.value = '';
                              }
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Toggle button if sidebar is hidden */}
              {!isLabelSidebarOpen && (
                <button
                  onClick={() => setIsLabelSidebarOpen(true)}
                  className="self-start mt-2 px-2 py-2 bg-white border border-zinc-200 rounded-xl shadow-sm hover:bg-zinc-50 transition-colors"
                  title="Show labels"
                >
                  <Bookmark className="w-4 h-4 text-zinc-500" />
                </button>
              )}

              {/* Keyword Management */}
              <div className="bg-white border border-zinc-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col flex-1 min-w-0">
              <div className="px-2.5 py-1.5 border-b border-zinc-100 bg-zinc-50/30 flex flex-col shrink-0 relative z-20 gap-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-zinc-500" />Keyword Management</h3>
                  {/* AI Review stats â€" always visible */}
                  {(() => {
                    const allGroups = [...groupedClusters, ...approvedGroups];
                    const reviewed = allGroups.filter(g => g.reviewStatus === 'approve' || g.reviewStatus === 'mismatch');
                    if (reviewed.length === 0) return null;
                    const approveCount = allGroups.filter(g => g.reviewStatus === 'approve').length;
                    const mismatchCount = allGroups.filter(g => g.reviewStatus === 'mismatch').length;
                    const totalCost = allGroups.reduce((sum, g) => sum + (g.reviewCost || 0), 0);
                    return (
                      <div className="flex items-center gap-1.5 ml-auto">
                        <span className="px-1.5 py-0.5 text-[9px] font-medium bg-zinc-100 text-zinc-500 rounded tabular-nums" title="Total AI reviews">{reviewed.length} reviews</span>
                        <span className="px-1.5 py-0.5 text-[9px] font-medium bg-emerald-50 text-emerald-600 rounded tabular-nums" title="Approved">{approveCount} {'\u2713'}</span>
                        {mismatchCount > 0 && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-red-50 text-red-600 rounded tabular-nums" title="Mismatched">{mismatchCount} {'\u2717'}</span>}
                        {totalCost > 0 && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-indigo-50 text-indigo-600 rounded tabular-nums" title="Total API cost">${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}</span>}
                      </div>
                    );
                  })()}
                </div>
                {/* Row 1: Tabs with live counts */}
                <div className="flex items-center gap-1">
                  <div className={`${tabRailClass} w-fit`}>
                    <button
                      onClick={() => switchTab('keywords')}
                      className={`${stateTabBtnBase} ${activeTab === 'keywords' ? mainTabBtnActive : mainTabBtnInactive}`}
                    >
                      <List className="w-3 h-3" />All {(effectiveResults?.length || 0) > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({(effectiveResults?.length || 0).toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => switchTab('pages')}
                      className={`${stateTabBtnBase} ${activeTab === 'pages' ? mainTabBtnActive : mainTabBtnInactive}`}
                    >
                      <FileText className="w-3 h-3" />Ungrouped {(effectiveClusters?.length || 0) > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({(effectiveClusters?.length || 0).toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => {
                        if (activeTab === 'pages' && selectedClusters.size > 0 && groupNameInput.trim()) {
                          handleGroupClusters();
                        }
                        switchTab('grouped');
                      }}
                      className={`${stateTabBtnBase} ${activeTab === 'grouped' ? mainTabBtnActive : mainTabBtnInactive}`}
                    >
                      <Layers className="w-3 h-3" />Grouped {effectiveGrouped.length > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({effectiveGrouped.length.toLocaleString()}/{groupedStats.pagesGrouped.toLocaleString()})</span>}
                      {(() => { const mc = groupedClusters.filter(g => g.reviewStatus === 'mismatch').length; return mc > 0 ? <span className="ml-1 px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded-full">{mc}</span> : null; })()}
                    </button>
                    <button
                      onClick={() => switchTab('group-auto-merge')}
                      className={`${stateTabBtnBase} ${activeTab === 'group-auto-merge' ? 'bg-sky-50 text-sky-700 border border-sky-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#0ea5e9]' : mainTabBtnInactive}`}
                    >
                      <Sparkles className="w-3 h-3" />Auto Merge
                      {pendingGroupMergeRecommendationsCount > 0 && (
                        <span className="text-[10px] text-sky-600 ml-0.5">({pendingGroupMergeRecommendationsCount.toLocaleString()})</span>
                      )}
                    </button>
                    <button
                      onClick={() => switchTab('approved')}
                      className={`${stateTabBtnBase} ${activeTab === 'approved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#10b981]' : mainTabBtnInactive}`}
                    >
                      <CheckCircle2 className="w-3 h-3" />Approved {approvedGroups.length > 0 && <span className="text-[10px] text-emerald-600 ml-0.5">({approvedGroups.length.toLocaleString()}/{approvedPageCount.toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => switchTab('blocked')}
                      className={`${stateTabBtnBase} ${activeTab === 'blocked' ? 'bg-red-50 text-red-700 border border-red-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#ef4444]' : mainTabBtnInactive}`}
                    >
                      <Lock className="w-3 h-3" />Blocked {allBlockedKeywords.length > 0 && <span className="text-[10px] text-red-500 ml-0.5">({allBlockedKeywords.length.toLocaleString()})</span>}
                    </button>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5">
                    {(activeTab === 'pages' || activeTab === 'grouped' || activeTab === 'group-auto-merge' || activeTab === 'keywords') && (
                      <button
                        onClick={() => setShowGroupReviewSettings(!showGroupReviewSettings)}
                        className={`p-1.5 rounded-lg border transition-colors ${showGroupReviewSettings ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'border-zinc-200 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'}`}
                        title="Group Review / Auto Group Settings"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {results && results.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-600">
                    <button
                      type="button"
                      onClick={() => void runKeywordRating()}
                      disabled={kwRatingJob.phase === 'summary' || kwRatingJob.phase === 'rating'}
                      className="px-2 py-0.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                      title="Generate core-intent summary then rate every keyword (1–3)"
                    >
                      Rate KWs
                    </button>
                    {(kwRatingJob.phase === 'summary' || kwRatingJob.phase === 'rating') && (
                      <button type="button" onClick={handleCancelKeywordRating} className="text-zinc-500 hover:text-zinc-800 underline">
                        Cancel
                      </button>
                    )}
                    {kwRatingJob.phase !== 'idle' && (
                      <div className="flex flex-wrap items-center gap-2 min-w-[200px] flex-1">
                        <div className="flex-1 min-w-[120px] max-w-[280px] h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${kwRatingJob.phase === 'summary' ? 'bg-sky-500' : kwRatingJob.phase === 'done' ? 'bg-emerald-500' : kwRatingJob.phase === 'error' ? 'bg-red-400' : 'bg-indigo-500'}`}
                            style={{ width: `${kwRatingJob.progress}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-zinc-700">
                          {kwRatingJob.phase === 'summary' ? 'Summary…' : `${kwRatingJob.progress}%`}
                        </span>
                        <span className="text-zinc-500 tabular-nums">
                          {kwRatingJob.phase === 'rating' || kwRatingJob.phase === 'done' ? `${kwRatingJob.done} / ${kwRatingJob.total} rated` : kwRatingJob.total > 0 ? `${kwRatingJob.total} keywords` : ''}
                        </span>
                        {(kwRatingJob.phase === 'rating' || kwRatingJob.phase === 'done') && kwRatingJob.total > 0 && (
                          <span
                            className="flex items-center gap-0.5 tabular-nums"
                            title="Count per rating: 1 = relevant, 2 = unsure, 3 = not relevant"
                          >
                            <span className="px-1 py-px rounded text-[9px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-200/80">
                              1:{kwRatingJob.n1}
                            </span>
                            <span className="px-1 py-px rounded text-[9px] font-semibold bg-amber-100 text-amber-950 border border-amber-200/70">
                              2:{kwRatingJob.n2}
                            </span>
                            <span className="px-1 py-px rounded text-[9px] font-semibold bg-rose-100 text-rose-900 border border-rose-200/70">
                              3:{kwRatingJob.n3}
                            </span>
                          </span>
                        )}
                        {(kwRatingJob.phase === 'summary' ||
                          kwRatingJob.phase === 'rating' ||
                          kwRatingJob.phase === 'done' ||
                          (kwRatingJob.phase === 'error' && kwRatingJob.apiCalls > 0)) &&
                          kwRatingJob.total > 0 && (
                          <span
                            className="text-zinc-500 tabular-nums max-w-[min(100%,320px)]"
                            title="Elapsed wall time; OpenRouter usage (tokens + usage.cost when returned); API calls = 1 summary + one per keyword"
                          >
                            {formatKeywordRatingDuration(kwRatingJob.elapsedMs)}
                            {kwRatingJob.costReported ? (
                              <span> · ${kwRatingJob.costUsdTotal.toFixed(4)}</span>
                            ) : (
                              <span> · —</span>
                            )}
                            <span>
                              {' '}
                              · {kwRatingJob.promptTokens.toLocaleString()} in / {kwRatingJob.completionTokens.toLocaleString()} out · {kwRatingJob.apiCalls} API
                            </span>
                          </span>
                        )}
                        {kwRatingJob.phase === 'done' && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                        {kwRatingJob.phase === 'error' && kwRatingJob.error && (
                          <span className="text-red-600 truncate max-w-[200px]" title={kwRatingJob.error}>{kwRatingJob.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-[220px] max-w-[480px]">
                    <div className="flex items-center justify-between mb-0.5 text-[10px] font-medium text-zinc-500">
                      <span>Grouping Progress</span>
                      <span className="tabular-nums text-zinc-700">
                        {keywordGroupingProgress.completedPages.toLocaleString()} / {keywordGroupingProgress.totalPages.toLocaleString()} pages
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                        style={{ width: `${keywordGroupingProgress.percent}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-[11px] font-semibold text-emerald-700 tabular-nums">
                    {keywordGroupingProgress.percentLabel}
                  </div>
                  {groupingEta && (
                    <div className="shrink-0 text-[10px] text-zinc-400 italic whitespace-nowrap" title="Estimated time left based on your measured grouping speed">
                      {groupingEta}
                    </div>
                  )}
                  <div className="shrink-0 text-[10px] text-zinc-500 tabular-nums">
                    {keywordGroupingProgress.ungroupedPages.toLocaleString()} ungrouped left
                  </div>
                </div>
                
                {/* Row 2: Token filter badges (compact height) */}
                <div className="h-5 flex items-center">
                  {activeTab === 'group-auto-merge' ? (
                    <span className="text-xs text-zinc-400">Recommendations are generated only from the current Grouped groups.</span>
                  ) : selectedTokens.size > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {Array.from(selectedTokens).map(token => (
                        <button
                          key={token}
                          onClick={() => {
                            const newTokens = new Set(selectedTokens);
                            newTokens.delete(token);
                            setSelectedTokens(newTokens);
                            setCurrentPage(1);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-xs font-medium hover:bg-indigo-100 transition-colors group"
                        >
                          {token}
                          <X className="w-3 h-3 text-indigo-400 group-hover:text-indigo-600" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-400">Click tokens to filter</span>
                  )}
                </div>

                {/* Row 3: Results count | Selection | Search | Context-aware actions */}
                <div className="flex items-center gap-2">
                  {/* Active results count â€" fixed position, never shifts */}
                  <span className="text-[11px] text-zinc-400 tabular-nums whitespace-nowrap shrink-0 min-w-[100px]">
                    {filteredCount.toLocaleString()} / {totalCount.toLocaleString()}{' '}
                    {activeTab === 'pages' ? 'pages' : activeTab === 'keywords' ? 'keywords' : activeTab === 'grouped' ? 'groups' : activeTab === 'group-auto-merge' ? 'recommendations' : activeTab === 'approved' ? 'groups' : activeTab === 'blocked' ? 'blocked' : 'items'}
                  </span>

                  {/* Selection count â€" fixed min-width so it doesn't shift other elements */}
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded tabular-nums whitespace-nowrap shrink-0 min-w-[70px] text-center transition-colors ${
                    (() => {
                      const selCount = activeTab === 'pages' ? selectedClusters.size :
                                       activeTab === 'grouped' ? (selectedGroups.size + selectedSubClusters.size) :
                                       activeTab === 'approved' ? selectedGroups.size : 0;
                      return selCount > 0 ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-transparent';
                    })()
                  }`}>
                    {(() => {
                      const selCount = activeTab === 'pages' ? selectedClusters.size :
                                       activeTab === 'grouped' ? (selectedGroups.size + selectedSubClusters.size) :
                                       activeTab === 'approved' ? selectedGroups.size : 0;
                      return selCount > 0 ? `${selCount} selected` : '\u00A0';
                    })()}
                  </span>

                  {activeTab !== 'group-auto-merge' && (
                    <>
                  {/* Search */}
                  <div className="relative w-52 shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(e) => { setSearchImmediate(e.target.value); setCurrentPage(1); }}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow bg-white"
                    />
                  </div>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Context-aware action buttons â€" change based on activeTab */}
                  <div className="flex items-center gap-1.5 flex-shrink min-w-0 flex-wrap justify-end">
                    {/* Group name input â€" visible on Pages (Ungrouped) AND Pages (Grouped) for future rename feature */}
                    {(activeTab === 'pages' || activeTab === 'grouped') && (
                      <input
                        type="text"
                        placeholder="Group name..."
                        value={groupNameInput}
                        onChange={(e) => setGroupNameInput(e.target.value)}
                        className="w-40 px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                    )}

                    {/* Pages (Ungrouped): Group button */}
                    {activeTab === 'pages' && (
                      <>
                        <button
                          onClick={handleGroupClusters}
                          disabled={selectedClusters.size === 0 || !groupNameInput.trim()}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                        >
                          Group ({selectedClusters.size})
                        </button>
                        <button
                          onClick={handleRunFilteredAutoGroup}
                          disabled={!isFilteredAutoGroupFilterActive || filteredClusters.length < 1}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[110px]"
                          title="Review all currently filtered ungrouped pages and create strict semantic groups"
                        >
                          {isRunningFilteredAutoGroup || filteredAutoGroupQueue.length > 0 ? 'Queue Auto Group' : 'Auto Group'} ({filteredClusters.length})
                        </button>
                        {isRunningFilteredAutoGroup && (
                          <button
                            onClick={handleStopFilteredAutoGroup}
                            className="px-4 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors whitespace-nowrap min-w-[110px]"
                          >
                            Stop
                          </button>
                        )}
                      </>
                    )}

                    {/* Pages (Grouped): Approve + Ungroup buttons */}
                    {activeTab === 'grouped' && (
                      <>
                        <button
                          onClick={() => {
                            const groupsToApprove = groupedClusters.filter(g => selectedGroups.has(g.id));
                            if (groupsToApprove.length > 0) {
                              groupsToApprove.forEach(g => handleApproveGroup(g.groupName));
                              setSelectedGroups(new Set());
                              setSelectedSubClusters(new Set());
                            }
                          }}
                          disabled={selectedGroups.size === 0}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                        >
                          Approve ({selectedGroups.size})
                        </button>
                        <button
                          onClick={handleUngroupClusters}
                          disabled={selectedGroups.size === 0 && selectedSubClusters.size === 0}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                        >
                          Ungroup ({selectedGroups.size + selectedSubClusters.size})
                        </button>
                        <button
                          onClick={exportCSV}
                          disabled={effectiveGrouped.length === 0}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                          title="Export grouped clusters to CSV"
                        >
                          <Download className="w-3.5 h-3.5 mr-1 inline" /> Export
                        </button>
                      </>
                    )}

                    {/* Pages (Approved): Unapprove â€" handles both entire groups AND individual pages */}
                    {activeTab === 'approved' && (
                      <>
                        <button
                          onClick={handleRemoveFromApproved}
                          disabled={selectedGroups.size === 0 && selectedSubClusters.size === 0}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                        >
                          Unapprove ({selectedGroups.size + selectedSubClusters.size})
                        </button>
                        <button
                          onClick={exportCSV}
                          disabled={approvedGroups.length === 0}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                          title="Export approved clusters to CSV"
                        >
                          <Download className="w-3.5 h-3.5 mr-1 inline" /> Export
                        </button>
                      </>
                    )}
                  </div>
                    </>
                  )}
                </div>
                {activeTab !== 'auto-group' && activeTab !== 'group-auto-merge' && (
                  <div
                    className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-zinc-200/90 bg-zinc-50 px-2 py-0.5 text-[10px] leading-tight text-zinc-600"
                    title={
                      filteredAutoGroupSettingsStatus.missing.length > 0
                        ? undefined
                        : filteredAutoGroupSettingsStatus.summary
                    }
                  >
                    <span className="inline-flex items-center gap-0.5 font-semibold text-zinc-700 shrink-0">
                      <Sparkles className="w-3 h-3 text-violet-600" aria-hidden />
                      Auto Group
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-medium shrink-0 ${
                        filteredAutoGroupStats.status === 'running'
                          ? 'bg-blue-100 text-blue-700'
                          : filteredAutoGroupStats.status === 'complete'
                            ? 'bg-emerald-100 text-emerald-700'
                            : filteredAutoGroupStats.status === 'error'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-zinc-200/80 text-zinc-600'
                      }`}
                    >
                      {filteredAutoGroupStats.status === 'running' ? (
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden />
                      ) : filteredAutoGroupStats.status === 'complete' ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden />
                      ) : filteredAutoGroupStats.status === 'error' ? (
                        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" aria-hidden />
                      )}
                      {filteredAutoGroupStats.status === 'running'
                        ? 'Running'
                        : filteredAutoGroupStats.status === 'complete'
                          ? 'Done'
                          : filteredAutoGroupStats.status === 'error'
                            ? 'Error'
                            : 'Idle'}
                    </span>
                    <span className="text-zinc-300 select-none" aria-hidden>
                      |
                    </span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0" title="Groups created">
                      <Layers className="w-3 h-3 text-violet-600 shrink-0" aria-hidden />
                      {filteredAutoGroupStats.groupsCreated}
                    </span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0" title="Pages grouped">
                      <Check className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden />
                      {filteredAutoGroupStats.pagesGrouped}
                    </span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0" title="Pages remaining">
                      <List className="w-3 h-3 text-amber-600 shrink-0" aria-hidden />
                      {filteredAutoGroupStats.pagesRemaining}
                    </span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0" title="Jobs queued">
                      <Inbox className="w-3 h-3 text-indigo-600 shrink-0" aria-hidden />
                      {filteredAutoGroupQueue.length}
                    </span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0" title="Volume grouped">
                      <TrendingUp className="w-3 h-3 text-sky-600 shrink-0" aria-hidden />
                      {filteredAutoGroupStats.totalVolumeGrouped.toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-0.5 tabular-nums shrink-0" title="API cost (last run)">
                      <DollarSign className="w-3 h-3 text-emerald-700 shrink-0" aria-hidden />
                      {filteredAutoGroupStats.cost.toFixed(4)}
                    </span>
                    {filteredAutoGroupStats.elapsedMs > 0 && (
                      <span className="tabular-nums text-zinc-500 shrink-0" title="Elapsed">
                        {(filteredAutoGroupStats.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {filteredAutoGroupStats.error && (
                      <span className="max-w-[min(100%,12rem)] truncate text-red-600" title={filteredAutoGroupStats.error}>
                        {filteredAutoGroupStats.error}
                      </span>
                    )}
                    <span className="text-zinc-300 select-none hidden sm:inline" aria-hidden>
                      |
                    </span>
                    {filteredAutoGroupSettingsStatus.missing.length > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-700 shrink-0">
                        <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />
                        Missing: {filteredAutoGroupSettingsStatus.missing.join(', ')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-zinc-500 min-w-0 truncate">
                        <Settings className="w-3 h-3 shrink-0 text-zinc-400" aria-hidden />
                        <span className="truncate">Group Review</span>
                      </span>
                    )}
                    <span className="text-zinc-400 shrink-0" title="Keyboard shortcut">
                      Shift+1{activeTab === 'pages' ? '' : ' (Ungrouped)'}
                    </span>
                  </div>
                )}
              </div>

              {/* AI Group Review Settings Panel â€" mounted for both Pages and Grouped because Pages Auto Group uses the same settings */}
              <div className={activeTab === 'grouped' || activeTab === 'group-auto-merge' || activeTab === 'pages' || activeTab === 'keywords' ? 'px-4' : 'hidden'}>
                <GroupReviewSettings
                  ref={groupReviewSettingsRef}
                  isOpen={showGroupReviewSettings}
                  onToggle={() => setShowGroupReviewSettings(false)}
                  starredModels={starredModels}
                  onToggleStar={toggleStarModel}
                  onSettingsChange={setGroupReviewSettingsSnapshot}
                  onHydratedChange={setGroupReviewSettingsHydrated}
                  addToast={addToast}
                />
              </div>

              <div className="overflow-auto flex-1 rounded-b-2xl" style={activeTab === 'auto-group' || activeTab === 'group-auto-merge' ? { display: 'none' } : undefined}>

                <table className="text-left text-sm relative w-full table-fixed">
                  {/* Shared TableHeader â€" single source of truth for all tab headers */}
                  {activeTab === 'pages' ? (
                    <TableHeader
                      columns={PAGES_COLUMNS}
                      showCheckbox={true}
                      allChecked={paginatedClusters.length > 0 && paginatedClusters.every(c => selectedClusters.has(c.tokens))}
                      onCheckAll={(checked) => {
                        const newSelected = new Set(selectedClusters);
                        if (checked) {
                          paginatedClusters.forEach(c => newSelected.add(c.tokens));
                        } else {
                          paginatedClusters.forEach(c => newSelected.delete(c.tokens));
                        }
                        setSelectedClusters(newSelected);
                        if (newSelected.size > 0) {
                          let highest: ClusterSummary | null = null;
                          for (const tokens of newSelected) {
                            const c = clusterByTokens.get(tokens);
                            if (c && (!highest || c.totalVolume > highest.totalVolume)) highest = c;
                          }
                          if (highest) setGroupNameInput(highest.pageName);
                        } else {
                          setGroupNameInput('');
                        }
                      }}
                      sortKey={sortConfig[0]?.key ?? null}
                      sortDirection={sortConfig[0]?.direction ?? 'desc'}
                      sortStack={sortConfig as Array<{key: string, direction: 'asc' | 'desc'}>}
                      onSort={(key, additive) => handleSort(key as keyof ClusterSummary, additive)}
                      filters={filterBag}
                      setCurrentPage={setCurrentPage}
                    />
                  ) : activeTab === 'approved' ? (
                    <TableHeader
                      columns={APPROVED_COLUMNS}
                      showCheckbox={true}
                      allChecked={filteredApprovedGroups.length > 0 && filteredApprovedGroups.every(g => selectedGroups.has(g.id))}
                      onCheckAll={(checked) => {
                        const newGroups = new Set(selectedGroups);
                        const newSubs = new Set(selectedSubClusters);
                        if (checked) {
                          filteredApprovedGroups.forEach(g => { newGroups.add(g.id); g.clusters.forEach(c => newSubs.add(`${g.id}::${c.tokens}`)); });
                        } else {
                          filteredApprovedGroups.forEach(g => { newGroups.delete(g.id); g.clusters.forEach(c => newSubs.delete(`${g.id}::${c.tokens}`)); });
                        }
                        setSelectedGroups(newGroups);
                        setSelectedSubClusters(newSubs);
                      }}
                      sortKey={groupedSortConfig[0]?.key ?? null}
                      sortDirection={groupedSortConfig[0]?.direction ?? 'desc'}
                      sortStack={groupedSortConfig}
                      onSort={handleGroupedSort}
                      filters={filterBag}
                      setCurrentPage={setCurrentPage}
                    />
                  ) : activeTab === 'grouped' ? (
                    <TableHeader
                      columns={GROUPED_COLUMNS}
                      showCheckbox={true}
                      allChecked={paginatedGroupedClusters.length > 0 && paginatedGroupedClusters.every(g => selectedGroups.has(g.id))}
                      onCheckAll={(checked) => {
                        const newGroups = new Set(selectedGroups);
                        const newSubs = new Set(selectedSubClusters);
                        if (checked) {
                          paginatedGroupedClusters.forEach(g => { newGroups.add(g.id); g.clusters.forEach(c => newSubs.add(`${g.id}::${c.tokens}`)); });
                        } else {
                          paginatedGroupedClusters.forEach(g => { newGroups.delete(g.id); g.clusters.forEach(c => newSubs.delete(`${g.id}::${c.tokens}`)); });
                        }
                        setSelectedGroups(newGroups);
                        setSelectedSubClusters(newSubs);
                      }}
                      sortKey={groupedSortConfig[0]?.key ?? null}
                      sortDirection={groupedSortConfig[0]?.direction ?? 'desc'}
                      sortStack={groupedSortConfig}
                      onSort={handleGroupedSort}
                      filters={filterBag}
                      setCurrentPage={setCurrentPage}
                    />
                  ) : activeTab === 'keywords' ? (
                    <TableHeader
                      columns={KEYWORDS_COLUMNS}
                      showCheckbox={false}
                      sortKey={keywordsSortConfig[0]?.key ?? null}
                      sortDirection={keywordsSortConfig[0]?.direction ?? 'desc'}
                      sortStack={keywordsSortConfig}
                      onSort={handleKeywordsSort}
                      filters={filterBag}
                      setCurrentPage={setCurrentPage}
                    />
                  ) : activeTab === 'blocked' ? (
                    <TableHeader
                      columns={BLOCKED_COLUMNS}
                      showCheckbox={false}
                      sortKey={blockedSortConfig.key}
                      sortDirection={blockedSortConfig.direction}
                      onSort={handleBlockedSort}
                      filters={filterBag}
                      setCurrentPage={setCurrentPage}
                    />
                  ) : null}
                  <tbody className="divide-y divide-zinc-100 [&>tr:nth-child(even)]:bg-zinc-50/60">
                    {activeTab === 'pages' && paginatedClusters.map((row, idx) => (
                      <ClusterRow 
                        key={idx} 
                        row={row} 
                        isExpanded={expandedClusters.has(row.pageName)}
                        isSelected={selectedClusters.has(row.tokens)}
                        selectedTokens={selectedTokens}
                        toggleCluster={toggleCluster}
                        onSelect={(checked) => {
                          const newSelected = new Set(selectedClusters);
                          if (checked) {
                            newSelected.add(row.tokens);
                          } else {
                            newSelected.delete(row.tokens);
                          }
                          setSelectedClusters(newSelected);
                          
                          if (newSelected.size > 0) {
                            let highest: ClusterSummary | null = null;
                            for (const tokens of newSelected) {
                              const c = clusterByTokens.get(tokens);
                              if (c && (!highest || c.totalVolume > highest.totalVolume)) {
                                highest = c;
                              }
                            }
                            if (highest) setGroupNameInput(highest.pageName);
                          } else {
                            setGroupNameInput('');
                          }
                        }}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        onMiddleClick={(e) => {
                          if (e.button === 1) { // Middle click
                            e.preventDefault();
                            if (selectedClusters.size > 0 && groupNameInput.trim()) {
                              handleGroupClusters();
                            }
                          }
                        }}
                        labelColorMap={labelColorMap}
                        onBlockToken={handleBlockSingleToken}
                      />
                    ))}

                    {activeTab === 'keywords' && paginatedResults.map((row) => (
                      <tr
                        key={`${row.pageName}\u0000${row.keywordLower}`}
                        className="hover:bg-zinc-50/50 transition-colors"
                      >
                        <td className={`${CELL.dataNormal} truncate max-w-0`} title={row.pageName}>{row.pageName}</td>
                        <td className={`${CELL.dataNormal} truncate max-w-0`} title={row.tokens}>{row.tokens}</td>
                        <td className={CELL.dataCompact}>{row.pageNameLen}</td>
                        <td className={`${CELL.dataNormal} truncate max-w-0`} title={row.keyword}>{row.keyword}</td>
                        <td className={CELL.dataCompact}>{row.searchVolume.toLocaleString()}</td>
                        <td className={CELL.dataCompact}>{row.kd !== null ? row.kd : '—'}</td>
                        <td className={CELL.dataCompact}>
                          {row.kwRating != null ? (
                            <span
                              className={`inline-flex min-w-[1.5rem] justify-center px-1 py-0.5 rounded text-[11px] font-semibold tabular-nums border ${
                                row.kwRating === 1
                                  ? 'bg-emerald-100/90 text-emerald-900 border-emerald-200/80'
                                  : row.kwRating === 2
                                    ? 'bg-amber-100/90 text-amber-950 border-amber-200/70'
                                    : 'bg-rose-100/90 text-rose-900 border-rose-200/70'
                              }`}
                            >
                              {row.kwRating}
                            </span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                        <td className={`${CELL.dataNormal} truncate max-w-0`} title={row.label}>{row.label || '—'}</td>
                        <td className={`${CELL.dataNormal} truncate max-w-0`}>{row.locationCity || '—'}</td>
                        <td className={`${CELL.dataNormal} truncate max-w-0`}>{row.locationState || '—'}</td>
                      </tr>
                    ))}
                    
                    {activeTab === 'grouped' && paginatedGroupedClusters.map((row, idx) => (
                      <GroupedClusterRow 
                        key={idx} 
                        row={row} 
                        isExpanded={expandedGroupedClusters.has(row.id)}
                        expandedSubClusters={expandedGroupedSubClusters}
                        toggleGroup={(id) => {
                          const newExpanded = new Set(expandedGroupedClusters);
                          if (newExpanded.has(id)) newExpanded.delete(id);
                          else newExpanded.add(id);
                          setExpandedGroupedClusters(newExpanded);
                        }}
                        toggleSubCluster={(subId) => {
                          const newExpanded = new Set(expandedGroupedSubClusters);
                          if (newExpanded.has(subId)) newExpanded.delete(subId);
                          else newExpanded.add(subId);
                          setExpandedGroupedSubClusters(newExpanded);
                        }}
                        selectedTokens={selectedTokens}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        isGroupSelected={selectedGroups.has(row.id)}
                        selectedSubClusters={selectedSubClusters}
                        onGroupSelect={(checked) => {
                          const newGroups = new Set(selectedGroups);
                          const newSubs = new Set(selectedSubClusters);
                          if (checked) {
                            newGroups.add(row.id);
                            // Also select all sub-clusters in this group
                            row.clusters.forEach(c => newSubs.add(`${row.id}::${c.tokens}`));
                          } else {
                            newGroups.delete(row.id);
                            // Also deselect all sub-clusters in this group
                            row.clusters.forEach(c => newSubs.delete(`${row.id}::${c.tokens}`));
                          }
                          setSelectedGroups(newGroups);
                          setSelectedSubClusters(newSubs);
                        }}
                        onSubClusterSelect={(subKey, checked) => {
                          const newSubs = new Set(selectedSubClusters);
                          if (checked) {
                            newSubs.add(subKey);
                          } else {
                            newSubs.delete(subKey);
                          }
                          setSelectedSubClusters(newSubs);
                          // If all sub-clusters of a group are selected, auto-select the group
                          const groupId = parseSubClusterKey(subKey)?.groupId;
                          if (!groupId) return;
                          const group = groupedClusters.find(g => g.id === groupId);
                          if (group) {
                            const allSelected = group.clusters.every(c => newSubs.has(`${groupId}::${c.tokens}`));
                            const newGroups = new Set(selectedGroups);
                            if (allSelected) {
                              newGroups.add(groupId);
                            } else {
                              newGroups.delete(groupId);
                            }
                            setSelectedGroups(newGroups);
                          }
                        }}
                        labelColorMap={labelColorMap}
                        onBlockToken={handleBlockSingleToken}
                        groupActionButton={
                          <button
                            onClick={() => handleApproveGroup(row.groupName)}
                            className="w-5 h-5 flex items-center justify-center rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors text-[10px] font-bold shrink-0"
                            title="Approve group"
                          >
                            {'\u2713'}
                          </button>
                        }
                      />
                    ))}

                    {activeTab === 'approved' && (() => {
                      // Apply same multi-sorting as grouped tab
                      const sorted = [...filteredApprovedGroups].sort((a, b) => {
                        for (const { key, direction } of groupedSortConfig) {
                          let aVal: any, bVal: any;
                          if (key === 'groupName') { aVal = a.groupName.toLowerCase(); bVal = b.groupName.toLowerCase(); }
                          else if (key === 'keywordCount') { aVal = a.keywordCount; bVal = b.keywordCount; }
                          else if (key === 'totalVolume') { aVal = a.totalVolume; bVal = b.totalVolume; }
                          else if (key === 'avgKd') { aVal = a.avgKd ?? -1; bVal = b.avgKd ?? -1; }
                          else if (key === 'avgKwRating') { aVal = a.avgKwRating ?? -1; bVal = b.avgKwRating ?? -1; }
                          else { aVal = 0; bVal = 0; }
                          if (typeof aVal === 'string') {
                            const cmp = aVal.localeCompare(bVal);
                            if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
                            continue;
                          }
                          if (aVal !== bVal) return direction === 'asc' ? aVal - bVal : bVal - aVal;
                        }
                        return 0;
                      });
                      // Apply same pagination
                      const paginated = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
                      return paginated;
                    })().map((group, idx) => (
                      <GroupedClusterRow
                        key={group.id}
                        row={group}
                        isExpanded={expandedGroupedClusters.has(group.id)}
                        expandedSubClusters={expandedGroupedSubClusters}
                        toggleGroup={(id) => {
                          const newExpanded = new Set(expandedGroupedClusters);
                          if (newExpanded.has(id)) newExpanded.delete(id);
                          else newExpanded.add(id);
                          setExpandedGroupedClusters(newExpanded);
                        }}
                        toggleSubCluster={(subId) => {
                          const newExpanded = new Set(expandedGroupedSubClusters);
                          if (newExpanded.has(subId)) newExpanded.delete(subId);
                          else newExpanded.add(subId);
                          setExpandedGroupedSubClusters(newExpanded);
                        }}
                        selectedTokens={selectedTokens}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        isGroupSelected={selectedGroups.has(group.id)}
                        selectedSubClusters={selectedSubClusters}
                        onGroupSelect={(checked) => {
                          const newGroups = new Set(selectedGroups);
                          const newSubs = new Set(selectedSubClusters);
                          if (checked) {
                            newGroups.add(group.id);
                            group.clusters.forEach(c => newSubs.add(`${group.id}::${c.tokens}`));
                          } else {
                            newGroups.delete(group.id);
                            group.clusters.forEach(c => newSubs.delete(`${group.id}::${c.tokens}`));
                          }
                          setSelectedGroups(newGroups);
                          setSelectedSubClusters(newSubs);
                        }}
                        onSubClusterSelect={(subKey, checked) => {
                          const newSubs = new Set(selectedSubClusters);
                          if (checked) newSubs.add(subKey);
                          else newSubs.delete(subKey);
                          setSelectedSubClusters(newSubs);
                          const groupId = parseSubClusterKey(subKey)?.groupId;
                          if (!groupId) return;
                          const g = approvedGroups.find(ag => ag.id === groupId);
                          if (g) {
                            const allSelected = g.clusters.every(c => newSubs.has(`${groupId}::${c.tokens}`));
                            const newGroups = new Set(selectedGroups);
                            if (allSelected) newGroups.add(groupId);
                            else newGroups.delete(groupId);
                            setSelectedGroups(newGroups);
                          }
                        }}
                        labelColorMap={labelColorMap}
                        onBlockToken={handleBlockSingleToken}
                        groupActionButton={
                          <button
                            onClick={() => handleUnapproveGroup(group.groupName)}
                            className="w-5 h-5 flex items-center justify-center rounded bg-amber-500 text-white hover:bg-amber-600 transition-colors text-[10px] font-bold shrink-0"
                            title="Unapprove group"
                          >
                            ↩
                          </button>
                        }
                      />
                    ))}

                    {activeTab === 'blocked' && sortedBlocked.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((row, idx) => (
                      <tr key={idx} className="hover:bg-red-50/50 transition-colors">
                        <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 break-words">{row.keyword}</td>
                        <td className="px-3 py-0.5 overflow-hidden">
                          {row.tokenArr ? (
                            <div className="flex flex-wrap gap-1">
                              {row.tokenArr.map((t, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-md text-[12px]">{t}</span>
                              ))}
                            </div>
                          ) : <span className="text-zinc-400">-</span>}
                        </td>
                        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">{row.volume.toLocaleString()}</td>
                        <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">{row.kd !== null ? row.kd : '-'}</td>
                        <KwRatingCell value={row.kwRating} />
                        <td className="px-3 py-0.5 text-[12px]">
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-medium">{row.reason}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Auto-Group Panel â€" replaces table when auto-group tab is active */}
              {activeTab === 'auto-group' && (
                <AutoGroupPanel
                  key={activeProjectId || 'no-project'}
                  effectiveClusters={effectiveClusters}
                  onApproveGroups={handleAutoGroupApprove}
                  groupReviewSettingsRef={groupReviewSettingsRef}
                  logAndToast={logAndToast}
                  persistedSuggestions={autoGroupSuggestions}
                  onSuggestionsChange={persistence.updateSuggestions}
                />
              )}

              {activeTab === 'group-auto-merge' && (
                <GroupAutoMergePanel
                  groupedClusters={groupedClusters}
                  recommendations={groupMergeRecommendations}
                  recommendationsAreStale={groupAutoMergeRecommendationsAreStale}
                  job={groupAutoMergeJob}
                  onRun={runGroupAutoMergeRecommendations}
                  onCancel={cancelGroupAutoMerge}
                  onDismiss={dismissGroupAutoMergeRecommendations}
                  onApply={applyGroupAutoMergeRecommendations}
                />
              )}

              <div className="px-4 py-2 border-t border-zinc-200 bg-zinc-50 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0" style={activeTab === 'auto-group' || activeTab === 'group-auto-merge' ? { display: 'none' } : undefined}>
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <span>Show</span>
                  <select 
                    value={itemsPerPage} 
                    onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                    className="border border-zinc-300 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={250}>250</option>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                  </select>
                  <span>entries</span>
                </div>
                
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 text-sm font-medium rounded-md border border-zinc-300 bg-white text-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 transition-colors"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-zinc-600 font-medium">
                        Page {currentPage} of {Math.max(1, totalPages)}
                        <span className="ml-2 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold border border-indigo-100 shadow-sm">
                          {filteredCount.toLocaleString()} / {totalCount.toLocaleString()}{' '}
                          {activeTab === 'pages' ? 'pages' : activeTab === 'keywords' ? 'keywords' : activeTab === 'grouped' ? 'groups' : activeTab === 'group-auto-merge' ? 'recommendations' : activeTab === 'approved' ? 'groups' : activeTab === 'blocked' ? 'blocked' : activeTab}
                        </span>
                      </span>
                      <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages || totalPages === 0}
                        className="px-3 py-1 text-sm font-medium rounded-md border border-zinc-300 bg-white text-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 transition-colors"
                      >
                        Next
                      </button>
                    </div>
              </div>
              </div>
              {/* End Keyword Management */}

              {/* Token Management Panel */}
              <div className="bg-white border border-zinc-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex flex-col w-[340px] shrink-0">
                <div className="px-4 py-3 border-b border-zinc-200 shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5 text-zinc-500" />Token Management</h3>
                    <div className="flex items-center gap-2">
                      {tokenSummary && tokenSummary.length > 0 && (
                        <button
                          onClick={exportTokensCSV}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-zinc-200 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                          title="Export all tokens"
                        >
                          <Download className="w-2.5 h-2.5" />
                          Export
                        </button>
                      )}
                      {blockedTokens.size > 0 && (
                        <span className="text-[10px] font-medium text-red-600">{blockedTokens.size} blocked</span>
                      )}
                    </div>
                  </div>
                  {/* Subtabs */}
                  <div className="flex space-x-0.5 bg-zinc-200/50 p-0.5 rounded-md">
                    {(['current', 'all', 'merge', 'auto-merge', 'blocked'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => {
                          setTokenMgmtSubTab(tab);
                          setTokenMgmtPage(1);
                          setSelectedMgmtTokens(new Set());
                          setExpandedMergeParents(new Set());
                        }}
                        className={`flex-1 px-2 py-1 text-[10px] font-medium rounded transition-all capitalize ${
                          tokenMgmtSubTab === tab
                            ? tab === 'blocked' ? 'bg-red-50 text-red-700 shadow-sm' : 'bg-white text-zinc-900 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-700'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  {/* Search + actions */}
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Search tokens (comma-separated)..."
                        value={tokenMgmtSearch}
                        onChange={(e) => { setTokenMgmtSearch(e.target.value); setTokenMgmtPage(1); }}
                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    {selectedMgmtTokens.size > 0 && tokenMgmtSubTab !== 'blocked' && tokenMgmtSubTab !== 'merge' && tokenMgmtSubTab !== 'auto-merge' && (
                      <button
                        onClick={() => handleBlockTokens(Array.from(selectedMgmtTokens))}
                        className="px-2 py-1.5 text-[10px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors whitespace-nowrap"
                      >
                        Block ({selectedMgmtTokens.size})
                      </button>
                    )}
                    {selectedMgmtTokens.size >= 2 && tokenMgmtSubTab !== 'blocked' && tokenMgmtSubTab !== 'merge' && tokenMgmtSubTab !== 'auto-merge' && (
                      <button
                        onClick={handleOpenMergeModal}
                        className="px-2 py-1.5 text-[10px] font-semibold rounded-md bg-indigo-500 text-white hover:bg-indigo-600 transition-colors whitespace-nowrap"
                      >
                        Merge ({selectedMgmtTokens.size})
                      </button>
                    )}
                    {selectedMgmtTokens.size > 0 && tokenMgmtSubTab === 'blocked' && (
                      <button
                        onClick={() => handleUnblockTokens(Array.from(selectedMgmtTokens))}
                        className="px-2 py-1.5 text-[10px] font-semibold rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors whitespace-nowrap"
                      >
                        Unblock ({selectedMgmtTokens.size})
                      </button>
                    )}
                    {tokenMgmtSubTab === 'auto-merge' && autoMergeRecommendations.some(r => r.status === 'pending') && (
                      <button
                        onClick={applyAllAutoMergeRecommendations}
                        className="px-2 py-1.5 text-[10px] font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
                      >
                        Merge All
                      </button>
                    )}
                  </div>
                  {results && results.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-600">
                      <button
                        type="button"
                        onClick={() => void runAutoMergeRecommendations()}
                        disabled={autoMergeJob.phase === 'running'}
                        className="px-2 py-0.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        title="Compare each non-blocked token to all other non-blocked tokens and queue exact-identity merge recommendations"
                      >
                        Auto Merge KWs
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAutoMergeRecommendations(10)}
                        disabled={autoMergeJob.phase === 'running'}
                        className="px-2 py-0.5 rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        title="Run Auto Merge on top 10% of eligible tokens (cost-saving test mode)"
                      >
                        Test 10%
                      </button>
                      {autoMergeJob.phase === 'running' && (
                        <button type="button" onClick={handleCancelAutoMerge} className="text-zinc-500 hover:text-zinc-800 underline">
                          Cancel
                        </button>
                      )}
                      {autoMergeJob.phase !== 'idle' && (
                        <div className="flex flex-wrap items-center gap-2 min-w-[200px] flex-1">
                          <div className="flex-1 min-w-[120px] max-w-[280px] h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${autoMergeJob.phase === 'done' ? 'bg-emerald-500' : autoMergeJob.phase === 'error' ? 'bg-red-400' : 'bg-violet-500'}`}
                              style={{ width: `${autoMergeJob.progress}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-zinc-700">
                            {autoMergeJob.progress}%
                          </span>
                          <span className="text-zinc-500 tabular-nums">
                            {autoMergeJob.done} / {autoMergeJob.total} tokens
                          </span>
                          <span className="text-zinc-500 tabular-nums">
                            {autoMergeJob.recommendations} recommendations
                          </span>
                          {autoMergeJob.total > 0 && (
                            <span className="text-zinc-500 tabular-nums max-w-[min(100%,320px)]">
                              {formatKeywordRatingDuration(autoMergeJob.elapsedMs)}
                              {autoMergeJob.costReported ? (
                                <span> · ${autoMergeJob.costUsdTotal.toFixed(4)}</span>
                              ) : (
                                <span> · —</span>
                              )}
                              <span>
                                {' '}
                                · {autoMergeJob.promptTokens.toLocaleString()} in / {autoMergeJob.completionTokens.toLocaleString()} out · {autoMergeJob.apiCalls} API
                              </span>
                            </span>
                          )}
                          {autoMergeJob.phase === 'done' && <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden />}
                          {autoMergeJob.phase === 'error' && autoMergeJob.error && (
                            <span className="text-red-600 truncate max-w-[200px]" title={autoMergeJob.error}>{autoMergeJob.error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Merge subtab is rendered in the table below */}

                <div className="overflow-auto flex-1">
                  {tokenMgmtSubTab === 'merge' ? (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#f0f0f0]">
                        <tr>
                          <th className="px-2 py-1.5 w-8">
                            <input
                              type="checkbox"
                              className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                              disabled
                              checked={false}
                            />
                          </th>
                          <th
                            className="px-2 py-1.5 cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setTokenMgmtSort(prev => ({ key: 'token', direction: prev.key === 'token' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                          >
                            <div className="flex items-center gap-1">
                              Token
                              {tokenMgmtSort.key === 'token' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setTokenMgmtSort(prev => ({ key: 'frequency', direction: prev.key === 'frequency' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                          >
                            <div className="flex items-center justify-end gap-1">
                              KWs
                              {tokenMgmtSort.key === 'frequency' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setTokenMgmtSort(prev => ({ key: 'totalVolume', direction: prev.key === 'totalVolume' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Vol.
                              {tokenMgmtSort.key === 'totalVolume' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setTokenMgmtSort(prev => ({ key: 'avgKd', direction: prev.key === 'avgKd' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                          >
                            <div className="flex items-center justify-end gap-1">
                              KD
                              {tokenMgmtSort.key === 'avgKd' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                            </div>
                          </th>
                          <th className="px-1 py-1.5 w-6"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 [&>tr:nth-child(even)]:bg-zinc-50/60">
                        {paginatedMergeRuleRows.map(ruleRow => {
                          const forcedExpanded = tokenMgmtMergeSearchTerms.length > 0 && ruleRow.childTokens.some(c => tokenIncludesAnyTerm(c, tokenMgmtMergeSearchTerms));
                          const isExpanded = forcedExpanded || expandedMergeParents.has(ruleRow.ruleId);

                          return (
                            <React.Fragment key={ruleRow.ruleId}>
                              <tr className="hover:bg-zinc-50/50 transition-colors">
                                <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                                    disabled
                                    checked={false}
                                  />
                                </td>
                                <td className="px-2 py-1 font-mono text-zinc-800">
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (forcedExpanded) return;
                                        setExpandedMergeParents(prev => {
                                          const next = new Set(prev);
                                          if (next.has(ruleRow.ruleId)) next.delete(ruleRow.ruleId);
                                          else next.add(ruleRow.ruleId);
                                          return next;
                                        });
                                      }}
                                      disabled={forcedExpanded}
                                      className={`p-0.5 transition-colors ${forcedExpanded ? 'text-zinc-300 cursor-not-allowed' : 'text-zinc-400 hover:text-zinc-600'}`}
                                      title={forcedExpanded ? 'Expanded by search match' : (isExpanded ? 'Collapse' : 'Expand')}
                                    >
                                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const newTokens = new Set(selectedTokens);
                                        if (newTokens.has(ruleRow.parentToken)) newTokens.delete(ruleRow.parentToken);
                                        else newTokens.add(ruleRow.parentToken);
                                        setSelectedTokens(newTokens);
                                        setCurrentPage(1);
                                        if (newTokens.size > 0) switchTab('pages');
                                      }}
                                      className={`${selectedTokens.has(ruleRow.parentToken) ? 'bg-purple-100 text-purple-700 font-semibold' : 'hover:text-indigo-600 hover:bg-indigo-50'} px-1 rounded transition-colors cursor-pointer`}
                                      title={tokenPagesTooltip(ruleRow.parentToken)}
                                    >
                                      {ruleRow.parentToken}
                                    </button>
                                  </div>
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{ruleRow.parentStats.frequency.toLocaleString()}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{ruleRow.parentStats.totalVolume.toLocaleString()}</td>
                                <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{ruleRow.parentStats.avgKd !== null ? ruleRow.parentStats.avgKd : '-'}</td>
                                <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => handleUndoMergeParent(ruleRow.ruleId)}
                                    className="w-4 h-4 flex items-center justify-center rounded-full bg-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white transition-colors"
                                    title="Unmerge parent"
                                  >
                                    <span className="text-[10px] font-bold">↩</span>
                                  </button>
                                </td>
                              </tr>

                              {isExpanded && ruleRow.childTokens.map(childToken => {
                                const st = ruleRow.childStats[childToken];
                                return (
                                  <tr key={`${ruleRow.ruleId}::${childToken}`} className="hover:bg-zinc-50/30 transition-colors">
                                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                                        disabled
                                        checked={false}
                                      />
                                    </td>
                                    <td className="px-2 py-1 font-mono text-zinc-800">
                                      <div className="flex items-center gap-1 pl-4">
                                        <div className="w-3.5"></div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const newTokens = new Set(selectedTokens);
                                            if (newTokens.has(childToken)) newTokens.delete(childToken);
                                            else newTokens.add(childToken);
                                            setSelectedTokens(newTokens);
                                            setCurrentPage(1);
                                            if (newTokens.size > 0) switchTab('pages');
                                          }}
                                          className={`${selectedTokens.has(childToken) ? 'bg-purple-100 text-purple-700 font-semibold' : 'hover:text-indigo-600 hover:bg-indigo-50'} px-1 rounded transition-colors cursor-pointer`}
                                          title={tokenPagesTooltip(childToken)}
                                        >
                                          {childToken}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{st.frequency.toLocaleString()}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{st.totalVolume.toLocaleString()}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{st.avgKd !== null ? st.avgKd : '-'}</td>
                                    <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        onClick={() => handleUndoMergeChild(ruleRow.ruleId, childToken)}
                                        className="w-4 h-4 flex items-center justify-center rounded-full bg-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white transition-colors"
                                        title="Unmerge child"
                                      >
                                        <span className="text-[10px] font-bold">↩</span>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}

                        {paginatedMergeRuleRows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-400">
                              No merges found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : null}

                  {tokenMgmtSubTab === 'auto-merge' ? (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#f0f0f0]">
                        <tr>
                          <th
                            className="px-2 py-1.5 cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setAutoMergeSortConfig(prev => ({ key: 'canonical', direction: prev.key === 'canonical' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                          >
                            <div className="flex items-center gap-1">
                              Canonical
                              {autoMergeSortIcon('canonical')}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setAutoMergeSortConfig(prev => ({ key: 'mergeTokens', direction: prev.key === 'mergeTokens' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                          >
                            <div className="flex items-center gap-1">
                              Merge Tokens
                              {autoMergeSortIcon('mergeTokens')}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setAutoMergeSortConfig(prev => ({ key: 'impact', direction: prev.key === 'impact' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Impact
                              {autoMergeSortIcon('impact')}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setAutoMergeSortConfig(prev => ({ key: 'confidence', direction: prev.key === 'confidence' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Conf.
                              {autoMergeSortIcon('confidence')}
                            </div>
                          </th>
                          <th
                            className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                            onClick={() => setAutoMergeSortConfig(prev => ({ key: 'status', direction: prev.key === 'status' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Status
                              {autoMergeSortIcon('status')}
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 [&>tr:nth-child(even)]:bg-zinc-50/60">
                        {paginatedAutoMergeRows.map((rec) => {
                          const mergeRule = tokenMergeRules.find(r => r.recommendationId === rec.id);
                          return (
                            <tr key={rec.id} className="hover:bg-zinc-50/50 transition-colors">
                              <td className="px-2 py-1.5 font-mono text-zinc-800" title={tokenPagesTooltip(rec.canonicalToken)}>{rec.canonicalToken}</td>
                              <td className="px-2 py-1.5 text-zinc-700">
                                <div className="flex flex-wrap gap-1">
                                  {rec.mergeTokens.map(t => (
                                    <span key={t} className="px-1.5 py-px rounded bg-zinc-100 text-zinc-700 font-mono" title={tokenPagesTooltip(t)}>{t}</span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">
                                {rec.affectedKeywordCount.toLocaleString()} kws · {rec.affectedPageCount.toLocaleString()} pages
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                <span
                                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                    rec.confidence >= 0.999
                                      ? 'bg-emerald-600 text-white'
                                      : rec.confidence >= 0.95
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : rec.confidence >= 0.85
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {Math.round(rec.confidence * 100)}%
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {rec.status === 'pending' ? (
                                    <>
                                      <button
                                        onClick={() => applyAutoMergeRecommendation(rec.id)}
                                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700"
                                      >
                                        Merge
                                      </button>
                                      <button
                                        onClick={() => declineAutoMergeRecommendation(rec.id)}
                                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                                      >
                                        Decline
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => undoAutoMergeRecommendation(rec.id)}
                                      disabled={!mergeRule}
                                      className="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                      Undo
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {paginatedAutoMergeRows.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-400">
                              No auto-merge recommendations
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : null}

                  {tokenMgmtSubTab !== 'merge' && tokenMgmtSubTab !== 'auto-merge' && (
                    <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#f0f0f0]">
                      <tr>
                        <th className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                            checked={paginatedMgmtTokens.length > 0 && paginatedMgmtTokens.every(t => selectedMgmtTokens.has(t.token))}
                            onChange={(e) => {
                              const newSelected = new Set(selectedMgmtTokens);
                              if (e.target.checked) {
                                paginatedMgmtTokens.forEach(t => newSelected.add(t.token));
                              } else {
                                paginatedMgmtTokens.forEach(t => newSelected.delete(t.token));
                              }
                              setSelectedMgmtTokens(newSelected);
                            }}
                          />
                        </th>
                        <th
                          className="px-2 py-1.5 cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => setTokenMgmtSort(prev => ({ key: 'token', direction: prev.key === 'token' && prev.direction === 'asc' ? 'desc' : 'asc' }))}
                        >
                          <div className="flex items-center gap-1">
                            Token
                            {tokenMgmtSort.key === 'token' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </th>
                        <th
                          className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => setTokenMgmtSort(prev => ({ key: 'frequency', direction: prev.key === 'frequency' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                        >
                          <div className="flex items-center justify-end gap-1">
                            KWs
                            {tokenMgmtSort.key === 'frequency' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </th>
                        <th
                          className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => setTokenMgmtSort(prev => ({ key: 'totalVolume', direction: prev.key === 'totalVolume' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                        >
                          <div className="flex items-center justify-end gap-1">
                            Vol.
                            {tokenMgmtSort.key === 'totalVolume' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </th>
                        <th
                          className="px-2 py-1.5 text-right cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => setTokenMgmtSort(prev => ({ key: 'avgKd', direction: prev.key === 'avgKd' && prev.direction === 'desc' ? 'asc' : 'desc' }))}
                        >
                          <div className="flex items-center justify-end gap-1">
                            KD
                            {tokenMgmtSort.key === 'avgKd' && (tokenMgmtSort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                          </div>
                        </th>
                        {tokenMgmtSubTab !== 'blocked' && (
                          <th className="px-1 py-1.5 w-6"></th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 [&>tr:nth-child(even)]:bg-zinc-50/60">
                      {paginatedMgmtTokens.map((row) => (
                        <tr
                          key={row.token}
                          className={`hover:bg-zinc-50/50 transition-colors cursor-pointer ${selectedMgmtTokens.has(row.token) ? 'bg-indigo-50/50' : ''} ${tokenMgmtSubTab === 'blocked' ? 'bg-red-50/30' : ''}`}
                          onClick={() => {
                            const newSelected = new Set(selectedMgmtTokens);
                            if (newSelected.has(row.token)) newSelected.delete(row.token);
                            else newSelected.add(row.token);
                            setSelectedMgmtTokens(newSelected);
                          }}
                        >
                          <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                              checked={selectedMgmtTokens.has(row.token)}
                              onChange={() => {
                                const newSelected = new Set(selectedMgmtTokens);
                                if (newSelected.has(row.token)) newSelected.delete(row.token);
                                else newSelected.add(row.token);
                                setSelectedMgmtTokens(newSelected);
                              }}
                            />
                          </td>
                          {/* Star icon â€" add/remove from Universal Blocked list (only in blocked tab) */}
                          {tokenMgmtSubTab === 'blocked' && (
                            <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setUniversalBlockedTokens(prev => {
                                    const next = new Set(prev);
                                    if (next.has(row.token)) next.delete(row.token);
                                    else next.add(row.token);
                                    return next;
                                  });
                                }}
                                className={`p-0.5 transition-colors ${universalBlockedTokens.has(row.token) ? 'text-amber-500 hover:text-amber-600' : 'text-zinc-300 hover:text-amber-400'}`}
                                title={universalBlockedTokens.has(row.token) ? 'Remove from Universal Blocked' : 'Add to Universal Blocked'}
                              >
                                {universalBlockedTokens.has(row.token) ? <Star className="w-3.5 h-3.5 fill-current" /> : <Star className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          )}
                          <td className="px-2 py-1 font-mono text-zinc-800">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newTokens = new Set(selectedTokens);
                                if (newTokens.has(row.token)) newTokens.delete(row.token);
                                else newTokens.add(row.token);
                                setSelectedTokens(newTokens);
                                setCurrentPage(1);
                                if (newTokens.size > 0) switchTab('pages');
                              }}
                              className={`${selectedTokens.has(row.token) ? 'bg-purple-100 text-purple-700 font-semibold' : 'hover:text-indigo-600 hover:bg-indigo-50'} px-1 rounded transition-colors cursor-pointer`}
                              title={tokenPagesTooltip(row.token)}
                            >
                              {row.token}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.frequency.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.totalVolume.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.avgKd !== null ? row.avgKd : '-'}</td>
                          {/* Block button â€" small red circle, only on non-blocked tabs */}
                          {tokenMgmtSubTab !== 'blocked' && (
                            <td className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => handleBlockTokens([row.token])}
                                className="w-4 h-4 flex items-center justify-center rounded-full bg-red-100 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                                title="Block this token"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {paginatedMgmtTokens.length === 0 && (
                        <tr><td colSpan={tokenMgmtSubTab === 'blocked' ? 6 : 6} className="px-4 py-8 text-center text-xs text-zinc-400">
                          {tokenMgmtSubTab === 'blocked' ? 'No blocked tokens' : 'No tokens found'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                  )}
                </div>

                <div className="px-3 py-2 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between shrink-0">
                  <span className="text-[10px] text-zinc-500">
                    {tokenMgmtSubTab === 'merge'
                      ? `${filteredMergeRuleRows.length.toLocaleString()} parents`
                      : tokenMgmtSubTab === 'auto-merge'
                        ? `${autoMergeRows.length.toLocaleString()} recommendations`
                      : `${filteredMgmtTokens.length.toLocaleString()} tokens`}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTokenMgmtPage(p => Math.max(1, p - 1))}
                      disabled={tokenMgmtSubTab === 'merge' ? safeMergeMgmtPage <= 1 : tokenMgmtSubTab === 'auto-merge' ? safeAutoMergePage <= 1 : safeMgmtPage <= 1}
                      className="px-2 py-0.5 text-[10px] font-medium rounded border border-zinc-300 bg-white text-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 transition-colors"
                    >
                      Prev
                    </button>
                    <span className="text-[10px] text-zinc-600">
                      {tokenMgmtSubTab === 'merge'
                        ? `${safeMergeMgmtPage}/${mergeMgmtTotalPages}`
                        : tokenMgmtSubTab === 'auto-merge'
                          ? `${safeAutoMergePage}/${autoMergeTotalPages}`
                        : `${safeMgmtPage}/${tokenMgmtTotalPages}`}
                    </span>
                    <button
                      onClick={() =>
                        setTokenMgmtPage(p => {
                          const max = tokenMgmtSubTab === 'merge'
                            ? mergeMgmtTotalPages
                            : tokenMgmtSubTab === 'auto-merge'
                              ? autoMergeTotalPages
                              : tokenMgmtTotalPages;
                          return Math.min(max, p + 1);
                        })
                      }
                      disabled={tokenMgmtSubTab === 'merge' ? safeMergeMgmtPage >= mergeMgmtTotalPages : tokenMgmtSubTab === 'auto-merge' ? safeAutoMergePage >= autoMergeTotalPages : safeMgmtPage >= tokenMgmtTotalPages}
                      className="px-2 py-0.5 text-[10px] font-medium rounded border border-zinc-300 bg-white text-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
              {/* End Token Management Panel */}

            </div>
            {/* End flex wrapper */}

          </div>
        )}
        </>
        )}
        {/* End groupSubTab === 'data' */}
        </>
        )}

        {mainTab === 'group' && groupSubTab === 'projects' && (
          <ProjectsTab
            projects={projects}
            setProjects={setProjects}
            activeProjectId={activeProjectId}
            selectProject={selectProject}
            deleteProject={deleteProject}
            reviveProject={reviveProject}
            permanentlyDeleteProject={permanentlyDeleteProject}
            createProject={createProject}
            isCreatingProject={isCreatingProject}
            setIsCreatingProject={setIsCreatingProject}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            newProjectDescription={newProjectDescription}
            setNewProjectDescription={setNewProjectDescription}
            projectError={projectError}
            isProjectLoading={isProjectLoading}
            addToast={addToast}
          />
        )}

        {/* Settings sub-tab â€" Universal Blocked Tokens */}
        {mainTab === 'group' && groupSubTab === 'settings' && (
          <div className="bg-white rounded-2xl border border-zinc-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Settings header with sub-tabs */}
            <div className="px-6 py-4 border-b border-zinc-100">
              <h2 className="text-base font-semibold text-zinc-900 mb-3">Settings</h2>
              <div className={`${tabRailClass} w-fit`}>
                <button type="button" onClick={() => navigateSettingsSub('general')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'general' ? subTabBtnActive : subTabBtnInactive}`}>
                  General
                </button>
                <button type="button" onClick={() => navigateSettingsSub('how-it-works')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'how-it-works' ? subTabBtnActive : subTabBtnInactive}`}>
                  How it Works
                </button>
                <button type="button" onClick={() => navigateSettingsSub('dictionaries')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'dictionaries' ? subTabBtnActive : subTabBtnInactive}`}>
                  Dictionaries
                </button>
                <button type="button" onClick={() => navigateSettingsSub('blocked')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'blocked' ? subTabBtnActive : subTabBtnInactive}`}>
                  Universal Blocked {universalBlockedTokens.size > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({universalBlockedTokens.size})</span>}
                </button>
              </div>
            </div>

            {/* Settings > General */}
            {settingsSubTab === 'general' && (
              <div className="p-6">
                <p className="text-sm text-zinc-400">General settings coming soon. Group Review settings are available via the gear icon in Pages (Grouped).</p>
              </div>
            )}

            {/* Settings > Universal Blocked */}
            {settingsSubTab === 'blocked' && (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-800">Universal Blocked Tokens</h3>
                    <p className="text-xs text-zinc-400 mt-0.5">Automatically blocked across ALL projects during CSV processing.</p>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 rounded-md">{universalBlockedTokens.size} tokens</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Type token and press Enter..."
                    className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const input = e.currentTarget;
                        const val = input.value.toLowerCase().trim();
                        if (!val) return;
                        setUniversalBlockedTokens(prev => new Set([...prev, val]));
                        input.value = '';
                      }
                    }}
                  />
                  {universalBlockedTokens.size > 0 && (
                    <button
                      onClick={() => { if (confirm('Remove all universally blocked tokens?')) setUniversalBlockedTokens(new Set()); }}
                      className="px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                {universalBlockedTokens.size > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-[400px] overflow-y-auto p-3 bg-zinc-50/50 rounded-lg border border-zinc-100">
                    {Array.from(universalBlockedTokens).sort().map(token => (
                      <span key={token} className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded-md text-xs font-medium">
                        {token}
                        <button onClick={() => setUniversalBlockedTokens(prev => { const next = new Set(prev); next.delete(token); return next; })} className="text-red-300 hover:text-red-500 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-zinc-400 bg-zinc-50/50 rounded-lg border border-zinc-100">
                    No universally blocked tokens. Add tokens above or star them in Token Management â†' Blocked tab.
                  </div>
                )}
              </div>
            )}

            {/* Settings > How it Works */}
            {settingsSubTab === 'how-it-works' && (
              <div className="p-6 space-y-6 text-zinc-600 leading-relaxed">
                <p className="text-sm">The tool processes keywords through a 4-step pipeline to group semantically identical phrases together.</p>
                <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-zinc-900 mb-2">1. Normalization</h3>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs">
                    <li><strong>Lowercase:</strong> All keywords converted to lowercase.</li>
                    <li><strong>State Names:</strong> Full names â†' 2-letter abbreviations (e.g., "california" â†' "ca").</li>
                    <li><strong>Synonyms:</strong> Common synonyms mapped to a base word (e.g., "cheap" â†' "affordable").</li>
                    <li><strong>Numbers:</strong> Spelled-out numbers â†' digits (e.g., "one" â†' "1").</li>
                  </ul>
                </div>
                <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-zinc-900 mb-2">2. Tokenization & Filtering</h3>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs">
                    <li><strong>Splitting:</strong> Keywords split into individual tokens.</li>
                    <li><strong>Stop Words:</strong> Common words removed (e.g., "a", "the", "is").</li>
                    <li><strong>Ignored Tokens:</strong> Low-value words removed (e.g., "near", "me").</li>
                  </ul>
                </div>
                <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-zinc-900 mb-2">3. Singularization & Sorting</h3>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs">
                    <li><strong>Singularization:</strong> Plurals â†' singular ("shoes" â†' "shoe").</li>
                    <li><strong>Sorting:</strong> Tokens sorted alphabetically so "shoe red" = "red shoe".</li>
                  </ul>
                </div>
                <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-zinc-900 mb-2">4. Clustering & Page Name Selection</h3>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs">
                    <li><strong>Grouping:</strong> Keywords with the same signature form one cluster.</li>
                    <li><strong>Page Name:</strong> Highest search volume keyword becomes the representative name.</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Settings > Dictionaries */}
            {settingsSubTab === 'dictionaries' && (
              <div className="p-6 space-y-6">
                {/* Label Detection Rules */}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 mb-3">Label Detection Rules</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5">
                        <InlineHelpHint
                          text="Question intent / FAQ keyword matches (examples: who, what, where, when, why, how, can, vs., compare, which, etc.)."
                          className="inline-flex items-center cursor-help"
                        >
                          <HelpCircle className="w-3.5 h-3.5 text-purple-500" />
                        </InlineHelpHint>
                        FAQ / Question
                      </h4>
                      <code className="text-[10px] bg-white border border-zinc-100 text-zinc-600 p-1.5 rounded block break-all">\b(who|what|where|when|why|how|can|vs\.?|compare|is|are|do|does|will|would|should|could|which)\b/i</code>
                    </div>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5"><ShoppingCart className="w-3.5 h-3.5 text-emerald-500" />Commercial</h4>
                      <code className="text-[10px] bg-white border border-zinc-100 text-zinc-600 p-1.5 rounded block break-all">\b(buy|price|cost|cheap|best|review|discount|coupon|sale|order|hire|service|services)\b/i</code>
                    </div>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-amber-500" />Local</h4>
                      <code className="text-[10px] bg-white border border-zinc-100 text-zinc-600 p-1.5 rounded block break-all">\b(near me|nearby|close to)\b/i</code>
                    </div>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-rose-500" />Year / Time</h4>
                      <code className="text-[10px] bg-white border border-zinc-100 text-zinc-600 p-1.5 rounded block break-all">\b(202\d|201\d)\b/i</code>
                    </div>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5 text-blue-500" />Informational</h4>
                      <code className="text-[10px] bg-white border border-zinc-100 text-zinc-600 p-1.5 rounded block break-all">\b(guide|tutorial|tips|examples|meaning|definition|learn|course|training)\b/i</code>
                    </div>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5"><Navigation className="w-3.5 h-3.5 text-indigo-500" />Navigational</h4>
                      <code className="text-[10px] bg-white border border-zinc-100 text-zinc-600 p-1.5 rounded block break-all">\b(login|sign in|contact|support|phone number|address|customer service|account)\b/i</code>
                    </div>
                  </div>
                </div>

                {/* Dictionary tables */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>Stop Words</h4>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-3 max-h-48 overflow-y-auto flex flex-wrap gap-1">
                      {Array.from(stopWords).sort().map(w => <span key={w} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[10px] text-zinc-500">{w}</span>)}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>Ignored Tokens</h4>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-3 max-h-48 overflow-y-auto flex flex-wrap gap-1">
                      {Array.from(ignoredTokens).sort().map(w => <span key={w} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[10px] text-zinc-500">{w}</span>)}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>Synonym Mapping</h4>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl max-h-48 overflow-y-auto">
                      <table className="w-full text-[10px]">
                        <thead className="bg-zinc-100/50 sticky top-0"><tr><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Word</th><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Maps To</th></tr></thead>
                        <tbody className="divide-y divide-zinc-100">{Object.entries(synonymMap).map(([w, r]) => <tr key={w}><td className="px-3 py-1 text-zinc-500">{w}</td><td className="px-3 py-1 text-zinc-800 font-medium">{r}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>State Normalization</h4>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl max-h-48 overflow-y-auto">
                      <table className="w-full text-[10px]">
                        <thead className="bg-zinc-100/50 sticky top-0"><tr><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Full Name</th><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Abbr</th></tr></thead>
                        <tbody className="divide-y divide-zinc-100">{Object.entries(stateMap).map(([s, a]) => <tr key={s}><td className="px-3 py-1 text-zinc-500 capitalize">{s}</td><td className="px-3 py-1 text-zinc-800 font-medium uppercase">{a}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Number Normalization</h4>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl max-h-48 overflow-y-auto">
                      <table className="w-full text-[10px]">
                        <thead className="bg-zinc-100/50 sticky top-0"><tr><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Word</th><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Digit</th></tr></thead>
                        <tbody className="divide-y divide-zinc-100">{Object.entries(numberMap).map(([w, d]) => <tr key={w}><td className="px-3 py-1 text-zinc-500">{w}</td><td className="px-3 py-1 text-zinc-800 font-medium">{d}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Countries (Removed)</h4>
                    <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-3 max-h-48 overflow-y-auto flex flex-wrap gap-1">
                      {Array.from(countries).sort().map(w => <span key={w} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[10px] text-zinc-500 capitalize">{w}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Activity Log sub-tab */}
        {mainTab === 'group' && groupSubTab === 'log' && (
          <div className="max-w-4xl mx-auto mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <ActivityLog
              entries={activityLog}
              onClear={() => {
                persistence.clearActivityLog();
                addToast('Activity log cleared', 'info');
              }}
            />
          </div>
        )}

        {mainTab === 'group' && groupSubTab === 'topics' && (
          <div className="max-w-6xl mx-auto mt-4">
            <TopicsSubTab />
          </div>
        )}

        {mainTab === 'feedback' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <FeedbackTab />
          </div>
        )}

        {mainTab === 'feature-ideas' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <FeatureIdeasTab />
          </div>
        )}

        {mainTab === 'notifications' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <NotificationsTab />
          </div>
        )}

        {mainTab === 'updates' && (
          <div className="max-w-4xl mx-auto mt-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <UpdatesTab />
          </div>
        )}

        {/* GenerateTab stays mounted always — prevents generation from stopping when switching tabs */}
        <div style={mainTab === 'generate' ? undefined : { display: 'none' }}>
          <ErrorBoundary fallbackLabel="The Generate tab encountered an error. Your data has been saved.">
            <GenerateTab
              activeProjectId={activeProjectId}
              starredModels={starredModels}
              onToggleStar={toggleStarModel}
              onBusyStateChange={setIsGenerateBusy}
            />
          </ErrorBoundary>
        </div>

        {/* ContentTab stays mounted always — prevents generation from stopping when switching tabs */}
        <div style={mainTab === 'content' ? undefined : { display: 'none' }}>
          <ErrorBoundary fallbackLabel="The Content tab encountered an error. Your data has been saved.">
            <ContentTab
              activeProjectId={activeProjectId}
              starredModels={starredModels}
              onToggleStar={toggleStarModel}
              onBusyStateChange={setIsContentBusy}
            />
          </ErrorBoundary>
        </div>

        {/* How it Works â€" now inside Settings, kept here for backward compat rendering */}

        {/* Dictionaries content moved to Settings > Dictionaries sub-tab */}
        {mainTab === '__legacy_rules__' ? (
          <div className="space-y-8">
            <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">Label Detection Rules (OLD - REMOVED)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                    <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                      <InlineHelpHint
                        text="Question intent / FAQ keyword matches (examples: who, what, where, when, why, how, can, vs., compare, which, etc.)."
                        className="inline-flex items-center cursor-help"
                      >
                        <HelpCircle className="w-4 h-4 text-purple-500" />
                      </InlineHelpHint>
                      FAQ / Question
                    </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(who|what|where|when|why|how|can|vs\.?|compare|is|are|do|does|will|would|should|could|which)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-emerald-500" />
                    Commercial / Transactional
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(buy|price|cost|cheap|best|review|discount|coupon|sale|order|hire|service|services)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-amber-500" />
                    Local / Proximity
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(near me|nearby|close to)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-rose-500" />
                    Year / Time
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(202\d|201\d)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-500" />
                    Informational / Learning
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(guide|tutorial|tips|examples|meaning|definition|learn|course|training)\b/i
                  </code>
                </div>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-indigo-500" />
                    Navigational / Brand
                  </h4>
                  <code className="text-xs bg-white border border-zinc-200 text-zinc-700 p-2 rounded block break-all">
                    \b(login|sign in|contact|support|phone number|address|customer service|account)\b/i
                  </code>
                </div>
              </div>
            </div>

            <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">Dictionaries & Logic Rules</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Stop Words (Removed)
                </h3>
                <p className="text-sm text-zinc-500 mb-3">These common words are completely removed from the keyword before clustering.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 max-h-64 overflow-y-auto flex flex-wrap gap-2">
                  {Array.from(stopWords).sort().map(word => (
                    <span key={word} className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-xs text-zinc-600">{word}</span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                  Ignored Tokens (Removed)
                </h3>
                <p className="text-sm text-zinc-500 mb-3">These words are treated like stop words because they don't impact core semantic meaning.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 max-h-64 overflow-y-auto flex flex-wrap gap-2">
                  {Array.from(ignoredTokens).sort().map(word => (
                    <span key={word} className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-xs text-zinc-600">{word}</span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                  Synonym Mapping
                </h3>
                <p className="text-sm text-zinc-500 mb-3">Words with identical intent are mapped to a single base word.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-0 max-h-64 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium text-zinc-600">Word</th>
                        <th className="px-4 py-2 font-medium text-zinc-600">Maps To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {Object.entries(synonymMap).map(([word, replacement]) => (
                        <tr key={word}>
                          <td className="px-4 py-2 text-zinc-600">{word}</td>
                          <td className="px-4 py-2 text-zinc-900 font-medium">{replacement}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  State Normalization
                </h3>
                <p className="text-sm text-zinc-500 mb-3">Full state names are converted to their 2-letter abbreviations.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-0 max-h-64 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium text-zinc-600">Full Name</th>
                        <th className="px-4 py-2 font-medium text-zinc-600">Maps To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {Object.entries(stateMap).map(([state, abbr]) => (
                        <tr key={state}>
                          <td className="px-4 py-2 text-zinc-600 capitalize">{state}</td>
                          <td className="px-4 py-2 text-zinc-900 font-medium uppercase">{abbr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Number Normalization
                </h3>
                <p className="text-sm text-zinc-500 mb-3">Spelled-out numbers are converted to digits.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-0 max-h-64 overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 font-medium text-zinc-600">Word</th>
                        <th className="px-4 py-2 font-medium text-zinc-600">Maps To</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {Object.entries(numberMap).map(([word, digit]) => (
                        <tr key={word}>
                          <td className="px-4 py-2 text-zinc-600">{word}</td>
                          <td className="px-4 py-2 text-zinc-900 font-medium">{digit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-zinc-900 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  Countries
                </h3>
                <p className="text-sm text-zinc-500 mb-3">These countries are removed from the core keyword signature.</p>
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 max-h-64 overflow-y-auto flex flex-wrap gap-2">
                  {Array.from(countries).sort().map(word => (
                    <span key={word} className="px-2 py-1 bg-white border border-zinc-200 rounded-md text-xs text-zinc-600 capitalize">{word}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        ) : null}

        {/* Saved Clusters removed */}

        {/* Merge Confirm Modal */}
        {isMergeModalOpen && tokenSummary && (
          <MergeConfirmModal
            isOpen={isMergeModalOpen}
            tokens={mergeModalTokens}
            tokenSummary={tokenSummary}
            impact={results && clusterSummary ? computeMergeImpact(results, groupedClusters, approvedGroups, mergeModalTokens[0], mergeModalTokens.slice(1)) : { pagesAffected: 0, groupsAffected: 0, approvedGroupsAffected: 0, pageCollisions: 0 }}
            universalBlockedTokens={universalBlockedTokens}
            onConfirm={handleMergeTokens}
            onCancel={() => { setIsMergeModalOpen(false); setMergeModalTokens([]); }}
          />
        )}
      </div>
    </div>
  );
}


