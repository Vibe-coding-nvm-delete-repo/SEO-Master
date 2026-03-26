# REFACTOR_PLAN.md — Current Priority Plan (2026-03-26)

This plan updates refactor priorities based on current product demand:
- real-time multi-user correctness is non-negotiable
- rapid iteration in Feedback + Auto-Group + Generate must stay safe
- monolith file size is currently blocking safe feature delivery

## Prioritization Model

Use this scoring for all work:
- **P0 (Blocker):** Data integrity / cross-user sync correctness
- **P1 (High):** Refactors that directly reduce risk in actively changing flows
- **P2 (Medium):** Structural cleanup that improves velocity but is not blocking today
- **P3 (Low):** DX/polish optimizations after core risk is reduced

No P2/P3 work ships before all active P0 items are closed.

---

## Current Baseline (Measured)

- `src/App.tsx`: 6217 lines
- `src/AutoGroupPanel.tsx`: 3867 lines
- `src/GenerateTab.tsx`: 1852 lines
- `src/AutoGroupEngine.ts`: 1203 lines
- `src/useProjectPersistence.ts`: 840 lines
- `src/projectStorage.ts`: 672 lines
- `src/GroupReviewSettings.tsx`: 457 lines

Implication: risk is now concentrated in persistence/sync logic and giant orchestration files touched by recent feature demand.

---

## P0 — Data Integrity + Multi-User Sync (Do First)

These items are required before new heavy feature pushes in Auto-Group/Generate/Feedback.

### P0.1 Eliminate stale-save paths in `App.tsx` handlers
- **Files:** `src/App.tsx`, `src/useProjectPersistence.ts`
- **Scope:**
  - Remove direct `setState` + later save patterns where persistence reads stale refs
  - Route state mutations through one atomic persistence path (`bulkSet`/equivalent)
  - Ensure "ref-before-save" at every save boundary
- **Why now:** most severe current risk is user A changes not visible to user B or overwritten on echo snapshots
- **Done when:**
  - no handler writes persistence data from stale closure state
  - all mutation paths either (a) sync refs first or (b) pass full next state directly
  - multi-tab same-project tests show no dropped approve/group/token changes

### P0.2 Replace timeout-based snapshot suppression
- **Files:** `src/useProjectPersistence.ts`, `src/projectStorage.ts` (metadata fields if needed)
- **Scope:**
  - remove fixed-delay unsuppress behavior
  - introduce write-version/write-timestamp compare in snapshot apply path
  - accept only strictly newer remote snapshots than local last write marker
- **Why now:** current timing gap can overwrite in-flight local state under latency
- **Done when:**
  - snapshot echo from own write is always ignored safely
  - remote writes from other users still apply immediately
  - simulated latency tests pass (slow network + concurrent edits)

### P0.3 Standardize Firestore/IDB failure surfacing
- **Files:** `src/App.tsx`, `src/AutoGroupPanel.tsx`, `src/GenerateTab.tsx`, `src/projectWorkspace.ts`, `src/GroupReviewSettings.tsx`
- **Scope:**
  - replace silent catches with shared persistence error helper
  - emit user-visible toast for sync-critical failures
  - include operation context in console logging
- **Why now:** silent failures create false-success UX and hidden desync
- **Done when:**
  - no empty `.catch(() => {})` on persistence-critical operations
  - save failures are visible to users and logs identify failed operation

### P0.4 Isolate/merge independent settings sync paths
- **Files:** `src/GroupReviewSettings.tsx`, `src/useProjectPersistence.ts`
- **Scope:**
  - either move GroupReviewSettings writes under main persistence pipeline
  - or apply identical suppress/version rules in its local listener+writer loop
- **Why now:** mixed sync models increase race conditions
- **Done when:**
  - settings writes from two clients converge deterministically
  - no "backfill write overwrote concurrent edit" cases

---

## P1 — Risk-Reducing Structural Refactor (Active Demand Paths)

Do immediately after P0, in this order.

### P1.1 Split `App.tsx` by domain ownership (highest impact)
- **Current pain:** every Group + Feedback + route/persistence change lands in one file
- **Extraction order:**
  1. `useProjectLifecycle` (project create/select/delete/load)
  2. `useKeywordWorkspace` (filter/sort/pagination/search/selection)
  3. `useGroupingActions` (group/ungroup/approve/unapprove)
  4. `useTokenActions` (block/unblock/merge/unmerge)
  5. `useNavigationState` (main tab + sub-tab + URL sync)
  6. `GroupDataView` component (data tab rendering + controls)
- **Target:** reduce `App.tsx` to orchestration shell only (target <= 1200 first pass, <= 800 follow-up)
- **Done when:** domain hooks own logic; `App.tsx` primarily composes providers, routing, and top-level layout

### P1.2 Split `AutoGroupPanel.tsx` into pipeline + views
- **Current demand alignment:** Auto-group and duplicate-reconciliation are active pressure areas
- **Extraction order:**
  1. `useAutoGroupSettings` (model/api/concurrency/prompt)
  2. `useAutoGroupExecution` (run/cancel/progress/errors)
  3. `useSuggestionReview` (approve/dismiss/bulk/actions)
  4. `AutoGroupToolbar`, `SuggestionTable`, `DuplicateCandidatesPanel`, `CosineStagePanel`
- **Target:** `AutoGroupPanel.tsx` <= 1200 first pass, then <= 800
- **Done when:** duplicate-reconciliation and QA features can be changed without touching orchestration internals

### P1.3 Split `GenerateTab.tsx` by persistence vs execution vs UI
- **Current demand alignment:** Generate 1/2 parity, model UX, and throughput are active
- **Extraction order:**
  1. `useGeneratePersistence` (rows/logs/settings load/save)
  2. `useGenerationQueue` (concurrency/retry/abort/status transitions)
  3. `GenerateSettingsPanel`, `GenerateTable`, `GenerateLogPanel`
- **Target:** `GenerateTab.tsx` <= 900 first pass
- **Done when:** tab-specific behavior can evolve without editing large mixed concerns

### P1.4 Harden shared persistence boundary
- **Files:** `src/useProjectPersistence.ts`, `src/projectStorage.ts`
- **Scope:**
  - define one write contract for all domain modules
  - make save queue semantics explicit (coalescing, ordering, conflict policy)
  - expose testable invariants (latest write wins by save marker)
- **Done when:** all feature modules call the same persistence API contract

---

## P2 — Performance + Reuse Refactors

### P2.1 Shared model selector usage
- **Files:** `src/ModelSelector.tsx`, `src/GroupReviewSettings.tsx`, `src/GenerateTab.tsx`, `src/AutoGroupPanel.tsx`
- Consolidate model dropdown rendering/search/sort/star behavior
- Remove duplicated formatting/sorting logic

### P2.2 Shared retry + request wrapper
- **Files:** `src/GenerateTab.tsx`, `src/AutoGroupEngine.ts`, related API helpers
- Extract one retry/backoff helper with typed policies and telemetry hooks

### P2.3 IDB connection reuse and safer chunk cleanup
- **Files:** `src/projectStorage.ts`
- Add DB connection reuse and post-write cleanup validation pass

### P2.4 Cache bounds for text-processing helpers
- **Files:** `src/processing.ts`
- Add bounded caches to avoid unbounded long-session memory growth

---

## P3 — Test and Accessibility Debt

- Add UI tests for critical controls in `ModelSelector`, `SettingsControls`, `GroupReviewSettings`, `AutoGroupPanel`, `GenerateTab`
- Add modal focus trap and ARIA improvements where missing
- Add invariant tests for persistence conflict resolution scenarios

---

## Execution Sequence (Recommended)

1. **Stabilization sprint (P0 only)**
   - close all P0 items
   - run multi-tab concurrency verification after each item
2. **Monolith risk sprint (P1.1 + P1.2)**
   - split `App.tsx` and `AutoGroupPanel.tsx` first
3. **Generate isolation sprint (P1.3 + P1.4)**
   - complete shared persistence boundary and Generate split
4. **Reuse/perf sprint (P2)**
5. **Quality sprint (P3)**

---

## Mandatory Verification For Every Refactor PR

- `npx tsc --noEmit`
- `npx vitest run`
- `npx vite build`
- two-client same-project sync test for any persistence-touching change
- reload-mid-operation test (especially auto-group/generate flows)

---

## Out Of Scope For This Plan

- new feature ideation details (tracked in `FEATURES.md`)
- cosmetic UI restyling unrelated to correctness or maintainability

