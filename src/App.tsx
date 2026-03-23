import React, { useState, useCallback, useMemo, useEffect, useTransition, useRef } from 'react';
import Papa from 'papaparse';
import pluralize from 'pluralize';
import { UploadCloud, Download, FileText, Loader2, AlertCircle, RefreshCw, Database, CheckCircle2, Layers, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Hash, TrendingUp, MapPin, Map as MapIcon, HelpCircle, ShoppingCart, Navigation, Calendar, Filter, BookOpen, Compass, LogIn, LogOut, Save, Bookmark, Sparkles, X, Plus, Folder, Trash2, Lock, Settings } from 'lucide-react';
import { numberMap, stateMap, stateAbbrToFull, stateFullNames, stopWords, ignoredTokens, synonymMap, countries, misspellingMap } from './dictionaries';
import { citySet, cityFirstWords, stateSet, stateRegex, capitalizeWords, normalizeState, detectForeignEntity, synonymRegex, multiWordLocationsRegex, pluralizeCache, misspellingRegex, prefixPattern, localIntentRegex, stem, getLabelColor } from './processing';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDoc, getDocFromServer, addDoc, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import { GoogleGenAI } from '@google/genai';
import GenerateTab from './GenerateTab';
import GroupReviewSettings, { type GroupReviewSettingsRef, type GroupReviewSettingsData } from './GroupReviewSettings';
import { processReviewQueue, type ReviewRequest, type ReviewResult, type ReviewError } from './GroupReviewEngine';
import type { ProcessedRow, Cluster, ClusterSummary, TokenSummary, GroupedCluster, BlockedKeyword, LabelSection, Project, Stats } from './types';

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
    <td className="px-3 py-0.5 text-[13px] font-medium text-zinc-700 min-w-[200px]">{row.pageName}</td>
    <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs min-w-[220px]">
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
            className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[11px] transition-colors`}
            style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
            title={labelColor ? `Label: ${labelColor.sectionName}` : undefined}
          >
            {token}
          </button>
          );
        })}
      </div>
    </td>
    <td className="px-1.5 py-0.5 text-zinc-500 text-right tabular-nums">{row.pageNameLen}</td>
    <td className="px-2 py-0.5 text-zinc-700">{row.keyword}</td>
    <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
      {row.searchVolume.toLocaleString()}
    </td>
    <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
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
      <td className="px-3 py-0.5 text-[13px] font-medium text-zinc-700 min-w-[200px] flex items-center gap-2">
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
        )}
        {row.pageName}
      </td>
      <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs min-w-[220px]">
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
              className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[11px] transition-colors`}
              style={labelColor ? { borderColor: labelColor.border, borderWidth: '2px' } : undefined}
              title={labelColor ? `Label: ${labelColor.sectionName}` : undefined}
            >
              {token}
            </button>
            );
          })}
        </div>
      </td>
      <td className="px-1.5 py-0.5 text-zinc-500 text-right tabular-nums">
        {row.pageNameLen}
      </td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
        {row.keywordCount.toLocaleString()}
      </td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
        {row.totalVolume.toLocaleString()}
      </td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
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

const TokenRow = React.memo(({ row, selectedTokens, setSelectedTokens, setCurrentPage }: {
  row: TokenSummary;
  selectedTokens: Set<string>;
  setSelectedTokens: (s: Set<string>) => void;
  setCurrentPage: (p: number) => void;
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
        }}
        className={`${selectedTokens.has(row.token) ? 'bg-purple-100 text-purple-700 font-semibold' : 'hover:text-indigo-600 hover:bg-indigo-50'} px-1 rounded transition-colors`}
      >
        {row.token}
      </button>
    </td>
    <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
      {row.length}
    </td>
    <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
      {row.frequency.toLocaleString()}
    </td>
    <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
      {row.totalVolume.toLocaleString()}
    </td>
    <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
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
      <td className="px-3 py-0.5 text-[13px] font-medium text-zinc-700 min-w-[200px]">
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
          )}
          <span className="truncate">{row.groupName}</span>
          {groupActionButton && <span onClick={(e) => e.stopPropagation()}>{groupActionButton}</span>}
        </div>
      </td>
      <td className="px-1.5 py-0.5 min-w-[220px]">
        <div className="flex flex-wrap gap-1">
          {(() => {
            // Tokens derived from the GROUP NAME only (not all pages' tokens)
            const groupNameTokens = row.groupName.toLowerCase().split(/\s+/).filter(t => t.trim());
            return groupNameTokens.map(token => {
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
                  className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[11px] transition-colors`}
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
      <td className="px-3 py-0.5 text-zinc-500 text-right tabular-nums">-</td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
        {row.clusters.length.toLocaleString()}
      </td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
        {row.keywordCount.toLocaleString()}
      </td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
        {row.totalVolume.toLocaleString()}
      </td>
      <td className="px-1.5 py-0.5 text-zinc-600 text-right tabular-nums">
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
            <td className="px-3 py-0.5 text-[13px] font-medium text-zinc-700 min-w-[200px]">
              <div className="flex items-center gap-2 pl-6">
                {isSubExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
                <span className="text-sm">{cluster.pageName}</span>
              </div>
            </td>
            <td className="px-3 py-0.5 text-zinc-500 font-mono text-xs min-w-[220px]">
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
                    className={`${selectedTokens.has(token) ? 'bg-purple-100 text-purple-700 font-semibold border-purple-200' : 'bg-zinc-100 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 border-zinc-200'} px-1.5 py-0.5 rounded-md border text-[11px] transition-colors`}
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
            <td className="px-3 py-0.5 text-zinc-500 text-right tabular-nums">
              {cluster.pageNameLen}
            </td>
            <td className="px-3 py-0.5 text-zinc-400 text-right tabular-nums">-</td>
            <td className="px-3 py-0.5 text-zinc-600 text-right tabular-nums">
              {cluster.keywordCount.toLocaleString()}
            </td>
            <td className="px-3 py-0.5 text-zinc-600 text-right tabular-nums">
              {cluster.totalVolume.toLocaleString()}
            </td>
            <td className="px-3 py-0.5 text-zinc-600 text-right tabular-nums">
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
  const [groupSubTab, setGroupSubTab] = useState<'data' | 'projects' | 'how-it-works' | 'dictionaries'>('data');

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
  // Ungrouping: track selected groups and sub-clusters within groups
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [selectedSubClusters, setSelectedSubClusters] = useState<Set<string>>(new Set()); // key: "groupId::clusterTokens"
  const [stats, setStats] = useState<Stats | null>(null);
  const [datasetStats, setDatasetStats] = useState<{ cities: number, states: number, numbers: number, faqs: number, commercial: number, local: number, year: number, informational: number, navigational: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'keywords' | 'pages' | 'grouped' | 'approved' | 'blocked'>('pages');
  const [approvedGroups, setApprovedGroups] = useState<GroupedCluster[]>([]);
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
  const [sortConfig, setSortConfig] = useState<{key: keyof ClusterSummary, direction: 'asc' | 'desc'}>({ key: 'keywordCount', direction: 'desc' });
  const [tokenSortConfig, setTokenSortConfig] = useState<{key: keyof TokenSummary, direction: 'asc' | 'desc'}>({ key: 'frequency', direction: 'desc' });
  const [groupedSortConfig, setGroupedSortConfig] = useState<{key: 'groupName' | 'totalVolume' | 'keywordCount' | 'avgKd', direction: 'asc' | 'desc'}>({ key: 'keywordCount', direction: 'desc' });
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

      // Meta chunk (stats, tokens, grouped — smaller data)
      addToBatch('meta', {
        type: 'meta',
        stats: data.stats || null,
        datasetStats: data.datasetStats || null,
        tokenSummary: data.tokenSummary || null,
        groupedClusters: data.groupedClusters || [],
        approvedGroups: data.approvedGroups || [],
        blockedTokens: data.blockedTokens || [],
        labelSections: data.labelSections || [],
        updatedAt: new Date().toISOString(),
        resultChunkCount: resultChunks.length,
        clusterChunkCount: clusterChunks.length,
        blockedChunkCount: blockedChunks.length,
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

      if (ops > 0) writeBatches.push(batch.commit());
      await Promise.all(writeBatches);
      console.log(`Firestore save SUCCESS: ${resultChunks.length} result chunks, ${clusterChunks.length} cluster chunks, ${blockedChunks.length} blocked chunks`);
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

      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.type === 'meta') meta = d;
        else if (d.type === 'results') resultChunks.push({ index: d.index, data: d.data });
        else if (d.type === 'clusters') clusterChunks.push({ index: d.index, data: d.data });
        else if (d.type === 'blocked') blockedChunks.push({ index: d.index, data: d.data });
      });

      if (!meta) return null;

      // Reassemble arrays from sorted chunks
      const results = resultChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);
      const clusterSummary = clusterChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);
      const blockedKeywords = blockedChunks.sort((a, b) => a.index - b.index).flatMap(c => c.data);

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
      labelSections,
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

                const tokens = normalizedKeyword.split(/[^a-z0-9]+/);
                const signature = [...new Set(tokens
                  .filter(t => t.length > 0)
                  .map(t => numberMap[t] || stem(t))
                )]
                  .sort()
                  .join(' ');

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
                setActiveTab('keywords');
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
    setActiveTab('keywords');
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
  };

  // Check if a row's tokens contain any blocked token
  const hasBlockedToken = useCallback((tokenArr: string[]) => {
    if (blockedTokens.size === 0) return false;
    for (const t of tokenArr) {
      if (blockedTokens.has(t)) return true;
    }
    return false;
  }, [blockedTokens]);

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
    return [...filteredClusters].sort((a, b) => {
      const aVal = a[sortConfig.key] ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
      const bVal = b[sortConfig.key] ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredClusters, sortConfig]);

  const handleSort = useCallback((key: keyof ClusterSummary) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
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
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="w-4 h-4 text-zinc-400" />;
    return sortConfig.direction === 'asc' ? <ArrowUp className="w-4 h-4 text-indigo-600" /> : <ArrowDown className="w-4 h-4 text-indigo-600" />;
  };

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
    // Sort
    const { key, direction } = groupedSortConfig;
    return [...groups].sort((a, b) => {
      const aVal = a[key] ?? (direction === 'asc' ? Infinity : -Infinity);
      const bVal = b[key] ?? (direction === 'asc' ? Infinity : -Infinity);
      if (typeof aVal === 'string' && typeof bVal === 'string') return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
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
      base = tokenSummary.filter(t => blockedTokens.has(t.token));
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
      } else if (activeTab === 'keywords' && effectiveResults) {
        // Build pseudo-clusters from individual keywords
        for (const r of effectiveResults) {
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
      base = tokenSummary.filter(t => !blockedTokens.has(t.token));
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
  }, [tokenSummary, tokenMgmtSearch, tokenMgmtSort, tokenMgmtSubTab, blockedTokens, effectiveClusters, activeTab, filteredClusters, filteredSortedGrouped, filteredApprovedGroups, effectiveResults, debouncedSearchQuery, selectedTokens]);

  const tokenMgmtTotalPages = Math.max(1, Math.ceil(filteredMgmtTokens.length / tokenMgmtPerPage));
  const safeMgmtPage = Math.min(tokenMgmtPage, tokenMgmtTotalPages);
  const paginatedMgmtTokens = useMemo(() => filteredMgmtTokens.slice((safeMgmtPage - 1) * tokenMgmtPerPage, safeMgmtPage * tokenMgmtPerPage), [filteredMgmtTokens, safeMgmtPage]);

  // Block/unblock token handlers
  const handleBlockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    const newBlocked = new Set<string>(blockedTokens);
    tokens.forEach(t => newBlocked.add(t));
    setBlockedTokens(newBlocked);
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('blocked');
    setTokenMgmtPage(1);
    // Persist
    saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, newBlocked);
  }, [blockedTokens, results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName]);

  const handleUnblockTokens = useCallback((tokens: string[]) => {
    if (tokens.length === 0) return;
    const newBlocked = new Set<string>(blockedTokens);
    tokens.forEach(t => newBlocked.delete(t));
    setBlockedTokens(newBlocked);
    setSelectedMgmtTokens(new Set());
    setTokenMgmtPage(1);
    // Persist
    saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, newBlocked);
  }, [blockedTokens, results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName]);

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
      return prev.filter(g => g.groupName !== groupName);
    });
  }, []);

  // Unapprove a group — move from approved back to grouped
  const handleUnapproveGroup = useCallback((groupName: string) => {
    setApprovedGroups(prev => {
      const group = prev.find(g => g.groupName === groupName);
      if (!group) return prev;
      setGroupedClusters(gc => [...gc, group]);
      return prev.filter(g => g.groupName !== groupName);
    });
  }, []);

  // Auto-save when approvedGroups changes (approve/unapprove triggers this)
  const approvedGroupsInitRef = useRef(true);
  useEffect(() => {
    if (approvedGroupsInitRef.current) { approvedGroupsInitRef.current = false; return; }
    if (activeProjectId) {
      saveProjectData(results, clusterSummary, tokenSummary, groupedClusters, stats, datasetStats, fileName, undefined, undefined, approvedGroups);
    }
  }, [approvedGroups]);

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

    // Save to IndexedDB
    if (activeProjectId) {
      saveProjectData(newResults, remainingClusters, tokenSummary, newGrouped, stats, datasetStats, fileName);
    }
  }, [selectedClusters, groupNameInput, clusterSummary, groupedClusters, results, tokenSummary, stats, datasetStats, fileName, activeProjectId, recordGroupingEvent]);

  // Global Tab key shortcut: press Tab anywhere to group selected pages
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && !e.shiftKey && selectedClusters.size > 0 && groupNameInput.trim()) {
        e.preventDefault();
        e.stopPropagation();
        handleGroupClusters();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleGroupClusters, selectedClusters.size, groupNameInput]);

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
          // Update group stats
          const totalVolume = remainingInGroup.reduce((sum, c) => sum + c.totalVolume, 0);
          const keywordCount = remainingInGroup.reduce((sum, c) => sum + c.keywordCount, 0);
          let totalKd = 0, kdCount = 0;
          remainingInGroup.forEach(c => { if (c.avgKd !== null) { totalKd += c.avgKd * c.keywordCount; kdCount += c.keywordCount; } });
          newGrouped[groupIdx] = {
            ...group,
            clusters: remainingInGroup,
            totalVolume,
            keywordCount,
            avgKd: kdCount > 0 ? Math.round(totalKd / kdCount) : null,
          };
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
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        
        <header className="mb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900">SEO Master Tool</h1>
              <p className="text-xs text-zinc-400 mt-0.5">Keyword clustering, page grouping, approval workflows & AI content generation</p>
            </div>
            <div className="flex space-x-1 bg-zinc-200/50 p-1 rounded-lg">
              <button
                onClick={() => setMainTab('group')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${mainTab === 'group' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
              >
                Group
              </button>
              <button
                onClick={() => setMainTab('generate')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${mainTab === 'generate' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
              >
                Generate
              </button>
            </div>
          </div>
        </header>

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
                    <span className="text-[11px] text-zinc-500 truncate max-w-[250px]">{fileName}</span>
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
              <div className="flex space-x-1 bg-zinc-200/50 p-0.5 rounded-md">
                <button onClick={() => setGroupSubTab('data')} className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${groupSubTab === 'data' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  Data
                </button>
                <button onClick={() => setGroupSubTab('projects')} className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${groupSubTab === 'projects' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  Projects
                </button>
                <button onClick={() => setGroupSubTab('how-it-works')} className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${groupSubTab === 'how-it-works' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  How it Works
                </button>
                <button onClick={() => setGroupSubTab('dictionaries')} className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${groupSubTab === 'dictionaries' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  Dictionaries
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
              <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col w-[280px] shrink-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between shrink-0">
                  <span className="text-sm font-semibold text-zinc-700 uppercase tracking-wide">Labels</span>
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
              <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col flex-1 min-w-0">
              <div className="px-4 py-2 border-b border-zinc-200 bg-zinc-50/50 flex flex-col shrink-0 relative z-20 gap-1.5">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900">Keyword Management</h3>
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
                  <div className="flex space-x-1 bg-zinc-200/50 p-1 rounded-lg w-fit">
                    <button
                      onClick={() => switchTab('keywords')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'keywords' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      All {(effectiveResults?.length || 0) > 0 && <span className="text-zinc-400 ml-0.5">({(effectiveResults?.length || 0).toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => switchTab('pages')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'pages' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      Pages (Ungrouped) {(effectiveClusters?.length || 0) > 0 && <span className="text-zinc-400 ml-0.5">({(effectiveClusters?.length || 0).toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => {
                        if (activeTab === 'pages' && selectedClusters.size > 0 && groupNameInput.trim()) {
                          handleGroupClusters();
                        }
                        switchTab('grouped');
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'grouped' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      Pages (Grouped) {effectiveGrouped.length > 0 && <span className="text-zinc-400 ml-0.5">({effectiveGrouped.length.toLocaleString()}/{groupedStats.pagesGrouped.toLocaleString()})</span>}
                      {(() => { const mc = groupedClusters.filter(g => g.reviewStatus === 'mismatch').length; return mc > 0 ? <span className="ml-1 px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 rounded-full">{mc}</span> : null; })()}
                    </button>
                    <button
                      onClick={() => switchTab('approved')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'approved' ? 'bg-emerald-50 shadow-sm text-emerald-700 border border-emerald-200' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      Pages (Approved) {approvedGroups.length > 0 && <span className="text-emerald-600 ml-0.5">({approvedGroups.length.toLocaleString()}/{approvedPageCount.toLocaleString()})</span>}
                    </button>
                    <button
                      onClick={() => switchTab('blocked')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === 'blocked' ? 'bg-red-50 shadow-sm text-red-700 border border-red-200' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'}`}
                    >
                      Blocked {allBlockedKeywords.length > 0 && <span className="text-red-500 ml-0.5">({allBlockedKeywords.length.toLocaleString()})</span>}
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

                    {/* Pages (Approved): Unapprove button only */}
                    {activeTab === 'approved' && (
                      <button
                        onClick={() => {
                          const groupsToUnapprove = approvedGroups.filter(g => selectedGroups.has(g.id));
                          if (groupsToUnapprove.length > 0) {
                            groupsToUnapprove.forEach(g => handleUnapproveGroup(g.groupName));
                            setSelectedGroups(new Set());
                          }
                        }}
                        disabled={selectedGroups.size === 0}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                      >
                        Unapprove ({selectedGroups.size})
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

              <div className="overflow-auto flex-1 rounded-b-2xl">

                <table className="text-left text-sm relative">
                  <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7]">
                    {activeTab === 'keywords' ? (
                      <>
                      <tr>
                        <th className="px-3 py-2 whitespace-nowrap">Page Name</th>
                        <th className="px-3 py-2 whitespace-nowrap min-w-[220px]">Tokens</th>
                        <th className="px-1.5 py-2 whitespace-nowrap text-right">Len</th>
                        <th className="px-2 py-2 whitespace-nowrap">Keyword</th>
                        <th className="px-1.5 py-2 whitespace-nowrap text-right">Vol.</th>
                        <th className="px-1.5 py-2 whitespace-nowrap text-right">KD</th>
                        <th className="px-3 py-2 whitespace-nowrap">Label</th>
                        <th className="px-3 py-2 whitespace-nowrap">City</th>
                        <th className="px-3 py-2 whitespace-nowrap">State</th>
                      </tr>
                      <tr className="bg-zinc-100/50">
                        <td className="px-3 py-0.5"></td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-0.5 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minLen} onChange={(e) => { setMinLen(e.target.value); setCurrentPage(1); }} className="w-8 px-0.5 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Len" />
                            <input type="number" placeholder="↑" value={maxLen} onChange={(e) => { setMaxLen(e.target.value); setCurrentPage(1); }} className="w-8 px-0.5 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Len" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-0.5 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minVolume} onChange={(e) => { setMinVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-0.5 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Vol" />
                            <input type="number" placeholder="↑" value={maxVolume} onChange={(e) => { setMaxVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-0.5 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Vol" />
                          </div>
                        </td>
                        <td className="px-0.5 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKd} onChange={(e) => { setMinKd(e.target.value); setCurrentPage(1); }} className="w-8 px-0.5 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KD" />
                            <input type="number" placeholder="↑" value={maxKd} onChange={(e) => { setMaxKd(e.target.value); setCurrentPage(1); }} className="w-8 px-0.5 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KD" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="relative">
                            <button
                              onClick={() => setIsLabelDropdownOpen(!isLabelDropdownOpen)}
                              className="px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white hover:bg-zinc-50 flex items-center gap-1 w-full"
                            >
                              <Filter className="w-3 h-3 text-zinc-400" />
                              <span className="text-zinc-500 truncate">{excludedLabels.size > 0 ? `${excludedLabels.size} hidden` : 'All'}</span>
                            </button>
                            {isLabelDropdownOpen && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setIsLabelDropdownOpen(false)} />
                                <div className="absolute left-0 mt-1 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 p-2 flex flex-col gap-0.5">
                                  {['Location', 'Number', 'FAQ', 'Commercial', 'Local', 'Year', 'Informational', 'Navigational'].map(label => (
                                    <label key={label} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-zinc-50 rounded-lg cursor-pointer">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={!excludedLabels.has(label)}
                                          onChange={(e) => {
                                            const newLabels = new Set(excludedLabels);
                                            if (!e.target.checked) newLabels.add(label);
                                            else newLabels.delete(label);
                                            setExcludedLabels(newLabels);
                                            setCurrentPage(1);
                                          }}
                                          className="rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-xs text-zinc-700">{label}</span>
                                      </div>
                                      <span className="text-[10px] font-mono text-zinc-400">{(labelCounts[label] || 0).toLocaleString()}</span>
                                    </label>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 city..." value={filterCity} onChange={(e) => { setFilterCity(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 state..." value={filterState} onChange={(e) => { setFilterState(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                      </tr>
                      </>
                    ) : activeTab === 'pages' ? (
                      <>
                      <tr>
                        <th className="px-3 py-1.5 whitespace-nowrap w-12 text-center" rowSpan={2}>
                          <input 
                            type="checkbox" 
                            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                            checked={paginatedClusters.length > 0 && paginatedClusters.every(c => selectedClusters.has(c.tokens))}
                            onChange={(e) => {
                              const newSelected = new Set(selectedClusters);
                              if (e.target.checked) {
                                paginatedClusters.forEach(c => newSelected.add(c.tokens));
                              } else {
                                paginatedClusters.forEach(c => newSelected.delete(c.tokens));
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
                          />
                        </th>
                        <th 
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => handleSort('pageName')}
                        >
                          <div className="flex items-center gap-2">
                            Page Name
                            <SortIcon columnKey="pageName" />
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none min-w-[220px]"
                          onClick={() => handleSort('tokens')}
                        >
                          <div className="flex items-center gap-2">
                            Tokens
                            <SortIcon columnKey="tokens" />
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => handleSort('pageNameLen')}
                        >
                          <div className="flex items-center justify-end gap-2">
                            Len
                            <SortIcon columnKey="pageNameLen" />
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => handleSort('keywordCount')}
                        >
                          <div className="flex items-center justify-end gap-2">
                            KWs
                            <SortIcon columnKey="keywordCount" />
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => handleSort('totalVolume')}
                        >
                          <div className="flex items-center justify-end gap-2">
                            Vol.
                            <SortIcon columnKey="totalVolume" />
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => handleSort('avgKd')}
                        >
                          <div className="flex items-center justify-end gap-2">
                            KD
                            <SortIcon columnKey="avgKd" />
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => handleSort('label')}
                        >
                          <div className="flex items-center gap-2">
                            Label
                            <SortIcon columnKey="label" />
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => handleSort('locationCity')}
                        >
                          <div className="flex items-center gap-2">
                            City
                            <SortIcon columnKey="locationCity" />
                          </div>
                        </th>
                        <th 
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => handleSort('locationState')}
                        >
                          <div className="flex items-center gap-2">
                            State
                            <SortIcon columnKey="locationState" />
                          </div>
                        </th>
                      </tr>
                      {/* Filter row */}
                      <tr className="bg-zinc-100/50">
                        <td className="px-3 py-0.5"></td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minLen} onChange={(e) => { setMinLen(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Len" />
                            <input type="number" placeholder="↑" value={maxLen} onChange={(e) => { setMaxLen(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Len" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKwInCluster} onChange={(e) => { setMinKwInCluster(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KWs" />
                            <input type="number" placeholder="↑" value={maxKwInCluster} onChange={(e) => { setMaxKwInCluster(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KWs" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minVolume} onChange={(e) => { setMinVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Vol" />
                            <input type="number" placeholder="↑" value={maxVolume} onChange={(e) => { setMaxVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Vol" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKd} onChange={(e) => { setMinKd(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KD" />
                            <input type="number" placeholder="↑" value={maxKd} onChange={(e) => { setMaxKd(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KD" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="relative">
                            <button
                              onClick={() => setIsLabelDropdownOpen(!isLabelDropdownOpen)}
                              className="px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white hover:bg-zinc-50 flex items-center gap-1 w-full"
                            >
                              <Filter className="w-3 h-3 text-zinc-400" />
                              <span className="text-zinc-500 truncate">{excludedLabels.size > 0 ? `${excludedLabels.size} hidden` : 'All'}</span>
                            </button>
                            {isLabelDropdownOpen && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setIsLabelDropdownOpen(false)} />
                                <div className="absolute left-0 mt-1 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 p-2 flex flex-col gap-0.5">
                                  {['Location', 'Number', 'FAQ', 'Commercial', 'Local', 'Year', 'Informational', 'Navigational'].map(label => (
                                    <label key={label} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-zinc-50 rounded-lg cursor-pointer">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={!excludedLabels.has(label)}
                                          onChange={(e) => {
                                            const newLabels = new Set(excludedLabels);
                                            if (!e.target.checked) newLabels.add(label);
                                            else newLabels.delete(label);
                                            setExcludedLabels(newLabels);
                                            setCurrentPage(1);
                                          }}
                                          className="rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-xs text-zinc-700">{label}</span>
                                      </div>
                                      <span className="text-[10px] font-mono text-zinc-400">{(labelCounts[label] || 0).toLocaleString()}</span>
                                    </label>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 city..." value={filterCity} onChange={(e) => { setFilterCity(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 state..." value={filterState} onChange={(e) => { setFilterState(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                      </tr>
                      </>
                    ) : activeTab === 'approved' ? (
                      <>
                      <tr>
                        <th className="px-3 py-1.5 whitespace-nowrap w-12 text-center" rowSpan={2}>
                          <input
                            type="checkbox"
                            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                            checked={filteredApprovedGroups.length > 0 && filteredApprovedGroups.every(g => selectedGroups.has(g.id))}
                            onChange={(e) => {
                              const newSelected = new Set(selectedGroups);
                              if (e.target.checked) {
                                filteredApprovedGroups.forEach(g => newSelected.add(g.id));
                              } else {
                                filteredApprovedGroups.forEach(g => newSelected.delete(g.id));
                              }
                              setSelectedGroups(newSelected);
                            }}
                          />
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'groupName', direction: prev.key === 'groupName' && prev.direction === 'asc' ? 'desc' : 'asc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center gap-2">
                            Group / Page Name
                            {groupedSortConfig.key === 'groupName' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th className="px-3 py-2 whitespace-nowrap text-left min-w-[220px]">Tokens</th>
                        <th className="px-3 py-2 whitespace-nowrap text-center w-[60px]">Status</th>
                        <th className="px-3 py-2 whitespace-nowrap text-right">Len</th>
                        <th className="px-3 py-2 whitespace-nowrap text-right">Pages</th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'keywordCount', direction: prev.key === 'keywordCount' && prev.direction === 'desc' ? 'asc' : 'desc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center justify-end gap-2">
                            KWs
                            {groupedSortConfig.key === 'keywordCount' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'totalVolume', direction: prev.key === 'totalVolume' && prev.direction === 'desc' ? 'asc' : 'desc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center justify-end gap-2">
                            Vol.
                            {groupedSortConfig.key === 'totalVolume' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'avgKd', direction: prev.key === 'avgKd' && prev.direction === 'desc' ? 'asc' : 'desc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center justify-end gap-2">
                            KD
                            {groupedSortConfig.key === 'avgKd' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th className="px-3 py-2 whitespace-nowrap text-left">Label</th>
                        <th className="px-3 py-2 whitespace-nowrap text-left">City</th>
                        <th className="px-3 py-2 whitespace-nowrap text-left">State</th>
                      </tr>
                      {/* Filter row — matches Pages tabs exactly */}
                      <tr className="bg-zinc-100/50">
                        <td className="px-3 py-0.5"></td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-1 py-0.5"></td>{/* Status — no filter */}
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minLen} onChange={(e) => { setMinLen(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Len" />
                            <input type="number" placeholder="↑" value={maxLen} onChange={(e) => { setMaxLen(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Len" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKwInCluster} onChange={(e) => { setMinKwInCluster(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KWs" />
                            <input type="number" placeholder="↑" value={maxKwInCluster} onChange={(e) => { setMaxKwInCluster(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KWs" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minVolume} onChange={(e) => { setMinVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Vol" />
                            <input type="number" placeholder="↑" value={maxVolume} onChange={(e) => { setMaxVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Vol" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKd} onChange={(e) => { setMinKd(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KD" />
                            <input type="number" placeholder="↑" value={maxKd} onChange={(e) => { setMaxKd(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KD" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="relative">
                            <button
                              onClick={() => setIsLabelDropdownOpen(!isLabelDropdownOpen)}
                              className="px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white hover:bg-zinc-50 flex items-center gap-1 w-full"
                            >
                              <Filter className="w-3 h-3 text-zinc-400" />
                              <span className="text-zinc-500 truncate">{excludedLabels.size > 0 ? `${excludedLabels.size} hidden` : 'All'}</span>
                            </button>
                            {isLabelDropdownOpen && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setIsLabelDropdownOpen(false)} />
                                <div className="absolute left-0 mt-1 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 p-2 flex flex-col gap-0.5">
                                  {['Location', 'Number', 'FAQ', 'Commercial', 'Local', 'Year', 'Informational', 'Navigational'].map(label => (
                                    <label key={label} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-zinc-50 rounded-lg cursor-pointer">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={!excludedLabels.has(label)}
                                          onChange={(e) => {
                                            const newLabels = new Set(excludedLabels);
                                            if (!e.target.checked) newLabels.add(label);
                                            else newLabels.delete(label);
                                            setExcludedLabels(newLabels);
                                            setCurrentPage(1);
                                          }}
                                          className="rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-xs text-zinc-700">{label}</span>
                                      </div>
                                      <span className="text-[10px] font-mono text-zinc-400">{(labelCounts[label] || 0).toLocaleString()}</span>
                                    </label>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 city..." value={filterCity} onChange={(e) => { setFilterCity(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 state..." value={filterState} onChange={(e) => { setFilterState(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                      </tr>
                      </>
                    ) : activeTab === 'grouped' ? (
                      <>
                      <tr>
                        <th className="px-3 py-1.5 whitespace-nowrap w-12 text-center" rowSpan={2}>
                          <input
                            type="checkbox"
                            className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                            checked={paginatedGroupedClusters.length > 0 && paginatedGroupedClusters.every(g => selectedGroups.has(g.id))}
                            onChange={(e) => {
                              const newSelected = new Set(selectedGroups);
                              if (e.target.checked) {
                                paginatedGroupedClusters.forEach(g => newSelected.add(g.id));
                              } else {
                                paginatedGroupedClusters.forEach(g => newSelected.delete(g.id));
                              }
                              setSelectedGroups(newSelected);
                            }}
                          />
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'groupName', direction: prev.key === 'groupName' && prev.direction === 'asc' ? 'desc' : 'asc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center gap-2">
                            Group / Page Name
                            {groupedSortConfig.key === 'groupName' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th className="px-3 py-2 whitespace-nowrap text-left min-w-[220px]">Tokens</th>
                        <th className="px-3 py-2 whitespace-nowrap text-center w-[60px]">Status</th>
                        <th className="px-3 py-2 whitespace-nowrap text-right">Len</th>
                        <th className="px-3 py-2 whitespace-nowrap text-right">Pages</th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'keywordCount', direction: prev.key === 'keywordCount' && prev.direction === 'desc' ? 'asc' : 'desc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center justify-end gap-2">
                            KWs
                            {groupedSortConfig.key === 'keywordCount' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'totalVolume', direction: prev.key === 'totalVolume' && prev.direction === 'desc' ? 'asc' : 'desc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center justify-end gap-2">
                            Vol.
                            {groupedSortConfig.key === 'totalVolume' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th
                          className="px-3 py-2 whitespace-nowrap cursor-pointer hover:bg-zinc-100 transition-colors select-none text-right"
                          onClick={() => { setGroupedSortConfig(prev => ({ key: 'avgKd', direction: prev.key === 'avgKd' && prev.direction === 'desc' ? 'asc' : 'desc' })); setCurrentPage(1); }}
                        >
                          <div className="flex items-center justify-end gap-2">
                            KD
                            {groupedSortConfig.key === 'avgKd' && (groupedSortConfig.direction === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />)}
                          </div>
                        </th>
                        <th className="px-3 py-2 whitespace-nowrap text-left">Label</th>
                        <th className="px-3 py-2 whitespace-nowrap text-left">City</th>
                        <th className="px-3 py-2 whitespace-nowrap text-left">State</th>
                      </tr>
                      {/* Filter row — matches Pages (Ungrouped) exactly */}
                      <tr className="bg-zinc-100/50">
                        <td className="px-3 py-0.5"></td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-1 py-0.5"></td>{/* Status — no filter */}
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minLen} onChange={(e) => { setMinLen(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Len" />
                            <input type="number" placeholder="↑" value={maxLen} onChange={(e) => { setMaxLen(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Len" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5"></td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKwInCluster} onChange={(e) => { setMinKwInCluster(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KWs" />
                            <input type="number" placeholder="↑" value={maxKwInCluster} onChange={(e) => { setMaxKwInCluster(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KWs" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minVolume} onChange={(e) => { setMinVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min Vol" />
                            <input type="number" placeholder="↑" value={maxVolume} onChange={(e) => { setMaxVolume(e.target.value); setCurrentPage(1); }} className="w-10 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max Vol" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" placeholder="↓" value={minKd} onChange={(e) => { setMinKd(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Min KD" />
                            <input type="number" placeholder="↑" value={maxKd} onChange={(e) => { setMaxKd(e.target.value); setCurrentPage(1); }} className="w-8 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" title="Max KD" />
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <div className="relative">
                            <button
                              onClick={() => setIsLabelDropdownOpen(!isLabelDropdownOpen)}
                              className="px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white hover:bg-zinc-50 flex items-center gap-1 w-full"
                            >
                              <Filter className="w-3 h-3 text-zinc-400" />
                              <span className="text-zinc-500 truncate">{excludedLabels.size > 0 ? `${excludedLabels.size} hidden` : 'All'}</span>
                            </button>
                            {isLabelDropdownOpen && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setIsLabelDropdownOpen(false)} />
                                <div className="absolute left-0 mt-1 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg z-20 p-2 flex flex-col gap-0.5">
                                  {['Location', 'Number', 'FAQ', 'Commercial', 'Local', 'Year', 'Informational', 'Navigational'].map(label => (
                                    <label key={label} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-zinc-50 rounded-lg cursor-pointer">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={!excludedLabels.has(label)}
                                          onChange={(e) => {
                                            const newLabels = new Set(excludedLabels);
                                            if (!e.target.checked) newLabels.add(label);
                                            else newLabels.delete(label);
                                            setExcludedLabels(newLabels);
                                            setCurrentPage(1);
                                          }}
                                          className="rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-xs text-zinc-700">{label}</span>
                                      </div>
                                      <span className="text-[10px] font-mono text-zinc-400">{(labelCounts[label] || 0).toLocaleString()}</span>
                                    </label>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 city..." value={filterCity} onChange={(e) => { setFilterCity(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                        <td className="px-1 py-0.5">
                          <input type="text" placeholder="🔍 state..." value={filterState} onChange={(e) => { setFilterState(e.target.value); setCurrentPage(1); }} className="w-20 px-1 py-0.5 text-xs border border-zinc-300 rounded bg-white focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400" />
                        </td>
                      </tr>
                      </>
                    ) : activeTab === 'blocked' ? (
                      <tr>
                        <th className="px-3 py-1.5 whitespace-nowrap text-left">Keyword</th>
                        <th className="px-3 py-1.5 whitespace-nowrap text-left min-w-[200px]">Tokens</th>
                        <th className="px-3 py-1.5 whitespace-nowrap text-right">Vol.</th>
                        <th className="px-3 py-1.5 whitespace-nowrap text-right">KD</th>
                        <th className="px-3 py-1.5 whitespace-nowrap text-left">Reason</th>
                      </tr>
                    ) : null}
                  </thead>
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
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                            title="Move to Pages (Approved)"
                          >
                            Approve
                          </button>
                        }
                      />
                    ))}

                    {activeTab === 'approved' && (() => {
                      // Apply same sorting as grouped tab
                      const sorted = [...filteredApprovedGroups].sort((a, b) => {
                        const { key, direction } = groupedSortConfig;
                        let aVal: any, bVal: any;
                        if (key === 'groupName') { aVal = a.groupName.toLowerCase(); bVal = b.groupName.toLowerCase(); }
                        else if (key === 'keywordCount') { aVal = a.keywordCount; bVal = b.keywordCount; }
                        else if (key === 'totalVolume') { aVal = a.totalVolume; bVal = b.totalVolume; }
                        else if (key === 'avgKd') { aVal = a.avgKd ?? -1; bVal = b.avgKd ?? -1; }
                        else { aVal = 0; bVal = 0; }
                        if (typeof aVal === 'string') return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
                        return direction === 'asc' ? aVal - bVal : bVal - aVal;
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
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                            title="Move back to Pages (Grouped)"
                          >
                            Unapprove
                          </button>
                        }
                      />
                    ))}

                    {activeTab === 'blocked' && filteredBlocked.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((row, idx) => (
                      <tr key={idx} className="hover:bg-red-50/50 transition-colors">
                        <td className="px-3 py-1 text-sm text-zinc-700">{row.keyword}</td>
                        <td className="px-3 py-1 text-xs font-mono">
                          {row.tokenArr ? (
                            <div className="flex flex-wrap gap-1">
                              {row.tokenArr.map((t, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-md text-[11px]">{t}</span>
                              ))}
                            </div>
                          ) : <span className="text-zinc-400">-</span>}
                        </td>
                        <td className="px-3 py-1 text-sm text-right text-zinc-600 tabular-nums">{row.volume.toLocaleString()}</td>
                        <td className="px-3 py-1 text-sm text-right text-zinc-600 tabular-nums">{row.kd !== null ? row.kd : '-'}</td>
                        <td className="px-3 py-1 text-sm">
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">{row.reason}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="px-4 py-2 border-t border-zinc-200 bg-zinc-50 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
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
              <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm flex flex-col w-[340px] shrink-0">
                <div className="px-4 py-3 border-b border-zinc-200 shrink-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-900">Token Management</h3>
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

                <div className="overflow-auto flex-1">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7]">
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
                          <td className="px-2 py-1 font-mono text-zinc-800">{row.token}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.frequency.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.totalVolume.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-600">{row.avgKd !== null ? row.avgKd : '-'}</td>
                        </tr>
                      ))}
                      {paginatedMgmtTokens.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-400">
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
                    projects.map((project) => (
                      <div 
                        key={project.id}
                        className={`group bg-white border rounded-2xl p-6 shadow-sm hover:shadow-md transition-all cursor-pointer relative ${activeProjectId === project.id ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-200'}`}
                        onClick={() => selectProject(project.id)}
                      >
                        <div className="flex items-start justify-between mb-4">
                          <div className={`p-3 rounded-xl ${activeProjectId === project.id ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-500 group-hover:bg-indigo-50 group-hover:text-indigo-500 transition-colors'}`}>
                            <Folder className="w-6 h-6" />
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              deleteProject(project.id);
                            }}
                            className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all z-10 relative"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <h3 className="text-lg font-semibold text-zinc-900 mb-1 truncate">{project.name}</h3>
                        <p className="text-sm text-zinc-500 mb-4 line-clamp-2 h-10">{project.description || 'No description provided.'}</p>
                        
                        <div className="flex items-center justify-between pt-4 border-t border-zinc-100">
                          <div className="flex items-center gap-2 text-xs text-zinc-400">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(project.createdAt).toLocaleDateString()}
                          </div>
                          {project.fileName && (
                            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                              <FileText className="w-3 h-3" />
                              CSV Uploaded
                            </div>
                          )}
                        </div>

                        {activeProjectId === project.id && (
                          <div className="absolute top-4 right-4">
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm">
                              Active
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
          </div>
        )}

        {/* GenerateTab stays mounted always — prevents generation from stopping when switching tabs */}
        <div style={mainTab === 'generate' ? undefined : { display: 'none' }}>
          <ErrorBoundary fallbackLabel="The Generate tab encountered an error. Your data has been saved.">
            <GenerateTab />
          </ErrorBoundary>
        </div>

        {mainTab === 'group' && groupSubTab === 'how-it-works' && (
          <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-xl font-semibold text-zinc-900 mb-6">How the Clustering Logic Works</h2>
            <div className="space-y-8 text-zinc-600 leading-relaxed">
              <p className="text-lg">
                The Keyword Cluster Tool processes your list of keywords to group semantically identical phrases together. 
                This helps you identify the core "Page Names" or topics to target, reducing duplicate efforts.
              </p>
              
              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-3">1. Normalization</h3>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Lowercase:</strong> All keywords are converted to lowercase.</li>
                  <li><strong>State Names:</strong> Full US state names (e.g., "california", "new york") are converted to their 2-letter abbreviations (e.g., "ca", "ny").</li>
                  <li><strong>Synonyms:</strong> Common synonyms are mapped to a single base word (e.g., "cheap" &rarr; "affordable", "buy" &rarr; "purchase").</li>
                  <li><strong>Numbers:</strong> Spelled-out numbers (e.g., "one", "two") are converted to digits (e.g., "1", "2").</li>
                </ul>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-3">2. Tokenization & Filtering</h3>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Splitting:</strong> Keywords are split into individual words (tokens) based on spaces and punctuation.</li>
                  <li><strong>Stop Words:</strong> Common words that don't add semantic value (e.g., "a", "the", "is", "in") are completely removed.</li>
                  <li><strong>Ignored Tokens:</strong> Specific words that don't change the core intent (e.g., "near", "me", "local") are also removed.</li>
                </ul>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-3">3. Singularization & Sorting</h3>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Singularization:</strong> Plural words are converted to singular (e.g., "shoes" becomes "shoe"). This ensures "red shoe" and "red shoes" match.</li>
                  <li><strong>Sorting:</strong> The remaining tokens are sorted alphabetically. This ensures "shoe red" and "red shoe" generate the exact same signature.</li>
                </ul>
              </div>

              <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-6">
                <h3 className="text-lg font-medium text-zinc-900 mb-3">4. Clustering & Page Name Selection</h3>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Grouping:</strong> Keywords that produce the exact same final signature are grouped into a single cluster.</li>
                  <li><strong>Page Name:</strong> Within each cluster, the keyword with the <strong>highest search volume</strong> is selected as the representative "Page Name" for the entire group.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {mainTab === 'group' && groupSubTab === 'dictionaries' && (
          <div className="space-y-8">
            <div className="bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-xl font-semibold text-zinc-900 mb-6">Label Detection Rules</h2>
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

      </div>
    </div>
  );
}
