# REFACTOR_PLAN.md — Refactor Execution Tracker (2026-03-27)

This document is the structured execution tracker for refactor work.

## How To Use This Tracker

- Use [`REFACTOR_ANALYSIS.md`](./REFACTOR_ANALYSIS.md) for the latest repo-wide ranking and current priorities.
- Use this file when actively executing refactor work and checking detailed extraction notes.
- Use [`FIXES.md`](./FIXES.md) for tactical bug fixes and confirmed failure modes.

The size counts and approximate line references below were captured on `2026-03-27`.
Treat them as historical execution context, not as the latest repo metrics.

---

## Prioritization Model

| Priority | Meaning | Gate |
|----------|---------|------|
| **P0 (Blocker)** | Data integrity, multi-user sync, silent data loss | Ship nothing else until closed |
| **P1 (High)** | Monolith splits and structural risk in active-demand paths | Do immediately after P0 |
| **P2 (Medium)** | Duplication, missing abstractions, oversized components | Improves velocity; not blocking today |
| **P3 (Low)** | DX polish, minor test gaps, cosmetic consistency | After core risk is reduced |

---

## Historical Baseline (Measured 2026-03-27)

| File | Lines | Guideline | Status |
|------|-------|-----------|--------|
| `src/App.tsx` | **7,457** | ~800 (component) | **9.3x over** |
| `src/AutoGroupPanel.tsx` | **4,211** | ~400 (component) | **10.5x over** |
| `src/GenerateTab.tsx` | **2,291** | ~400 (component) | **5.7x over** |
| `src/AutoGroupEngine.ts` | **~1,430** | ~800 (utility) | **1.8x over** |
| `src/useProjectPersistence.ts` | **1,119** | ~800 (utility) | **1.4x over** |
| `src/projectStorage.ts` | **841** | ~800 (utility) | borderline |
| `src/GroupReviewSettings.tsx` | **835** | ~400 (component) | **2.1x over** |
| `src/dictionaries.ts` | **832** | ~800 (utility) | borderline (data-only) |
| `src/FeedbackModal.tsx` | **606** | ~400 (component) | **1.5x over** |
| `src/CosineEngine.ts` | **596** | ~800 (utility) | OK |
| `src/AppStatusBar.tsx` | **541** | ~400 (component) | **1.4x over** |
| `src/tokenMerge.ts` | **491** | ~800 (utility) | OK |
| `src/FeedbackTab.tsx` | **421** | ~400 (component) | borderline |

**Total risk concentration:** The top 3 files alone contain **~14,000 lines** of interleaved domain logic, persistence, AI orchestration, and JSX rendering.

---

## P0 — Data Integrity & Multi-User Sync

### P0.1 `saveToIDB` silently swallows errors

- **File:** `src/projectStorage.ts`
- **Problem:** `saveToIDB` catches and logs errors but **never rethrows**. Every caller (`checkpointToIDB`, `flushPersistQueue`, feedback writes) believes the save succeeded. `logPersistError` runs but has no effect because it never reaches the toast/status aggregation.
- **Impact:** IDB failures are invisible — user thinks data is saved locally when it is not. On refresh, stale IDB data wins over Firestore via `pickNewerProjectPayload` if the save counter was bumped but the write was silently lost.
- **Fix:** Either rethrow after logging (callers handle), or return `Promise<boolean>` so callers can surface failures to the status bar and toast.
- **Done when:** IDB save failures surface in `cloudSyncStatus` and the user sees a toast.

### P0.2 Snapshot suppression relies on timing, not versioning

- **File:** `src/useProjectPersistence.ts`
- **Problem:** The current implementation uses `isFlushingRef`, `loadFenceRef`, `saveCounterRef`, `hasPendingWrites`, and `clientId` to decide whether to apply incoming snapshots. This is an improvement over pure timeout-based suppression, but the reconciliation logic is complex and untested — no dedicated test file exists for `useProjectPersistence.ts`.
- **Impact:** Under network latency, a snapshot echo from the writer's own save can still race with in-flight local state. The complexity of the guard logic means future changes risk introducing regressions without test coverage.
- **Fix:** (a) Extract snapshot guard logic into pure functions (`shouldApplySnapshot(localState, snapshot) → boolean`) that can be unit-tested without React. (b) Add explicit write-version comparison where missing.
- **Done when:** Guard logic has dedicated tests covering: own-echo rejection, remote-user acceptance, latency simulation, partial chunk snapshots.

### P0.3 Inconsistent error handling across persistence paths

- **Files:** `src/App.tsx`, `src/AutoGroupPanel.tsx`, `src/GenerateTab.tsx`, `src/feedbackStorage.ts`, `src/GroupReviewSettings.tsx`
- **Problem:** Multiple persistence error handling patterns coexist:
  - `useProjectPersistence` → `reportPersistFailure` + toast (correct)
  - `feedbackStorage.ts` listener errors → `console.warn` only (no user visibility)
  - `GroupReviewSettings.tsx` → mixed `try/catch` with some silent swallows
  - `GenerateTab.tsx` → `reportPersistFailure` in some paths, `console.error` in others
  - `AutoGroupPanel.tsx` → Firestore `setDoc` for settings and summary cache with sparse error handling
- **Impact:** Users believe data is synced when silent failures hide desync.
- **Fix:** Audit every `setDoc`/`updateDoc`/`deleteDoc` call site. Replace silent catches with `reportPersistFailure`. Add `markListenerError`/`markListenerSnapshot` to every `onSnapshot` callback.
- **Done when:** No empty `.catch(() => {})` on persistence-critical operations; all save failures produce toasts.

### P0.4 Dual ref system in `useProjectPersistence.ts`

- **File:** `src/useProjectPersistence.ts`
- **Problem:** The hook maintains both a `latest` ref (single `useEffect` sync) **and** 14 parallel `refs` kept in sync via separate `useEffect` chains. This is a migration artifact. Both must be updated for every mutation, and they can desync if a developer updates one path but not the other.
- **Impact:** Stale ref → stale save → data loss. The parallel system doubles the surface area for the ref-before-save rule.
- **Fix:** Complete the migration: remove parallel refs, route all consumers through `latest`. Or collapse into one canonical ref object.
- **Done when:** Single ref system; no duplicate sync effects.

---

## P1 — Monolith Splits (Active Demand Paths)

### P1.1 Split `App.tsx` (7,457 lines → target ≤800)

**Current state:** `App.tsx` is a god-component mixing 8 distinct concerns:

| Concern | Approx. lines | Where it should live |
|---------|---------------|----------------------|
| Pure domain helpers (`buildGroupedClusterFromPages`, `mergeGroupedClustersByName`, `parseFilteredAutoGroupResponse`) | 156–388 | `src/groupedClusterBuilders.ts` |
| Presentational row components (`ClusterRow`, `TokenRow`, `GroupedClusterRow`, `KwRatingCell`) | 391–910 | `src/components/table/` |
| CSV import pipeline (`processCSV`, ~500 lines) | 1345–1843 | `src/hooks/useCSVImport.ts` |
| CSV/XLSX export (`exportCSV`, ~165 lines) | 1879–2043 | `src/exportWorkspace.ts` |
| Keyword rating orchestration (`runKeywordRating`, ~230 lines) | 2659–2885 | `src/hooks/useKeywordRatingJob.ts` |
| Auto-merge orchestration (`runAutoMergeRecommendations`, ~235 lines) | 3024–3258 | `src/hooks/useAutoMergeJob.ts` |
| Filtered auto-group orchestration (~300 lines) | 4455–4759 | `src/hooks/useFilteredAutoGroup.ts` |
| Group QA auto-review `useEffect` (~120 lines) | 4208–4330 | `src/hooks/useGroupReviewAutoProcessor.ts` |
| ~44 `useMemo` derived data chains | scattered | `src/hooks/useDerivedDatasets.ts` |
| Global keyboard shortcuts | 4762–4800 | `src/hooks/useGlobalShortcuts.ts` |

**Additional observations:**
- File starts with `eslint-disable react-hooks/exhaustive-deps` — masks missing dependency bugs across ~35 `useCallback` declarations.
- `handleLogin`/`handleLogout` at lines 1320–1321 are empty placeholder functions (dead code).
- `savedClusters` typed as `any[]` (line 1258); Firestore `data as any` (line 1300).
- Duplicate filter logic between `filteredClusters` and `filteredResultsData` (maintenance hazard).
- `runFilteredAutoGroupJob` dependency array includes `groupedClusters`, `clusterSummary`, `results` — broad deps recreate the callback often.

**Extraction order (recommended):**
1. Pure helpers → `groupedClusterBuilders.ts` (testable, no React deps, instant win)
2. Row components → `src/components/table/ClusterRow.tsx`, `GroupedClusterRow.tsx`, `TokenRow.tsx`
3. CSV import → `useCSVImport` hook
4. Export → `exportWorkspace.ts`
5. AI job hooks → `useKeywordRatingJob`, `useAutoMergeJob`, `useFilteredAutoGroup`
6. Group QA → `useGroupReviewAutoProcessor`
7. Derived data → `useDerivedDatasets` or multiple focused `useMemo` hooks
8. Keyboard shortcuts → `useGlobalShortcuts`
9. **Final pass:** App.tsx becomes composition shell (routing, provider wiring, layout)

**Done when:** `App.tsx` ≤ 1,200 lines (first pass), then ≤ 800 (follow-up).

### P1.2 Split `AutoGroupPanel.tsx` (4,211 lines → target ≤800)

**Current state:** ~280 lines of module-scope helpers, ~2,200 lines of hooks/logic, ~1,700 lines of JSX. Contains:

| Concern | What to extract |
|---------|-----------------|
| Settings + Firestore sync | `src/hooks/useAutoGroupSettings.ts` — `onSnapshot`, model list fetch, `saveAgSettings`, ~15 state vars |
| Cosine summary cache | `src/hooks/useCosineSummaryCache.ts` — serialize/deserialize, Firestore listener, two effects |
| Cosine pipeline execution | `src/hooks/useCosinePipeline.ts` — `handleRunCosine`, `generateCosineSummaries`, cosine QA, retry loop, ~20 state vars |
| Auto-group v1 assignment | `src/hooks/useAutoGroupAssignment.ts` — `runAssignmentBatch`, `handleRunAutoGroup`, cycle tracking |
| Auto-group QA | `src/hooks/useAutoGroupQA.ts` — `handleRunQA`, `handleRunAutoGroupQA`, mismatch removal |
| Reconciliation | `src/hooks/useReconciliation.ts` — `handleRunReconciliation`, recon state |
| Module helpers | `src/autoGroupNormalization.ts` — `rebuildAutoGroupSuggestionFromPages`, `normalizeAutoGroupSuggestions` |
| CSV export helpers | `src/csvExport.ts` — `escapeCsvCell`, `downloadCsvFile`, row builders |
| Cache key helpers | `src/cosineSummaryCache.ts` — `simpleHash`, `buildCosineSummaryCacheKey`, serialize/deserialize |
| Types | `src/types.ts` or `src/cosineTypes.ts` — `CosineResolvedGroup`, `CosineCycleResult`, `CosineLoopProgress`, `AutoGroupCycleSummary` |
| UI splits | `AutoGroupSettingsPanel`, `AutoGroupClustersTable`, `SuggestionsTable`, `CosineTestPanel` |

**Code smells found:**
- `eslint-disable react-hooks/exhaustive-deps` at file level (line 3)
- `handleApprove` (2317–2338) uses `qaResults` and `qaMismatchPages` but they are **missing from its dependency array** — stale closure bug
- `pipelineStats` state is initialized at line 497 but `setPipelineStats` is **never called** — dead/misleading UI showing permanent zeros
- `handleRunRetryLoop` is ~335 lines (1155–1489) — single largest function
- Mojibake/encoding corruption in comments around lines 1945–1946 and 2031–2032
- Potentially unused imports from `AutoGroupEngine` (dead code under `@typescript-eslint/no-unused-vars` disable)
- Duplicate QA orchestration: `handleRunCosineQA`, `reviewClusters`, `handleRunQA`, `handleRunAutoGroupQA` all call `processReviewQueue` with similar option shapes
- ~85–90 `useState` calls in one component

### P1.3 Split `GenerateTab.tsx` (2,291 lines → target ≤800)

**Current state:** `GenerateTabInstance` alone is ~1,880 lines mixing persistence, network I/O, generation queue, and UI.

| Concern | What to extract |
|---------|-----------------|
| Types | `GenerateRow`, `LogEntry`, `GenerateSettings`, `OpenRouterModel` → `src/generateTabTypes.ts` or `src/types.ts` |
| Pure helpers | `makeEmptyRows`, cache keys, `formatDateTime`, `parseSheetsPaste`, `formatElapsed`, `formatCost`, export builders → `src/generateTabUtils.ts` |
| OpenRouter API | `fetchModels`, `fetchBalance`, `generateForRow` → `src/openRouterGenerateClient.ts` |
| Persistence | Rows, logs, settings, viewState listeners + save → `src/hooks/useGenerateTabPersistence.ts` |
| Generation engine | Queue, `processNext`, `spawnWorkers`, abort, batched updates → `src/hooks/useGenerateBatch.ts` (or extend `generateEngine.ts`) |
| UI splits | `GenerateSettingsPanel`, `GenerateTable`, `GenerateLogTable`, `ModelDropdown` |

**Code smells found:**
- Line 1: `eslint-disable react-hooks/exhaustive-deps` — `handleGenerate` depends on many values but lists only `[settings, addLog]`
- Line 285 comment says "load from IDB" but persistence uses Firestore + localStorage (no IDB in this file) — misleading
- `generateForRow` is recreated every render (not `useCallback`) — noise and dependency reasoning hazard
- `(as any)` on token fields (~1388–1390) — type narrowing avoided with casts
- Filter chips use `bg-zinc-700 text-white` (dark-theme classes) while CLAUDE.md says light-theme only
- `starredLoadedRef` written in `onSnapshot` but never obviously gates writes — possibly dead code
- 22 `useEffect` hooks in `GenerateTabInstance` alone

### P1.4 Split `AutoGroupEngine.ts` (1,430 lines → target ≤800)

**Current state:** Mixes pure clustering/parsing (~800 lines) with network queue orchestration (~600 lines).

| Concern | What to extract |
|---------|-----------------|
| Clustering logic | `src/autoGroupClustering.ts` — `buildCascadingClusters`, `countCoveredPages`, token budget helpers |
| Prompt builders | `src/autoGroupPrompts.ts` — all `build*Prompt` functions, constants |
| Response parsers | `src/autoGroupParsers.ts` — all `parse*Response` functions |
| Queue orchestration | `src/autoGroupQueue.ts` — `processAutoGroupQueue`, `processReconciliation`, `processShortGroupAssignments` |

**Code smells:**
- Module-level mutable prompt overrides (`setAutoGroupPrompt`, `setReconciliationPrompt`) are global testability hazards
- `processShortGroupAssignments` has **no 429 retry loop** (unlike other queue processors)
- 429 retry + exponential backoff logic is copy-pasted from `GroupReviewEngine`/`KeywordRatingEngine`

### P1.5 Harden shared persistence boundary

- **Files:** `src/useProjectPersistence.ts`, `src/projectStorage.ts`
- **Problem:** Multiple save/load patterns coexist. `useProjectPersistence` has `mutateAndSave` + `checkpointToIDB` + `enqueueSave` + `flushPersistQueue`. But `bulkSet` can also call `saveProjectToFirestore` for `fileName` **outside** the serialized flush queue. `updateSuggestions` uses a 2s debounce (different from other mutations). The Generate tab, feedback, auto-group settings, and group review settings each roll their own save/load patterns.
- **Fix:** Define one write contract. All modules should follow identical save/snapshot semantics. Document the contract explicitly.
- **Done when:** No ad-hoc `setDoc` calls bypass the shared persistence contract.

---

## P2 — Duplication, Missing Abstractions, Oversized Components

### P2.1 Shared OpenRouter client

- **Files:** `AutoGroupEngine.ts`, `GroupReviewEngine.ts`, `KeywordRatingEngine.ts`, `AutoMergeEngine.ts`, `CosineEngine.ts`, `GenerateTab.tsx`, `AutoGroupPanel.tsx`
- **Problem:** Every engine independently implements:
  - `fetch('https://openrouter.ai/api/v1/chat/completions')` with headers
  - 429 retry with exponential backoff (copy-pasted, with inconsistencies)
  - Optional 60s timeout + `AbortController` composition
  - JSON extraction from model markdown/fenced code blocks
  - `openRouterBody` helper (duplicated between `KeywordRatingEngine` and `AutoMergeEngine`)
- **Inconsistencies:**
  - `processShortGroupAssignments` — **no retry at all**
  - `CosineEngine` embeddings — **no retry** (fail-fast on non-OK)
  - Timeout only in some `AutoGroupEngine` paths
- **Fix:** Create `src/openRouterClient.ts`:
  - `openRouterChatPost(body, signal, options)` — shared headers, 429 backoff, configurable timeout
  - `openRouterEmbed(body, signal, options)` — for embeddings
  - `parseJsonFromModel(content)` — shared JSON extraction (direct + markdown-fence + brace)
  - `OpenRouterUsage` type + `parseOpenRouterUsage` (currently split between engines)
- **Impact:** ~200 lines of duplicated retry/fetch logic eliminated; consistent error handling; single place to add telemetry, circuit breaking, or rate limit policy.

### P2.2 Shared OpenRouter model selector

- **Files:** `src/ModelSelector.tsx`, `src/GroupReviewSettings.tsx`, `src/AutoGroupPanel.tsx`, `src/GenerateTab.tsx`
- **Problem:** Three independent implementations of model-list fetching, searching, sorting, and star toggling:
  1. `ModelSelector.tsx` — shared component but only used by Generate tab
  2. `GroupReviewSettings.tsx` — internal `ModelPicker` component (~200 lines) reimplements the same UX
  3. `AutoGroupPanel.tsx` — inline model dropdown with `agModels`, `agModelSearch`, `agModelsLoading` state
- **Fix:** Create `src/hooks/useOpenRouterModels.ts` (fetch + cache + star sync) and extend `ModelSelector` to be the universal dropdown. Delete internal `ModelPicker` from `GroupReviewSettings`.
- **Impact:** ~400 lines of duplicate model UI logic removed; consistent model UX across all features.

### P2.3 `GroupReviewSettings.tsx` (835 lines → target ≤400)

- **Problem:** Contains three distinct settings sections (group review, keyword rating, auto merge), each with its own model picker, prompt editor, and Firestore sync. Also contains `HelpLabel` sub-component.
- **Fix:** Split into `GroupReviewModelSection`, `KeywordRatingSettingsSection`, `AutoMergeSettingsSection`, plus `useGroupReviewSettingsSync` hook.
- **Code smell:** `(m: any)` when mapping OpenRouter models — replace with typed mapper.

### P2.4 `AppStatusBar.tsx` (541 lines → target ≤400)

- **Problem:** The "status bar" is also a full weather widget: geolocation, Open-Meteo fetch, daily/hourly parsing, 7-day forecast tooltips. This is a cohesion break — weather is not "app status."
- **Fix:** Extract `src/hooks/useWeather.ts` (geolocation + Open-Meteo fetch + parsing) and `src/WeatherStatusChip.tsx` (display). Keep cloud sync line in `AppStatusBar`.

### P2.5 `FeedbackModal.tsx` (606 lines → target ≤400)

- **Problem:** Large form component combining issue fields, feature fields, attachments, and submit logic.
- **Fix:** Extract `FeedbackIssueFields`, `FeedbackFeatureFields`, `FeedbackAttachments` sub-components, and move submit logic to a `useSubmitFeedback` hook.

### P2.6 IDB connection reuse

- **File:** `src/projectStorage.ts`
- **Problem:** `openIDB()` creates a new connection on every call. Long sessions accumulate connections.
- **Fix:** Add connection pooling or reuse a single cached connection with health checks.

### P2.7 Cache bounds for text-processing helpers

- **File:** `src/processing.ts`
- **Problem:** Stemming and normalization caches are unbounded. In long sessions with large datasets, memory grows monotonically.
- **Fix:** Add bounded LRU caches (e.g., max 10,000 entries) to `stem()` and other cached functions.

### P2.8 `FeedbackTab.tsx` (421 lines → target ≤400)

- **Problem:** Barely over limit but combines data loading, table rendering, and queue reorder logic.
- **Fix:** Extract table row component and/or data-loading hook.

### P2.9 Remove dead code from `App.tsx`

- **Problem:** `handleLogin`/`handleLogout` are empty async stubs (lines 1320–1321). `savedClusters` typed as `any[]`. Various `(data as any)` casts.
- **Fix:** Remove stubs; type `savedClusters` properly; replace `any` casts with proper type guards.

### P2.10 Fix dark-theme class leaks

- **Files:** `src/GenerateTab.tsx`, `src/ModelSelector.tsx`
- **Problem:** Filter chips use `bg-zinc-700 text-white`; model sort toggle uses similar dark classes. CLAUDE.md mandates light-theme only.
- **Fix:** Replace with light-theme equivalents matching existing design patterns.

---

## P3 — Test Coverage Debt

### P3.1 Critical untested modules

| Module | Lines | Why it matters | What to test |
|--------|-------|----------------|--------------|
| `useProjectPersistence.ts` | 1,119 | Central persistence — every save/load goes through here | Snapshot guard logic, save ordering, ref-before-save enforcement, echo rejection, partial chunk handling |
| `processing.ts` | 392 | CSV pipeline — CLAUDE.md says "never reorder without understanding" | Full pipeline end-to-end, edge cases per step, empty input, malformed CSV |
| `appRouting.ts` | 131 | URL ↔ tab mapping; broken URLs = broken bookmarks | Table-driven tests for all path patterns, legacy URL canonicalization |
| `projectUrlKey.ts` | 31 | URL slug generation | Slugify edge cases, hash stability, special characters |
| `feedbackStorage.ts` | 232 | Feedback Firestore + IDB + image uploads | `mapDoc` parsing, priority logic, error paths |
| `useKeywordWorkspace.ts` | 169 | Workspace state management | Filter composition, tab switching, state reset |
| `useGroupingActions.ts` | 203 | Grouping UX + aggregation | `recalcGroupStats` math, approve/unapprove flows |
| `useNavigationState.ts` | 146 | Tab/URL sync | Legacy URL canonicalization, popstate handling |

### P3.2 Thin test files (need expansion)

| Test file | Current tests | What's missing |
|-----------|---------------|----------------|
| `groupReviewEngine.test.ts` | 5 (one helper only) | `processReviewQueue`, `reviewSingleGroup` with mocked fetch, retry behavior |
| `cosineEngine.test.ts` | 3 | Embedding fetch path, larger graph clustering, error handling |
| `AppStatusBar.test.tsx` | 1 | Weather fetch, cloud status integration, error states |
| `weatherCodes.test.ts` | 1 | Boundary codes, unknown codes |
| `weatherInsights.test.ts` | 2 | Empty series, malformed times |
| `useTokenActions.test.ts` | 2 | `handleBlockSingleToken`, `handleBlockTokens` |
| `csvImportProjectScope.test.ts` | 3 | Full CSV parsing pipeline integration |
| `useProjectLifecycle.actions.test.ts` | 3 | `createProject`, URL sync, listener behavior |

### P3.3 Fix excluded test files

- **Files:** `src/approvedGroups.test.ts`, `src/uiStructure.test.ts`
- **Problem:** These files are **excluded from Vitest** in `vitest.config.ts`. They use custom `assert` functions and `runTests()` patterns, not Vitest `describe`/`it`. They duplicate logic from `App.tsx` rather than importing it.
- **Impact:** They don't run in CI (`npm test`). The duplicated logic can drift from the real implementation.
- **Fix:** Rewrite as standard Vitest tests that import from the actual source modules. Remove from vitest exclude list.

### P3.4 Integration test gaps

| Area | What exists | What's missing |
|------|-------------|----------------|
| **Shared projects** | `App.shared-projects.integration.test.tsx` (5 tests, mocked Firestore) | Real Firestore integration |
| **CSV import E2E** | `csvImportProjectScope.test.ts` (project mismatch only) | File → parse → rows → save full pipeline |
| **Persistence round-trip** | `projectStorage.test.ts` (chunk merge, payload choice) | `useProjectPersistence` hook-level: save ordering, concurrent edits, ref-before-save |
| **Generate tab** | `generateEngine.test.ts` (engine only, strong) | Tab instance: persistence, settings sync, generation queue |
| **Auto-group** | `autoGroup.test.ts` (parsers/clustering, strong) | Queue orchestration with mocked fetch |
| **Group review** | `groupReviewEngine.test.ts` (one helper) | Full review queue with mocked fetch |
| **UI tabs/panels** | Sparse | Most tabs have zero component tests |

### P3.5 ARIA and accessibility

- **Files:** `MergeConfirmModal.tsx`, `AutoGroupPanel.tsx`, `GenerateTab.tsx`
- **Problem:** Modal focus trap and ARIA attributes are inconsistent. `MergeConfirmModal` may not properly trap focus. Some interactive elements lack ARIA labels.
- **Fix:** Add modal focus trap, `role="dialog"`, `aria-modal`, and keyboard navigation where missing.

---

## P4 — Architecture & Future-Proofing

### P4.1 Formalize the persistence contract

- **Problem:** Five distinct persistence patterns coexist:
  1. **Project data:** `useProjectPersistence` → `mutateAndSave` → IDB checkpoint + queued Firestore flush
  2. **Project metadata:** Direct `saveProjectToFirestore` (sometimes from `bulkSet`, outside the queue)
  3. **App preferences:** `saveAppPrefsToFirestore` + `saveAppPrefsToIDB` (parallel, not queued)
  4. **Generate tab:** `onSnapshot` + `setDoc` with debounced timers + localStorage cache (no IDB)
  5. **Feedback:** `addFeedback` → direct `addDoc` + IDB mirror
- **Inconsistencies:**
  - Generate tab doesn't use IDB at all (uses localStorage as cache)
  - Feedback uses `console.warn` for listener errors (no `reportPersistFailure`)
  - Auto-group settings in `AutoGroupPanel` use direct `setDoc` without shared error handling
  - Group review settings in `GroupReviewSettings` have their own Firestore sync loop
- **Fix:** Document a persistence architecture diagram with clear boundaries. Decide whether non-project data should eventually migrate to the queued pattern.

### P4.2 Extract `useEffect` dependency tracking from `eslint-disable`

- **Files:** `App.tsx`, `AutoGroupPanel.tsx`, `GenerateTab.tsx`
- **Problem:** All three mega-files start with `eslint-disable react-hooks/exhaustive-deps`. This masks genuine missing-dependency bugs. The `handleApprove` stale closure in `AutoGroupPanel` is a confirmed example.
- **Fix:** As files are split into focused hooks, re-enable the lint rule per-file. Fix genuine missing deps; add explicit `// eslint-disable-next-line` with justification comments for intentional omissions.

### P4.3 Type safety improvements

| Location | Issue | Fix |
|----------|-------|-----|
| `App.tsx:1258` | `savedClusters: any[]` | Type as `SavedCluster[]` with proper interface |
| `App.tsx:1300` | `data as any` | Add Firestore document type guard |
| `ModelSelector.tsx:71-72` | `(m: any)` in model mapping | Create `OpenRouterModelResponse` type |
| `GroupReviewSettings.tsx` | `(m: any)` in model fetch | Same shared type |
| `GenerateTab.tsx:1388-1390` | `(as any)` on token fields | Narrow types properly |
| `useTokenActions.ts` | `action: any` in `logAndToast` | Union type for action |

### P4.4 `dictionaries.ts` — data vs code separation

- **File:** `src/dictionaries.ts` (832 lines)
- **Problem:** Large data maps (synonyms, misspellings, stop words, geo sets) make the file unwieldy and noisy in code review.
- **Fix:** Move data to JSON files or split into `synonyms.ts`, `stopWords.ts`, `geoSets.ts`. Keep the file under 800 lines.
- **Priority:** Low — mostly data, not logic. Only worth doing if the file continues to grow.

---

## Cross-Cutting Patterns Found

### Duplicate patterns that should be consolidated

| Pattern | Where duplicated | Consolidation target |
|---------|------------------|----------------------|
| OpenRouter chat `fetch` + headers + 429 backoff | 6 engines + 2 components | `openRouterClient.ts` |
| JSON extraction from model markdown | `AutoGroupEngine`, `GroupReviewEngine`, `AutoMergeEngine`, `KeywordRatingEngine` | `parseJsonFromModel()` in `openRouterClient.ts` |
| Model list fetch + search + sort + star | `ModelSelector`, `GroupReviewSettings`, `AutoGroupPanel` | `useOpenRouterModels` + shared `ModelDropdown` |
| Firestore `onSnapshot` + error callback | 15+ listener sites | Already partially consolidated via `cloudSyncStatus`; ensure all listeners use it |
| `openRouterBody` helper | `KeywordRatingEngine`, `AutoMergeEngine` | Single export |
| `addOpenRouterUsage` / `addAutoMergeUsage` | `KeywordRatingEngine`, `AutoMergeEngine` | Remove alias; use one function |
| `escapeCsvCell` + `downloadCsvFile` | `AutoGroupPanel`, `App.tsx` export logic | `src/csvExport.ts` |
| Elapsed time interval pattern | `App.tsx` (rating, merge), `AutoGroupPanel` (run, recon), `GenerateTab` (timer) | `useElapsedTimer(isRunning)` hook |
| Abort controller + cleanup | Every AI job | Standardize with shared `useAbortableJob` pattern |

---

## Execution Sequence (Recommended)

### Sprint 1: Stabilization (P0)
1. Fix `saveToIDB` error swallowing (P0.1)
2. Extract snapshot guard logic to testable pure functions (P0.2)
3. Audit and fix all silent persistence error catches (P0.3)
4. Consolidate dual ref system (P0.4)
5. Run multi-tab concurrency verification after each item

### Sprint 2: Extract shared infrastructure (P1.5 + P2.1–P2.2)
1. Create `openRouterClient.ts` (P2.1)
2. Create `useOpenRouterModels` + extend `ModelSelector` (P2.2)
3. Harden persistence boundary contract (P1.5)
4. These unblock the monolith splits by providing shared dependencies

### Sprint 3: App.tsx split (P1.1)
1. Extract pure helpers → `groupedClusterBuilders.ts`
2. Extract row components → `src/components/table/`
3. Extract CSV import → `useCSVImport`
4. Extract export → `exportWorkspace.ts`
5. Extract AI job hooks
6. Extract derived data hooks
7. Extract keyboard shortcuts
8. Target: App.tsx ≤ 1,200 lines

### Sprint 4: AutoGroupPanel split (P1.2)
1. Extract settings hook
2. Extract cosine pipeline hook
3. Extract assignment hook
4. Extract QA hook
5. Extract reconciliation hook
6. Split UI into sub-panels
7. Target: AutoGroupPanel.tsx ≤ 1,200 lines

### Sprint 5: GenerateTab + Engine splits (P1.3 + P1.4)
1. Split GenerateTab persistence, queue, and UI
2. Split AutoGroupEngine into clustering, prompts, parsers, queue
3. Target: both ≤ 800 lines

### Sprint 6: Component splits + polish (P2.3–P2.10)
1. GroupReviewSettings split
2. AppStatusBar weather extraction
3. FeedbackModal split
4. Dark-theme class fixes
5. Dead code removal

### Sprint 7: Test debt (P3)
1. `useProjectPersistence` test suite
2. `processing.ts` pipeline tests
3. `appRouting.ts` + `projectUrlKey.ts` tests
4. Expand thin test files
5. Fix excluded test files
6. Integration test expansion

---

## Mandatory Verification For Every Refactor PR

- `npx tsc --noEmit`
- `npx vitest run`
- `npx vite build`
- Two-client same-project sync test for any persistence-touching change
- Reload-mid-operation test (especially auto-group/generate flows)
- Feature-quality-gate SKILL.md §§1–6

---

## Metrics to Track

| Metric | Baseline | Target (Sprint 3) | Target (Final) |
|--------|---------|-------------------|----------------|
| `App.tsx` lines | 7,457 | ≤ 1,200 | ≤ 800 |
| `AutoGroupPanel.tsx` lines | 4,211 | 4,211 | ≤ 800 |
| `GenerateTab.tsx` lines | 2,291 | 2,291 | ≤ 800 |
| `AutoGroupEngine.ts` lines | 1,430 | 1,430 | ≤ 800 |
| Files over component limit (400) | 7 | 5 | 0 |
| Files over utility limit (800) | 5 | 3 | 0 |
| Modules with zero test coverage | ~12 | ~6 | ~2 |
| `eslint-disable` file-level suppressions | 3 | 2 | 0 |
| `any` type usage in core modules | ~10+ | ~5 | 0 |

---

*Tracker refreshed: 2026-03-31*
*Detailed extraction baseline and line references below remain from the 2026-03-27 audit pass.*
*Audit scope for that baseline: Full line-by-line analysis of all 89 `.ts` and 34 `.tsx` source files*
