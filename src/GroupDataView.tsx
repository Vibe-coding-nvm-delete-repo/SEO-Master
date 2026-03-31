/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import { UploadCloud, Download, FileText, Loader2, AlertCircle, RefreshCw, Database, CheckCircle2, Layers, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Hash, TrendingUp, MapPin, Map as MapIcon, HelpCircle, ShoppingCart, Navigation, Calendar, Filter, BookOpen, Compass, LogIn, LogOut, Save, Bookmark, Sparkles, X, Plus, Folder, Trash2, Lock, Settings, Star, ExternalLink, Copy, Zap, Globe, ClipboardList, Cloud, CloudOff, Lightbulb, List, Check, DollarSign, Inbox, Bell } from 'lucide-react';
import GroupReviewSettings from './GroupReviewSettings';
import MergeConfirmModal from './MergeConfirmModal';
import AutoGroupPanel from './AutoGroupPanel';
import GroupAutoMergePanel from './GroupAutoMergePanel';
import ClusterRowView from './ClusterRow';
import GroupedClusterRowView from './GroupedClusterRow';
import InlineHelpHint from './InlineHelpHint';
import TableHeader from './TableHeader';
import { PAGES_COLUMNS, GROUPED_COLUMNS, APPROVED_COLUMNS, BLOCKED_COLUMNS, KEYWORDS_COLUMNS, CELL } from './tableConstants';
import KwRatingCell from './KwRatingCell';
import TokenRow from './TokenRow';
import { formatKeywordRatingDuration } from './KeywordRatingEngine';
import { getLabelColor } from './processing';
import { tokenIncludesAnyTerm } from './tokenMgmtSearch';
import type { ClusterSummary, LabelSection, TokenSummary } from './types';

export default function GroupDataView(props: any) {
  const {
    activeProjectId,
    addToast,
    activeOperation,
    activeTab,
    allBlockedKeywords,
    applyAllAutoMergeRecommendations,
    applyAutoMergeRecommendation,
    applyGroupAutoMergeRecommendations,
    approvedGroups,
    approvedPageCount,
    autoMergeJob,
    autoMergeRows,
    autoMergeSortConfig,
    autoMergeSortIcon,
    blockedSortConfig,
    blockedTokens,
    canApproveGrouped,
    canRunFilteredAutoGroup,
    canRunManualGroup,
    canUnapproveApproved,
    canUngroupGrouped,
    cancelGroupAutoMerge,
    clusterSummary,
    currentPage,
    datasetStats,
    declineAutoMergeRecommendation,
    dismissGroupAutoMergeRecommendations,
    error,
    excludedLabels,
    expandedClusters,
    expandedGroupedClusters,
    expandedGroupedSubClusters,
    expandedMergeParents,
    exportCSV,
    exportTokensCSV,
    fileName,
    filteredApprovedGroups,
    filteredAutoGroupFilterSummary,
    filteredAutoGroupQueue,
    filteredAutoGroupSettingsStatus,
    filteredAutoGroupStats,
    filteredCount,
    filteredMgmtTokens,
    filteredSortedGrouped,
    filterBag,
    filteredClusters,
    groupAutoMergeJob,
    groupAutoMergeRecommendationsAreStale,
    groupNameInput,
    groupReviewSettingsHydrated,
    groupReviewSettingsRef,
    groupedClusters,
    groupedSortConfig,
    groupedStats,
    groupingEta,
    handleApproveGroup,
    handleAutoGroupApprove,
    handleBlockSingleToken,
    handleBlockTokens,
    handleCancelAutoMerge,
    handleCancelKeywordRating,
    handleClusterMiddleClick,
    handleClusterSelect,
    handleDrop,
    handleDragLeave,
    handleDragOver,
    handleFileInput,
    handleGroupClusters,
    handleGroupedSort,
    handleKeywordsSort,
    handleOpenMergeModal,
    handleRemoveFromApproved,
    handleRunFilteredAutoGroup,
    handleSort,
    handleStopFilteredAutoGroup,
    handleSubClusterSelect,
    handleTokenSort,
    handleToggleGroup,
    handleToggleSubCluster,
    handleUnapproveGroup,
    handleUngroupClusters,
    handleUndoMergeChild,
    handleUndoMergeParent,
    handleUnblockTokens,
    isDragging,
    isFilteredAutoGroupFilterActive,
    isLabelDropdownOpen,
    isLabelSidebarOpen,
    isMergeModalOpen,
    isProcessing,
    isProjectBusy,
    isProjectLoading,
    isRunningFilteredAutoGroup,
    isSharedProjectReadOnly,
    itemsPerPage,
    kwRatingJob,
    labelColorMap,
    labelSectionStats,
    logAndToast,
    mergeModalTokens,
    mergeMgmtTotalPages,
    paginatedAutoMergeRows,
    paginatedClusters,
    paginatedGroupedClusters,
    paginatedMergeRuleRows,
    paginatedMgmtTokens,
    paginatedResults,
    paginatedTokens,
    pendingGroupMergeRecommendationsCount,
    progress,
    projects,
    reset,
    results,
    runAutoMergeRecommendations,
    runGroupAutoMergeRecommendations,
    runKeywordRating,
    safeAutoMergePage,
    safeMergeMgmtPage,
    safeMgmtPage,
    searchQuery,
    selectedClusters,
    selectedGroups,
    selectedMgmtTokens,
    selectedTokens,
    selectedSubClusters,
    setActiveTab,
    setAutoMergeSortConfig,
    setCurrentPage,
    setExpandedClusters,
    setExpandedMergeParents,
    setGroupNameInput,
    setGroupReviewSettingsHydrated,
    setGroupReviewSettingsSnapshot,
    setIsLabelSidebarOpen,
    setLabelSortConfigs,
    setMergeModalTokens,
    setSearchQuery,
    setSearchImmediate,
    setSelectedClusters,
    setSelectedGroups,
    setSelectedMgmtTokens,
    setSelectedTokens,
    setSelectedSubClusters,
    setShowGroupReviewSettings,
    setTokenMgmtPage,
    setTokenMgmtSearch,
    setTokenMgmtSort,
    setTokenMgmtSubTab,
    setUniversalBlockedTokens,
    setItemsPerPage,
    setStatsExpanded,
    showGroupReviewSettings,
    sortedBlocked,
    sortedClusters,
    sortedKeywordRows,
    sortedPaginatedApproved,
    sortedTokens,
    starredModels,
    stats,
    statsExpanded,
    switchTab,
    tokenMgmtPage,
    tokenMgmtPerPage,
    tokenMgmtSearch,
    tokenMgmtSort,
    tokenMgmtSubTab,
    tokenPagesTooltip,
    tokenSortConfig,
    tokenSummary,
    tokenTopPagesMap,
    toggleCluster,
    toggleStarModel,
    totalCount,
    totalGroupMergeRecommendationsCount,
    totalPages,
    undoAutoMergeRecommendation,
    universalBlockedTokens,
    approveSelectedGrouped,
    autoGroupSuggestions,
    autoMergeRecommendations,
    autoMergeTotalPages,
    displayedClusters,
    displayedTokens,
    displayedValid,
    displayedVolume,
    effectiveClusters,
    effectiveGrouped,
    effectiveResults,
    filteredMergeRuleRows,
    filteredTokenCounts,
    groupMergeRecommendations,
    groupSubTab,
    handleBlockedSort,
    handleGroupSelect,
    keywordsSortConfig,
    keywordGroupingProgress,
    labelSections,
    labelSortConfigs,
    mainTabBtnActive,
    mainTabBtnInactive,
    navigateGroupSub,
    persistence,
    runWithExclusiveOperation,
    sortConfig,
    stateTabBtnBase,
    tabRailClass,
    tokenMergeRules,
    tokenMgmtMergeSearchTerms,
    tokenMgmtTotalPages,
  } = props;

  return (
        <>
            {!results && !isProcessing && !isProjectLoading && (
          <div
            className={`
              relative border-2 border-dashed rounded-2xl p-12 transition-all duration-200 ease-in-out
              flex flex-col items-center justify-center text-center bg-white
              ${!activeProjectId || isProjectBusy ? 'opacity-50 cursor-not-allowed grayscale' : isDragging ? 'border-indigo-500 bg-indigo-50/50' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/50'}
            `}
            onDragOver={activeProjectId && !isProjectBusy ? handleDragOver : undefined}
            onDragLeave={activeProjectId && !isProjectBusy ? handleDragLeave : undefined}
            onDrop={activeProjectId && !isProjectBusy ? handleDrop : undefined}
          >
            {(!activeProjectId || isProjectBusy) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[1px] rounded-2xl">
                <div className="bg-white p-4 rounded-xl shadow-xl border border-zinc-200 flex flex-col items-center gap-3 max-w-xs">
                  <Lock className="w-8 h-8 text-amber-500" />
                  {isProjectBusy ? (
                    <p className="text-sm font-medium text-zinc-900">Another client is running a project-wide operation.</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-zinc-900">Create or select a project first</p>
                      <button 
                        onClick={() => navigateGroupSub('projects')}
                        className="w-full px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all"
                      >
                        Go to Projects
                      </button>
                    </>
                  )}
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
                        if (activeTab === 'pages' && canRunManualGroup) {
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
                      onClick={() => void runWithExclusiveOperation('keyword-rating', runKeywordRating)}
                      disabled={isProjectBusy || kwRatingJob.phase === 'summary' || kwRatingJob.phase === 'rating'}
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
                  {/* Active results count — fixed position, never shifts */}
                  <span className="text-[11px] text-zinc-400 tabular-nums whitespace-nowrap shrink-0 min-w-[100px]">
                    {filteredCount.toLocaleString()} / {totalCount.toLocaleString()}{' '}
                    {activeTab === 'pages' ? 'pages' : activeTab === 'keywords' ? 'keywords' : activeTab === 'grouped' ? 'groups' : activeTab === 'group-auto-merge' ? 'recommendations' : activeTab === 'approved' ? 'groups' : activeTab === 'blocked' ? 'blocked' : 'items'}
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

                  {/* Context-aware action buttons — change based on activeTab */}
                  <div className="flex items-center gap-1.5 flex-shrink min-w-0 flex-wrap justify-end">
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
                          disabled={!canRunManualGroup}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                        >
                          Group ({selectedClusters.size})
                        </button>
                        <button
                          onClick={handleRunFilteredAutoGroup}
                          disabled={!canRunFilteredAutoGroup}
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
                          onClick={approveSelectedGrouped}
                          disabled={!canApproveGrouped}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap min-w-[90px]"
                        >
                          Approve ({selectedGroups.size})
                        </button>
                        <button
                          onClick={handleUngroupClusters}
                          disabled={!canUngroupGrouped}
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

                    {/* Pages (Approved): Unapprove — handles both entire groups AND individual pages */}
                    {activeTab === 'approved' && (
                      <>
                        <button
                          onClick={handleRemoveFromApproved}
                          disabled={!canUnapproveApproved}
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

              {/* AI Group Review Settings Panel — mounted for both Pages and Grouped because Pages Auto Group uses the same settings */}
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
                  {/* Shared TableHeader — single source of truth for all tab headers */}
                  {activeTab === 'pages' ? (
                    <TableHeader
                      columns={PAGES_COLUMNS}
                      showCheckbox={true}
                      allChecked={paginatedClusters.length > 0 && paginatedClusters.every(c => selectedClusters.has(c.tokens))}
                      onCheckAll={(checked) => {
                        setSelectedClusters(prev => {
                          const next = new Set(prev);
                          if (checked) {
                            paginatedClusters.forEach(c => next.add(c.tokens));
                          } else {
                            paginatedClusters.forEach(c => next.delete(c.tokens));
                          }
                          return next;
                        });
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
                    {activeTab === 'pages' && paginatedClusters.map((row) => (
                      <ClusterRowView
                        key={row.tokens}
                        row={row}
                        isExpanded={expandedClusters.has(row.pageName)}
                        isSelected={selectedClusters.has(row.tokens)}
                        selectedTokens={selectedTokens}
                        toggleCluster={toggleCluster}
                        onSelect={handleClusterSelect}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        onMiddleClick={handleClusterMiddleClick}
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
                    
                    {activeTab === 'grouped' && paginatedGroupedClusters.map((row) => (
                      <GroupedClusterRowView
                        key={row.id}
                        row={row}
                        isExpanded={expandedGroupedClusters.has(row.id)}
                        expandedSubClusters={expandedGroupedSubClusters}
                        toggleGroup={handleToggleGroup}
                        toggleSubCluster={handleToggleSubCluster}
                        selectedTokens={selectedTokens}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        isGroupSelected={selectedGroups.has(row.id)}
                        selectedSubClusters={selectedSubClusters}
                        onGroupSelect={handleGroupSelect}
                        onSubClusterSelect={handleSubClusterSelect}
                        labelColorMap={labelColorMap}
                        onBlockToken={handleBlockSingleToken}
                        groupActionButton={
                          <button
                            onClick={() => handleApproveGroup(row.groupName)}
                            disabled={isSharedProjectReadOnly}
                            className="w-5 h-5 flex items-center justify-center rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px] font-bold shrink-0"
                            title="Approve group"
                          >
                            {'\u2713'}
                          </button>
                        }
                      />
                    ))}

                    {activeTab === 'approved' && sortedPaginatedApproved.map((group) => (
                      <GroupedClusterRowView
                        key={group.id}
                        row={group}
                        isExpanded={expandedGroupedClusters.has(group.id)}
                        expandedSubClusters={expandedGroupedSubClusters}
                        toggleGroup={handleToggleGroup}
                        toggleSubCluster={handleToggleSubCluster}
                        selectedTokens={selectedTokens}
                        setSelectedTokens={setSelectedTokens}
                        setCurrentPage={setCurrentPage}
                        isGroupSelected={selectedGroups.has(group.id)}
                        selectedSubClusters={selectedSubClusters}
                        onGroupSelect={handleGroupSelect}
                        onSubClusterSelect={handleSubClusterSelect}
                        labelColorMap={labelColorMap}
                        onBlockToken={handleBlockSingleToken}
                        groupActionButton={
                          <button
                            onClick={() => handleUnapproveGroup(group.groupName)}
                            disabled={isSharedProjectReadOnly}
                            className="w-5 h-5 flex items-center justify-center rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[10px] font-bold shrink-0"
                            title="Unapprove group"
                          >
                            ↩
                          </button>
                        }
                      />
                    ))}

                    {activeTab === 'blocked' && sortedBlocked.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((row) => (
                      <tr key={row.keyword} className="hover:bg-red-50/50 transition-colors">
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

              {/* Auto-Group Panel — replaces table when auto-group tab is active */}
              {activeTab === 'auto-group' && (
                <AutoGroupPanel
                  key={activeProjectId || 'no-project'}
                  effectiveClusters={effectiveClusters}
                  onApproveGroups={handleAutoGroupApprove}
                  groupReviewSettingsRef={groupReviewSettingsRef}
                  logAndToast={logAndToast}
                  persistedSuggestions={autoGroupSuggestions}
                  onSuggestionsChange={persistence.updateSuggestions}
                  isProjectBusy={isProjectBusy}
                  isSharedProjectReadOnly={isSharedProjectReadOnly}
                  runWithExclusiveOperation={runWithExclusiveOperation}
                />
              )}

              {activeTab === 'group-auto-merge' && (
                <GroupAutoMergePanel
                  groupedClusters={groupedClusters}
                  approvedGroups={approvedGroups}
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
                        onClick={() => void runWithExclusiveOperation('token-merge', async () => {
                          applyAllAutoMergeRecommendations();
                        })}
                        disabled={isProjectBusy}
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
                                    onClick={() => void runWithExclusiveOperation('token-merge', async () => {
                                      handleUndoMergeParent(ruleRow.ruleId);
                                    })}
                                    disabled={isProjectBusy}
                                    className="w-4 h-4 flex items-center justify-center rounded-full bg-amber-100 text-amber-600 hover:bg-amber-500 hover:text-white transition-colors"
                                    title="Unmerge parent"
                                  >
                                    <span className="text-[10px] font-bold">↩</span>
                                  </button>
                                </td>
                              </tr>

                              {isExpanded && ruleRow.childTokens.map((childToken, childIdx) => {
                                const st = ruleRow.childStats[childToken];
                                return (
                                  <tr key={`${ruleRow.ruleId}::${childToken}`} className={`transition-colors ${childIdx % 2 === 0 ? 'bg-zinc-50/50 hover:bg-zinc-50/70' : 'bg-zinc-100/40 hover:bg-zinc-100/60'}`}>
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
                                        onClick={() => void runWithExclusiveOperation('token-merge', async () => {
                                          handleUndoMergeChild(ruleRow.ruleId, childToken);
                                        })}
                                        disabled={isProjectBusy}
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
                                        onClick={() => void runWithExclusiveOperation('token-merge', async () => {
                                          applyAutoMergeRecommendation(rec.id);
                                        })}
                                        disabled={isProjectBusy}
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
                              title={tokenPagesTooltip(row.token)}
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
  );
}
