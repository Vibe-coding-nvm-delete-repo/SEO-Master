# FIXES.md — Prioritized Bug & Refactor Tracker

> **Rule:** Map everything first, execute sequentially. Check off items as completed.
> After each fix: `npx tsc --noEmit && npx vitest run && npx vite build`
> Use [`REFACTOR_ANALYSIS.md`](./REFACTOR_ANALYSIS.md) for the current repo-wide ranking of refactor opportunities.
> Use [`REFACTOR_PLAN.md`](./REFACTOR_PLAN.md) for the structured refactor program.
> Use this file for tactical bug fixes, confirmed failure modes, and concrete follow-up items.

---

## Tier 1 — DATA INTEGRITY (data loss / multi-user sync failures)

These are "the building is on fire" bugs. Every piece of user state must be visible to ALL users instantly via Firestore. No data can ever be siloed to just one browser.

### [ ] 1.1 Redundant double/triple setState in processCSV
**File:** `src/App.tsx` ~lines 1661-1707
**Problem:** `setResults()`, `setClusterSummary()`, etc. are called BEFORE `persistence.bulkSet()` (lines 1661-1666), then `persistence.bulkSet()` is called (line 1687) which internally syncs refs AND calls setState again, then MORE direct setters fire (lines 1690-1707). This causes triple renders and wasted work.
**Severity note:** Verified that `persistence.bulkSet()` DOES sync `latest.current` before saving, so Firestore gets correct data. The direct setState calls at lines 1661-1666 are redundant, not data-losing — but they cause unnecessary re-renders and could confuse future developers into thinking the pattern is "setState then bulkSet."
**Scenario:** Triple render on every CSV upload. Not a data loss bug per se, but a correctness/performance issue that makes the codebase misleading about the right pattern.
**Fix:** Remove direct setState calls at lines 1661-1666 and 1690-1707. Let `persistence.bulkSet()` handle all state + ref sync + Firestore save atomically. Pass stats/datasetStats through bulkSet too.

### [ ] 1.2 Ref-before-save violations in handleRemoveFromApproved (CRITICAL)
**File:** `src/App.tsx` ~lines 2943-2971
**Problem:** `setClusterSummary(newClusters)`, `setResults(...)`, `setGroupedClusters(updatedGrouped)`, `setApprovedGroups(newApproved)` called WITHOUT ref sync, then `persistence.bulkSet()` at line 2971 reads stale `latest.current`. Unlike 1.1, here `bulkSet()` does NOT receive all the changed data — it only gets the fields passed to it, and reads everything else from `latest.current` which is stale.
**Scenario:** User 1 unapproves a group. Firestore saves stale approvedGroups (ref wasn't updated). User 2 still sees it as approved. This is a **confirmed data loss bug**.
**Fix:** Option A (preferred): Remove direct setters entirely, pass ALL changed fields to `persistence.bulkSet()`:
```typescript
persistence.bulkSet({
  groupedClusters: updatedGrouped,
  approvedGroups: newApproved,
  clusterSummary: nextClusters,
  results: [...results, ...newRows]
});
```
Option B: Sync refs manually before bulkSet:
```typescript
approvedGroupsRef.current = newApproved;
groupedClustersRef.current = updatedGrouped;
clusterSummaryRef.current = nextClusters;
resultsRef.current = [...results, ...newRows];
persistence.bulkSet({ groupedClusters: updatedGrouped, approvedGroups: newApproved, clusterSummary: nextClusters });
```

### [ ] 1.3 startTransition wrapping persistence-critical state (Token Merge) (CRITICAL)
**File:** `src/App.tsx` ~lines 2736-2757
**Problem:** `startTransition()` wraps `setResults()`, `setClusterSummary()`, `setGroupedClusters()`, `setApprovedGroups()`, `setTokenSummary()`, `setTokenMergeRules()` at lines 2736-2745. React treats these as low-priority — refs may not sync for several render cycles. Then `persistence.applyMergeCascade(cascade, newRule)` is called at line 2757 OUTSIDE the transition block. The persistence call reads `latest.current` which still has pre-merge data because the deferred setState hasn't triggered the ref-sync useEffects yet.
**Scenario:** User merges tokens. `startTransition` defers state updates. `persistence.applyMergeCascade()` fires immediately with stale refs. Firestore saves pre-merge data. Second user never sees the merge. Even worse: if User 1 does anything else (group, approve), those actions also use stale refs until React eventually processes the deferred transition.
**Fix:** Don't use `startTransition` for state that must persist. Call persistence FIRST (it syncs refs internally), then let setState propagate to UI:
```typescript
// Persistence call first — syncs refs + saves to Firestore
persistence.applyMergeCascade(cascade, newRule);
// UI updates can be deferred safely AFTER persistence
startTransition(() => {
  setSelectedMgmtTokens(new Set());
  if (filterChanged) setSelectedTokens(newSelectedTokens);
});
```

### [ ] 1.4 suppressSnapshotRef timing gap (fragile 1000ms timeout)
**File:** `src/useProjectPersistence.ts` — `enqueueSave()` ~line 291 and ~line 305
**Problem:** `enqueueSave()` correctly sets `suppressSnapshotRef.current = true` at line 291 BEFORE calling `saveProjectDataToFirestore()`. However, it resets to `false` after a **hardcoded 1000ms setTimeout** at line 305. If the Firestore snapshot echo takes longer than 1 second (slow network, large dataset, cold start), the suppress flag is already false when the snapshot arrives → listener processes it → overwrites in-flight UI changes.
**Scenario:** User on slow 3G connection groups page X. Save fires, suppress set to true. Firestore write takes 2 seconds. At T=1s, suppress resets to false. At T=2s, snapshot echo arrives with the save's data. But user grouped page Y at T=1.5s. Listener sees `suppressSnapshotRef = false`, applies snapshot, page Y grouping lost.
**Fix:** Replace the fixed 1000ms timeout with write-timestamp tracking. Include a `lastWriteTimestamp` in the Firestore meta doc. In the `onSnapshot` listener, compare the snapshot's timestamp against the last known write timestamp. Only apply the snapshot if it's newer than our last write. This is more reliable than any fixed timeout:
```typescript
// In enqueueSave:
const writeTimestamp = Date.now();
lastWriteTimestampRef.current = writeTimestamp;
suppressSnapshotRef.current = true;
await saveProjectDataToFirestore(..., writeTimestamp);
// In onSnapshot:
const snapshotTimestamp = data.meta?.lastWriteTimestamp || 0;
if (snapshotTimestamp <= lastWriteTimestampRef.current) {
  suppressSnapshotRef.current = false; // Our own echo, safe to unsuppress
  return; // Skip applying — we already have this data
}
suppressSnapshotRef.current = false;
applyViewState(data); // Truly remote change, apply it
```

### [ ] 1.5 GroupReviewSettings writes without suppressSnapshotRef
**File:** `src/GroupReviewSettings.tsx` ~lines 146-149 and 183-186
**Problem:** This component has its own independent Firestore sync (not using the persistence hook). Two `setDoc()` calls — one for saving settings, one for backfill inside `onSnapshot` — neither sets `suppressSnapshotRef`. The backfill write inside the listener can overwrite a concurrent user's changes.
**Scenario:** User A changes temperature to 0.5 and saves. Before the snapshot echoes back, User B changes concurrency. The backfill write from User A's snapshot overwrites User B's concurrency change.
**Fix:** Either:
  - (a) Add a local `suppressRef` to this component following the same pattern, OR
  - (b) Consolidate shared settings into the main persistence layer (preferred long-term)

### [ ] 1.6 Universal blocked tokens race condition
**File:** `src/App.tsx` ~lines 951-972
**Problem:** `universalBlockedTokens` is loaded from Firestore via `onSnapshot` and stored as a `Set`. When User A blocks a token, User B's snapshot fires and replaces the ENTIRE Set. If User B had pending local changes (blocked a different token, save not yet committed), those changes are wiped.
**Scenario:** User A blocks "cheap". User B blocks "free" at the same moment. User A's snapshot fires on User B's client, replacing the Set with just {"cheap"}. User B's "free" block is lost.
**Fix:** Use the same `suppressSnapshotRef` + ref-before-save pattern. Or switch to Firestore `arrayUnion`/`arrayRemove` for atomic token additions/removals instead of overwriting the full array.

### [ ] 1.7 Silent Firestore save failures (systematic — 17 instances)
**Complete list of every silent `.catch(() => {})` on Firestore/IDB operations:**
1. `src/App.tsx:808` — starred_models setDoc
2. `src/App.tsx:958` — universal_blocked setDoc
3. `src/App.tsx:1060` — saveAppPrefsToFirestore
4. `src/App.tsx:1061` — saveAppPrefsToIDB
5. `src/App.tsx:3720` — project name update setDoc
6. `src/App.tsx:5241` — project name update setDoc
7. `src/AutoGroupPanel.tsx:350` — auto-group settings save
8. `src/AutoGroupPanel.tsx:393` — fetch models call
9. `src/AutoGroupPanel.tsx:655` — cosine summaries save
10. `src/GenerateTab.tsx:408` — generate logs save
11. `src/GenerateTab.tsx:718` — generate rows save
12. `src/GenerateTab.tsx:731` — generate logs flush
13. `src/GenerateTab.tsx:1921` — starred_models setDoc
14. `src/GenerateTab.tsx:1932` — active tab save
15. `src/TableHeader.tsx:104` — column width save
16. `src/projectWorkspace.ts:95` — IDB save
17. `src/projectWorkspace.ts:120` — IDB save

**Also semi-silent (console.warn/error only, no UI feedback):**
- `src/GenerateTab.tsx:342, 349, 354, 633` — `.catch(console.warn)`
- `src/GroupReviewSettings.tsx:149, 186` — `.catch(console.warn)`
- `src/App.tsx:1181` — saveProjectToFirestore `.catch(console.error)`

**Note:** `src/useProjectPersistence.ts` at line 299-301 DOES have proper error handling with `addToast('Save failed...')` — this is the correct pattern to follow.

**Problem:** User makes changes, sees success in UI, but Firestore save silently fails. Data exists only in memory. Second user never sees the changes. If browser crashes, data lost entirely.
**Fix:** Create a shared helper and apply to all 17+ locations:
```typescript
function firestoreSave(promise: Promise<void>, context: string, addToast: Function) {
  return promise.catch(err => {
    console.error(`Firestore save failed (${context}):`, err);
    addToast(`Failed to save ${context}. Changes may not sync to other users.`, 'error');
  });
}
```

### [ ] 1.8 Stale closure in scheduled re-review timer
**File:** `src/App.tsx` ~lines 2658-2692
**Problem:** `scheduleReReview()` stores group IDs in a ref and reads `groupedClustersRef.current` 5 seconds later. If the user modifies those groups during the 5s window, the timer rebuilds groups with wrong page memberships.
**Scenario:** User removes page X from group A at T=0 (triggers re-review). User adds page Y to group A at T=2s. Timer fires at T=5s, reads current `groupedClustersRef` which now has page Y. Re-review runs on wrong group composition.
**Fix:** Capture the full group snapshot when scheduling, not just IDs. The re-review should operate on the group state that triggered it.

---

## Tier 2 — CORRECTNESS (bugs that produce wrong results)

### [ ] 2.1 `||` vs `??` in reconciliation response parsing
**File:** `src/AutoGroupEngine.ts` ~line 1126
**Problem:** `const checkIdx = (dup.checkIdx || 0) - 1;` — if API returns `checkIdx: 0`, the `||` operator treats 0 as falsy → `(0 || 0) - 1 = -1`. A bounds check at line ~1130 (`if (checkIdx < 0 ... continue`) catches this and skips the entry, so it doesn't crash — but it silently drops valid reconciliation candidates where the first group (index 0) is involved.
**Fix:** Use nullish coalescing: `const checkIdx = (dup.checkIdx ?? 0) - 1;`. The existing bounds check stays as a safety net.

### [ ] 2.2 CosineEngine token overlap false skip
**File:** `src/CosineEngine.ts` ~lines 193-208
**Problem:** Pages with empty `tokenArr` will never have `sharesToken = true`, causing valid cosine pairs to be silently skipped. The optimization assumes all pages have tokens.
**Fix:** Add guard: `if (tokenSets[i].size === 0 || tokenSets[j].size === 0) { sharesToken = true; }` — empty token sets should NOT be used to skip the cosine check.

### [ ] 2.3 CosineEngine embeddings index validation
**File:** `src/CosineEngine.ts` ~line 144
**Problem:** `embeddings.sort((a: any, b: any) => a.index - b.index)` assumes `index` field exists. If API response omits it, all comparisons return NaN, breaking sort order and misaligning embeddings with pages.
**Fix:** Validate before sort: `if (!embeddings.every(e => typeof e.index === 'number')) throw new Error('Embeddings missing index field');`

### [ ] 2.4 NaN in ModelSelector price sorting
**File:** `src/ModelSelector.tsx` ~lines 102-103
**Problem:** `parseFloat(a.pricing.prompt)` without NaN guard. Malformed pricing data breaks sort.
**Fix:** `const price = (s: string) => { const n = parseFloat(s); return isNaN(n) ? Infinity : n; };`

### ~~[ ] 2.5 Token set created inside similarity loop~~ VERIFIED: NOT A BUG
**File:** `src/CosineEngine.ts` ~line 185
**Status:** Already correctly implemented. Token sets ARE pre-computed outside the loop: `const tokenSets = pages.map(page => new Set(page.tokenArr));`. No fix needed.

---

## Tier 3 — STRUCTURAL (monolith splits that unlock maintainability)

### [ ] 3.1 Split App.tsx (5,600 lines → target <800 each)
**Priority extraction targets:**
1. `useCSVProcessing` hook — processCSV + related state (~400 lines)
2. `useGroupManagement` hook — group/ungroup/approve/unapprove handlers (~500 lines)
3. `useTokenManagement` hook — block/unblock/merge handlers (~300 lines)
4. `useTableFiltering` hook — filter/sort/pagination logic (~400 lines)
5. Tab content components — each tab's JSX into its own component file
**Why now:** Every Tier 1 fix touches App.tsx. The file is too large to safely modify without introducing new bugs. Splitting first makes fixes safer.

### [ ] 3.2 Split AutoGroupPanel.tsx (~4,100 lines → target <800 each)
**Extraction targets:**
1. `AutoGroupClusterView` — cluster display and interaction
2. `AutoGroupSuggestionView` — suggestion display and approval
3. `CosineTestView` — cosine similarity tab
4. `useCosineOrchestration` hook — handleRunCosine + handleRunCosineQA (~250 lines combined)

### [ ] 3.3 Split GenerateTab.tsx (~2,000 lines → target <800 each)
**Extraction targets:**
1. `GenerateTabInstance` is 1,628 lines — extract `<LogViewer>`, `<SettingsPanel>`
2. Move row management logic to a custom hook

### [ ] 3.4 Deduplicate ModelDropdown
**Files:** `ModelSelector.tsx`, `GroupReviewSettings.tsx`, `GenerateTab.tsx`
**Problem:** `ModelSelector.tsx` is a reusable 220-line component with `formatCost` export. But `GroupReviewSettings.tsx` (~lines 311-372) and `GenerateTab.tsx` (~lines 1250-1600) each have their OWN inline model dropdown implementations with different styling, filter/sort logic, and divider patterns — instead of reusing `ModelSelector`.
**Fix:** Refactor `GroupReviewSettings` and `GenerateTab` to use `ModelSelector` as a shared component. May need to add props for customization (styling variants, divider support).

### [ ] 3.5 Deduplicate cost formatting + retry logic
**Problem:** `formatCost()` is defined in both `ModelSelector.tsx` (line 25) and `GenerateTab.tsx` (line ~1254) with identical logic. `AutoGroupEngine.ts` has a different cost estimation function at line ~288-300 (multiply tokens by price — different purpose, not a duplicate). Retry logic with exponential backoff exists in `GenerateTab.tsx` (~lines 914-945) and separately in `AutoGroupEngine.ts` queue processing.
**Fix:** Extract shared `formatCost()` to a utility file. Extract `fetchWithRetry(fn, maxRetries, backoff)` for reuse across Generate and AutoGroup.

---

## Tier 4 — ROBUSTNESS (error handling, validation, leaks)

### [ ] 4.1 IDB connection churn (no pooling)
**File:** `src/projectStorage.ts` ~line 131
**Problem:** `openIDB()` opens a new `indexedDB.open()` connection on every call to `saveToIDB()`, `loadFromIDB()`, `deleteFromIDB()`, `saveAppPrefsToIDB()`, and `loadAppPrefsFromIDB()`. Each function does open→transaction→close. Not a true "leak" (connections are closed), but inefficient — rapid operations (save+load+save) open 3 separate connections when 1 would suffice.
**Fix:** Implement singleton pattern — cache the DB instance, reopen only if closed:
```typescript
let cachedDb: IDBDatabase | null = null;
const openIDB = async (): Promise<IDBDatabase> => {
  if (cachedDb) return cachedDb;
  // ... open and cache ...
};
```

### [ ] 4.2 Stale chunk cleanup in multi-batch saves
**File:** `src/projectStorage.ts` ~lines 305-371
**Problem:** Existing chunks are fetched BEFORE batch writes start. Between fetch and cleanup, another client could write new chunks. Stale list may delete valid data.
**Fix:** Move chunk cleanup AFTER all writes complete, re-fetch the chunk list, and only delete chunks that don't belong to the current write.

### [ ] 4.3 No transactional guarantees on multi-batch writes
**File:** `src/projectStorage.ts` ~lines 331-368
**Problem:** When data exceeds 500 ops, multiple batches commit independently. If batch N succeeds but N+1 fails, Firestore has incomplete data.
**Fix:** Track which batches succeeded. On partial failure, either retry failed batches or roll back successful ones. At minimum, alert the user.

### [ ] 4.4 Unbounded caches in processing.ts
**File:** `src/processing.ts` — `pluralizeCache` and `stemCache`
**Problem:** Plain objects that grow indefinitely. Long sessions with large datasets could consume significant memory.
**Fix:** Add simple size cap (e.g., 10,000 entries). When exceeded, clear and start fresh.

### [ ] 4.5 Debounce slider Firestore writes
**File:** `src/GroupReviewSettings.tsx` ~lines 385-406
**Problem:** Range inputs trigger `setSettings()` (→ Firestore write) on every pixel of slider drag. ~100+ writes per drag.
**Fix:** Use `onMouseUp`/`onTouchEnd` for persistence, keep `onChange` for local state only. Or debounce the Firestore save (300ms).

### [ ] 4.6 ToastContext missing unmount cleanup (minor)
**File:** `src/ToastContext.tsx` ~lines 64-65
**Problem:** Normal operation is fine — timers are properly cleared per-toast when `removeToast()` is called. However, if the `ToastProvider` unmounts while toasts are still pending (e.g., hot module reload, route change), the pending `setTimeout` callbacks fire and call `removeToast()` on unmounted state, causing React warnings.
**Fix:** Add unmount cleanup:
```typescript
useEffect(() => {
  return () => { timersRef.current.forEach(clearTimeout); timersRef.current.clear(); };
}, []);
```

### [ ] 4.7 ModelSelector event listener accumulation
**File:** `src/ModelSelector.tsx` ~lines 46-54
**Problem:** Outside-click listener re-attached every time `isOpen` changes. Rapid toggles accumulate listeners.
**Fix:** Add listener once, check `isOpen` ref inside handler.

---

## Tier 5 — POLISH (DX, tests, accessibility)

### [ ] 5.1 Add UI component tests
**Missing:** ModelSelector, SettingsControls, TableHeader, GroupReviewSettings, AutoGroupPanel, GenerateTab, ToastContext/Container, MergeConfirmModal, LabelFilterDropdown, ActivityLog — all have ZERO tests.
**Fix:** Add React Testing Library tests for critical interactions (dropdowns, modals, forms, filter changes).

### [ ] 5.2 Focus trap in MergeConfirmModal
**File:** `src/MergeConfirmModal.tsx`
**Problem:** Modal doesn't trap focus. Keyboard users can tab outside.
**Fix:** Add focus trap (manual or library).

### [ ] 5.3 Aria labels on form inputs
**File:** `src/SettingsControls.tsx` — range inputs and selects missing `aria-label`
**Fix:** Add `aria-label={label}` to all interactive elements.

### [ ] 5.4 Input validation on range controls
**File:** `src/SettingsControls.tsx` ~lines 38-64
**Problem:** No clamp validation. If `maxConcurrency` prop changes, value could exceed max.
**Fix:** Clamp on change: `Math.max(Math.min(value, max), min)`.

### [ ] 5.5 MergeConfirmModal empty token guard
**File:** `src/MergeConfirmModal.tsx` ~line 29
**Problem:** If `sortedTokens[0]` is undefined, `parentToken` initializes to `''`.
**Fix:** Guard in `onConfirm`: `if (!parentToken) return;`

### [ ] 5.6 GenerateTab minLen/maxLen validation
**File:** `src/GenerateTab.tsx`
**Problem:** No validation that `minLen <= maxLen`. Users can set invalid constraints.
**Fix:** Add constraint check before generation starts.

---

## Execution Notes

- [x] (2026-03-31) Fixed sticky shared V2 read-only gating in `src/useProjectPersistence.ts`, `src/App.tsx`, `src/GroupDataView.tsx`, `src/hooks/useFilteredAutoGroupFlow.ts`, and `src/hooks/useGroupReviewAutoProcessor.ts`.
  Root cause: the persistence boundary used one broad recovery flag for both background canonical reloads and true unsafe write states, and the Group UI consumed that same signal as blanket `isSharedProjectReadOnly`. A benign `collab/meta` / epoch reload could therefore freeze routine grouping, filtered auto-group orchestration, and review processing even when the last known canonical shared state was still safe.
  Instances fixed: persistence write gating, routine-vs-bulk editability derivation, grouped/approved row disablement, filtered Auto Group read-only gating, and Group Review auto-processor abort behavior.
  Prevention rule: background canonical reload must not be treated as blanket read-only when a last-known-good writable canonical state still exists; only true unsafe shared states remain fail-closed.

- [x] (2026-03-31) Hardened spam-heavy Group bulk flows and V2 write-failure recovery in `src/useProjectPersistence.ts`, `src/AutoGroupPanel.tsx`, `src/GroupDataView.tsx`, `src/GroupWorkspaceShell.tsx`, `src/hooks/useFilteredAutoGroupFlow.ts`, `src/filteredAutoGroupQueue.ts`, and new regression tests.
  Root cause: the app still had residual paths where expensive bulk actions could start in unsafe shared states, queued filtered Auto Group runs could stack stale intents, and failed optimistic V2 writes could leave local overlays behind until a later reload corrected them.
  Instances fixed: same-client Auto Group bulk-intent dedupe, latest-only filtered Auto Group queueing, canonical-sync banner separation, import and keyword-rating/token-merge/auto-merge entry-point gating, pending V2 overlay rollback on non-conflict failures, and immediate owned-lock invalidation on heartbeat loss.
  Prevention rule: expensive Group actions must fail fast before spending cost or mutating local state when shared writes are unsafe, and any optimistic V2 overlay touched by a failed write must be rolled back or recomposed immediately.

- [x] (2026-03-31) Fixed local group/open regression in `src/App.tsx`, `src/projectCollabV2.ts`, `src/projectCollabV2.storage.test.ts`, `src/ClusterRow.test.tsx`, and `src/GroupedClusterRow.test.tsx`.
  Root cause: `App.tsx` was still rendering stale inline row components whose checkbox callbacks no longer matched `handleClusterSelect` / `handleGroupSelect`, so page and group selection silently failed. In parallel, `loadCanonicalProjectState()` could still turn ordinary local project open into a V2 recovery write path when stale collab meta had no usable base commit, which caused startup `permission-denied` writes on `project_operations/current` and `collab/meta`.
  Instances fixed: pages table selection, grouped table selection, approved table selection, legacy bootstrap with no collab meta, legacy bootstrap with explicit legacy meta, and stale V2 bootstrap with missing `baseCommitId`.
  Validation: targeted component/storage regressions, `npx tsc --noEmit`, browser repro confirming clean project open, manual grouping persistence across reload, and filtered Auto Group re-enabling once filters are active.

- **Work top to bottom.** Tier 1 items are blocking — nothing else matters if data is being lost.
- **Tier 1 priority order:** 1.2 and 1.3 are CRITICAL (confirmed data loss). 1.4 is HIGH (timing-dependent). 1.6 is HIGH (multi-user race). 1.1 is MEDIUM (redundant, not data-losing). 1.5, 1.7, 1.8 are important but less urgent.
- **Tier 3.1 (split App.tsx) should happen BEFORE fixing remaining Tier 1 items** if possible, because most Tier 1 bugs live in App.tsx and the file is too large to modify safely at 5,731 lines. However, if splitting is too risky as a first step, fix Tier 1 items in-place first.
- **After each fix:** run `npx tsc --noEmit && npx vitest run && npx vite build`.
- **After each Tier 1 fix:** manually test multi-user scenario (two browser tabs, same project).
- Check items off by changing `[ ]` to `[x]` with the date: `[x] (2026-03-25)`.

## Verification Log

All items in this file were triple-checked on 2026-03-25:
- **1.1:** Severity DOWNGRADED from CRITICAL to MEDIUM — `bulkSet()` syncs refs internally, so Firestore gets correct data. Direct setters are redundant waste, not data loss.
- **1.2:** CONFIRMED CRITICAL — `bulkSet()` only receives subset of changed fields, reads rest from stale `latest.current`.
- **1.3:** CONFIRMED CRITICAL — `startTransition` defers ref sync, persistence reads stale pre-merge data.
- **1.4:** Fix REFINED — original description said "missing suppressSnapshotRef" but it IS set. Real issue is the 1000ms timeout that can expire before slow snapshots arrive. Fix changed to write-timestamp tracking.
- **1.5:** CONFIRMED — independent Firestore sync without any suppress mechanism.
- **1.6:** CONFIRMED — full Set replacement on snapshot creates race between concurrent users.
- **1.7:** EXPANDED — found 17 silent catches (was ~10), plus 6 semi-silent (console.warn only). Complete list now documented.
- **1.8:** CONFIRMED — stale ref read 5s after scheduling.
- **2.1:** MITIGATED — bounds check catches the -1 index, but valid candidates with index 0 are silently dropped.
- **2.5:** REMOVED — already correctly implemented (token sets pre-computed outside loop).
- **3.4:** CORRECTED — `ModelSelector.tsx` exists as reusable component but isn't used by the other two files.
- **3.5:** CORRECTED — duplication is `formatCost()` across files, not cost estimation in AutoGroupEngine.
- **4.1:** CLARIFIED — not a leak (connections are closed), but no pooling/reuse.
- **4.6:** DOWNGRADED — no leak in normal operation, only on unmount with pending toasts.
