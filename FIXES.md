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

### [x] 1.9 Shared projects could still fall back to legacy chunk writes after V2 recovery/missing meta
**Date fixed:** 2026-03-31
**Files:** `src/useProjectPersistence.ts`, `src/projectCollabV2.ts`, `src/projectWorkspace.ts`, `scripts/migrate-shared-projects-v2.ts`, `package.json`, `firestore.rules`, `src/projectCollabV2.storage.test.ts`, `src/useProjectPersistence.v2.test.tsx`, `src/App.shared-projects.integration.test.tsx`
**Root cause:** Shared projects were still allowed to resolve/open in legacy mode when `collab/meta` was missing, downgraded, or unrecoverable. The client reattached the legacy `projects/{id}/chunks` listener, recovery could reset shared `readMode` back to `legacy`, and rules still allowed shared legacy chunk/entity writes before `hasV2Meta` existed. That meant the same shared project could bounce between two persistence contracts depending on bootstrap timing or recovery state.
**All instances fixed:**
- Shared project detection now gates bootstrap/listener behavior through one helper in `src/projectSharing.ts`.
- `src/useProjectPersistence.ts` no longer attaches the legacy chunk listener for shared `collab` projects, forces shared loads/reloads through the V2 canonical path, and keeps shared meta-loss handling on V2 instead of reloading legacy chunks or reopening the legacy runtime loader.
- `src/projectCollabV2.ts` now treats `loadCanonicalProjectState(..., { sharedProject: true })` as V2-only bootstrap: shared projects keep only a local read-only fallback view when bootstrap/recovery is incomplete, recovery no longer resets shared `readMode` back to `legacy`, and runtime no longer reads legacy chunk payloads from Firestore during shared open.
- `src/projectWorkspace.ts` no longer contains the dormant `loadProjectDataV2Aware` bootstrap fork, so shared-project runtime bootstrap now has one source of truth.
- `scripts/migrate-shared-projects-v2.ts` provides the explicit out-of-band shared migration entrypoint, so legacy chunk reads needed for migration happen there instead of inside the shared runtime path.
- `firestore.rules` now block legacy chunk writes and legacy-bypass entity writes for shared `collab` projects, and shared `collab/meta` updates can no longer use the old V2-to-legacy escape hatch.
- Regression coverage added for shared bootstrap, shared meta-loss handling, shared App-level V2 listener updates, and explicit two-client A→B V2 convergence with no legacy chunk listener.

### [x] 1.10 Shared token merge / auto-merge lock ownership and Shift+1 routing regressions
**Date fixed:** 2026-03-31
**Files:** `src/App.tsx`, `src/GroupDataView.tsx`, `src/hooks/useAutoMerge.ts`, `src/hooks/useAutoMerge.test.tsx`, `src/hooks/useGlobalGroupingShortcuts.ts`, `src/hooks/useGlobalGroupingShortcuts.test.tsx`
**Root cause:** Token auto-merge recommendation generation and review actions were split across UI wrappers and hook internals in a way that violated the shared V2 operation contract. `updateAutoMergeRecommendations()` requires the caller to already own the shared `token-merge` bulk-operation lock, but `useAutoMerge` generated recommendations without acquiring that lock itself, several UI callsites wrapped async token-merge callbacks without returning their promises (releasing the lock too early), and the global shortcut handler incorrectly treated bare `Shift` as an action key. That combination meant `Shift+1` could fire the wrong action locally, token auto-merge writes could be rejected in shared mode, and local recommendation refs could advance even when the shared write was blocked.
**All instances fixed:**
- `src/hooks/useAutoMerge.ts` now owns the token-merge exclusive-operation boundary for recommendation generation, single-apply, decline, undo, and `Merge All`, and it only mutates `autoMergeRecommendationsRef.current` after the shared write is accepted.
- `src/App.tsx` now passes the shared `runWithExclusiveOperation` helper into `useAutoMerge`, wires `Shift+1` token auto-merge capability into the global shortcut hook, and keeps the manual merge-confirm path inside a returned token-merge promise so the lock is held until the merge cascade finishes.
- `src/GroupDataView.tsx` no longer double-wraps token auto-merge review actions with brittle UI-level locks, and the remaining manual unmerge actions now return the real async token-merge promise so the shared lock is not released early.
- `src/hooks/useGlobalGroupingShortcuts.ts` now ignores bare `Shift`, preserves `Shift+1` for Pages Auto Group on the Pages tab, and routes `Shift+1` to token auto-merge only when the Token Management `auto-merge` view is active outside Pages.
- Regression coverage now verifies bare `Shift` never triggers grouping, `Shift+1` dispatches to the correct action by context, recommendation generation uses the exclusive token-merge operation, blocked shared writes do not mutate local auto-merge refs, and `Merge All` stays inside one exclusive token-merge operation until the shared write completes.

### [x] 1.11 Shared exclusive-operation cleanup and CSV import acceptance gaps
**Date fixed:** 2026-03-31
**Files:** `src/useProjectPersistence.ts`, `src/useProjectPersistence.v2.test.tsx`, `src/hooks/useCsvImport.ts`, `src/hooks/useCsvImport.test.tsx`, `src/GroupDataView.tsx`
**Root cause:** The shared exclusive-operation helper assumed lock acquire/release never throw, so a failed lock transaction could leave the same-browser in-flight gate or local active-operation state wedged until reload. Separately, CSV import treated `bulkSet()` as fire-and-forget even though shared canonical saves are async, so import completion could switch tabs and clear the busy state before the shared write was accepted or rejected.
**All instances fixed:**
- `src/useProjectPersistence.ts` now treats lock acquire and release as fallible operations: acquire failures report through the persistence error channel without wedging the local in-flight gate, and release failures report without leaving `activeOperation` pinned locally.
- `src/useProjectPersistence.v2.test.tsx` now covers both failure modes so a rejected lock acquire or release cannot silently regress back into a browser-local deadlock.
- `src/hooks/useCsvImport.ts` now awaits the async `bulkSet()` result, only completes the import after an accepted shared mutation, and surfaces blocked/failed shared persistence instead of claiming success.
- `src/hooks/useCsvImport.test.tsx` now verifies that CSV import stays in the processing state until the async shared save resolves and that blocked shared persistence does not switch the UI to the imported Pages view.
- `src/GroupDataView.tsx` now only advertises `Shift+1` where the shortcut actually exists, so the UI no longer promises a keyboard path that the handler intentionally does not support.

### [x] 1.13 Shift+1 silently no-ops from search/filter inputs

**Date fixed:** 2026-04-01

**Files:** `src/groupingShortcutTargets.ts`, `src/GroupDataView.tsx`, `src/TableHeader.tsx`, `src/hooks/useGlobalGroupingShortcuts.ts`, `src/hooks/useGlobalGroupingShortcuts.test.tsx`, `FEATURES.md`

### [x] 1.14 Shared-project CSV bootstrap raced the collab/meta listener

**Date fixed:** 2026-04-01

**Files:** `src/useProjectPersistence.ts`, `src/useProjectPersistence.v2.test.tsx`, `FEATURES.md`

**Root cause:** Opening a shared project with missing or still-writing `collab/meta` could start two bootstrap flows at once. `loadProject()` was already running the initial V2 canonical/bootstrap load, but the live `collab/meta` listener reacted to the same empty or half-written meta state and launched a second canonical recovery/bootstrap path. Those concurrent bootstrap attempts raced on the same project and surfaced `meta-conflict`/lock failures before CSV import could start cleanly.

**All instances fixed:**
- `src/useProjectPersistence.ts` now treats the initial shared-project bootstrap as single-owner work: while `loadProject()` is still resolving storage mode for a shared project, the `collab/meta` listener ignores empty and in-progress bootstrap snapshots instead of starting a second canonical load or recovery pass.
- `src/useProjectPersistence.v2.test.tsx` now covers the exact regression by proving that both `null` meta snapshots and `readMode:'v2'` + `commitState:'writing'` bootstrap echoes do not trigger a second `loadCanonicalProjectState()` call during the initial shared load.

### [x] 1.15 Shared V2 convergence still had cache/status/wrapper loopholes
**Date fixed:** 2026-04-01
**Files:** `src/useProjectPersistence.ts`, `src/cloudSyncStatus.ts`, `src/appSettingsPersistence.ts`, `src/contentPipelineLoaders.ts`, `src/generateWorkspaceScope.ts`, `src/ContentOverviewPanel.tsx`, `src/FinalPagesPanel.tsx`, `src/ContentTab.tsx`, `src/GenerateTab.tsx`, `src/cloudSyncStatus.test.ts`, `src/AppStatusBar.test.tsx`, `src/appSettingsPersistence.test.ts`, `src/generateWorkspaceScope.test.ts`, `src/ContentOverviewPanel.test.tsx`, `src/FinalPagesPanel.test.tsx`, `src/ContentTab.test.tsx`, `e2e/collaboration-two-session.spec.ts`
**Root cause:** Shared `collab` projects were mostly on the V2 architecture, but the enforcement boundary still had escape hatches. The runtime could show `Cloud: synced` after a single server snapshot, first authoritative V2 entity snapshots still used incremental merge semantics, project-scoped Content/Generate shared-doc loaders still exposed cache-first local-preferred paths without an explicit provisional-state contract, and nested Content surfaces could keep shared listeners alive while hidden.
**All instances fixed:**
- `src/useProjectPersistence.ts` now tracks authoritative readiness for `collab/meta`, `project_operations/current`, and every active-epoch V2 entity collection, and the first server-authoritative snapshot for each entity collection now replaces the whole in-memory collection before steady-state incremental merges resume.
- `src/cloudSyncStatus.ts` now carries explicit shared-project convergence state, so the status bar distinguishes `Connecting…`, cached provisional state, server convergence, and true authoritative sync instead of treating any `fromCache === false` snapshot as healthy.
- `src/appSettingsPersistence.ts` and `src/contentPipelineLoaders.ts` now fail closed for project-scoped `local-preferred` loads unless the caller explicitly opts into provisional-cache behavior.
- `src/ContentOverviewPanel.tsx`, `src/FinalPagesPanel.tsx`, and `src/ContentTab.tsx` now respect `runtimeEffectsActive` for project-scoped shared listeners and local-preferred refreshes, so hidden nested Content surfaces do not freeload on shared runtime work.
- `src/generateWorkspaceScope.ts`, `src/ContentTab.tsx`, and `src/GenerateTab.tsx` now surface structured workspace-ensure results instead of collapsing blocked bootstrap writes into raw thrown errors.
- Regression coverage now locks in the stricter status semantics, fail-closed project-scoped cache reads, hidden-surface idle behavior, and shared workspace ensure handling.

### [x] 1.16 Shared V2 fallback payloads could masquerade as canonical state
**Date fixed:** 2026-04-01
**Files:** `src/useProjectPersistence.ts`, `src/useProjectPersistence.v2.test.tsx`, `FIXES.md`, `FEATURES.md`
**Root cause:** The shared-project V2 hook treated a fallback `canonical.resolved` payload as equivalent to a fully loaded canonical epoch whenever `collab/meta` already said `readMode:'v2'` and `commitState:'ready'`. That collapsed provisional local fallback and authoritative canonical state into the same branch. Once that happened, a stale cache payload could be re-saved as canonical IndexedDB state, the browser could appear writable even though no immutable base commit was loaded, and the `collab/meta` listener could short-circuit identical meta snapshots before retrying the canonical reload that should have repaired the session.
**All instances fixed:**
- `src/useProjectPersistence.ts` now tracks whether the current V2 base snapshot is `authoritative` or only `provisional`, so only a loaded base commit matching the active `collab/meta` epoch can unlock writes or qualify for canonical cache persistence.
- Shared fallback payloads without a loaded base commit now stay explicitly read-only/provisional, and the hook rebuilds local refs from them only for temporary UI continuity instead of treating them as server-acknowledged truth.
- The `collab/meta` duplicate-snapshot guard now skips reloads only when the browser already holds an authoritative base for that exact meta identity, so same-meta listener events can still repair a provisional fallback session.
- `src/useProjectPersistence.v2.test.tsx` now proves that fallback payloads stay read-only, do not overwrite the canonical cache, and recover to the real shared state once the live `collab/meta` snapshot for that epoch is observed.

**Root cause:** `src/hooks/useGlobalGroupingShortcuts.ts` treated every editable target as either globally allowed or globally blocked, instead of distinguishing between dataset-defining filter/search controls and arbitrary editors. That meant `Shift+1` could silently no-op when focus stayed inside the pages/token-management filters that define the visible list, while the same hook also let `Tab` grouping shortcuts fire during input focus. The bug lived in the shared shortcut boundary, not in Auto Group itself.

**Instances fixed:**
- `src/hooks/useGlobalGroupingShortcuts.ts` now only lets `Shift+1` bypass editable-target blocking when the focused control explicitly opts into grouping shortcuts, and it blocks `Tab` grouping shortcuts while typing.
- `src/GroupDataView.tsx` now marks the shared top-bar search input as an allowed shortcut origin because it directly defines the visible dataset for Pages and Token Management.
- `src/TableHeader.tsx` now marks numeric/text table-filter inputs as allowed shortcut origins for the same filtered-list workflow.
- `src/hooks/useGlobalGroupingShortcuts.test.tsx` now covers opted-in inputs, ordinary editors, token auto-merge, and `Tab` navigation regressions.

### [x] 1.12 Shared V2 reloads could still accept stale old-epoch edits after `collab/meta` advanced
**Date fixed:** 2026-04-01
**Files:** `src/useProjectPersistence.ts`, `src/useProjectPersistence.v2.test.tsx`, `FEATURES.md`
**Root cause:** The shared V2 hook already tracked `lastKnownGoodWritableState` as `datasetEpoch:baseCommitId`, but the mutation boundary and UI editability flags never used it. When the meta listener saw a newer `collab/meta`, it immediately advanced the in-memory meta identity and generation, marked canonical reload in progress, and fenced old entity listeners. But routine shared edits still stayed enabled as long as `isWriteUnsafe` was false. Because revisioned entity writes only CAS per-doc and do not CAS against `collab/meta`, a client in that window could still write old-epoch `groups` / `blocked_tokens` / `label_sections` / `token_merge_rules` / `activity_log` docs against the stale base it had loaded locally. That produced the exact cross-user failure where one browser appeared to save a change that another browser on the new epoch would never observe.
**All instances fixed:**
- `src/useProjectPersistence.ts` now derives a canonical identity from `datasetEpoch + baseCommitId` and fail-closes shared edits whenever canonical reload is in progress and the current `collab/meta` identity no longer matches the last acknowledged writable canonical base.
- The same unsafe-reload guard now feeds `ensureV2MutationAllowed()`, `getBlockedMutationReason()`, `isSharedProjectReadOnly`, `isRoutineSharedEditBlocked`, `isBulkSharedEditBlocked`, and the exported `writeBlockReason`, so every shared action follows one rule instead of leaving per-feature exceptions.
- `src/useProjectPersistence.v2.test.tsx` rewrites the prior regression that incorrectly allowed grouping during a newer-epoch reload, and adds the positive same-identity reload case to prove benign canonical churn stays writable while true epoch/base-commit advancement blocks until convergence.
- `FEATURES.md` now documents the stronger shared-editability rule so future changes do not reintroduce “writable while meta already points at a different canonical base” behavior.

---

### [x] 1.17 Shift+1 still missed real Keyword Management input paths
**Date fixed:** 2026-04-01
**Files:** `src/GroupDataView.tsx`, `src/GroupDataView.shortcutWiring.test.ts`
**Root cause:** The prior Shift+1 fix used explicit input opt-in (`groupingShortcutTargetProps`) but only wired a subset of real controls. Two production single-line inputs remained untagged, so keyboard behavior changed based on focus and appeared inconsistent.
**All instances fixed:**
- `src/GroupDataView.tsx` now tags both missing shortcut origins: `Group name...` and `Search tokens (comma-separated)...`.
- `src/GroupDataView.shortcutWiring.test.ts` now locks those exact callsites so either input losing the opt-in fails CI immediately.

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

### [x] 2.6 Project deep links could open the last active project instead of the requested project
**Date fixed:** 2026-04-01
**Files:** `src/hooks/useProjectLifecycle.ts`, `src/hooks/useProjectLifecycle.actions.test.ts`
**Root cause:** `useProjectLifecycle` resolved `/seo-magic/group/data/:projectKey` only once during bootstrap. If the initial project list was empty/stale and did not contain that key, mount restore immediately fell back to `prefs.activeProjectId` (`src/hooks/useProjectLifecycle.ts` mount restore path), and the later live `projects` snapshot never retried the URL target. The URL sync effect could also strip the unresolved key before the live snapshot arrived. That produced the visible symptom: opening one project link loaded a different project from prior workspace prefs.
**All instances fixed:**
- Mount restore now treats an unresolved data-route key as a pending URL target instead of falling back to workspace prefs.
- Group/data URL sync now preserves the unresolved deep link while resolution is pending.
- The live `projects` snapshot path now retries pending URL-key resolution and loads the requested project as soon as authoritative metadata contains it.
- Regression coverage now proves that an unresolved deep link does not hijack to `prefs.activeProjectId` and that the correct project opens once the live snapshot includes it.

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

- [x] (2026-04-01) Added zero-unknown collaboration guardrails in `src/sharedCollaboration.ts`, `src/sharedCollabContract.ts`, `src/projectMetadataCollab.ts`, `src/appSettingsPersistence.ts`, `src/hooks/useProjectLifecycle.ts`, `src/ProjectsTab.tsx`, `src/ProjectsTabProjectCard.tsx`, `src/hooks/useWorkspacePrefsSync.ts`, and the new `scripts/collab/*` audit tooling.
  Root cause: the app still had multiple shared-data paths with different safety guarantees, plus several app-facing raw Firestore bypasses in project lifecycle, project rename/folder flows, and workspace preferences. That meant collaboration correctness depended on which tab or helper path a feature happened to use.
  Instances fixed: project create now waits for accepted metadata persistence before exposing the new project locally, project rename/folder edits and folder membership moves no longer do optimistic local-only updates ahead of shared acceptance, workspace preferences now use the shared app-settings contract, and the repo now keeps a classified Firestore census plus audit/signoff artifact that fails on unknown or unscoped collaboration paths.
  Prevention rule: every Firestore callsite in `src/` must be classified, every app-facing shared write/listener must route through the shared collaboration contract, and `npm run collab:gate` must stay clean before release work.

- [x] (2026-04-01) Fixed QA two-session collaboration false negatives in `src/qa/contentPipelineQaRuntime.ts` and added regression coverage in `src/qa/contentPipelineQaRuntime.test.ts`.
  Root cause: the QA cross-page storage sync parser assumed only two prefix segments before the scenario id, but the real QA storage prefixes are multi-segment (`kwg:qa:content-pipeline:doc` / `cache`). Storage events from the other browser page were therefore classified under the wrong scenario and ignored, so the second page could miss shared row/settings/log updates even though the underlying shared doc had changed.
  Instances fixed: QA doc storage event parsing, QA cache storage event parsing, and the two-session browser collaboration gate that depends on those events for cross-page convergence in the QA harness.
  Prevention rule: QA storage keys must be parsed by removing the exact configured prefix and splitting the remaining `scenario:name` payload once; regression tests must cover both doc and cache prefixes so browser collaboration failures reflect real product behavior instead of harness bugs.

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

- [x] (2026-03-31) Fixed permanent read-only lockout for stuck V2 shared projects in `src/projectCollabV2.ts` and `src/projectCollabV2.storage.test.ts`.
  Root cause: `loadCanonicalProjectState()` had an early return before `recoverStuckV2Meta()` when `migrationState === 'failed'` or `baseCommitId` was missing. Recovery — the only code that resets `readMode` from `'v2'` back to `'legacy'` in Firestore — was never reached. This caused every load to show "Shared project canonical state is incomplete" and lock both users into read-only permanently.
  Additionally, `recoverStuckV2Meta` had a stuck state where `migrationState === 'failed'` but `readMode` was still `'v2'` — recovery returned 'unchanged' without fixing `readMode`. And when `commitState === 'ready'` / `migrationState === 'complete'` but the base commit was genuinely missing, recovery skipped itself entirely.
  Three fixes: (1) removed early return so recovery always runs, (2) added `readMode: 'legacy'` repair when `migrationState` is 'failed' but `readMode` is still 'v2', (3) added `canonicalLoadFailed` hint so recovery doesn't skip when meta looks healthy but the base commit is actually broken.
  After recovery, both users land in legacy mode with full write access via `onSnapshot` listeners. The meta listener on other clients detects the `readMode` change and calls `setWriteUnsafe(false)` automatically.
  Prevention rule: no user should ever be permanently locked into read-only mode. Recovery must always attempt repair. Updated SHARED_PROJECT_COLLAB_V2.md section 9 accordingly.

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

- [x] (2026-04-01) Hardened shared-project V2 convergence bootstrap/readiness in `src/useProjectPersistence.ts` and `src/useProjectPersistence.v2.test.tsx`.
  Root cause: the shared V2 bootstrap path could skip an actionable initial `collab/meta` snapshot and rely on a later meta event to attach/reload listeners, while readiness tracking could be reset during listener attach even after an authoritative canonical load. This left some sessions in non-authoritative listener state and allowed inconsistent propagation behavior.
  Instances fixed: queued bootstrap-meta drain (instead of skip-and-forget), deterministic post-authoritative listener reattach trigger, authoritative canonical-base tracking for cache/listener guard paths, preserved authoritative entity readiness across listener reattach, and strict shared fail-closed mutation/read-only gating until authoritative shared readiness is satisfied.
  Prevention rule: shared V2 bootstrap snapshots are never dropped; listener activation and authoritative readiness must converge without requiring a second meta event.

- [x] (2026-04-01) Strengthened collaboration gating so convergence checks are mandatory in `package.json` (`collab:convergence`, `collab:gate`, `collab:release-gate`).
  Root cause: static census/audit/coverage checks alone can verify callsite hygiene, but they cannot guarantee runtime cross-client convergence for every shared lane.
  Instances fixed: collab gate now enforces targeted convergence tests for app settings, project metadata, shared-project V2 persistence, Firestore rules, and two-session browser collaboration before release gating continues.
  Prevention rule: no release gate can pass unless shared-lane convergence tests pass in addition to Firestore callsite contract checks.

- [x] (2026-04-01) Added durable collaboration diagnostics journaling in `src/collabDiagnosticsLog.ts`, `src/cloudSyncStatus.ts`, and `src/runtimeTrace.ts` with regression tests in `src/collabDiagnosticsLog.test.ts` and `src/cloudSyncStatus.diagnostics.test.ts`.
  Root cause: prevention gates were strong, but forensic debugging still depended on transient console output and in-memory state, making post-incident cross-client timeline reconstruction difficult.
  Instances fixed: authoritative/readiness transitions, shared project sync phase updates, listener server snapshots/errors, listener apply events, and shared mutation accepted/blocked/failed outcomes now append structured entries with session/run correlation IDs to a bounded local diagnostics journal.
  Prevention rule: every critical shared convergence transition must emit durable diagnostics so support can reconstruct causality after the fact.
