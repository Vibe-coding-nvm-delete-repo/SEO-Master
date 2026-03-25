import React, { useState, useCallback, useMemo, useEffect, useTransition, useRef } from 'react';
import Papa from 'papaparse';
import pluralize from 'pluralize';
import { UploadCloud, Download, FileText, Loader2, AlertCircle, RefreshCw, Database, CheckCircle2, Layers, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Hash, TrendingUp, MapPin, Map as MapIcon, HelpCircle, ShoppingCart, Navigation, Calendar, Filter, BookOpen, Compass, LogIn, LogOut, Save, Bookmark, Sparkles, X, Plus, Folder, Trash2, Lock, Settings, Star, ExternalLink, Copy, Zap, Globe, ClipboardList, Cloud, CloudOff } from 'lucide-react';
import { numberMap, stateMap, stateAbbrToFull, stateFullNames, stopWords, ignoredTokens, synonymMap, countries, misspellingMap } from './dictionaries';
import { citySet, cityFirstWords, stateSet, stateRegex, capitalizeWords, normalizeState, detectForeignEntity, synonymRegex, multiWordLocationsRegex, pluralizeCache, misspellingRegex, prefixPattern, localIntentRegex, stem, getLabelColor } from './processing';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDoc, getDocFromServer, addDoc, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';
import GenerateTab from './GenerateTab';
import GroupReviewSettings, { type GroupReviewSettingsRef, type GroupReviewSettingsData } from './GroupReviewSettings';
import { processReviewQueue, type ReviewRequest, type ReviewResult, type ReviewError } from './GroupReviewEngine';
import type { ProcessedRow, Cluster, ClusterSummary, TokenSummary, GroupedCluster, BlockedKeyword, LabelSection, Project, Stats, ActivityLogEntry, ActivityAction, TokenMergeRule, AutoGroupSuggestion } from './types';
import { executeMergeCascade, computeMergeImpact, applyMergeRulesToTokenArr, rebuildClusters as rebuildClustersFromRows, rebuildTokenSummary as rebuildTokenSummaryFromRows } from './tokenMerge';
import MergeConfirmModal from './MergeConfirmModal';
import { useToast } from './ToastContext';
import ActivityLog from './ActivityLog';
import AutoGroupPanel from './AutoGroupPanel';
import TableHeader, { type FilterBag } from './TableHeader';
import { PAGES_COLUMNS, GROUPED_COLUMNS, APPROVED_COLUMNS, KEYWORDS_COLUMNS, BLOCKED_COLUMNS } from './tableConstants';

// Error boundary — catches any unhandled React error and shows recovery UI instead of white screen
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

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const KeywordRow = React.memo(({ row, selectedTokens, setSelectedTokens, setCurrentPage, labelColorMap }: {
  row: ProcessedRow;
  selectedTokens: Set<string>;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
  labelColorMap: Map<string, { border: string; bg: string; text: string; sectionName: string }>;
}) => (
  <tr className="hover:bg-zinc-50/50 transition-colors">
    <td className="px-3 py-0.5 text-[12px] font-medium text-zinc-700 break-words">{row.pageName}</td>
    <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs overflow-hidden">
      <div className="flex flex-wrap gap-1">
        {row.tokenArr.map((token, i) => {
          const labelColor = labelColorMap.get(token);
          return (
          <button
            key={i}
            onClick={() => {
              const newTokens = new Set(selectedTokens);
              if (newTokens.has(token)) newTokens.delete(token);
              else newTokens.add(token);
              setSelectedTokens(newTokens);
              setCurrentPage(1);
            }}
            className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
            style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
            title={labelColor ? `Label: ${labelColor.sectionName}` : undefined}
          >
            {token}
          </button>
          );
        })}
      </div>
    </td>
    <td className="px-1 py-0.5 text-zinc-500 text-right tabular-nums text-[12px]">{row.pageNameLen}</td>
    <td className="px-2 py-0.5 text-zinc-700">{row.keyword}</td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.searchVolume.toLocaleString()}
    </td>
    <td className="px-1 py-0.5 text-zinc-600 text-right tabular-nums text-[12px]">
      {row.kd !== null ? row.kd : '-'}
    </td>
    <td className="px-3 py-0.5 text-zinc-600">{row.label}</td>
    <td className="px-3 py-0.5 text-zinc-600">{row.locationCity || '-'}</td>
    <td className="px-3 py-0.5 text-zinc-600">{row.locationState || '-'}</td>
  </tr>
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
  saveCluster,
  generateBrief,
  briefLoading,
  brief,
  labelColorMap
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
  saveCluster: (c: ClusterSummary) => void;
  generateBrief: (c: ClusterSummary) => void;
  briefLoading: string | null;
  brief: string | null;
  labelColorMap: Map<string, { border: string; bg: string; text: string; sectionName: string }>;
}) => (
  <>
    <tr 
      className="hover:bg-zinc-50/50 transition-colors cursor-pointer"
      onClick={() => toggleCluster(row.pageName)}
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
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
          )}
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
                const newTokens = new Set(selectedTokens);
                if (newTokens.has(token)) newTokens.delete(token);
                else newTokens.add(token);
                setSelectedTokens(newTokens);
                setCurrentPage(1);
              }}
              className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
              style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
              title={labelColor ? `Label: ${labelColor.sectionName}` : undefined}
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
    {isExpanded && (
      <tr className="bg-zinc-100/50 border-b border-zinc-200">
        <td colSpan={10} className="px-8 py-3">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-zinc-900">Keywords in Cluster</h4>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => saveCluster(row)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors shadow-sm"
              >
                <Bookmark className="w-3.5 h-3.5" />
                Save Cluster
              </button>
              <button 
                onClick={() => generateBrief(row)}
                disabled={briefLoading === row.pageName}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors shadow-sm disabled:opacity-50"
              >
                {briefLoading === row.pageName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Generate AI Brief
              </button>
            </div>
          </div>
          
          {brief && (
            <div className="mb-4 p-4 bg-white border border-indigo-100 rounded-lg shadow-sm">
              <h5 className="text-sm font-semibold text-indigo-900 mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                AI Content Brief
              </h5>
              <div className="text-sm text-zinc-700 whitespace-pre-wrap font-sans">
                {brief}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
            {row.keywords.map((kw, i) => (
              <div key={i} className="flex justify-between items-center text-sm border-b border-zinc-200/50 pb-1 last:border-0">
                <span className="text-zinc-600 truncate mr-4" title={kw.keyword}>{kw.keyword}</span>
                <div className="flex items-center gap-3 shrink-0">
                  {kw.kd !== null && <span className="text-xs text-zinc-400 font-medium">KD: {kw.kd}</span>}
                  <span className="text-zinc-500 tabular-nums">{kw.volume.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </td>
      </tr>
    )}
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
  groupActionButton
}: {
  row: GroupedCluster;
  isExpanded: boolean;
  expandedSubClusters: Set<string>;
  toggleGroup: (id: string) => void;
  toggleSubCluster: (id: string) => void;
  selectedTokens: Set<string>;
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
      className="hover:bg-zinc-50/50 transition-colors cursor-pointer"
      onClick={() => toggleGroup(row.id)}
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
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
          )}
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
                    const newTokens = new Set(selectedTokens);
                    if (newTokens.has(token)) newTokens.delete(token);
                    else newTokens.add(token);
                    setSelectedTokens(newTokens);
                    setCurrentPage(1);
                  }}
                  className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
                  style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
                  title={labelColor ? `Label: ${labelColor.sectionName}` : undefined}
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
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title={row.reviewReason || 'All pages match'}>✓</span>
        ) : row.reviewStatus === 'mismatch' ? (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 cursor-help" title={`Mismatched: ${(row.reviewMismatchedPages || []).join(', ')}\n${row.reviewReason || ''}`}>✗</span>
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
    {isExpanded && row.clusters.map((cluster, cIdx) => {
      const subId = `${row.id}-${cluster.pageName}`;
      const isSubExpanded = expandedSubClusters.has(subId);
      return (
        <React.Fragment key={cIdx}>
          <tr 
            className="bg-indigo-50/40 hover:bg-indigo-50/70 transition-colors cursor-pointer border-b border-zinc-100"
            onClick={() => toggleSubCluster(subId)}
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
                {isSubExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
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
                      const newTokens = new Set(selectedTokens);
                      if (newTokens.has(token)) newTokens.delete(token);
                      else newTokens.add(token);
                      setSelectedTokens(newTokens);
                      setCurrentPage(1);
                    }}
                    className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[12px] transition-colors`}
                    style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
                    title={labelColor ? `Label: ${labelColor.sectionName}` : undefined}
                  >
                    {token}
                  </button>
                  );
                })}
              </div>
            </td>
            {/* Sub-cluster review status — red dot if this page is flagged as mismatched */}
            <td className="px-1.5 py-0.5 text-center">
              {row.reviewMismatchedPages?.includes(cluster.pageName) ? (
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Flagged as mismatched" />
              ) : row.reviewStatus === 'approve' ? (
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" title="Matches group" />
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
            <td className="px-3 py-0.5 text-zinc-600">{cluster.label}</td>
            <td className="px-3 py-0.5 text-zinc-600">{cluster.locationCity || '-'}</td>
            <td className="px-3 py-0.5 text-zinc-600">{cluster.locationState || '-'}</td>
          </tr>
          {isSubExpanded && (
            <tr className="bg-zinc-100/50 border-b border-zinc-200">
              <td colSpan={11} className="px-12 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1">
                  {cluster.keywords.map((kw, i) => (
                    <div key={i} className="flex justify-between items-center text-sm border-b border-zinc-200/50 pb-1 last:border-0">
                      <span className="text-zinc-600 truncate mr-4" title={kw.keyword}>{kw.keyword}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        {kw.kd !== null && <span className="text-xs text-zinc-400 font-medium">KD: {kw.kd}</span>}
                        <span className="text-zinc-500 tabular-nums">{kw.volume.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    })}
  </>
));

export default function App() {
  const [mainTab, setMainTab] = useState<'group' | 'generate'>('group');
  const [groupSubTab, setGroupSubTab] = useState<'data' | 'projects' | 'settings' | 'log'>('data');
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'how-it-works' | 'dictionaries' | 'blocked'>('general');

  // Starred models — shared across Generate tab and Group Review
  const [starredModels, setStarredModels] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('kwg_starred_models');
      if (saved) return new Set(JSON.parse(saved));
    } catch {}
    return new Set();
  });
  useEffect(() => {
    getDoc(doc(db, 'app_settings', 'starred_models')).then(snap => {
      if (snap.exists()) {
        const ids: string[] = snap.data()?.ids || [];
        setStarredModels(new Set(ids));
        try { localStorage.setItem('kwg_starred_models', JSON.stringify(ids)); } catch {}
      }
    }).catch(() => {});
  }, []);
  const toggleStarModel = useCallback((modelId: string) => {
    setStarredModels(prev => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      const arr = [...next];
      try { localStorage.setItem('kwg_starred_models', JSON.stringify(arr)); } catch {}
      setDoc(doc(db, 'app_settings', 'starred_models'), { ids: arr }).catch(() => {});
      return next;
    });
  }, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
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
  const [results, setResults] = useState<ProcessedRow[] | null>(null);
  const [clusterSummary, setClusterSummary] = useState<ClusterSummary[] | null>(null);
  const [tokenSummary, setTokenSummary] = useState<TokenSummary[] | null>(null);
  const [groupedClusters, setGroupedClusters] = useState<GroupedCluster[]>([]);
  const [blockedKeywords, setBlockedKeywords] = useState<BlockedKeyword[]>([]);
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set());
  const [groupNameInput, setGroupNameInput] = useState<string>('');
  const [expandedGroupedClusters, setExpandedGroupedClusters] = useState<Set<string>>(new Set());
  const [expandedGroupedSubClusters, setExpandedGroupedSubClusters] = useState<Set<string>>(new Set());
  // AI Group Review
  const [showGroupReviewSettings, setShowGroupReviewSettings] = useState(false);
  const groupReviewSettingsRef = useRef<GroupReviewSettingsRef>(null);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const reviewProcessingRef = useRef(false);
  // Debounced QA re-review — when pages are removed from groups, wait 5s then re-trigger QA
  const reReviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reReviewGroupIds = useRef<Set<string>>(new Set());
  // Ungrouping: track selected groups and sub-clusters within groups
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedSubClusters, setSelectedSubClusters] = useState<Set<string>>(new Set()); // key: "groupId::clusterTokens"
  const [stats, setStats] = useState<Stats | null>(null);
  const [datasetStats, setDatasetStats] = useState<{ cities: number, states: number, numbers: number, faqs: number, commercial: number, local: number, year: number, informational: number, navigational: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'pages' | 'grouped' | 'approved' | 'blocked' | 'auto-group'>('pages');
  const [approvedGroups, setApprovedGroups] = useState<GroupedCluster[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const activityLogRef = useRef(activityLog);
  // Cloud sync status: 'synced' | 'syncing' | 'error' | 'offline'
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'offline'>('synced');
  const lastSyncTimeRef = useRef<number>(0);
  useEffect(() => { activityLogRef.current = activityLog; }, [activityLog]);
  const [autoGroupSuggestions, setAutoGroupSuggestions] = useState<AutoGroupSuggestion[]>([]);
  const autoGroupSuggestionsRef = useRef(autoGroupSuggestions);
  useEffect(() => { autoGroupSuggestionsRef.current = autoGroupSuggestions; }, [autoGroupSuggestions]);
  const [tokenMergeRules, setTokenMergeRules] = useState<TokenMergeRule[]>([]);
  const tokenMergeRulesRef = useRef(tokenMergeRules);
  useEffect(() => { tokenMergeRulesRef.current = tokenMergeRules; }, [tokenMergeRules]);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [mergeModalTokens, setMergeModalTokens] = useState<string[]>([]);
  const { addToast } = useToast();
  const [, startTransition] = useTransition();
  const switchTab = useCallback((tab: typeof activeTab) => {
    startTransition(() => {
      setActiveTab(tab);
      setCurrentPage(1);
      // Clear selections when switching tabs to prevent stale selection counts
      setSelectedClusters(new Set());
      setSelectedGroups(new Set());
      setSelectedSubClusters(new Set());
    });
  }, []);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const setSearchImmediate = useCallback((value: string) => {
    setSearchQuery(value);
    startTransition(() => setDebouncedSearchQuery(value));
  }, []);
  const [minClusterCount, setMinClusterCount] = useState<string>('');
  const [maxClusterCount, setMaxClusterCount] = useState<string>('');
  const [minTokenLen, setMinTokenLen] = useState<string>('');
  const [maxTokenLen, setMaxTokenLen] = useState<string>('');
  const [excludedLabels, setExcludedLabels] = useState<Set<string>>(new Set());
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
  // Multi-sort: array of sort criteria applied in order (first = primary, second = secondary, etc.)
  const [sortConfig, setSortConfig] = useState<Array<{key: keyof ClusterSummary, direction: 'asc' | 'desc'}>>([{ key: 'totalVolume', direction: 'desc' }]);
  const [tokenSortConfig, setTokenSortConfig] = useState<{key: keyof TokenSummary, direction: 'asc' | 'desc'}>({ key: 'frequency', direction: 'desc' });
  const [groupedSortConfig, setGroupedSortConfig] = useState<Array<{key: string, direction: 'asc' | 'desc'}>>([{ key: 'keywordCount', direction: 'desc' }]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(500);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());

  // Column-level filters (static - only reset on full refresh)
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterState, setFilterState] = useState<string>('');
  const [minLen, setMinLen] = useState<string>('');
  const [maxLen, setMaxLen] = useState<string>('');
  const [minKwInCluster, setMinKwInCluster] = useState<string>('');
  const [maxKwInCluster, setMaxKwInCluster] = useState<string>('');
  const [minVolume, setMinVolume] = useState<string>('');
  const [maxVolume, setMaxVolume] = useState<string>('');
  const [minKd, setMinKd] = useState<string>('');
  const [maxKd, setMaxKd] = useState<string>('');

  // Token Management panel state
  const [tokenMgmtSearch, setTokenMgmtSearch] = useState('');
  const [tokenMgmtSort, setTokenMgmtSort] = useState<{ key: 'token' | 'totalVolume' | 'frequency' | 'avgKd', direction: 'asc' | 'desc' }>({ key: 'totalVolume', direction: 'desc' });
  const [selectedMgmtTokens, setSelectedMgmtTokens] = useState<Set<string>>(new Set());
  const [tokenMgmtPage, setTokenMgmtPage] = useState(1);
  const tokenMgmtPerPage = 100;
  const [tokenMgmtSubTab, setTokenMgmtSubTab] = useState<'current' | 'all' | 'blocked'>('current');
  const [blockedTokens, setBlockedTokens] = useState<Set<string>>(new Set());

  // Universal blocked tokens — persists across ALL projects (global, not project-specific)
  const [universalBlockedTokens, setUniversalBlockedTokens] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('kwg_universal_blocked');
      if (saved) return new Set<string>(JSON.parse(saved));
    } catch {}
    return new Set<string>();
  });

  // Persist universal blocked to localStorage + Firestore on every change
  const universalBlockedInitRef = useRef(true);
  useEffect(() => {
    if (universalBlockedInitRef.current) { universalBlockedInitRef.current = false; return; }
    const arr = Array.from(universalBlockedTokens);
    localStorage.setItem('kwg_universal_blocked', JSON.stringify(arr));
    setDoc(doc(db, 'app_settings', 'universal_blocked'), { tokens: arr, updatedAt: new Date().toISOString() }).catch(() => {});
  }, [universalBlockedTokens]);

  // Load universal blocked from Firestore on mount (fallback if localStorage is empty)
  useEffect(() => {
    if (universalBlockedTokens.size > 0) return; // Already loaded from localStorage
    getDoc(doc(db, 'app_settings', 'universal_blocked')).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data?.tokens?.length > 0) {
          setUniversalBlockedTokens(new Set<string>(data.tokens));
        }
      }
    }).catch(() => {});
  }, []);

  const [labelSections, setLabelSections] = useState<LabelSection[]>([]);
  const [isLabelSidebarOpen, setIsLabelSidebarOpen] = useState(true);
  const [labelSortConfigs, setLabelSortConfigs] = useState<Record<string, { key: 'token' | 'kws' | 'vol' | 'kd'; direction: 'asc' | 'desc' }>>({});

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [savedClusters, setSavedClusters] = useState<any[]>([]);
  const [briefLoading, setBriefLoading] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<Record<string, string>>({});

  // ============ Storage layer: localStorage for small data, IndexedDB for large project data ============
  const LS_PROJECTS_KEY = 'kwg_projects';
  const LS_SAVED_CLUSTERS_KEY = 'kwg_saved_clusters';
  const IDB_NAME = 'kwg_database';
  const IDB_STORE = 'project_data';
  const IDB_VERSION = 2;

  const loadFromLS = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  };
  const saveToLS = (key: string, data: any) => {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.warn('localStorage save error:', e); }
  };

  // IndexedDB helpers for large project data
  const openIDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'projectId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };

  const saveToIDB = async (projectId: string, data: any) => {
    try {
      // JSON round-trip to ensure clean, serializable plain objects
      const cleanData = JSON.parse(JSON.stringify(data));
      const record = { projectId, ...cleanData };
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const putRequest = tx.objectStore(IDB_STORE).put(record);
      putRequest.onerror = (e) => console.error('IndexedDB put error:', putRequest.error, e);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => { console.log('IndexedDB save SUCCESS for', projectId, 'keys:', Object.keys(cleanData), 'resultCount:', cleanData.results?.length); resolve(); };
        tx.onerror = () => { console.error('IndexedDB tx error:', tx.error); reject(tx.error); };
        tx.onabort = () => { console.error('IndexedDB tx ABORTED:', tx.error); reject(tx.error); };
      });
      db.close();
    } catch (e) {
      console.error('IndexedDB save error:', e);
    }
  };

  const loadFromIDB = async (projectId: string): Promise<any | null> => {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, 'readonly');
      const request = tx.objectStore(IDB_STORE).get(projectId);
      return new Promise((resolve, reject) => {
        request.onsuccess = () => { db.close(); resolve(request.result || null); };
        request.onerror = () => { db.close(); reject(request.error); };
      });
    } catch (e) {
      console.error('IndexedDB load error:', e);
      return null;
    }
  };

  const deleteFromIDB = async (projectId: string) => {
    try {
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(projectId);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {
      console.error('IndexedDB delete error:', e);
    }
  };

  const LS_ACTIVE_PROJECT_KEY = 'kwg_active_project';
  const FIRESTORE_PROJECTS_COLLECTION = 'projects';

  // Save project metadata to Firestore
  const saveProjectToFirestore = async (project: Project) => {
    try {
      await setDoc(doc(db, FIRESTORE_PROJECTS_COLLECTION, project.id), {
        ...project,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Firestore save error (project metadata):', e);
    }
  };

  // Delete project metadata from Firestore
  const deleteProjectFromFirestore = async (projectId: string) => {
    try {
      await deleteDoc(doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId));
    } catch (e) {
      console.warn('Firestore delete error:', e);
    }
  };

  // ============ App-level preferences (activeProjectId, savedClusters) ============
  const APP_SETTINGS_COLLECTION = 'app_settings';
  const APP_PREFS_DOC = 'user_preferences';

  const saveAppPrefsToFirestore = async (activeId: string | null, clusters: any[]) => {
    try {
      await setDoc(doc(db, APP_SETTINGS_COLLECTION, APP_PREFS_DOC), {
        activeProjectId: activeId,
        savedClusters: clusters,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Firestore app prefs save error:', e);
    }
  };

  const saveAppPrefsToIDB = async (activeId: string | null, clusters: any[]) => {
    try {
      const db2 = await openIDB();
      const tx = db2.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({
        projectId: '__app_prefs__',
        activeProjectId: activeId,
        savedClusters: clusters,
        updatedAt: new Date().toISOString(),
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db2.close();
    } catch (e) {
      console.warn('IDB app prefs save error:', e);
    }
  };

  const loadAppPrefsFromFirestore = async (): Promise<{ activeProjectId: string | null; savedClusters: any[] } | null> => {
    try {
      const docSnap = await getDocFromServer(doc(db, APP_SETTINGS_COLLECTION, APP_PREFS_DOC));
      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          activeProjectId: data.activeProjectId || null,
          savedClusters: data.savedClusters || [],
        };
      }
    } catch (e) {
      console.warn('Firestore app prefs load error:', e);
    }
    return null;
  };

  const loadAppPrefsFromIDB = async (): Promise<{ activeProjectId: string | null; savedClusters: any[] } | null> => {
    try {
      const db2 = await openIDB();
      const tx = db2.transaction(IDB_STORE, 'readonly');
      const request = tx.objectStore(IDB_STORE).get('__app_prefs__');
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          db2.close();
          if (request.result) {
            resolve({
              activeProjectId: request.result.activeProjectId || null,
              savedClusters: request.result.savedClusters || [],
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => { db2.close(); reject(request.error); };
      });
    } catch (e) {
      console.warn('IDB app prefs load error:', e);
      return null;
    }
  };

  // ============ Chunked Firestore data storage ============
  const CHUNK_SIZE = 400; // rows per chunk doc (keeps each doc well under 1MB)
  const CHUNKS_SUBCOLLECTION = 'chunks';

  // Save project data to Firestore in chunks
  const saveProjectDataToFirestore = async (projectId: string, data: any) => {
    setCloudSyncStatus('syncing');
    try {
      const chunksRef = collection(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION);

      // First delete all existing chunks (to handle re-uploads cleanly)
      const existingChunks = await getDocs(chunksRef);
      if (!existingChunks.empty) {
        // Delete in batches of 500 (Firestore writeBatch limit)
        const deleteBatches: any[] = [];
        let currentBatch = writeBatch(db);
        let opCount = 0;
        existingChunks.forEach((docSnap) => {
          currentBatch.delete(docSnap.ref);
          opCount++;
          if (opCount >= 500) {
            deleteBatches.push(currentBatch.commit());
            currentBatch = writeBatch(db);
            opCount = 0;
          }
        });
        if (opCount > 0) deleteBatches.push(currentBatch.commit());
        await Promise.all(deleteBatches);
      }

      // Chunk the results array (the biggest piece of data)
      const results: any[] = data.results || [];
      const resultChunks: any[][] = [];
      for (let i = 0; i < results.length; i += CHUNK_SIZE) {
        resultChunks.push(results.slice(i, i + CHUNK_SIZE));
      }

      // Chunk clusterSummary too
      const clusters: any[] = data.clusterSummary || [];
      const clusterChunks: any[][] = [];
      for (let i = 0; i < clusters.length; i += CHUNK_SIZE) {
        clusterChunks.push(clusters.slice(i, i + CHUNK_SIZE));
      }

      // Chunk blockedKeywords
      const blocked: any[] = data.blockedKeywords || [];
      const blockedChunks: any[][] = [];
      for (let i = 0; i < blocked.length; i += CHUNK_SIZE) {
        blockedChunks.push(blocked.slice(i, i + CHUNK_SIZE));
      }

      // Write all chunks in batches
      const writeBatches: Promise<void>[] = [];
      let batch = writeBatch(db);
      let ops = 0;

      const addToBatch = (docId: string, payload: any) => {
        batch.set(doc(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION, docId), payload);
        ops++;
        if (ops >= 500) {
          writeBatches.push(batch.commit());
          batch = writeBatch(db);
          ops = 0;
        }
      };

      // Chunk autoGroupSuggestions (can be large with 900+ groups)
      const suggestions: any[] = data.autoGroupSuggestions || [];
      const suggestionChunks: any[][] = [];
      for (let i = 0; i < suggestions.length; i += CHUNK_SIZE) {
        suggestionChunks.push(suggestions.slice(i, i + CHUNK_SIZE));
      }

      // Meta chunk (stats, tokens, grouped — smaller data, no large arrays)
      addToBatch('meta', {
        type: 'meta',
        stats: data.stats || null,
        datasetStats: data.datasetStats || null,
        tokenSummary: data.tokenSummary || null,
        groupedClusters: data.groupedClusters || [],
        approvedGroups: data.approvedGroups || [],
        blockedTokens: data.blockedTokens || [],
        labelSections: data.labelSections || [],
        activityLog: (data.activityLog || []).slice(0, 500),
        tokenMergeRules: data.tokenMergeRules || [],
        updatedAt: new Date().toISOString(),
        resultChunkCount: resultChunks.length,
        clusterChunkCount: clusterChunks.length,
        blockedChunkCount: blockedChunks.length,
        suggestionChunkCount: suggestionChunks.length,
      });

      // Result chunks
      resultChunks.forEach((chunk, idx) => {
        addToBatch(`results_${idx}`, { type: 'results', index: idx, data: chunk });
      });

      // Cluster chunks
      clusterChunks.forEach((chunk, idx) => {
        addToBatch(`clusters_${idx}`, { type: 'clusters', index: idx, data: chunk });
      });

      // Blocked keyword chunks
      blockedChunks.forEach((chunk, idx) => {
        addToBatch(`blocked_${idx}`, { type: 'blocked', index: idx, data: chunk });
      });

      // Auto-group suggestion chunks
      suggestionChunks.forEach((chunk, idx) => {
        addToBatch(`suggestions_${idx}`, { type: 'suggestions', index: idx, data: chunk });
      });

      if (ops > 0) writeBatches.push(batch.commit());
      await Promise.all(writeBatches);
      console.log(`Firestore save SUCCESS: ${resultChunks.length} result, ${clusterChunks.length} cluster, ${blockedChunks.length} blocked, ${suggestionChunks.length} suggestion chunks`);
    } catch (e) {
      console.warn('Firestore data save error:', e);
    }
  };

  // Load project data from Firestore chunks
  const loadProjectDataFromFirestore = async (projectId: string): Promise<any | null> => {
    try {
      const chunksRef = collection(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION);
      const snapshot = await getDocs(chunksRef);
      if (snapshot.empty) return null;

      let meta: any = null;
      const resultChunks: { index: number; data: any[] }[] = [];
      const clusterChunks: { index: number; data: any[] }[] = [];
      const blockedChunks: { index: number; data: any[] }[] = [];
      const suggestionChunks: { index: number; data: any[] }[] = [];

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.type === 'meta') meta = d;
        else if (d.type === 'results') resultChunks.push({ index: d.index, data: d.data });
        else if (d.type === 'clusters') clusterChunks.push({ index: d.index, data: d.data });
        else if (d.type === 'blocked') blockedChunks.push({ index: d.index, data: d.data });
        else if (d.type === 'suggestions') suggestionChunks.push({ index: d.index, data: d.data });
      });

      if (!meta) return null;

      // Reassemble arrays from sorted chunks
      const results = resultChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);
      const clusterSummary = clusterChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);
      const blockedKeywords = blockedChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);
      const autoGroupSuggestions = suggestionChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);

      return {
        results: results.length > 0 ? results : null,
        clusterSummary: clusterSummary.length > 0 ? clusterSummary : null,
        tokenSummary: meta.tokenSummary || null,
        groupedClusters: meta.groupedClusters || [],
        approvedGroups: meta.approvedGroups || [],
        stats: meta.stats || null,
        datasetStats: meta.datasetStats || null,
        blockedTokens: meta.blockedTokens || [],
        blockedKeywords,
        labelSections: meta.labelSections || [],
        activityLog: meta.activityLog || [],
        tokenMergeRules: meta.tokenMergeRules || [],
        autoGroupSuggestions,
      };
    } catch (e) {
      console.warn('Firestore data load error:', e);
      return null;
    }
  };

  // Delete project data chunks from Firestore
  const deleteProjectDataFromFirestore = async (projectId: string) => {
    try {
      const chunksRef = collection(db, FIRESTORE_PROJECTS_COLLECTION, projectId, CHUNKS_SUBCOLLECTION);
      const snapshot = await getDocs(chunksRef);
      if (snapshot.empty) return;
      const batches: Promise<void>[] = [];
      let batch = writeBatch(db);
      let ops = 0;
      snapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
        ops++;
        if (ops >= 500) {
          batches.push(batch.commit());
          batch = writeBatch(db);
          ops = 0;
        }
      });
      if (ops > 0) batches.push(batch.commit());
      await Promise.all(batches);
    } catch (e) {
      console.warn('Firestore data chunk delete error:', e);
    }
  };

  // Load projects from Firestore, fallback to localStorage
  const loadProjectsFromFirestore = async (): Promise<Project[]> => {
    try {
      const snapshot = await new Promise<any>((resolve, reject) => {
        const unsub = onSnapshot(
          collection(db, FIRESTORE_PROJECTS_COLLECTION),
          (snap) => { unsub(); resolve(snap); },
          (err) => { unsub(); reject(err); }
        );
      });
      const firestoreProjects: Project[] = [];
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data();
        firestoreProjects.push({
          id: docSnap.id,
          name: data.name || '',
          description: data.description || '',
          createdAt: data.createdAt || new Date().toISOString(),
          uid: data.uid || 'local',
          fileName: data.fileName,
        });
      });
      if (firestoreProjects.length > 0) {
        // Sync to localStorage as cache
        saveToLS(LS_PROJECTS_KEY, firestoreProjects);
        return firestoreProjects;
      }
    } catch (e) {
      console.warn('Firestore load error, falling back to localStorage:', e);
    }
    // Fallback to localStorage
    return loadFromLS<Project[]>(LS_PROJECTS_KEY, []);
  };

  // Load projects, saved clusters, and restore active project on mount
  useEffect(() => {
    setIsAuthReady(true);

    // Load app prefs from IDB → Firestore → localStorage (cascade fallback)
    const loadAppPrefs = async () => {
      let prefs = await loadAppPrefsFromIDB();
      if (!prefs) {
        prefs = await loadAppPrefsFromFirestore();
        if (prefs) {
          // Cache to IDB
          await saveAppPrefsToIDB(prefs.activeProjectId, prefs.savedClusters);
        }
      }
      if (prefs) {
        setSavedClusters(prefs.savedClusters || []);
        return prefs.activeProjectId;
      }
      // Final fallback: localStorage
      setSavedClusters(loadFromLS<any[]>(LS_SAVED_CLUSTERS_KEY, []));
      return loadFromLS<string | null>(LS_ACTIVE_PROJECT_KEY, null);
    };

    // Load from Firestore first, fallback to localStorage
    Promise.all([loadProjectsFromFirestore(), loadAppPrefs()]).then(([loadedProjects, savedActiveId]) => {
      setProjects(loadedProjects);

      // Restore last active project and its data
      if (savedActiveId && loadedProjects.some(p => p.id === savedActiveId)) {
        setActiveProjectId(savedActiveId);
        setIsProjectLoading(true);
        loadFromIDB(savedActiveId).then(async (data) => {
          let finalData = data;
          // If IDB has no data, try Firestore
          if (!finalData || !finalData.results) {
            console.log('IDB miss on mount for', savedActiveId, '— loading from Firestore...');
            const firestoreData = await loadProjectDataFromFirestore(savedActiveId);
            if (firestoreData && firestoreData.results) {
              finalData = firestoreData;
              // Cache to IDB
              await saveToIDB(savedActiveId, finalData);
              console.log('Loaded from Firestore on mount and cached to IDB');
            }
          }
          if (finalData && finalData.results) {
            setResults(finalData.results || null);
            setClusterSummary(finalData.clusterSummary || null);
            setTokenSummary(finalData.tokenSummary || null);
            setGroupedClusters(finalData.groupedClusters || []);
            setApprovedGroups(finalData.approvedGroups || []);
            setStats(finalData.stats || null);
            setDatasetStats(finalData.datasetStats || null);
            setBlockedTokens(new Set<string>(finalData.blockedTokens || []));
            setBlockedKeywords(finalData.blockedKeywords || []);
            setLabelSections(finalData.labelSections || []);
            const project = loadedProjects.find(p => p.id === savedActiveId);
            if (project) setFileName(project.fileName || 'Project Data');
          }
        }).finally(() => setIsProjectLoading(false));
      }
    });
  }, []);

  const handleLogin = async () => {};
  const handleLogout = async () => {};

  // Persist active project ID whenever it changes (all 3 layers)
  useEffect(() => {
    if (activeProjectId) {
      saveToLS(LS_ACTIVE_PROJECT_KEY, activeProjectId);
    } else {
      localStorage.removeItem(LS_ACTIVE_PROJECT_KEY);
    }
    // Also save to IDB + Firestore (background, non-blocking)
    saveAppPrefsToIDB(activeProjectId, savedClusters);
    saveAppPrefsToFirestore(activeProjectId, savedClusters);
  }, [activeProjectId]);

  // Auto-save labelSections when they change
  const labelSectionsRef = React.useRef(labelSections);
  useEffect(() => {
    // Skip initial mount (don't save on load)
    if (labelSectionsRef.current === labelSections) return;
    labelSectionsRef.current = labelSections;
    if (activeProjectId && results) {
      saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName);
    }
  }, [labelSections]);

  const saveCluster = async (cluster: ClusterSummary) => {
    const clusterId = `local_${cluster.pageName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    const newCluster = {
      id: clusterId,
      pageName: cluster.pageName,
      totalVolume: cluster.totalVolume,
      keywordCount: cluster.keywordCount,
      keywords: JSON.stringify(cluster.keywords),
      createdAt: new Date().toISOString()
    };
    const updated = [...savedClusters, newCluster];
    setSavedClusters(updated);
    saveToLS(LS_SAVED_CLUSTERS_KEY, updated);
    saveAppPrefsToIDB(activeProjectId, updated);
    saveAppPrefsToFirestore(activeProjectId, updated);
  };

  const deleteSavedCluster = async (clusterId: string) => {
    const updated = savedClusters.filter((c: any) => c.id !== clusterId);
    setSavedClusters(updated);
    saveToLS(LS_SAVED_CLUSTERS_KEY, updated);
    saveAppPrefsToIDB(activeProjectId, updated);
    saveAppPrefsToFirestore(activeProjectId, updated);
  };

  const saveProjectData = (
    res: ProcessedRow[] | null,
    clusters: ClusterSummary[] | null,
    tokens: TokenSummary[] | null,
    grouped: GroupedCluster[] | null,
    st: Stats | null,
    ds: any | null,
    fname: string | null,
    bTokens?: Set<string>,
    bKeywords?: BlockedKeyword[],
    approved?: GroupedCluster[]
  ) => {
    if (!activeProjectId) return;
    const dataPayload = {
      results: res,
      clusterSummary: clusters,
      tokenSummary: tokens,
      groupedClusters: grouped,
      approvedGroups: approved ?? approvedGroups,
      stats: st,
      datasetStats: ds,
      blockedTokens: Array.from(bTokens ?? blockedTokens),
      blockedKeywords: bKeywords ?? blockedKeywords,
      labelSections: labelSectionsRef.current,
      activityLog: activityLogRef.current.slice(0, 500),
      tokenMergeRules: tokenMergeRulesRef.current,
      autoGroupSuggestions: autoGroupSuggestionsRef.current,
      updatedAt: new Date().toISOString()
    };
    // Save to IndexedDB (fast, local cache)
    saveToIDB(activeProjectId, dataPayload);
    // Save to Firestore (persistent, chunked — runs in background)
    saveProjectDataToFirestore(activeProjectId, dataPayload);
    // Also update filename on the project (localStorage + Firestore)
    if (fname) {
      const updatedProjects = projects.map(p =>
        p.id === activeProjectId ? { ...p, fileName: fname } : p
      );
      setProjects(updatedProjects);
      saveToLS(LS_PROJECTS_KEY, updatedProjects);
      const updatedProject = updatedProjects.find(p => p.id === activeProjectId);
      if (updatedProject) saveProjectToFirestore(updatedProject);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) {
      setProjectError("Project name is required.");
      return;
    }
    setProjectError(null);
    setIsProjectLoading(true);
    try {
      const newProject: Project = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        uid: 'local',
        name: newProjectName,
        description: newProjectDescription,
        createdAt: new Date().toISOString()
      };
      const updatedProjects = [...projects, newProject];
      setProjects(updatedProjects);
      saveToLS(LS_PROJECTS_KEY, updatedProjects);
      // Save to Firestore immediately
      await saveProjectToFirestore(newProject);
      // Immediately create empty IDB record so project persists
      await saveToIDB(newProject.id, {
        results: null,
        clusterSummary: null,
        tokenSummary: null,
        groupedClusters: [],
        approvedGroups: [],
        stats: null,
        datasetStats: null,
        blockedTokens: [],
        blockedKeywords: [],
        labelSections: [],
        updatedAt: new Date().toISOString()
      });
      setNewProjectName('');
      setNewProjectDescription('');
      setIsCreatingProject(false);
      setActiveProjectId(newProject.id);
      setMainTab('group');
      setResults(null);
      setClusterSummary(null);
      setTokenSummary(null);
      setStats(null);
      setDatasetStats(null);
      setBlockedKeywords([]);
      setBlockedTokens(new Set());
      setGroupedClusters([]);
      setApprovedGroups([]);
      setActivityLog([]);
      setAutoGroupSuggestions([]);
      setTokenMergeRules([]);
      setFileName(null);
    } catch (error) {
      setProjectError("Failed to create project.");
    } finally {
      setIsProjectLoading(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    if (!window.confirm('Are you sure you want to delete this project and all its data?')) return;
    // Clear active project first if it's the one being deleted
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setResults(null);
      setClusterSummary(null);
      setTokenSummary(null);
      setGroupedClusters([]);
      setStats(null);
      setDatasetStats(null);
      setBlockedKeywords([]);
      setBlockedTokens(new Set());
      setLabelSections([]);
      setFileName(null);
      localStorage.removeItem(LS_ACTIVE_PROJECT_KEY);
    }
    const updatedProjects = projects.filter(p => p.id !== projectId);
    setProjects(updatedProjects);
    saveToLS(LS_PROJECTS_KEY, updatedProjects);
    // Remove from Firestore (metadata + data chunks) and IndexedDB
    await Promise.all([
      deleteProjectFromFirestore(projectId),
      deleteProjectDataFromFirestore(projectId),
      deleteFromIDB(projectId),
    ]);
  };

  const selectProject = async (projectId: string) => {
    setActiveProjectId(projectId);
    setIsProjectLoading(true);
    setMainTab('group');
    setGroupSubTab('data');
    try {
      // Try IDB first (fast local cache)
      let data = await loadFromIDB(projectId);

      // If IDB has no data (or empty results), try Firestore
      if (!data || !data.results) {
        console.log('IDB miss for', projectId, '— loading from Firestore...');
        const firestoreData = await loadProjectDataFromFirestore(projectId);
        if (firestoreData && firestoreData.results) {
          data = firestoreData;
          // Cache to IDB for next time
          await saveToIDB(projectId, data);
          console.log('Loaded from Firestore and cached to IDB');
        }
      }

      if (data && data.results) {
        setResults(data.results || null);
        setClusterSummary(data.clusterSummary || null);
        setTokenSummary(data.tokenSummary || null);
        setGroupedClusters(data.groupedClusters || []);
        setApprovedGroups(data.approvedGroups || []);
        setActivityLog(data.activityLog || []);
        setTokenMergeRules(data.tokenMergeRules || []);
        setAutoGroupSuggestions(data.autoGroupSuggestions || []);
        setStats(data.stats || null);
        setDatasetStats(data.datasetStats || null);
        setBlockedTokens(new Set<string>(data.blockedTokens || []));
        setBlockedKeywords(data.blockedKeywords || []);
        setLabelSections(data.labelSections || []);
        const project = projects.find(p => p.id === projectId);
        if (project) setFileName(project.fileName || 'Project Data');
      } else {
        setResults(null);
        setClusterSummary(null);
        setTokenSummary(null);
        setGroupedClusters([]);
        setApprovedGroups([]);
        setStats(null);
        setDatasetStats(null);
        setBlockedTokens(new Set());
        setBlockedKeywords([]);
        setLabelSections([]);
        setFileName(null);
      }
    } finally {
      setIsProjectLoading(false);
    }
  };

  const generateBrief = async (cluster: ClusterSummary | any) => {
    setBriefLoading(cluster.pageName);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not defined. Please add it to your secrets.");
      }
      let ai;
      try {
        console.log("GoogleGenAI is:", GoogleGenAI);
        ai = new GoogleGenAI({ apiKey });
      } catch (e: any) {
        console.error("Error instantiating GoogleGenAI: ", e);
        alert("Error instantiating GoogleGenAI: " + e.message + "\n" + e.stack);
        throw e;
      }
      let keywordsList = [];
      if (typeof cluster.keywords === 'string') {
        keywordsList = JSON.parse(cluster.keywords).map((k: any) => k.keyword);
      } else {
        keywordsList = cluster.keywords.map((k: any) => k.keyword);
      }
      const prompt = `Create a short SEO content brief for a page targeting the topic "${cluster.pageName}". 
      The page should cover these keywords: ${keywordsList.join(', ')}.
      Include a suggested title, meta description, and 3-4 main headings (H2s). Format as Markdown.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });
      
      setBriefs(prev => ({ ...prev, [cluster.pageName]: response.text || '' }));
    } catch (error) {
      console.error("Error generating brief:", error);
      alert(error instanceof Error ? error.message : "Failed to generate brief. Please try again.");
    } finally {
      setBriefLoading(null);
    }
  };

  const processCSV = (file: File) => {
    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setFileName(file.name);

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

                // Check for foreign countries/cities — block these keywords
                const foreignEntity = detectForeignEntity(keyword.toLowerCase());
                if (foreignEntity) {
                  blockedRows.push({ keyword, volume, kd, reason: foreignEntity });
                  continue;
                }

                // Check for non-English, weird characters, or URL-like strings
                const isNonEnglishOrUrl = /[^\x00-\x7F]/.test(keyword) || 
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
                      const nextToken = rawTokens[j+1];
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

                // Tokenize, singularize, sort
                let normalizedKeyword = keywordLower;

                // #7: Fix common misspellings first
                normalizedKeyword = normalizedKeyword.replace(misspellingRegex, match => misspellingMap[match]);

                // Normalize 24/7 and 24 hour variations
                normalizedKeyword = normalizedKeyword.replace(/\b24\s*[\/|-]?\s*7\b/g, '24hour');
                normalizedKeyword = normalizedKeyword.replace(/\b24\s*hours?\b/g, '24hour');

                // #3: Hyphen/spacing normalization — join split prefixes
                normalizedKeyword = normalizedKeyword.replace(prefixPattern, '$1$2');
                // Also normalize "e-mail"→"email", "e-commerce"→"ecommerce" etc.
                normalizedKeyword = normalizedKeyword.replace(/\be[\s-](mail|commerce|sign)\b/g, 'e$1');

                // #10: Local intent unification — "near me"/"close to me"/etc → "nearby" (kept as token, not stripped)
                normalizedKeyword = normalizedKeyword.replace(localIntentRegex, 'nearby');

                // 1. Singularize each word FIRST (so synonym map only needs singular forms)
                normalizedKeyword = normalizedKeyword
                  .split(/([^a-z0-9]+)/)
                  .map(part => {
                    // Preserve delimiters (spaces, hyphens, etc.)
                    if (/[^a-z0-9]/.test(part) || part.length === 0) return part;
                    if (pluralizeCache.has(part)) return pluralizeCache.get(part)!;
                    try {
                      const singular = pluralize.singular(part);
                      pluralizeCache.set(part, singular);
                      return singular;
                    } catch (e) {
                      pluralizeCache.set(part, part);
                      return part;
                    }
                  })
                  .join('');

                // 2. Normalize synonyms (now matching against singularized words)
                normalizedKeyword = normalizedKeyword.replace(synonymRegex, match => synonymMap[match]);

                // Remove multi-word countries and cities before tokenizing
                normalizedKeyword = normalizedKeyword.replace(multiWordLocationsRegex, '');

                // 3. Remove stop words, ignored tokens, and single-word countries BEFORE state normalization
                normalizedKeyword = normalizedKeyword
                  .split(/[^a-z0-9]+/)
                  .filter(t => t.length > 0 && !stopWords.has(t) && !ignoredTokens.has(t) && !countries.has(t))
                  .join(' ');

                // 4. Normalize states (multi-word and single-word)
                normalizedKeyword = normalizedKeyword.replace(stateRegex, match => stateMap[match]);

                let tokenArr = normalizedKeyword.split(/[^a-z0-9]+/)
                  .filter(t => t.length > 0)
                  .map(t => numberMap[t] || stem(t));

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
    setResults(outputData);
    setClusterSummary(summaryData);
    setGroupedClusters([]);
    setTokenSummary(tokenSummaryData);
    setBlockedKeywords(blockedRows);
    setFileName(file.name);

    if (activeProjectId) {
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
      saveProjectData(outputData, summaryData, tokenSummaryData, [], statsObj, datasetStatsObj, file.name, undefined, blockedRows);
    }

    setStats({
                  original: originalCount,
                  valid: outputData.length,
                  clusters: sortedClusters.length,
                  tokens: tokenSummaryData.length,
                  totalVolume: totalSearchVolume
                });
                setDatasetStats({
                  cities: datasetCities,
                  states: datasetStates,
                  numbers: datasetNumbers,
                  faqs: datasetFaqs,
                  commercial: datasetCommercial,
                  local: datasetLocal,
                  year: datasetYear,
                  informational: datasetInformational,
                  navigational: datasetNavigational
                });
                setActiveTab('pages');
                setIsProcessing(false);
              }
            } catch (err: any) {
              setError(err.message || "An error occurred while processing the CSV.");
              setResults(null);
              setClusterSummary(null);
              setTokenSummary(null);
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        processCSV(file);
      } else {
        setError("Please upload a valid CSV file.");
      }
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processCSV(e.target.files[0]);
    }
  }, []);

  const exportCSV = () => {
    if (!results || !clusterSummary || !tokenSummary) return;

    let csv = '';
    let filename = `clustered_keywords_${new Date().getTime()}.csv`;

    if (activeTab === 'keywords') {
      csv = Papa.unparse({
        fields: ['Page Name', 'Len', 'Tokens', 'Keyword', 'Vol.', 'KD', 'Label', 'City', 'State'],
        data: results.map(row => [
          row.pageName, 
          row.pageNameLen,
          row.tokens,
          row.keyword, 
          row.searchVolume,
          row.kd !== null ? row.kd : '',
          row.label,
          row.locationCity || '',
          row.locationState || ''
        ])
      });
    } else if (activeTab === 'pages') {
      filename = `keyword_clusters_${new Date().getTime()}.csv`;
      csv = Papa.unparse({
        fields: ['Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Label', 'City', 'State'],
        data: clusterSummary.map(row => [
          row.pageName,
          row.pageNameLen,
          row.tokens,
          row.keywordCount,
          row.totalVolume,
          row.avgKd !== null ? row.avgKd : '',
          row.label,
          row.locationCity || '',
          row.locationState || ''
        ])
      });
    } else if (activeTab === 'grouped') {
      filename = `grouped_clusters_${new Date().getTime()}.csv`;
      const data: any[] = [];
      groupedClusters.forEach(group => {
        group.clusters.forEach(cluster => {
          data.push([
            group.groupName,
            cluster.pageName,
            cluster.pageNameLen,
            cluster.tokens,
            cluster.keywordCount,
            cluster.totalVolume,
            cluster.avgKd !== null ? cluster.avgKd : '',
            cluster.label,
            cluster.locationCity || '',
            cluster.locationState || ''
          ]);
        });
      });
      csv = Papa.unparse({
        fields: ['Group Name', 'Page Name', 'Len', 'Tokens', 'KWs', 'Vol.', 'KD', 'Label', 'City', 'State'],
        data
      });
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setResults(null);
    setClusterSummary(null);
    setTokenSummary(null);
    setStats(null);
    setError(null);
    setFileName(null);
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
    setBlockedTokens(new Set());
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('all');
    setGroupedSortConfig({ key: 'keywordCount', direction: 'desc' });
    setGroupedClusters([]);
    setApprovedGroups([]);
    setActivityLog([]);
    setAutoGroupSuggestions([]);
    setTokenMergeRules([]);
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
    let filtered = clusterSummary.filter(c => !groupedTokens.has(c.tokens));
    if (blockedTokens.size > 0) {
      filtered = filtered.filter(c => !hasBlockedToken(c.tokenArr));
    }
    return filtered;
  }, [clusterSummary, groupedClusters, approvedGroups, blockedTokens, hasBlockedToken]);

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
        avgKd: (() => { let total = 0, count = 0; remaining.forEach(c => { if (c.avgKd !== null) { total += c.avgKd; count++; } }); return count > 0 ? Math.round(total / count) : null; })()
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
        blocked.push({ keyword: r.keyword, volume: r.searchVolume, kd: r.kd, reason: `Token: ${matchedTokens.join(', ')}`, tokenArr: r.tokenArr });
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
    
    const data = activeTab === 'keywords' ? results : 
                 activeTab === 'pages' ? clusterSummary : 
                 tokenSummary;
    if (!data) return counts;

    const searchLower = debouncedSearchQuery.toLowerCase();
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const len = data.length;
    
    for (let i = 0; i < len; i++) {
      const item = data[i];
      
      // Apply other filters
      if (activeTab === 'keywords') {
        const r = item as ProcessedRow;
        if (hasMin && (validClusterCounts.get(r.pageName) || 0) < min) continue;
        if (hasMax && (validClusterCounts.get(r.pageName) || 0) > max) continue;
        if (hasTokens) {
          let hasAll = true;
          const rTokens = r.tokenArr;
          for (let j = 0; j < tokensArr.length; j++) {
            if (!rTokens.includes(tokensArr[j])) { hasAll = false; break; }
          }
          if (!hasAll) continue;
        }
        if (searchLower && !(r.keywordLower.includes(searchLower) || r.pageNameLower.includes(searchLower))) continue;
      } else if (activeTab === 'pages') {
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
  }, [activeTab, results, clusterSummary, tokenSummary, debouncedSearchQuery, min, max, hasMin, hasMax, validClusterCounts, minTokenLen, maxTokenLen, selectedTokens, isLabelDropdownOpen]);

  const filteredClusters = useMemo(() => {
    if (!effectiveClusters) return [];
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const searchLower = debouncedSearchQuery.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;
    
    // Column-level filters
    const cityLower = filterCity.toLowerCase();
    const stateLower = filterState.toLowerCase();
    const lenMin = minLen ? parseInt(minLen, 10) : NaN;
    const lenMax = maxLen ? parseInt(maxLen, 10) : NaN;
    const kwMin = minKwInCluster ? parseInt(minKwInCluster, 10) : NaN;
    const kwMax = maxKwInCluster ? parseInt(maxKwInCluster, 10) : NaN;
    const volMin = minVolume ? parseInt(minVolume, 10) : NaN;
    const volMax = maxVolume ? parseInt(maxVolume, 10) : NaN;
    const kdMin = minKd ? parseInt(minKd, 10) : NaN;
    const kdMax = maxKd ? parseInt(maxKd, 10) : NaN;
    
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
  }, [effectiveClusters, debouncedSearchQuery, min, max, hasMin, hasMax, excludedLabels, selectedTokens, filterCity, filterState, minLen, maxLen, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd]);

  // Deselect clusters that are no longer visible due to filters
  useEffect(() => {
    if (selectedClusters.size === 0) return;
    const visibleTokens = new Set(filteredClusters.map(c => c.tokens));
    let changed = false;
    const newSelected = new Set<string>();
    for (const t of selectedClusters) {
      if (visibleTokens.has(t)) {
        newSelected.add(t);
      } else {
        changed = true;
      }
    }
    if (changed) {
      setSelectedClusters(newSelected);
      // Also update group name to highest volume in remaining selection
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
    }
  }, [filteredClusters]);

  const filteredResultsData = useMemo(() => {
    if (!effectiveResults) return { filtered: [], totalVolume: 0 };
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokens = tokensArr.length > 0;
    const searchLower = debouncedSearchQuery.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;
    
    // Column-level filters
    const cityLower = filterCity.toLowerCase();
    const stateLower = filterState.toLowerCase();
    const lenMin = minLen ? parseInt(minLen, 10) : NaN;
    const lenMax = maxLen ? parseInt(maxLen, 10) : NaN;
    const volMin = minVolume ? parseInt(minVolume, 10) : NaN;
    const volMax = maxVolume ? parseInt(maxVolume, 10) : NaN;
    const kdMinVal = minKd ? parseInt(minKd, 10) : NaN;
    const kdMaxVal = maxKd ? parseInt(maxKd, 10) : NaN;
    
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
  }, [effectiveResults, debouncedSearchQuery, min, max, hasMin, hasMax, validClusterCounts, excludedLabels, selectedTokens, filterCity, filterState, minLen, maxLen, minVolume, maxVolume, minKd, maxKd]);

  const filteredResults = filteredResultsData.filtered;

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

  // Shared filter bag for TableHeader — single object passed to all tabs
  const filterBag = useMemo((): FilterBag => ({
    minLen, setMinLen, maxLen, setMaxLen,
    minKwInCluster, setMinKwInCluster, maxKwInCluster, setMaxKwInCluster,
    minVolume, setMinVolume, maxVolume, setMaxVolume,
    minKd, setMinKd, maxKd, setMaxKd,
    filterCity, setFilterCity, filterState, setFilterState,
    excludedLabels, setExcludedLabels,
    isLabelDropdownOpen, setIsLabelDropdownOpen,
    labelCounts,
  }), [minLen, maxLen, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, filterCity, filterState, excludedLabels, isLabelDropdownOpen, labelCounts]);

  const TokenSortIcon = ({ columnKey }: { columnKey: keyof TokenSummary }) => {
    if (tokenSortConfig.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    return tokenSortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 text-indigo-600" /> : <ArrowDown className="w-4 h-4 text-indigo-600" />;
  };

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

  const displayedValid = (debouncedSearchQuery || minClusterCount || maxClusterCount || excludedLabels.size > 0 || selectedTokens.size > 0) ? filteredResults.length : effectiveResults?.length || 0;
  const displayedClusters = (debouncedSearchQuery || minClusterCount || maxClusterCount || excludedLabels.size > 0 || selectedTokens.size > 0) ? filteredClusters.length : effectiveClusters?.length || 0;
  const displayedTokens = (debouncedSearchQuery || minTokenLen || maxTokenLen || excludedLabels.size > 0 || selectedTokens.size > 0) ? filteredTokens.length : tokenSummary?.length || 0;
  
  const displayedVolume = useMemo(() => {
    return (debouncedSearchQuery || minClusterCount || maxClusterCount || excludedLabels.size > 0 || selectedTokens.size > 0) 
      ? filteredResultsData.totalVolume 
      : results?.reduce((sum, row) => sum + row.searchVolume, 0) || 0;
  }, [filteredResultsData.totalVolume, results, debouncedSearchQuery, minClusterCount, maxClusterCount, excludedLabels, selectedTokens]);

  // Memoize pagination slices to avoid re-slicing on unrelated state changes
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

  const paginatedResults = useMemo(() => filteredResults.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredResults, currentPage, itemsPerPage]);
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
    const cityLower = filterCity.toLowerCase();
    const stateLower = filterState.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokenFilter = tokensArr.length > 0;
    const hasColumnFilters = !isNaN(kwMin) || !isNaN(kwMax) || !isNaN(volMin) || !isNaN(volMax) || !isNaN(kdMin) || !isNaN(kdMax) || cityLower || stateLower || hasExcluded || hasTokenFilter;
    if (hasColumnFilters) {
      groups = groups.filter(g => {
        if (!isNaN(kwMin) && g.keywordCount < kwMin) return false;
        if (!isNaN(kwMax) && g.keywordCount > kwMax) return false;
        if (!isNaN(volMin) && g.totalVolume < volMin) return false;
        if (!isNaN(volMax) && g.totalVolume > volMax) return false;
        if (!isNaN(kdMin) && (g.avgKd === null || g.avgKd < kdMin)) return false;
        if (!isNaN(kdMax) && (g.avgKd === null || g.avgKd > kdMax)) return false;
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
    // Multi-sort
    if (groupedSortConfig.length === 0) return groups;
    return [...groups].sort((a, b) => {
      for (const { key, direction } of groupedSortConfig) {
        const aVal = (a as any)[key] ?? (direction === 'asc' ? Infinity : -Infinity);
        const bVal = (b as any)[key] ?? (direction === 'asc' ? Infinity : -Infinity);
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          const cmp = aVal.localeCompare(bVal);
          if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
          continue;
        }
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [effectiveGrouped, groupedSortConfig, debouncedSearchQuery, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, filterCity, filterState, excludedLabels, selectedTokens]);

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
    const cityLower = filterCity.toLowerCase();
    const stateLower = filterState.toLowerCase();
    const hasExcluded = excludedLabels.size > 0;
    const tokensArr = Array.from(selectedTokens) as string[];
    const hasTokenFilter = tokensArr.length > 0;
    const hasColumnFilters = !isNaN(kwMin) || !isNaN(kwMax) || !isNaN(volMin) || !isNaN(volMax) || !isNaN(kdMin) || !isNaN(kdMax) || cityLower || stateLower || hasExcluded || hasTokenFilter;
    if (hasColumnFilters) {
      groups = groups.filter(g => {
        if (!isNaN(kwMin) && g.keywordCount < kwMin) return false;
        if (!isNaN(kwMax) && g.keywordCount > kwMax) return false;
        if (!isNaN(volMin) && g.totalVolume < volMin) return false;
        if (!isNaN(volMax) && g.totalVolume > volMax) return false;
        if (!isNaN(kdMin) && (g.avgKd === null || g.avgKd < kdMin)) return false;
        if (!isNaN(kdMax) && (g.avgKd === null || g.avgKd > kdMax)) return false;
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
  }, [approvedGroups, debouncedSearchQuery, minKwInCluster, maxKwInCluster, minVolume, maxVolume, minKd, maxKd, filterCity, filterState, excludedLabels, selectedTokens]);

  // Filtered blocked keywords (unified search)
  const filteredBlocked = useMemo(() => {
    if (!debouncedSearchQuery) return allBlockedKeywords;
    const q = debouncedSearchQuery.toLowerCase();
    return allBlockedKeywords.filter(b => b.keyword.toLowerCase().includes(q));
  }, [allBlockedKeywords, debouncedSearchQuery]);

  // Token Management panel: filtered, sorted, paginated with subtab support
  const filteredMgmtTokens = useMemo(() => {
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
      } else if (activeTab === 'keywords' && filteredResults) {
        // Build token stats from currently filtered keywords only (not all keywords)
        for (const r of filteredResults) {
          for (const t of r.tokenArr) {
            if (blockedTokens.has(t)) continue;
            const existing = tokenStatsMap.get(t);
            if (existing) {
              existing.totalVolume += r.searchVolume;
              existing.frequency++;
              if (r.kd !== null) { existing.kdSum += r.kd; existing.kdCount++; }
            } else {
              tokenStatsMap.set(t, { token: t, totalVolume: r.searchVolume, frequency: 1, kdSum: r.kd ?? 0, kdCount: r.kd !== null ? 1 : 0 });
            }
          }
        }
      }

      // Build stats from clusters (for pages/grouped/approved tabs)
      if (activeTab !== 'keywords') {
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

      // Convert to TokenSummary format — pull extra fields from global tokenSummary if available
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
      // 'all' — show all non-blocked tokens
      base = tokenSummary.filter(t => !blockedTokens.has(t.token) && !universalBlockedTokens.has(t.token));
    }
    const q = tokenMgmtSearch.toLowerCase().trim();
    let tokens = q ? base.filter(t => t.token.includes(q)) : [...base];
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
  }, [tokenSummary, tokenMgmtSearch, tokenMgmtSort, tokenMgmtSubTab, blockedTokens, universalBlockedTokens, effectiveClusters, activeTab, filteredClusters, filteredSortedGrouped, filteredApprovedGroups, filteredResults, debouncedSearchQuery, selectedTokens]);

  const tokenMgmtTotalPages = Math.max(1, Math.ceil(filteredMgmtTokens.length / tokenMgmtPerPage));
  const safeMgmtPage = Math.min(tokenMgmtPage, tokenMgmtTotalPages);
  const paginatedMgmtTokens = useMemo(() => filteredMgmtTokens.slice((safeMgmtPage - 1) * tokenMgmtPerPage, safeMgmtPage * tokenMgmtPerPage), [filteredMgmtTokens, safeMgmtPage]);

  // Activity log + toast helper — creates a log entry and fires a toast notification
  const logAndToast = useCallback((action: ActivityAction, details: string, count: number, toastMsg: string, toastType: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    const entry: ActivityLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      details,
      count,
    };
    setActivityLog(prev => {
      const next = [entry, ...prev];
      return next.length > 500 ? next.slice(0, 500) : next; // Cap at 500
    });
    addToast(toastMsg, toastType);
  }, [addToast]);

  // Debounced QA re-review — when pages are removed from groups, wait 5s then re-trigger QA
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
      setGroupedClusters(prev => prev.map(g =>
        ids.has(g.id) && g.clusters.length > 0 ? { ...g, reviewStatus: 'pending' as const, reviewMismatchedPages: undefined, reviewReason: undefined } : g
      ));
      logAndToast('qa-review', `Re-reviewing ${ids.size} group${ids.size > 1 ? 's' : ''} after page removal`, ids.size, `QA re-review queued for ${ids.size} group${ids.size > 1 ? 's' : ''}`, 'info');
    }, 5000);
  }, [logAndToast]);

  // Token merge handlers
  const handleOpenMergeModal = useCallback(() => {
    if (selectedMgmtTokens.size < 2) return;
    setMergeModalTokens(Array.from(selectedMgmtTokens));
    setIsMergeModalOpen(true);
  }, [selectedMgmtTokens]);

  const handleMergeTokens = useCallback((parentToken: string) => {
    if (!results || !clusterSummary) return;
    const childTokens = mergeModalTokens.filter(t => t !== parentToken);
    if (childTokens.length === 0) return;

    // Run the cascade
    const cascade = executeMergeCascade(results, groupedClusters, approvedGroups, parentToken, childTokens);

    // Create merge rule
    const newRule: TokenMergeRule = {
      id: `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      parentToken,
      childTokens,
      createdAt: new Date().toISOString(),
    };

    // Update selected token filters — replace children with parent
    const newSelectedTokens = new Set(selectedTokens);
    let filterChanged = false;
    for (const child of childTokens) {
      if (newSelectedTokens.has(child)) {
        newSelectedTokens.delete(child);
        newSelectedTokens.add(parentToken);
        filterChanged = true;
      }
    }

    startTransition(() => {
      setResults(cascade.results);
      setClusterSummary(cascade.clusterSummary);
      setGroupedClusters(cascade.groupedClusters);
      setApprovedGroups(cascade.approvedGroups);
      setTokenSummary(cascade.tokenSummary);
      setTokenMergeRules(prev => [...prev, newRule]);
      if (filterChanged) setSelectedTokens(newSelectedTokens);
      setSelectedMgmtTokens(new Set());
    });

    // Notifications
    const details = `Merged ${childTokens.join(', ')} → ${parentToken}`;
    logAndToast('merge', details, childTokens.length,
      `Merged ${childTokens.length} token${childTokens.length > 1 ? 's' : ''} into '${parentToken}' — ${cascade.pagesAffected} pages affected`, 'info');

    if (cascade.unapprovedGroups.length > 0) {
      logAndToast('merge', `Auto-unapproved ${cascade.unapprovedGroups.length} group(s) due to merge`, cascade.unapprovedGroups.length,
        `${cascade.unapprovedGroups.length} approved group${cascade.unapprovedGroups.length > 1 ? 's' : ''} moved back for re-review`, 'warning');
    }

    // Save
    if (activeProjectId) {
      saveProjectData(cascade.results, cascade.clusterSummary, cascade.tokenSummary, cascade.groupedClusters, stats, datasetStats, fileName, undefined, undefined, cascade.approvedGroups);
    }

    setIsMergeModalOpen(false);
    setMergeModalTokens([]);
  }, [results, clusterSummary, groupedClusters, approvedGroups, mergeModalTokens, selectedTokens, activeProjectId, stats, datasetStats, fileName, logAndToast, startTransition]);

  const handleUndoMergeChild = useCallback((ruleId: string, childToken: string) => {
    if (!results) return;

    // Update the rule
    const updatedRules = tokenMergeRules.map(r => {
      if (r.id !== ruleId) return r;
      return { ...r, childTokens: r.childTokens.filter(t => t !== childToken) };
    }).filter(r => r.childTokens.length > 0); // Remove rules with no children

    // Restore originalTokenArr on all rows, then re-apply all remaining rules
    const restoredResults = results.map(row => {
      if (!row.originalTokenArr) return row;
      // Start from original tokens
      let tokenArr = [...row.originalTokenArr];
      // Re-apply all remaining rules
      for (const rule of updatedRules) {
        const childSet = new Set(rule.childTokens);
        if (tokenArr.some(t => childSet.has(t))) {
          let hasParent = false;
          const merged: string[] = [];
          for (const t of tokenArr) {
            if (childSet.has(t)) { if (!hasParent) { merged.push(rule.parentToken); hasParent = true; } }
            else if (t === rule.parentToken) { if (!hasParent) { merged.push(rule.parentToken); hasParent = true; } }
            else merged.push(t);
          }
          tokenArr = merged.sort();
        }
      }
      const newSig = [...new Set(tokenArr)].sort().join(' ');
      // If no rules remain and tokens match original, clear originalTokenArr
      const stillMerged = updatedRules.length > 0 && newSig !== [...row.originalTokenArr].sort().join(' ');
      return {
        ...row,
        tokenArr,
        tokens: newSig,
        originalTokenArr: stillMerged ? row.originalTokenArr : undefined,
      };
    });

    // Rebuild everything from the restored results
    const newClusters = rebuildClustersFromRows(restoredResults);
    const newClusterMap = new Map(newClusters.map(c => [c.tokens, c]));

    // Update groups with new cluster data
    const updateGroupList = (groups: GroupedCluster[]) => groups.map(group => {
      const newGroupClusters = group.clusters.map(c => newClusterMap.get(c.tokens) || c).filter((c, i, arr) => arr.findIndex(x => x.tokens === c.tokens) === i);
      if (newGroupClusters.length === 0) return null;
      const totalVolume = newGroupClusters.reduce((s, c) => s + c.totalVolume, 0);
      const keywordCount = newGroupClusters.reduce((s, c) => s + c.keywordCount, 0);
      return { ...group, clusters: newGroupClusters, totalVolume, keywordCount };
    }).filter((g): g is GroupedCluster => g !== null);

    const updatedGroups = updateGroupList(groupedClusters);
    const updatedApproved = updateGroupList(approvedGroups);
    const newTokenSummary = rebuildTokenSummaryFromRows(restoredResults);

    startTransition(() => {
      setResults(restoredResults);
      setClusterSummary(newClusters);
      setGroupedClusters(updatedGroups);
      setApprovedGroups(updatedApproved);
      setTokenSummary(newTokenSummary);
      setTokenMergeRules(updatedRules);
    });

    const rule = tokenMergeRules.find(r => r.id === ruleId);
    logAndToast('unmerge', `Unmerged '${childToken}' from '${rule?.parentToken || 'parent'}'`, 1,
      `Unmerged '${childToken}'`, 'success');

    if (activeProjectId) {
      saveProjectData(restoredResults, newClusters, newTokenSummary, updatedGroups, stats, datasetStats, fileName, undefined, undefined, updatedApproved);
    }
  }, [results, tokenMergeRules, groupedClusters, approvedGroups, activeProjectId, stats, datasetStats, fileName, logAndToast, startTransition]);

  // Block/unblock token handlers
  const handleBlockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    const newBlocked = new Set<string>(blockedTokens);
    tokens.forEach(t => newBlocked.add(t));
    setBlockedTokens(newBlocked);
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('blocked');
    setTokenMgmtPage(1);
    logAndToast('block', `Blocked: ${tokens.join(', ')}`, tokens.length, `Blocked ${tokens.length} token${tokens.length > 1 ? 's' : ''}: ${tokens.slice(0, 3).join(', ')}${tokens.length > 3 ? '...' : ''}`, 'error');
    // Persist
    saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, newBlocked);
  }, [blockedTokens, results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, logAndToast]);

  const handleUnblockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    const newBlocked = new Set<string>(blockedTokens);
    tokens.forEach(t => newBlocked.delete(t));
    setBlockedTokens(newBlocked);
    setSelectedMgmtTokens(new Set());
    setTokenMgmtPage(1);
    logAndToast('unblock', `Unblocked: ${tokens.join(', ')}`, tokens.length, `Unblocked ${tokens.length} token${tokens.length > 1 ? 's' : ''}: ${tokens.slice(0, 3).join(', ')}`, 'success');
    // Persist
    saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, newBlocked);
  }, [blockedTokens, results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, logAndToast]);

  // Memoize grouped stats to avoid 5 reduce() calls on every render
  const groupedStats = useMemo(() => {
    const pagesGrouped = effectiveGrouped.reduce((sum, g) => sum + g.clusters.length, 0);
    const groupedKeywords = effectiveGrouped.reduce((sum, g) => sum + g.keywordCount, 0);
    const groupedVolume = effectiveGrouped.reduce((sum, g) => sum + g.totalVolume, 0);
    const totalPagesAll = (effectiveClusters?.length || 0) + pagesGrouped;
    const pctGrouped = totalPagesAll > 0 ? ((pagesGrouped / totalPagesAll) * 100).toFixed(2) : '0.00';
    return { pagesGrouped, groupedKeywords, groupedVolume, totalPagesAll, pctGrouped };
  }, [effectiveGrouped, effectiveClusters]);

  // Approve a group — move from grouped to approved
  const handleApproveGroup = useCallback((groupName: string) => {
    setGroupedClusters(prev => {
      const group = prev.find(g => g.groupName === groupName);
      if (!group) return prev;
      setApprovedGroups(ap => [...ap, group]);
      logAndToast('approve', `Approved '${groupName}'`, group.clusters.length, `Approved '${groupName}' (${group.clusters.length} pages)`, 'success');
      return prev.filter(g => g.groupName !== groupName);
    });
  }, [logAndToast]);

  // Unapprove a group — move from approved back to grouped
  // Recalculate group aggregate stats from its clusters — used after removing individual pages
  const recalcGroupStats = useCallback((group: GroupedCluster, remainingClusters: ClusterSummary[]): GroupedCluster => {
    const totalVolume = remainingClusters.reduce((sum, c) => sum + c.totalVolume, 0);
    const keywordCount = remainingClusters.reduce((sum, c) => sum + c.keywordCount, 0);
    let totalKd = 0, kdCount = 0;
    remainingClusters.forEach(c => { if (c.avgKd !== null) { totalKd += c.avgKd * c.keywordCount; kdCount += c.keywordCount; } });
    return { ...group, clusters: remainingClusters, totalVolume, keywordCount, avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null };
  }, []);

  const handleUnapproveGroup = useCallback((groupName: string) => {
    setApprovedGroups(prev => {
      const group = prev.find(g => g.groupName === groupName);
      if (!group) return prev;
      setGroupedClusters(gc => [...gc, group]);
      logAndToast('unapprove', `Unapproved '${groupName}'`, group.clusters.length, `Unapproved '${groupName}'`, 'warning');
      return prev.filter(g => g.groupName !== groupName);
    });
  }, [logAndToast]);

  // Remove individual sub-clusters from approved groups (unapprove specific pages)
  const handleRemoveFromApproved = useCallback(() => {
    if (selectedGroups.size === 0 && selectedSubClusters.size === 0) return;
    if (!clusterSummary) return;

    const clustersToReturn: ClusterSummary[] = [];
    let newApproved = [...approvedGroups];

    // Handle entire groups being unapproved
    for (const groupId of selectedGroups) {
      const group = newApproved.find(g => g.id === groupId);
      if (group) {
        // Move entire group back to grouped
        setGroupedClusters(gc => [...gc, group]);
      }
    }
    newApproved = newApproved.filter(g => !selectedGroups.has(g.id));

    // Handle individual sub-clusters being removed from approved groups
    for (const subKey of selectedSubClusters) {
      const [groupId, clusterTokens] = subKey.split('::');
      if (selectedGroups.has(groupId)) continue;
      const groupIdx = newApproved.findIndex(g => g.id === groupId);
      if (groupIdx === -1) continue;
      const group = newApproved[groupIdx];
      const clusterToReturn = group.clusters.find(c => c.tokens === clusterTokens);
      if (clusterToReturn) {
        clustersToReturn.push(clusterToReturn);
        const remaining = group.clusters.filter(c => c.tokens !== clusterTokens);
        if (remaining.length === 0) {
          newApproved.splice(groupIdx, 1);
        } else {
          newApproved[groupIdx] = recalcGroupStats(group, remaining);
        }
      }
    }

    // Return individual clusters back to ungrouped
    if (clustersToReturn.length > 0) {
      const newClusters = [...clusterSummary, ...clustersToReturn];
      setClusterSummary(newClusters);
      if (results) {
        const returnedTokens = new Set(clustersToReturn.map(c => c.tokens));
        const newRows: ProcessedRow[] = [];
        for (const cluster of clustersToReturn) {
          for (const kw of cluster.keywords) {
            newRows.push({ keyword: kw.keyword, keywordLower: kw.keyword.toLowerCase(), searchVolume: kw.volume, kd: kw.kd, pageName: cluster.pageName, tokens: cluster.tokens, tokenArr: cluster.tokenArr, labelArr: cluster.labelArr || [], label: cluster.label, locationCity: cluster.locationCity || '', locationState: cluster.locationState || '', pageNameLen: cluster.pageNameLen, pageNameLower: cluster.pageNameLower || cluster.pageName.toLowerCase() });
          }
        }
        setResults([...results, ...newRows]);
      }
    }

    setApprovedGroups(newApproved);
    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());

    const totalRemoved = selectedGroups.size + clustersToReturn.length;
    logAndToast('remove-approved', `Removed ${totalRemoved} items from approved`, totalRemoved, `Removed ${totalRemoved} items from approved`, 'warning');
  }, [selectedGroups, selectedSubClusters, approvedGroups, clusterSummary, results, recalcGroupStats, logAndToast]);

  // Auto-save when approvedGroups changes (approve/unapprove triggers this)
  // Uses a short delay so other state updates in the same batch settle first
  const approvedGroupsInitRef = useRef(true);
  useEffect(() => {
    if (approvedGroupsInitRef.current) { approvedGroupsInitRef.current = false; return; }
    if (!activeProjectId) return;
    const timer = setTimeout(() => {
      saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, undefined, undefined, approvedGroups);
    }, 300);
    return () => clearTimeout(timer);
  }, [approvedGroups, groupedClusters]);

  // AI Group Review — process pending groups automatically
  useEffect(() => {
    if (reviewProcessingRef.current) return;
    const pendingGroups = groupedClusters.filter(g => g.reviewStatus === 'pending');
    if (pendingGroups.length === 0) return;
    const settingsData = groupReviewSettingsRef.current?.getSettings();
    const modelObj = groupReviewSettingsRef.current?.getSelectedModelObj();
    if (!settingsData || !settingsData.apiKey.trim() || !settingsData.selectedModel) return;

    reviewProcessingRef.current = true;

    // Mark as reviewing
    setGroupedClusters(prev => prev.map(g =>
      g.reviewStatus === 'pending' ? { ...g, reviewStatus: 'reviewing' as const } : g
    ));

    // Build queue
    const queue: ReviewRequest[] = pendingGroups.map(g => ({
      groupId: g.id,
      groupName: g.groupName,
      pages: g.clusters.map(c => ({ pageName: c.pageName, tokens: c.tokenArr || c.tokens.split(' ') })),
    }));

    const controller = new AbortController();
    reviewAbortRef.current = controller;

    processReviewQueue(
      queue,
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
          setGroupedClusters(prev => prev.map(g =>
            g.id === result.groupId ? {
              ...g,
              reviewStatus: result.status,
              reviewMismatchedPages: result.mismatchedPages,
              reviewReason: result.reason,
              reviewCost: result.cost,
              reviewedAt: result.reviewedAt,
            } : g
          ));
          const groupName = pendingGroups.find(g => g.id === result.groupId)?.groupName || result.groupId;
          if (result.status === 'approve') {
            logAndToast('qa-review', `QA: '${groupName}' — Approved`, 1, `QA: '${groupName}' — Approved ✓`, 'success');
          } else {
            logAndToast('qa-review', `QA: '${groupName}' — Mismatch (${(result.mismatchedPages || []).join(', ')})`, result.mismatchedPages?.length || 1, `QA: '${groupName}' — Mismatch ✗`, 'error');
          }
        },
        onError: (error: ReviewError) => {
          setGroupedClusters(prev => prev.map(g =>
            g.id === error.groupId ? {
              ...g,
              reviewStatus: 'error' as const,
              reviewReason: error.error,
              reviewedAt: new Date().toISOString(),
            } : g
          ));
          const groupName = pendingGroups.find(g => g.id === error.groupId)?.groupName || error.groupId;
          logAndToast('qa-review', `QA error: '${groupName}' — ${error.error}`, 1, `QA error: '${groupName}'`, 'error');
        },
      },
      controller.signal
    ).finally(() => {
      reviewProcessingRef.current = false;
      reviewAbortRef.current = null;
    });
  }, [groupedClusters]);

  // Auto-save when review results come in (reviewStatus changes to a final state)
  const prevReviewStatusesRef = useRef<string>('');
  useEffect(() => {
    const statusKey = groupedClusters.map(g => `${g.id}:${g.reviewStatus || '-'}`).join(',');
    if (statusKey === prevReviewStatusesRef.current) return;
    const hadPrev = prevReviewStatusesRef.current.length > 0;
    prevReviewStatusesRef.current = statusKey;
    if (!hadPrev) return; // Skip first render
    // Only save if any group has a final review status (not pending/reviewing)
    const hasFinal = groupedClusters.some(g => g.reviewStatus === 'approve' || g.reviewStatus === 'mismatch' || g.reviewStatus === 'error');
    if (hasFinal && activeProjectId) {
      saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName);
    }
  }, [groupedClusters]);

  // On mount: reset stuck 'reviewing' groups to 'pending'
  useEffect(() => {
    setGroupedClusters(prev => {
      const hasStuck = prev.some(g => g.reviewStatus === 'reviewing');
      if (!hasStuck) return prev;
      return prev.map(g => g.reviewStatus === 'reviewing' ? { ...g, reviewStatus: 'pending' as const } : g);
    });
  }, []);

  // Grouping rate tracker — estimates remaining time to group all ungrouped pages
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
      if (etaSec < 60) setGroupingEta(`~${etaSec}s remaining`);
      else if (etaSec < 3600) setGroupingEta(`~${Math.round(etaSec / 60)}m remaining`);
      else setGroupingEta(`~${(etaSec / 3600).toFixed(1)}h remaining`);
    }, 10000);
    return () => clearInterval(interval);
  }, [effectiveClusters?.length]);

  const handleGroupClusters = useCallback(() => {
    if (selectedClusters.size === 0 || !groupNameInput.trim() || !clusterSummary) return;

    const clustersToGroup = clusterSummary.filter(c => selectedClusters.has(c.tokens));
    const remainingClusters = clusterSummary.filter(c => !selectedClusters.has(c.tokens));

    const totalVolume = clustersToGroup.reduce((sum, c) => sum + c.totalVolume, 0);
    const keywordCount = clustersToGroup.reduce((sum, c) => sum + c.keywordCount, 0);
    
    let totalKd = 0;
    let kdCount = 0;
    clustersToGroup.forEach(c => {
      if (c.avgKd !== null) {
        totalKd += c.avgKd * c.keywordCount;
        kdCount += c.keywordCount;
      }
    });

    // Check if review API is configured — if so, auto-review this group
    const hasReviewApi = groupReviewSettingsRef.current?.hasApiKey() ?? false;

    const newGroup: GroupedCluster = {
      id: `${groupNameInput}-${Date.now()}`,
      groupName: groupNameInput.trim(),
      clusters: clustersToGroup,
      totalVolume,
      keywordCount,
      avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
      reviewStatus: hasReviewApi ? 'pending' : undefined,
    };

    const newGrouped = [...groupedClusters, newGroup];
    let newResults = results;
    if (results) {
      newResults = results.filter(r => !selectedClusters.has(r.tokens));
    }
    startTransition(() => {
      setGroupedClusters(newGrouped);
      setClusterSummary(remainingClusters);
      if (newResults !== results) setResults(newResults);
      setSelectedClusters(new Set());
      setGroupNameInput('');
    });
    
    // Track grouping rate for ETA estimation
    recordGroupingEvent(clustersToGroup.length);

    logAndToast('group', `Grouped into '${groupNameInput.trim()}'`, clustersToGroup.length, `Grouped ${clustersToGroup.length} pages into '${groupNameInput.trim()}'`, 'info');

    // Save to IndexedDB
    if (activeProjectId) {
      saveProjectData(newResults, remainingClusters, tokenSummary, newGrouped, stats, datasetStats, fileName);
    }
  }, [selectedClusters, groupNameInput, clusterSummary, groupedClusters, results, tokenSummary, stats, datasetStats, fileName, activeProjectId, recordGroupingEvent, logAndToast]);

  // Global Tab key shortcut: press Tab anywhere to group selected pages
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Shift') {
        // Tab or Shift in Pages (Ungrouped) → Group selected clusters
        if (activeTab === 'pages' && selectedClusters.size > 0 && groupNameInput.trim()) {
          e.preventDefault();
          e.stopPropagation();
          handleGroupClusters();
          return;
        }
        // Tab in Pages (Grouped) → Approve selected groups
        if (activeTab === 'grouped' && selectedGroups.size > 0) {
          e.preventDefault();
          e.stopPropagation();
          const groupsToApprove = groupedClusters.filter(g => selectedGroups.has(g.id));
          groupsToApprove.forEach(g => handleApproveGroup(g.groupName));
          setSelectedGroups(new Set());
          setSelectedSubClusters(new Set());
          return;
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleGroupClusters, selectedClusters.size, groupNameInput, activeTab, selectedGroups, groupedClusters, handleApproveGroup]);

  // Auto-group approve handler — adds LLM-suggested groups to groupedClusters
  const handleAutoGroupApprove = useCallback((newGroups: GroupedCluster[]) => {
    const updatedGrouped = [...groupedClusters, ...newGroups];
    setGroupedClusters(updatedGrouped);

    // Remove grouped pages from clusterSummary
    const groupedTokens = new Set<string>();
    for (const g of newGroups) {
      for (const c of g.clusters) groupedTokens.add(c.tokens);
    }
    const remaining = clusterSummary?.filter(c => !groupedTokens.has(c.tokens)) || null;
    setClusterSummary(remaining);

    // Also remove from results
    let newResults = results;
    if (results) {
      newResults = results.filter(r => !groupedTokens.has(r.tokens));
      setResults(newResults);
    }

    saveProjectData(newResults, remaining, tokenSummary, updatedGrouped, stats, datasetStats, fileName);
  }, [groupedClusters, clusterSummary, results, tokenSummary, stats, datasetStats, fileName]);

  // Ungroup: send selected groups or individual sub-clusters back to Pages (Clusters) tab
  const handleUngroupClusters = () => {
    if (selectedGroups.size === 0 && selectedSubClusters.size === 0) return;
    if (!clusterSummary) return;

    const clustersToReturn: ClusterSummary[] = [];
    let newGrouped = [...groupedClusters];

    // First, handle entire groups being ungrouped
    for (const groupId of selectedGroups) {
      const group = newGrouped.find(g => g.id === groupId);
      if (group) {
        clustersToReturn.push(...group.clusters);
      }
    }
    // Remove fully selected groups
    newGrouped = newGrouped.filter(g => !selectedGroups.has(g.id));

    // Then, handle individual sub-clusters being ungrouped (from groups NOT fully selected)
    const groupsWithPagesRemoved: string[] = [];
    for (const subKey of selectedSubClusters) {
      const [groupId, clusterTokens] = subKey.split('::');
      if (selectedGroups.has(groupId)) continue; // Already handled above
      const groupIdx = newGrouped.findIndex(g => g.id === groupId);
      if (groupIdx === -1) continue;
      const group = newGrouped[groupIdx];
      const clusterToReturn = group.clusters.find(c => c.tokens === clusterTokens);
      if (clusterToReturn) {
        clustersToReturn.push(clusterToReturn);
        const remainingInGroup = group.clusters.filter(c => c.tokens !== clusterTokens);
        if (remainingInGroup.length === 0) {
          // Group is now empty, remove it
          newGrouped.splice(groupIdx, 1);
        } else {
          // Recalculate group stats after removing sub-cluster
          newGrouped[groupIdx] = recalcGroupStats(group, remainingInGroup);
          // Track this group for QA re-review (still has pages, composition changed)
          groupsWithPagesRemoved.push(group.id);
        }
      }
    }

    // Add returned clusters back to clusterSummary and results
    const newClusters = [...clusterSummary, ...clustersToReturn];
    setClusterSummary(newClusters);
    setGroupedClusters(newGrouped);

    // Also add returned rows back to results
    if (results) {
      const returnedTokens = new Set(clustersToReturn.map(c => c.tokens));
      // Reconstruct result rows from the cluster keywords
      const newRows: ProcessedRow[] = [];
      for (const cluster of clustersToReturn) {
        for (const kw of cluster.keywords) {
          newRows.push({
            pageName: cluster.pageName,
            pageNameLower: cluster.pageNameLower,
            pageNameLen: cluster.pageNameLen,
            tokens: cluster.tokens,
            tokenArr: cluster.tokenArr,
            keyword: kw.keyword,
            keywordLower: kw.keyword.toLowerCase(),
            searchVolume: kw.volume,
            kd: kw.kd,
            label: cluster.label,
            labelArr: cluster.labelArr,
            locationCity: kw.locationCity,
            locationState: kw.locationState,
          });
        }
      }
      const newResults = [...results, ...newRows];
      setResults(newResults);
    }

    setSelectedGroups(new Set());
    setSelectedSubClusters(new Set());

    logAndToast('ungroup', `Ungrouped ${clustersToReturn.length} pages`, clustersToReturn.length, `Ungrouped ${clustersToReturn.length} pages back to ungrouped`, 'warning');

    // Schedule QA re-review for groups that had pages removed but still have remaining pages
    if (groupsWithPagesRemoved.length > 0) {
      scheduleReReview(groupsWithPagesRemoved);
    }

    // Save to IndexedDB
    if (activeProjectId) {
      const newResults2 = results ? [...results, ...clustersToReturn.flatMap(c => c.keywords.map(kw => ({
        pageName: c.pageName, pageNameLower: c.pageNameLower, pageNameLen: c.pageNameLen,
        tokens: c.tokens, tokenArr: c.tokenArr, keyword: kw.keyword, keywordLower: kw.keyword.toLowerCase(),
        searchVolume: kw.volume, kd: kw.kd, label: c.label, labelArr: c.labelArr,
        locationCity: kw.locationCity, locationState: kw.locationState,
      })))] : null;
      saveProjectData(newResults2, newClusters, tokenSummary, newGrouped, stats, datasetStats, fileName);
    }
  };

  const totalPages = Math.max(1, Math.ceil(
    (activeTab === 'keywords' ? filteredResults.length :
     activeTab === 'pages' ? sortedClusters.length :
     activeTab === 'grouped' ? filteredSortedGrouped.length :
     activeTab === 'approved' ? approvedGroups.length :
     filteredBlocked.length) / itemsPerPage
  ));

  // Auto-correct page if it exceeds total (e.g. after filtering reduces results)
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages]); // eslint-disable-line -- only react to totalPages changes, not currentPage

  const filteredCount = activeTab === 'keywords' ? filteredResults.length :
                       activeTab === 'pages' ? sortedClusters.length :
                       activeTab === 'grouped' ? filteredSortedGrouped.length :
                       activeTab === 'approved' ? filteredApprovedGroups.length :
                       filteredBlocked.length;

  const totalCount = activeTab === 'keywords' ? (effectiveResults?.length || 0) :
                    activeTab === 'pages' ? (effectiveClusters?.length || 0) :
                    activeTab === 'grouped' ? effectiveGrouped.length :
                    activeTab === 'approved' ? approvedGroups.length :
                    allBlockedKeywords.length;

  // Approved stats
  const approvedPageCount = approvedGroups.reduce((sum, g) => sum + g.clusters.length, 0);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        
        <header className="mb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900 flex items-center gap-2"><Globe className="w-5 h-5 text-indigo-600" />SEO Master Tool</h1>
              <p className="text-xs text-zinc-400 mt-0.5">Keyword clustering, page grouping, approval workflows & AI content generation</p>
            </div>
            <div className="flex space-x-0.5 bg-zinc-100/60 p-0.5 rounded-lg">
              <button
                onClick={() => setMainTab('group')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${mainTab === 'group' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
              >
                <Layers className="w-3.5 h-3.5" />
                Group
              </button>
              <button
                onClick={() => setMainTab('generate')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${mainTab === 'generate' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate
              </button>
            </div>
          </div>
        </header>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-xs text-zinc-400 mb-2 min-h-[24px]">
          <span className="text-zinc-600 font-medium">
            {mainTab === 'group' ? 'Group' : 'Generate'}
          </span>
          {mainTab === 'group' && (
            <>
              <ChevronRight className="w-3 h-3" />
              <span className="text-zinc-600 font-medium capitalize">
                {groupSubTab === 'data' ? (activeProjectId ? 'Data' : 'Projects') : groupSubTab === 'settings' ? 'Settings' : groupSubTab === 'log' ? 'Log' : groupSubTab}
              </span>
              {groupSubTab === 'data' && activeProjectId && (
                <>
                  <ChevronRight className="w-3 h-3" />
                  {editingProjectName ? (
                    <input
                      autoFocus
                      type="text"
                      defaultValue={projects.find(p => p.id === activeProjectId)?.name || ''}
                      className="px-1.5 py-0.5 text-xs border border-indigo-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 w-48"
                      onBlur={(e) => {
                        const newName = e.target.value.trim();
                        if (newName && newName !== projects.find(p => p.id === activeProjectId)?.name) {
                          const updated = projects.map(p => p.id === activeProjectId ? { ...p, name: newName } : p);
                          setProjects(updated);
                          // Persist to localStorage + Firestore
                          try { localStorage.setItem('kwg_projects', JSON.stringify(updated)); } catch {}
                          setDoc(doc(db, 'projects', activeProjectId), { name: newName }, { merge: true }).catch(() => {});
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
                      onClick={() => setEditingProjectName(true)}
                      className="hover:text-zinc-700 transition-colors text-zinc-600 font-medium hover:underline"
                      title="Click to rename project"
                    >
                      {projects.find(p => p.id === activeProjectId)?.name || '...'}
                    </button>
                  )}
                  <ChevronRight className="w-3 h-3" />
                  <span className="text-zinc-600 font-medium capitalize">
                    {activeTab === 'keywords' ? 'All Keywords' : activeTab === 'pages' ? 'Pages (Ungrouped)' : activeTab === 'grouped' ? 'Pages (Grouped)' : activeTab === 'approved' ? 'Pages (Approved)' : 'Blocked'}
                  </span>
                </>
              )}
            </>
          )}
          {mainTab === 'generate' && (
            <>
              <ChevronRight className="w-3 h-3" />
              <span className="text-zinc-600 font-medium">Generate 1</span>
            </>
          )}
        </div>

        {mainTab === 'group' && (
          <>
            {/* Compact project + import bar + group sub-tabs */}
            <div className="flex items-center justify-between mb-2">
              {/* Left: Project badge + Import */}
              <div className="flex items-center gap-2">
                {activeProjectId ? (
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white border border-zinc-200 rounded-md shadow-sm text-xs">
                    <Folder className="w-3 h-3 text-indigo-500 shrink-0" />
                    <span className="font-semibold text-zinc-800 truncate max-w-[150px]">
                      {projects.find(p => p.id === activeProjectId)?.name || '...'}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                    <button onClick={() => setGroupSubTab('projects')} className="text-[10px] text-zinc-400 hover:text-zinc-600 ml-1">Switch</button>
                  </div>
                ) : (
                  <button onClick={() => setGroupSubTab('projects')} className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                    <AlertCircle className="w-3 h-3" /> Select Project
                  </button>
                )}
                {activeProjectId && !results && !isProcessing && (
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
              <div className="flex space-x-0.5 bg-zinc-100/60 p-0.5 rounded-lg">
                <button onClick={() => setGroupSubTab('data')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 ${groupSubTab === 'data' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  <Database className="w-3 h-3" />Data
                </button>
                <button onClick={() => setGroupSubTab('projects')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 ${groupSubTab === 'projects' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  <Folder className="w-3 h-3" />Projects
                </button>
                <button onClick={() => setGroupSubTab('settings')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 ${groupSubTab === 'settings' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  <Settings className="w-3 h-3" />Settings
                </button>
                <button onClick={() => setGroupSubTab('log')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 ${groupSubTab === 'log' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  <ClipboardList className="w-3 h-3" />Log {activityLog.length > 0 && <span className="text-zinc-400 ml-0.5">({activityLog.length})</span>}
                </button>
              </div>
            </div>

            {groupSubTab === 'data' && (
            <>
            {!results && !isProcessing && (
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
                    onClick={() => { setMainTab('group'); setGroupSubTab('projects'); }}
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

            {/* Stats Grid — collapsible */}
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
                        setLabelSections([...labelSections, newSection]);
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
                              setLabelSections(updated);
                            }}
                            onBlur={() => {
                              // Save on blur
                              if (activeProjectId) {
                                saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName);
                              }
                            }}
                            placeholder="Section name..."
                            className="flex-1 text-xs font-semibold bg-transparent border-none outline-none text-zinc-700 placeholder-zinc-400"
                          />
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete label section "${section.name || 'Untitled'}" and all its tokens?`)) {
                                setLabelSections(labelSections.filter(s => s.id !== section.id));
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
                            const indicator = (key: string) => sortCfg.key === key ? (sortCfg.direction === 'asc' ? ' ↑' : ' ↓') : '';
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
                                              setLabelSections(updated);
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
                                setLabelSections(updated);
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
              <div className="px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/30 flex flex-col shrink-0 relative z-20 gap-1.5">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-zinc-500" />Keyword Management</h3>
                  {/* AI Review stats — always visible */}
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
                        <span className="px-1.5 py-0.5 text-[9px] font-medium bg-emerald-50 text-emerald-600 rounded tabular-nums" title="Approved">{approveCount} ✓</span>
                        {mismatchCount > 0 && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-red-50 text-red-600 rounded tabular-nums" title="Mismatched">{mismatchCount} ✗</span>}
                        {totalCost > 0 && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-indigo-50 text-indigo-600 rounded tabular-nums" title="Total API cost">${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost.toFixed(2)}</span>}
                      </div>
                    );
                  })()}
                </div>
                {/* Row 1: Tabs with live counts */}
                <div className="flex items-center gap-4">
                  <div className="flex space-x-0.5 bg-zinc-100/60 p-0.5 rounded-lg w-fit">
                    <button
                      onClick={() => switchTab('auto-group')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${activeTab === 'auto-group' ? 'bg-gradient-to-r from-violet-500 to-purple-500 shadow-sm text-white' : 'text-violet-600 hover:text-violet-700 hover:bg-violet-50'}`}
                    >
                      <Zap className="w-3 h-3" />Auto-Group
                    </button>
                    <button
                      onClick={() => switchTab('pages')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${activeTab === 'pages' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      <FileText className="w-3 h-3" />Ungrouped {(effectiveClusters?.length || 0) > 0 && <span className="text-zinc-400 ml-0.5">({(effectiveClusters?.length || 0).toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => {
                        if (activeTab === 'pages' && selectedClusters.size > 0 && groupNameInput.trim()) {
                          handleGroupClusters();
                        }
                        switchTab('grouped');
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${activeTab === 'grouped' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      <Layers className="w-3 h-3" />Grouped {effectiveGrouped.length > 0 && <span className="text-zinc-400 ml-0.5">({effectiveGrouped.length.toLocaleString()}/{groupedStats.pagesGrouped.toLocaleString()})</span>}
                      {(() => { const mc = groupedClusters.filter(g => g.reviewStatus === 'mismatch').length; return mc > 0 ? <span className="ml-1 px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded-full">{mc}</span> : null; })()}
                    </button>
                    <button
                      onClick={() => switchTab('approved')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${activeTab === 'approved' ? 'bg-emerald-50 shadow-sm text-emerald-700 border border-emerald-200' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      <CheckCircle2 className="w-3 h-3" />Approved {approvedGroups.length > 0 && <span className="text-emerald-600 ml-0.5">({approvedGroups.length.toLocaleString()}/{approvedPageCount.toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => switchTab('blocked')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${activeTab === 'blocked' ? 'bg-red-50 shadow-sm text-red-700 border border-red-200' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      <Lock className="w-3 h-3" />Blocked {allBlockedKeywords.length > 0 && <span className="text-red-500 ml-0.5">({allBlockedKeywords.length.toLocaleString()})</span>}
                    </button>
                  </div>
                </div>
                
                {/* Row 2: Token filter badges (compact height) */}
                <div className="h-6 flex items-center">
                  {selectedTokens.size > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
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
                  {/* Active results count — fixed position, never shifts */}
                  <span className="text-[11px] text-zinc-400 tabular-nums whitespace-nowrap shrink-0 min-w-[100px]">
                    {filteredCount.toLocaleString()} / {totalCount.toLocaleString()} {activeTab === 'pages' ? 'pages' : activeTab === 'grouped' ? 'groups' : activeTab === 'approved' ? 'groups' : activeTab === 'blocked' ? 'blocked' : 'keywords'}
                  </span>

                  {/* Selection count — fixed min-width so it doesn't shift other elements */}
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

                  {/* Search */}
                  <div className="relative w-56 shrink-0">
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

                  {/* Context-aware action buttons — change based on activeTab */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Group name input — visible on Pages (Ungrouped) AND Pages (Grouped) for future rename feature */}
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
                        {groupingEta && (
                          <span className="text-[10px] text-zinc-400 italic whitespace-nowrap">{groupingEta}</span>
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
                        {/* Review settings gear + stats */}
                        <button
                          onClick={() => setShowGroupReviewSettings(!showGroupReviewSettings)}
                          className={`p-1.5 rounded-lg border transition-colors ${showGroupReviewSettings ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'border-zinc-200 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'}`}
                          title="AI Review Settings"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}

                    {/* Pages (Approved): Unapprove — handles both entire groups AND individual pages */}
                    {activeTab === 'approved' && (
                      <button
                        onClick={handleRemoveFromApproved}
                        disabled={selectedGroups.size === 0 && selectedSubClusters.size === 0}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                      >
                        Unapprove ({selectedGroups.size + selectedSubClusters.size})
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* AI Group Review Settings Panel — always mounted so ref is available for handleGroupClusters, but only VISIBLE on grouped tab */}
              <div className={activeTab === 'grouped' ? 'px-4' : 'hidden'}>
                <GroupReviewSettings
                  ref={groupReviewSettingsRef}
                  isOpen={showGroupReviewSettings}
                  onToggle={() => setShowGroupReviewSettings(false)}
                  starredModels={starredModels}
                  onToggleStar={toggleStarModel}
                />
              </div>

              <div className="overflow-auto flex-1 rounded-b-2xl" style={activeTab === 'auto-group' ? { display: 'none' } : undefined}>

                <table className="text-left text-sm relative w-full table-fixed">
                  {/* Shared TableHeader — single source of truth for all tab headers */}
                  {activeTab === 'keywords' ? (
                    <TableHeader
                      columns={KEYWORDS_COLUMNS}
                      showCheckbox={false}
                      sortKey={sortConfig[0]?.key ?? null}
                      sortDirection={sortConfig[0]?.direction ?? 'desc'}
                      sortStack={sortConfig as Array<{key: string, direction: 'asc' | 'desc'}>}
                      onSort={(key, additive) => handleSort(key as keyof ClusterSummary, additive)}
                      filters={filterBag}
                      setCurrentPage={setCurrentPage}
                    />
                  ) : activeTab === 'pages' ? (
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
                    {activeTab === 'keywords' && paginatedResults.map((row, idx) => (
                      <KeywordRow
                        key={idx}
                        row={row}
                        selectedTokens={selectedTokens}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        labelColorMap={labelColorMap}
                      />
                    ))}
                    
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
                        saveCluster={saveCluster}
                        generateBrief={generateBrief}
                        briefLoading={briefLoading}
                        brief={briefs[row.pageName]}
                        labelColorMap={labelColorMap}
                      />
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
                          const groupId = subKey.split('::')[0];
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
                        groupActionButton={
                          <button
                            onClick={() => handleApproveGroup(row.groupName)}
                            className="w-5 h-5 flex items-center justify-center rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors text-[10px] font-bold shrink-0"
                            title="Approve group"
                          >
                            ✓
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
                          const groupId = subKey.split('::')[0];
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

                    {activeTab === 'blocked' && filteredBlocked.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((row, idx) => (
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
                        <td className="px-3 py-0.5 text-[12px]">
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-medium">{row.reason}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Auto-Group Panel — replaces table when auto-group tab is active */}
              {activeTab === 'auto-group' && (
                <AutoGroupPanel
                  key={activeProjectId || 'no-project'}
                  effectiveClusters={effectiveClusters}
                  onApproveGroups={handleAutoGroupApprove}
                  groupReviewSettingsRef={groupReviewSettingsRef}
                  logAndToast={logAndToast}
                  persistedSuggestions={autoGroupSuggestions}
                  onSuggestionsChange={setAutoGroupSuggestions}
                />
              )}

              <div className="px-4 py-2 border-t border-zinc-200 bg-zinc-50 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0" style={activeTab === 'auto-group' ? { display: 'none' } : undefined}>
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
                          {filteredCount.toLocaleString()} / {totalCount.toLocaleString()} {activeTab}
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
                    {blockedTokens.size > 0 && (
                      <span className="text-[10px] font-medium text-red-600">{blockedTokens.size} blocked</span>
                    )}
                  </div>
                  {/* Subtabs */}
                  <div className="flex space-x-0.5 bg-zinc-200/50 p-0.5 rounded-md">
                    {(['current', 'all', 'blocked'] as const).map(tab => (
                      <button
                        key={tab}
                        onClick={() => { setTokenMgmtSubTab(tab); setTokenMgmtPage(1); setSelectedMgmtTokens(new Set()); }}
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
                        placeholder="Search tokens..."
                        value={tokenMgmtSearch}
                        onChange={(e) => { setTokenMgmtSearch(e.target.value); setTokenMgmtPage(1); }}
                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    {selectedMgmtTokens.size > 0 && tokenMgmtSubTab !== 'blocked' && (
                      <button
                        onClick={() => handleBlockTokens(Array.from(selectedMgmtTokens))}
                        className="px-2 py-1.5 text-[10px] font-semibold rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors whitespace-nowrap"
                      >
                        Block ({selectedMgmtTokens.size})
                      </button>
                    )}
                    {selectedMgmtTokens.size >= 2 && tokenMgmtSubTab !== 'blocked' && (
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
                  </div>
                </div>

                {/* Merged tokens display */}
                {tokenMergeRules.length > 0 && tokenMgmtSubTab !== 'blocked' && (
                  <div className="px-2 py-1.5 border-b border-zinc-200 bg-indigo-50/30">
                    <div className="text-[10px] font-medium text-indigo-600 mb-1">Merged Tokens ({tokenMergeRules.length})</div>
                    <div className="space-y-1">
                      {tokenMergeRules.map(rule => (
                        <div key={rule.id} className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">{rule.parentToken}</span>
                          <span className="text-[9px] text-zinc-400">←</span>
                          {rule.childTokens.map(child => (
                            <span key={child} className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600 bg-zinc-100 px-1 py-0.5 rounded border border-zinc-200">
                              {child}
                              <button
                                onClick={() => handleUndoMergeChild(rule.id, child)}
                                className="text-zinc-400 hover:text-red-500 transition-colors ml-0.5"
                                title={`Undo merge: restore '${child}'`}
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="overflow-auto flex-1">
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
                          {/* Star icon — add/remove from Universal Blocked list (only in blocked tab) */}
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
                              title="Click to filter keyword management by this token"
                            >
                              {row.token}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.frequency.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.totalVolume.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.avgKd !== null ? row.avgKd : '-'}</td>
                          {/* Block button — small red circle, only on non-blocked tabs */}
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
                </div>

                <div className="px-3 py-2 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between shrink-0">
                  <span className="text-[10px] text-zinc-500">{filteredMgmtTokens.length.toLocaleString()} tokens</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTokenMgmtPage(p => Math.max(1, p - 1))}
                      disabled={safeMgmtPage <= 1}
                      className="px-2 py-0.5 text-[10px] font-medium rounded border border-zinc-300 bg-white text-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 transition-colors"
                    >
                      Prev
                    </button>
                    <span className="text-[10px] text-zinc-600">{safeMgmtPage}/{tokenMgmtTotalPages}</span>
                    <button
                      onClick={() => setTokenMgmtPage(p => Math.min(tokenMgmtTotalPages, p + 1))}
                      disabled={safeMgmtPage >= tokenMgmtTotalPages}
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
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold text-zinc-900">Projects</h2>
                    <p className="text-zinc-500 text-sm">Select a project to view or upload keyword data.</p>
                  </div>
                  <button
                    onClick={() => setIsCreatingProject(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    New Project
                  </button>
                </div>

                {isCreatingProject && (
                  <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-md animate-in zoom-in-95 duration-200">
                    <h3 className="text-lg font-medium text-zinc-900 mb-4">Create New Project</h3>
                    
                    {projectError && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                        <AlertCircle className="w-4 h-4" />
                        {projectError}
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">Project Name</label>
                        <input
                          type="text"
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          placeholder="e.g., Q1 SEO Strategy"
                          className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">Description (Optional)</label>
                        <textarea
                          value={newProjectDescription}
                          onChange={(e) => setNewProjectDescription(e.target.value)}
                          placeholder="What is this project about?"
                          className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all h-24 resize-none"
                        />
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          onClick={() => setIsCreatingProject(false)}
                          className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={createProject}
                          disabled={!newProjectName.trim() || isProjectLoading}
                          className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          {isProjectLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                          {isProjectLoading ? 'Creating...' : 'Create Project'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {projects.length === 0 ? (
                    <div className="col-span-full py-20 bg-white border border-dashed border-zinc-300 rounded-2xl flex flex-col items-center justify-center text-center">
                      <Folder className="w-12 h-12 text-zinc-300 mb-4" />
                      <h3 className="text-lg font-medium text-zinc-900 mb-1">No projects yet</h3>
                      <p className="text-zinc-500 max-w-xs">Create your first project to start organizing your keyword data.</p>
                    </div>
                  ) : (
                    projects.map((project) => {
                      const isActive = activeProjectId === project.id;
                      return (
                        <div
                          key={project.id}
                          className={`bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden ${isActive ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-200 hover:border-zinc-300'}`}
                          onClick={() => selectProject(project.id)}
                        >
                          {/* Active indicator bar */}
                          {isActive && <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-500" />}

                          <div className="p-5">
                            {/* Row 1: Icon + Name (editable) + Actions */}
                            <div className="flex items-center gap-3 mb-2">
                              <div className={`p-2 rounded-lg shrink-0 ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-400'}`}>
                                <Folder className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3
                                  className="text-sm font-semibold text-zinc-900 truncate cursor-text"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const el = e.currentTarget;
                                    el.contentEditable = 'true';
                                    el.focus();
                                    // Select all text
                                    const range = document.createRange();
                                    range.selectNodeContents(el);
                                    window.getSelection()?.removeAllRanges();
                                    window.getSelection()?.addRange(range);
                                    const finish = () => {
                                      el.contentEditable = 'false';
                                      const newName = el.textContent?.trim();
                                      if (newName && newName !== project.name) {
                                        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, name: newName } : p));
                                        // Persist to Firestore
                                        setDoc(doc(db, 'projects', project.id), { name: newName }, { merge: true }).catch(() => {});
                                      } else {
                                        el.textContent = project.name;
                                      }
                                    };
                                    el.onblur = finish;
                                    el.onkeydown = (ev: KeyboardEvent) => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } if (ev.key === 'Escape') { el.textContent = project.name; el.blur(); } };
                                  }}
                                  title="Click to rename"
                                  suppressContentEditableWarning
                                >
                                  {project.name}
                                </h3>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}
                                className="p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0"
                                title="Delete project"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Description */}
                            {project.description && (
                              <p className="text-xs text-zinc-400 mb-3 line-clamp-2 pl-11">{project.description}</p>
                            )}

                            {/* Row 2: Stats */}
                            <div className="flex items-center gap-3 pl-11 text-[11px]">
                              <span className="text-zinc-400 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                              {project.fileName && (
                                <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                                  <FileText className="w-3 h-3" />
                                  CSV
                                </span>
                              )}
                              {isActive && (
                                <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-semibold">Active</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
          </div>
        )}

        {/* Settings sub-tab — Universal Blocked Tokens */}
        {mainTab === 'group' && groupSubTab === 'settings' && (
          <div className="bg-white rounded-2xl border border-zinc-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Settings header with sub-tabs */}
            <div className="px-6 py-4 border-b border-zinc-100">
              <h2 className="text-base font-semibold text-zinc-900 mb-3">Settings</h2>
              <div className="flex space-x-0.5 bg-zinc-100/60 p-0.5 rounded-lg w-fit">
                <button onClick={() => setSettingsSubTab('general')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all ${settingsSubTab === 'general' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  General
                </button>
                <button onClick={() => setSettingsSubTab('how-it-works')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all ${settingsSubTab === 'how-it-works' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  How it Works
                </button>
                <button onClick={() => setSettingsSubTab('dictionaries')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all ${settingsSubTab === 'dictionaries' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  Dictionaries
                </button>
                <button onClick={() => setSettingsSubTab('blocked')} className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all ${settingsSubTab === 'blocked' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-zinc-900 border border-zinc-200/60' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100/50'}`}>
                  Universal Blocked {universalBlockedTokens.size > 0 && <span className="text-zinc-400 ml-0.5">({universalBlockedTokens.size})</span>}
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
                    No universally blocked tokens. Add tokens above or star them in Token Management → Blocked tab.
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
                    <li><strong>State Names:</strong> Full names → 2-letter abbreviations (e.g., "california" → "ca").</li>
                    <li><strong>Synonyms:</strong> Common synonyms mapped to a base word (e.g., "cheap" → "affordable").</li>
                    <li><strong>Numbers:</strong> Spelled-out numbers → digits (e.g., "one" → "1").</li>
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
                    <li><strong>Singularization:</strong> Plurals → singular ("shoes" → "shoe").</li>
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
                      <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5 text-purple-500" />FAQ / Question</h4>
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
              onClear={() => { setActivityLog([]); addToast('Activity log cleared', 'info'); }}
            />
          </div>
        )}

        {/* GenerateTab stays mounted always — prevents generation from stopping when switching tabs */}
        <div style={mainTab === 'generate' ? undefined : { display: 'none' }}>
          <ErrorBoundary fallbackLabel="The Generate tab encountered an error. Your data has been saved.">
            <GenerateTab />
          </ErrorBoundary>
        </div>

        {/* How it Works — now inside Settings, kept here for backward compat rendering */}

        {/* Dictionaries content moved to Settings > Dictionaries sub-tab */}
        {false && (
          <div className="space-y-8">
            <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">Label Detection Rules (OLD - REMOVED)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <h4 className="font-medium text-zinc-800 mb-2 flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-purple-500" />
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
        )}

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
