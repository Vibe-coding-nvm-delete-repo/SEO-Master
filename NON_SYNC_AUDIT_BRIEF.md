# SEO-Master — Non-Collaboration Audit & Remediation Brief

_Last updated: 2026-03-30_

This brief covers the **major issues identified outside the V2 multi-user collaboration migration**. It is written for coding agents and maintainers who need a concrete, file-by-file remediation plan.

## Scope

This document covers these previously identified issues:

1. Firestore is fully open.
2. Project creation can look successful even when the cloud save failed.
3. Local cache bootstrap can revive or mask stale “ghost” projects.
4. Persistence failures are surfaced inconsistently across the app.
5. Large hook/component hotspots still carry stale-closure and dependency-array risk.
6. AI orchestration retry behavior is inconsistent.
7. The project persistence boundary is still overly complex even for single-user correctness.

## Important boundaries

- This brief is **separate** from the V2 multi-user persistence migration plan.
- This brief is based on the current repo shape on `main`.
- The goal is **not** to invent a parallel architecture. Fixes should respect the guidance in `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md`.
- Where possible, fixes below are designed to reduce risk **before** or **alongside** the V2 migration.

---

## Priority order

| Priority | Issue | Why this order |
|---|---|---|
| P0 | Firestore open access | Security + integrity issue that can invalidate everything else |
| P0 | Project create path can succeed locally after failed cloud write | Creates false success and silent data loss |
| P1 | Local cache bootstrap can mask stale/missing cloud state | Causes ghost projects and misleading startup state |
| P1 | Uneven persistence failure propagation | Users cannot tell what actually saved |
| P1 | Persistence boundary complexity | Makes single-user correctness fragile and slows every future change |
| P2 | Stale-closure / dependency-risk hotspots | Likely source of hard-to-reproduce logic bugs |
| P2 | AI retry inconsistency | Reliability / throughput issue, but not as severe as integrity/security |

---

# 1) Firestore is fully open

## Problem

The Firestore security rules currently allow **all reads and all writes for all documents**. That means the app has no real server-side authorization boundary for projects, settings, feedback, logs, or future V2 collaboration docs.

## Why this is dangerous

- Any client that can reach the Firebase project can potentially read or overwrite shared data.
- Data integrity bugs cannot be separated cleanly from malicious or accidental third-party writes.
- The upcoming V2 collaboration model will add more entity docs and locks; leaving rules open would make those locks diagnostic only, not authoritative.
- Client-only checks do **not** protect Firestore data.

## Code references

- `firestore.rules`
  - Current rule:
    - `match /{document=**} { allow read, write: if true; }`
- `firebase.json`
  - Firestore rules file configured as `firestore.rules`
- `src/firebase.ts`
  - Firestore is initialized normally, but App Check is optional and does not replace authorization.

## Required fix

Replace open rules with explicit access rules.

### Minimum acceptable phase-1 hardening

If this workspace is still intentionally shared and auth is incomplete, implement at least:

- authenticated read/write only
- restricted writable collections
- size/shape validation for critical documents
- reject unknown write paths by default

### Better fix

Add a real project membership / role model:

- `projects/{projectId}` readable/writable only by members
- `projects/{projectId}/chunks/*` same rule as the parent project
- `app_settings/*` limited to authorized workspace users
- `feedback/*` limited as appropriate
- future V2 entity collections inherit project membership rules

## Suggested implementation

### Step 1 — replace `allow read, write: if true`

Create rules around authenticated workspace users.

Example direction:

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }

    function isProjectMember(projectId) {
      return isSignedIn()
        && exists(/databases/$(database)/documents/projects/$(projectId)/members/$(request.auth.uid));
    }

    match /projects/{projectId} {
      allow read: if isProjectMember(projectId);
      allow write: if isProjectMember(projectId);

      match /chunks/{chunkId} {
        allow read, write: if isProjectMember(projectId);
      }

      match /groups/{groupId} {
        allow read, write: if isProjectMember(projectId);
      }

      match /blocked_tokens/{tokenId} {
        allow read, write: if isProjectMember(projectId);
      }

      match /project_operations/{docId} {
        allow read, write: if isProjectMember(projectId);
      }
    }

    match /app_settings/{docId} {
      allow read, write: if isSignedIn();
    }

    match /feedback/{docId} {
      allow read, write: if isSignedIn();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Step 2 — decide the actual auth model

One of these must become true:

- Google auth required for all users
- anonymous auth only for very narrow flows and never for shared project writes
- membership docs created per authorized user

### Step 3 — validate document shape where practical

For example:

- reject project docs missing `id`, `name`, `createdAt`
- reject lock docs with malformed timestamps or missing `ownerId`
- reject giant arrays where you can cap size in rules

## Acceptance criteria

- No wildcard `allow read, write: if true`
- Unauthorized client cannot read or write project docs
- Authorized client can still load/save current project data
- Rules include paths for future V2 entity docs

## Validation

- Firebase emulator rules tests for allowed/denied reads and writes
- Manual smoke test with signed-in and signed-out sessions

---

# 2) Project creation can look successful even when the cloud save failed

## Problem

The `createProject()` flow updates UI state optimistically and only logs Firestore failures to the console instead of failing the overall operation.

## Why this is dangerous

- User sees a new project, new URL, and loaded workspace even if the shared metadata write failed.
- Refresh or second-client view can make the project disappear.
- This breaks trust because “create project” feels successful even when the shared source of truth rejected it.

## Code references

- `src/hooks/useProjectLifecycle.ts`
  - Function: `createProject()`
  - Problem line shape:
    - local `setProjects(updatedProjects)`
    - `recentlyCreatedProjectRef.current = ...`
    - `saveProjectToFirestore(newProject).catch(err => console.error(...))`
    - UI continues with `setActiveProjectId`, tab switch, `history.pushState`, `await loadProject(...)`
- `src/projectStorage.ts`
  - Function: `saveProjectToFirestore(project)`
  - This function **does throw** on Firestore failure, but `createProject()` does not await it.

## Required fix

`createProject()` must become an **acknowledged cloud operation** for metadata creation.

If the cloud write fails, the UI must roll back the optimistic project or not commit it at all.

## Recommended implementation

### Preferred behavior

1. Build `newProject`
2. Set loading state
3. Await `saveProjectToFirestore(newProject)`
4. Only after success:
   - update local `projects`
   - clear create form
   - switch active project
   - push new URL
   - load project
5. On failure:
   - do not keep the project in the UI
   - show visible error/toast
   - keep the modal/input open so the user can retry

### Safer patched shape

```ts
const createProject = async () => {
  if (!newProjectName.trim()) {
    setProjectError('Project name is required.');
    return;
  }

  setProjectError(null);
  if (!allowProjectChange()) return;
  setIsProjectLoading(true);

  const newProject: Project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    uid: 'local',
    name: newProjectName,
    description: newProjectDescription,
    createdAt: new Date().toISOString(),
    folderId: null,
    deletedAt: null,
  };

  try {
    await saveProjectToFirestore(newProject);

    const updatedProjects = [...projectsRef.current, newProject];
    setProjects(updatedProjects);
    recentlyCreatedProjectRef.current = { id: newProject.id, until: Date.now() + 10000 };

    setNewProjectName('');
    setNewProjectDescription('');
    setIsCreatingProject(false);
    setActiveProjectId(newProject.id);
    setMainTab('group');
    setGroupSubTab('data');

    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', buildMainPath('group', 'data', projectUrlKey(newProject)));
    }

    await loadProject(newProject.id, updatedProjects);
  } catch (error) {
    setProjectError('Failed to create project in cloud storage. Please try again.');
    // optionally addToast/reportPersistFailure here
  } finally {
    setIsProjectLoading(false);
  }
};
```

## Extra improvement

If you want optimistic creation later, do it with explicit rollback:

- add optimistic project to UI
- await save
- on failure remove it again and notify the user

But do **not** leave the current “console-only failure” path in place.

## Acceptance criteria

- A failed Firestore project write never leaves a ghost project active in the UI
- Create flow only switches URL/project after cloud metadata exists
- User sees visible failure state

## Validation

- Unit test for `createProject()` when `saveProjectToFirestore` rejects
- Verify no project remains selected after forced failure
- Verify retry works

---

# 3) Local cache bootstrap can revive or mask stale “ghost” projects

## Problem

The project-list bootstrap path explicitly falls back to localStorage when Firestore is empty or errors, and the listener also suppresses some empty snapshots during a local-cache bootstrap window.

This is intentional resilience logic, but it can also make stale project metadata look real.

## Why this is dangerous

- User can see project metadata that no longer exists in Firestore.
- Startup can look healthy when the cloud source is actually unavailable or empty.
- Combined with optimistic project creation, this can reinforce ghost projects.
- This logic is subtle and timing-based, which makes future regressions likely.

## Code references

- `src/projectStorage.ts`
  - `loadProjectsFromLocalCache()`
  - `loadProjectsBootstrapState()`
  - localStorage key: `LS_PROJECTS_KEY`
  - comments/logging around using local cache when Firestore is empty or errors
- `src/hooks/useProjectLifecycle.ts`
  - `bootstrappedFromLocalCacheRef`
  - initial bootstrap effect using `loadProjectsBootstrapState()`
  - project list `onSnapshot` listener branch:
    - `isBootstrapEmptySnapshot`
    - 15-second suppression window
    - empty-snapshot suppression when prior local data exists

## Required fix

Stop treating localStorage project metadata as a silent peer authority to Firestore.

Local cache should be a **temporary display fallback**, not silent truth.

## Recommended implementation

### Step 1 — add explicit bootstrap provenance to UI state

Track:

- `projectsSource: 'firestore' | 'local-cache' | 'empty'`
- `projectsCloudHealthy: boolean`
- `projectsLastSyncedAt`

When source is `local-cache`, show a visible banner:

- “Showing cached projects while cloud data reconnects”
- actions that require current cloud state should be guarded or clearly labeled

### Step 2 — tighten local cache fallback policy

Use local cache only when:

- there is an actual network/read error
- not merely because Firestore returned an empty snapshot once

Do not treat “empty collection” as automatically eligible for cached resurrection unless there is a known migration/offline case.

### Step 3 — stop suppressing empty authoritative snapshots indefinitely

The existing 15-second bootstrap guard is understandable, but empty cloud state should eventually win unless the app is definitively offline.

Better rule:

- if Firestore listener confirms server-backed empty state, clear cached projects
- if listener is from cache only, do not clear
- if cloud read errored, remain in cached mode with explicit banner

### Step 4 — separate “cached display” from “active project selection”

If project list comes only from local cache:

- do not automatically trust `activeProjectId`
- verify project exists in Firestore before switching to full active edit mode when possible

## Acceptance criteria

- Cached project list is visually labeled as cached/offline state
- Empty authoritative Firestore state eventually clears stale cached projects
- Local cache no longer silently resurrects deleted/missing projects as if they are current

## Validation

- Simulate Firestore error → cached projects visible with banner
- Simulate real empty Firestore state → cached ghost projects do not persist indefinitely
- Refresh after deleting a project from cloud → stale local project does not appear as active truth

---

# 4) Persistence failures are surfaced inconsistently across the app

## Problem

Some persistence paths throw and report correctly. Others only `console.warn`, treat failure as best-effort, or never surface the failure to the user.

That creates an inconsistent mental model of what “saved” means.

## Why this is dangerous

- Users cannot distinguish cloud durability from cache best-effort behavior.
- Silent failures leave the app appearing healthy while data diverges.
- Agents touching one path can easily copy the wrong error-handling pattern into new code.

## Code references

### Metadata/app-prefs paths

- `src/projectStorage.ts`
  - `deleteProjectFromFirestore(projectId)` → logs warning, does not throw
  - `saveAppPrefsToFirestore(activeId, clusters)` → logs warning, does not throw
  - `saveAppPrefsToIDB(activeId, clusters)` → logs warning, does not throw
  - `deleteFromIDB(projectId)` → logs error, does not throw

### Feedback path

- `src/feedbackStorage.ts`
  - `subscribeFeedback(onItems)` listener error branch:
    - `console.warn('Feedback snapshot error:', err);`
  - `persistFeedbackCache(items)` intentionally best-effort; okay as cache, but it should be explicit in UI contracts

### Project create flow

- `src/hooks/useProjectLifecycle.ts`
  - `createProject()` swallows cloud metadata failure into console output only

## Required fix

Define one rule:

- **Cloud-authoritative writes and listeners must surface errors to the user and/or calling layer**
- **Best-effort caches must be explicitly labeled as best-effort and must never masquerade as successful cloud writes**

## Recommended implementation

### Step 1 — classify persistence APIs

Split persistence functions into two categories:

#### Authoritative
Must throw or return failure explicitly:
- `saveProjectToFirestore`
- `deleteProjectFromFirestore`
- `saveAppPrefsToFirestore`
- `deleteProjectDataFromFirestore`
- any V2 entity write
- important Firestore listeners for active UI

#### Best-effort cache
May swallow internally, but only if documented and the caller does not rely on it as proof of save:
- localStorage mirrors
- cache warming
- background IDB mirrors for non-critical displays

### Step 2 — normalize reporting

Use one shared helper pattern everywhere:

- `reportPersistFailure(...)`
- `markListenerError(...)`
- toast + status bar integration

### Step 3 — stop swallowing deletes and pref writes

Recommended changes:
- `deleteProjectFromFirestore` should throw on failure
- `saveAppPrefsToFirestore` should throw on failure
- `saveAppPrefsToIDB` should either throw or return a boolean
- feedback snapshot error should surface into UI status, not only console output

### Example direction

```ts
export const saveAppPrefsToFirestore = async (...) => {
  try {
    await setDoc(...);
  } catch (error) {
    reportPersistFailure(addToast, 'app preferences save', error);
    throw error;
  }
};
```

For listeners:

```ts
const unsub = onSnapshot(
  q,
  onNext,
  (err) => {
    markListenerError(CLOUD_SYNC_CHANNELS.feedback);
    reportPersistFailure(addToast, 'feedback listener', err);
  }
);
```

## Acceptance criteria

- All cloud-authoritative persistence failures are visible to the caller or user
- No critical save/delete path is console-only
- Cache-only failures remain best-effort and explicitly non-authoritative

## Validation

- Forced Firestore write failures produce visible user feedback
- Listener failure updates status bar / toast
- Delete failure does not quietly pretend success

---

# 5) Large hook/component hotspots still carry stale-closure and dependency-array risk

## Problem

Several major files still disable or bypass dependency linting, and the repo audit already identified specific stale-closure risks and dead state.

This is not just a style issue. In a codebase with long-lived async jobs and heavy hooks, stale closures can produce real behavior bugs.

## Why this is dangerous

- Async callbacks can capture outdated settings, results, mismatch lists, or UI state.
- Bugs are timing-sensitive and hard to reproduce.
- File-level `eslint-disable react-hooks/exhaustive-deps` removes the main automated warning system.

## Code references

### `src/App.tsx`
- File begins with:
  - `/* eslint-disable react-hooks/exhaustive-deps */`
- Also still acts as a giant mixed-responsibility shell.

### `src/GenerateTab.tsx`
- File begins with:
  - `/* eslint-disable react-hooks/exhaustive-deps */`
- Audit note:
  - `handleGenerate` depends on many values but only lists `[settings, addLog]`
- Additional smell:
  - `generateForRow` recreated every render

### `src/AutoGroupPanel.tsx`
- Audit note from `REFACTOR_PLAN.md`:
  - file-level exhaustive-deps disable
  - `handleApprove` uses `qaResults` and `qaMismatchPages` but omits them from dependency array
  - `pipelineStats` initialized but `setPipelineStats` is never called

### `REFACTOR_PLAN.md`
- Documents exact hotspots and line ranges for these files.

## Required fix

Do **not** try to “fix exhaustive deps” in one giant pass inside giant files.

Instead:

1. split responsibility into smaller hooks/modules
2. re-enable linting file-by-file
3. fix real dependency omissions or replace captured state with stable refs/selectors
4. remove dead state

## Recommended implementation

### Step 1 — make the audit actionable

Treat these as separate agent tasks:

- `App.tsx` split and lint re-enable
- `GenerateTab.tsx` split and lint re-enable
- `AutoGroupPanel.tsx` split and lint re-enable

### Step 2 — fix the known stale closure first

For `AutoGroupPanel.tsx`:
- patch `handleApprove` to include required dependencies or move the latest values behind refs
- remove or wire up `pipelineStats`

For `GenerateTab.tsx`:
- isolate `handleGenerate` into a focused hook like `useGenerateBatch`
- make dependencies explicit
- wrap expensive stable helpers in `useCallback` or module-level pure utilities

### Step 3 — re-enable exhaustive-deps incrementally

Rule:

- no file-level disable once the file is split
- if a local exception is intentional, use a one-line disable with justification comment

## Acceptance criteria

- No file-level exhaustive-deps disable in the refactored hotspots
- Known stale closure in `AutoGroupPanel` is removed
- Dead `pipelineStats` state is removed or properly updated
- `GenerateTab` generation orchestration lives in a focused hook/module

## Validation

- `eslint` / `tsc` clean after lint re-enable
- regression tests around approve/generate flows
- no behavior drift in key async jobs

---

# 6) AI orchestration retry behavior is inconsistent

## Problem

Not all OpenRouter-driven orchestration paths apply the same retry and backoff behavior. The repo audit specifically calls out `processShortGroupAssignments` as lacking a 429 retry loop.

## Why this is dangerous

- Some AI flows recover gracefully under rate limits; others fail immediately.
- Reliability depends on which code path happens to be used, not on a shared client contract.
- This increases support/debug load and makes rate-limit problems look random.

## Code references

- `src/AutoGroupEngine.ts`
  - audit notes identify `processShortGroupAssignments` as missing 429 retry
- `REFACTOR_PLAN.md`
  - explicitly calls out:
    - `processShortGroupAssignments` has no 429 retry loop
    - retry/backoff is duplicated across multiple engines
- Related engines likely using similar but duplicated patterns:
  - `GroupReviewEngine.ts`
  - `KeywordRatingEngine.ts`
  - `AutoMergeEngine.ts`
  - parts of `GenerateTab.tsx`

## Required fix

Centralize OpenRouter request behavior.

Do not keep hand-written retry loops in each engine.

## Recommended implementation

### Step 1 — create a shared OpenRouter client module

Suggested module:
- `src/openRouterClient.ts`

Responsibilities:
- shared fetch wrapper
- shared headers
- timeout handling
- 429 exponential backoff
- retry budget
- JSON extraction helpers
- usage parsing
- common error normalization

### Step 2 — route all AI calls through it

Move these into the shared client:
- chat/completions
- embeddings where relevant
- timeout / abort resolution
- JSON fence parsing

### Step 3 — patch `processShortGroupAssignments`

Until full extraction is done, immediately add parity retry behavior there so it no longer fails differently from sibling flows.

## Example direction

```ts
async function openRouterChatPost(args: {
  body: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}) {
  // shared fetch + timeout + 429 backoff + usage parsing
}
```

## Acceptance criteria

- `processShortGroupAssignments` retries 429s consistently
- all major OpenRouter paths share one retry/backoff policy
- no duplicated ad-hoc retry logic remains in multiple engines

## Validation

- mocked 429 tests for each orchestration path
- ensure retry budget and delay progression are consistent
- ensure timeout + abort behavior is preserved

---

# 7) The project persistence boundary is still overly complex even for single-user correctness

## Problem

Even ignoring multi-user collaboration, the current project persistence model still has a lot of moving parts:

- React state
- `latest.current`
- transitional parallel refs
- IDB cache
- localStorage metadata
- Firestore chunks
- snapshot guards based on multiple conditions
- special-case save behaviors like `updateSuggestions`
- ad-hoc metadata writes outside the main queue

This is survivable, but it is easy to break.

## Why this is dangerous

- New code can accidentally bypass the intended save contract.
- Debugging becomes “which authority won?” instead of “what is the truth?”
- Some correctness logic is timing-based or distributed across several helpers.
- Even with one active user, refresh/reload races can still be subtle.

## Code references

### `src/useProjectPersistence.ts`
- `latest.current` as canonical ref
- transitional `refs` object still exposed
- `evaluateSnapshotGuards(...)` contains multiple timing/state-based guard branches
- `mutateAndSave`, `checkpointToIDB`, `enqueueSave`, `flushPersistQueue`
- `updateSuggestions()` uses a separate debounce path
- `bulkSet()` can call `saveProjectToFirestore(...)` for metadata outside the main queue

### `src/projectStorage.ts`
- `pickNewerProjectPayload(...)`
- `saveProjectDataToFirestore(...)`
- chunk cleanup after save
- multiple storage tiers and fallback paths

### Repo docs
- `ARCHITECTURE.md`
- `AGENTS.md`
- `REFACTOR_PLAN.md`

## Required fix

Short-term:
- reduce competing authorities
- make the write contract explicit
- stop exposing transitional ref APIs longer than necessary

Long-term:
- replace this whole-project mutable blob model with the V2 hybrid entity/base model

## Recommended implementation

### Step 1 — tighten the current contract immediately

Document and enforce:

- all project-data writes must go through the same queue/flush contract
- no ad-hoc Firestore writes for project state except narrowly defined metadata paths
- local cache is a cache, not a competing authority
- transitional refs are temporary and should not be used by new code

### Step 2 — remove transitional parallel refs

Finish the migration from individual refs to one canonical `latest` ref or one canonical store object.

### Step 3 — extract/test snapshot guard logic

`evaluateSnapshotGuards(...)` is already a good start because it is pure. Add a dedicated test suite around it and any related reconciliation helpers.

### Step 4 — isolate metadata writes

Decide whether project metadata like `fileName` should:
- go through the same serialized contract, or
- stay separate but with a documented consistency rule

The important part is to stop accidental partial patterns.

### Step 5 — align this with the V2 migration

This issue should not trigger another giant rewrite that conflicts with V2. The practical goal here is:

- reduce accidental fragility now
- avoid adding new behavior to the old blob model
- make the old boundary stable enough to survive until V2 replaces it

## Acceptance criteria

- No new feature touches transitional refs directly
- Snapshot guard behavior has unit tests
- Project-state writes use a documented, single contract
- Ad-hoc side-channel metadata writes are either eliminated or explicitly justified

## Validation

- dedicated tests for `evaluateSnapshotGuards`
- save/reload regression tests
- same-project single-user “edit → refresh → edit again” scenarios remain correct

---

# Recommended execution sequence for agents

## Track A — immediate risk reduction
1. Lock down `firestore.rules`
2. Fix `createProject()` to await cloud metadata creation
3. Normalize error propagation for project metadata/app prefs/feedback listener

## Track B — startup correctness
4. Rework project bootstrap so cached state is explicitly labeled and not silent authority
5. Add tests around cached bootstrap vs authoritative empty cloud state

## Track C — architecture cleanup
6. Tighten current persistence contract and remove new usage of transitional refs
7. Add snapshot guard tests

## Track D — structural reliability
8. Split/lint `GenerateTab.tsx`
9. Split/lint `AutoGroupPanel.tsx`
10. Split/lint remaining `App.tsx` orchestration hotspots

## Track E — AI client consolidation
11. Patch `processShortGroupAssignments` retry parity
12. Extract shared `openRouterClient.ts`

---

# Validation commands

Run after each meaningful change:

```bash
npx tsc --noEmit
npx vitest run
npx vite build
```

Also run targeted behavior checks:

- failed project create does not leave a ghost active project
- cached bootstrap clearly indicates cached state
- feedback listener failure surfaces visibly
- 429 retry behavior is consistent across AI flows
- no unauthorized Firestore access after rules are tightened

---

# Notes for agents

- Do **not** widen the old whole-project blob model while V2 is being designed.
- Prefer fixes that either:
  - reduce risk in place, or
  - prepare a cleaner handoff into V2.
- If a fix requires touching a giant component, extract first, then patch.
- Avoid copying any persistence pattern that only logs to console unless the path is explicitly best-effort cache only.
- `REFACTOR_PLAN.md` is useful as an audit index, but verify current source before implementing because some items may have already moved since the audit was written.

---

# Appendix — current code-reference map

## Security
- `firestore.rules`
- `firebase.json`
- `src/firebase.ts`

## Project lifecycle
- `src/hooks/useProjectLifecycle.ts`
- `src/projectStorage.ts`

## Cache/bootstrap
- `src/projectStorage.ts::loadProjectsBootstrapState`
- `src/hooks/useProjectLifecycle.ts` bootstrap + projects `onSnapshot`

## Persistence reporting
- `src/projectStorage.ts`
- `src/feedbackStorage.ts`
- `src/persistenceErrors.ts`
- `src/cloudSyncStatus.ts`

## Stale-closure / lint hotspots
- `src/App.tsx`
- `src/GenerateTab.tsx`
- `src/AutoGroupPanel.tsx`
- `REFACTOR_PLAN.md`

## AI retry / orchestration
- `src/AutoGroupEngine.ts`
- `src/GroupReviewEngine.ts`
- `src/KeywordRatingEngine.ts`
- `src/AutoMergeEngine.ts`
- `src/GenerateTab.tsx`

## Persistence boundary
- `src/useProjectPersistence.ts`
- `src/projectStorage.ts`
- `ARCHITECTURE.md`
- `AGENTS.md`
