# Persistence Audit

Last updated: `2026-03-30`

This file summarizes the current persistence status of the repo.

It is intentionally blunt:
- what was wrong
- what was fixed
- what the current shared-project model is
- what still is not solved

For the exact shared-project V2 design and implementation status, use:
- [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md)

---

## Executive Summary

### Legacy snapshot-guard work

The earlier snapshot-guard fixes were real and still matter historically.

They addressed issues like:
- stale Firestore snapshots overwriting newer local work
- save-id ordering mistakes
- unsafe snapshot application during flushes
- IDB being overwritten by stale snapshot data

Those fixes remain valid for legacy/local-first behavior.

### Shared-project V2 work

Shared-project persistence no longer relies on the legacy whole-project mutable snapshot design.

The current shared-project model now uses:
- immutable base commits
- entity-level mutable collaboration docs
- epoch activation through `collab/meta`
- acked-only canonical V2 cache writes
- compare-and-set revisioned writes for shared mutable entities

This is the current source of truth for shared-project persistence.

---

## What Was Fixed In The V2 Hardening Pass

### 1. Partial base writes are no longer readable as live truth

Before:
- clients could still end up composing shared state from in-progress base chunk rewrites

Now:
- base data is written as immutable commits
- each commit has a manifest
- the reader requires a ready manifest and an exact manifest/chunk match before using that commit

### 2. Epoch activation is explicit

Before:
- a client could drift toward whatever subcollection state happened to be visible first

Now:
- `projects/{projectId}/collab/meta` is the only activation barrier
- future-epoch docs may exist, but they are ignored until meta flips

### 3. Shared optimistic state no longer poisons IDB

Before:
- an optimistic shared V2 edit could be cached locally before Firestore acknowledged it

Now:
- optimistic V2 shared edits stay in memory only
- IndexedDB stores only server-acknowledged canonical V2 state

### 4. Same-client rapid writes no longer depend on listener timing

Before:
- a second rapid write could be built against stale local revision knowledge

Now:
- revision-sensitive writes return acknowledgements
- the hook updates local server revision state immediately on ack

### 5. V2 write rejection now happens in the persistence boundary

Before:
- the UI could disable some actions, but the persistence boundary still left room for overlap

Now:
- V2 writes are rejected when:
  - a foreign bulk-operation lock is active
  - the project requires a newer client schema

### 6. Stale epoch loads are fenced

Before:
- a slower older epoch load could resolve after a newer one and still risk clobbering local state

Now:
- the hook uses generation fencing plus abort logic
- late stale epoch resolutions are ignored

### 7. Old V2 group docs are rewritten forward

Before:
- older V2 group docs with embedded `clusters` were only dual-read compatible

Now:
- canonical epoch loading rewrites those docs forward to the token-only invariant

---

## Current Shared-Project Guarantees

The current implementation is designed to guarantee:

- clients do not activate half-written base commits
- clients do not activate future-epoch entity docs before meta flips
- V2 refresh/reload does not reopen on unacked optimistic shared state
- same-client rapid revisioned writes do not depend on listener echo to get the next revision right
- V2 writes are blocked during foreign bulk operations
- this client does not keep writing legacy whole-project shared snapshots after V2 cutover

---

## Remaining Limits

These are real limits, but they are not “missed implementation” items from the Rev 2 plan.

### 1. No real membership authorization model

Current state:
- Firestore rules can enforce structure and cutover constraints
- the repo does not have a real collaborator membership model

Implication:
- rules are structurally protective, not fully collaborator-authenticated

### 2. Lock timing uses client-authored timestamps

Current state:
- operation lock timing is still based on client timestamps

Implication:
- weaker than a server-timestamp lease model

### 3. Old commits / old epoch docs may remain until cleanup is added

Current state:
- readers ignore them correctly by meta/epoch

Implication:
- correctness is preserved
- storage cleanup is still future work

---

## Validation And Coverage

Final validation run after the hardening + audit pass:
- `npx tsc --noEmit`
- `npx vitest run`
- `npx vite build`

Result:
- `86` test files passed
- `800` tests passed

Coverage added for this work includes:

### Storage coverage
- manifest mismatch rejection
- exact chunk-set validation
- canonical epoch load behavior
- canonical cache metadata
- compare-and-set acknowledgement return values

### Hook coverage
- stale epoch-load fencing
- rejection before optimistic local apply under a foreign lock
- acked-only V2 cache writes
- required-client-schema cutover blocking

---

## Historical Note

The older snapshot-guard fixes are still important, but they should no longer be read as the full shared-project strategy.

For shared projects, the repo has moved from:
- mutable whole-project snapshot replacement

to:
- commit-barrier base activation
- entity-level collaboration docs
- canonical acked-only cache behavior

If you are changing shared-project persistence, start with:
- [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
