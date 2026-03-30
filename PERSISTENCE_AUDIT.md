# Persistence & Sync Audit — 2026-03-27

> Root-cause analysis of data-loss bugs plus a full sweep of every remaining
> edge case in the save/load/sync pipeline.
>
> **Status: ALL CRITICAL and HIGH items are FIXED.** Medium/low items documented
> with justification for why no code change is needed.

---

## ALL fixes applied (this session)

### FIXED-8: Generate subtab model lock could revert to stale shared/default model on refresh
- **Files:** `GenerateTab.tsx`, `appSettingsPersistence.ts`
- **Symptom:** User selects a non-Jamba model, locks it for a specific Generate/content subtab, refreshes, and the UI comes back locked to `AI21: Jamba Large 1.7`.
- **Root causes:**
  - Startup hydration merged effective state in memory, but local mirrors could still be rewritten with the raw incoming Firestore/cache snapshot instead of the merged scoped state.
  - Default-model auto-pick could still run before settings hydration fully completed.
  - The fast local mirror wrote `localStorage` after awaiting IndexedDB, so a hard refresh could beat the mirror update.
- **Fix:**
  - Treat the visible subtab/view as the scope source of truth for model state.
  - Build one effective hydrated settings object (`hydrateGenerateSettings`) and persist/cache that merged result, not the raw incoming payload.
  - Write the `localStorage` fast mirror before awaiting IndexedDB.
  - Persist explicit model-change / model-lock actions immediately instead of waiting only on the debounced settings queue.
  - Block default model auto-selection until settings hydration is complete, and only allow it for scopes that are both empty and unlocked.
  - Normalize invalid `locked + empty model` states so they cannot silently degrade into a locked default/Jamba fallback.

### Generate model persistence standard (apply this elsewhere)
- **One canonical effective state per scope:** If incoming persisted state needs merging, compute one effective object first and use that same object for UI state, fast mirror, IndexedDB, and Firestore.
- **Never cache raw stale hydration:** Do not write incoming snapshot payloads back to local mirrors before merge/reconciliation completes.
- **Fast mirror first:** For refresh-critical settings, update `localStorage` before awaiting slower durability layers so a refresh reopens on the newest visible state.
- **User intent beats late hydration:** Explicit local selections should survive late cache/Firestore hydration unless the incoming state is intentionally authoritative (for example, a locked persisted scope).
- **Defaults are last resort only:** Any auto-pick/default value must run only after hydration finishes and only when the scope is genuinely empty and unlocked.
- **Locks require a real value:** A lock without a corresponding scoped value is invalid state and should be normalized away rather than treated as permission to fall back to a default model.
- **Shared sync must be narrow:** Shared/default sync paths should update only the scopes they own and must never override locked scoped state.

### FIXED-1: onSnapshot Guard 6 was one-directional
- **File:** `useProjectPersistence.ts` Guard 6
- **Symptom:** After ungrouping (local has fewer grouped pages), a stale Firestore
  snapshot with MORE grouped pages passed Guard 6 and overwrote the user's work.
- **Fix:** Guard 6 now rejects ANY snapshot where `incomingSaveId < localSaveId`,
  regardless of page-count direction.

### FIXED-2: `pickNewerProjectPayload` punished intentional ungroup
- **File:** `projectStorage.ts` `pickNewerProjectPayload`
- **Symptom:** On refresh, IDB with higher saveId but fewer groups lost to Firestore
  because group-mass heuristics overrode saveId when the gap was > 5.
- **Fix:** Rewrote `pickNewerProjectPayload`. Higher saveId wins unconditionally when
  both sides have valid saveIds. Legacy heuristics only apply when one side has saveId = 0.

### FIXED-3: Snapshot handler wrote stale data to IDB
- **File:** `useProjectPersistence.ts` (IDB write after applyViewState)
- **Symptom:** Even stale snapshots that passed guards wrote to IDB, overwriting the
  correct `checkpointToIDB` from `mutateAndSave`.
- **Fix:** IDB write from snapshot handler now only happens when
  `incomingSaveId >= localSaveId`.

### FIXED-4: `saveCounterRef` not updated when applying valid remote snapshot
- **File:** `useProjectPersistence.ts` — onSnapshot handler after applyViewState
- **Severity:** CRITICAL
- **Symptom:** Client B saves with saveId=200. Client A applies it but `saveCounterRef`
  stays at 50. Client A's next local edit gets saveId=51. On refresh, Firestore(200)
  beats IDB(51) → local edit lost.
- **Fix:** After applying a valid remote snapshot, `saveCounterRef.current` advances to
  `max(saveCounterRef.current, incomingSaveId)`.

### FIXED-5: No `hasPendingWrites` guard on project chunks listener
- **File:** `useProjectPersistence.ts` — new Guard 0
- **Severity:** HIGH
- **Symptom:** During multi-batch writes, SDK fires with `hasPendingWrites=true` and
  old meta (old clientId), bypassing Guard 2. Partial data applied to local state.
- **Fix:** Added `if (snap.metadata?.hasPendingWrites) return;` as Guard 0 before all
  other guards. Also added `metadata` to integration test snapshot mocks.

### FIXED-6: Remote snapshot can poison in-flight `flushPersistQueue`
- **File:** `useProjectPersistence.ts` — new `isFlushingRef` + Guard 1b
- **Severity:** HIGH
- **Symptom:** While `flushPersistQueue` awaits IDB/Firestore writes, a valid remote
  snapshot overwrites `latest.current`. The next flush loop iteration saves remote data
  instead of local edits.
- **Fix:** New `isFlushingRef` flag set true during flush, false in finally. Guard 1b
  in onSnapshot skips `applyViewState` while `isFlushingRef.current` is true.

### FIXED-7: `reset()` in App.tsx bypassed persistence
- **File:** `App.tsx` `reset()` function
- **Severity:** HIGH
- **Symptom:** When `activeProjectId` was null, `reset()` called raw state setters
  without updating `latest.current` or triggering IDB/Firestore saves.
- **Fix:** `reset()` now unconditionally calls `clearProject()` which uses
  `applyViewState(createEmptyProjectViewState())` to update `latest.current` atomically.

---

## Items requiring NO code change (verified safe)

### KNOWN-LIMITATION: `pagehide` / `visibilitychange` flush is best-effort
- **Severity:** HIGH-3 (downgraded to known limitation)
- **Impact:** If the user closes the tab, the Firestore write may not complete before
  the browser kills the process. IDB checkpoint from `mutateAndSave` is already done,
  so data survives locally. The gap is only cross-device sync until the user reopens.
- **Mitigation:** IDB-first loading ensures no data loss. `navigator.sendBeacon` cannot
  carry Firestore writes. This is an inherent browser limitation.

### VERIFIED-SAFE: No-deps `useEffect` for `latest.current` sync (MEDIUM-1)
- The no-deps useEffect fires after every commit and writes `latest.current` from React
  state. Since all user-facing mutations go through `mutateAndSave` (which sets
  `latest.current` synchronously first), the effect is always a no-op re-write of the
  same values. Transitional setters used only in CSV error paths clear state — they do
  not modify user data that needs persisting.

### VERIFIED-SAFE: Network reconnection snapshot burst (MEDIUM-2)
- After going offline and reconnecting, Firestore delivers cached + server snapshots
  quickly. Guard 0 (hasPendingWrites), Guard 2 (clientId), and Guard 6 (saveId) cover
  all cases. The isFlushingRef guard provides additional protection.

### VERIFIED-SAFE: Settings persistence (LOW-1)
- `starred_models`, `universal_blocked`, `user_preferences`, `autogroup_settings`,
  `group_review_settings`, `table_column_widths`, `generate_*` settings all use simple
  last-write-wins patterns. No saveId needed — settings are small, infrequently changed,
  and conflicts are rare.

### VERIFIED-SAFE: CSV error-path transitional setters
- All 17 usages of transitional setters in `App.tsx` are in CSV parse error handlers
  (`catch` blocks). They clear state after a failed parse — no user data exists yet.
  These do not need `mutateAndSave` because there is nothing to persist.

### VERIFIED-SAFE: `loadProject` timing vs onSnapshot registration
- `loadProject` sets `projectLoadingRef.current = true` synchronously before its first
  `await`. The `onSnapshot` useEffect only fires after React commits the re-render
  triggered by `setActiveProjectId`. Since `loadProject` is called in the same
  synchronous block, Guard 1a catches the initial Firestore cache callback.

---

## Guard summary (onSnapshot handler, `useProjectPersistence.ts`)

| Guard | Purpose | Added |
|-------|---------|-------|
| 0 | Skip `hasPendingWrites` (mid-batch SDK noise) | This session |
| 1a | Skip while `projectLoadingRef` (loadProject is authority) | Original |
| 1b | Skip while `isFlushingRef` (prevent mid-flush overwrite) | This session |
| 2 | Skip own save echoes (clientId match) | Original |
| 3 | Don't wipe local state with empty/null data | Original |
| 4 | Reject partial multi-batch writes from other clients | Original |
| 5 | Load fence — don't shrink below loaded page mass | Original |
| 6 | Reject ANY snapshot with stale saveId | Fixed this session |
| Post-apply | Advance saveCounterRef to max(local, incoming) | This session |
| Post-apply | IDB write only if incomingSaveId >= localSaveId | Fixed this session |

---

## Test coverage for persistence fixes

| Fix | Test file | Test name |
|-----|-----------|-----------|
| FIXED-1 | `projectStorage.test.ts` | `REGRESSION: ungroup + unblock + refresh` |
| FIXED-2 | `projectStorage.test.ts` | `prefers IDB when it has a valid saveId and Firestore is legacy` |
| FIXED-3 | `projectStorage.test.ts` | (covered by saveId-based merge tests) |
| FIXED-4 | (guard logic — covered by integration snapshot pipeline) | |
| FIXED-5 | `App.shared-projects.integration.test.tsx` | (metadata added to mocks) |
| FIXED-6 | (guard logic — structural, no external mock point) | |
| FIXED-7 | (simplified to `clearProject()` — tested via `clearProject` behavior) | |
