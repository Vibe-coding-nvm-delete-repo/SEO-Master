# Architecture

**Documentation map:** [`AGENTS.md`](./AGENTS.md) · [`CLAUDE.md`](./CLAUDE.md) · [`CONTRIBUTING.md`](./CONTRIBUTING.md) · [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md) · this file

This file gives the high-level system shape.

For the exact shared-project persistence contract, use [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md).
That doc also lists the current known limits and recovery rules for shared-project changes.

---

## System Overview

SEO Master Tool is a client-side SPA for:
- keyword processing and clustering
- manual grouping and approval workflows
- shared project collaboration
- AI-assisted grouping, review, and content generation

Core runtime pieces:
- React + TypeScript UI
- IndexedDB for fast local cache
- localStorage for small metadata
- Firestore for shared persistence
- OpenRouter for LLM-backed workflows

---

## Storage Model

### Small metadata

Used for:
- project list cache
- active project id
- tiny browser-only preferences

Primary store:
- `localStorage`

### Local durable cache

Used for:
- fast project reloads
- crash recovery
- canonical shared-project cache bootstrap

Primary store:
- IndexedDB

### Shared cloud state

Used for:
- project data shared across clients
- shared settings
- collaboration state

Primary store:
- Firestore

---

## Project Persistence Modes

### Legacy project mode

Legacy mode still exists for compatibility and migration.

Shape:
- broad project payloads
- legacy chunk docs
- local-first bootstrap with Firestore reconciliation

This is no longer the shared-project source of truth after V2 cutover.

### Shared project V2 mode

V2 is the current shared-project model for shared collaboration.

Design rules:
- large base data stays chunked
- base rewrites are immutable per commit
- mutable collaboration state lives in smaller entity docs
- `collab/meta` is the only epoch activation barrier
- IndexedDB caches only server-acknowledged canonical V2 state
- consult `SHARED_PROJECT_COLLAB_V2.md` before changing this flow, because that file also records the known limits and recovery behavior

See [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md) for the precise current contract.

---

## Shared Project V2 Shape

```text
projects/{id}/
  base_chunks/                       legacy compatibility only
  base_commits/{commitId}            base commit manifest doc
  base_commits/{commitId}/chunks/*   immutable base chunk docs
  collab/meta                        active epoch + active base commit pointer
  groups/*                           grouped / approved entity docs
  blocked_tokens/*                   canonical token blocks
  manual_blocked_keywords/*          explicit manual keyword exclusions
  token_merge_rules/*                merge rule entities
  label_sections/*                   label section entities
  activity_log/*                     append-only activity docs
  project_operations/current         bulk-operation lock doc
```

Important V2 rules:
- readers do not treat live mutable `base_chunks` as canonical V2 truth
- a new epoch becomes active only after `collab/meta` points to a ready base commit
- entity docs are filtered by `datasetEpoch`
- optimistic shared edits remain in memory until Firestore acknowledges them

---

## Shared Settings / Generate Shape

```text
app_settings/
  generate_rows
  generate_rows_2
  generate_settings
  generate_settings_2
  generate_logs
  generate_logs_2
```

This part of the app still uses smaller shared-doc patterns rather than the project V2 commit-barrier model.

---

## Data Flow

### CSV processing pipeline

```text
CSV Upload -> Parse -> Foreign Detection -> Non-English Filter
  -> Location Extraction -> Misspelling Correction -> 24/7 Normalization
  -> Hyphen/Prefix Normalization -> Local Intent Unification
  -> Singularize -> Synonym Replacement -> Remove Locations
  -> Remove Stop Words -> State Abbreviation -> Number Normalization
  -> Stemming -> Signature Generation -> Clustering
  -> Label Assignment -> Token Summary
```

### Legacy/local-first persistence flow

```text
React State -> IDB checkpoint -> Firestore background save
IDB fast load -> Firestore reconciliation -> React state
```

### Shared project V2 persistence flow

Manual collaboration write:

```text
User edit
-> optimistic memory overlay
-> Firestore compare-and-set write
-> ack updates local server revision map
-> canonical resolved state written to IDB
```

Bulk/base rewrite:

```text
Acquire project operation lock
-> write base commit manifest as writing
-> write immutable base chunks for the commit
-> write epoch-tagged entity docs
-> mark manifest ready
-> flip collab/meta to the new epoch + commit
```

Reader activation:

```text
Listen to collab/meta
-> fetch exact baseCommitId
-> validate ready manifest + exact chunk set
-> load current-epoch entity docs
-> atomically swap to the new canonical epoch
```

Bootstrap rules:
- cache fallback must stop once Firestore becomes authoritative
- cache-only empty snapshots must not wipe a good local view during startup
- stale async epoch loads must be fenced and ignored

---

## Key Data Types

| Type | Description |
|------|-------------|
| `ProcessedRow` | Single keyword row with tokens, metrics, labels, and location |
| `ClusterSummary` | A page-level cluster of related keywords |
| `TokenSummary` | Aggregated stats for one token |
| `GroupedCluster` | Manual/approved grouping of one or more clusters |
| `BlockedKeyword` | Explicitly excluded keyword row |
| `ProjectCollabMetaDoc` | Active V2 epoch + base commit pointer |
| `ProjectGroupDoc` | Shared grouping/approval entity doc |
| `ProjectBaseCommitManifestDoc` | Immutable base commit manifest |

---

## Component / Module Architecture

### High-risk concentration

These files are correctness-sensitive or still large:
- `App.tsx`
- `AutoGroupPanel.tsx`
- `GenerateTab.tsx`
- `useProjectPersistence.ts`
- `projectCollabV2.ts`

### Intentional separation

The codebase currently separates:
- pure storage / diff / canonical assembly logic in `projectCollabV2.ts`
- stateful shared-project client orchestration in `useProjectPersistence.ts`
- project serialization / chunking helpers in `projectStorage.ts`
- project view assembly / load behavior in `projectWorkspace.ts`

### Priority

Refactor and maintenance priority remains:
1. data integrity and shared-project correctness
2. active-path monolith reduction
3. performance, reuse, and cleanup work

---

## Performance Considerations

- expensive row rendering is memoized where possible
- IndexedDB is used for fast reloads and crash recovery
- large project data remains chunked for Firestore document limits
- shared-project V2 avoids whole-project rewrite churn for manual collaboration edits
- build output still has a large main chunk warning; this is known and separate from the persistence work

---

## Remaining Architectural Limits

These are known and documented:
- no real project-membership authorization model exists yet
- project operation lock timing still uses client-authored timestamps
- old commits and old epoch docs may remain until cleanup/retention is added

Those do not invalidate the current V2 commit-barrier design, but they are the next hardening layer if we want stronger guarantees.
