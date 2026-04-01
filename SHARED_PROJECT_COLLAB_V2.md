# Shared Project Collaboration V2

This document is the source of truth for the current shared-project persistence model.

It explains:
- what was implemented
- what guarantees the current model does provide
- what is intentionally out of scope
- what work is still left

If this file disagrees with older persistence notes, follow this file for shared-project behavior.

---

## Status

**Current state:** target architecture implemented; known open blockers remain.

The shared-project persistence path uses a **V2 commit-barrier model** instead of a whole-project mutable snapshot model.

Known open blockers:
- no real collaborator-membership authorization model yet
- lock and migration timing still use client-authored timestamps
- old commits and old epoch docs may remain until cleanup/retention is added
- deploy and recovery behavior still depends on the rest of the app staying aligned with this contract

Validation gate for this contract:
- `npx tsc --noEmit`
- `npx vitest run`
- `npx vite build`

Latest run status should always be read from CI or the most recent local run output, not from hard-coded counts in this document.

---

## Problem This Solved

The old shared-project model behaved like:
- one client assembled the full project as it saw it
- one client wrote that full snapshot back to Firestore
- other clients listened to broad snapshots and reapplied them into local state

That caused:
- last-write-wins overwrites
- partial multi-doc reads during chunk rewrites
- optimistic local state getting cached as if it were canonical
- stale refresh/reload behavior after conflicts

The V2 work replaced that with:
- immutable base commits
- entity-level shared docs
- epoch activation through one meta barrier
- acked-only shared cache behavior

---

## Current V2 Design

### 1. Base data is commit-based, not replace-in-place

Large base data stays chunked, but it is now written as immutable commits:

```text
projects/{projectId}/base_commits/{commitId}
projects/{projectId}/base_commits/{commitId}/chunks/{chunkId}
```

Each commit has a manifest doc that includes:
- `datasetEpoch`
- `commitId`
- `commitState`
- exact chunk counts
- exact chunk ids by type

The reader will only use a base commit when:
- the manifest exists
- `commitState === 'ready'`
- the fetched chunk set matches the manifest exactly

This prevents clients from treating half-written base chunks as live truth.

### 2. `collab/meta` is the activation barrier

Shared-project readers do not switch epochs just because new docs exist.

They switch only when:
- `projects/{projectId}/collab/meta` points to a `baseCommitId`
- that commit is ready
- the current epoch entity listeners are loaded

Important rule:
- future-epoch entity docs may exist in Firestore before the client activates them
- clients ignore them until meta flips to that epoch

### 3. Shared mutable state is entity-based

These are the main V2 shared entity collections:
- `groups`
- `blocked_tokens`
- `manual_blocked_keywords`
- `token_merge_rules`
- `label_sections`
- `activity_log`

Important rule:
- manual blocked keywords are canonical only for explicit manual exclusions
- derived blocked-keyword effects from blocked tokens are not persisted as a giant fanout truth table

### 4. Shared V2 cache is acked-only

IndexedDB is still used, but only for **server-acknowledged canonical state**.

V2 cache entries now include:
- `schemaVersion`
- `datasetEpoch`
- `baseCommitId`
- `cachedAt`

Important rule:
- optimistic shared V2 edits are memory-only until Firestore acknowledges them
- refresh should not reopen on a shared edit that never committed
- canonical cache writes are serialized so an older cache persist cannot finish after and overwrite a newer canonical epoch/view

### 5. Revision-sensitive writes use CAS acknowledgements

Revision-sensitive V2 writes go through one compare-and-set path.

That path returns acknowledgements containing:
- `id`
- `revision`
- `lastMutationId`
- stored doc value for upserts

The client updates its local server-revision map immediately after ack.

Important result:
- same-client back-to-back writes do not have to wait for listener echo before building the next valid revisioned write

### 6. Epoch load fencing is explicit

The hook now uses:
- an epoch generation counter
- an epoch abort controller

So if:
1. epoch 10 starts loading
2. meta flips to epoch 11
3. epoch 10 resolves late

the stale epoch 10 load is ignored and cannot overwrite epoch 11 locally.

Listener callbacks are also fenced to the active project/epoch generation so stale callbacks from a previous project or prior epoch cannot mutate the current workspace state.

### 7. Operation locks are enforced in the persistence boundary

Bulk operations remain exclusive in phase 1:
- CSV import
- keyword rating
- auto-group
- token merge and related bulk rewrites

Important rule:
- manual V2 mutations are rejected in the persistence boundary when another client holds the active project lock
- this is not just a UI disable state

### 8. Old-client cutover is enforced client-side

When a project requires V2 schema:
- legacy write paths are blocked
- the client becomes read-only for unsupported schema versions

This prevents an older whole-project writer from reintroducing legacy overwrites into a V2 project.

### 9. Recovery workflow actively repairs stuck V2 meta

When a V2 project cannot load a ready canonical epoch, the recovery workflow **actively repairs** the Firestore `collab/meta` doc rather than leaving the user locked out:

1. `loadCanonicalProjectState` calls `loadCanonicalEpoch` — if it returns null, recovery always runs
2. `recoverStuckV2Meta` runs inside a Firestore transaction and inspects the actual meta state:
   - If the base commit exists and is valid + lock is available → finalize: set `commitState: 'ready'`, `migrationState: 'complete'`
   - If the base commit is missing/broken, OR `migrationState` is already `'failed'` but `readMode` is still `'v2'` → repair: reset `readMode: 'legacy'`, `migrationState: 'failed'`
3. After recovery writes, the next `loadCollabMeta` read picks up the repaired state
4. With `readMode: 'legacy'`, the project falls to the pure legacy persistence path — both users get full write access via `onSnapshot` chunk listeners
5. Other connected clients' meta listeners detect the `readMode` change and call `setWriteUnsafe(false)` automatically

**Critical invariant: no user is ever permanently locked into read-only mode.** Recovery must always attempt repair. The only legitimate read-only state is:
- `legacyWritesBlocked`: client schema version is too old (user must update the app)
- Temporary lock conflict during an active bulk operation by another client (resolves automatically)

Guardrails for the live meta listener:
- meta-driven reloads must use the same recovery-capable canonical path as bootstrap/conflict reloads when a lightweight epoch load is null or unresolved; do not rely on `loadCanonicalEpoch` alone for listener-driven recovery
- when a listener sees a newer `collab/meta` revision, only attach new epoch listeners from the final authoritative resolved meta state for that epoch
- while a meta-driven reload is in flight, routine shared edits may stay writable only if the current `collab/meta` still points at the same `datasetEpoch/baseCommitId` as the last acknowledged writable canonical base already loaded in memory; if meta has advanced to a different base commit or epoch, the persistence boundary must fail closed until that canonical load finishes
- when a listener sees `readMode` change from `'v2'` to `'legacy'`, immediately clear `isWriteUnsafe` and unlock writes
- UI success messaging for grouping/approve/unapprove/ungroup flows must only run after the mutation is actually accepted by the persistence boundary; blocked shared writes must preserve user selection/input and surface only the read-only warning

### 9a. Startup bootstrap must not mix legacy and V2 writes

Root cause of the March 2026 startup sync incident:
- the active project started bootstrap in a temporary local `legacy` mode before canonical V2 state finished resolving
- hidden Generate/Content surfaces were still mounted and performing real startup subscriptions, upstream sync, and persistence work
- that background work reached the legacy whole-project chunk writer during V2 bootstrap
- Firestore rules correctly rejected the write with `permission-denied` because the project was already V2
- the client then surfaced recovery/read-only state because `collab/meta` was not yet safely writable

Permanent guardrails:
- block legacy whole-project writes in the persistence boundary until the active project's storage mode is resolved
- if `collab/meta` or canonical cache indicates V2, do not allow fallback legacy chunk writes during bootstrap
- hidden idle Generate/Content surfaces must not attach shared listeners, run upstream auto-sync, fetch model metadata, or persist state until they are visible or actively busy
- `permission-denied` during V2 recovery/write paths must be surfaced as a rules/deployment/recovery problem, not a generic connectivity message

Do not replace this with a UI-only delay or debounce.
The fix must remain at the persistence boundary plus runtime-activity gating.

### 10. Deployment order matters

Rollout order for shared-project V2 changes:
1. deploy Firestore rules
2. deploy the client with the V2 reader/writer behavior
3. enable migration or cutover
4. monitor for stale legacy writers and recovery states

---

## What Was Implemented

### Storage and types

Implemented:
- immutable base commits with manifests
- exact manifest chunk-id validation
- `collab/meta` epoch activation
- canonical V2 cache metadata
- epoch-scoped entity docs
- canonical doc-id helpers
- ack-returning revisioned writes

Files:
- [src/projectCollabV2.ts](/C:/Users/chris/Downloads/KWG/src/projectCollabV2.ts)
- [src/types.ts](/C:/Users/chris/Downloads/KWG/src/types.ts)

### Hook / client behavior

Implemented:
- meta-driven epoch loading
- abort + generation fencing for stale epoch loads
- no raw `base_chunks` live-truth listener in V2 mode
- optimistic V2 shared state kept out of IDB until ack
- mutation-boundary lock/schema rejection before optimistic local apply
- startup write barrier so legacy chunk writes stay blocked until storage mode is resolved
- hidden Generate/Content runtime gating so idle mounted surfaces do not do background shared work during bootstrap
- step-aware recovery diagnostics for V2 permission/rules failures

File:
- [src/useProjectPersistence.ts](/C:/Users/chris/Downloads/KWG/src/useProjectPersistence.ts)

### Rules

Implemented where the current data model allows it:
- block legacy project-base writes after V2 cutover
- validate V2 meta/commit/entity document shape
- enforce epoch-scoped shared writes structurally

File:
- [firestore.rules](/C:/Users/chris/Downloads/KWG/firestore.rules)

### Tests

Implemented:
- storage regression tests for commit manifests and CAS acknowledgements
- hook regression tests for stale epoch loads, lock rejection, acked-only cache behavior, cache-write serialization, full flush barriers, stale listener callbacks after project switch, direct-setter blocking, and old-client cutover

Files:
- [src/projectCollabV2.storage.test.ts](/C:/Users/chris/Downloads/KWG/src/projectCollabV2.storage.test.ts)
- [src/projectCollabV2.test.ts](/C:/Users/chris/Downloads/KWG/src/projectCollabV2.test.ts)
- [src/useProjectPersistence.v2.test.tsx](/C:/Users/chris/Downloads/KWG/src/useProjectPersistence.v2.test.tsx)

### Documentation

Updated:
- [FEATURES.md](/C:/Users/chris/Downloads/KWG/FEATURES.md)
- [PERSISTENCE_AUDIT.md](/C:/Users/chris/Downloads/KWG/PERSISTENCE_AUDIT.md)
- [ARCHITECTURE.md](/C:/Users/chris/Downloads/KWG/ARCHITECTURE.md)
- this file

---

## What Is Still Left

These items are **not** unimplemented bugs in the Rev 2 plan. They are remaining hardening or platform gaps beyond the current scope.

### 1. True collaborator authorization

Current state:
- Firestore rules can enforce schema and structural invariants
- the repo does not have a real project-membership auth model

What is left:
- add authenticated project membership
- enforce read/write access by membership in rules

### 2. Server-authoritative timestamps for leases

Current state:
- lock and migration timing use client-authored timestamps

What is left:
- move lease timing to server timestamps or another trusted authority

### 3. Cleanup / compaction policy

Current state:
- old commits and old epoch docs may remain temporarily in Firestore
- readers ignore them correctly by epoch/meta

What is left:
- add explicit retention or cleanup policy if storage growth becomes a concern

### 4. Broader integration / E2E coverage

Current state:
- unit and hook regression coverage is strong

What is left:
- optional multi-client browser-level verification for lock/epoch transitions if we want end-to-end smoke coverage beyond the current test suite

---

## Guarantees The Current V2 Model Does Provide

The current implementation is intended to guarantee the following within the limits above:

- clients do not activate half-written base commits
- clients do not treat future-epoch entity docs as active before meta flips
- V2 refresh/reload does not reopen on unacked optimistic shared state
- same-client rapid V2 writes do not depend on listener timing to use the right revision
- V2 write paths reject mutation attempts during foreign bulk locks
- V2 projects do not accept legacy whole-project writes from this client code path once schema cutover is active

---

## Things This File Does Not Claim

This file does **not** claim:
- that every future sync bug is impossible
- that the repo has production-grade authorization
- that lock timing is fully server-trusted today

It does claim that the specific desync class targeted by the Rev 2 plan has been implemented and covered in this repo.
