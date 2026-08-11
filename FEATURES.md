# FEATURES.md — SEO Magic (KWG) Complete Feature Reference

> **Every feature in the application, fully documented.** Updated every time a feature is added or modified.

---

## Real-Time Sync & Persistence Architecture

**The #1 architectural invariant: every change is server-first.** No state exists only in the browser. Every user action that mutates data writes to Firestore immediately and is delivered to all connected clients in real-time via `onSnapshot` listeners. The full pipeline:

### Mutation Flow: User Click → Firestore → All Users

```
User Action (e.g. approve a group)
  │
  ├─ 1. Sync ref:  fooRef.current = newValue   (synchronous, never stale)
  ├─ 2. Bump ID:   saveCounterRef++             (monotonic per-mutation marker)
  ├─ 3. React:     setState(newValue)           (triggers re-render)
  ├─ 4. IDB:       checkpointToIDB(payload)     (crash-safe local durability)
  └─ 5. Queue:     enqueueSave()                (Firestore write queued)
         │
         └─ flushPersistQueue() loop:
              ├─ buildPayload() from latest.current (always fresh, never closure-stale)
              ├─ persistProjectPayloadToIDB()       (local durability first)
              ├─ saveProjectDataToFirestore()        (cloud write, 30s timeout)
              │     └─ On ACK → recordProjectFirestoreSaveOk()
              └─ Loop continues if new mutations arrived mid-await (coalesces bursts)
```

**Result:** 5 rapid clicks → 1-2 Firestore writes (coalesced), not 5.

### How Other Users See Changes Instantly

```
User A writes to Firestore
  → Firestore ACKs the write
  → Firebase SDK detects document change
  → All other clients' onSnapshot listeners fire
  → Each client:
       ├─ Checks snapshot guards (suppress own echo, pending writes, generation fence)
       ├─ Rebuilds ProjectDataPayload from snapshot docs
       ├─ Compares saveCounterRef (prefer newer)
       └─ Applies to React state → all users see the change within milliseconds
```

### 3-Tier Storage (all writes hit all 3 tiers)

| Tier | Purpose | Speed | Scope |
|------|---------|-------|-------|
| **localStorage** | Session metadata: active project ID, project list cache, settings cache | Synchronous, instant | Per-browser |
| **IndexedDB** | Full project data payload with `lastSaveId` marker. Crash recovery — if browser dies before Firestore ACK, IDB checkpoint survives | Async, ~5-50ms | Per-browser |
| **Firestore** | Cloud truth. Entity docs, chunked data, settings. Real-time `onSnapshot` delivery to all clients | Async, ~100-500ms | All users, all browsers |

### Snapshot Guards (Preventing Echo Overwrites)

When User A writes to Firestore, their own `onSnapshot` fires too. Guards prevent this echo from overwriting the local state that triggered the write:

- **`suppressSnapshotRef`** — set `true` during all Firestore writes; snapshot listener skips application while true
- **`isFlushingRef`** — set `true` during `flushPersistQueue`; snapshot evaluator returns `skip:isFlushing`
- **`firestoreLoadedRef`** — prevents async IDB cache reads from overwriting authoritative Firestore data that arrived first
- **`lastWrittenAtRef` + `updatedAt` comparison** — timestamps prevent own-write echoes on settings docs
- **`epochLoadGenerationRef`** — increments on project load; stale async operations from prior projects are discarded

### Crash Recovery (saveCounterRef + IDB Checkpoints)

```
User edits → saveCounterRef bumped to 42
           → checkpointToIDB saves payload with lastSaveId: 42
           → Browser crashes before Firestore write completes
           → On refresh: pickNewerProjectPayload compares:
              - IDB lastSaveId: 42 (local, newer)
              - Firestore lastSaveId: 41 (not yet ACK'd)
              - IDB wins → user's edit is restored
```

**`saveCounterRef` is NEVER reset** and increments atomically with every mutation.

### V2 Shared Project Sync (Entity-Per-Doc)

Shared projects (`description === 'collab'`) use V2 entity-per-doc persistence with compare-and-set (CAS) revisions:

```
Legacy (single chunk write):
  projects/{id}/chunks/meta + chunks/results_0, results_1, ...
  └─ All-or-nothing; no per-entity versioning

V2 (entity-per-doc):
  projects/{id}/groups/{groupId}        { revision: 5, lastMutationId: "m_xxx" }
  projects/{id}/blockedTokens/{tokenId} { revision: 3, lastMutationId: "m_yyy" }
  projects/{id}/collab/meta             { datasetEpoch: 42, readMode: 'v2' }
  └─ Per-doc CAS: only applies if incoming.revision > local.revision
```

**V2 mutation path (`queueV2Write`):**
1. Capture generation & epoch context
2. Create unique `mutationId` for this client
3. Build diff (old vs new entity docs)
4. Add to optimistic overlay (UI sees change immediately)
5. Write to Firestore with CAS revision check
6. On ACK: merge acknowledged revisions into local state
7. On conflict: roll back optimistic overlay, reload canonical state

### Exclusive Operation Locks (Preventing Concurrent Bulk Edits)

Dangerous operations acquire a Firestore-backed lock so only one client runs them at a time:

```
runWithExclusiveOperation(type, task):
  1. acquireProjectOperationLock() — Firestore transaction
       └─ Check no other client holds it
       └─ Write: { ownerId, ownerClientId, expiresAt: now+30s }
  2. Start heartbeat interval (every 5s, refreshes expiresAt)
  3. Run the async task
  4. flushNow() — wait for all queued writes to complete
  5. Release lock
```

**Lock types:** `csv-import`, `keyword-rating`, `auto-group`, `token-merge`, `bulk-update`

### Shared Mutation Results

All shared mutations return a typed result:
- `accepted` — Firestore ACK'd, all users see it
- `blocked` — lock conflict, read-only mode, or schema mismatch (toast shown, selection preserved)
- `failed` — Firestore error (toast shown, error logged)

### Cloud Sync Status (Top-Left Status Bar)

Real-time aggregation of all listener health:
- **"Cloud: synced"** — all writes ACK'd, listeners healthy
- **"Saving... don't refresh"** — IDB durability pending
- **"Saved locally — syncing..."** — Firestore write in flight (600ms display hysteresis)
- **"Sync problem — retry"** — Firestore write failed
- **"Offline — saved locally"** — no network

Hover tooltip shows: network state, database name, server snapshot status, project ID, flush queue depth, last save timestamp, listener channel errors.

### Key Invariants

1. **`latest.current` is never stale** — all mutations read from refs, never closures
2. **`saveCounterRef` is monotonic** — every mutation gets a higher ID than the last
3. **IDB checkpoint before Firestore flush** — crash recovery always works
4. **Snapshot guards prevent echo overwrites** — `suppressSnapshotRef`, `isFlushingRef`, `firestoreLoadedRef`
5. **V2 entity revisions are per-doc** — fine-grained CAS, no all-or-nothing writes
6. **`queueV2Write` serializes** — no concurrent writes to same entity doc
7. **Epoch isolation** — project switch aborts all stale operations from prior project
8. **Exclusive locks have heartbeats** — stale locks expire, preventing permanent deadlock
9. **Every project uses V2 sync** — `createProject()` hardcodes `description: 'collab'`
10. **Data must be visible to ALL users immediately** — this is a shared, multi-user app

---

## 1. Project Management

### Create Project
- User enters a project name → project created in Firestore with unique ID
- Hardcoded `description: SHARED_PROJECT_DESCRIPTION` (`'collab'`) activates V2 entity-per-doc sync
- Saved immediately to localStorage + IndexedDB + Firestore
- Each project stores its own independent keyword data, groups, settings, activity log

### Select Project
- Click a project row to switch active project
- **Two-phase loading:** Phase 1 loads from IDB (~5ms) and displays immediately. Phase 2 reconciles with Firestore in background — applies Firestore data only if strictly newer (by `lastSaveId`)
- Workspace clears immediately on switch (you never see the prior project's data)
- Project switching blocked while Generate/Content runs are active

### Rename Project
- Inline click-to-edit on project name in breadcrumb or project list
- Persisted to Firestore immediately

### Delete Project
- **Soft delete:** sets `deletedAt` timestamp; project moves to "Deleted" section (data preserved)
- **Restore:** clears `deletedAt`, project reappears in main list
- **Permanent delete:** removes from all storage layers (localStorage, IDB, Firestore metadata + data chunks)
- If deleting the active project, workspace state clears

### Project Folders
- Create named folders to organize projects
- Drag-and-drop projects between folders or use dropdown
- Rename, collapse/expand, delete folders (projects move to Unassigned)
- Persisted to Firestore `app_settings/project_folders` + localStorage + IDB

### URL Routing
- Each project has a stable URL: `/seo-magic/group/data/{projectUrlKey}`
- Deep links resolve correctly even during bootstrap (pending URL resolution)
- Browser back/forward works via `history.pushState`

---

## 2. CSV Upload & Processing Pipeline

### Upload
- Drag-and-drop or click-to-upload CSV file
- Supports CSVs with or without header rows
- Auto-detects header by checking if column E (volume) is numeric
- Auto-detects KD column by header name ("kd", "keyword difficulty", "difficulty")
- Import pinned to the project active when file was chosen — switching projects mid-import cancels it

### Processing Pipeline (16 steps, in order)

1. **Foreign entity blocking** — Keywords with foreign countries/cities (~200 countries, ~45 cities) auto-blocked
2. **Non-English/URL filtering** — Regex `[^\u0020-\u007E]` and URL patterns (www, http, .com, .org, etc.) → blocked
3. **Location extraction** — City and state detected from raw keyword text
   - NYC aliases: "nyc", "new york city" → city: "New York City", state: "New York"
   - LA alias: `\bla\b` → city: "Los Angeles", state: "California"
   - State matching: 2-word states first, then 1-word (skip "la")
   - City matching: city prefix index, longest-to-shortest word combinations (~30,000 US cities)
   - State-in-city rejection: prevents US state names from being tagged as cities
4. **Misspelling correction** — 120+ common misspelling fixes
5. **Hyphen/prefix normalization** — "re-finance" → "refinance", "e-mail" → "email"
6. **Local intent unification** — "near me", "close to me", etc. → "nearby"
7. **Singularization** — Runs BEFORE synonym lookup (maps only need singular forms)
8. **Synonym replacement** — 300+ curated SEO-intent synonym pairs
9. **Stop word removal** — ~130 standard English stop words + `vancouver`; `no`/`not`/`without`/`with` are **NOT** stripped (preserves negation intent)
10. **State normalization** — Full state names to abbreviations in token signatures
11. **Number normalization** — Word numbers to digits
12. **Stemming** — Lightweight suffix stripper (-ing, -ed, -er, -tion, -ment, -ness, -able, -ful, -ly); ~100 exception words
13. **Token merge rules applied** — Permanent project-level synonym rules (parent→children)
14. **Signature generation** — Deduplicated, sorted tokens = cluster key
15. **Clustering** — Keywords grouped by matching signature; highest-volume keyword = page name
16. **Label classification** — Auto-assigned labels:
    - **FAQ:** who, what, where, when, why, how, can, vs, compare, is, are, do, does...
    - **Commercial:** buy, price, cost, cheap, best, review, discount, coupon, sale, hire, service...
    - **Local:** near me, nearby, close to
    - **Informational:** guide, tutorial, tips, examples, meaning, definition, learn, course...
    - **Navigational:** login, sign in, contact, support, phone number, address...
    - **Location:** city or state found
    - **Number:** contains digits
    - **Year:** contains 202x/201x pattern

### Auto-Grouping on Import
- City clusters: all clusters with same city grouped together
- State clusters: state-only clusters (no city) grouped by state
- Group name = highest-volume cluster's page name

### Processing Performance
- Chunked in 2,000-row batches with `requestAnimationFrame()` for UI responsiveness
- Progress bar from 0-100%
- Generation guard detects project switches mid-import → cancels

---

## 3. Keyword Management (Group > Data — Left Panel)

### Tabs

| Tab | Contents | Key Actions |
|-----|----------|-------------|
| **Auto-Group** | Filtered auto-group workflow with LLM suggestions | Run auto-group, approve/decline suggestions |
| **Pages (Ungrouped)** | One row per unique token signature (cluster) | Select + group, expand to see child keywords |
| **All Keywords** | Every individual processed keyword row | View/filter/sort individual keywords |
| **Pages (Grouped)** | Manually or auto-grouped clusters in named groups | Approve, ungroup, expand, review status |
| **Group Auto-Merge** | AI recommendations to merge similar groups | Apply merge, dismiss, bulk operations |
| **Pages (Approved)** | Finalized groups ready for content generation | Remove from approved, export |
| **Blocked** | Keywords blocked during processing or manually | Unblock to restore |

### Columns (all keyword/page tables)
- Page Name, Len (token count), Tokens, KWs (keyword count), Vol. (search volume), KD (keyword difficulty), Rating (1-3 LLM relevance), Label, City, State

### Search
- Free-text search across page names and keywords
- 200ms debounce, case-insensitive substring match
- Clears selection on tab switch

### Filtering
- **Label exclusion dropdown:** toggle labels to hide
- **Range filters (all with 250ms debounce):**
  - Token length (min/max)
  - Keywords in cluster (min/max)
  - Volume (min/max)
  - KD (min/max)
  - Rating (min/max, 1-3)
  - Cluster count (min/max, grouped view)
- **Location filters:** city text, state text
- Filter results count displayed inline

### Sorting
- All column headers sortable (click to toggle asc/desc)
- Multi-sort: Shift+click for secondary sort columns
- Sort indicators with numbered order shown

### Pagination
- Options: 250, 500, 1,000 rows per page (default 500)
- Page navigation with Previous/Next, "Page X of Y" with filtered/total count
- Auto-corrects if filter reduces results below current page

### Expandable Rows
- **Pages tab:** click to expand → child keywords shown as indented sub-rows with Volume, KD, Rating
- **Grouped tab:** click group → shows member clusters; click cluster → shows child keywords

### Selection & Bulk Actions
- Checkbox selection on rows (select individual or select-all)
- **Group:** select ungrouped clusters + enter group name → creates GroupedCluster
- **Approve:** move grouped cluster to Approved tab
- **Unapprove:** move back from Approved to Grouped
- **Ungroup:** return grouped clusters to ungrouped Pages tab
- **Block:** block selected keywords or tokens
- **Unblock:** restore blocked items

### Grouping
- Select clusters from Pages tab → enter group name (auto-populated from highest-volume selection) → click Group
- Creates `GroupedCluster` with: id, groupName, member clusters, totalVolume, keywordCount, avgKd, avgKwRating
- Activity log entry created
- If shared project is read-only/recovering, action is blocked and selection preserved (no false success)

### LLM Keyword Relevance Rating ("Rate KWs")
- Two-phase OpenRouter job:
  - **Phase 1 — Core intent summary:** model outputs JSON summarizing the shared semantic intent of all keywords
  - **Phase 2 — Per-keyword ratings:** each keyword rated 1 (relevant), 2 (unsure), 3 (not relevant)
- Ratings appear in Rating column with green/amber/red styling
- Progress bar with percent, done/total, live 1/2/3 counts, elapsed time, cost, API call count
- Ratings persist per keyword in IDB + Firestore; rebuild into cluster/group averages on load
- Batch merges into latest results snapshot via refs (no stale overwrites during in-flight rating)
- On completion: forces immediate project flush, waits for Firestore ACK before showing toast

### Keyboard Shortcuts
- **Tab:** Group clusters (ungrouped) or Approve (grouped)
- **Shift+1:** Run Pages Auto Group (on Pages tab) or Auto Merge KWs (on Token Management auto-merge view)
- **Backquote (`):** Alias for Pages Auto Group when focus is not inside an editable field

---

## 4. Auto-Grouping (Group > Data > Auto-Group)

### Token Cascade Clustering (No API, Instant)

**Algorithm (`buildCascadingClusters`):**
1. **Identical stage:** find pages with 100% token overlap → 'high' confidence
2. **Stage N down to 2:** for each token count (max→2), find pages sharing N tokens
   - Greedy assignment: largest clusters get priority
   - Pages assigned once only
3. Remaining unassigned pages (2+ tokens) → single-page clusters
4. Single-token pages excluded

**Cluster properties:** sharedTokens, pages, confidence ('high'/'medium'/'review'), isIdentical, stage

### LLM-Powered Group Assignment

- Takes cascade clusters + sends to OpenRouter API
- Model: user-selected in settings
- Temperature, concurrency, reasoning effort: all configurable
- Max tokens: `8192 + n * 140`, capped at 65,536
- Batch size: up to 500 pages per API call
- Response parsed into `AutoGroupSuggestion[]` with group assignments + confidence + reason

### Filtered Auto-Group (Shift+1 from Pages Tab)

- Runs on the current visible ungrouped page list (respects all active filters)
- Captures that full filtered Pages snapshot at trigger time and processes all of those pages in one run
- When no filters active, uses explicit full-table scope
- Keeps only the latest pending run (prevents stale filter intents from stacking)
- **Singleton fallback:** any page the AI model omits from its response is automatically placed into its own singleton group, ensuring ALL accepted filtered pages end up grouped
- **Exact-once grouped invariant:** before Ungrouped is durably pruned, the grouped write normalizes duplicate AI assignments, strips stale accepted-page duplicates out of existing grouped state, and re-checks that every accepted filtered page appears exactly once in final grouped state
- Immediately marks the current filtered pages as pending so they disappear from Ungrouped as soon as the run is accepted
- Keeps the user on the Ungrouped tab while the run is in flight; Auto Group never forces a tab switch
- Stop cancels the in-flight run, clears queued Auto Group jobs, and restores pending pages back to Ungrouped
- Shared read-only / canonical reload transitions pause queued jobs instead of silently clearing them

### QA Review (Optional)

- Each auto-group suggestion runs through LLM semantic review
- Returns: `approve` or `mismatch` with mismatched page list and reason
- Normalizes LLM page names back to canonical names (handles spacing/casing variations)
- Cost tracked per review
- Sub-page dots: green for pages that belong, red for mismatched, amber for ambiguous

### User Actions on Suggestions
- **Approve:** converts to GroupedCluster, moves to Grouped tab
- **Decline:** keeps pages ungrouped
- **Approve All / Dismiss All:** bulk operations
- **Retry:** reprocess with retry counter

---

## 5. Token Management (Group > Data — Right Panel)

### Sub-tabs

| Sub-tab | Contents |
|---------|----------|
| **Current** | Tokens from currently active tab's visible/filtered clusters |
| **All** | All tokens in the project regardless of filters |
| **Merge** | Token merge rules (parent→children mapping) with collapsible rows |
| **Auto-Merge** | LLM-suggested token merges with confidence scores |
| **Blocked** | Permanently blocked tokens + universally blocked tokens |

### Token Display
- Columns: Token, Volume, Frequency, Avg KD
- Sortable on all columns
- Pagination: 100 items per page
- Search: comma-separated terms, substring match (e.g. "auto, mobile" matches either)
- Search forces parent expansion when child matches in Merge tab

### Token Merge Rules
- Parent token absorbs child tokens: all keywords re-tokenized with parent
- Merge rules applied during CSV import for future imports
- Structure: `{ parentToken, childTokens[], createdAt }`
- Undo merge: restores original token structure
- Impact preview: shows affected keywords/pages before confirming

### Auto-Merge (LLM-Powered Token Merging)
- "Auto Merge KWs" runs OpenRouter job comparing tokens for semantic identity
- "Test 10%" runs on top 10% of eligible tokens (by frequency/volume) for lower-cost trial
- Results table: canonical token, merge tokens, confidence (color-coded green/amber/red), impact, actions
- Sortable on all columns, defaults to highest confidence first
- Apply one, decline one, or bulk "Merge All" pending recommendations
- Strict-identity policy: only literal semantic identity or super-minor lexical variants
- Evaluation context includes top 5 pages per token
- Recommendations persist to IDB + Firestore, sync across users

### Token Blocking
- Block a token → all keywords containing that token move to Blocked tab (reason: "Token block: [name]")
- Universal blocked tokens: shared across all projects (stored in app settings)
- Project-level blocked tokens: per-project
- Unblock: removes from blocked, restores keywords to visible tabs

---

## 6. Group Auto-Merge (Group > Data > Group Auto-Merge Tab)

- Dedicated tab for finding semantic duplicate groups in the Grouped dataset
- **Embed** action: builds embeddings from group names + normalized location + top page names
- Compares all group pairs by cosine similarity (configurable embedding model + min similarity threshold)
- Recommendations shown with: similarity score, helper signals, expandable side-by-side page lists
- Actions per row: Merge, Dismiss; bulk: Merge Selected, Dismiss Selected
- Connected component resolution: A↔B + B↔C → all three merge into highest-volume group
- Recommendations fingerprinted against current grouped dataset (auto-stale if membership changes)
- Persisted to IDB + Firestore

---

## 7. Approved & Blocked — Complete Logic

### How Items Get Approved

1. **Group clusters** → creates `GroupedCluster` in Grouped tab
2. **(Optional) AI Group Review** → LLM validates group name vs member pages → approve/mismatch status
3. **Click "Approve"** → moves from `groupedClusters[]` to `approvedGroups[]`
4. Activity log entry: action='approve', details=groupName, count=cluster count
5. **Unapprove:** moves back to `groupedClusters[]`

### How Items Get Blocked

**Method 1: Block Token (Universal)**
- Select tokens → Block Tokens → adds to `blockedTokens` set
- All keywords containing blocked token automatically added to `blockedKeywords` with reason "Token block: [name]"
- Unblock token → removes associated keywords from blockedKeywords

**Method 2: Block Individual Keyword (Manual)**
- Block single keyword with custom reason
- Added to `blockedKeywords[]` with reason "Manual block"

**Blocking Effects:**
- Keyword excluded from all visible tables
- Cluster stats recalculated
- Not available for Generate/Content tabs
- Can be unblocked to restore

---

## 8. AI Semantic Group Review

- Reviews each group after creation via OpenRouter API
- Input: group name + top page names + member keywords
- Output: `approve` or `mismatch` + mismatched pages list + reason
- Status shown in Grouped tab: Pending / Reviewing / Approve / Mismatch / Error
- Separate settings: model, temperature, concurrency, max tokens, system prompt, reasoning effort
- Cost + timestamp tracked per review
- Groups auto-re-review when token merge affects them (`mergeAffected` flag)

---

## 9. Generate Tab (LLM Prompt Table)

### Overview
- Batch LLM generation with two independent sub-tabs: **Generate 1** and **Generate 2**
- Each has fully separate settings, API key, model, rows, outputs, logs, persistence
- Google Sheets-like table: #, Status, Input, Output columns
- Starts with 20 empty rows; auto-extends on paste beyond current rows

### Data Input
- Paste from Google Sheets (tab-separated, takes first column)
- Click any cell in Column B to start pasting
- Direct cell editing

### Generation
- Click "Generate" to fire all pending rows in parallel
- Status per row: Pending → Generating → Generated (or Error)
- Configurable concurrency (1-100, default 5)
- Stop button aborts mid-generation (visible "Stopping..." state until worker pool drains)
- Stats bar: total, generated, errors, generating, pending
- 60s per-request timeout enforcement
- Retry logic with configurable max retries for output length enforcement
- Automatic retry with exponential backoff for transient network errors (e.g. "Failed to fetch", connection resets) — up to 5 retries at 2s/4s/8s/16s/30s intervals, abort-safe
- Cost calculation: prompt tokens * prompt rate + completion tokens * completion rate

### Settings (within Generate tab)
- OpenRouter API key (shared across all Generate/Content surfaces)
- Model selector with search, pricing display, star/favorite
- Rate limit slider (1-100 concurrent)
- Temperature (0-2.0)
- Max tokens
- Reasoning effort (off/low/medium/high)
- Per-subtab model locking (pin model per content stage)

### Prompt Slot System
- Multiple named prompt slots per step (e.g., H2 Names, Page Guidelines alongside Page Names)
- Each slot: independent generate button, worker pool, abort controller, progress, cost
- Auto-populates from primary output with `{PAGE_NAME}`, `{H2_NAMES}`, `{KEYWORD_VARIANTS}` etc.
- Per-slot JSON mode and output transforms that write parsed metadata back onto the row

### Export / Clear / Undo
- CSV export includes slot columns
- Clear All / Clear Cell resets primary and all slot data
- Undo stack captures full row state including slots
- Bulk Copy per column group

---

## 10. Content Tab (Content Pipeline — 17 Stages)

### Pipeline Stages (Left-to-Right Flow)

| # | Stage | Source | Output |
|---|-------|--------|--------|
| 1 | **Overview** | All stages | Dashboard: progress, costs, bottlenecks, completion metrics |
| 2 | **Pages** | Approved groups | SEO-optimized page titles (<60 chars, question format) |
| 3 | **H2s** | Pages | 7-11 H2 subheadings per page (strict JSON contract) |
| 4 | **H2 QA** | H2s | 1-4 rating of H2 sets against keyword/page intent |
| 5 | **Page Guide** | Pages + H2s | Per-H2 editorial guidelines (strict JSON, no table formatting) |
| 6 | **H2 Body** | Pages + H2s + Page Guide | Full paragraph content per H2 section |
| 7 | **H2 Rate** | H2 Body | 1-5 quality rating per H2 body + feedback |
| 8 | **H2 Body HTML** | H2 Body (rated 1/2/5 only) | Semantic HTML (p, ul, ol, blockquote); deterministic validation |
| 9 | **H2 Summ.** | H2 Body | 2-3 sentence TL;DR per H2 |
| 10 | **H1 Body** | Pages + H2 Summ. | Intro paragraph for the page |
| 11 | **H1 Body HTML** | H1 Body | Semantic HTML with validation |
| 12 | **Quick Answer** | H1 Body | 2-paragraph Google SERP quick answer |
| 13 | **Quick Answer HTML** | Quick Answer | HTML with validation |
| 14 | **Metas/Slug/CTAs** | Quick Answer HTML | Meta title, meta description, URL slug, CTA headline + body |
| 15 | **Tips/Red Flags** | Metas/Slug/CTAs | Pro tips, red flags, key takeaways (3 prompt slots) |
| 16 | **Final Pages** | All above | Read-only assembled export table with publish-readiness tracking |

### Content Pipeline Features

- **URL-addressable subtabs:** `/seo-magic/content?subtab=h2s&panel=table`
- **Upstream dependency tracking:** derived stages auto-rebuild when upstream changes
- **Stale-input guard:** generated output only preserved when saved input matches current upstream prompt
- **HTML validation policy:** allowed tags, forbidden tags, leftover Markdown, bad links, wrapper quotes, capitalization
- **Rating gating:** rows rated 3/4 locked from HTML generation until rewritten; "Redo Rated 3/4" bulk action
- **Retry feedback:** validator failure text appended to next retry prompt
- **Per-subtab model locking:** each stage can pin its own model
- **Batch processing** with progress, cost, and token tracking
- **Per-project scoping:** rows, settings, logs all scoped to active project (not global)
- **Safe mode:** sync suspension under heavy load; row/payload thresholds
- **Final Pages export:** CSV with all assembled page content

### Overview Dashboard
- Total/blocked/active/complete page counts
- Per-stage completion percentage and cost
- Bottleneck identification
- Clickable stage rows jump to corresponding content tab
- Publish readiness: deterministic (all required fields present including first dynamic H2 pair)

---

## 11. Settings (Group > Settings)

### General Settings
- OpenRouter API key (masked, shared across app)
- Model selection with search, pricing, star/favorite
- Temperature slider (0.0-1.0)
- Max tokens input
- Concurrency slider (1-5)
- Reasoning effort dropdown (off/low/medium/high)

### Settings Sub-tabs

| Sub-tab | Contents |
|---------|----------|
| **General** | API key, model, temperature, concurrency, reasoning |
| **How-It-Works** | Educational docs: CSV processing, clustering, auto-grouping, QA |
| **Dictionaries** | View/edit: synonyms, stop words, locations, countries, stemmer exceptions |
| **Blocked** | Universal blocked tokens (org-wide) + blocked keywords |

### Per-Feature Settings (Group Review Settings Panel)

- **Group Review:** model, concurrency, temperature, max tokens, system prompt, reasoning effort
- **Keyword Relevance Rating:** separate model, temperature, concurrency, max tokens, prompt, core intent summary
- **Auto-Group:** prompt (reuses group review model)
- **Auto-Merge:** separate model, temperature, concurrency, max tokens, prompt, reasoning effort
- **Group Auto-Merge:** embedding model, minimum similarity threshold

All settings persisted to IDB + Firestore with real-time sync.

---

## 12. OpenRouter.ai API Integration

### Configuration
- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions`
- **Models endpoint:** `https://openrouter.ai/api/v1/models`
- **API key:** entered in settings, shared across all surfaces

### Model Selector
- Search by model name/ID
- Sort: name, price-asc, price-desc
- Star/favorite models for quick access
- Filter by type (chat, embedding)
- Display: cost in $/M tokens, context length
- Default: OpenAI GPT-5.4 mini

### Timeout Management
- 60s hard timeout per request (shared `runWithOpenRouterTimeout`)
- AbortController propagation
- Covers: response initiation + body read
- User-facing error on timeout with retry capability

### Uses in App
1. **Auto-Group** — cluster grouping suggestions
2. **Auto-Merge** — token merge recommendations
3. **Group Auto-Merge** — group similarity embeddings
4. **Group Review** — semantic approval validation
5. **Keyword Rating** — relevance scoring (1-3)
6. **Generate/Content** — all 15 content generation stages

---

## 13. Activity Log (Group > Log)

### Tracked Actions
- group, ungroup, approve, unapprove, remove-approved
- block, unblock
- merge-tokens, undo-merge, auto-merge
- auto-group, keyword-rating

### Log Entry Structure
- Timestamp (EST), action type badge (color-coded), details (human-readable), affected rows count
- Persisted per project in IDB + Firestore
- Search/filter by action type

---

## 14. Data Export

### Export by Tab

| Tab | Format | Contents |
|-----|--------|----------|
| Pages | CSV | Page Name, Len, Tokens, KWs, Vol., KD, Rating, Label, City, State |
| Grouped | XLSX (2 sheets) | Sheet 1 "Rows": group name + page rows; Sheet 2 "Unique Groups": summary |
| Approved | XLSX (2 sheets) | Same as Grouped |
| Tokens | CSV | Token, Vol., Frequency, Avg KD, Length, Label, City, State, Blocked flags |
| Final Pages | CSV | All assembled content fields |

**Filename:** `seo-magic_[project-name]_[tab]_export_[date]_[timestamp].[csv|xlsx]`

---

## 15. Stats Dashboard

### Summary Bar
- Total Groups | Pages Grouped / Total | % Grouped (2dp) | Grouped KWs | Grouped Volume
- (?) tooltips on each metric
- Tab badges: groups/pages format (e.g., 35/3,314)

### Collapsible Stat Cards
- Original Rows, Valid KWs, Clusters, Tokens, Cities, States, Numbers, FAQ, Commercial, Local, Year, Informational, Navigational
- Click to collapse/expand all

---

## 16. Feedback System

### Send Feedback (Header Button)
- Modal: choose Issue/Bug or Feature
- **Where in the app:** required dropdown grouped by area
- **Severity** (issues) or **Impact** (features): required 1-4 scale with color ramp
- **Details:** structured questions (not one blob)
- Optional screenshots (up to 3 images, ~2MB each) → Firebase Storage
- Auth for uploads: Google sign-in or Anonymous sign-in
- If screenshot upload fails, text still saved with warning toast

### Feedback Tab (Queue)
- Table: row #, type, rating, area, photos (thumbnails), full body text, author, date, copy, queue controls
- Filters: type, minimum rating, tag substring, free-text search
- Sortable columns: type, rating, date, queue priority
- Queue up/down swaps priority values in Firestore
- Per-row Copy button
- Persisted: Firestore `feedback` collection + IDB cache

---

## 17. Notifications Tab

- Route: `/seo-magic/notifications`
- Shared notification history from Firestore `notifications` collection + IDB cache
- Only explicitly marked shared alerts written (local-only confirmations remain toast-only)
- Filters: type (success/info/warning/error), source (group/generate/content/feedback/projects/settings/system), free-text search
- Relative timestamps ("just now", "Xm ago") + absolute (local + US Eastern)
- 16 regex-matched human-readable description patterns
- Summary stats bar with colored clickable badges per type
- Expandable long messages (>120 chars truncated with "more" toggle)
- Pagination: 50 per page
- Copy to clipboard

---

## 18. Updates Tab (Changelog)

- Route: `/seo-magic/updates`
- Current build name badge at top (from `app_settings/build_info`)
- Reverse-chronological changelog entries from Firestore `changelog` collection
- Each entry: build name, summary, date/time, bullet list of changes
- Real-time via `onSnapshot` — entries appear instantly when added

---

## 19. Feature Ideas Tab

- Route: `/seo-magic/feature-ideas`
- Read-only internal backlog of planned features
- Not persisted (static content)

---

## 20. Topics Library (Group > Topics)

- `Loans` topic catalog as table-based lead model for credit repair campaigns
- Comprehensive subtopics: personal, auto, mortgage, refinance, student, business, equity, medical, property, debt-relief
- Relevance score 1-4 with color-coded badges
- Lead Intent scoring 1-4
- Auto-calculated Best of Both Avg = (Source Rank + Lead Intent) / 2
- Sortable columns, inline editing, add/remove subtopics
- Dual seed keyword fields (Source + Intent)
- Multiple Ahrefs links per subtopic
- Persisted to IDB + Firestore `app_settings/topics_loans`

---

## 21. UI/UX Features

### Typography & Font System
- **Typeface:** Inter (Google Fonts CDN, weights 300–700), with system fallback stack
- **Global:** `font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11'` for Inter stylistic alternates; antialiased rendering
- **Size scale:** `text-[8px]`→sort indicators, `text-[9px]`→status badges, `text-[10px]`→labels/metadata, `text-[11px]`→child/detail rows + filter inputs, `text-[12px]`→all main table data cells, `text-xs`(12px)→form selects/textareas, `text-sm`(14px)→descriptions, `text-lg`(18px)→section headings
- **Weight convention:** `font-medium` (500) for labels/buttons, `font-semibold` (600) for badges/headings, `font-bold` (700) only for sort rank indicators
- **Monospace:** `font-mono` for code/regex inputs, token identifiers in management tabs, system IDs, tabular numeric counters
- **Token chips:** Unified `TokenChip` component (`text-[12px]`, bordered, purple selected/zinc default) used in ClusterRow, GroupedClusterRow — single source of truth for chip styling
- **Table cell standard:** `tableConstants.ts` defines `CELL.dataCompact`, `CELL.dataNormal`, `CELL.dataLabelLocation` all at `text-[12px]`; filter inputs at `text-[11px]`

### Layout
- Two-panel layout: Keyword Management (left) + Token Management (right)
- Compact chrome with reduced padding
- Unified tab system: segmented-control style across all tab levels
- Responsive breadcrumb navigation

### Top Status Bar
- Today's date, local clock, US Eastern clock
- Local weather from Open-Meteo (auto-detect location, °F for US / °C elsewhere)
  - 7-day forecast tooltip with min/max, icons, rain probability, nowcast insights
  - Refresh/retry buttons, graceful fallback for blocked location
- Cloud sync status badge with diagnostic tooltip

### Tables
- Alternating row colors
- Columns sized to content (no `w-full`)
- Draggable column resize (persisted to IDB per browser)
- Sticky header bar + sticky thead with dynamic top offset
- React.memo on row components for performance

### Toasts
- Bottom-left, compact, no animations
- Auto-dismiss with +1s dwell time
- Color-coded by action type (success/warning/error/info)
- Duplicate errors collapsed into one card with repeat count

### Tooltips
- CSS-based (instant, no delay)
- Portal-based for complex content (avoids clipping)
- InlineHelpHint: (?) icon with hover/focus/tap explanation

### Keyboard Shortcuts
- Tab: context-aware (group or approve)
- Shift+1: context-aware (auto-group or auto-merge)
- Backquote (`): Pages Auto Group alias outside editable fields
- Works from search/filter inputs without requiring click-out
- Escape: close tooltips/modals

---

## 22. Shared Projects & Collaboration

### V2 Entity-Per-Doc Sync
- Groups, blocked tokens, manual exclusions, token merge rules, label sections, activity log → independent entity docs
- Per-entity revision, datasetEpoch, lastMutationId, writer metadata
- Compare-and-set updates (not last-write-wins)
- Base snapshots: immutable commit sets under `base_commits/{commitId}` with ready manifest
- `collab/meta` doc is the activation barrier for epoch switching

### Collaboration Safety
- Project-busy banner / read-only state during exclusive operations
- Routine edits: manual grouping, approve, ungroup, block (routine write safety)
- Bulk edits: CSV import, keyword rating, auto-group, token merge (exclusive lock required)
- Same-browser bulk spam rejected before second lock attempt
- Failed V2 writes roll back optimistic overlays and reload canonical state

### Collaboration Diagnostics
- Bounded browser-local diagnostics journal
- Records: authoritative-sync transitions, phase changes, listener events, mutation outcomes
- `window.__kwgCollabDiagnostics.read(limit)` / `.clear()` for incident export
- Collaboration census/audit: `npm run collab:census`, `npm run collab:audit`
- Release gate: `npm run collab:release-gate` (convergence matrix + typecheck + tests + build)

---

## 23. Dictionaries

| Dictionary | Size | Purpose |
|-----------|------|---------|
| Synonym Map | ~300+ entries | Curated SEO-intent synonyms (singular forms only) |
| Misspelling Map | ~120 entries | Common finance/legal/English typos |
| Stop Words | ~130 entries | Standard English + `vancouver`; NOT: no, not, without, with |
| Foreign Countries | ~200 entries | Country names + abbreviations for blocking |
| Foreign Cities | ~45 entries | Major foreign cities for blocking |
| US Cities | ~30,000 entries | City recognition from `us-cities.json` |
| Stemmer Exceptions | ~100 entries | Words that should not be stemmed |

---

## 24. Performance Optimizations

- **React.memo** on all row components
- **useMemo** for expensive filter/sort computations
- **Debounced search** (200ms) and **debounced filters** (250ms)
- **Pagination** (500 items/page keywords, 100/page tokens)
- **Virtual scrolling** for 10k+ Generate rows
- **IDB-first loading** (~5ms) with background Firestore reconciliation
- **Chunked CSV processing** (2,000 rows/batch with rAF)
- **Coalesced Firestore writes** (rapid mutations → 1-2 writes)
- **Hidden instance suspension** (Generate/Content: suspend listeners, sync, fetches while hidden)
- **IDB queue serialization** (prevents transaction timeout contention)
- **Column width persistence** per browser (IDB, not shared)

---

## 25. Error Handling & Recovery

- **Persistence errors:** `reportPersistFailure()` → toast + `[PERSIST]` console context
- **IDB deadlock hardening:** bounded timeouts (open/read/write/delete); stalls → mark failure, continue Firestore
- **Firestore rules failures:** distinguished from connectivity problems in recovery diagnostics
- **Unsafe refresh warning:** native browser unload warning while local writes pending
- **Shared project recovery:** `recoverStuckV2Meta` resets `readMode` to `'legacy'` when V2 canonical state is unrecoverable
- **No permanent read-only:** if V2 is broken, recovery resets to legacy so both users can keep working
- **Schema version gating:** `CLIENT_SCHEMA_VERSION` checked; too-old clients → `legacyWritesBlocked`
- **Filtered Auto Group ownership guard:** shared V2 listeners never let an empty cache snapshot evict a newer local grouped-page ownership set, so accepted Auto Group pages do not leak back into Ungrouped while the authoritative server snapshot catches up
- **Transient network retry (Generate):** Primary and slot generation auto-retry `TypeError: Failed to fetch` and other browser-level network errors with exponential backoff (2s base, 30s cap, 5 max retries). Detection via `isTransientNetworkError()` in `openRouterTimeout.ts`. Abort-safe — user can stop mid-retry.

---

*Last updated: 2026-04-03*
