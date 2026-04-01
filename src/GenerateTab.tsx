/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { Loader2, Play, Square, Settings, ChevronDown, ChevronRight, Search, Check, AlertCircle, X, Trash2, RotateCcw, Copy, Clock, Download, Zap, ScrollText, RefreshCw, Globe, HelpCircle, Star, Lock, Unlock } from 'lucide-react';
import { useToast } from './ToastContext';
import { reportPersistFailure } from './persistenceErrors';
import InlineHelpHint from './InlineHelpHint';
import { parseH2NamesFromOutput } from './contentPipelineH2';
import {
  APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT,
  appSettingsIdbKey,
  cacheStateLocallyBestEffort,
  deleteAppSettingsDocFieldsRemote,
  emitLocalAppSettingsRowsUpdated,
  loadAppSettingsRows,
  loadCachedState,
  persistAppSettingsDoc,
  persistLocalCachedState,
  persistTrackedState,
  subscribeAppSettingsDoc,
  writeAppSettingsRowsRemote,
} from './appSettingsPersistence';
import {
  ensureProjectGenerateWorkspace,
  scopeGenerateWorkspaceDocId,
} from './generateWorkspaceScope';
import { PRIMARY_COLUMN_WIDTH_PRESETS, type PrimaryColumnPreset } from './generateTablePresets';
import {
  buildOpenRouterTimeoutError,
  OPENROUTER_REQUEST_TIMEOUT_MS,
  resolveOpenRouterAbortError,
  runWithOpenRouterTimeout,
} from './openRouterTimeout';
import { makeAppSettingsChannel } from './cloudSyncStatus';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  normalizePreferredOpenRouterModel,
} from './modelDefaults';
import { sanitizeJsonForFirestore } from './projectStorage';
import { useLatestPersistQueue } from './useLatestPersistQueue';
import { CELL, TABLE_TBODY_ZEBRA_CLASS } from './tableConstants';
import type { ReasoningLevel } from './SettingsControls';
import { hasGenerateLifecycleActivity, hasTrueFlag } from './runControlState';

const SHARED_SCROLL_CONTAINER_STYLE: React.CSSProperties = {
  scrollbarGutter: 'stable both-edges',
  boxSizing: 'border-box',
};

// ============ Types ============

// Per-slot data (same shape as primary row fields minus `id`)
interface GenerateSlotData {
  status: 'pending' | 'generating' | 'generated' | 'error';
  input: string;
  output: string;
  error?: string;
  generatedAt?: string;
  durationMs?: number;
  retries?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
}

const EMPTY_SLOT: GenerateSlotData = { status: 'pending', input: '', output: '' };

const getSlot = (row: GenerateRow, slotId: string): GenerateSlotData =>
  row.slots?.[slotId] ?? EMPTY_SLOT;

/**
 * Build externalData for a slot's buildInput() by extracting outputs from
 * other slots on the same row. Currently supports h2Names (from h2names slot).
 */
const buildExternalData = (row: GenerateRow): Record<string, string[]> | undefined => {
  const h2Output = row.slots?.h2names?.output;
  if (!h2Output?.trim()) return undefined;
  // Parse H2 names from output â€” supports bullet points (â€¢, -, *) with optional rank suffix
  const h2Names = h2Output
    .split('\n')
    .map(line => line.replace(/^[\sâ€¢\-*]+/, '').replace(/\s*-\s*\d+(\.\d+)?\s*$/, '').trim())
    .filter(line => line.length > 0 && !line.toLowerCase().startsWith('cross-check'));
  if (h2Names.length === 0) return undefined;
  return { h2Names };
};

const buildExternalDataShared = (row: GenerateRow): Record<string, string[]> | undefined => {
  const h2Output = row.slots?.h2names?.output;
  if (!h2Output?.trim()) return undefined;
  const h2Names = parseH2NamesFromOutput(h2Output);
  if (h2Names.length === 0) return undefined;
  return { h2Names };
};

export function getExtraColumnValue(
  row: {
    metadata?: Record<string, string>;
    slots?: Record<string, { output?: string }>;
  },
  key: string,
): string {
  if (key === 'h2NamesPreview') {
    return parseH2NamesFromOutput(row.slots?.h2names?.output ?? '').join(' | ');
  }
  return row.metadata?.[key] ?? '';
}

interface GenerateRow {
  id: string;
  status: 'pending' | 'generating' | 'generated' | 'error';
  input: string;
  output: string;
  error?: string;
  generatedAt?: string; // ISO timestamp with full date+time
  durationMs?: number; // how long this row took to generate
  retries?: number; // how many times this row was retried due to len range
  promptTokens?: number;
  metadata?: Record<string, string>; // extra read-only display columns (e.g., pageName, order, h2Name)
  completionTokens?: number;
  cost?: number; // USD cost for this row
  slots?: Record<string, GenerateSlotData>; // additional prompt slots
}

// Prompt slot configuration â€” defines additional column groups in the table
export interface PromptSlotConfig {
  id: string;           // e.g., 'guidelines'
  label: string;        // e.g., 'Page Guidelines' (column group header)
  promptLabel: string;  // e.g., 'Page Guidelines Template' (settings tab label)
  defaultPrompt: string;
  validatorLabel?: string;
  defaultValidator?: string;
  validatorDescription?: string;
  icon?: React.ReactNode;
  responseFormat?: 'text' | 'json_object';
  clearMetadataKeysOnReset?: string[];
  // Builds auto-input for this slot per row.
  // template = current prompt template from settings (user-editable)
  // primaryOutput = output from the primary slot for the same row
  // externalData = data from other pipeline steps (e.g., h2Names) â€” empty until those steps exist
  // rowInput = the row's original input (e.g., keywords) â€” available for slots that need to reference it
  // row = full current row, including metadata, for stages that need multi-output references
  buildInput?: (template: string, primaryOutput: string, externalData?: Record<string, string[]>, rowInput?: string, row?: GenerateRow) => { input: string; error?: string };
  transformOutput?: (args: { rawOutput: string; row: GenerateRow }) => {
    output: string;
    metadata?: Record<string, string>;
  };
}

interface LogEntry {
  id: string;
  timestamp: string; // ISO
  action: string;
  details: string;
  model?: string;
  outputCount?: number;
  errorCount?: number;
  throttledCount?: number;
  elapsedMs?: number;
  cost?: number;
  concurrency?: number;
  avgPerSec?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface GenerateSettings {
  apiKey: string;
  selectedModel: string;
  selectedModelLocked: boolean;
  selectedModelByView?: Record<string, string>;
  selectedModelLockedByView?: Record<string, boolean>;
  rateLimit: number; // 1-100 concurrent
  minLen: number; // min output character count (0 = no minimum)
  maxLen: number; // max output character count (0 = no maximum)
  maxRetries: number; // max retries per row for len enforcement
  temperature: number; // 0.0-2.0, default 1.0
  maxTokens: number; // 0 = no limit, otherwise max output tokens
  reasoning: false | ReasoningLevel;
  webSearch: boolean; // enable OpenRouter web search plugin
  prompt: string; // system prompt prepended to each row's input
  slotPrompts?: Record<string, string>; // per-slot prompts keyed by slot ID
  slotValidators?: Record<string, string>; // per-slot validator/contracts keyed by slot ID
}

interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
}

export function hasActiveGeneration(
  isPrimaryGenerating: boolean,
  slotGeneratingState: Record<string, boolean>,
): boolean {
  return isPrimaryGenerating || hasTrueFlag(slotGeneratingState);
}

export function classifyRowsSnapshotHandling(opts: {
  incomingUpdatedAt: string;
  lastWrittenAt: string;
  latestKnownUpdatedAt: string;
  isPrimaryGenerating: boolean;
  slotGeneratingState: Record<string, boolean>;
  hasResolvedCurrentRows?: boolean;
}): 'ignore' | 'defer' | 'apply' {
  if (
    opts.incomingUpdatedAt &&
    opts.latestKnownUpdatedAt &&
    opts.incomingUpdatedAt <= opts.latestKnownUpdatedAt &&
    opts.hasResolvedCurrentRows
  ) {
    return 'ignore';
  }
  if (opts.incomingUpdatedAt && opts.incomingUpdatedAt === opts.lastWrittenAt) return 'ignore';
  if (hasActiveGeneration(opts.isPrimaryGenerating, opts.slotGeneratingState)) return 'defer';
  return 'apply';
}

interface GenerationStats {
  totalRows: number;
  generatedCount: number;
  errorCount: number;
  pendingCount: number;
  queuedCount: number;
  generatingCount: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

function emptyGenerationStats(): GenerationStats {
  return {
    totalRows: 0,
    generatedCount: 0,
    errorCount: 0,
    pendingCount: 0,
    queuedCount: 0,
    generatingCount: 0,
    totalCost: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  };
}

export function buildPrimaryGenerationStats(rows: GenerateRow[]): GenerationStats {
  const stats = emptyGenerationStats();
  for (const row of rows) {
    const hasInput = row.input.trim().length > 0;
    if (hasInput) stats.totalRows++;
    switch (row.status) {
      case 'generated':
        stats.generatedCount++;
        break;
      case 'error':
        stats.errorCount++;
        if (hasInput) stats.queuedCount++;
        break;
      case 'generating':
        stats.generatingCount++;
        break;
      case 'pending':
        if (hasInput) {
          stats.pendingCount++;
          stats.queuedCount++;
        }
        break;
    }
    stats.totalCost += row.cost || 0;
    stats.totalPromptTokens += row.promptTokens || 0;
    stats.totalCompletionTokens += row.completionTokens || 0;
  }
  return stats;
}

export function buildSlotGenerationStats(rows: GenerateRow[], slotId: string): GenerationStats {
  const stats = emptyGenerationStats();
  for (const row of rows) {
    const slotData = getSlot(row, slotId);
    const hasInput = slotData.input.trim().length > 0;
    if (hasInput) stats.totalRows++;
    switch (slotData.status) {
      case 'generated':
        stats.generatedCount++;
        break;
      case 'error':
        stats.errorCount++;
        if (hasInput) stats.queuedCount++;
        break;
      case 'generating':
        stats.generatingCount++;
        break;
      case 'pending':
        if (hasInput) {
          stats.pendingCount++;
          stats.queuedCount++;
        }
        break;
    }
    stats.totalCost += slotData.cost || 0;
    stats.totalPromptTokens += slotData.promptTokens || 0;
    stats.totalCompletionTokens += slotData.completionTokens || 0;
  }
  return stats;
}

export function applyPrimaryInputEdit(
  row: GenerateRow,
  nextInput: string,
  clearMetadataKeysOnReset: string[] = [],
  promptSlots: PromptSlotConfig[] = [],
): GenerateRow {
  const nextMetadata = { ...(row.metadata ?? {}) };
  for (const key of clearMetadataKeysOnReset) delete nextMetadata[key];
  for (const slot of promptSlots) {
    for (const key of slot.clearMetadataKeysOnReset ?? []) delete nextMetadata[key];
  }
  const nextRow: GenerateRow = {
    ...row,
    input: nextInput,
    status: 'pending',
    output: '',
    error: undefined,
    generatedAt: undefined,
    durationMs: undefined,
    retries: undefined,
    promptTokens: undefined,
    completionTokens: undefined,
    cost: undefined,
    metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
  };
  if (row.slots) {
    const clearedSlots: Record<string, GenerateSlotData> = {};
    for (const slotId of Object.keys(row.slots)) {
      clearedSlots[slotId] = { ...EMPTY_SLOT };
    }
    nextRow.slots = clearedSlots;
  }
  return nextRow;
}

function hasPrimaryRowContent(row: GenerateRow): boolean {
  return (
    row.status !== 'pending' ||
    row.input.trim().length > 0 ||
    row.output.trim().length > 0 ||
    Boolean(row.error) ||
    Boolean(row.generatedAt) ||
    row.durationMs !== undefined ||
    row.retries !== undefined ||
    row.promptTokens !== undefined ||
    row.completionTokens !== undefined ||
    row.cost !== undefined
  );
}

function hasResolvedPrimaryRowState(row: GenerateRow): boolean {
  return (
    row.status !== 'pending' ||
    row.output.trim().length > 0 ||
    Boolean(row.error) ||
    Boolean(row.generatedAt) ||
    row.durationMs !== undefined ||
    row.retries !== undefined ||
    row.promptTokens !== undefined ||
    row.completionTokens !== undefined ||
    row.cost !== undefined
  );
}

function hasSlotContent(
  slotData: GenerateSlotData | undefined,
  opts: { includeInput: boolean },
): boolean {
  if (!slotData) return false;
  const input = typeof slotData.input === 'string' ? slotData.input : '';
  const output = typeof slotData.output === 'string' ? slotData.output : '';
  return (
    slotData.status !== 'pending' ||
    (opts.includeInput && input.trim().length > 0) ||
    output.trim().length > 0 ||
    Boolean(slotData.error) ||
    Boolean(slotData.generatedAt) ||
    slotData.durationMs !== undefined ||
    slotData.retries !== undefined ||
    slotData.promptTokens !== undefined ||
    slotData.completionTokens !== undefined ||
    slotData.cost !== undefined
  );
}

export function shouldSkipUpstreamEmptyApply(nextRows: GenerateRow[], currentRows: GenerateRow[]): boolean {
  return nextRows.length === 0 && currentRows.some(hasPrimaryRowContent);
}

export function shouldSkipEquivalentUpstreamApply(nextRows: GenerateRow[], currentRows: GenerateRow[]): boolean {
  if (nextRows.length === 0 || nextRows.length !== currentRows.length) return false;
  let hasMaterialCurrentState = false;
  for (let index = 0; index < nextRows.length; index += 1) {
    const nextRow = nextRows[index];
    const currentRow = currentRows[index];
    if (!currentRow) return false;
    if (nextRow.id !== currentRow.id) return false;
    if (nextRow.input.trim() !== currentRow.input.trim()) return false;
    if (currentRow.status !== 'pending' || currentRow.output.trim() || currentRow.error?.trim()) {
      hasMaterialCurrentState = true;
    }
  }
  return hasMaterialCurrentState;
}

export function countClearableRowsForView(
  rows: GenerateRow[],
  tableView: 'primary' | string,
  promptSlots: PromptSlotConfig[] = [],
): number {
  if (tableView === 'primary') {
    return rows.filter(hasPrimaryRowContent).length;
  }
  const slotConfig = promptSlots.find((slot) => slot.id === tableView);
  const includeInput = !slotConfig?.buildInput;
  return rows.filter((row) => hasSlotContent(row.slots?.[tableView], { includeInput })).length;
}

function clearSlotRowForView(args: {
  row: GenerateRow;
  slotConfig: PromptSlotConfig;
  slotPrompt: string;
}): GenerateRow {
  const { row, slotConfig, slotPrompt } = args;
  const currentSlot = row.slots?.[slotConfig.id];
  const includeInput = !slotConfig.buildInput;
  if (!hasSlotContent(currentSlot, { includeInput })) {
    return row;
  }

  const nextMetadata = { ...(row.metadata ?? {}) };
  for (const key of slotConfig.clearMetadataKeysOnReset ?? []) delete nextMetadata[key];

  const refreshedInput = slotConfig.buildInput
    ? slotConfig.buildInput(
        slotPrompt,
        row.output,
        buildExternalDataShared(row),
        row.input,
        row,
      ).input || ''
    : '';

  const nextSlots = { ...(row.slots ?? {}) };
  nextSlots[slotConfig.id] = {
    ...EMPTY_SLOT,
    input: refreshedInput,
  };

  return {
    ...row,
    metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
    slots: nextSlots,
  };
}

export function clearRowsForView(args: {
  rows: GenerateRow[];
  tableView: 'primary' | string;
  promptSlots?: PromptSlotConfig[];
  slotPrompts?: Record<string, string>;
  storageKey?: string;
  createPrimaryRows?: () => GenerateRow[];
}): GenerateRow[] {
  const {
    rows,
    tableView,
    promptSlots = [],
    slotPrompts = {},
    storageKey = '',
    createPrimaryRows = () => makeEmptyRows(20),
  } = args;

  if (tableView === 'primary') {
    return createPrimaryRows();
  }

  const slotConfig = promptSlots.find((slot) => slot.id === tableView);
  if (!slotConfig) {
    return rows;
  }

  const slotPrompt = normalizeSlotPromptForStorageKey(storageKey, slotConfig, slotPrompts[slotConfig.id]).prompt;
  return rows.map((row) => clearSlotRowForView({
    row,
    slotConfig,
    slotPrompt,
  }));
}

export function selectActiveGenerationSource(opts: {
  isPrimaryGenerating: boolean;
  slotGeneratingState: Record<string, boolean>;
  promptSlotIds: string[];
  tableView: 'primary' | string;
}): 'primary' | string {
  const activeSlots = opts.promptSlotIds.filter((slotId) => opts.slotGeneratingState[slotId]);
  if (activeSlots.length === 1) return activeSlots[0];
  if (activeSlots.length > 1) {
    if (opts.tableView !== 'primary' && activeSlots.includes(opts.tableView)) return opts.tableView;
    return activeSlots[0];
  }
  if (opts.isPrimaryGenerating) return 'primary';
  if (opts.tableView !== 'primary' && opts.promptSlotIds.includes(opts.tableView)) return opts.tableView;
  return 'primary';
}

export function shouldDiscardGenerationResult(opts: {
  stopRequested: boolean;
  signalAborted: boolean;
}): boolean {
  return opts.stopRequested || opts.signalAborted;
}

const PAGE_GUIDE_PROMPT_POLICY_MARKERS = [
  'Never recommend tables, comparison tables, tabular layouts',
  '"formatting" must never recommend tables',
];

const PAGE_GUIDE_VALIDATOR_POLICY_MARKERS = [
  'must not recommend tables',
  'table-style format',
];

const H2_CONTENT_PROMPT_POLICY_MARKERS = [
  'Never use tables, comparison tables, rows/columns, tabular layouts',
  'use paragraphs, bullets, or numbered steps instead',
];

function includesPromptPolicyMarkers(raw: string, markers: string[]): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && markers.every((marker) => trimmed.includes(marker));
}

function normalizePrimaryPromptForStorageKey(
  storageKey: string,
  defaultPrompt: string,
  rawPrompt: string | undefined,
): { prompt: string; didMigratePromptPolicy: boolean } {
  let prompt = typeof rawPrompt === 'string' && rawPrompt.trim()
    ? rawPrompt
    : defaultPrompt;
  let didMigratePromptPolicy = false;

  if (
    storageKey === '_h2_content' &&
    !includesPromptPolicyMarkers(prompt, H2_CONTENT_PROMPT_POLICY_MARKERS)
  ) {
    prompt = defaultPrompt;
    didMigratePromptPolicy = true;
  }

  return { prompt, didMigratePromptPolicy };
}

function normalizeSlotPromptForStorageKey(
  storageKey: string,
  slot: PromptSlotConfig,
  rawPrompt: string | undefined,
): {
  prompt: string;
  didMigrateLegacyPrompt: boolean;
  didMigratePromptPolicy: boolean;
  didMigratePageGuidePrompt: boolean;
} {
  let prompt = typeof rawPrompt === 'string' && rawPrompt.trim()
    ? rawPrompt
    : slot.defaultPrompt;

  const isLegacyH2NamesPrompt =
    storageKey === '_page_names' &&
    slot.id === 'h2names' &&
    (
      prompt.includes('Ã¢â‚¬Â¢ h2 name') ||
      prompt.includes('After the list, perform a cross-check') ||
      !prompt.includes('"h2s"') ||
      !prompt.includes('Return ONLY one valid JSON object') ||
      !prompt.includes('"order"') ||
      !prompt.includes('"h2"')
    );

  const isLegacyPageGuidePrompt =
    storageKey === '_page_names' &&
    slot.id === 'guidelines' &&
    (
      prompt.includes('Return ONLY a JSON array') ||
      !prompt.includes('"guidelines"') ||
      !prompt.includes('Return ONLY one valid JSON object')
    );

  const isPolicyStalePageGuidePrompt =
    storageKey === '_page_names' &&
    slot.id === 'guidelines' &&
    !includesPromptPolicyMarkers(prompt, PAGE_GUIDE_PROMPT_POLICY_MARKERS);

  const didMigrateLegacyPrompt = isLegacyH2NamesPrompt || isLegacyPageGuidePrompt;
  const didMigratePageGuidePrompt = isLegacyPageGuidePrompt || isPolicyStalePageGuidePrompt;
  const didMigratePromptPolicy = isPolicyStalePageGuidePrompt;

  if (didMigrateLegacyPrompt || didMigratePromptPolicy) {
    prompt = slot.defaultPrompt;
  }

  return {
    prompt,
    didMigrateLegacyPrompt,
    didMigratePromptPolicy,
    didMigratePageGuidePrompt,
  };
}

function normalizeSlotValidatorForStorageKey(
  storageKey: string,
  slot: PromptSlotConfig,
  rawValidator: string | undefined,
): { validator?: string; didMigratePromptPolicy: boolean } {
  if (!slot.validatorLabel || typeof slot.defaultValidator !== 'string') {
    return { validator: undefined, didMigratePromptPolicy: false };
  }

  let validator = typeof rawValidator === 'string' && rawValidator.trim()
    ? rawValidator
    : slot.defaultValidator;
  let didMigratePromptPolicy = false;

  if (
    storageKey === '_page_names' &&
    slot.id === 'guidelines' &&
    !includesPromptPolicyMarkers(validator, PAGE_GUIDE_VALIDATOR_POLICY_MARKERS)
  ) {
    validator = slot.defaultValidator;
    didMigratePromptPolicy = true;
  }

  return { validator, didMigratePromptPolicy };
}

export type GenerateRunPhase = 'idle' | 'running' | 'stopping' | 'persisting';

export function resolveGenerateControlModeFromPhase(phase: GenerateRunPhase): 'generate' | 'stop' | 'saving' {
  switch (phase) {
    case 'running':
    case 'stopping':
      return 'stop';
    case 'persisting':
      return 'saving';
    default:
      return 'generate';
  }
}

export async function waitForDelayOrAbort(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  return await new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve(true);
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      resolve(false);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export function supportsGenerateOnlineToggle(_storageKey = ''): boolean {
  return true;
}

const GENERATE_CACHE_PREFIX = 'kwg_generate_cache';
const rowsCacheKey = (docId: string) => `${GENERATE_CACHE_PREFIX}:rows:${docId}`;
const settingsCacheKey = (docId: string) => `${GENERATE_CACHE_PREFIX}:settings:${docId}`;
// SECURITY: API key stored ONLY in localStorage â€” never in IDB or Firestore
const SHARED_API_KEY_CACHE_KEY = `${GENERATE_CACHE_PREFIX}:apiKeyShared`;
const SHARED_API_KEY_EVENT = `${GENERATE_CACHE_PREFIX}:apiKeySharedChanged`;
const legacyApiKeyCacheKey = (suffix: string) => `${GENERATE_CACHE_PREFIX}:apiKey${suffix || '_1'}`;
const logsCacheKey = (docId: string) => `${GENERATE_CACHE_PREFIX}:logs:${docId}`;
const viewStateCacheKey = (docId: string) => `${GENERATE_CACHE_PREFIX}:view:${docId}`;
const activeSubTabCacheKey = `${GENERATE_CACHE_PREFIX}:active_subtab`;
const compactTabRailClass = 'flex items-center gap-0.5 bg-zinc-100/80 p-0.5 rounded-lg border border-zinc-200/70 w-fit';
const flowTabRailClass = 'flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200/70 bg-zinc-50/90 px-2 py-1.5';
const compactTabBtnBase = 'px-2.5 py-1 text-xs font-medium rounded-md transition-all';
const compactTabBtnActive = 'bg-white text-zinc-900 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#6366f1]';
const compactTabBtnInactive = 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100/70';
const toTestIdSegment = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

const makeEmptyRows = (count: number): GenerateRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `row_${i}`,
    status: 'pending' as const,
    input: '',
    output: '',
  }));

const makeFreshEmptyRows = (count: number): GenerateRow[] => {
  const stamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `row_${stamp}_${i}`,
    status: 'pending' as const,
    input: '',
    output: '',
  }));
};

function readSharedGenerateApiKey(storageKey: string): string {
  try {
    const shared = localStorage.getItem(SHARED_API_KEY_CACHE_KEY)?.trim() || '';
    if (shared) return shared;
    const legacy = localStorage.getItem(legacyApiKeyCacheKey(storageKey))?.trim() || '';
    if (legacy) {
      localStorage.setItem(SHARED_API_KEY_CACHE_KEY, legacy);
      return legacy;
    }
  } catch {
    // Ignore localStorage read/write failures.
  }
  return '';
}

export function resolveRequestApiKey(currentApiKey: string, storageKey: string): string {
  const sharedApiKey = readSharedGenerateApiKey(storageKey);
  if (sharedApiKey) return sharedApiKey;
  return currentApiKey.trim();
}

export function shouldPersistSharedGenerateApiKey(lastPersistedApiKey: string, nextApiKey: string): boolean {
  return lastPersistedApiKey !== nextApiKey;
}

export function preferExistingGenerateApiKey(currentApiKey: string, incomingApiKey: string): string {
  return currentApiKey.trim() ? currentApiKey : incomingApiKey.trim();
}

const FINALIZE_PERSIST_TIMEOUT_MS = 10_000;

export async function awaitPersistWithTimeout(
  persist: () => Promise<void>,
  timeoutMs = FINALIZE_PERSIST_TIMEOUT_MS,
): Promise<{ timedOut: boolean; error: Error | null }> {
  const persistResultPromise = persist()
    .then<{ timedOut: boolean; error: Error | null }>(() => ({ timedOut: false, error: null }))
    .catch<{ timedOut: boolean; error: Error | null }>((error: unknown) => ({
      timedOut: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }));

  const timeoutPromise = new Promise<{ timedOut: boolean; error: Error | null }>((resolve) => {
    setTimeout(() => resolve({ timedOut: true, error: null }), timeoutMs);
  });

  return Promise.race([persistResultPromise, timeoutPromise]);
}

export function preferExistingSelectedModel(current: string, incoming: string): string {
  const currentTrimmed = current.trim();
  if (currentTrimmed) return currentTrimmed;
  return incoming.trim();
}

export function resolveHydratedSelectedModel(current: string, incoming: string, incomingLocked: boolean): string {
  if (incomingLocked) return incoming.trim();
  return preferExistingSelectedModel(current, incoming);
}

export function shouldApplySharedSelectedModel(currentLocked: boolean): boolean {
  return !currentLocked;
}

export const PRIMARY_MODEL_SCOPE = 'primary';

export function getSelectedModelForScope(settings: GenerateSettings, scope: string): string {
  const scoped = settings.selectedModelByView?.[scope]?.trim();
  if (scoped) return scoped;
  return settings.selectedModel.trim();
}

export function isSelectedModelLockedForScope(settings: GenerateSettings, scope: string): boolean {
  if (scope === PRIMARY_MODEL_SCOPE) return settings.selectedModelLocked;
  return settings.selectedModelLockedByView?.[scope] ?? false;
}

export function withScopedSelectedModel(settings: GenerateSettings, scope: string, modelId: string): GenerateSettings {
  const nextScoped = { ...(settings.selectedModelByView ?? {}), [scope]: modelId };
  if (scope === PRIMARY_MODEL_SCOPE) {
    return { ...settings, selectedModel: modelId, selectedModelByView: nextScoped };
  }
  return { ...settings, selectedModelByView: nextScoped };
}

export function withScopedSelectedModelLock(settings: GenerateSettings, scope: string, locked: boolean): GenerateSettings {
  const nextLockedByView = { ...(settings.selectedModelLockedByView ?? {}), [scope]: locked };
  if (scope === PRIMARY_MODEL_SCOPE) {
    return {
      ...settings,
      selectedModelLocked: locked,
      selectedModelLockedByView: nextLockedByView,
    };
  }
  return {
    ...settings,
    selectedModelLockedByView: nextLockedByView,
  };
}

export function mergeHydratedScopedModelState(current: GenerateSettings, incoming: GenerateSettings): Pick<
  GenerateSettings,
  'selectedModel' | 'selectedModelLocked' | 'selectedModelByView' | 'selectedModelLockedByView'
> {
  const currentModels: Record<string, string> = {
    ...(current.selectedModelByView ?? {}),
  };
  const incomingModels: Record<string, string> = {
    ...(incoming.selectedModelByView ?? {}),
  };
  const currentLocks: Record<string, boolean> = {
    ...(current.selectedModelLockedByView ?? {}),
  };
  const incomingLocks: Record<string, boolean> = {
    ...(incoming.selectedModelLockedByView ?? {}),
  };
  if (current.selectedModel.trim()) currentModels[PRIMARY_MODEL_SCOPE] = current.selectedModel.trim();
  if (incoming.selectedModel.trim()) incomingModels[PRIMARY_MODEL_SCOPE] = incoming.selectedModel.trim();
  currentLocks[PRIMARY_MODEL_SCOPE] = current.selectedModelLocked;
  incomingLocks[PRIMARY_MODEL_SCOPE] = incoming.selectedModelLocked;

  const scopes = new Set([
    ...Object.keys(currentModels),
    ...Object.keys(incomingModels),
    ...Object.keys(currentLocks),
    ...Object.keys(incomingLocks),
  ]);

  const nextModels: Record<string, string> = {};
  const nextLocks: Record<string, boolean> = {};

  scopes.forEach((scope) => {
    const currentModel = currentModels[scope]?.trim() ?? '';
    const incomingModel = incomingModels[scope]?.trim() ?? '';
    const incomingLocked = incomingLocks[scope] ?? false;
    const currentLocked = currentLocks[scope] ?? false;
    const mergedModel = incomingLocked
      ? incomingModel
      : preferExistingSelectedModel(currentModel, incomingModel);
    const mergedLocked = !!mergedModel && (incomingLocked ? true : currentLocked);

    if (mergedModel) nextModels[scope] = mergedModel;
    if (mergedLocked) nextLocks[scope] = true;
  });

  const primaryModel = nextModels[PRIMARY_MODEL_SCOPE] ?? '';
  const primaryLocked = nextLocks[PRIMARY_MODEL_SCOPE] ?? false;
  return {
    selectedModel: primaryModel,
    selectedModelLocked: primaryLocked,
    selectedModelByView: nextModels,
    selectedModelLockedByView: nextLocks,
  };
}

export function hydrateGenerateSettings(current: GenerateSettings, incoming: GenerateSettings): GenerateSettings {
  return {
    ...incoming,
    apiKey: preferExistingGenerateApiKey(current.apiKey, incoming.apiKey),
    ...mergeHydratedScopedModelState(current, incoming),
  };
}

export function shouldAutoSelectDefaultModel(opts: {
  settingsLoaded: boolean;
  firestoreLoaded: boolean;
  sharedSelectedModelStorageKey?: string;
  settings: GenerateSettings;
  scope: string;
}): boolean {
  if (!opts.settingsLoaded || !opts.firestoreLoaded) return false;
  if (opts.sharedSelectedModelStorageKey) return false;
  if (isSelectedModelLockedForScope(opts.settings, opts.scope)) return false;
  return !getSelectedModelForScope(opts.settings, opts.scope).trim();
}

export function buildGenerateTimeoutError(timeoutMs: number): string {
  return buildOpenRouterTimeoutError(timeoutMs);
}

export function resolveGenerateAbortError(opts: {
  parentAborted: boolean;
  timedOut: boolean;
  timeoutMs: number;
}): string {
  return resolveOpenRouterAbortError(opts);
}

// ============ Tooltip helper ============
function Tip({ text }: { text: string }) {
  return (
    <span className="inline-flex ml-0.5 align-middle cursor-help">
      <InlineHelpHint
        text={text}
        className="inline-flex items-center"
        ariaLabel={text}
      >
        <HelpCircle className="w-3 h-3 text-zinc-300 hover:text-zinc-500 transition-colors" />
      </InlineHelpHint>
    </span>
  );
}

function HeaderCellLabel({
  label,
  tooltip,
  align = 'left',
}: {
  label: string;
  tooltip?: string;
  align?: 'left' | 'center' | 'right';
}) {
  const justifyClass = align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start';
  return (
    <div className={`flex max-w-full items-center gap-0.5 overflow-hidden ${justifyClass}`}>
      <span className="min-w-0 truncate">{label}</span>
      {tooltip ? <span className="shrink-0"><Tip text={tooltip} /></span> : null}
    </div>
  );
}

function FlowTabButton({
  active,
  icon,
  label,
  locked = false,
  disabled = false,
  disabledReason,
  testId,
  onClick,
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: string;
  locked?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  testId: string;
  onClick: () => void;
}) {
  const stateClass = disabled
    ? active
      ? 'bg-zinc-100 text-zinc-600 border border-zinc-200 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#a1a1aa] cursor-not-allowed'
      : 'bg-zinc-50 text-zinc-400 border border-zinc-200 cursor-not-allowed'
    : locked
    ? active
      ? 'bg-zinc-200 text-zinc-700 border border-zinc-300 shadow-[0_1px_2px_0_rgba(0,0,0,0.05),inset_0_-2px_0_0_#a1a1aa]'
      : 'bg-zinc-100 text-zinc-400 border border-zinc-200 hover:bg-zinc-200/80'
    : active
      ? compactTabBtnActive
      : compactTabBtnInactive;

  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      disabled={disabled}
      className={`${compactTabBtnBase} inline-flex items-center gap-1.5 ${stateClass}`}
      title={disabledReason || (locked ? `${label} is locked until this stage is implemented.` : label)}
    >
      {icon ? <span className="inline-flex items-center shrink-0">{icon}</span> : null}
      <span>{label}</span>
      {locked ? <Lock className="w-3 h-3 shrink-0" /> : null}
    </button>
  );
}

// ============ Memoized Row Component (prevents re-render of unchanged rows) ============
interface GenerateRowComponentProps {
  row: GenerateRow;
  origIdx: number;
  isExpanded: boolean;
  isBusy: boolean; // any active work in this instance â€” blocks row mutation controls
  isCopied: boolean;
  minLen: number;
  maxLen: number;
  onInputChange: (rowId: string, value: string) => void;
  onPaste: (e: React.ClipboardEvent, origIdx: number) => void;
  onClearCell: (rowId: string) => void;
  onCopyOutput: (rowId: string, text: string) => void;
  onToggleExpand: (rowId: string) => void;
  onRetry: (rowId: string) => void;
  // Slot support
  slotConfigs?: PromptSlotConfig[];
  slotBusy?: Record<string, boolean>; // per-slot isGenerating state
  slotCopied?: string | null; // "slotId:rowId" if a slot output was just copied
  onSlotCopyOutput?: (slotId: string, rowId: string, text: string) => void;
  onSlotRetry?: (slotId: string, rowId: string) => void;
  onSlotToggleExpand?: (key: string) => void;
  expandedSlotKeys?: Set<string>; // "slotId:rowId" keys
  // View filtering â€” when set, only render cells for this view
  tableView?: 'primary' | string; // 'primary' or a slot id
  // Extra metadata columns (read-only display)
  extraColumns?: ExtraColumnDef[];
  lockMetadataKey?: string;
}

const statusColorMap: Record<GenerateRow['status'], string> = {
  pending: 'bg-zinc-100 text-zinc-500',
  generating: 'bg-amber-100 text-amber-700',
  generated: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

const formatDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  } catch { return iso; }
};

// Renders output cell content for both primary and slot cells
function OutputCellContent({ status, output, error, isExpanded }: { status: GenerateSlotData['status']; output: string; error?: string; isExpanded: boolean }) {
  if (status === 'error' && output) {
    return isExpanded ? (
      <div>
        <div className="text-[12px] text-zinc-700 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto py-1 leading-relaxed">{output}</div>
        <div className="text-[10px] text-red-500 mt-1 truncate" title={error}>{error}</div>
      </div>
    ) : (
      <div>
        <span className="text-[12px] text-zinc-700 truncate block">{output}</span>
        <span className="text-[10px] text-red-500 truncate block" title={error}>{error}</span>
      </div>
    );
  }
  if (status === 'error') {
    return <span className={`text-[11px] text-red-600 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate block'}`}>{error}</span>;
  }
  if (isExpanded && output) {
    return <div className="text-[12px] text-zinc-700 whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto py-1 leading-relaxed">{output}</div>;
  }
  return <span className="text-[12px] text-zinc-700 truncate block">{output || <span className="text-zinc-300">â€”</span>}</span>;
}

const GenerateRowComponent = React.memo(function GenerateRowComponent({
  row, origIdx, isExpanded, isBusy, isCopied, onInputChange, onPaste, onClearCell, onCopyOutput, onToggleExpand, onRetry,
  slotConfigs, slotBusy, slotCopied, onSlotCopyOutput, onSlotRetry, onSlotToggleExpand, expandedSlotKeys,
  tableView, extraColumns, lockMetadataKey,
}: GenerateRowComponentProps) {
  const showPrimary = !tableView || tableView === 'primary';
  const activeSlotId = tableView && tableView !== 'primary' ? tableView : null;
  const anySlotGenerating = slotConfigs?.some(s => getSlot(row, s.id).status === 'generating');
  const lockReason = lockMetadataKey ? row.metadata?.[lockMetadataKey] : undefined;
  const isLocked = Boolean(lockReason);
  return (
    <tr
      data-testid={`generate-row-${row.id}`}
      className={`${isExpanded ? '' : 'h-[32px]'} transition-colors ${isLocked ? 'bg-zinc-100/90' : 'hover:bg-zinc-50/50'} ${row.status === 'generating' || anySlotGenerating ? 'bg-amber-50/30' : ''}`}
    >
      {/* Row number â€” always visible */}
      <td className={`${CELL.dataCompact} text-center text-zinc-400 align-middle`}>{origIdx + 1}</td>
      {/* Extra metadata columns (read-only) */}
      {extraColumns?.map(col => {
        const displayValue = getExtraColumnValue(row, col.key);
        return (
        <td key={col.key} className={`${col.compact ? CELL.dataCompact : CELL.dataNormal} ${col.compact ? 'text-center' : ''} align-middle overflow-hidden`}>
          <span
            data-testid={col.key === 'ratingScore' || col.key === 'validationStatus' || col.key === 'h2JsonStatus' || col.key === 'pageGuideJsonStatus' || col.key === 'h2QaRating' ? `${col.key}-${row.id}` : undefined}
            className={`text-[11px] truncate block ${col.compact ? 'text-center' : ''} ${
              col.key === 'ratingScore'
                ? displayValue === '1'
                  ? 'text-emerald-700 font-medium'
                  : displayValue === '2'
                    ? 'text-amber-700 font-medium'
                    : displayValue === '3' || displayValue === '4'
                      ? 'text-red-600 font-semibold'
                      : displayValue === '5'
                        ? 'text-zinc-700 font-medium'
                        : 'text-zinc-600'
                : col.key === 'validationStatus'
                  ? displayValue === 'Pass'
                    ? 'text-emerald-700 font-semibold'
                    : displayValue === 'Fail'
                      ? 'text-red-600 font-semibold'
                      : 'text-zinc-600'
                : col.key === 'h2JsonStatus'
                  ? displayValue === 'Pass'
                    ? 'text-emerald-700 font-semibold'
                    : displayValue === 'Fail'
                      ? 'text-red-600 font-semibold'
                      : 'text-zinc-600'
                : col.key === 'pageGuideJsonStatus'
                  ? displayValue === 'Pass'
                    ? 'text-emerald-700 font-semibold'
                    : displayValue === 'Fail'
                      ? 'text-red-600 font-semibold'
                      : 'text-zinc-600'
                : col.key === 'h2QaRating'
                  ? displayValue === '4'
                    ? 'text-emerald-700 font-semibold'
                    : displayValue === '3'
                      ? 'text-amber-700 font-semibold'
                      : displayValue === '1' || displayValue === '2'
                        ? 'text-red-600 font-semibold'
                        : 'text-zinc-600'
                : 'text-zinc-600'
            }`}
            title={displayValue}
          >
            {displayValue}
          </span>
        </td>
      )})}
      {/* Primary slot cells â€” hidden when viewing a slot tab */}
      {showPrimary && <>
      <td className={`${CELL.dataNormal} align-middle overflow-hidden`}>
        {isLocked ? (
          <span data-testid={`locked-row-${row.id}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap bg-zinc-200 text-zinc-700">
            <Lock className="w-2.5 h-2.5 shrink-0" />
            locked
          </span>
        ) : (
          <span data-testid={`row-status-${row.id}`} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${statusColorMap[row.status]}`}>
            {row.status === 'generating' && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
            {row.status === 'generated' && <Check className="w-2.5 h-2.5 shrink-0" />}
            {row.status === 'error' && <AlertCircle className="w-2.5 h-2.5 shrink-0" />}
            {row.status}
          </span>
        )}
      </td>
      <td className={`${CELL.dataNormal} align-middle`}>
        <div className="relative group/cell">
          <input
            type="text"
            value={row.input}
            readOnly={isLocked || isBusy}
            onChange={(e) => onInputChange(row.id, e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData?.getData('text/plain') ?? '';
              if (text.includes('\n') || text.includes('\r')) onPaste(e, origIdx);
            }}
            className={`w-full text-[12px] h-[26px] px-2 pr-5 border rounded ${isLocked || isBusy ? 'border-zinc-200 bg-zinc-100 text-zinc-400' : 'border-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400'}`}
            placeholder={isLocked ? lockReason : isBusy ? 'Wait for the current run to finishâ€¦' : 'Paste or type prompt...'}
          />
          {row.input.trim() && !isLocked && !isBusy && (
            <button onClick={() => onClearCell(row.id)} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-zinc-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100 transition-opacity" title="Clear cell">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </td>
      <td className={`${CELL.dataNormal} align-top cursor-pointer`} onClick={() => { if (row.output || row.status === 'error') onToggleExpand(row.id); }}>
        {isLocked ? (
          <span className={`text-[11px] text-zinc-500 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate block'}`}>{lockReason}</span>
        ) : (
          <OutputCellContent status={row.status} output={row.output} error={row.error} isExpanded={isExpanded} />
        )}
      </td>
      <td className={`${CELL.dataCompact} text-center align-middle`}>
        {row.output.trim() && (
          <button onClick={() => onCopyOutput(row.id, row.output)} className="p-0.5 text-zinc-300 hover:text-indigo-600 transition-colors" title="Copy output">
            {isCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </td>
      <td className={`${CELL.dataCompact} text-center align-middle`}>
        {(row.status === 'error' || row.status === 'generated') && !isBusy && !isLocked && (
          <button onClick={(e) => { e.stopPropagation(); onRetry(row.id); }} className="p-0.5 text-zinc-300 hover:text-amber-600 transition-colors" title="Reset to pending for re-generation">
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </td>
      <td className={`${CELL.dataCompact} text-zinc-500 align-middle`}>
        {row.output ? row.output.length.toLocaleString() : 'â€”'}
      </td>
      <td className={`${CELL.dataCompact} text-center align-middle`}>
        {(row.retries && row.retries > 0) ? (
          <span className={`${row.status === 'error' ? 'text-red-500' : 'text-amber-500'} font-medium`}>{row.retries}</span>
        ) : 'â€”'}
      </td>
      <td className={`${CELL.dataCompact} text-zinc-400 align-middle whitespace-nowrap pr-4`}>
        {row.generatedAt ? formatDateTime(row.generatedAt) : 'â€”'}
      </td>
      </>}
      {/* Slot cells â€” only shown when viewing that slot's tab */}
      {activeSlotId && slotConfigs?.filter(slot => slot.id === activeSlotId).map(slot => {
        const sd = getSlot(row, slot.id);
        const slotKey = `${slot.id}:${row.id}`;
        const isSlotExpanded = expandedSlotKeys?.has(slotKey) ?? false;
        const isSlotCopied = slotCopied === slotKey;
        const isSlotBusy = slotBusy?.[slot.id] ?? false;
        return (
          <React.Fragment key={slot.id}>
            {/* Status */}
            <td className={`${CELL.dataNormal} align-middle overflow-hidden`}>
              <span
                data-testid={`row-status-${slot.id}-${row.id}`}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${statusColorMap[sd.status]}`}
              >
                {sd.status === 'generating' && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
                {sd.status === 'generated' && <Check className="w-2.5 h-2.5 shrink-0" />}
                {sd.status === 'error' && <AlertCircle className="w-2.5 h-2.5 shrink-0" />}
                {sd.status}
              </span>
            </td>
            {/* Input â€” read-only display when buildInput exists */}
            <td className={`${CELL.dataNormal} align-middle`}>
              {slot.buildInput ? (
                <span className={`text-[12px] truncate block ${sd.input ? 'text-zinc-500' : 'text-zinc-300 italic'}`} title={sd.input || 'Auto-populated when dependencies are ready'}>
                  {sd.input ? (sd.input.length > 80 ? sd.input.slice(0, 80) + 'â€¦' : sd.input) : 'Waiting for dependenciesâ€¦'}
                </span>
              ) : (
                <input
                  type="text"
                  value={sd.input}
                  readOnly
                  className="w-full text-[12px] h-[26px] px-2 border border-zinc-200 rounded bg-zinc-50 text-zinc-500"
                  placeholder="â€”"
                />
              )}
            </td>
            {/* Output */}
            <td className={`${CELL.dataNormal} align-top cursor-pointer`} onClick={() => { if (sd.output || sd.status === 'error') onSlotToggleExpand?.(slotKey); }}>
              <OutputCellContent status={sd.status} output={sd.output} error={sd.error} isExpanded={isSlotExpanded} />
            </td>
            {/* Copy */}
            <td className={`${CELL.dataCompact} text-center align-middle`}>
              {sd.output.trim() && (
                <button onClick={() => onSlotCopyOutput?.(slot.id, row.id, sd.output)} className="p-0.5 text-zinc-300 hover:text-indigo-600 transition-colors" title="Copy output">
                  {isSlotCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </td>
            {/* Reset */}
            <td className={`${CELL.dataCompact} text-center align-middle`}>
        {(sd.status === 'error' || sd.status === 'generated') && !isBusy && !isSlotBusy && (
                <button onClick={(e) => { e.stopPropagation(); onSlotRetry?.(slot.id, row.id); }} className="p-0.5 text-zinc-300 hover:text-amber-600 transition-colors" title="Reset to pending for re-generation">
                  <RefreshCw className="w-3 h-3" />
                </button>
              )}
            </td>
            {/* Len */}
            <td className={`${CELL.dataCompact} text-zinc-500 align-middle`}>
              {sd.output ? sd.output.length.toLocaleString() : 'â€”'}
            </td>
            {/* R */}
            <td className={`${CELL.dataCompact} text-center align-middle`}>
              {(sd.retries && sd.retries > 0) ? (
                <span className={`${sd.status === 'error' ? 'text-red-500' : 'text-amber-500'} font-medium`}>{sd.retries}</span>
              ) : 'â€”'}
            </td>
            {/* Date */}
            <td className={`${CELL.dataCompact} text-zinc-400 align-middle whitespace-nowrap pr-4`}>
              {sd.generatedAt ? formatDateTime(sd.generatedAt) : 'â€”'}
            </td>
          </React.Fragment>
        );
      })}
    </tr>
  );
});

// ============ Generation Timer (isolated to avoid parent re-renders) ============
const GenerationTimer = React.memo(function GenerationTimer({
  startTime, isActive, completionTimestampsRef, doneCount,
  formatElapsedFn,
}: {
  startTime: number | null;
  isActive: boolean;
  completionTimestampsRef: React.MutableRefObject<number[]>;
  doneCount: number;
  formatElapsedFn: (ms: number) => string;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [rate, setRate] = useState(0);
  const [lastElapsed, setLastElapsed] = useState(0);

  useEffect(() => {
    if (!isActive || !startTime) return;
    const updateTimerState = () => {
      setElapsed(Date.now() - startTime);
      const now = Date.now();
      const w = completionTimestampsRef.current.filter(t => now - t < 5000);
      setRate(w.length > 0 ? Math.round((w.length / ((now - w[0]) / 1000)) * 10) / 10 : 0);
    };
    const kickoff = setTimeout(updateTimerState, 0);
    const timer = setInterval(() => {
      updateTimerState();
    }, 250);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, [isActive, startTime, completionTimestampsRef]);

  // Keep final elapsed time visible after generation stops
  useEffect(() => {
    if (!(isActive && elapsed > 0)) return;
    const timer = setTimeout(() => setLastElapsed(elapsed), 0);
    return () => clearTimeout(timer);
  }, [isActive, elapsed]);
  const displayElapsed = isActive ? elapsed : lastElapsed;

  if (!isActive && displayElapsed === 0) return null;

  return (
    <>
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500" title="Total elapsed time for the current/last generation batch">
        <Clock className="w-3 h-3" />
        <span className={`font-mono tabular-nums ${isActive ? 'text-amber-600 font-semibold' : 'text-emerald-600'}`}>
          {formatElapsedFn(displayElapsed)}
        </span>
        {!isActive && doneCount > 0 && (
          <span className="text-zinc-400">({doneCount} items)</span>
        )}
      </div>
      {isActive && rate > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-cyan-600 font-semibold font-mono tabular-nums" title="Current throughput â€” outputs completed per second">
          <Zap className="w-3 h-3" />
          {rate}/s
        </div>
      )}
    </>
  );
});

// ============ Component ============
/** Extra read-only columns rendered from row.metadata */
export interface ExtraColumnDef {
  key: string;      // metadata key to read
  label: string;    // column header text
  width?: string;   // Tailwind width class (e.g., 'w-[120px]')
  compact?: boolean;
  tooltip?: string;
}

const EXTRA_COLUMN_TOOLTIPS: Record<string, string> = {
  pageName: 'Source page title for this derived row.',
  order: 'Original H2 order from the source article outline.',
  h2Name: 'The H2 heading this row belongs to.',
  h2NamesPreview: 'Generated H2 outline carried forward from the H2s slot for this page row.',
  h2JsonStatus: 'Deterministic validation status for the generated H2 JSON payload.',
  pageGuideJsonStatus: 'Deterministic validation status for the generated Page Guide JSON payload.',
  h2QaRating: 'QA rating for the generated H2 set. 4 is best, 1 is worst.',
  h2QaFlags: 'H2 headings flagged by the QA step as off-intent or not helpful enough.',
  ratingScore: 'Parsed score from the rating step. Rows rated 3 or 4 need a rewrite before they are accepted.',
  contentGuidelines: 'Guideline and formatting notes inherited from the page-level content planning step.',
  factCheckTarget: 'The page or context the rating prompt uses for fact-checking this H2 answer.',
  h2Content: 'The source H2 answer text carried into this downstream pipeline row.',
  validationStatus: 'Deterministic HTML validation result. Pass means the output met the current HTML policy checks.',
};

const SLOT_HEADER_TOOLTIPS = {
  status: 'Pending = waiting to generate, Generating = in progress, Generated = complete, Error = failed or needs attention.',
  input: 'The prompt/input sent for this slot.',
  output: 'The generated output for this slot.',
  len: 'Character count of the generated output.',
  retries: 'How many regeneration attempts were needed for this row.',
  date: 'Timestamp when this slot output was last generated.',
} as const;

const LOG_HEADER_TOOLTIPS = {
  timestamp: 'When this log entry was recorded.',
  action: 'The workflow action that created the log entry.',
  model: 'The model used for that run, when applicable.',
  output: 'How many outputs were produced in that action.',
  err: 'How many rows failed in that action.',
  time: 'Elapsed runtime for the action.',
  cost: 'Estimated OpenRouter cost recorded for the action.',
  avg: 'Average rows completed per second.',
  con: 'Concurrency used for that action.',
  tokens: 'Approximate prompt + completion token usage.',
  details: 'Human-readable summary of what happened.',
} as const;

/** Source data loader for populating rows from an upstream pipeline step */
interface PopulateFromSource {
  label: string;                          // Button text, e.g., "Sync from Page Names"
  load: () => Promise<GenerateRow[]>;     // Returns pre-populated rows
  emptyMessage?: string;
  successLabel?: string;
  /** When set, subscribes to this app_settings doc and auto-applies loaded rows (debounced). */
  upstreamDocId?: string;
  additionalUpstreamDocIds?: string[];
  /** When set (e.g. H2 Content), changes to this generate settings doc re-run `load()` so row inputs track the saved primary prompt. */
  pipelineSettingsDocId?: string;
}

/** External view tab â€” renders in the view tab rail but parent controls the content */
export interface ExternalViewTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  locked?: boolean;
}

interface PrimaryOutputTransformResult {
  output: string;
  metadata?: Record<string, string>;
  validationError?: string;
}

type PrimaryOutputTransformer = (args: {
  rawOutput: string;
  row: GenerateRow;
}) => PrimaryOutputTransformResult;

interface GenerateTabProps {
  activeProjectId?: string | null;
  isVisible?: boolean;
  runtimeEffectsActive?: boolean;
  workspaceProjectId?: string | null;
  storageKey?: string; // '' (default) or '_2' for second sub-tab
  logsStorageKey?: string; // optionally share one log surface across related tabs
  sharedSelectedModelStorageKey?: string; // optional shared settings doc used only for selectedModel
  starredModels: Set<string>; // shared starred model IDs
  onToggleStar: (modelId: string) => void; // toggle star on/off
  defaultPrompt?: string; // initial prompt for new instances (e.g. Page Names template)
  promptSlots?: PromptSlotConfig[]; // additional prompt slots (extends table horizontally)
  primaryPromptLabel?: string; // label for primary prompt tab (default: 'System Prompt')
  primaryPromptIcon?: React.ReactNode;
  extraColumns?: ExtraColumnDef[]; // extra read-only columns from row.metadata
  populateFromSource?: PopulateFromSource; // sync rows from upstream pipeline step
  externalViewTabsBeforePrimary?: ExternalViewTab[]; // extra parent-managed tabs rendered before the primary tab
  externalViewTabs?: ExternalViewTab[]; // extra view tabs managed by parent
  activeExternalView?: string | null; // which external view tab is active (null = none)
  onExternalViewSelect?: (id: string) => void; // called when an external view tab is clicked
  controlledTableView?: 'primary' | string;
  onTableViewChange?: (view: 'primary' | string) => void;
  controlledGenSubTab?: 'table' | 'log';
  onGenSubTabChange?: (tab: 'table' | 'log') => void;
  /** When `flush`, omit inner max-width centering so a parent (e.g. Content tab) owns one `max-w-4xl` column */
  rootLayout?: 'default' | 'flush';
  showSyncButton?: boolean;
  onBusyStateChange?: (isBusy: boolean) => void;
  disableViewSwitching?: boolean;
  disableViewSwitchingReason?: string;
  primaryColumnPreset?: PrimaryColumnPreset;
  generateButtonLabel?: string;
  primaryInputHeaderLabel?: string;
  primaryOutputHeaderLabel?: string;
  transformPrimaryOutput?: PrimaryOutputTransformer;
  responseFormat?: 'text' | 'json_object';
  clearMetadataKeysOnReset?: string[];
  lockMetadataKey?: string;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedDeep(entryValue)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFiniteTokenPrice(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseFloat(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSlotPromptsForStorageKey(
  storageKey: string,
  promptSlots: PromptSlotConfig[],
  rawSlotPrompts: Record<string, string> | undefined,
): {
  slotPrompts: Record<string, string>;
  didMigrateLegacyPrompt: boolean;
  didMigratePromptPolicy: boolean;
  didMigratePageGuidePrompt: boolean;
} {
  const nextSlotPrompts: Record<string, string> = {};
  let didMigrateLegacyPrompt = false;
  let didMigratePromptPolicy = false;
  let didMigratePageGuidePrompt = false;

  for (const slot of promptSlots) {
    const normalized = normalizeSlotPromptForStorageKey(storageKey, slot, rawSlotPrompts?.[slot.id]);

    if (normalized.didMigrateLegacyPrompt) didMigrateLegacyPrompt = true;
    if (normalized.didMigratePromptPolicy) didMigratePromptPolicy = true;
    if (normalized.didMigratePageGuidePrompt) didMigratePageGuidePrompt = true;
    nextSlotPrompts[slot.id] = normalized.prompt;
  }

  return {
    slotPrompts: nextSlotPrompts,
    didMigrateLegacyPrompt,
    didMigratePromptPolicy,
    didMigratePageGuidePrompt,
  };
}

function normalizeSlotValidatorsForStorageKey(
  storageKey: string,
  promptSlots: PromptSlotConfig[],
  rawSlotValidators: Record<string, string> | undefined,
): { slotValidators: Record<string, string>; didMigratePromptPolicy: boolean } {
  const nextSlotValidators: Record<string, string> = {};
  let didMigratePromptPolicy = false;
  for (const slot of promptSlots) {
    const normalized = normalizeSlotValidatorForStorageKey(storageKey, slot, rawSlotValidators?.[slot.id]);
    if (typeof normalized.validator !== 'string') continue;
    if (normalized.didMigratePromptPolicy) didMigratePromptPolicy = true;
    nextSlotValidators[slot.id] = normalized.validator;
  }
  return { slotValidators: nextSlotValidators, didMigratePromptPolicy };
}

export function normalizeGeneratePromptPolicy(args: {
  storageKey: string;
  defaultPrompt: string;
  promptSlots: PromptSlotConfig[];
  prompt?: string;
  slotPrompts?: Record<string, string>;
  slotValidators?: Record<string, string>;
}): {
  prompt: string;
  slotPrompts: Record<string, string>;
  slotValidators: Record<string, string>;
  didMigrateLegacyPrompt: boolean;
  didMigratePromptPolicy: boolean;
  didMigratePageGuidePrompt: boolean;
} {
  const normalizedPrimaryPrompt = normalizePrimaryPromptForStorageKey(
    args.storageKey,
    args.defaultPrompt,
    args.prompt,
  );
  const normalizedSlotPrompts = normalizeSlotPromptsForStorageKey(
    args.storageKey,
    args.promptSlots,
    args.slotPrompts,
  );
  const normalizedSlotValidators = normalizeSlotValidatorsForStorageKey(
    args.storageKey,
    args.promptSlots,
    args.slotValidators,
  );

  return {
    prompt: normalizedPrimaryPrompt.prompt,
    slotPrompts: normalizedSlotPrompts.slotPrompts,
    slotValidators: normalizedSlotValidators.slotValidators,
    didMigrateLegacyPrompt: normalizedSlotPrompts.didMigrateLegacyPrompt,
    didMigratePromptPolicy:
      normalizedPrimaryPrompt.didMigratePromptPolicy ||
      normalizedSlotPrompts.didMigratePromptPolicy ||
      normalizedSlotPrompts.didMigrateLegacyPrompt ||
      normalizedSlotValidators.didMigratePromptPolicy,
    didMigratePageGuidePrompt: normalizedSlotPrompts.didMigratePageGuidePrompt,
  };
}

export function resetPageGuideRowsForPolicyMigration(args: {
  rows: GenerateRow[];
  storageKey: string;
  promptSlots?: PromptSlotConfig[];
  slotPrompts?: Record<string, string>;
}): GenerateRow[] {
  if (args.storageKey !== '_page_names') {
    return args.rows;
  }
  return clearRowsForView({
    rows: args.rows,
    tableView: 'guidelines',
    promptSlots: args.promptSlots,
    slotPrompts: args.slotPrompts,
    storageKey: args.storageKey,
  });
}

export const GenerateTabInstance = React.memo(function GenerateTabInstance({ activeProjectId: _activeProjectId, runtimeEffectsActive = true, workspaceProjectId = null, storageKey = '', logsStorageKey, sharedSelectedModelStorageKey, starredModels, onToggleStar, defaultPrompt = '', promptSlots = [], primaryPromptLabel, primaryPromptIcon, extraColumns = [], populateFromSource, externalViewTabsBeforePrimary = [], externalViewTabs = [], activeExternalView = null, onExternalViewSelect, controlledTableView, onTableViewChange, controlledGenSubTab, onGenSubTabChange, rootLayout = 'default', showSyncButton = true, onBusyStateChange, disableViewSwitching = false, disableViewSwitchingReason, primaryColumnPreset = 'default', generateButtonLabel = 'Generate', primaryInputHeaderLabel = 'Input', primaryOutputHeaderLabel = 'Output', transformPrimaryOutput, responseFormat = 'text', clearMetadataKeysOnReset = [], lockMetadataKey }: GenerateTabProps) {
  const { addToast } = useToast();
  const suffix = storageKey; // e.g. '' or '_2'
  const logsSuffix = logsStorageKey ?? storageKey;
  const sharedSelectedModelSuffix = sharedSelectedModelStorageKey ?? suffix;
  const rowsDocId = scopeGenerateWorkspaceDocId(workspaceProjectId, `generate_rows${suffix}`);
  const logsDocId = scopeGenerateWorkspaceDocId(workspaceProjectId, `generate_logs${logsSuffix}`);
  const viewStateDocId = scopeGenerateWorkspaceDocId(workspaceProjectId, `generate_view_state${suffix}`);
  const settingsDocId = scopeGenerateWorkspaceDocId(workspaceProjectId, `generate_settings${suffix}`);
  const sharedSelectedModelDocId = scopeGenerateWorkspaceDocId(workspaceProjectId, `generate_settings${sharedSelectedModelSuffix}`);
  // Table state â€” initialize empty, then load from shared local mirrors + Firestore
  const [rows, setRows] = useState<GenerateRow[]>(makeEmptyRows(20));
  const rowsRef = useRef(rows);
  const rowsChangeVersionRef = useRef(0);
  const rowsLocalEditVersionRef = useRef(0);
  const applyRowsState = useCallback((nextRows: GenerateRow[], options?: { markLocalEdit?: boolean }) => {
    rowsRef.current = nextRows;
    rowsChangeVersionRef.current += 1;
    if (options?.markLocalEdit !== false) {
      rowsLocalEditVersionRef.current += 1;
    }
    setRows(nextRows);
  }, []);
  const updateRowsState = useCallback((
    updater: GenerateRow[] | ((prev: GenerateRow[]) => GenerateRow[]),
    options?: { markLocalEdit?: boolean },
  ) => {
    const nextRows = typeof updater === 'function'
      ? (updater as (prev: GenerateRow[]) => GenerateRow[])(rowsRef.current)
      : updater;
    applyRowsState(nextRows, options);
    return nextRows;
  }, [applyRowsState]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsRef = useRef(logs);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  // When slots exist, allow switching between primary and slot column views
  const [tableView, setTableView] = useState<'primary' | string>(() => {
    if (controlledTableView) return controlledTableView;
    try {
      const raw = localStorage.getItem(viewStateCacheKey(viewStateDocId));
      if (!raw) return 'primary';
      const parsed = JSON.parse(raw);
      return typeof parsed?.tableView === 'string' ? parsed.tableView : 'primary';
    } catch {
      return 'primary';
    }
  });
  const setTableViewAndNotify = useCallback((nextView: 'primary' | string) => {
    setTableView(nextView);
    onTableViewChange?.(nextView);
  }, [onTableViewChange]);

  const [genSubTab, setGenSubTab] = useState<'table' | 'log'>(() => {
    if (controlledGenSubTab) return controlledGenSubTab;
    try {
      const raw = localStorage.getItem(viewStateCacheKey(viewStateDocId));
      if (!raw) return 'table';
      const parsed = JSON.parse(raw);
      return parsed?.genSubTab === 'log' ? 'log' : 'table';
    } catch {
      return 'table';
    }
  });
  const setGenSubTabAndNotify = useCallback((nextTab: 'table' | 'log') => {
    setGenSubTab(nextTab);
    onGenSubTabChange?.(nextTab);
  }, [onGenSubTabChange]);
  const logsLoadedRef = useRef(false);
  const loadCachedRows = useCallback(() => loadCachedState<GenerateRow[]>({
    idbKey: appSettingsIdbKey(rowsDocId),
    localStorageKey: rowsCacheKey(rowsDocId),
  }), [rowsDocId, suffix]);
  const normalizeLoadedRows = useCallback((loadedRows: GenerateRow[]) => (
    loadedRows.length > 0
      ? loadedRows.map((r: GenerateRow) => ({
          ...r,
          retries: r.retries || 0,
          status: r.status === 'generating' ? 'pending' as const : r.status,
        }))
      : makeEmptyRows(20)
  ), []);

  // suppressRowsSnapshotRef prevents onSnapshot from overwriting in-flight local
  // changes when our own Firestore write echoes back.
  const suppressRowsSnapshotRef = useRef(false);
  const lastRowsWrittenAtRef = useRef<string>('');
  const latestRowsUpdatedAtRef = useRef<string>('');
  const deferredRowsSnapshotReloadRef = useRef(false);
  const deferredRowsSnapshotUpdatedAtRef = useRef<string>('');
  const [deferredRowsSnapshotReloadSignal, setDeferredRowsSnapshotReloadSignal] = useState(0);
  // rowsFirestoreLoadedRef prevents async IDB cache from overwriting authoritative
  // Firestore data (same guard pattern as settings).
  const rowsFirestoreLoadedRef = useRef(false);

  const scheduleDeferredRowsSnapshotReload = useCallback((incomingUpdatedAt = '') => {
    deferredRowsSnapshotReloadRef.current = true;
    if (
      incomingUpdatedAt &&
      (!deferredRowsSnapshotUpdatedAtRef.current || incomingUpdatedAt > deferredRowsSnapshotUpdatedAtRef.current)
    ) {
      deferredRowsSnapshotUpdatedAtRef.current = incomingUpdatedAt;
    }
    setIsLoaded(true);
    setDeferredRowsSnapshotReloadSignal((prev) => prev + 1);
  }, []);

  const reloadDeferredRowsSnapshot = useCallback(async () => {
    const startRowsEditVersion = rowsLocalEditVersionRef.current;
    const loadedRows = await loadAppSettingsRows<GenerateRow>({ docId: rowsDocId, loadMode: 'remote', registryKind: 'rows' });
    if (rowsLocalEditVersionRef.current !== startRowsEditVersion) {
      scheduleDeferredRowsSnapshotReload(deferredRowsSnapshotUpdatedAtRef.current);
      return;
    }
    rowsFirestoreLoadedRef.current = true;
    setIsLoaded(true);
    const normalizedLoadedRows = normalizeLoadedRows(loadedRows);
    applyRowsState(normalizedLoadedRows, { markLocalEdit: false });
    cacheStateLocallyBestEffort({
      idbKey: appSettingsIdbKey(rowsDocId),
      value: loadedRows,
      localStorageKey: rowsCacheKey(rowsDocId),
    });
    if (deferredRowsSnapshotUpdatedAtRef.current) {
      latestRowsUpdatedAtRef.current = deferredRowsSnapshotUpdatedAtRef.current;
      deferredRowsSnapshotUpdatedAtRef.current = '';
    }
    lastSavedRowsJsonRef.current = JSON.stringify(loadedRows);
  }, [applyRowsState, normalizeLoadedRows, rowsDocId, scheduleDeferredRowsSnapshotReload]);

  // Load rows from Firestore and keep them live-synced
  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    let alive = true;
    rowsFirestoreLoadedRef.current = false;

    const applyCachedFallback = async () => {
      if (!alive) return;
      const cachedRows = await loadCachedRows();
      // GUARD: if Firestore already delivered, don't overwrite with stale cache
      if (!alive || rowsFirestoreLoadedRef.current) return;
      // Pipeline upstream sync may have filled rows while IDB read was in flight â€” never clobber
      if (rowsRef.current.some(r => (r.metadata?.pageName ?? '').trim() !== '')) return;
      if (cachedRows && cachedRows.length > 0) {
        const normalizedCachedRows = normalizeLoadedRows(cachedRows);
        applyRowsState(normalizedCachedRows, { markLocalEdit: false });
        lastSavedRowsJsonRef.current = JSON.stringify(cachedRows);
      } else {
        const emptyRows = makeEmptyRows(20);
        applyRowsState(emptyRows, { markLocalEdit: false });
        lastSavedRowsJsonRef.current = JSON.stringify([]);
      }
      setIsLoaded(true);
    };

    void applyCachedFallback();

    const unsub = subscribeAppSettingsDoc({
      docId: rowsDocId,
      channel: makeAppSettingsChannel('rows', rowsDocId),
      onData: async (snap) => {
        try {
          if (!alive) return;
          const isFromCache = snap.metadata.fromCache;
          if (!snap.exists() && isFromCache) return;
          const data = snap.exists() ? snap.data() : null;
          const incomingUpdatedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : '';
          const snapshotHandling = classifyRowsSnapshotHandling({
            incomingUpdatedAt,
            lastWrittenAt: lastRowsWrittenAtRef.current,
            latestKnownUpdatedAt: latestRowsUpdatedAtRef.current,
            isPrimaryGenerating: isGeneratingRef.current,
            slotGeneratingState: slotGeneratingRef.current,
            hasResolvedCurrentRows: rowsRef.current.some(hasResolvedPrimaryRowState),
          });
          if (snapshotHandling === 'ignore') {
            suppressRowsSnapshotRef.current = false;
            return;
          }
          if (snapshotHandling === 'defer') {
            scheduleDeferredRowsSnapshotReload(incomingUpdatedAt);
            return;
          }
          if (snap.exists()) {
            const startRowsVersion = rowsChangeVersionRef.current;
            const startRowsEditVersion = rowsLocalEditVersionRef.current;
            const loadedRows = await loadAppSettingsRows<GenerateRow>({ docId: rowsDocId, loadMode: 'remote', registryKind: 'rows' });
            if (!alive) return;
            if (
              rowsChangeVersionRef.current !== startRowsVersion ||
              rowsLocalEditVersionRef.current !== startRowsEditVersion
            ) {
              scheduleDeferredRowsSnapshotReload(incomingUpdatedAt);
              return;
            }
            if (hasActiveGeneration(isGeneratingRef.current, slotGeneratingRef.current)) {
              scheduleDeferredRowsSnapshotReload(incomingUpdatedAt);
              return;
            }
            if (
              incomingUpdatedAt &&
              latestRowsUpdatedAtRef.current &&
              incomingUpdatedAt < latestRowsUpdatedAtRef.current
            ) {
              return;
            }
            rowsFirestoreLoadedRef.current = true;
            const normalizedLoadedRows = normalizeLoadedRows(loadedRows);
            applyRowsState(normalizedLoadedRows, { markLocalEdit: false });
            if (incomingUpdatedAt) {
              latestRowsUpdatedAtRef.current = incomingUpdatedAt;
            }
            cacheStateLocallyBestEffort({
              idbKey: appSettingsIdbKey(rowsDocId),
              value: loadedRows,
              localStorageKey: rowsCacheKey(rowsDocId),
            });
            lastSavedRowsJsonRef.current = JSON.stringify(loadedRows);
            setIsLoaded(true);
            return;
          }
          // Missing doc from a non-cache snapshot is still an authoritative Firestore result.
          // Re-apply any cached rows after marking loaded so the normal save queue can create
          // the doc in Firestore instead of leaving the upstream step empty forever.
          if (!isFromCache) {
            const cachedRows = await loadCachedRows();
            if (!alive) return;
            rowsFirestoreLoadedRef.current = true;
            if (cachedRows && cachedRows.length > 0) {
              const normalizedCachedRows = normalizeLoadedRows(cachedRows);
              applyRowsState(normalizedCachedRows, { markLocalEdit: false });
              lastSavedRowsJsonRef.current = '';
              cacheStateLocallyBestEffort({
                idbKey: appSettingsIdbKey(rowsDocId),
                value: cachedRows,
                localStorageKey: rowsCacheKey(rowsDocId),
              });
            }
            setIsLoaded(true);
            return;
          }
        } catch {
          // Best-effort local fallback; keep default rows on read failure.
        }
        // Only fall back to cache if Firestore hasn't already provided data
        if (!rowsFirestoreLoadedRef.current) {
          await applyCachedFallback();
        }
      },
      onError: async (err) => {
        reportPersistFailure(addToast, 'generate rows sync', err);
        if (!rowsFirestoreLoadedRef.current) {
          await applyCachedFallback();
        }
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [addToast, loadCachedRows, normalizeLoadedRows, rowsDocId, runtimeEffectsActive, scheduleDeferredRowsSnapshotReload, suffix]);

  const isGeneratingRef = useRef(false);
  const lastSavedRowsJsonRef = useRef('');
  const lastAppliedUpstreamJsonRef = useRef('');
  const upstreamSourceVersionRef = useRef(0);
  const upstreamSyncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredUpstreamSyncRef = useRef(false);
  const lastUpstreamSyncToastKeyRef = useRef('');

  const persistRows = useCallback(async (rowsToSave: GenerateRow[]) => {
    const sanitizedRows = sanitizeJsonForFirestore(stripUndefinedDeep(rowsToSave));
    const updatedAt = new Date().toISOString();
    // Suppress the onSnapshot echo from our own write
    lastRowsWrittenAtRef.current = updatedAt;
    latestRowsUpdatedAtRef.current = updatedAt;
    suppressRowsSnapshotRef.current = true;
    try {
      const result = await writeAppSettingsRowsRemote({
        docId: rowsDocId,
        rows: sanitizedRows as unknown as Array<Record<string, unknown>>,
        cloudContext: 'generate rows sync',
        updatedAt,
        totalRows: sanitizedRows.length,
        registryKind: 'rows',
      });
      if (result.status !== 'accepted') {
        throw new Error(`generate rows sync blocked: ${result.reason}`);
      }
    } catch (err) {
      suppressRowsSnapshotRef.current = false;
      throw err;
    }
    // Reset suppress flag after successful write — the onSnapshot echo will
    // also reset it, but if the echo never arrives we must not stay stuck.
    suppressRowsSnapshotRef.current = false;
  }, [rowsDocId]);

  const applyPipelineRows = useCallback(
    async (sourceRows: GenerateRow[]) => {
      applyRowsState(sourceRows);
      const json = JSON.stringify(sourceRows);
      lastSavedRowsJsonRef.current = json;
      lastAppliedUpstreamJsonRef.current = json;
      await persistRows(sourceRows);
      // IDB write removed — applyRowsState triggers the rows useEffect which
      // calls scheduleRowsSave → doSave → persistTrackedState (writes to IDB).
      // The extra cacheStateLocallyBestEffort was a redundant second IDB write
      // that competed for the same readwrite transaction lock.
      emitLocalAppSettingsRowsUpdated(rowsDocId);
    },
    [persistRows, rowsDocId, suffix],
  );

  /** One-shot: load upstream + apply if safe (shared by Firestore listener and isLoaded retry). */
  const flushUpstreamPipelineSync = useCallback(async () => {
    if (!runtimeEffectsActive) return;
    if (!populateFromSource?.load) return;
    if (!rowsFirestoreLoadedRef.current) {
      deferredUpstreamSyncRef.current = true;
      return;
    }
    if (hasActiveGeneration(isGeneratingRef.current, slotGeneratingRef.current)) {
      deferredUpstreamSyncRef.current = true;
      return;
    }
    try {
      deferredUpstreamSyncRef.current = false;
      const startRowsVersion = rowsChangeVersionRef.current;
      const startSourceVersion = upstreamSourceVersionRef.current;
      const next = await populateFromSource.load();
      if (hasActiveGeneration(isGeneratingRef.current, slotGeneratingRef.current)) {
        deferredUpstreamSyncRef.current = true;
        return;
      }
      if (
        rowsChangeVersionRef.current !== startRowsVersion ||
        upstreamSourceVersionRef.current !== startSourceVersion
      ) {
        deferredUpstreamSyncRef.current = true;
        queueMicrotask(() => {
          if (!deferredUpstreamSyncRef.current) return;
          if (hasActiveGeneration(isGeneratingRef.current, slotGeneratingRef.current)) return;
          deferredUpstreamSyncRef.current = false;
          void flushUpstreamPipelineSync();
        });
        return;
      }
      const json = JSON.stringify(next);
      if (json === lastAppliedUpstreamJsonRef.current) return;
      const authoritativeCurrentRows = rowsFirestoreLoadedRef.current
        ? await loadAppSettingsRows<GenerateRow>({ docId: rowsDocId, loadMode: 'remote', registryKind: 'rows' })
        : rowsRef.current;
      // Guard: don't let an empty upstream response wipe non-empty local rows.
      // Protects both generated-output rows and synced-input rows from transient empties.
      if (shouldSkipUpstreamEmptyApply(next, authoritativeCurrentRows)) {
        lastAppliedUpstreamJsonRef.current = json;
        return;
      }
      // Preserve accepted/generated work when the upstream-derived inputs are unchanged.
      // Auto-sync should rebuild pending rows only when the upstream source actually changes.
      if (shouldSkipEquivalentUpstreamApply(next, authoritativeCurrentRows)) {
        lastAppliedUpstreamJsonRef.current = json;
        return;
      }
      setIsSyncingSource(true);
      try {
        await applyPipelineRows(next);
        const toastKey = next.length > 0 ? `sync:${next.length}` : 'clear:0';
        if (toastKey !== lastUpstreamSyncToastKeyRef.current) {
          lastUpstreamSyncToastKeyRef.current = toastKey;
          addToast(
            next.length > 0
              ? `Auto-synced ${next.length} H2 rows from upstream step.`
              : 'Cleared H2 rows because upstream data is empty.',
            'success',
            {
              notification: {
                mode: 'shared',
                source: 'generate',
              },
            },
          );
        }
      } finally {
        setIsSyncingSource(false);
      }
    } catch (err) {
      console.warn('Upstream auto-sync failed', err);
      addToast(
        `Upstream sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'warning',
        {
          notification: {
            mode: 'shared',
            source: 'generate',
          },
        },
      );
    }
  }, [populateFromSource, addToast, applyPipelineRows, runtimeEffectsActive]);

  const doSave = useCallback(async () => {
    if (!runtimeEffectsActive) return;
    // Don't persist until Firestore has confirmed its state â€” prevents
    // writing stale/empty IDB cache to Firestore and destroying real data
    if (!rowsFirestoreLoadedRef.current) return;
    const rowsToSave = rowsRef.current.filter(r => r.input.trim() || r.output.trim());
    const json = JSON.stringify(rowsToSave);
    if (json === lastSavedRowsJsonRef.current) return;
    lastSavedRowsJsonRef.current = json;
    await persistTrackedState({
      idbKey: appSettingsIdbKey(rowsDocId),
      value: rowsToSave,
      localStorageKey: rowsCacheKey(rowsDocId),
      localStorageValue: json,
      addToast,
      localContext: 'generate rows',
      cloudContext: 'generate rows',
      writeRemote: async () => {
        await persistRows(rowsToSave);
      },
    });
    emitLocalAppSettingsRowsUpdated(rowsDocId);
  }, [addToast, persistRows, rowsDocId, runtimeEffectsActive, suffix]);
  const { schedule: scheduleRowsSave, flushNow: flushRowsSaveNow } = useLatestPersistQueue(doSave);

  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!isLoaded) return;
    if (hasActiveGeneration(isGeneratingRef.current, slotGeneratingRef.current)) return;
    scheduleRowsSave();
  }, [rows, isLoaded, runtimeEffectsActive, scheduleRowsSave]);

  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!pendingPageGuidePromptResetRef.current) return;
    if (!isLoaded || !firestoreLoadedRef.current || !rowsFirestoreLoadedRef.current) return;
    if (hasActiveGeneration(isGeneratingRef.current, slotGeneratingRef.current)) return;

    pendingPageGuidePromptResetRef.current = false;
    const currentRows = rowsRef.current;
    if (countClearableRowsForView(currentRows, 'guidelines', promptSlots) === 0) return;

    const nextRows = resetPageGuideRowsForPolicyMigration({
      rows: currentRows,
      storageKey: suffix,
      promptSlots,
      slotPrompts: settingsRef.current.slotPrompts,
    });
    lastSavedRowsJsonRef.current = '';
    applyRowsState(nextRows);
    void flushRowsSaveNow();
  }, [applyRowsState, flushRowsSaveNow, isLoaded, promptSlots, rows, runtimeEffectsActive, suffix]);

  // Load logs from Firestore and keep them live-synced
  const loadCachedLogs = useCallback(() => loadCachedState<LogEntry[]>({
    idbKey: appSettingsIdbKey(logsDocId),
    localStorageKey: logsCacheKey(logsDocId),
  }), [logsDocId, logsSuffix]);
  const lastSavedLogsJsonRef = useRef('');
  const logsFirestoreLoadedRef = useRef(false);
  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    let alive = true;
    logsFirestoreLoadedRef.current = false;
    const applyCachedLogs = async () => {
      if (!alive) return;
      const cached = await loadCachedLogs();
      if (!alive || logsFirestoreLoadedRef.current) return;
      const next = Array.isArray(cached) ? cached : [];
      setLogs(next);
      lastSavedLogsJsonRef.current = JSON.stringify(next);
      logsLoadedRef.current = true;
    };

    void applyCachedLogs();

    const unsub = subscribeAppSettingsDoc({
      docId: logsDocId,
      channel: makeAppSettingsChannel('logs', logsDocId),
      onData: async (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        if (!isFromCache) {
          logsFirestoreLoadedRef.current = true;
        }
        if (snap.exists()) {
          const logData = snap.data();
          // Suppress echo from our own write
          const logsUpdatedAt = typeof logData?.updatedAt === 'string' ? logData.updatedAt : '';
          if (suppressLogsSnapshotRef.current && logsUpdatedAt && logsUpdatedAt === lastLogsWrittenAtRef.current) {
            suppressLogsSnapshotRef.current = false;
            return;
          }
          if (logData?.logs && Array.isArray(logData.logs)) {
            setLogs(logData.logs);
            cacheStateLocallyBestEffort({
              idbKey: appSettingsIdbKey(logsDocId),
              value: logData.logs,
              localStorageKey: logsCacheKey(logsDocId),
            });
            lastSavedLogsJsonRef.current = JSON.stringify(logData.logs);
            logsLoadedRef.current = true;
            return;
          }
        }
        if (!logsFirestoreLoadedRef.current) {
          await applyCachedLogs();
        }
      },
      onError: async (err) => {
        reportPersistFailure(addToast, 'generate logs sync', err);
        if (!logsFirestoreLoadedRef.current) {
          await applyCachedLogs();
        }
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [addToast, loadCachedLogs, logsDocId, logsSuffix, runtimeEffectsActive]);

  // suppressLogsSnapshotRef prevents onSnapshot echo from overwriting in-flight log state.
  const suppressLogsSnapshotRef = useRef(false);
  const lastLogsWrittenAtRef = useRef<string>('');

  // Save logs when they change
  const persistLogs = useCallback(async () => {
    if (!runtimeEffectsActive) return;
    if (!logsLoadedRef.current || !logsFirestoreLoadedRef.current) return;
    const trimmed = logsRef.current.slice(-500);
    const json = JSON.stringify(trimmed);
    if (json === lastSavedLogsJsonRef.current) return;
    lastSavedLogsJsonRef.current = json;
    const updatedAt = new Date().toISOString();
    lastLogsWrittenAtRef.current = updatedAt;
    suppressLogsSnapshotRef.current = true;
    try {
      await persistAppSettingsDoc({
        docId: logsDocId,
        data: {
          logs: trimmed,
          updatedAt,
        },
        addToast,
        localContext: 'generate logs',
        cloudContext: 'generate logs',
        localStorageKey: logsCacheKey(logsDocId),
        localStorageValue: json,
      });
    } catch (err) {
      suppressLogsSnapshotRef.current = false;
      throw err;
    }
    suppressLogsSnapshotRef.current = false;
  }, [addToast, logsDocId, logsSuffix, runtimeEffectsActive]);
  const { schedule: scheduleLogsPersist, flushNow: flushLogsPersistNow } = useLatestPersistQueue(persistLogs);
  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!logsLoadedRef.current) return;
    scheduleLogsPersist();
  }, [logs, runtimeEffectsActive, scheduleLogsPersist]);

  // Add a log entry with optional structured data
  const addLog = useCallback((action: string, details: string, extra?: Partial<LogEntry>) => {
    setLogs(prev => [...prev, { id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString(), action, details, ...extra }]);
  }, []);

  // Settings state â€” apiKey is loaded synchronously from localStorage so it's
  // never empty on mount (prevents the save effect from clobbering stored keys).
  const [settings, setSettings] = useState<GenerateSettings>(() => ({
    apiKey: readSharedGenerateApiKey(storageKey),
    selectedModel: DEFAULT_OPENROUTER_MODEL_ID,
    selectedModelLocked: false,
    selectedModelByView: {},
    selectedModelLockedByView: {},
    rateLimit: 5,
    minLen: 0,
    maxLen: 0,
    maxRetries: 3,
    temperature: 1.0,
    maxTokens: 0,
    reasoning: false,
    webSearch: false,
    prompt: defaultPrompt,
    slotPrompts: Object.fromEntries(promptSlots.map(s => [s.id, s.defaultPrompt])),
    slotValidators: Object.fromEntries(
      promptSlots
        .filter((slot) => slot.validatorLabel && typeof slot.defaultValidator === 'string')
        .map((slot) => [slot.id, slot.defaultValidator as string]),
    ),
  }));
  const settingsRef = useRef(settings);
  const settingsLocalEditVersionRef = useRef(0);
  const applySettingsState = useCallback((nextSettings: GenerateSettings, options?: { markLocalEdit?: boolean }) => {
    settingsRef.current = nextSettings;
    if (options?.markLocalEdit !== false) {
      settingsLocalEditVersionRef.current += 1;
    }
    setSettings(nextSettings);
  }, []);
  const updateSettingsState = useCallback((
    updater: GenerateSettings | ((prev: GenerateSettings) => GenerateSettings),
    options?: { markLocalEdit?: boolean },
  ) => {
    const nextSettings = typeof updater === 'function'
      ? (updater as (prev: GenerateSettings) => GenerateSettings)(settingsRef.current)
      : updater;
    applySettingsState(nextSettings, options);
    return nextSettings;
  }, [applySettingsState]);
  const normalizedPromptPolicy = useMemo(
    () => normalizeGeneratePromptPolicy({
      storageKey: suffix,
      defaultPrompt,
      promptSlots,
      prompt: settings.prompt,
      slotPrompts: settings.slotPrompts,
      slotValidators: settings.slotValidators,
    }),
    [defaultPrompt, promptSlots, settings.prompt, settings.slotPrompts, settings.slotValidators, suffix],
  );
  const effectivePrimaryPrompt = normalizedPromptPolicy.prompt;
  const effectiveSlotPrompts = normalizedPromptPolicy.slotPrompts;
  const pendingPageGuidePromptResetRef = useRef(false);
  const cachedPageGuidePromptMigrationRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSyncingSource, setIsSyncingSource] = useState(false);
  const [activePromptTab, setActivePromptTab] = useState(0); // 0 = primary, 1+ = slot index
  const validatorSlots = useMemo(
    () => promptSlots.filter((slot) => slot.validatorLabel && typeof slot.defaultValidator === 'string'),
    [promptSlots],
  );
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSort, setModelSort] = useState<'name' | 'price-asc' | 'price-desc'>('name');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const settingsLoadedRef = useRef(false);
  const activeModelScope = tableView === 'primary' ? PRIMARY_MODEL_SCOPE : tableView;
  const selectedModelId = getSelectedModelForScope(settings, activeModelScope);
  const selectedModelLocked = isSelectedModelLockedForScope(settings, activeModelScope);

  // Live rateLimit ref â€” workers read this to dynamically scale concurrency mid-generation
  const rateLimitRef = useRef(settings.rateLimit);
  useEffect(() => { rateLimitRef.current = settings.rateLimit; }, [settings.rateLimit]);
  // Shared worker-spawning function ref â€” set inside handleGenerate, called by rateLimit watcher
  const spawnWorkersRef = useRef<((count: number) => void) | null>(null);

  // Balance state
  const [balance, setBalance] = useState<number | null>(null);
  const [, setBalanceLoading] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [primaryRunPhase, setPrimaryRunPhase] = useState<GenerateRunPhase>('idle');
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeCountRef = useRef(0);
  const [rateLimitCount, setRateLimitCount] = useState(0); // 429 errors in current batch
  const throttledToastLevelRef = useRef(0); // 0 none, 1 mild, 2 severe

  // Throughput tracking â€” timestamps of completed rows (shared with GenerationTimer)
  const completionTimestamps = useRef<number[]>([]);

  // Live cost ref â€” updated immediately in generation loop (no renders), synced to display every 3s
  const liveCostRef = useRef(0);
  const [liveCost, setLiveCost] = useState(0);
  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(() => {
      setLiveCost(liveCostRef.current);
    }, 3000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Dynamic concurrency scaling â€” when user changes rateLimit mid-generation, spawn new workers
  const prevRateLimitRef = useRef(settings.rateLimit);
  useEffect(() => {
    const prev = prevRateLimitRef.current;
    prevRateLimitRef.current = settings.rateLimit;
    // Only act during active generation and when rateLimit increased
    if (isGenerating && settings.rateLimit > prev && spawnWorkersRef.current) {
      const delta = settings.rateLimit - prev;
      spawnWorkersRef.current(delta);
    }
    // Scale-down is handled inside processNext â€” excess workers exit naturally after their current item
  }, [settings.rateLimit, isGenerating]);

  // Surface hard-to-miss warnings when concurrency is too high for the current model/account.
  useEffect(() => {
    if (!isGenerating) {
      throttledToastLevelRef.current = 0;
      return;
    }
    const suggested = Math.max(1, Math.floor(settings.rateLimit / 2));
    if (rateLimitCount >= 3 && throttledToastLevelRef.current < 1) {
      throttledToastLevelRef.current = 1;
      addToast(
        `OpenRouter is throttling requests (429). Concurrency ${settings.rateLimit} may be too high â€” try ~${suggested}.`,
        'warning',
      );
    }
    if (rateLimitCount >= 10 && throttledToastLevelRef.current < 2) {
      throttledToastLevelRef.current = 2;
      addToast(
        `Heavy throttling detected (${rateLimitCount}x 429). Throughput drops due to retry backoff â€” lower concurrency now.`,
        'error',
      );
    }
  }, [rateLimitCount, isGenerating, settings.rateLimit, addToast]);

  // Expanded output rows â€” click to toggle full output view
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Timer state â€” only genStartTime needed, timer runs inside GenerationTimer component
  const [genStartTime, setGenStartTime] = useState<number | null>(null);

  // Per-slot generation state (keyed by slot ID)
  const [slotGenerating, setSlotGenerating] = useState<Record<string, boolean>>({});
  const [slotStopping, setSlotStopping] = useState<Record<string, boolean>>({});
  const slotGeneratingRef = useRef<Record<string, boolean>>({});
  useEffect(() => { slotGeneratingRef.current = slotGenerating; }, [slotGenerating]);
  const slotAbortRef = useRef<Record<string, boolean>>({});
  const slotAbortControllerRef = useRef<Record<string, AbortController | null>>({});
  const slotActiveCountRef = useRef<Record<string, number>>({});
  const [slotRunPhase, setSlotRunPhase] = useState<Record<string, GenerateRunPhase>>({});
  const [slotRateLimitCount, setSlotRateLimitCount] = useState<Record<string, number>>({});
  const slotCompletionTimestamps = useRef<Record<string, number[]>>({});
  const slotLiveCostRef = useRef<Record<string, number>>({});
  const [slotLiveCost, setSlotLiveCost] = useState<Record<string, number>>({});
  const [slotGenStartTime, setSlotGenStartTime] = useState<Record<string, number | null>>({});
  const slotSpawnWorkersRef = useRef<Record<string, ((count: number) => void) | null>>({});
  const isPrimaryPersisting = primaryRunPhase === 'persisting';
  const isAnySlotPersisting = useMemo(
    () => Object.values(slotRunPhase).some((phase) => phase === 'persisting'),
    [slotRunPhase],
  );
  const instanceBusy = useMemo(() => hasGenerateLifecycleActivity({
    isGenerating,
    slotGeneratingState: slotGenerating,
    isStopping,
    slotStoppingState: slotStopping,
    isSyncingSource: isSyncingSource || isPrimaryPersisting || isAnySlotPersisting,
  }), [isGenerating, slotGenerating, isStopping, slotStopping, isSyncingSource, isPrimaryPersisting, isAnySlotPersisting]);
  const mutatingControlsDisabledReason = 'Stop or wait for the current run to finish before switching views or changing rows.';
  const viewSwitchingDisabled = instanceBusy || disableViewSwitching;
  const viewSwitchingDisabledReasonText = disableViewSwitchingReason || mutatingControlsDisabledReason;
  const warnMutatingControlsDisabled = useCallback(() => {
    addToast(mutatingControlsDisabledReason, 'warning');
  }, [addToast, mutatingControlsDisabledReason]);

  const onBusyParentRef = useRef(onBusyStateChange);
  useLayoutEffect(() => {
    onBusyParentRef.current = onBusyStateChange;
  }, [onBusyStateChange]);

  useEffect(() => {
    onBusyParentRef.current?.(instanceBusy);
  }, [instanceBusy]);

  useEffect(
    () => () => {
      onBusyParentRef.current?.(false);
    },
    [],
  );

  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!populateFromSource?.load) return;
    if (hasActiveGeneration(isGenerating, slotGenerating)) return;
    if (!deferredUpstreamSyncRef.current) return;
    if (!rowsFirestoreLoadedRef.current) return;
    deferredUpstreamSyncRef.current = false;
    void flushUpstreamPipelineSync();
  }, [flushUpstreamPipelineSync, isGenerating, populateFromSource, rows, runtimeEffectsActive, slotGenerating]);

  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (hasActiveGeneration(isGenerating, slotGenerating)) return;
    if (deferredRowsSnapshotReloadSignal === 0) return;
    if (!deferredRowsSnapshotReloadRef.current) return;
    deferredRowsSnapshotReloadRef.current = false;
    void (async () => {
      try {
        await reloadDeferredRowsSnapshot();
      } catch {
        // Keep local generation state if the deferred reload fails.
      }
    })();
  }, [deferredRowsSnapshotReloadSignal, isGenerating, reloadDeferredRowsSnapshot, runtimeEffectsActive, slotGenerating]);

  // Sync live cost for slot generation (mirrors primary liveCost sync)
  useEffect(() => {
    const anySlotActive = Object.values(slotGenerating).some(Boolean);
    if (!anySlotActive) return;
    const interval = setInterval(() => {
      setSlotLiveCost({ ...slotLiveCostRef.current });
    }, 3000);
    return () => clearInterval(interval);
  }, [slotGenerating]);

  // Auto-input: populate slot inputs when primary output changes and slot status is pending
  // CRITICAL: Must NOT run during generation â€” direct setRows here would race with the
  // generation batch flush (which uses functional updates) and overwrite in-flight results.
  const prevPrimaryOutputsRef = useRef<string>('');
  useEffect(() => {
    if (promptSlots.length === 0) return;
    // Skip during ANY active generation to avoid overwriting batch flush updates
    if (isGenerating) return;
    const anySlotActive = Object.values(slotGeneratingRef.current).some(Boolean);
    if (anySlotActive) return;

    // Build a fingerprint of primary + slot outputs to detect changes
    // (must include slot outputs so downstream slots re-populate when upstream slots generate)
    const fingerprint = rows.map(r => {
      const slotOutputs = r.slots ? Object.values(r.slots).map(s => (s as GenerateSlotData).output).join('|') : '';
      return r.output + '\x01' + slotOutputs;
    }).join('\x00');
    if (fingerprint === prevPrimaryOutputsRef.current) return;
    prevPrimaryOutputsRef.current = fingerprint;

    // Use functional update to avoid overwriting concurrent state changes
    updateRowsState(prev => {
      let needsUpdate = false;
      const updatedRows = prev.map(r => {
        let rowChanged = false;
        const slots = { ...r.slots };
        for (const slotConfig of promptSlots) {
          if (!slotConfig.buildInput) continue;
          const sd = slots[slotConfig.id] ?? EMPTY_SLOT;
          // Only auto-populate if slot is pending
          if (sd.status !== 'pending') continue;
          const template = effectiveSlotPrompts[slotConfig.id] ?? slotConfig.defaultPrompt;
          const result = slotConfig.buildInput(template, r.output, buildExternalDataShared(r), r.input, r);
          const newInput = result.input || '';
          if (newInput !== sd.input) {
            slots[slotConfig.id] = { ...sd, input: newInput };
            rowChanged = true;
          }
        }
        if (rowChanged) { needsUpdate = true; return { ...r, slots }; }
        return r;
      });
      if (!needsUpdate) return prev;
      rowsRef.current = updatedRows;
      return updatedRows;
    });
  }, [effectiveSlotPrompts, isGenerating, promptSlots, rows]);

  // Header bar ref (for future use)
  const headerBarRef = useRef<HTMLDivElement>(null);

  // Clipboard copy feedback
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
  const [bulkCopied, setBulkCopied] = useState(false);

  // Undo state
  const [undoStack, setUndoStack] = useState<GenerateRow[][]>([]);

  // Status filter â€” auto-reset to 'all' when filtered view becomes empty
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'generated' | 'error'>(() => {
    try {
      const raw = localStorage.getItem(viewStateCacheKey(viewStateDocId));
      if (!raw) return 'all';
      const parsed = JSON.parse(raw);
      if (parsed?.statusFilter === 'pending') return 'pending';
      if (parsed?.statusFilter === 'generated') return 'generated';
      if (parsed?.statusFilter === 'error') return 'error';
      return 'all';
    } catch {
      return 'all';
    }
  });
  // Persist view state (table/log tab + status filter) per Generate instance.
  const viewStateLoadedRef = useRef(false);
  const lastSavedViewStateRef = useRef<string>('');
  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    let alive = true;
    const applyCachedViewState = async () => {
      const parsed = await loadCachedState<{ genSubTab?: 'table' | 'log'; statusFilter?: 'all' | 'pending' | 'generated' | 'error'; tableView?: string }>({
        idbKey: appSettingsIdbKey(viewStateDocId),
        localStorageKey: viewStateCacheKey(viewStateDocId),
      });
      if (!alive) return;
      const nextGenSubTab: 'table' | 'log' = parsed?.genSubTab === 'log' ? 'log' : 'table';
      const nextStatus: 'all' | 'pending' | 'generated' | 'error' =
        parsed?.statusFilter === 'pending' || parsed?.statusFilter === 'generated' || parsed?.statusFilter === 'error'
          ? parsed.statusFilter
          : 'all';
      const nextTableView = controlledTableView
        ?? (typeof parsed?.tableView === 'string' ? parsed.tableView : 'primary');
      const resolvedGenSubTab = controlledGenSubTab ?? nextGenSubTab;
      setGenSubTab(resolvedGenSubTab);
      setStatusFilter(nextStatus);
      setTableView(nextTableView);
      lastSavedViewStateRef.current = JSON.stringify({ genSubTab: resolvedGenSubTab, statusFilter: nextStatus, tableView: nextTableView });
      viewStateLoadedRef.current = true;
    };

    void applyCachedViewState();

    return () => {
      alive = false;
    };
  }, [controlledGenSubTab, controlledTableView, runtimeEffectsActive, suffix, viewStateDocId]);

  useEffect(() => {
    if (!controlledTableView) return;
    setTableView((prev) => (prev === controlledTableView ? prev : controlledTableView));
  }, [controlledTableView]);

  useEffect(() => {
    if (!controlledGenSubTab) return;
    setGenSubTab((prev) => (prev === controlledGenSubTab ? prev : controlledGenSubTab));
  }, [controlledGenSubTab]);

  useEffect(() => {
    if (tableView === 'primary') {
      setActivePromptTab((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const slotIdx = promptSlots.findIndex((slot) => slot.id === tableView);
    if (slotIdx < 0) return;
    setActivePromptTab((prev) => (prev === slotIdx + 1 ? prev : slotIdx + 1));
  }, [promptSlots, tableView]);

  const persistViewState = useCallback(async () => {
    if (!runtimeEffectsActive) return;
    if (!viewStateLoadedRef.current) return;
    const json = JSON.stringify({ genSubTab, statusFilter, tableView });
    if (json === lastSavedViewStateRef.current) return;
    lastSavedViewStateRef.current = json;
    await persistLocalCachedState({
      idbKey: appSettingsIdbKey(viewStateDocId),
      value: { genSubTab, statusFilter, tableView },
      localStorageKey: viewStateCacheKey(viewStateDocId),
      localStorageValue: json,
      addToast,
      localContext: 'generate view state',
    });
  }, [addToast, genSubTab, runtimeEffectsActive, statusFilter, tableView, suffix, viewStateDocId]);
  const { schedule: scheduleViewStatePersist, flushNow: flushViewStatePersistNow } = useLatestPersistQueue(persistViewState);
  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!viewStateLoadedRef.current) return;
    scheduleViewStatePersist();
  }, [genSubTab, runtimeEffectsActive, statusFilter, tableView, scheduleViewStatePersist]);

  // Clear all inputs
  const handleClearAll = useCallback(() => {
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    const cur = rowsRef.current;
    const contentCount = countClearableRowsForView(cur, tableView, promptSlots);
    if (contentCount === 0) return;
    const nextRows = clearRowsForView({
      rows: cur,
      tableView,
      promptSlots,
      slotPrompts: settingsRef.current.slotPrompts,
      storageKey: suffix,
      createPrimaryRows: () => makeFreshEmptyRows(20),
    });
    setUndoStack(prev => [...prev.slice(-9), cur]);
    applyRowsState(nextRows);
    addLog(
      'clear_all',
      tableView === 'primary'
        ? `Cleared ${contentCount} rows`
        : `Cleared ${contentCount} ${promptSlots.find((slot) => slot.id === tableView)?.label ?? tableView} row${contentCount === 1 ? '' : 's'}`,
    );
  }, [addLog, instanceBusy, promptSlots, suffix, tableView, warnMutatingControlsDisabled]);

  // Clear a single cell (primary + all slots)
  const handleClearCell = useCallback((rowId: string) => {
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    setUndoStack(prev => [...prev.slice(-9), rowsRef.current]);
    updateRowsState(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const nextMetadata = { ...(r.metadata ?? {}) };
      for (const key of clearMetadataKeysOnReset) delete nextMetadata[key];
      for (const slot of promptSlots) {
        for (const key of slot.clearMetadataKeysOnReset ?? []) delete nextMetadata[key];
      }
      const cleared: GenerateRow = {
        ...r,
        input: '',
        output: '',
        status: 'pending',
        error: undefined,
        generatedAt: undefined,
        durationMs: undefined,
        metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
      };
      if (r.slots) {
        const clearedSlots: Record<string, GenerateSlotData> = {};
        for (const k of Object.keys(r.slots)) {
          clearedSlots[k] = { ...EMPTY_SLOT };
        }
        cleared.slots = clearedSlots;
      }
      return cleared;
    }));
  }, [clearMetadataKeysOnReset, instanceBusy, promptSlots, warnMutatingControlsDisabled]);

  // Undo last clear
  const handleUndo = useCallback(() => {
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    applyRowsState(previous);
  }, [instanceBusy, undoStack, warnMutatingControlsDisabled]);

  // Copy single output to clipboard
  const handleCopyOutput = useCallback((rowId: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedRowId(rowId);
      setTimeout(() => setCopiedRowId(null), 1500);
    });
  }, []);

  // Bulk copy all outputs to clipboard â€” TSV format so paste into Google Sheets preserves formatting per cell
  const handleBulkCopy = useCallback(() => {
    const outputRows = rowsRef.current.filter(r => r.output.trim());
    if (outputRows.length === 0) return;
    // Build TSV: each output is a quoted cell (one per row), internal newlines preserved inside quotes
    const tsvRows = outputRows.map(r => {
      const escaped = r.output.trim().replace(/"/g, '""');
      return `"${escaped}"`;
    });
    const tsv = tsvRows.join('\n');
    // Write both text/plain and text/html so spreadsheet apps treat it as cell data
    const html = '<table>' + outputRows.map(r => {
      const cell = r.output.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      return `<tr><td>${cell}</td></tr>`;
    }).join('') + '</table>';
    const blob = new Blob([html], { type: 'text/html' });
    const textBlob = new Blob([tsv], { type: 'text/plain' });
    navigator.clipboard.write([
      new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
    ]).then(() => {
      setBulkCopied(true);
      setTimeout(() => setBulkCopied(false), 2000);
    });
  }, []);

  // Export all rows to CSV
  const handleExport = useCallback(() => {
    const dataRows = rowsRef.current.filter(r => r.input.trim() || r.output.trim());
    if (dataRows.length === 0) return;
    const escCsv = (s: string) => {
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    // Build header with slot columns
    let header = '#,Status,Input,Output,Len,Retries,Cost,Prompt Tokens,Completion Tokens,Date';
    for (const slot of promptSlots) {
      header += `,${slot.label} Status,${slot.label} Input,${slot.label} Output,${slot.label} Len,${slot.label} Retries,${slot.label} Cost,${slot.label} Prompt Tokens,${slot.label} Completion Tokens,${slot.label} Date`;
    }
    const csvRows = dataRows.map((r, i) => {
      const primary = [
        i + 1,
        r.status,
        escCsv(r.input),
        escCsv(r.output),
        r.output ? r.output.length : '',
        r.retries || 0,
        r.cost ? r.cost.toFixed(6) : '',
        r.promptTokens || '',
        r.completionTokens || '',
        r.generatedAt || '',
      ];
      for (const slot of promptSlots) {
        const sd = getSlot(r, slot.id);
        primary.push(
          sd.status,
          escCsv(sd.input),
          escCsv(sd.output),
          sd.output ? String(sd.output.length) : '',
          String(sd.retries || 0),
          sd.cost ? sd.cost.toFixed(6) : '',
          String(sd.promptTokens || ''),
          String(sd.completionTokens || ''),
          sd.generatedAt || '',
        );
      }
      return primary.join(',');
    });
    const csv = [header, ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generate-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('export', `Exported ${dataRows.length} rows to CSV`);
  }, [addLog]);

  // SECURITY: apiKey is NEVER included in shared settings â€” it stays in
  // localStorage only (per-browser, never sent to Firestore/IDB).
  const toSharedGenerateSettings = useCallback((value: GenerateSettings) => {
    const normalizedPolicy = normalizeGeneratePromptPolicy({
      storageKey: suffix,
      defaultPrompt,
      promptSlots,
      prompt: value.prompt,
      slotPrompts: value.slotPrompts,
      slotValidators: value.slotValidators,
    });
    return {
      selectedModel: value.selectedModel,
      selectedModelLocked: value.selectedModelLocked,
      ...(value.selectedModelByView && Object.keys(value.selectedModelByView).length > 0 ? { selectedModelByView: value.selectedModelByView } : {}),
      ...(value.selectedModelLockedByView && Object.keys(value.selectedModelLockedByView).length > 0 ? { selectedModelLockedByView: value.selectedModelLockedByView } : {}),
      rateLimit: value.rateLimit,
      minLen: value.minLen,
      maxLen: value.maxLen,
      maxRetries: value.maxRetries,
      temperature: value.temperature,
      maxTokens: value.maxTokens,
      reasoning: value.reasoning,
      webSearch: value.webSearch,
      prompt: normalizedPolicy.prompt,
      ...(normalizedPolicy.slotPrompts && Object.keys(normalizedPolicy.slotPrompts).length > 0 ? { slotPrompts: normalizedPolicy.slotPrompts } : {}),
      ...(normalizedPolicy.slotValidators && Object.keys(normalizedPolicy.slotValidators).length > 0 ? { slotValidators: normalizedPolicy.slotValidators } : {}),
    };
  }, [defaultPrompt, promptSlots, suffix]);

  // SECURITY: apiKey persisted to localStorage immediately on every change â€”
  // independent of Firestore guards/debounce so it never gets blocked.
  // Track the last persisted value instead of skipping the first effect so
  // a fast first edit cannot be dropped before the initial effect flushes.
  const lastPersistedApiKeyRef = useRef(settings.apiKey);
  const persistSharedApiKeyImmediately = useCallback((nextApiKey: string) => {
    lastPersistedApiKeyRef.current = nextApiKey;
    try {
      localStorage.setItem(SHARED_API_KEY_CACHE_KEY, nextApiKey);
      window.dispatchEvent(new CustomEvent<string>(SHARED_API_KEY_EVENT, { detail: nextApiKey }));
    } catch {
      /* quota */
    }
  }, []);
  useEffect(() => {
    if (!shouldPersistSharedGenerateApiKey(lastPersistedApiKeyRef.current, settings.apiKey)) return;
    lastPersistedApiKeyRef.current = settings.apiKey;
    try {
      localStorage.setItem(SHARED_API_KEY_CACHE_KEY, settings.apiKey);
      window.dispatchEvent(new CustomEvent<string>(SHARED_API_KEY_EVENT, { detail: settings.apiKey }));
    } catch {
      /* quota */
    }
  }, [settings.apiKey]);

  useEffect(() => {
    const syncSharedApiKey = (nextApiKey: string) => {
      lastPersistedApiKeyRef.current = nextApiKey;
      updateSettingsState((prev) => (prev.apiKey === nextApiKey ? prev : { ...prev, apiKey: nextApiKey }));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SHARED_API_KEY_CACHE_KEY) return;
      syncSharedApiKey((event.newValue ?? '').trim());
    };

    const handleCustom = (event: Event) => {
      const nextApiKey = (event as CustomEvent<string>).detail ?? '';
      syncSharedApiKey(nextApiKey.trim());
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(SHARED_API_KEY_EVENT, handleCustom as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SHARED_API_KEY_EVENT, handleCustom as EventListener);
    };
  }, []);

  // suppressSettingsSnapshotRef prevents onSnapshot echo from overwriting in-flight
  // local settings changes (same pattern as rows suppress).
  const suppressSettingsSnapshotRef = useRef(false);
  const lastSettingsWrittenAtRef = useRef<string>('');

  // Persist settings to Firestore (debounced, skip if unchanged from last save/load)
  // SECURITY: apiKey is persisted ONLY to localStorage (above), never to Firestore/IDB.
  const lastSavedSettingsRef = useRef<string>(JSON.stringify(toSharedGenerateSettings(settings)));
  const persistSettings = useCallback(async () => {
    if (!runtimeEffectsActive) return;
    if (!settingsLoadedRef.current) return;
    // Don't persist until Firestore has confirmed its state â€” prevents
    // writing empty defaults that overwrite real data in Firestore
    if (!firestoreLoadedRef.current) return;
    const json = JSON.stringify(toSharedGenerateSettings(settings));
    if (json === lastSavedSettingsRef.current) return;
    lastSavedSettingsRef.current = json;
    const updatedAt = new Date().toISOString();
    lastSettingsWrittenAtRef.current = updatedAt;
    suppressSettingsSnapshotRef.current = true;
    try {
      await persistAppSettingsDoc({
        docId: settingsDocId,
        data: {
          ...toSharedGenerateSettings(settings),
          updatedAt,
        },
        addToast,
        localContext: 'generate settings',
        cloudContext: 'generate settings',
        localStorageKey: settingsCacheKey(settingsDocId),
        localStorageValue: json,
      });
    } catch (err) {
      suppressSettingsSnapshotRef.current = false;
      throw err;
    }
    suppressSettingsSnapshotRef.current = false;
  }, [addToast, runtimeEffectsActive, settings, settingsDocId, suffix, toSharedGenerateSettings]);
  const { schedule: scheduleSettingsPersist, flushNow: flushSettingsPersistNow } = useLatestPersistQueue(persistSettings);
  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!settingsLoadedRef.current) return;
    scheduleSettingsPersist();
  }, [runtimeEffectsActive, settings, scheduleSettingsPersist]);
  const persistProjectedSettingsImmediately = useCallback((nextSettings: GenerateSettings) => {
    const projected = toSharedGenerateSettings(nextSettings);
    const json = JSON.stringify(projected);
    cacheStateLocallyBestEffort({
      idbKey: appSettingsIdbKey(settingsDocId),
      value: projected,
      localStorageKey: settingsCacheKey(settingsDocId),
      localStorageValue: json,
    });

    if (!settingsLoadedRef.current || !firestoreLoadedRef.current) {
      return;
    }

    const updatedAt = new Date().toISOString();
    lastSettingsWrittenAtRef.current = updatedAt;
    suppressSettingsSnapshotRef.current = true;
    void persistAppSettingsDoc({
      docId: settingsDocId,
      data: {
        ...projected,
        updatedAt,
      },
      addToast,
      localContext: 'generate settings',
      cloudContext: 'generate settings',
      localStorageKey: settingsCacheKey(settingsDocId),
      localStorageValue: json,
    }).then(() => {
      suppressSettingsSnapshotRef.current = false;
    }).catch((err) => {
      suppressSettingsSnapshotRef.current = false;
      reportPersistFailure(addToast, 'generate settings', err);
    });

    if (sharedSelectedModelDocId !== settingsDocId && nextSettings.selectedModel.trim() && !nextSettings.selectedModelLocked) {
      void persistAppSettingsDoc({
        docId: sharedSelectedModelDocId,
        data: {
          selectedModel: nextSettings.selectedModel,
          updatedAt,
        },
        addToast,
        localContext: 'shared model setting',
        cloudContext: 'shared model setting',
        merge: true,
      });
    }
  }, [addToast, settingsDocId, sharedSelectedModelDocId, suffix, toSharedGenerateSettings]);
  const selectedModelPersistMountedRef = useRef(false);
  const selectedModelStateJson = JSON.stringify({
    selectedModel: settings.selectedModel,
    selectedModelLocked: settings.selectedModelLocked,
    selectedModelByView: settings.selectedModelByView ?? {},
    selectedModelLockedByView: settings.selectedModelLockedByView ?? {},
  });
  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!selectedModelPersistMountedRef.current) {
      selectedModelPersistMountedRef.current = true;
      return;
    }
    if (!settingsLoadedRef.current || !firestoreLoadedRef.current) return;
    void flushSettingsPersistNow();
    if (!settings.selectedModel || settings.selectedModelLocked || sharedSelectedModelDocId === settingsDocId) return;
    void persistAppSettingsDoc({
      docId: sharedSelectedModelDocId,
      data: {
        selectedModel: settings.selectedModel,
        updatedAt: new Date().toISOString(),
      },
      addToast,
      localContext: 'shared model setting',
      cloudContext: 'shared model setting',
      merge: true,
    });
  }, [addToast, flushSettingsPersistNow, runtimeEffectsActive, selectedModelStateJson, settings.selectedModel, settings.selectedModelLocked, sharedSelectedModelDocId, settingsDocId]);

  // Load settings from Firestore and keep them live-synced
  // firestoreLoadedRef prevents the async IDB fallback from overwriting
  // authoritative Firestore data that arrived while IDB was still reading.
  const firestoreLoadedRef = useRef(false);

  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    let alive = true;
    firestoreLoadedRef.current = false;

    const applyCachedSettings = async () => {
      const startSettingsEditVersion = settingsLocalEditVersionRef.current;
      const cached = await loadCachedState<Partial<GenerateSettings>>({
        idbKey: appSettingsIdbKey(settingsDocId),
        localStorageKey: settingsCacheKey(settingsDocId),
      });
      // Re-check after async: if Firestore already delivered real data, don't overwrite it
      if (!alive || firestoreLoadedRef.current || settingsLocalEditVersionRef.current !== startSettingsEditVersion) return;
      const localApiKey = readSharedGenerateApiKey(suffix);
      const normalizedCachedPolicy = normalizeGeneratePromptPolicy({
        storageKey: suffix,
        defaultPrompt,
        promptSlots,
        prompt: cached?.prompt,
        slotPrompts: cached?.slotPrompts,
        slotValidators: cached?.slotValidators,
      });
      cachedPageGuidePromptMigrationRef.current = normalizedCachedPolicy.didMigratePageGuidePrompt;
      const defaultSettings: GenerateSettings = cached ? {
        apiKey: localApiKey,
        selectedModel: cached.selectedModel || cached.selectedModelByView?.[PRIMARY_MODEL_SCOPE] || DEFAULT_OPENROUTER_MODEL_ID,
        selectedModelLocked: cached.selectedModelLocked ?? cached.selectedModelLockedByView?.[PRIMARY_MODEL_SCOPE] ?? false,
        selectedModelByView: cached.selectedModelByView ?? {},
        selectedModelLockedByView: cached.selectedModelLockedByView ?? {},
        rateLimit: Math.max(1, Math.min(100, Number(cached.rateLimit) || 5)),
        minLen: cached.minLen || 0,
        maxLen: cached.maxLen || 0,
        maxRetries: cached.maxRetries ?? 3,
        temperature: cached.temperature ?? 1.0,
        maxTokens: cached.maxTokens || 0,
        reasoning: cached.reasoning === 'low' || cached.reasoning === 'medium' || cached.reasoning === 'high' ? cached.reasoning : false,
        webSearch: cached.webSearch ?? false,
        prompt: normalizedCachedPolicy.prompt,
        slotPrompts: normalizedCachedPolicy.slotPrompts,
        slotValidators: normalizedCachedPolicy.slotValidators,
      } : {
        apiKey: localApiKey,
        selectedModel: DEFAULT_OPENROUTER_MODEL_ID,
        selectedModelLocked: false,
        selectedModelByView: {},
        selectedModelLockedByView: {},
        rateLimit: 5,
        minLen: 0,
        maxLen: 0,
        maxRetries: 3,
        temperature: 1.0,
        maxTokens: 0,
        reasoning: false,
        webSearch: false,
        prompt: normalizedCachedPolicy.prompt,
        slotPrompts: normalizedCachedPolicy.slotPrompts,
        slotValidators: normalizedCachedPolicy.slotValidators,
      };
      const hydratedSettings = hydrateGenerateSettings(settingsRef.current, defaultSettings);
      lastSavedSettingsRef.current = normalizedCachedPolicy.didMigratePromptPolicy
        ? ''
        : JSON.stringify(toSharedGenerateSettings(hydratedSettings));
      applySettingsState(hydratedSettings, { markLocalEdit: false });
      settingsLoadedRef.current = true;
    };

    void applyCachedSettings();

    const unsub = subscribeAppSettingsDoc({
      docId: settingsDocId,
      channel: makeAppSettingsChannel('settings', settingsDocId),
      onData: async (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        if (snap.exists()) {
          const startSettingsEditVersion = settingsLocalEditVersionRef.current;
          const data = snap.data();
          const localApiKey = readSharedGenerateApiKey(suffix);
          // Suppress echo from our own write to prevent overwriting newer local state
          const settingsUpdatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : '';
          if (suppressSettingsSnapshotRef.current && settingsUpdatedAt && settingsUpdatedAt === lastSettingsWrittenAtRef.current) {
            suppressSettingsSnapshotRef.current = false;
            return;
          }
          // SECURITY: If a stale apiKey exists in Firestore, scrub it immediately
          if (data.apiKey) {
            try {
              void deleteAppSettingsDocFieldsRemote({
                docId: settingsDocId,
                fields: ['apiKey'],
                cloudContext: 'generate settings security scrub',
                registryKind: 'settings',
              });
            } catch { /* best-effort scrub */ }
          }
          const normalizedFsPolicy = normalizeGeneratePromptPolicy({
            storageKey: suffix,
            defaultPrompt,
            promptSlots,
            prompt: data.prompt,
            slotPrompts: data.slotPrompts,
            slotValidators: data.slotValidators,
          });
          cachedPageGuidePromptMigrationRef.current = false;
          pendingPageGuidePromptResetRef.current = normalizedFsPolicy.didMigratePageGuidePrompt;
          const fsSettings: GenerateSettings = {
            apiKey: localApiKey, // SECURITY: always from localStorage, never Firestore
            selectedModel: data.selectedModel || data.selectedModelByView?.[PRIMARY_MODEL_SCOPE] || DEFAULT_OPENROUTER_MODEL_ID,
            selectedModelLocked: data.selectedModelLocked ?? data.selectedModelLockedByView?.[PRIMARY_MODEL_SCOPE] ?? false,
            selectedModelByView: data.selectedModelByView ?? {},
            selectedModelLockedByView: data.selectedModelLockedByView ?? {},
            rateLimit: Math.max(1, Math.min(100, Number(data.rateLimit) || 5)),
            minLen: data.minLen || 0,
            maxLen: data.maxLen || 0,
            maxRetries: data.maxRetries ?? 3,
            temperature: data.temperature ?? 1.0,
            maxTokens: data.maxTokens || 0,
            reasoning: data.reasoning === 'low' || data.reasoning === 'medium' || data.reasoning === 'high' ? data.reasoning : false,
            webSearch: data.webSearch ?? false,
            prompt: normalizedFsPolicy.prompt,
            slotPrompts: normalizedFsPolicy.slotPrompts,
            slotValidators: normalizedFsPolicy.slotValidators,
          };
          const hydratedSettings = hydrateGenerateSettings(settingsRef.current, fsSettings);
          if (settingsLocalEditVersionRef.current !== startSettingsEditVersion) {
            return;
          }
          const sharedJson = JSON.stringify(toSharedGenerateSettings(hydratedSettings));
          cacheStateLocallyBestEffort({
            idbKey: appSettingsIdbKey(settingsDocId),
            value: toSharedGenerateSettings(hydratedSettings),
            localStorageKey: settingsCacheKey(settingsDocId),
            localStorageValue: sharedJson,
          });
          lastSavedSettingsRef.current = normalizedFsPolicy.didMigratePromptPolicy ? '' : sharedJson;
          firestoreLoadedRef.current = true;
          applySettingsState(hydratedSettings, { markLocalEdit: false });
          settingsLoadedRef.current = true;
          return;
        }
        // Doc doesn't exist on server â€” only fall back to cache if Firestore
        // hasn't already provided data (prevents overwriting with stale cache)
        if (!firestoreLoadedRef.current) {
          if (!isFromCache) {
            firestoreLoadedRef.current = true;
            pendingPageGuidePromptResetRef.current = cachedPageGuidePromptMigrationRef.current;
            settingsLoadedRef.current = true;
            return;
          }
          await applyCachedSettings();
        }
      },
      onError: async (err) => {
        reportPersistFailure(addToast, 'generate settings sync', err);
        if (!firestoreLoadedRef.current) {
          await applyCachedSettings();
          pendingPageGuidePromptResetRef.current = cachedPageGuidePromptMigrationRef.current;
        }
      },
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [suffix, toSharedGenerateSettings, addToast, runtimeEffectsActive, settingsDocId]);

  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    if (sharedSelectedModelDocId === settingsDocId) return;
    const unsub = subscribeAppSettingsDoc({
      docId: sharedSelectedModelDocId,
      channel: makeAppSettingsChannel('shared-selected-model', sharedSelectedModelDocId),
      onData: (snap) => {
        const isFromCache = snap.metadata.fromCache;
        if (!snap.exists() && isFromCache) return;
        if (!snap.exists()) return;
        const sharedModel = typeof snap.data()?.selectedModel === 'string' ? snap.data().selectedModel.trim() : '';
        if (!sharedModel) return;
          updateSettingsState((prev) => {
            if (!shouldApplySharedSelectedModel(isSelectedModelLockedForScope(prev, PRIMARY_MODEL_SCOPE))) return prev;
            const nextSelectedModel = preferExistingSelectedModel(getSelectedModelForScope(prev, PRIMARY_MODEL_SCOPE), sharedModel);
            if (nextSelectedModel === getSelectedModelForScope(prev, PRIMARY_MODEL_SCOPE)) return prev;
            return withScopedSelectedModel(prev, PRIMARY_MODEL_SCOPE, nextSelectedModel);
          });
      },
      onError: (err) => {
        reportPersistFailure(addToast, 'shared selected model sync', err);
      },
    });
    return () => unsub();
  }, [addToast, runtimeEffectsActive, sharedSelectedModelDocId, settingsDocId]);

  // Close model dropdown on outside click â€” only listen when dropdown is actually open
  useEffect(() => {
    if (!isModelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isModelDropdownOpen]);

  // Clean up abort all in-flight requests on unmount (prevents hidden background generation)
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      abortRef.current = true;
    };
  }, []);

  // Flush all pending saves on page close or component unmount â€” wrapped in try/catch to never crash
  const flushAllSaves = useCallback(async () => {
    // Sequential writes — IDB readwrite transactions serialize internally anyway.
    // Parallel calls just create lock contention and increase abort risk on large payloads.
    try { await flushRowsSaveNow(); } catch (e) { console.warn('flushAllSaves (rows):', e); }
    try { await flushLogsPersistNow(); } catch (e) { console.warn('flushAllSaves (logs):', e); }
    try { await flushViewStatePersistNow(); } catch (e) { console.warn('flushAllSaves (viewState):', e); }
    try { await flushSettingsPersistNow(); } catch (e) { console.warn('flushAllSaves (settings):', e); }
  }, [flushLogsPersistNow, flushRowsSaveNow, flushSettingsPersistNow, flushViewStatePersistNow]);

  // beforeunload â€” flush on tab close / browser close
  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    const handleBeforeUnload = () => {
      void flushAllSaves();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Also flush on component unmount (e.g., switching main tabs)
      void flushAllSaves();
    };
  }, [flushAllSaves, runtimeEffectsActive]);

  // Fetch models from OpenRouter
  const fetchModels = useCallback(async () => {
    const apiKey = resolveRequestApiKey(settingsRef.current.apiKey, suffix);
    if (!apiKey) {
      setModelsError('Enter an API key first');
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const modelList: OpenRouterModel[] = (data.data || [])
        .filter((m: any) => m.id && m.name)
        .map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          pricing: {
            prompt: m.pricing?.prompt || '0',
            completion: m.pricing?.completion || '0',
          },
          context_length: m.context_length || 0,
        }))
        .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));
        setModels(modelList);
        const currentSettings = settingsRef.current;
        const availableModelIds = modelList.map((model) => model.id);
        const currentSelectedModel = getSelectedModelForScope(currentSettings, activeModelScope);
        const shouldNormalizeSelection =
          modelList.length > 0 &&
          !isSelectedModelLockedForScope(currentSettings, activeModelScope) &&
          (
            shouldAutoSelectDefaultModel({
              settingsLoaded: settingsLoadedRef.current,
              firestoreLoaded: firestoreLoadedRef.current,
              sharedSelectedModelStorageKey,
              settings: currentSettings,
              scope: activeModelScope,
            }) ||
            !availableModelIds.includes(currentSelectedModel.trim())
          );
        if (shouldNormalizeSelection) {
          const nextSettings = withScopedSelectedModel(
            currentSettings,
            activeModelScope,
            normalizePreferredOpenRouterModel(currentSelectedModel, availableModelIds),
          );
          applySettingsState(nextSettings);
          persistProjectedSettingsImmediately(nextSettings);
        }
      } catch (e: any) {
        setModelsError(e.message || 'Failed to fetch models');
      } finally {
        setModelsLoading(false);
      }
  }, [activeModelScope, persistProjectedSettingsImmediately, sharedSelectedModelStorageKey, suffix]);

  // Fetch balance from OpenRouter
  const fetchBalance = useCallback(async () => {
    const apiKey = resolveRequestApiKey(settingsRef.current.apiKey, suffix);
    if (!apiKey) return;
    setBalanceLoading(true);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      // data.data.total_credits and data.data.total_usage in USD
      const remaining = (data.data?.total_credits ?? 0) - (data.data?.total_usage ?? 0);
      setBalance(remaining);
    } catch {
      // Ignore balance fetch failures to avoid noisy UI errors.
    }
    setBalanceLoading(false);
  }, [suffix]);

  // Auto-fetch models + balance when API key changes
  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (settings.apiKey.trim().length > 10) {
      fetchModels();
      fetchBalance();
    }
  }, [fetchBalance, fetchModels, runtimeEffectsActive, settings.apiKey]);

  // Filtered + sorted models for dropdown â€” starred always pinned to top
  const filteredModels = useMemo(() => {
    let result = models;
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      result = result.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    if (modelSort === 'price-asc') {
      result = [...result].sort((a, b) => (parseFloat(a.pricing?.prompt) || 0) - (parseFloat(b.pricing?.prompt) || 0));
    } else if (modelSort === 'price-desc') {
      result = [...result].sort((a, b) => (parseFloat(b.pricing?.prompt) || 0) - (parseFloat(a.pricing?.prompt) || 0));
    }
    // Pin starred models to top (preserve relative order within each group)
    if (starredModels.size > 0) {
      const starred = result.filter(m => starredModels.has(m.id));
      const unstarred = result.filter(m => !starredModels.has(m.id));
      result = [...starred, ...unstarred];
    }
    return result;
  }, [models, modelSearch, modelSort, starredModels]);

  const selectedModelObj = useMemo(() => models.find(m => m.id === selectedModelId), [models, selectedModelId]);

  // Parse Google Sheets clipboard text properly
  const parseSheetsPaste = (text: string): string[] => {
    const results: string[] = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '"') {
        let cell = '';
        i++;
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else if (text[i] === '"') {
            i++;
            break;
          } else {
            cell += text[i];
            i++;
          }
        }
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        if (text[i] === '\r') i++;
        if (text[i] === '\n') i++;
        results.push(cell.trim());
      } else {
        let cell = '';
        while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') {
          cell += text[i];
          i++;
        }
        if (text[i] === '\t') {
          while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
        }
        if (text[i] === '\r') i++;
        if (text[i] === '\n') i++;
        if (cell.trim()) results.push(cell.trim());
      }
    }
    return results;
  };

  // Handle paste from Google Sheets
  const handlePaste = useCallback((e: React.ClipboardEvent, startRowIdx: number) => {
    if (instanceBusy) {
      e.preventDefault();
      warnMutatingControlsDisabled();
      return;
    }
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text.trim()) return;

    const pastedCells = parseSheetsPaste(text);
    if (pastedCells.length === 0) return;

    if (pastedCells.length === 1) {
      updateRowsState(prev => prev.map((r, idx) =>
        idx === startRowIdx ? { ...r, input: pastedCells[0], status: 'pending', output: '', error: undefined, generatedAt: undefined, durationMs: undefined } : r
      ));
      return;
    }

    updateRowsState(prev => {
      const updated = [...prev];
      for (let i = 0; i < pastedCells.length; i++) {
        const targetIdx = startRowIdx + i;
        if (targetIdx < updated.length) {
          updated[targetIdx] = { ...updated[targetIdx], input: pastedCells[i], status: 'pending', output: '', error: undefined, generatedAt: undefined, durationMs: undefined };
        } else {
          updated.push({
            id: `row_${Date.now()}_${i}`,
            status: 'pending',
            input: pastedCells[i],
            output: '',
          });
        }
      }
      return updated;
    });
  }, [instanceBusy, warnMutatingControlsDisabled]);

  // Call OpenRouter API for a single row â€” auto-retries on 429 with exponential backoff
  // Uses AbortSignal to cancel in-flight requests when user clicks Stop
  const generateForRow = async (row: GenerateRow, signal: AbortSignal): Promise<{ output: string; metadata?: Record<string, string>; validationError?: string; durationMs: number; promptTokens: number; completionTokens: number; cost: number } | { error: string; durationMs: number }> => {
    const startTime = performance.now();
    const maxRateLimitRetries = 5;
    const primaryModelId = getSelectedModelForScope(settings, PRIMARY_MODEL_SCOPE);
    const primaryModel = models.find((m) => m.id === primaryModelId);
    const apiKey = resolveRequestApiKey(settingsRef.current.apiKey, suffix);

    if (!apiKey) {
      return { error: 'Missing OpenRouter API key. Open Settings and enter a valid key.', durationMs: 0 };
    }

    for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
      if (signal.aborted) return { error: '__aborted__', durationMs: Math.round(performance.now() - startTime) };
      let timedOut = false;

      try {
        const timedResponse = await runWithOpenRouterTimeout({
          signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': window.location.origin,
            },
            body: JSON.stringify({
              model: primaryModelId,
              messages: [
                ...(effectivePrimaryPrompt.trim() ? [{ role: 'system' as const, content: effectivePrimaryPrompt.trim() }] : []),
                { role: 'user', content: row.input },
              ],
              temperature: settings.temperature ?? 1.0,
              ...(settings.maxTokens > 0 ? { max_tokens: settings.maxTokens } : {}),
              ...(settings.reasoning ? { reasoning: { effort: settings.reasoning } } : {}),
              ...(settings.webSearch ? { plugins: [{ id: 'web' }] } : {}),
              ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
            }),
            signal: requestSignal,
          }),
        });
        const res = timedResponse.result;
        timedOut = timedResponse.timedOut;

        // Rate limited â€” auto-retry with exponential backoff
        if (res.status === 429) {
          setRateLimitCount(prev => prev + 1);
          if (attempt < maxRateLimitRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // 1s, 2s, 4s, 8s, 16s max 30s
            const completedDelay = await waitForDelayOrAbort(delay, signal);
            if (!completedDelay) return { error: '__aborted__', durationMs: Math.round(performance.now() - startTime) };
            continue;
          }
          return { error: `Rate limited (429) â€” ${maxRateLimitRetries} retries exhausted. Lower concurrent requests.`, durationMs: Math.round(performance.now() - startTime) };
        }

        if (!res.ok) {
          const timedErrText = await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async () => res.text(),
          }).catch(() => ({ result: '', timedOut }));
          const errText = timedErrText.result;
          timedOut = timedErrText.timedOut;
          return { error: `API ${res.status}: ${errText.slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
        }

        const timedJson = await runWithOpenRouterTimeout({
          signal,
          timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
          run: async () => res.json(),
        });
        const data = timedJson.result;
        timedOut = timedJson.timedOut;
        // Check for API-level error in response body (some models return 200 with error in body)
        if (data.error) {
          return { error: `API error: ${typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error).slice(0, 200)}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const rawOutput = data.choices?.[0]?.message?.content || '';
        // SAFEGUARD: Never silently accept empty output â€” treat as error so user sees it and money isn't wasted
        if (!rawOutput.trim()) {
          console.warn('generateForRow: API returned empty output for row', row.id, 'response:', JSON.stringify(data).slice(0, 300));
          return { error: `Empty response from API (model returned no content). Response: ${JSON.stringify(data).slice(0, 150)}`, durationMs: Math.round(performance.now() - startTime) };
        }
        let transformedOutput = rawOutput;
        let transformedMetadata: Record<string, string> | undefined;
        let validationError: string | undefined;
        if (transformPrimaryOutput) {
          try {
            const transformed = transformPrimaryOutput({ rawOutput, row });
            transformedOutput = transformed.output;
            transformedMetadata = transformed.metadata;
            validationError = transformed.validationError;
          } catch (err) {
            return {
              error: err instanceof Error ? err.message : 'Output parsing failed',
              durationMs: Math.round(performance.now() - startTime),
            };
          }
        }
        if (!transformedOutput.trim()) {
          return { error: 'Output parsing produced an empty result.', durationMs: Math.round(performance.now() - startTime) };
        }
        const promptTokens = toFiniteNumber(data.usage?.prompt_tokens);
        const completionTokens = toFiniteNumber(data.usage?.completion_tokens);
        const model = primaryModel;
        const promptCost = model ? promptTokens * toFiniteTokenPrice(model.pricing.prompt) : 0;
        const completionCost = model ? completionTokens * toFiniteTokenPrice(model.pricing.completion) : 0;
        // Web search plugin costs $4 per 1,000 results; default 5 results = $0.02 per request
        const webSearchCost = settings.webSearch ? 0.02 : 0;
        const cost = promptCost + completionCost + webSearchCost;
        return { output: transformedOutput, metadata: transformedMetadata, validationError, durationMs: Math.round(performance.now() - startTime), promptTokens, completionTokens, cost };
      } catch (e: any) {
        if (e.name === 'AbortError') {
          return {
            error: resolveGenerateAbortError({
              parentAborted: signal.aborted,
              timedOut,
              timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            }),
            durationMs: Math.round(performance.now() - startTime),
          };
        }
        return { error: e.message || 'Unknown error', durationMs: Math.round(performance.now() - startTime) };
      }
    }
    return { error: 'Rate limited â€” max retries exhausted', durationMs: Math.round(performance.now() - startTime) };
  };

  // Populate rows from upstream pipeline step (e.g., Page Names â†’ H2 Content)
  const handleSyncFromSource = useCallback(async () => {
    if (!populateFromSource) return;
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    const existingGenerated = rowsRef.current.filter(r => r.status === 'generated').length;
    if (existingGenerated > 0) {
      const ok = window.confirm(`This will replace ${existingGenerated} generated row(s) with synced data from the upstream step. Continue?`);
      if (!ok) return;
    }
    setIsSyncingSource(true);
    try {
      const sourceRows = await populateFromSource.load();
      if (sourceRows.length === 0) {
        addToast(populateFromSource.emptyMessage || 'No data found in upstream step.', 'warning', {
          notification: {
            mode: 'none',
            source: 'generate',
          },
        });
        return;
      }
      await applyPipelineRows(sourceRows);
      addToast(`Synced ${sourceRows.length} ${populateFromSource.successLabel || 'rows'} from upstream step.`, 'success', {
        notification: {
          mode: 'shared',
          source: 'generate',
        },
      });
    } catch (err) {
      addToast(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error', {
        notification: {
          mode: 'shared',
          source: 'generate',
        },
      });
    } finally {
      setIsSyncingSource(false);
    }
  }, [populateFromSource, instanceBusy, warnMutatingControlsDisabled, addToast, applyPipelineRows]);

  // Auto-sync from upstream source on mount when rows are all empty (no saved data loaded).
  // When upstreamDocId is set, the Firestore listener handles sync â€” skip mount auto-sync entirely.
  const autoSyncDoneRef = useRef(false);
  useEffect(() => {
    if (!runtimeEffectsActive) return;
    if (!populateFromSource || populateFromSource.upstreamDocId || autoSyncDoneRef.current || !isLoaded) return;
    const allEmpty = rowsRef.current.every(r => !r.input.trim() && !r.output.trim());
    if (!allEmpty) {
      autoSyncDoneRef.current = true;
      return;
    }
    void (async () => {
      setIsSyncingSource(true);
      try {
        const sourceRows = await populateFromSource.load();
        if (sourceRows.length === 0) {
          autoSyncDoneRef.current = true;
          return;
        }
        await applyPipelineRows(sourceRows);
        autoSyncDoneRef.current = true;
        addToast(`Auto-synced ${sourceRows.length} ${populateFromSource.successLabel || 'rows'} from upstream step.`, 'success', {
          notification: {
            mode: 'shared',
            source: 'generate',
          },
        });
      } catch (err) {
        console.warn('Auto-sync from upstream failed', err);
        addToast('Auto-sync from upstream failed. Refresh the page and try the upstream steps again.', 'warning', {
          notification: {
            mode: 'shared',
            source: 'generate',
          },
        });
      } finally {
        setIsSyncingSource(false);
      }
    })();
  }, [populateFromSource, isLoaded, addToast, applyPipelineRows, runtimeEffectsActive]);
  // Live-sync H2 pipeline when upstream rows doc and/or pipeline settings doc change (debounced).
  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    const upstreamDocId = populateFromSource?.upstreamDocId;
    const additionalUpstreamDocIds = populateFromSource?.additionalUpstreamDocIds ?? [];
    const pipelineSettingsDocId = populateFromSource?.pipelineSettingsDocId;
    if (!populateFromSource || (!upstreamDocId && additionalUpstreamDocIds.length === 0 && !pipelineSettingsDocId)) return;
    const watchedUpstreamRowDocIds = new Set(
      [upstreamDocId, ...additionalUpstreamDocIds].filter((docId): docId is string => Boolean(docId)),
    );

    const scheduleFlush = () => {
      upstreamSourceVersionRef.current += 1;
      if (upstreamSyncDebounceRef.current) clearTimeout(upstreamSyncDebounceRef.current);
      upstreamSyncDebounceRef.current = setTimeout(() => {
        upstreamSyncDebounceRef.current = null;
        void flushUpstreamPipelineSync();
      }, 400);
    };

    const handleLocalRowsUpdated = (event: Event) => {
      const docId = (event as CustomEvent<{ docId?: string }>).detail?.docId;
      if (!docId || !watchedUpstreamRowDocIds.has(docId)) return;
      scheduleFlush();
    };

    const unsubs: (() => void)[] = [];
    if (upstreamDocId) {
      unsubs.push(
        subscribeAppSettingsDoc({
          docId: upstreamDocId,
          channel: makeAppSettingsChannel('upstream', upstreamDocId),
          onData: scheduleFlush,
          onError: (err) => {
            reportPersistFailure(addToast, 'upstream pipeline sync', err);
          },
        }),
      );
    }
    for (const extraDocId of additionalUpstreamDocIds) {
      if (!extraDocId || extraDocId === upstreamDocId || extraDocId === pipelineSettingsDocId) continue;
      unsubs.push(
        subscribeAppSettingsDoc({
          docId: extraDocId,
          channel: makeAppSettingsChannel('upstream', extraDocId),
          onData: scheduleFlush,
          onError: (err) => {
            reportPersistFailure(addToast, 'upstream pipeline sync', err);
          },
        }),
      );
    }
    if (pipelineSettingsDocId && pipelineSettingsDocId !== upstreamDocId) {
      unsubs.push(
        subscribeAppSettingsDoc({
          docId: pipelineSettingsDocId,
          channel: makeAppSettingsChannel('pipeline-settings', pipelineSettingsDocId),
          onData: scheduleFlush,
          onError: (err) => {
            reportPersistFailure(addToast, 'pipeline settings sync', err);
          },
        }),
      );
    }
    window.addEventListener(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, handleLocalRowsUpdated as EventListener);

    return () => {
      for (const u of unsubs) u();
      if (upstreamSyncDebounceRef.current) clearTimeout(upstreamSyncDebounceRef.current);
      window.removeEventListener(APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT, handleLocalRowsUpdated as EventListener);
    };
  }, [populateFromSource, addToast, flushUpstreamPipelineSync, runtimeEffectsActive]);

  // Retry pipeline sync once H2 instance has finished initial load (catches missed early snapshots).
  useEffect(() => {
    if (!runtimeEffectsActive) return undefined;
    if (!isLoaded) return;
    if (!rowsFirestoreLoadedRef.current) return;
    if (!populateFromSource?.upstreamDocId && !(populateFromSource?.additionalUpstreamDocIds?.length) && !populateFromSource?.pipelineSettingsDocId) return;
    const t = setTimeout(() => {
      void flushUpstreamPipelineSync();
    }, 300);
    return () => clearTimeout(t);
  }, [flushUpstreamPipelineSync, isLoaded, populateFromSource?.additionalUpstreamDocIds, populateFromSource?.pipelineSettingsDocId, populateFromSource?.upstreamDocId, rows, runtimeEffectsActive]);


  // Generate all pending rows with rate limiting + batched UI updates
  const handleGenerate = useCallback(async () => {
    const primaryModelId = getSelectedModelForScope(settings, PRIMARY_MODEL_SCOPE);
    const apiKey = resolveRequestApiKey(settingsRef.current.apiKey, suffix);
    const primaryModel = models.find((m) => m.id === primaryModelId);
    if (!apiKey || !primaryModelId) {
      setShowSettings(true);
      return;
    }
    // Guard against double-invocation â€” if already generating, don't start again
    if (isGeneratingRef.current) {
      console.warn('handleGenerate called while already generating â€” skipping');
      return;
    }

    const pendingRows = rowsRef.current.filter(r => r.input.trim() && (!lockMetadataKey || !r.metadata?.[lockMetadataKey]) && (r.status === 'pending' || r.status === 'error'));
    if (pendingRows.length === 0) return;

    setIsGenerating(true);
    setIsStopping(false);
    setPrimaryRunPhase('running');
    abortRef.current = false;
    setRateLimitCount(0);
    completionTimestamps.current = [];
    // Seed live cost with existing cost from previous runs so it accumulates correctly
    liveCostRef.current = rowsRef.current.reduce((sum, r) => sum + (r.cost || 0), 0);
    setLiveCost(liveCostRef.current);
    // Create new AbortController for this generation batch â€” cancels all in-flight fetch() calls on Stop
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeCountRef.current = 0;

    addLog('generate_start', `${pendingRows.length} rows queued`, {
      model: primaryModelId,
      concurrency: settings.rateLimit,
      outputCount: pendingRows.length,
    });

    // Start timer (GenerationTimer component handles its own interval)
    const startTs = Date.now();
    setGenStartTime(startTs);

    // Mark all pending as generating upfront (single render)
    const pendingIds = new Set(pendingRows.map(r => r.id));
    updateRowsState(prev => {
      const next = prev.map(r => pendingIds.has(r.id) ? { ...r, status: 'generating' } : r);
      rowsRef.current = next;
      return next;
    });

    const queue = [...pendingRows.map(r => ({ id: r.id, input: r.input, retries: 0, metadata: r.metadata }))];
    let queueIdx = 0;
    const minLen = settings.minLen || 0;
    const maxLen = settings.maxLen || 0;
    const maxRetries = settings.maxRetries ?? 3;
    const hasLenConstraint = minLen > 0 || maxLen > 0;

    // Batch update buffer â€” flush every 200ms to reduce renders
    const pendingUpdates = new Map<string, Partial<GenerateRow>>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushUpdates = () => {
      if (pendingUpdates.size === 0) return;
      if (shouldDiscardGenerationResult({ stopRequested: abortRef.current, signalAborted: controller.signal.aborted })) {
        pendingUpdates.clear();
        return;
      }
      const updates = new Map(pendingUpdates);
      pendingUpdates.clear();
      updateRowsState(prev => {
        let changed = false;
        const next = prev.map(r => {
          const update = updates.get(r.id);
          if (update) { changed = true; return { ...r, ...update }; }
          return r;
        });
        if (!changed && updates.size > 0) {
          // CRITICAL: updates had entries but none matched any row IDs â€” data is being lost!
          console.error('flushUpdates: ID MISMATCH â€” updates had', updates.size, 'entries but matched 0 rows. Update IDs:', [...updates.keys()].slice(0, 3), 'Row IDs:', prev.slice(0, 3).map(r => r.id));
        }
        if (changed) rowsRef.current = next;
        return changed ? next : prev;
      });
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushUpdates();
      }, 200);
    };

    const isOutputInRange = (output: string): boolean => {
      const len = output.length;
      if (minLen > 0 && len < minLen) return false;
      if (maxLen > 0 && len > maxLen) return false;
      return true;
    };

    let workerCount = 0; // tracks how many workers are alive (not just active on a request)

    const processNext = async (): Promise<void> => {
      try {
      while (queueIdx < queue.length && !abortRef.current) {
        // Dynamic scale-down: if more workers alive than current rateLimit, this worker exits gracefully
        if (workerCount > rateLimitRef.current) {
          return; // workerCount decremented in finally
        }
        const item = queue[queueIdx++];
        if (!item.input.trim()) continue;
        activeCountRef.current++;

        try {
          let attempts = item.retries;
          let lastResult: { output: string; durationMs: number } | { error: string; durationMs: number } | null = null;

          // Try up to maxRetries+1 times (first attempt + retries)
          while (attempts <= maxRetries && !abortRef.current) {
            lastResult = await generateForRow(item, controller.signal);

            // If aborted, discard result entirely â€” no cost, no UI update
            if ('error' in lastResult && lastResult.error === '__aborted__') {
              lastResult = null;
              break;
            }
            if (shouldDiscardGenerationResult({ stopRequested: abortRef.current, signalAborted: controller.signal.aborted })) {
              lastResult = null;
              break;
            }

            if ('error' in lastResult) break; // API error, don't retry

            // Check len constraint
            if (hasLenConstraint && !isOutputInRange(lastResult.output)) {
              attempts++;
              if (attempts > maxRetries) {
                // Exceeded max retries â€” keep the last output so it's still copyable
                const lastOutput = lastResult.output;
                const lastDuration = lastResult.durationMs;
                const lastPromptTokens = 'promptTokens' in lastResult ? (lastResult as any).promptTokens : 0;
                const lastCompletionTokens = 'completionTokens' in lastResult ? (lastResult as any).completionTokens : 0;
                const lastCostVal = 'cost' in lastResult ? (lastResult as any).cost : 0;
                pendingUpdates.set(item.id, { status: 'error', output: lastOutput, error: `Exceeded ${maxRetries} retries â€” output length ${lastOutput.length} outside range [${minLen || '0'}â€“${maxLen || 'âˆž'}]`, generatedAt: new Date().toISOString(), durationMs: lastDuration, retries: attempts, promptTokens: lastPromptTokens, completionTokens: lastCompletionTokens, cost: lastCostVal });
                lastResult = null; // already handled
                break;
              }
              // Retry â€” update retries count in UI
              pendingUpdates.set(item.id, { retries: attempts, status: 'generating' });
              scheduleFlush();
              continue;
            }
            break; // Output is in range
          }

          const now = new Date().toISOString();
          if (lastResult && 'output' in lastResult) {
            const r = lastResult as { output: string; metadata?: Record<string, string>; validationError?: string; durationMs: number; promptTokens: number; completionTokens: number; cost: number };
            completionTimestamps.current.push(Date.now());
            liveCostRef.current += r.cost;
            pendingUpdates.set(item.id, {
              status: r.validationError ? 'error' : 'generated',
              output: r.output,
              ...(r.metadata ? { metadata: { ...(item.metadata ?? {}), ...r.metadata } } : {}),
              ...(r.validationError ? { error: r.validationError } : { error: undefined }),
              generatedAt: now,
              durationMs: r.durationMs,
              retries: attempts,
              promptTokens: r.promptTokens,
              completionTokens: r.completionTokens,
              cost: r.cost,
            });
          } else if (lastResult && 'error' in lastResult) {
            pendingUpdates.set(item.id, { status: 'error', error: (lastResult as { error: string; durationMs: number }).error, generatedAt: now, durationMs: lastResult.durationMs, retries: attempts });
          }
          scheduleFlush();
        } catch (e: any) {
          // Catch ANY unexpected error so this worker doesn't silently die and abandon remaining queue items
          console.error('processNext unexpected error for row', item.id, e);
          pendingUpdates.set(item.id, { status: 'error', error: `Unexpected: ${e.message || 'Unknown error'}`, generatedAt: new Date().toISOString(), durationMs: 0, retries: 0 });
          scheduleFlush();
        } finally {
          activeCountRef.current--;
        }
      }
      } finally {
        // ALWAYS decrement workerCount when worker exits â€” whether from queue exhaustion, scale-down, or abort
        workerCount--;
      }
    };

    // Track all active worker promises â€” including dynamically spawned ones
    const activeWorkerPromises = new Set<Promise<void>>();

    const trackWorker = (p: Promise<void>) => {
      activeWorkerPromises.add(p);
      p.finally(() => activeWorkerPromises.delete(p));
    };

    // Spawn function â€” single path for creating workers (both initial and dynamic scale-up)
    // Increments workerCount on creation; processNext's finally block decrements on exit
    const spawnWorkers = (count: number) => {
      for (let i = 0; i < count; i++) {
        workerCount++;
        trackWorker(processNext());
      }
    };

    // Expose spawn function so the rateLimit watcher effect can add workers mid-generation
    spawnWorkersRef.current = spawnWorkers;

    // Create initial workers â€” capped at queue size (no point having more workers than items)
    const initialWorkerCount = Math.min(settings.rateLimit, pendingRows.length);
    spawnWorkers(initialWorkerCount);
    // Wait for all workers â€” including any dynamically spawned mid-generation
    try {
      while (activeWorkerPromises.size > 0) {
        await Promise.all([...activeWorkerPromises]);
      }

      // Final flush for any remaining updates
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushUpdates();
      setPrimaryRunPhase('persisting');
      const persistResult = await awaitPersistWithTimeout(flushRowsSaveNow);
      if (persistResult.error) {
        reportPersistFailure(addToast, 'generate rows finalize', persistResult.error);
        addLog('generate_finalize_error', 'Final row persistence failed after generation completed.');
      } else if (persistResult.timedOut) {
        addToast('Generation finished, but final row persistence is still taking too long. The UI was released while cloud sync continues.', 'warning');
        addLog('generate_finalize_timeout', 'Generation finished, but final row persistence exceeded the timeout window.');
      }

      const elapsed = Date.now() - startTs;
      if (!shouldDiscardGenerationResult({ stopRequested: abortRef.current, signalAborted: controller.signal.aborted })) {
        // Log completion â€” read latest rows to compute accurate stats (avoid stale closure)
        const doneCount = completionTimestamps.current.length;
        const avgRate = elapsed > 0 ? Math.round((doneCount / (elapsed / 1000)) * 10) / 10 : 0;
        updateRowsState(prev => {
          const finalCost = prev.reduce((sum, r) => sum + (r.cost || 0), 0);
          const finalErrors = prev.filter(r => r.status === 'error').length;
          const finalPromptTokens = prev.reduce((sum, r) => sum + (r.promptTokens || 0), 0);
          const finalCompletionTokens = prev.reduce((sum, r) => sum + (r.completionTokens || 0), 0);
          addLog('generate_complete', `${doneCount} generated`, {
            model: primaryModelId,
            outputCount: doneCount,
            errorCount: finalErrors,
            elapsedMs: elapsed,
            cost: finalCost,
            concurrency: settings.rateLimit,
            avgPerSec: avgRate,
            promptTokens: finalPromptTokens,
            completionTokens: finalCompletionTokens,
          });
          return prev;
        });
      }
      // Refresh balance after generation
      fetchBalance();
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingUpdates.clear();
      spawnWorkersRef.current = null;
      abortControllerRef.current = null;
      setIsStopping(false);
      setIsGenerating(false);
      setPrimaryRunPhase('idle');
    }
  }, [settings, addLog, addToast, effectivePrimaryPrompt, models, flushRowsSaveNow, suffix]);

  // Stop generation
  const handleStop = useCallback(() => {
    abortRef.current = true;
    setIsStopping(true);
    setPrimaryRunPhase('stopping');
    // Cancel ALL in-flight HTTP requests immediately â€” prevents hidden API costs
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    updateRowsState(prev => {
      const next = prev.map(r => r.status === 'generating' ? { ...r, status: 'pending' } : r);
      rowsRef.current = next;
      return next;
    });
    addLog('generate_stop', `Stopped by user`, { outputCount: completionTimestamps.current.length });
  }, [addLog]);

  // ===== Per-slot generation =====
  const handleGenerateSlot = useCallback(async (slotId: string) => {
    const slotConfig = promptSlots.find(s => s.id === slotId);
    if (!slotConfig) return;
    const slotModelId = getSelectedModelForScope(settings, slotId);
    const slotModel = models.find((m) => m.id === slotModelId);
    const apiKey = resolveRequestApiKey(settingsRef.current.apiKey, suffix);
    if (!apiKey || !slotModelId) {
      setShowSettings(true);
      return;
    }
    if (slotGeneratingRef.current[slotId]) return;

    // Build slot input for all rows and filter to those with input + pending/error status

    const pendingRows: { id: string; input: string; retries: number }[] = [];
    for (const r of rowsRef.current) {
      const sd = getSlot(r, slotId);
      if (sd.input.trim() && (sd.status === 'pending' || sd.status === 'error')) {
        pendingRows.push({ id: r.id, input: sd.input, retries: 0 });
      }
    }
    if (pendingRows.length === 0) return;

    setSlotGenerating(prev => ({ ...prev, [slotId]: true }));
    setSlotStopping(prev => ({ ...prev, [slotId]: false }));
    setSlotRunPhase(prev => ({ ...prev, [slotId]: 'running' }));
    slotAbortRef.current[slotId] = false;
    setSlotRateLimitCount(prev => ({ ...prev, [slotId]: 0 }));
    slotCompletionTimestamps.current[slotId] = [];
    slotLiveCostRef.current[slotId] = rowsRef.current.reduce((sum, r) => sum + (getSlot(r, slotId).cost || 0), 0);
    setSlotLiveCost(prev => ({ ...prev, [slotId]: slotLiveCostRef.current[slotId] }));

    const controller = new AbortController();
    slotAbortControllerRef.current[slotId] = controller;
    slotActiveCountRef.current[slotId] = 0;

    const startTs = Date.now();
    setSlotGenStartTime(prev => ({ ...prev, [slotId]: startTs }));

    addLog('generate_start', `${slotConfig.label}: ${pendingRows.length} rows queued`, {
      model: slotModelId,
      concurrency: settings.rateLimit,
      outputCount: pendingRows.length,
    });

    // Mark all pending as generating
    const pendingIds = new Set(pendingRows.map(r => r.id));
    updateRowsState(prev => {
      const next = prev.map(r => {
        if (!pendingIds.has(r.id)) return r;
        const slots = { ...r.slots };
        slots[slotId] = { ...(slots[slotId] ?? EMPTY_SLOT), status: 'generating' as const };
        return { ...r, slots };
      });
      rowsRef.current = next;
      return next;
    });

    const queue = [...pendingRows];
    let queueIdx = 0;
    const minLen = settings.minLen || 0;
    const maxLen = settings.maxLen || 0;
    const maxRetries = settings.maxRetries ?? 3;
    const hasLenConstraint = minLen > 0 || maxLen > 0;

    // Use slot prompt as system message (not primary prompt)
    const slotSystemPrompt = ''; // Template is already in the input; no separate system prompt needed for slots with buildInput

    // Batch update buffer
    const pendingUpdates = new Map<string, Partial<GenerateSlotData>>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushUpdates = () => {
      if (pendingUpdates.size === 0) return;
      if (shouldDiscardGenerationResult({ stopRequested: Boolean(slotAbortRef.current[slotId]), signalAborted: controller.signal.aborted })) {
        pendingUpdates.clear();
        return;
      }
      const updates = new Map(pendingUpdates);
      pendingUpdates.clear();
      updateRowsState(prev => {
        let changed = false;
        const next = prev.map(r => {
          const update = updates.get(r.id);
          if (!update) return r;
          changed = true;
          const slots = { ...r.slots };
          slots[slotId] = { ...(slots[slotId] ?? EMPTY_SLOT), ...update };
          return { ...r, slots };
        });
        if (changed) rowsRef.current = next;
        return changed ? next : prev;
      });
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flushUpdates(); }, 200);
    };

    const isOutputInRange = (output: string): boolean => {
      const len = output.length;
      if (minLen > 0 && len < minLen) return false;
      if (maxLen > 0 && len > maxLen) return false;
      return true;
    };

    // Reuse the same generateForRow API call pattern but with slot-specific prompt
    const generateSlotRow = async (row: GenerateRow, input: string, signal: AbortSignal): Promise<{ output: string; metadata?: Record<string, string>; durationMs: number; promptTokens: number; completionTokens: number; cost: number } | { error: string; durationMs: number }> => {
      const st = performance.now();
      const maxRateLimitRetries = 5;
      for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
        if (signal.aborted) return { error: '__aborted__', durationMs: Math.round(performance.now() - st) };
        let timedOut = false;
        try {
          const timedResponse = await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async (requestSignal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
              },
              body: JSON.stringify({
                model: slotModelId,
                messages: [
                  ...(slotSystemPrompt.trim() ? [{ role: 'system' as const, content: slotSystemPrompt.trim() }] : []),
                  { role: 'user', content: input },
                ],
                temperature: settings.temperature ?? 1.0,
                ...(settings.maxTokens > 0 ? { max_tokens: settings.maxTokens } : {}),
                ...(settings.reasoning ? { reasoning: { effort: settings.reasoning } } : {}),
                ...(settings.webSearch ? { plugins: [{ id: 'web' }] } : {}),
                ...(slotConfig.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
              }),
              signal: requestSignal,
            }),
          });
          const res = timedResponse.result;
          timedOut = timedResponse.timedOut;
          if (res.status === 429) {
            setSlotRateLimitCount(prev => ({ ...prev, [slotId]: (prev[slotId] || 0) + 1 }));
            if (attempt < maxRateLimitRetries) {
              const completedDelay = await waitForDelayOrAbort(Math.min(1000 * Math.pow(2, attempt), 30000), signal);
              if (!completedDelay) return { error: '__aborted__', durationMs: Math.round(performance.now() - st) };
              continue;
            }
            return { error: `Rate limited (429) â€” ${maxRateLimitRetries} retries exhausted`, durationMs: Math.round(performance.now() - st) };
          }
          if (!res.ok) {
            const timedErrText = await runWithOpenRouterTimeout({
              signal,
              timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
              run: async () => res.text().catch(() => ''),
            }).catch(() => ({ result: '', timedOut }));
            const errText = timedErrText.result;
            timedOut = timedErrText.timedOut;
            return { error: `API ${res.status}: ${errText.slice(0, 200)}`, durationMs: Math.round(performance.now() - st) };
          }
          const timedJson = await runWithOpenRouterTimeout({
            signal,
            timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
            run: async () => res.json(),
          });
          const data = timedJson.result;
          timedOut = timedJson.timedOut;
          if (data.error) {
            return { error: `API error: ${typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error).slice(0, 200)}`, durationMs: Math.round(performance.now() - st) };
          }
          const rawOutput = data.choices?.[0]?.message?.content || '';
          if (!rawOutput.trim()) {
            return { error: `Empty response from API`, durationMs: Math.round(performance.now() - st) };
          }
          let output = rawOutput;
          let metadata: Record<string, string> | undefined;
          if (slotConfig.transformOutput) {
            try {
              const transformed = slotConfig.transformOutput({ rawOutput, row });
              output = transformed.output;
              metadata = transformed.metadata;
            } catch (err) {
              return {
                error: err instanceof Error ? err.message : 'Slot output parsing failed',
                durationMs: Math.round(performance.now() - st),
              };
            }
          }
          if (!output.trim()) {
            return { error: 'Slot output parsing produced an empty result.', durationMs: Math.round(performance.now() - st) };
          }
          const promptTokens = toFiniteNumber(data.usage?.prompt_tokens);
          const completionTokens = toFiniteNumber(data.usage?.completion_tokens);
          const model = slotModel;
          const promptCost = model ? promptTokens * toFiniteTokenPrice(model.pricing.prompt) : 0;
          const completionCost = model ? completionTokens * toFiniteTokenPrice(model.pricing.completion) : 0;
          const webSearchCost = settings.webSearch ? 0.02 : 0;
          return { output, metadata, durationMs: Math.round(performance.now() - st), promptTokens, completionTokens, cost: promptCost + completionCost + webSearchCost };
        } catch (e: any) {
          if (e.name === 'AbortError') {
            return {
              error: resolveGenerateAbortError({
                parentAborted: signal.aborted,
                timedOut,
                timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
              }),
              durationMs: Math.round(performance.now() - st),
            };
          }
          return { error: e.message || 'Unknown error', durationMs: Math.round(performance.now() - st) };
        }
      }
      return { error: 'Rate limited â€” max retries exhausted', durationMs: Math.round(performance.now() - st) };
    };

    let workerCount = 0;
    const activeWorkerPromises = new Set<Promise<void>>();
    const trackWorker = (p: Promise<void>) => { activeWorkerPromises.add(p); p.finally(() => activeWorkerPromises.delete(p)); };

    const processNext = async (): Promise<void> => {
      try {
        while (queueIdx < queue.length && !slotAbortRef.current[slotId]) {
          if (workerCount > rateLimitRef.current) return;
          const item = queue[queueIdx++];
          if (!item.input.trim()) continue;
          slotActiveCountRef.current[slotId] = (slotActiveCountRef.current[slotId] || 0) + 1;
          try {
            let attempts = item.retries;
            let lastResult: any = null;
            while (attempts <= maxRetries && !slotAbortRef.current[slotId]) {
              const currentRow = rowsRef.current.find((r) => r.id === item.id);
              if (!currentRow) {
                lastResult = { error: 'Row not found during slot generation.', durationMs: 0 };
                break;
              }
              lastResult = await generateSlotRow(currentRow, item.input, controller.signal);
              if ('error' in lastResult && lastResult.error === '__aborted__') { lastResult = null; break; }
              if (shouldDiscardGenerationResult({ stopRequested: Boolean(slotAbortRef.current[slotId]), signalAborted: controller.signal.aborted })) {
                lastResult = null;
                break;
              }
              if ('error' in lastResult) break;
              if (hasLenConstraint && !isOutputInRange(lastResult.output)) {
                attempts++;
                if (attempts > maxRetries) {
                  pendingUpdates.set(item.id, { status: 'error', output: lastResult.output, error: `Exceeded ${maxRetries} retries â€” length ${lastResult.output.length} outside range`, generatedAt: new Date().toISOString(), durationMs: lastResult.durationMs, retries: attempts, promptTokens: lastResult.promptTokens, completionTokens: lastResult.completionTokens, cost: lastResult.cost });
                  lastResult = null;
                  break;
                }
                pendingUpdates.set(item.id, { retries: attempts, status: 'generating' });
                scheduleFlush();
                continue;
              }
              break;
            }
            const now = new Date().toISOString();
            if (lastResult && 'output' in lastResult) {
              slotCompletionTimestamps.current[slotId]?.push(Date.now());
              slotLiveCostRef.current[slotId] = (slotLiveCostRef.current[slotId] || 0) + lastResult.cost;
              pendingUpdates.set(item.id, { status: 'generated', output: lastResult.output, generatedAt: now, durationMs: lastResult.durationMs, retries: attempts, promptTokens: lastResult.promptTokens, completionTokens: lastResult.completionTokens, cost: lastResult.cost });
              if (lastResult.metadata && !shouldDiscardGenerationResult({ stopRequested: Boolean(slotAbortRef.current[slotId]), signalAborted: controller.signal.aborted })) {
                updateRowsState(prev => {
                  const next = prev.map(r => (
                    r.id === item.id
                      ? { ...r, metadata: { ...(r.metadata ?? {}), ...lastResult.metadata } }
                      : r
                  ));
                  rowsRef.current = next;
                  return next;
                });
              }
            } else if (lastResult && 'error' in lastResult) {
              pendingUpdates.set(item.id, { status: 'error', error: lastResult.error, generatedAt: now, durationMs: lastResult.durationMs, retries: attempts });
              if (slotConfig.clearMetadataKeysOnReset?.length && !shouldDiscardGenerationResult({ stopRequested: Boolean(slotAbortRef.current[slotId]), signalAborted: controller.signal.aborted })) {
                updateRowsState(prev => {
                  const next = prev.map(r => {
                    if (r.id !== item.id) return r;
                    const metadata = { ...(r.metadata ?? {}) };
                    for (const key of slotConfig.clearMetadataKeysOnReset ?? []) delete metadata[key];
                    return { ...r, metadata };
                  });
                  rowsRef.current = next;
                  return next;
                });
              }
            }
            scheduleFlush();
          } catch (e: any) {
            pendingUpdates.set(item.id, { status: 'error', error: `Unexpected: ${e.message}`, generatedAt: new Date().toISOString() });
            if (slotConfig.clearMetadataKeysOnReset?.length && !shouldDiscardGenerationResult({ stopRequested: Boolean(slotAbortRef.current[slotId]), signalAborted: controller.signal.aborted })) {
              updateRowsState(prev => {
                const next = prev.map(r => {
                  if (r.id !== item.id) return r;
                  const metadata = { ...(r.metadata ?? {}) };
                  for (const key of slotConfig.clearMetadataKeysOnReset ?? []) delete metadata[key];
                  return { ...r, metadata };
                });
                rowsRef.current = next;
                return next;
              });
            }
            scheduleFlush();
          } finally {
            slotActiveCountRef.current[slotId] = Math.max(0, (slotActiveCountRef.current[slotId] || 0) - 1);
          }
        }
      } finally {
        workerCount--;
      }
    };

    const spawnWorkers = (count: number) => {
      for (let i = 0; i < count; i++) { workerCount++; trackWorker(processNext()); }
    };
    slotSpawnWorkersRef.current[slotId] = spawnWorkers;
    spawnWorkers(Math.min(settings.rateLimit, pendingRows.length));

    try {
      while (activeWorkerPromises.size > 0) {
        await Promise.all([...activeWorkerPromises]);
      }

      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushUpdates();
      setSlotRunPhase(prev => ({ ...prev, [slotId]: 'persisting' }));
      const persistResult = await awaitPersistWithTimeout(flushRowsSaveNow);
      if (persistResult.error) {
        reportPersistFailure(addToast, `${slotConfig.label} finalize`, persistResult.error);
        addLog('generate_finalize_error', `${slotConfig.label}: final row persistence failed after generation completed.`);
      } else if (persistResult.timedOut) {
        addToast(`${slotConfig.label} finished, but final row persistence is still taking too long. The UI was released while cloud sync continues.`, 'warning');
        addLog('generate_finalize_timeout', `${slotConfig.label}: final row persistence exceeded the timeout window.`);
      }

      if (!shouldDiscardGenerationResult({ stopRequested: Boolean(slotAbortRef.current[slotId]), signalAborted: controller.signal.aborted })) {
        const elapsed = Date.now() - startTs;
        const doneCount = slotCompletionTimestamps.current[slotId]?.length ?? 0;
        addLog('generate_complete', `${slotConfig.label}: ${doneCount} generated`, {
          model: slotModelId,
          outputCount: doneCount,
          elapsedMs: elapsed,
          concurrency: settings.rateLimit,
        });
      }
      fetchBalance();
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingUpdates.clear();
      slotSpawnWorkersRef.current[slotId] = null;
      slotAbortControllerRef.current[slotId] = null;
      setSlotStopping(prev => ({ ...prev, [slotId]: false }));
      setSlotGenerating(prev => ({ ...prev, [slotId]: false }));
      setSlotRunPhase(prev => ({ ...prev, [slotId]: 'idle' }));
    }
  }, [settings, addLog, addToast, promptSlots, models, flushRowsSaveNow, suffix]);

  const handleStopSlot = useCallback((slotId: string) => {
    const slotConfig = promptSlots.find((slot) => slot.id === slotId);
    slotAbortRef.current[slotId] = true;
    setSlotStopping(prev => ({ ...prev, [slotId]: true }));
    setSlotRunPhase(prev => ({ ...prev, [slotId]: 'stopping' }));
    if (slotAbortControllerRef.current[slotId]) {
      slotAbortControllerRef.current[slotId]!.abort();
      slotAbortControllerRef.current[slotId] = null;
    }
    // Reset generating rows back to pending for this slot
    updateRowsState(prev => {
      const next = prev.map(r => {
        const sd = getSlot(r, slotId);
        if (sd.status !== 'generating') return r;
        const slots = { ...r.slots };
        slots[slotId] = { ...sd, status: 'pending' };
        const metadata = { ...(r.metadata ?? {}) };
        for (const key of slotConfig?.clearMetadataKeysOnReset ?? []) delete metadata[key];
        return { ...r, slots, metadata };
      });
      rowsRef.current = next;
      return next;
    });
    addLog('generate_stop', `${promptSlots.find(s => s.id === slotId)?.label ?? slotId}: Stopped by user`);
  }, [addLog, promptSlots]);

  // Stats â€” single O(n) pass instead of 9 separate filter/reduce calls
  const primaryStats = useMemo(() => buildPrimaryGenerationStats(rows), [rows]);
  const slotStats = useMemo(() => {
    const stats: Record<string, GenerationStats> = {};
    for (const slot of promptSlots) stats[slot.id] = buildSlotGenerationStats(rows, slot.id);
    return stats;
  }, [rows, promptSlots]);
  const activeStatsSource = useMemo(() => selectActiveGenerationSource({
    isPrimaryGenerating: isGenerating,
    slotGeneratingState: slotGenerating,
    promptSlotIds: promptSlots.map(slot => slot.id),
    tableView,
  }), [isGenerating, slotGenerating, promptSlots, tableView]);
  const activeStats = activeStatsSource === 'primary'
    ? primaryStats
    : (slotStats[activeStatsSource] ?? emptyGenerationStats());
  const {
    totalRows,
    generatedCount,
    errorCount,
    pendingCount,
    generatingCount,
    totalCost,
    totalPromptTokens,
    totalCompletionTokens,
  } = activeStats;
  const activeRateLimitCount = activeStatsSource === 'primary'
    ? rateLimitCount
    : (slotRateLimitCount[activeStatsSource] ?? 0);
  const activeIsGenerating = activeStatsSource === 'primary'
    ? primaryRunPhase !== 'idle'
    : (slotRunPhase[activeStatsSource] ?? 'idle') !== 'idle';
  const activeLiveCost = activeStatsSource === 'primary'
    ? liveCost
    : (slotLiveCost[activeStatsSource] ?? totalCost);
  const activeStartTime = activeStatsSource === 'primary'
    ? genStartTime
    : (slotGenStartTime[activeStatsSource] ?? null);
  const activeCompletionTimestampsRef = useMemo<React.MutableRefObject<number[]>>(() => {
    if (activeStatsSource === 'primary') return completionTimestamps;
    return { current: slotCompletionTimestamps.current[activeStatsSource] ?? [] };
  }, [activeStatsSource]);
  const primaryControlMode = resolveGenerateControlModeFromPhase(primaryRunPhase);

  // Compute dependency warnings for slots (memoized)
  const slotDepWarnings = useMemo(() => {
    const warnings: { slotId: string; label: string; message: string }[] = [];
    for (const slot of promptSlots) {
      if (!slot.buildInput) continue;
      const template = effectiveSlotPrompts[slot.id] ?? slot.defaultPrompt;
      // Check first row with input to determine error type
      const rowsWithInput = rows.filter(r => r.input.trim());
      if (rowsWithInput.length === 0) continue;
      const missingPageNames = rowsWithInput.filter(r => !r.output.trim()).length;
      // Check for H2 dependency by testing buildInput
      const sampleRow = rowsWithInput[0];
      const sampleResult = slot.buildInput(template, sampleRow?.output || '', sampleRow ? buildExternalDataShared(sampleRow) : undefined, sampleRow?.input || '', sampleRow);
      if (sampleResult.error === 'h2-names-missing') {
        warnings.push({ slotId: slot.id, label: slot.label, message: `H2 names have not been generated yet. Complete the H2 Names step first to enable ${slot.label} generation.` });
      }
      if (missingPageNames > 0 && missingPageNames === rowsWithInput.length) {
        warnings.push({ slotId: slot.id, label: slot.label, message: `All ${missingPageNames} rows are missing page name outputs. Generate page names first.` });
      } else if (missingPageNames > 0) {
        warnings.push({ slotId: slot.id, label: slot.label, message: `${missingPageNames} row${missingPageNames > 1 ? 's are' : ' is'} missing page name outputs. Generate page names for those rows first.` });
      }
    }
    return warnings;
  }, [effectiveSlotPrompts, promptSlots, rows]);

  // Format elapsed time
  const formatElapsed = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${remainSecs}s`;
  };

  // formatDateTime defined at module scope â€” shared with GenerateRowComponent

  // Format cost string
  const formatCost = (priceStr: string): string => {
    const price = parseFloat(priceStr);
    if (isNaN(price) || price === 0) return 'Free';
    return `$${(price * 1000000).toFixed(2)}/M`;
  };

  // ===== Stable callbacks for memoized row component =====
  const handleInputChange = useCallback((rowId: string, value: string) => {
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    updateRowsState(prev => prev.map((r) => (
      r.id === rowId
        ? applyPrimaryInputEdit(r, value, clearMetadataKeysOnReset, promptSlots)
        : r
    )));
  }, [clearMetadataKeysOnReset, instanceBusy, promptSlots, warnMutatingControlsDisabled]);
  const handleRetryRow = useCallback((rowId: string) => {
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    updateRowsState(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const nextMetadata = { ...(r.metadata ?? {}) };
      for (const key of clearMetadataKeysOnReset) delete nextMetadata[key];
      return {
        ...r,
        status: 'pending' as const,
        output: '',
        error: undefined,
        metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
      };
    }));
  }, [clearMetadataKeysOnReset, instanceBusy, warnMutatingControlsDisabled]);
  const handleToggleExpand = useCallback((rowId: string) => {
    setExpandedRows(prev => { const next = new Set(prev); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; });
  }, []);

  // --- Slot-specific handlers ---
  const [slotCopiedKey, setSlotCopiedKey] = useState<string | null>(null);
  const [expandedSlotKeys, setExpandedSlotKeys] = useState<Set<string>>(new Set());
  const [slotBulkCopied, setSlotBulkCopied] = useState<Record<string, boolean>>({});

  const handleSlotCopyOutput = useCallback((slotId: string, rowId: string, text: string) => {
    void navigator.clipboard.writeText(text);
    const key = `${slotId}:${rowId}`;
    setSlotCopiedKey(key);
    setTimeout(() => setSlotCopiedKey(prev => prev === key ? null : prev), 1500);
  }, []);

  const handleSlotRetry = useCallback((slotId: string, rowId: string) => {
    if (instanceBusy) {
      warnMutatingControlsDisabled();
      return;
    }
    const slotConfig = promptSlots.find((slot) => slot.id === slotId);
    updateRowsState(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const slots = { ...r.slots };
      slots[slotId] = { ...(slots[slotId] ?? EMPTY_SLOT), status: 'pending' as const, output: '', error: undefined };
      const metadata = { ...(r.metadata ?? {}) };
      for (const key of slotConfig?.clearMetadataKeysOnReset ?? []) delete metadata[key];
      return { ...r, slots, metadata };
    }));
  }, [instanceBusy, promptSlots, warnMutatingControlsDisabled]);

  const handleSlotToggleExpand = useCallback((key: string) => {
    setExpandedSlotKeys(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }, []);

  const handleSlotBulkCopy = useCallback((slotId: string) => {
    const outputs = rowsRef.current
      .map(r => getSlot(r, slotId).output.trim())
      .filter(Boolean);
    if (outputs.length === 0) return;
    void navigator.clipboard.writeText(outputs.join('\n'));
    setSlotBulkCopied(prev => ({ ...prev, [slotId]: true }));
    setTimeout(() => setSlotBulkCopied(prev => ({ ...prev, [slotId]: false })), 2000);
  }, []);

  // Slot generated counts (memoized)
  const slotGeneratedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const slot of promptSlots) {
      counts[slot.id] = rows.filter(r => getSlot(r, slot.id).status === 'generated').length;
    }
    return counts;
  }, [rows, promptSlots]);

  const displayRows = useMemo(() => {
    const rowsWithIndex = rows.map((row, origIdx) => ({ row, origIdx }));
    if (statusFilter === 'all') return rowsWithIndex;
    if (activeStatsSource === 'primary') {
      return rowsWithIndex.filter(({ row }) => row.status === statusFilter);
    }
    return rowsWithIndex.filter(({ row }) => getSlot(row, activeStatsSource).status === statusFilter);
  }, [rows, statusFilter, activeStatsSource]);
  useEffect(() => {
    if (statusFilter !== 'all' && displayRows.length === 0) setStatusFilter('all');
  }, [statusFilter, displayRows.length]);

  // Total column count for colSpan
  // Column count depends on which view tab is active
  const showingPrimary = !promptSlots.length || tableView === 'primary';
  const showingSlot = promptSlots.length > 0 && tableView !== 'primary';
  const activeClearableCount = useMemo(
    () => countClearableRowsForView(rows, tableView, promptSlots),
    [promptSlots, rows, tableView],
  );
  const activeClearScopeLabel = useMemo(() => {
    if (tableView === 'primary') {
      return primaryPromptLabel || 'Primary';
    }
    return promptSlots.find((slot) => slot.id === tableView)?.label ?? tableView;
  }, [primaryPromptLabel, promptSlots, tableView]);
  const clearButtonTitle = instanceBusy
    ? mutatingControlsDisabledReason
    : activeClearableCount > 0
      ? `Clear all ${activeClearScopeLabel} data (Undo available)`
      : `No ${activeClearScopeLabel} data to clear`;
  const extraColCount = extraColumns.length;
  const activeBulkCopyCount = showingPrimary
    ? generatedCount
    : (tableView && tableView !== 'primary' ? (slotGeneratedCounts[tableView] ?? 0) : 0);
  const handleActiveBulkCopy = useCallback(() => {
    if (showingPrimary) {
      handleBulkCopy();
      return;
    }
    if (tableView && tableView !== 'primary') {
      handleSlotBulkCopy(tableView);
    }
  }, [handleBulkCopy, handleSlotBulkCopy, showingPrimary, tableView]);
  const primaryColumnWidths = PRIMARY_COLUMN_WIDTH_PRESETS[primaryColumnPreset];
  const totalColCount = showingSlot
    ? 1 + 8 // # + slot columns (Status, Input, Output, Copy, Reset, Len, R, Date)
    : 9 + extraColCount; // # + 8 primary columns + extra metadata columns

  // ===== Virtual scrolling =====
  const ROW_HEIGHT = 32;
  const EXPANDED_ROW_HEIGHT = 150;
  const BUFFER_ROWS = 20;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Measure scroll container
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => { setContainerHeight(entries[0].contentRect.height); });
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [genSubTab, tableView]); // re-measure when switching to table tab or changing column view

  // RAF-throttled scroll handler
  const rafRef = useRef(0);
  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const target = e.target as HTMLDivElement;
    rafRef.current = requestAnimationFrame(() => { setScrollTop(target.scrollTop); });
  }, []);

  // Reset scroll on filter change
  useEffect(() => {
    setScrollTop(0);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [statusFilter]);

  // Compute visible range
  const virtualState = useMemo(() => {
    const len = displayRows.length;
    if (len === 0) return { startIdx: 0, endIdx: 0, topPad: 0, bottomPad: 0 };

    // Pre-compute offsets
    const offsets = new Array<number>(len);
    let total = 0;
    for (let i = 0; i < len; i++) {
      offsets[i] = total;
      total += expandedRows.has(displayRows[i].row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT;
    }

    // Binary search for first visible row
    let lo = 0, hi = len - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const rowBottom = offsets[mid] + (expandedRows.has(displayRows[mid].row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT);
      if (rowBottom <= scrollTop) lo = mid + 1; else hi = mid - 1;
    }
    const startIdx = Math.max(0, lo - BUFFER_ROWS);

    // Scan forward for last visible row
    const viewBottom = scrollTop + containerHeight;
    let endIdx = lo;
    while (endIdx < len && offsets[endIdx] < viewBottom) endIdx++;
    endIdx = Math.min(len, endIdx + BUFFER_ROWS);

    const topPad = offsets[startIdx] || 0;
    const lastEnd = endIdx > 0 ? offsets[endIdx - 1] + (expandedRows.has(displayRows[endIdx - 1].row.id) ? EXPANDED_ROW_HEIGHT : ROW_HEIGHT) : 0;
    const bottomPad = Math.max(0, total - lastEnd);

    return { startIdx, endIdx, topPad, bottomPad };
  }, [displayRows, expandedRows, scrollTop, containerHeight]);

  const rootClassName =
    rootLayout === 'flush' ? 'space-y-2.5' : 'space-y-2.5 max-w-4xl mx-auto';
  const handleSelectExternalView = useCallback((nextView: string) => {
    const currentView = activeExternalView ?? '';
    if (viewSwitchingDisabled && nextView !== currentView) {
      addToast(viewSwitchingDisabledReasonText, 'warning');
      return;
    }
    onExternalViewSelect?.(nextView);
  }, [activeExternalView, addToast, onExternalViewSelect, viewSwitchingDisabled, viewSwitchingDisabledReasonText]);
  const handleSelectTableView = useCallback((nextView: 'primary' | string) => {
    if (viewSwitchingDisabled && nextView !== tableView) {
      addToast(viewSwitchingDisabledReasonText, 'warning');
      return;
    }
    setTableViewAndNotify(nextView);
    onExternalViewSelect?.('');
  }, [addToast, onExternalViewSelect, setTableViewAndNotify, tableView, viewSwitchingDisabled, viewSwitchingDisabledReasonText]);

  return (
    <div className={rootClassName}>
      {/* View tabs â€” switch between primary, slot column groups, and external views (rendered first for consistent layout) */}
      {(promptSlots.length > 0 || externalViewTabsBeforePrimary.length > 0 || externalViewTabs.length > 0) && genSubTab === 'table' && (
        <div className={flowTabRailClass}>
          {externalViewTabsBeforePrimary.map((ext) => (
            <React.Fragment key={ext.id}>
              <FlowTabButton
                active={activeExternalView === ext.id}
                icon={ext.icon}
                label={ext.label}
                locked={ext.locked}
                disabled={!ext.locked && viewSwitchingDisabled && activeExternalView !== ext.id}
                disabledReason={!ext.locked && viewSwitchingDisabled ? viewSwitchingDisabledReasonText : undefined}
                testId={`content-view-${ext.id}`}
                onClick={() => handleSelectExternalView(ext.id)}
              />
              <ChevronRight className="w-3 h-3 text-zinc-300 shrink-0" aria-hidden="true" />
            </React.Fragment>
          ))}
          <FlowTabButton
            active={!activeExternalView && tableView === 'primary'}
            icon={primaryPromptIcon}
            label={primaryPromptLabel || 'Primary'}
            disabled={viewSwitchingDisabled && (activeExternalView !== null || tableView !== 'primary')}
            disabledReason={viewSwitchingDisabled ? viewSwitchingDisabledReasonText : undefined}
            testId="content-view-primary"
                    onClick={() => handleSelectTableView('primary')}
          />
          {promptSlots.map((slot) => (
            <React.Fragment key={slot.id}>
              <ChevronRight className="w-3 h-3 text-zinc-300 shrink-0" aria-hidden="true" />
              <FlowTabButton
                active={!activeExternalView && tableView === slot.id}
                icon={slot.icon}
                label={slot.label}
                disabled={viewSwitchingDisabled && (activeExternalView !== null || tableView !== slot.id)}
                disabledReason={viewSwitchingDisabled ? viewSwitchingDisabledReasonText : undefined}
                testId={`content-view-${toTestIdSegment(slot.label)}`}
                    onClick={() => handleSelectTableView(slot.id)}
              />
            </React.Fragment>
          ))}
          {externalViewTabs.map((ext) => (
            <React.Fragment key={ext.id}>
              <ChevronRight className="w-3 h-3 text-zinc-300 shrink-0" aria-hidden="true" />
              <FlowTabButton
                active={activeExternalView === ext.id}
                icon={ext.icon}
                label={ext.label}
                locked={ext.locked}
                disabled={!ext.locked && viewSwitchingDisabled && activeExternalView !== ext.id}
                disabledReason={!ext.locked && viewSwitchingDisabled ? viewSwitchingDisabledReasonText : undefined}
                testId={`content-view-${ext.id}`}
                onClick={() => handleSelectExternalView(ext.id)}
              />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Header bar â€” hidden when an external view tab is active */}
      <div ref={headerBarRef} className="bg-white border border-zinc-200 rounded-xl shadow-sm px-4 py-2" style={activeExternalView ? { display: 'none' } : undefined}>
        {/* Row 1: Title + action buttons */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <h2 className="pt-0.5 text-sm font-semibold text-zinc-800">Generate</h2>
            {balance !== null && (
              <span className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border ${balance > 1 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : balance > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`} title="Your remaining OpenRouter credit balance">
                ${balance.toFixed(2)}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
            {undoStack.length > 0 && (
              <button
                onClick={handleUndo}
                disabled={instanceBusy}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                title={instanceBusy ? mutatingControlsDisabledReason : 'Undo last clear'}
              >
                <RotateCcw className="w-3 h-3" />
                Undo
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={!rows.some(r => r.output.trim())}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download all inputs and outputs as a .tsv file"
            >
              <Download className="w-3 h-3" />
              Export
            </button>
            <button
              onClick={handleActiveBulkCopy}
              disabled={activeBulkCopyCount === 0}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors flex items-center justify-center gap-1 min-w-[104px] disabled:opacity-40 disabled:cursor-not-allowed"
              title="Copy all visible outputs"
            >
              {((showingPrimary && bulkCopied) || (!showingPrimary && tableView && slotBulkCopied[tableView])) ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              {((showingPrimary && bulkCopied) || (!showingPrimary && tableView && slotBulkCopied[tableView])) ? 'Copied!' : `Copy All (${activeBulkCopyCount})`}
            </button>
            <button
              onClick={handleClearAll}
              disabled={instanceBusy || activeClearableCount === 0}
              className="px-2.5 py-1 text-xs font-medium rounded-lg border border-zinc-200 text-zinc-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
              title={clearButtonTitle}
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
            {/* Online toggle â€” Generate 1 only for now (testing) */}
            {supportsGenerateOnlineToggle(suffix) && (
              <button
                onClick={() => updateSettingsState(prev => ({ ...prev, webSearch: !prev.webSearch }))}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 ${settings.webSearch ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-white border-zinc-200 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50'}`}
                title={settings.webSearch ? 'Web search enabled â€” click to disable. Adds real-time web results to LLM context.' : 'Enable web search (OpenRouter plugin, ~$0.02/request extra). Gives the model access to live web data.'}
              >
                <Globe className="w-3 h-3" />
                Online
              </button>
            )}
            {populateFromSource && showSyncButton && (
              <button
                onClick={handleSyncFromSource}
                disabled={isSyncingSource || instanceBusy}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 bg-white border-zinc-200 text-zinc-600 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={instanceBusy && !isSyncingSource ? mutatingControlsDisabledReason : 'Load rows from upstream pipeline step'}
              >
                {isSyncingSource ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {populateFromSource.label}
              </button>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-all flex items-center gap-1 ${showSettings ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
            >
              <Settings className="w-3 h-3" />
              Settings
            </button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
            {primaryControlMode === 'stop' ? (
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-center gap-1 min-w-[112px] disabled:cursor-wait disabled:opacity-70"
              >
                <Square className="w-3 h-3" />
                {isStopping ? 'Stopping...' : 'Stop'}
              </button>
            ) : primaryControlMode === 'saving' ? (
              <button
                disabled
                className="px-3 py-1 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-500 border border-zinc-200 transition-colors flex items-center justify-center gap-1 min-w-[112px] cursor-wait"
                title="All outputs are produced. Saving the final results and cleaning up."
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving...
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                data-testid={`generate-action-${toTestIdSegment(generateButtonLabel)}`}
                disabled={primaryStats.queuedCount === 0}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1 min-w-[112px] disabled:opacity-50 disabled:cursor-not-allowed"
                title={primaryStats.queuedCount > 0 ? `Generate ${primaryStats.pendingCount} pending${primaryStats.errorCount > 0 ? ` + ${primaryStats.errorCount} error` : ''} rows` : 'No rows to generate'}
              >
                <Play className="w-3 h-3" />
              {generateButtonLabel} ({primaryStats.queuedCount})
            </button>
            )}
            {/* Slot Generate buttons */}
            {promptSlots.map(slot => {
              const slotQueued = rows.filter(r => {
                const sd = getSlot(r, slot.id);
                return sd.input.trim() && (sd.status === 'pending' || sd.status === 'error');
              }).length;
              const isSlotGen = slotGenerating[slot.id] ?? false;
              const slotControlMode = resolveGenerateControlModeFromPhase(slotRunPhase[slot.id] ?? (isSlotGen ? 'running' : 'idle'));
              // Check if all rows have buildInput errors (deps missing)
              const allDepsMissing = slot.buildInput ? rows.every(r => {
                  const result = slot.buildInput!(effectiveSlotPrompts[slot.id] ?? slot.defaultPrompt, r.output, buildExternalDataShared(r), r.input, r);
                return !!result.error;
              }) : false;
              return (
                <React.Fragment key={slot.id}>
                  {slotControlMode === 'stop' ? (
                    <button
                      onClick={() => handleStopSlot(slot.id)}
                      data-testid={`generate-action-${toTestIdSegment(slot.label)}`}
                      disabled={slotStopping[slot.id] ?? false}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-center gap-1 min-w-[112px] disabled:cursor-wait disabled:opacity-70"
                    >
                      <Square className="w-3 h-3" />
                      {(slotStopping[slot.id] ?? false) ? `Stopping ${slot.label}...` : `Stop ${slot.label}`}
                    </button>
                  ) : slotControlMode === 'saving' ? (
                    <button
                      data-testid={`generate-action-${toTestIdSegment(slot.label)}`}
                      disabled
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-500 border border-zinc-200 transition-colors flex items-center justify-center gap-1 min-w-[112px] cursor-wait"
                      title={`${slot.label} outputs are done. Saving the final results and cleaning up.`}
                    >
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Saving {slot.label}...
                    </button>
                  ) : (
                    <button
                      onClick={() => handleGenerateSlot(slot.id)}
                      data-testid={`generate-action-${toTestIdSegment(slot.label)}`}
                      disabled={slotQueued === 0 || allDepsMissing}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors flex items-center justify-center gap-1 min-w-[112px] disabled:opacity-50 disabled:cursor-not-allowed"
                      title={allDepsMissing ? `Dependencies missing for ${slot.label}` : slotQueued > 0 ? `Generate ${slotQueued} ${slot.label} rows` : `No ${slot.label} rows to generate`}
                    >
                      <Play className="w-3 h-3" />
                      {slot.label} ({slotQueued})
                    </button>
                  )}
                </React.Fragment>
              );
            })}
            </div>
          </div>
        </div>

        {/* Row 2: Status filters + live stats */}
        {totalRows > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 mt-2 pt-2 border-t border-zinc-100">
            {/* Status filter buttons */}
            <div className="flex items-center gap-1 text-[11px]">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'all' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                All ({totalRows})
              </button>
              {generatedCount > 0 && (
                <button
                  onClick={() => setStatusFilter('generated')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'generated' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                >
                  Done ({generatedCount})
                </button>
              )}
              {errorCount > 0 && (
                <button
                  onClick={() => setStatusFilter('error')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'error' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
                >
                  Errors ({errorCount})
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors ${statusFilter === 'pending' ? 'bg-zinc-600 text-white' : 'bg-zinc-50 text-zinc-500 hover:bg-zinc-100'}`}
                >
                  Pending ({pendingCount})
                </button>
              )}
              {generatingCount > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md font-medium animate-pulse" title="Rows currently being processed by the LLM">{generatingCount} active</span>}
              {activeRateLimitCount > 0 && <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded-md font-medium" title="429 rate limit errors - consider lowering concurrent requests">{activeRateLimitCount} throttled</span>}
            </div>

            {/* Reset filtered errors to pending */}
            {statusFilter === 'error' && errorCount > 0 && !activeIsGenerating && (
              <button
                onClick={() => {
                  updateRowsState(prev => prev.map(r => {
                    if (activeStatsSource === 'primary') {
                      return r.status === 'error' ? { ...r, status: 'pending' as const, error: undefined } : r;
                    }
                    const slotConfig = promptSlots.find(slot => slot.id === activeStatsSource);
                    const slotData = getSlot(r, activeStatsSource);
                    if (slotData.status !== 'error') return r;
                    const slots = { ...r.slots };
                    slots[activeStatsSource] = { ...slotData, status: 'pending', error: undefined };
                    const metadata = { ...(r.metadata ?? {}) };
                    for (const key of slotConfig?.clearMetadataKeysOnReset ?? []) delete metadata[key];
                    return { ...r, slots, metadata };
                  }));
                  setStatusFilter('all');
                }}
                className="px-2.5 py-0.5 text-[11px] font-medium rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Reset {errorCount} to Pending
              </button>
            )}

            <div className="flex items-center gap-3 ml-auto">

            {/* Cost + tokens â€” uses liveCost during generation (updates every 3s via ref), totalCost when idle */}
            {(() => {
              const displayCost = activeIsGenerating ? activeLiveCost : totalCost;
              return displayCost > 0 ? (
                <span className={`px-2 py-0.5 text-[11px] rounded-md font-medium ${activeIsGenerating ? 'bg-amber-50 text-amber-700 animate-pulse' : 'bg-indigo-50 text-indigo-700'}`} title={`Total API cost this session Â· ${totalPromptTokens.toLocaleString()} prompt tokens + ${totalCompletionTokens.toLocaleString()} completion tokens${settings.webSearch ? ' Â· Includes $0.02/request web search cost' : ''}`}>
                  ${displayCost < 0.01 ? displayCost.toFixed(4) : displayCost.toFixed(2)}
                </span>
              ) : null;
            })()}

            {/* Timer + Throughput (isolated component â€” does NOT cause parent re-renders) */}
            <GenerationTimer
              startTime={activeStartTime}
              isActive={activeIsGenerating}
              completionTimestampsRef={activeCompletionTimestampsRef}
              doneCount={generatedCount}
              formatElapsedFn={formatElapsed}
            />
            </div>
          </div>
        )}

        {/* Settings panel */}
        {showSettings && (
          <div className="mt-3 pt-3 border-t border-zinc-200 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* API Key */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">OpenRouter API Key<Tip text="Your API key from openrouter.ai â€” used to authenticate all LLM requests. Get one free at openrouter.ai/keys" /></label>
                <input
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => {
                    const nextApiKey = e.target.value;
                    persistSharedApiKeyImmediately(nextApiKey);
                    updateSettingsState(prev => ({ ...prev, apiKey: nextApiKey }));
                  }}
                  placeholder="sk-or-..."
                  data-testid="openrouter-api-key"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Model selector */}
              <div ref={modelDropdownRef} className="relative">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-[10px] font-medium text-zinc-500">
                    Model<Tip text="The LLM model to use for generation. Price shown is per 1M tokens. Models load automatically when API key is entered." />
                    {modelsLoading && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
                  </label>
                  <button
                    type="button"
                      onClick={() => {
                        if (!selectedModelId.trim()) return;
                        setIsModelDropdownOpen(false);
                        const nextSettings = withScopedSelectedModelLock(settingsRef.current, activeModelScope, !selectedModelLocked);
                        settingsRef.current = nextSettings;
                        applySettingsState(nextSettings);
                        persistProjectedSettingsImmediately(nextSettings);
                      }}
                    disabled={!selectedModelId.trim()}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      selectedModelLocked
                        ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                        : selectedModelId.trim()
                          ? 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
                          : 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400'
                    }`}
                    title={
                      selectedModelLocked
                        ? 'Unlock this tab to allow model changes and shared model updates again.'
                        : selectedModelId.trim()
                          ? 'Lock this subtab to its current model so everyone sees and uses the same model here.'
                          : 'Select a model before locking this subtab.'
                    }
                  >
                    {selectedModelLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    <span>{selectedModelLocked ? 'Locked' : 'Lock'}</span>
                  </button>
                </div>
                <button
                  onClick={() => {
                    if (selectedModelLocked) return;
                    if (models.length === 0 && settings.apiKey.trim()) fetchModels();
                    setIsModelDropdownOpen(!isModelDropdownOpen);
                  }}
                  disabled={selectedModelLocked}
                  className={`w-full px-2.5 py-1 text-xs border rounded-lg text-left flex items-center justify-between transition-colors ${
                    selectedModelLocked
                      ? 'cursor-not-allowed border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  <span className="truncate">
                    {selectedModelObj ? selectedModelObj.name : (selectedModelId || 'Select model...')}
                  </span>
                  <ChevronDown className="w-3 h-3 shrink-0 text-zinc-400" />
                </button>
                {modelsError && <p className="text-[10px] text-red-500 mt-0.5">{modelsError}</p>}
                {selectedModelLocked && selectedModelId.trim() && (
                  <p className="text-[10px] text-amber-700 mt-0.5">
                    This subtab is locked to {selectedModelObj ? selectedModelObj.name : selectedModelId}. Other users and refreshes will keep this model here until it is unlocked.
                  </p>
                )}
                {selectedModelObj && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    In: {formatCost(selectedModelObj.pricing.prompt)} Â· Out: {formatCost(selectedModelObj.pricing.completion)} Â· {(selectedModelObj.context_length / 1000).toFixed(0)}K ctx
                  </p>
                )}

                {/* Dropdown */}
                {isModelDropdownOpen && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-[300px] overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-zinc-100 space-y-1.5">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                        <input
                          type="text"
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          placeholder="Search models..."
                          className="w-full pl-6 pr-2 py-1 text-xs border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          autoFocus
                        />
                      </div>
                      {/* Sort buttons */}
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-zinc-400 mr-0.5">Sort:</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); setModelSort('name'); }}
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${modelSort === 'name' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                        >
                          Name
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setModelSort('price-asc'); }}
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${modelSort === 'price-asc' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                        >
                          Price â†‘
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setModelSort('price-desc'); }}
                          className={`px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors ${modelSort === 'price-desc' ? 'bg-zinc-700 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                        >
                          Price â†“
                        </button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {filteredModels.map((m, mIdx) => (
                        <React.Fragment key={m.id}>
                          {/* Divider between starred and unstarred groups */}
                          {starredModels.size > 0 && mIdx > 0 && starredModels.has(filteredModels[mIdx - 1].id) && !starredModels.has(m.id) && (
                            <div className="border-t border-zinc-200 my-0.5" />
                          )}
                          <div className={`w-full px-3 py-1.5 text-left text-xs hover:bg-indigo-50 transition-colors flex items-center ${m.id === selectedModelId ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-700'}`}>
                            {/* Star toggle */}
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleStar(m.id); }}
                              className="p-0.5 mr-1.5 shrink-0 transition-colors"
                              title={starredModels.has(m.id) ? 'Unstar model' : 'Star model'}
                            >
                              <Star className={`w-3 h-3 ${starredModels.has(m.id) ? 'fill-amber-400 text-amber-400' : 'text-zinc-300 hover:text-amber-400'}`} />
                            </button>
                            {/* Model name â€” click to select */}
                            <button
                                onClick={() => {
                                  const nextSettings = withScopedSelectedModel(settingsRef.current, activeModelScope, m.id);
                                  settingsRef.current = nextSettings;
                                  applySettingsState(nextSettings);
                                  persistProjectedSettingsImmediately(nextSettings);
                                  setIsModelDropdownOpen(false);
                                  setModelSearch('');
                                }}
                              className="truncate flex-1 text-left"
                            >
                              {m.name}
                            </button>
                            <span className="text-[10px] text-zinc-400 ml-2 shrink-0">
                              {formatCost(m.pricing.prompt)}
                            </span>
                            {m.id === selectedModelId && <Check className="w-3 h-3 ml-1 text-indigo-600 shrink-0" />}
                          </div>
                        </React.Fragment>
                      ))}
                      {filteredModels.length === 0 && (
                        <p className="px-3 py-4 text-xs text-zinc-400 text-center">
                          {models.length === 0 ? 'Enter API key to load models' : 'No models match search'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Rate limit */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Concurrent Requests ({settings.rateLimit})<Tip text="How many API requests run in parallel. Higher = faster but may hit rate limits (429 errors). Lower if you see 'throttled' warnings." /></label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={settings.rateLimit}
                  onChange={(e) => updateSettingsState(prev => ({ ...prev, rateLimit: parseInt(e.target.value) }))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>1</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>
            </div>

            {/* Len range + retries row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-zinc-100">
              {/* Min len */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Min Output Length (chars)<Tip text="Minimum character count for the output. If the output is shorter, it will be retried up to Max Retries times. Set to 0 to disable." /></label>
                <input
                  type="number"
                  min={0}
                  value={settings.minLen || ''}
                  onChange={(e) => updateSettingsState(prev => ({ ...prev, minLen: parseInt(e.target.value) || 0 }))}
                  placeholder="0 (no min)"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Max len */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Output Length (chars)<Tip text="Maximum character count for the output. If the output exceeds this, it will be retried up to Max Retries times. Set to 0 to disable." /></label>
                <input
                  type="number"
                  min={0}
                  value={settings.maxLen || ''}
                  onChange={(e) => updateSettingsState(prev => ({ ...prev, maxLen: parseInt(e.target.value) || 0 }))}
                  placeholder="0 (no max)"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Max retries */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Retries ({settings.maxRetries})<Tip text="How many times to retry if the output length falls outside the Min/Max range. After exhausting retries, the last attempt is kept and marked as an error." /></label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.maxRetries}
                  onChange={(e) => updateSettingsState(prev => ({ ...prev, maxRetries: Math.min(500, Math.max(0, parseInt(e.target.value) || 0)) }))}
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-400 mt-0.5">Retries when output length is outside min/max range</p>
              </div>
            </div>

            {/* Temperature + Max tokens row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-zinc-100">
              {/* Temperature */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Temperature ({(settings.temperature ?? 1.0).toFixed(1)})<Tip text="Controls randomness. 0.0 = deterministic/precise, 1.0 = balanced, 2.0 = highly creative/random. Lower for factual tasks, higher for creative writing." /></label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settings.temperature ?? 1.0}
                  onChange={(e) => updateSettingsState(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[9px] text-zinc-400">
                  <span>0.0 (precise)</span>
                  <span>1.0 (balanced)</span>
                  <span>2.0 (creative)</span>
                </div>
              </div>

              {/* Max tokens */}
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Max Output Tokens<Tip text="Maximum number of tokens the model can generate per response. Leave at 0 for the model's default limit. 1 token â‰ˆ 4 characters." /></label>
                <input
                  type="number"
                  min={0}
                  value={settings.maxTokens || ''}
                  onChange={(e) => updateSettingsState(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 0 }))}
                  placeholder="0 (no limit)"
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="text-[9px] text-zinc-400 mt-0.5">API-level limit on output length. More reliable than char-based retries.</p>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Reasoning<Tip text="Extra reasoning effort for supported models. Off sends no reasoning field. Use low/medium/high for more deliberate responses when the model supports it." /></label>
                <select
                  value={settings.reasoning || 'off'}
                  onChange={(e) => {
                    const value = e.target.value;
                    updateSettingsState(prev => ({
                      ...prev,
                      reasoning: value === 'off' ? false : value as ReasoningLevel,
                    }));
                  }}
                  className="w-full px-2.5 py-1 text-xs border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="off">Off</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <p className="text-[9px] text-zinc-400 mt-0.5">Persisted per generate surface, including the new Rating stage.</p>
              </div>
            </div>

            {/* Prompt Section â€” tabbed when slots exist, single textarea otherwise */}
            <div className="pt-2 border-t border-zinc-100">
              {promptSlots.length > 0 ? (
                <>
                  {/* Tabbed prompt rail */}
                  <div className={`${compactTabRailClass} mb-2`}>
                    <button
                      onClick={() => setActivePromptTab(0)}
                      className={`${compactTabBtnBase} ${activePromptTab === 0 ? compactTabBtnActive : compactTabBtnInactive}`}
                    >
                      {primaryPromptLabel || 'System Prompt'}
                    </button>
                    {promptSlots.map((slot, idx) => (
                      <button
                        key={slot.id}
                        onClick={() => setActivePromptTab(idx + 1)}
                        className={`${compactTabBtnBase} ${activePromptTab === idx + 1 ? compactTabBtnActive : compactTabBtnInactive}`}
                      >
                        {slot.promptLabel}
                      </button>
                    ))}
                    {validatorSlots.map((slot, idx) => (
                      <button
                        key={`${slot.id}-validator`}
                        onClick={() => setActivePromptTab(promptSlots.length + idx + 1)}
                        className={`${compactTabBtnBase} ${activePromptTab === promptSlots.length + idx + 1 ? compactTabBtnActive : compactTabBtnInactive}`}
                      >
                        {slot.validatorLabel}
                      </button>
                    ))}
                  </div>
                  {/* Primary prompt textarea */}
                  {activePromptTab === 0 && (
                    <div>
                      <textarea
                        value={settings.prompt}
                        onChange={(e) => updateSettingsState(prev => ({ ...prev, prompt: e.target.value }))}
                        placeholder="Enter system-level instructions that apply to every row..."
                        rows={6}
                        className="w-full px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono leading-relaxed resize-y"
                      />
                      <p className="text-[9px] text-zinc-400 mt-0.5">
                        Sent as the system message for every API call. Each row&apos;s Input column is sent as the user message.
                      </p>
                    </div>
                  )}
                  {/* Slot prompt textareas */}
                  {promptSlots.map((slot, idx) => activePromptTab === idx + 1 && (
                    <div key={slot.id}>
                      <textarea
                        value={settings.slotPrompts?.[slot.id] ?? slot.defaultPrompt}
                        onChange={(e) => updateSettingsState(prev => ({
                          ...prev,
                          slotPrompts: { ...prev.slotPrompts, [slot.id]: e.target.value },
                        }))}
                        placeholder={`Enter ${slot.promptLabel.toLowerCase()}...`}
                        rows={8}
                        className="w-full px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono leading-relaxed resize-y"
                      />
                      <p className="text-[9px] text-zinc-400 mt-0.5">
                        {slot.buildInput
                          ? 'Template with stage-specific placeholders. Auto-fills each row\u2019s input with actual values.'
                          : 'Sent as the system message for every API call in this slot.'}
                      </p>
                    </div>
                  ))}
                  {validatorSlots.map((slot, idx) => activePromptTab === promptSlots.length + idx + 1 && (
                    <div key={`${slot.id}-validator-panel`}>
                      <textarea
                        value={settings.slotValidators?.[slot.id] ?? slot.defaultValidator ?? ''}
                        onChange={(e) => updateSettingsState(prev => ({
                          ...prev,
                          slotValidators: { ...prev.slotValidators, [slot.id]: e.target.value },
                        }))}
                        placeholder={`Enter ${slot.validatorLabel?.toLowerCase() ?? 'validator contract'}...`}
                        rows={8}
                        className="w-full px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono leading-relaxed resize-y"
                      />
                      <p className="text-[9px] text-zinc-400 mt-0.5">
                        {slot.validatorDescription || 'Reference contract for the deterministic local validator. This text is persisted for visibility and team alignment.'}
                      </p>
                    </div>
                  ))}
                </>
              ) : (
                /* No slots â€” single System Prompt textarea (unchanged behavior) */
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">
                    System Prompt<Tip text="Instructions sent as a system message before each row's input. The model follows these instructions when generating every output. Leave empty to send only the row input." />
                  </label>
                  <textarea
                    value={settings.prompt}
                    onChange={(e) => updateSettingsState(prev => ({ ...prev, prompt: e.target.value }))}
                    placeholder="Enter system-level instructions that apply to every row..."
                    rows={6}
                    className="w-full px-2.5 py-1.5 text-xs border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono leading-relaxed resize-y"
                  />
                  <p className="text-[9px] text-zinc-400 mt-0.5">
                    Sent as the system message for every API call. Each row&apos;s Input column is sent as the user message.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Rate limit warning */}
      {rateLimitCount >= 3 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-orange-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span><strong>{rateLimitCount} rate limit hits</strong> â€” requests are being auto-retried with backoff, but you should lower concurrent requests (currently {settings.rateLimit}) for better throughput.</span>
        </div>
      )}

      {/* Slot dependency warnings */}
      {slotDepWarnings.map(w => (
        <div key={`${w.slotId}-${w.message}`} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-amber-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span><strong>{w.label}:</strong> {w.message}</span>
        </div>
      ))}

      {/* Subtab switcher â€” hidden when external view is active */}
      <div className={compactTabRailClass} style={activeExternalView ? { display: 'none' } : undefined}>
        <button
          onClick={() => setGenSubTabAndNotify('table')}
          data-testid="generate-subtab-table"
          className={`${compactTabBtnBase} ${genSubTab === 'table' ? compactTabBtnActive : compactTabBtnInactive}`}
        >
          Table
        </button>
        <button
          onClick={() => setGenSubTabAndNotify('log')}
          data-testid="shared-log-tab"
          className={`${compactTabBtnBase} flex items-center gap-1 ${genSubTab === 'log' ? compactTabBtnActive : compactTabBtnInactive}`}
        >
          <ScrollText className="w-3 h-3" />
          Log ({logs.length})
        </button>
      </div>

      {/* Table â€” hidden when an external view tab is active */}
      {genSubTab === 'table' && !activeExternalView && <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
        <div ref={scrollContainerRef} onScroll={handleTableScroll} className="overflow-auto max-h-[75vh]" style={SHARED_SCROLL_CONTAINER_STYLE}>
          <table className="text-left text-sm relative w-full table-fixed">
            <thead className="bg-zinc-50 text-zinc-500 font-medium sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7]">
              <tr>
                <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[28px]`} title="Row number (original position)">#</th>
                {/* Extra metadata columns (e.g., Page Name, Order, H2 Name) */}
                {extraColumns.map(col => {
                  const tooltip = col.tooltip ?? EXTRA_COLUMN_TOOLTIPS[col.key];
                  return (
                    <th key={col.key} className={`${CELL.headerBase} ${col.compact ? CELL.headerCompact : CELL.headerNormal} ${col.compact ? 'text-center' : 'text-left'} ${col.width ?? 'w-[120px]'}`}>
                      <HeaderCellLabel label={col.label} tooltip={tooltip} align={col.compact ? 'center' : 'left'} />
                    </th>
                  );
                })}
                {/* Primary column headers */}
                {showingPrimary && <>
                <th className={`${CELL.headerBase} ${CELL.headerNormal} text-left ${primaryColumnWidths.status}`}>Status<Tip text="Pending = waiting to generate Â· Generating = in progress Â· Generated = complete Â· Error = failed after retries" /></th>
                <th className={`${CELL.headerBase} ${CELL.headerNormal} text-left ${primaryColumnWidths.input}`}>{primaryInputHeaderLabel}<Tip text="Your prompt for each row. Paste from Google Sheets or type directly. Each row is sent as a separate LLM request." /></th>
                <th className={`${CELL.headerBase} ${CELL.headerNormal} text-left ${primaryColumnWidths.output}`}>{primaryOutputHeaderLabel}<Tip text="The LLM response. Click a row to expand/collapse. Error rows show the last attempted output + error message." /></th>
                <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[28px]`} title="Copy individual output to clipboard"></th>
                <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[28px]`} title="Reset row to pending for re-generation"></th>
                <th className={`${CELL.headerBase} ${CELL.headerCompact} text-right w-[44px]`}>Len<Tip text="Character count of the output. Highlighted in red/amber if outside your Min/Max length range." /></th>
                <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[32px]`}>R<Tip text="Number of retry attempts. Shows when output length was outside the Min/Max range and had to be regenerated." /></th>
                <th className={`${CELL.headerBase} ${CELL.headerCompact} text-right pr-4 ${primaryColumnWidths.date}`}>Date<Tip text="Timestamp when this output was generated." /></th>
                </>}
                {/* Slot column headers â€” only the active slot */}
                {showingSlot && promptSlots.filter(slot => slot.id === tableView).map(slot => (
                  <React.Fragment key={slot.id}>
                    <th className={`${CELL.headerBase} ${CELL.headerNormal} text-left ${primaryColumnWidths.status}`}>Status<Tip text={SLOT_HEADER_TOOLTIPS.status} /></th>
                    <th className={`${CELL.headerBase} ${CELL.headerNormal} text-left ${primaryColumnWidths.input}`}>Input<Tip text={SLOT_HEADER_TOOLTIPS.input} /></th>
                    <th className={`${CELL.headerBase} ${CELL.headerNormal} text-left ${primaryColumnWidths.output}`}>Output<Tip text={SLOT_HEADER_TOOLTIPS.output} /></th>
                    <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[28px]`}></th>
                    <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[28px]`}></th>
                    <th className={`${CELL.headerBase} ${CELL.headerCompact} text-right w-[44px]`}>Len<Tip text={SLOT_HEADER_TOOLTIPS.len} /></th>
                    <th className={`${CELL.headerBase} ${CELL.headerCompact} text-center w-[32px]`}>R<Tip text={SLOT_HEADER_TOOLTIPS.retries} /></th>
                    <th className={`${CELL.headerBase} ${CELL.headerCompact} text-right pr-4 ${primaryColumnWidths.date}`}>Date<Tip text={SLOT_HEADER_TOOLTIPS.date} /></th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className={TABLE_TBODY_ZEBRA_CLASS}>
              {virtualState.topPad > 0 && <tr style={{ height: virtualState.topPad }} aria-hidden="true"><td colSpan={totalColCount} /></tr>}
              {displayRows.slice(virtualState.startIdx, virtualState.endIdx).map(({ row, origIdx }) => (
                <GenerateRowComponent
                  key={row.id}
                  row={row}
                  origIdx={origIdx}
                  isExpanded={expandedRows.has(row.id)}
                  isBusy={instanceBusy}
                  isCopied={copiedRowId === row.id}
                  minLen={settings.minLen}
                  maxLen={settings.maxLen}
                  onInputChange={handleInputChange}
                  onPaste={handlePaste}
                  onClearCell={handleClearCell}
                  onCopyOutput={handleCopyOutput}
                  onToggleExpand={handleToggleExpand}
                  onRetry={handleRetryRow}
                  slotConfigs={promptSlots.length > 0 ? promptSlots : undefined}
                  slotBusy={slotGenerating}
                  slotCopied={slotCopiedKey}
                  onSlotCopyOutput={handleSlotCopyOutput}
                  onSlotRetry={handleSlotRetry}
                  onSlotToggleExpand={handleSlotToggleExpand}
                  expandedSlotKeys={expandedSlotKeys}
                  tableView={promptSlots.length > 0 ? tableView : undefined}
                  extraColumns={extraColumns.length > 0 ? extraColumns : undefined}
                  lockMetadataKey={lockMetadataKey}
                />
              ))}
              {virtualState.bottomPad > 0 && <tr style={{ height: virtualState.bottomPad }} aria-hidden="true"><td colSpan={totalColCount} /></tr>}
            </tbody>
          </table>
        </div>
      </div>}

      {/* Log view */}
      {genSubTab === 'log' && !activeExternalView && (
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-auto max-h-[75vh]" style={SHARED_SCROLL_CONTAINER_STYLE}>
            <table data-testid="generate-log-table" className="text-sm w-full">
              <thead className="bg-zinc-50 sticky top-0 z-10">
                <tr className="border-b border-zinc-200">
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[140px]">Timestamp<Tip text={LOG_HEADER_TOOLTIPS.timestamp} /></th>
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[90px]">Action<Tip text={LOG_HEADER_TOOLTIPS.action} /></th>
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500 w-[140px]">Model<Tip text={LOG_HEADER_TOOLTIPS.model} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[50px]">Output<Tip text={LOG_HEADER_TOOLTIPS.output} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[40px]">Err<Tip text={LOG_HEADER_TOOLTIPS.err} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[55px]">Time<Tip text={LOG_HEADER_TOOLTIPS.time} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[50px]">Cost<Tip text={LOG_HEADER_TOOLTIPS.cost} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[40px]">Avg/s<Tip text={LOG_HEADER_TOOLTIPS.avg} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[35px]">Con<Tip text={LOG_HEADER_TOOLTIPS.con} /></th>
                  <th className="px-1.5 py-1.5 text-right text-[10px] font-semibold text-zinc-500 w-[70px]">Tokens<Tip text={LOG_HEADER_TOOLTIPS.tokens} /></th>
                  <th className="px-1.5 py-1.5 text-left text-[10px] font-semibold text-zinc-500">Details<Tip text={LOG_HEADER_TOOLTIPS.details} /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {logs.length === 0 ? (
                  <tr><td colSpan={11} className="px-2 py-8 text-center text-xs text-zinc-400">No log entries yet. Generate some outputs to see activity here.</td></tr>
                ) : (
                  [...logs].reverse().map((log, idx) => (
                    <tr key={log.id} className={`hover:bg-zinc-50/50 ${idx % 2 === 1 ? 'bg-zinc-50/40' : ''}`}>
                      <td className="px-1.5 py-1 text-[9px] text-zinc-500 tabular-nums whitespace-nowrap">
                        {formatDateTime(log.timestamp)}
                      </td>
                      <td className="px-1.5 py-1">
                        <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-medium whitespace-nowrap ${
                          log.action === 'generate_start' ? 'bg-indigo-100 text-indigo-700' :
                          log.action === 'generate_complete' ? 'bg-emerald-100 text-emerald-700' :
                          log.action === 'generate_stop' ? 'bg-amber-100 text-amber-700' :
                          log.action === 'clear_all' ? 'bg-red-100 text-red-700' :
                          log.action === 'export' ? 'bg-cyan-100 text-cyan-700' :
                          'bg-zinc-100 text-zinc-600'
                        }`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-1.5 py-1 text-[9px] text-zinc-500 truncate max-w-[140px]" title={log.model}>
                        {log.model ? log.model.split('/').pop() : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.outputCount != null ? log.outputCount.toLocaleString() : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums">
                        {log.errorCount != null && log.errorCount > 0 ? <span className="text-red-600">{log.errorCount}</span> : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600 whitespace-nowrap">
                        {log.elapsedMs != null ? formatElapsed(log.elapsedMs) : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.cost != null ? `$${log.cost < 0.01 ? log.cost.toFixed(4) : log.cost.toFixed(2)}` : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.avgPerSec != null ? log.avgPerSec.toFixed(1) : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[10px] tabular-nums text-zinc-600">
                        {log.concurrency != null ? log.concurrency : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-right text-[9px] tabular-nums text-zinc-500 whitespace-nowrap" title={log.promptTokens != null ? `${log.promptTokens.toLocaleString()} in / ${log.completionTokens?.toLocaleString() || 0} out` : ''}>
                        {log.promptTokens != null ? `${((log.promptTokens + (log.completionTokens || 0)) / 1000).toFixed(1)}K` : 'â€”'}
                      </td>
                      <td className="px-1.5 py-1 text-[10px] text-zinc-500">{log.details}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
});

// ============ Wrapper with sub-tabs ============
export default function GenerateTab({
  activeProjectId = null,
  isVisible = true,
  runtimeEffectsActive = true,
  starredModels,
  onToggleStar,
  onBusyStateChange,
}: GenerateTabProps) {
  const { addToast } = useToast();
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [instanceBusyState, setInstanceBusyState] = useState<Record<string, boolean>>({});
  const [activeSubTab, setActiveSubTab] = useState<'1' | '2'>(() => {
    try {
      const raw = localStorage.getItem(activeSubTabCacheKey);
      return raw === '2' ? '2' : '1';
    } catch {
      return '1';
    }
  });
  const tabRef = useRef(activeSubTab);
  const [gen2Activated, setGen2Activated] = useState(() => activeSubTab === '2');
  const activeSubTabDocId = 'generate_active_subtab';
  const lastReportedBusyRef = useRef<boolean | null>(null);
  const onBusyParentRef = useRef(onBusyStateChange);
  useLayoutEffect(() => {
    onBusyParentRef.current = onBusyStateChange;
  }, [onBusyStateChange]);
  const setInstanceBusy = useCallback((instanceKey: string, isBusy: boolean) => {
    setInstanceBusyState((prev) => {
      if (prev[instanceKey] === isBusy) return prev;
      return { ...prev, [instanceKey]: isBusy };
    });
  }, []);

  const handleGenerate1BusyChange = useCallback((isBusy: boolean) => {
    setInstanceBusy('generate_1', isBusy);
  }, [setInstanceBusy]);
  const handleGenerate2BusyChange = useCallback((isBusy: boolean) => {
    setInstanceBusy('generate_2', isBusy);
  }, [setInstanceBusy]);
  const isAnyInstanceBusy = useMemo(
    () => Object.values(instanceBusyState).some(Boolean),
    [instanceBusyState],
  );
  const generate1RuntimeEffectsActive = runtimeEffectsActive && (instanceBusyState.generate_1 || isVisible && activeSubTab === '1');
  const generate2RuntimeEffectsActive = runtimeEffectsActive && (instanceBusyState.generate_2 || isVisible && activeSubTab === '2');

  useEffect(() => {
    setInstanceBusyState({});
    lastReportedBusyRef.current = false;
    onBusyParentRef.current?.(false);
  }, [activeProjectId]);

  useEffect(() => {
    if (lastReportedBusyRef.current === isAnyInstanceBusy) return;
    lastReportedBusyRef.current = isAnyInstanceBusy;
    onBusyParentRef.current?.(isAnyInstanceBusy);
  }, [isAnyInstanceBusy]);

  useEffect(() => {
    let alive = true;
    if (!runtimeEffectsActive) return () => {
      alive = false;
    };
    if (!activeProjectId) {
      setWorkspaceReady(false);
      setWorkspaceError(null);
      return () => {
        alive = false;
      };
    }

    setWorkspaceReady(false);
    setWorkspaceError(null);
    void ensureProjectGenerateWorkspace(activeProjectId)
      .then((result) => {
        if (!alive) return;
        if (result.status !== 'ready') {
          setWorkspaceError(result.message ?? 'Failed to prepare the shared Generate workspace.');
          return;
        }
        setWorkspaceReady(true);
      })
      .catch((error) => {
        if (!alive) return;
        setWorkspaceError(error instanceof Error ? error.message : 'Failed to prepare the shared Generate workspace.');
      });

    return () => {
      alive = false;
    };
  }, [activeProjectId, runtimeEffectsActive]);

  useEffect(() => {
    let alive = true;
    void loadCachedState<'1' | '2' | { tab?: string }>({
      idbKey: appSettingsIdbKey(activeSubTabDocId),
      localStorageKey: activeSubTabCacheKey,
      parseLocalStorage: (raw) => (raw === '2' ? '2' : '1'),
    }).then((cached) => {
      if (!alive || !cached) return;
      const tab: '1' | '2' =
        cached === '2'
          ? '2'
          : cached === '1'
            ? '1'
            : cached && typeof cached === 'object' && (cached as { tab?: string }).tab === '2'
              ? '2'
              : '1';
      tabRef.current = tab;
      setActiveSubTab(tab);
      if (tab === '2') setGen2Activated(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const switchTab = useCallback((tab: '1' | '2') => {
    if (tabRef.current === tab) return; // Already on this tab â€” skip entirely
    tabRef.current = tab;
    void persistLocalCachedState({
      idbKey: appSettingsIdbKey(activeSubTabDocId),
      value: tab,
      localStorageKey: activeSubTabCacheKey,
      localStorageValue: tab,
      addToast,
      localContext: 'generate active subtab',
    });
    if (tab === '2') setGen2Activated(true);
    setActiveSubTab(tab);
  }, [addToast]);

  if (!activeProjectId) {
    return (
      <div className="max-w-4xl mx-auto mt-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-zinc-800">Generate</div>
        <div className="mt-1 text-sm text-zinc-500">Select a project to open the shared Generate workspace.</div>
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="max-w-4xl mx-auto mt-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-amber-900">Generate unavailable</div>
        <div className="mt-1 text-sm text-amber-800">{workspaceError}</div>
      </div>
    );
  }

  if (!workspaceReady) {
    return (
      <div className="max-w-4xl mx-auto mt-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-zinc-800">Generate</div>
        <div className="mt-1 text-sm text-zinc-500">Preparing the shared project workspace...</div>
      </div>
    );
  }

  return (
    <>
      {/* Sub-tab switcher */}
      <div className={`max-w-4xl mx-auto ${compactTabRailClass} mt-2 mb-1`}>
        <button
          onClick={() => switchTab('1')}
          className={`${compactTabBtnBase} ${
            activeSubTab === '1'
              ? compactTabBtnActive
              : compactTabBtnInactive
          }`}
        >
          Generate 1
        </button>
        <button
          onClick={() => switchTab('2')}
          className={`${compactTabBtnBase} ${
            activeSubTab === '2'
              ? compactTabBtnActive
              : compactTabBtnInactive
          }`}
        >
          Generate 2
        </button>
      </div>

      {/* Both use CSS visibility â€” no layout recalc, GPU-composited hide/show */}
      <div style={activeSubTab === '1' ? undefined : { display: 'none' }}>
        <GenerateTabInstance
          workspaceProjectId={activeProjectId}
          runtimeEffectsActive={generate1RuntimeEffectsActive}
          storageKey=""
          starredModels={starredModels}
          onToggleStar={onToggleStar}
          onBusyStateChange={handleGenerate1BusyChange}
        />
      </div>
      {gen2Activated && (
        <div style={activeSubTab === '2' ? undefined : { display: 'none' }}>
          <GenerateTabInstance
            workspaceProjectId={activeProjectId}
            runtimeEffectsActive={generate2RuntimeEffectsActive}
            storageKey="_2"
            starredModels={starredModels}
            onToggleStar={onToggleStar}
            onBusyStateChange={handleGenerate2BusyChange}
          />
        </div>
      )}
    </>
  );
}
