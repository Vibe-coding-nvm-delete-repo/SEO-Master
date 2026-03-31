/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Database,
  FileText,
  Folder,
  HelpCircle,
  List,
  Loader2,
  Lock,
  MapPin,
  Navigation,
  Search,
  Settings,
  ShoppingCart,
  UploadCloud,
  X,
} from 'lucide-react';
import ActivityLog from './ActivityLog';
import GroupDataView from './GroupDataView';
import InlineHelpHint from './InlineHelpHint';
import ProjectsTab from './ProjectsTab';
import TopicsSubTab from './TopicsSubTab';
import { countries, ignoredTokens, numberMap, stateMap, stopWords, synonymMap } from './dictionaries';

const tabRailClass = 'flex items-center gap-0.5 bg-zinc-100/80 p-0.5 rounded-lg border border-zinc-200/70';
const subTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all';
const subTabBtnActive =
  'bg-white text-zinc-900 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#6366f1]';
const subTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100/70';

export function ProjectImportBar(props: any) {
  const {
    activeProjectId,
    projects,
    results,
    isProcessing,
    isProjectLoading,
    isProjectBusy,
    isBulkSharedEditBlocked,
    fileName,
    navigateGroupSub,
    handleFileInput,
    reset,
    exportCSV,
    activityLog,
    groupSubTab,
  } = props;

  return (
    <div className="flex flex-wrap items-center justify-between gap-y-1.5 mb-1.5">
      <div className="flex items-center gap-1.5">
        {activeProjectId ? (
          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white border border-zinc-200 rounded-md shadow-sm text-[10px]">
            <Folder className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="font-semibold text-zinc-800 truncate max-w-[150px]">
              {projects.find((project: any) => project.id === activeProjectId)?.name || '...'}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <button type="button" onClick={() => navigateGroupSub('projects')} className="text-[10px] text-zinc-400 hover:text-zinc-600 ml-1">
              Switch
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => navigateGroupSub('projects')} className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 border border-amber-200 rounded-md text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">
            <AlertCircle className="w-3 h-3" /> Select Project
          </button>
        )}
        {activeProjectId && !results && !isProcessing && !isProjectLoading && (
          <label className={`flex items-center gap-1.5 px-2 py-1 text-white rounded-md text-xs font-medium transition-colors ${isBulkSharedEditBlocked ? 'bg-zinc-400 cursor-not-allowed' : 'bg-zinc-900 cursor-pointer hover:bg-zinc-800'}`}>
            <UploadCloud className="w-3 h-3" /> Upload CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileInput} disabled={!activeProjectId || isBulkSharedEditBlocked} />
          </label>
        )}
        {results && fileName && (
          <>
            <span className="text-zinc-300 mx-1">|</span>
            <FileText className="w-3 h-3 text-emerald-600 shrink-0" />
            <span className="text-[11px] text-zinc-500 truncate overflow-hidden">{fileName}</span>
            <button onClick={reset} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 bg-zinc-100 border border-zinc-200 rounded hover:bg-zinc-200 transition-colors">
              <UploadCloud className="w-2.5 h-2.5" /> New
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 transition-colors">
              Export
            </button>
          </>
        )}
      </div>
      <div className={tabRailClass}>
        <button type="button" onClick={() => props.navigateGroupSub('data')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'data' ? subTabBtnActive : subTabBtnInactive}`}>
          <Database className="w-2.5 h-2.5 shrink-0" aria-hidden />Data
        </button>
        <button type="button" onClick={() => props.navigateGroupSub('projects')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'projects' ? subTabBtnActive : subTabBtnInactive}`}>
          <Folder className="w-2.5 h-2.5 shrink-0" aria-hidden />Projects
        </button>
        <button type="button" onClick={() => props.navigateGroupSub('topics')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'topics' ? subTabBtnActive : subTabBtnInactive}`}>
          <List className="w-2.5 h-2.5 shrink-0" aria-hidden />Topics
        </button>
        <button type="button" onClick={() => props.navigateGroupSub('settings')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'settings' ? subTabBtnActive : subTabBtnInactive}`}>
          <Settings className="w-2.5 h-2.5 shrink-0" aria-hidden />Settings
        </button>
        <button type="button" onClick={() => props.navigateGroupSub('log')} className={`${subTabBtnBase} flex items-center gap-1 ${groupSubTab === 'log' ? subTabBtnActive : subTabBtnInactive}`}>
          <List className="w-2.5 h-2.5 shrink-0" aria-hidden />Log {activityLog.length > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({activityLog.length})</span>}
        </button>
      </div>
    </div>
  );
}

export function ProjectBusyBanner({ isProjectBusy, activeProjectId, activeOperation }: any) {
  if (!isProjectBusy || !activeProjectId) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>
        Project busy: {activeOperation?.type ?? 'shared operation'} is running in another client. Shared edits are temporarily blocked until that project-wide operation finishes.
      </span>
    </div>
  );
}

export function CanonicalSyncBanner({ isCanonicalReloading, isSharedProjectReadOnly }: any) {
  if (!isCanonicalReloading || isSharedProjectReadOnly) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span>Shared project is syncing updated canonical state. Routine grouping stays available while the current shared view remains safe.</span>
    </div>
  );
}

export function UploadDropzone(props: any) {
  const { activeProjectId, isBulkSharedEditBlocked, isDragging, handleDragOver, handleDragLeave, handleDrop, handleFileInput, navigateGroupSub } = props;
  return (
    <div
      className={`relative border-2 border-dashed rounded-2xl p-12 transition-all duration-200 ease-in-out flex flex-col items-center justify-center text-center bg-white ${!activeProjectId || isBulkSharedEditBlocked ? 'opacity-50 cursor-not-allowed grayscale' : isDragging ? 'border-indigo-500 bg-indigo-50/50' : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50/50'}`}
      onDragOver={activeProjectId && !isBulkSharedEditBlocked ? handleDragOver : undefined}
      onDragLeave={activeProjectId && !isBulkSharedEditBlocked ? handleDragLeave : undefined}
      onDrop={activeProjectId && !isBulkSharedEditBlocked ? handleDrop : undefined}
    >
      {(!activeProjectId || isBulkSharedEditBlocked) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[1px] rounded-2xl">
          <div className="bg-white p-4 rounded-xl shadow-xl border border-zinc-200 flex flex-col items-center gap-3 max-w-xs">
            <Lock className="w-8 h-8 text-amber-500" />
            {isBulkSharedEditBlocked ? (
              <p className="text-sm font-medium text-zinc-900">Shared project writes are temporarily unavailable.</p>
            ) : (
              <>
                <p className="text-sm font-medium text-zinc-900">Create or select a project first</p>
                <button onClick={() => navigateGroupSub('projects')} className="w-full px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all">
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
        <input type="file" className="sr-only" accept=".csv,text/csv" onChange={handleFileInput} disabled={!activeProjectId || isBulkSharedEditBlocked} />
      </label>
    </div>
  );
}

export function ProcessingStatePanel({ mode, progress, error }: any) {
  if (mode === 'loading') {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-sm">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <h3 className="text-lg font-medium text-zinc-900 mb-1">Loading project...</h3>
        <p className="text-sm text-zinc-500 mb-0">Restoring your uploaded CSV and clustering state.</p>
      </div>
    );
  }
  if (mode === 'processing') {
    return (
      <div className="bg-white border border-zinc-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center shadow-sm">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <h3 className="text-lg font-medium text-zinc-900 mb-1">Processing Keywords...</h3>
        <p className="text-sm text-zinc-500 mb-4">Tokenizing, matching, and clustering your data.</p>
        <div className="w-full max-w-md bg-zinc-100 rounded-full h-2.5 overflow-hidden">
          <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-zinc-400 mt-2">{progress}% Complete</p>
      </div>
    );
  }
  if (mode === 'error' && error) {
    return (
      <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-red-800">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-sm">Processing Error</h4>
          <p className="text-sm mt-1 opacity-90">{error}</p>
        </div>
      </div>
    );
  }
  return null;
}

export function GroupProjectsView(props: any) {
  return <ProjectsTab {...props} />;
}

export function GroupLogView({ activityLog, persistence, addToast }: any) {
  return (
    <div className="max-w-4xl mx-auto mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ActivityLog entries={activityLog} onClear={() => { persistence.clearActivityLog(); addToast('Activity log cleared', 'info'); }} />
    </div>
  );
}

export function GroupTopicsView() {
  return (
    <div className="max-w-6xl mx-auto mt-4">
      <TopicsSubTab />
    </div>
  );
}

export function GroupSettingsView(props: any) {
  const { settingsSubTab, navigateSettingsSub, universalBlockedTokens, setUniversalBlockedTokens } = props;

  return (
    <div className="bg-white rounded-2xl border border-zinc-100 shadow-[0_1px_3px_rgba(0,0,0,0.04)] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="px-6 py-4 border-b border-zinc-100">
        <h2 className="text-base font-semibold text-zinc-900 mb-3">Settings</h2>
        <div className={`${tabRailClass} w-fit`}>
          <button type="button" onClick={() => navigateSettingsSub('general')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'general' ? subTabBtnActive : subTabBtnInactive}`}>General</button>
          <button type="button" onClick={() => navigateSettingsSub('how-it-works')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'how-it-works' ? subTabBtnActive : subTabBtnInactive}`}>How it Works</button>
          <button type="button" onClick={() => navigateSettingsSub('dictionaries')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'dictionaries' ? subTabBtnActive : subTabBtnInactive}`}>Dictionaries</button>
          <button type="button" onClick={() => navigateSettingsSub('blocked')} className={`${subTabBtnBase} text-[11px] ${settingsSubTab === 'blocked' ? subTabBtnActive : subTabBtnInactive}`}>
            Universal Blocked {universalBlockedTokens.size > 0 && <span className="text-[10px] text-zinc-400 ml-0.5">({universalBlockedTokens.size})</span>}
          </button>
        </div>
      </div>

      {settingsSubTab === 'general' && (
        <div className="p-6">
          <p className="text-sm text-zinc-400">General settings coming soon. Group Review settings are available via the gear icon in Pages (Grouped).</p>
        </div>
      )}

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
                  setUniversalBlockedTokens((prev: Set<string>) => new Set([...prev, val]));
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
              {Array.from(universalBlockedTokens as Set<string>).sort().map((token: string) => (
                <span key={token} className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 border border-red-100 rounded-md text-xs font-medium">
                  {token}
                  <button onClick={() => setUniversalBlockedTokens((prev: Set<string>) => { const next = new Set(prev); next.delete(token); return next; })} className="text-red-300 hover:text-red-500 transition-colors">
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

      {settingsSubTab === 'dictionaries' && (
        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 mb-3">Label Detection Rules</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-zinc-700 mb-1.5 flex items-center gap-1.5">
                  <InlineHelpHint text="Question intent / FAQ keyword matches (examples: who, what, where, when, why, how, can, vs., compare, which, etc.)." className="inline-flex items-center cursor-help">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>Stop Words</h4>
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-3 max-h-48 overflow-y-auto flex flex-wrap gap-1">
                {Array.from(stopWords).sort().map((word) => <span key={word} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[10px] text-zinc-500">{word}</span>)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>Ignored Tokens</h4>
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-3 max-h-48 overflow-y-auto flex flex-wrap gap-1">
                {Array.from(ignoredTokens).sort().map((word) => <span key={word} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[10px] text-zinc-500">{word}</span>)}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>Synonym Mapping</h4>
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl max-h-48 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="bg-zinc-100/50 sticky top-0"><tr><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Word</th><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Maps To</th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">{Object.entries(synonymMap).map(([word, replacement]) => <tr key={word}><td className="px-3 py-1 text-zinc-500">{word}</td><td className="px-3 py-1 text-zinc-800 font-medium">{replacement}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>State Normalization</h4>
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl max-h-48 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="bg-zinc-100/50 sticky top-0"><tr><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Full Name</th><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Abbr</th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">{Object.entries(stateMap).map(([state, abbr]) => <tr key={state}><td className="px-3 py-1 text-zinc-500 capitalize">{state}</td><td className="px-3 py-1 text-zinc-800 font-medium uppercase">{abbr}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Number Normalization</h4>
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl max-h-48 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="bg-zinc-100/50 sticky top-0"><tr><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Word</th><th className="px-3 py-1.5 text-left text-zinc-500 font-medium">Digit</th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">{Object.entries(numberMap).map(([word, digit]) => <tr key={word}><td className="px-3 py-1 text-zinc-500">{word}</td><td className="px-3 py-1 text-zinc-800 font-medium">{digit}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Countries (Removed)</h4>
              <div className="bg-zinc-50/50 border border-zinc-100 rounded-xl p-3 max-h-48 overflow-y-auto flex flex-wrap gap-1">
                {Array.from(countries).sort().map((word) => <span key={word} className="px-1.5 py-0.5 bg-white border border-zinc-100 rounded text-[10px] text-zinc-500 capitalize">{word}</span>)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GroupWorkspaceShell(props: any) {
  const { groupSubTab } = props;

  return (
    <>
      <ProjectImportBar {...props} />
      <ProjectBusyBanner {...props} />
      <CanonicalSyncBanner {...props} />
      {groupSubTab === 'data' && <GroupDataView {...props} />}
      {groupSubTab === 'projects' && <GroupProjectsView {...props} />}
      {groupSubTab === 'settings' && <GroupSettingsView {...props} />}
      {groupSubTab === 'log' && <GroupLogView {...props} />}
      {groupSubTab === 'topics' && <GroupTopicsView />}
    </>
  );
}
