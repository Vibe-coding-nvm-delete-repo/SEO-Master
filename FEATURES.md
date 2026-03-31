# FEATURES.md — Keyword Grouper Application

> This file documents all features and functionality. **Updated every time a feature is added or modified.**

---

## Topics Library (Group > Topics)

- Added a new `Topics` sub-tab under the `Group` tab.
- Added an initial `Loans` topic catalog as a table-based lead model for credit repair campaigns.
- Expanded `Loans` coverage with broad umbrella subtopics (personal, auto, mortgage, refinance, student, business, equity, medical, property, and debt-relief) so the topic net is comprehensive in addition to long-tail/problem-intent variants.
- Includes a comprehensive list of loan-related subtopics with a `1-4` relevance score (`4 = highest`) plus intent and rationale columns.
- Route support added for `/seo-magic/group/topics`.
- `Topics > Loans` is now a persisted editable grid with:
  - Sortable columns (subtopic, source score, intent score, average, seed KW counts, Ahrefs link count, notes).
  - `Lead Intent` upgraded to `1-4` scoring with color-coded badges.
  - Auto-calculated `Best of Both Avg = (Source Rank + Lead Intent) / 2` and top-row highlighting for highest averages.
  - Dual seed keyword recommendation fields (`Seed KWs (Source)` + `Seed KWs (Intent)`).
  - Full row editing: add/remove subtopics, edit scores/rationale/notes, add/remove/edit multiple Ahrefs links per subtopic.
- Live persistence to IndexedDB + Firestore (`app_settings/topics_loans`) so edits survive refresh and sync across users.

---

## Shared Project Collaboration (Group)

- Project persistence uses a V2 collaboration layer: large imported/base data remains chunked in Firestore, while groups, blocked tokens, manual keyword exclusions, token-merge rules, label sections, and activity log entries sync as independent entity docs instead of one whole-project snapshot blob. See `SHARED_PROJECT_COLLAB_V2.md` for current limits and recovery rules.
- V2 entity docs carry per-entity `revision`, `datasetEpoch`, `lastMutationId`, and writer metadata so cross-user manual edits can use compare-and-set updates instead of browser-local last-write-wins.
- V2 base snapshots write as immutable commit sets under `base_commits/{commitId}` with a ready manifest, and the shared `collab/meta` doc is the activation barrier for switching epochs. Clients do not treat in-progress `base_chunks` writes as live shared truth.
- Shared-project hydration follows a meta-driven epoch load: the client keeps the previous committed epoch visible, fetches one exact `baseCommitId`, waits for the current-epoch entity listeners to reach their initial snapshot, and swaps to the new canonical view only after that epoch is fully ready.
- IndexedDB caches only server-acknowledged V2 canonical state and tags that cache with `schemaVersion`, `datasetEpoch`, and `baseCommitId`, so refreshes cannot reopen on optimistic shared edits that Firestore never accepted.
- V2 mutation handling is epoch-scoped and centralized: revision-sensitive shared edits go through one compare-and-set path, reuse canonical doc-id helpers, update local acked revisions immediately on success, and reload canonical state on conflicts instead of leaving optimistic drift behind.
- Legacy projects lazily migrate to the V2 collaboration model on open, V2 readers prefer entity overlays over legacy blob fields, and permanent delete clears both legacy chunk docs and V2 collaboration docs.
- Shared project UI surfaces a project-busy banner/read-only state during exclusive operations, and multi-user-sensitive actions such as keyword rating, token merge/unmerge, auto-merge apply, and Auto Group runs acquire a temporary project operation lock before writing shared data.

---

## Content Pipeline (Generate > Content)

- Persistence hardening: stalled project cloud saves now time out and recover instead of leaving the status pill stuck on `Saving... don't refresh`, project IDB saves no longer pay for an extra full JSON deep-clone before the timed write path starts, and timed-out IndexedDB project writes now abort and reopen the cached DB connection before retrying so local durability does not keep hammering a poisoned transaction handle.
- Shared **app settings** local durability (Generate/Content row caches, UI prefs, etc.) now has an outer time bound as well: if IndexedDB never settles, the local-write pending counter clears and the status bar can recover instead of staying on “Saving… don’t refresh” with stacked pending counts after refresh.
- Runtime diagnostics hardening: persistence, snapshot-guard, and project lifecycle paths now emit structured correlation traces (`traceId` + ordered `hop`) through a shared `runtimeTrace` utility so save/snapshot loop causality can be proven from one session trace.

- Renderer-stability hardening pass for Generate/Content:
  - Per-instance `onBusyStateChange` wiring now uses stable callbacks and ref-forwarded parent notification so aggregate busy state does not thrash (avoids update-depth loops when the shell tracks Generate/Content busy).
  - `App` now mounts `Generate` and `Content` only when the tab is active or currently busy, instead of keeping both full trees mounted indefinitely.
  - `Content` now mounts only active/busy pipeline stages and unmounts hidden idle stages, reducing hidden listener/write pressure.
  - Generate instances now support `liveSyncEnabled` so hidden stages can suspend Firestore/upstream subscriptions while preserving active run continuity.
  - Added Content safe mode guardrails (row/payload thresholds) that suspend hidden sync under heavy pressure and temporarily block high-risk bulk rewrites.
  - Removed legacy `[DEBUG-LOOP]` logging noise from Generate runtime paths and added per-instance row payload estimation hooks for runtime pressure management.
  - Added targeted coverage for mount policy, hidden-busy retention, safe-mode sync suspension, cache bounds, and IDB singleton reuse.

- `Content` now supports a second external pipeline view: `Rating`, alongside `H2 Content`.
- The content-stage rail now uses shorter stage labels and a visual left-to-right flow treatment:
  - `Page Name` -> `Pages`
  - `H2 Names` -> `H2s`
  - `Page Guidelines` -> `Page Guide`
  - `H2 Content` -> `H2 Body`
  - `Rating` -> `H2 Rate`
  - `H2 Content HTML` -> `H2 Body HTML`
- Content stages now render with small icons plus `>` flow separators, and the rail can wrap to multiple lines without changing the underlying pipeline behavior.
- Added a leftmost `Overview` stage before `Pages` that summarizes pipeline progress, total/blocked/active/complete page counts, bottlenecks, highest-cost stage, latest completed stage, and clickable stage rows that jump directly into the corresponding content tab.
- `Rating` derives rows from generated H2 body rows and persists through the same localStorage + IndexedDB + Firestore pattern as the rest of Generate.
- Rating rows auto-build their prompt from page context, H2 name, and generated H2 content instead of relying on manual freeform prompts.
- Rating responses are requested as strict JSON and parsed into:
  - `Rating Explanation` in the main output column
  - `Rating Score` in a separate visible table column
- `H2 Content` now mirrors the `Rating Score` column so low-rated answers are visible directly in the rewrite view.
- `H2 Body` now labels its inherited guideline column as `Page Guide` to make it explicit that the field comes from the upstream page-guide stage, not from a separate H2-only guideline authoring step.
- `H2 Body` and `H2 Rate` now keep their upstream sync buttons visible as a recovery path when a user needs to manually rebuild derived rows from `Pages` or `H2 Body`.
- `H2 Body` row sync now rebuilds one canonical per-H2 context bundle from `Pages`, `H2s`, `Page Guide`, and `H2 Rate`, so the visible H2 table and the generated prompt input stay aligned on `Page Name`, `#`, `H2 Name`, `Rating Score`, and H2-specific guideline text instead of silently dropping those fields.
- `H2 Body` pipeline sync now ignores execution-only setting edits like concurrency, so changing concurrent request count no longer forces an unnecessary upstream row reload or clobbers the active table state.
- Generate settings now preserve local concurrency edits through hydration races, so `Concurrent Requests` changes in shared generate subtabs no longer snap back to `5` when Firestore or cache snapshots arrive late.
- Derived content subtabs now react to local upstream row updates with a local-preferred reload before Firestore catches up, so finishing `Pages`, `H2s`, `Page Guide`, `H2 Body`, or other upstream stages populates the next content subtab immediately instead of leaving it blank until a later remote snapshot lands.
- `H2 Content` includes a top-level bulk `Redo Rated 3/4` action that resets only the H2 answers currently rated `3` or `4` back to pending for rewrite.
- Shared Generate/Content instances now scope the header `Clear` button to the active visible subtab:
  - clearing a slot subtab only wipes that slot’s own generated state
  - clearing the primary/source subtab still invalidates dependent sibling slot data for correctness
- `Content` also includes an `H2 Content HTML` pipeline view that derives from H2 answers plus their ratings:
  - rows rated `1`, `2`, or `5` can generate HTML immediately
  - rows missing a rating or rated `3` / `4` stay visible but locked until they are fixed and re-rated
- Generated HTML now runs through a reusable deterministic HTML policy validator:
  - adds a `Validate` column with `Pass` / `Fail`
  - failed rows stay visible but move to error status so the user can regenerate them
  - validates baseline rules like allowed tags, forbidden tags, leftover Markdown markers, bad links, wrapper quotes, empty blocks, and capitalization
- Rating settings are fully separate from H2 Content settings while reusing the same OpenRouter API key behavior.
- The OpenRouter API key is now shared across Generate 1, Generate 2, H2 Content, Rating, and future Generate-based tabs via one local persisted key.
- Generate-based tabs now live-sync that shared OpenRouter API key across already-mounted instances, so changing it in one content/generate surface updates the others without a reload.
- The preferred default OpenRouter model across Generate/Content, Group Review, and dedicated Auto-Group settings is now `OpenAI GPT-5.4 mini` (`openai/gpt-5.4-mini`), with Keyword Rating and Auto Merge continuing to inherit the main Group Review model unless explicitly overridden.
- Generate/content model selection no longer snaps back to a previously hydrated shared/default model after the user picks a different option; local explicit selection now wins over late cache/Firestore/shared-model hydration.
- Generate/content model locking is now restored per visible subtab/view on refresh using the scoped persisted settings as the authoritative source of truth, so locked subtabs no longer silently fall back to `AI21: Jamba Large 1.7` during startup.
- Generate/content requests now enforce a hard 60s per-request timeout for both primary and slot pipelines, so a few hung provider requests cannot leave batches stuck forever in `active`.
- Generate settings now include a persisted reasoning dropdown, and reasoning is sent for both primary and slot requests when enabled.
- Added Playwright browser automation for the content pipeline through a hidden dev-only QA harness route (`/__qa/content-pipeline`):
  - uses deterministic in-memory app-settings/changelog state instead of real Firestore/OpenRouter
  - renders the real `ContentTab` + `AppStatusBar`
  - covers rating rewrite, HTML locking, HTML validation display, shared API key/log behavior, and the build badge tooltip
  - uses stable `data-testid` hooks on high-risk controls/cells so browser tests stay resilient across light UI refactors
- Added visible locked placeholder stages to the content rail so future automation steps are mapped without enabling unfinished logic yet:
  - `H2 Summ.`
  - `H1 Body`
  - `H1 Body HTML`
  - `Quick Answer`
  - `Quick Answer HTML`
  - `Metas/Slug/CTAs`
  - `Pro Tip/Red Flag/Key Takeaways`
- Locked future stages are greyed out, show a lock indicator, and open a placeholder panel instead of any live generation pipeline until their carryover logic and prompts are built.
- `Metas/Slug/CTAs` is now a live page-level stage sourced from `Quick Answer HTML`:
  - primary output generates `Meta Description`
  - `Meta Title` is derived directly from `Page Name`
  - `Slug` generates in its own slot and is also surfaced as a visible table column
  - `CTAs` generate as strict JSON in one raw slot output, then parse into separate `CTA Headline` and `CTA Body` columns
- `Pages` now hard-validates new `H2s` generations against a strict JSON object contract:
  - the `H2s` slot runs in JSON-object mode
  - new H2 outputs must be `{ "h2s": [...] }` with 7-11 sequential, unique H2 entries
  - invalid JSON now hard-fails the slot instead of falling back to loose line parsing
  - settings now include a persisted `H2 JSON Contract` reference field beside the normal prompt tabs
- `Pages` now keeps shared metadata columns visible while you switch into slot subtabs like `Page Guide`, and it adds an `H2s` preview column so the generated H2 outline stays visible during downstream review.
- `H2 Body` now rebuilds from authoritative shared Page Guide data during upstream sync, so per-H2 guideline text and formatting instructions no longer stay stuck at `(No guidelines generated yet)` after Page Guide JSON has been generated.
- `H2 Body` upstream sync now always rebuilds from the authoritative shared `Pages` rows before merging downstream outputs, so a newer local cache can no longer keep the `Page Guide` column frozen on stale placeholder text after a Page Guide save.
- Derived content subtabs now load their upstream source rows from Firestore instead of trusting a newer-but-stale local cache, so fresh Page Guide / H2 / summary updates propagate through downstream tabs without being masked by an in-flight local snapshot.
- Rows that broadcast upstream updates now wait for the local cache write to finish before emitting the shared refresh event, so the next tab cannot react to a half-written Page Guide snapshot and re-render stale `(No guidelines generated yet)` text.
- Derived content subtabs now reuse persisted outputs only when the current derived prompt still matches the saved upstream-driven input, so `Page Guide` / `H2s` / prompt changes immediately invalidate stale `H2 Body`, `H2 Rate`, and downstream content rows instead of leaving old generated text attached to the wrong source state.
- Downstream content builders now ignore stale upstream text unless the source row/slot is still in `generated` state, so resetting or erroring `Pages`, `H2s`, or `Page Guide` can no longer keep leaking old page titles/H2 context into `H2 Body` or `H1 Body`.
- Generate row snapshot reloads and deferred upstream syncs now wait for active content batches to go idle, and generation flushes its latest row state before those shared-doc reloads resume. This prevents `H2 Body` batches from dropping back to `pending`, losing visible outputs, or snapping generated counts back to zero mid-run while preserving downstream `H2 Rate` carry-over.
- Generate/content stop controls now keep a batch in a visible `Stopping...` state until the worker pool actually drains, discard late results after stop is requested, and abort retry backoff immediately. This prevents Stop from disappearing while hidden requests keep landing outputs underneath it.
- Generate/content requests now resolve the OpenRouter API key from the shared live key source at request time, so the Pages surface can no longer send a missing auth header after the key was updated on another already-mounted subtab.
- The shared OpenRouter API key now writes to the browser cache immediately on edit, and request resolution prefers the live in-memory value before falling back to shared cache so a stale cache cannot override a freshly entered key during content-tab hydration.
- Generate/content toolbars now use an explicit saving phase instead of an inferred `Finalizing...` state, and final row persistence is time-bounded before the CTA is released. This prevents Pages/H2 batches from getting stranded on a dead-end completion button while cloud sync cleanup lags or stalls.
- Content pipeline tables now use a more consistent compact column-width scale across subtabs, with tighter shared presets for metadata columns and clipped header overflow so narrow header labels and help icons no longer bleed into adjacent columns.
- The `H2 Body` rewrite banner and Generate shell now use the same compact spacing rhythm as the rest of Content, so stacked cards stay tight and consistent without collapsing into each other.
- Generate/content row persistence now sanitizes Firestore payloads more defensively and normalizes non-finite usage/cost values, preventing shared-doc `invalid-argument` sync failures when a model returns incomplete pricing metadata.
- Generate/content row persistence now chunks shared `app_settings` row docs by actual serialized payload size, so large H2/content row sets stay under Firestore's 1 MiB document limit instead of failing upstream sync writes.
- The top-left cloud status no longer claims failed shared-doc writes are "retrying" when they are really waiting for the next valid save, and invalid Firestore payload errors now surface with accurate notification copy instead of blaming the network.
- The top-left cloud status diagnostics are now project-first and domain-aware:
  - when a project is open, the headline prioritizes project persistence health instead of unrelated shared-doc/listener noise
  - the dropdown uses one live per-tab snapshot, so the chip and diagnostics stay in sync
  - diagnostics now split project vs shared-doc writes/sync times and show auxiliary listener issues separately
- Notifications are now larger and easier to read, stay visible an extra second, animate out on dismissal, show both local and US Eastern timestamps, and collapse repeated identical errors into one card with a repeat count.
- The `Overview` content subtab now uses tighter card padding, chip spacing, and progress-row rhythm so more of the summary fits onscreen before you have to scroll.
- `Pages` also includes a new `H2 QA` slot:
  - evaluates generated H2 sets against the keyword phrase and page title
  - returns strict JSON with a `1-4` rating plus flagged H2s when the set is off-intent
  - surfaces parsed `H2 QA` metadata on the main Pages table while preserving the raw slot JSON for audit/debugging
- `Page Guide` now follows the same strict JSON pattern:
  - the slot runs in JSON-object mode instead of a loose array/text flow
  - new outputs must be `{ "guidelines": [...] }` with one entry per H2 in the exact same order
  - invalid or mismatched guideline payloads now hard-fail the slot instead of being loosely accepted downstream
  - formatting recommendations that mention tables or tabular layouts now hard-fail validation, and legacy saved table-style formatting hints are sanitized before they can flow into `H2 Body`
  - settings now include a persisted `Page Guide JSON Contract` reference field and the Pages table shows a `Guide JSON` validation status column
- Content prompt policy now force-migrates stale saved `Page Guide` and `H2 Body` prompts that predate the no-table rule, auto-restores the current no-table page-guide validator text, and resets existing generated `Page Guide` slot rows back to pending when a stale page-guide prompt is detected so legacy table guidance cannot remain visible.
- `Final Pages` is now the read-only export surface for the assembled page output:
  - uses HTML-stage outputs for `Quick Answer`, `H1 Body`, and dynamic H2 descriptions
  - includes an `Export CSV` action for the assembled final table
  - final-table column widths were tightened so the grid is denser and easier to scan horizontally
- Content subtab routing is now canonical and URL-backed:
  - each content stage owns a real `subtab` route plus `panel=table|log`
  - returning to `Content`, browser back/forward, Overview jumps, and Final Pages source jumps now reconcile to the same route instead of drifting between URL, visible stage, and cached Generate view state
- Content readiness is now stricter and shared across `Overview` and `Final Pages`:
  - `generated` rows/slots with blank output no longer count as complete or publish-ready
  - `Overview` now includes a terminal `Final Pages` stage so publish readiness and stage completion use the same final assembled-page rules
- Prompt slots now support per-slot JSON mode and slot-output transforms that can write parsed metadata back onto the row while preserving the raw slot output.
- Generate and Content shared workspaces are now scoped to the active project instead of one global `app_settings` workspace:
  - page rows, downstream content rows, shared logs, and shared stage settings now survive refresh per project and are visible to collaborators on that same project
  - existing legacy global Generate/Content docs are imported once into a project the first time that project opens Generate or Content
  - browser-only UI state stays local, including the shared API key, active Generate rail tab, table/log view, and column widths
- Generate/content hydration now uses ref-first row/settings mutations plus local edit guards so late cache or Firestore hydration cannot overwrite the newest in-progress edits during startup, refresh, or deferred snapshot reloads.

---

## Auto Merge KWs (Token Management)

- New `Auto Merge KWs` action runs an OpenRouter job that compares each non-blocked token against all other non-blocked tokens and returns only lexically/semantically identical matches (including very minor spelling variants).
- Added a dedicated shared prompt (`Auto Merge Prompt`) in Group Review settings to control strict exact-identity matching behavior.
- Job UI mirrors `Rate KWs`: progress bar, processed/total counts, recommendation count, elapsed time, token usage, API calls, and cancel support.
- Added `Test 10%` action next to `Auto Merge KWs` to run a lower-cost trial on the top 10% of eligible tokens (ranked by frequency/volume) before a full run.
- Full-run startup no longer prebuilds a token->all-candidates matrix (which could freeze large projects at apparent `0%`); candidate chunks now stream per token and the running state yields once so progress paints immediately.
- Auto Merge JSON parsing is now hardened against malformed model wrappers (extra prose, fenced code blocks, and trailing objects), reducing false "did not return valid JSON" failures.
- Auto Merge default instructions are now explicitly strict: merge only for literal semantic identity or super-minor lexical variants with zero meaning drift; any ambiguity or nuance difference must be excluded.
- Auto Merge request payload now always includes a non-overrideable strict policy block (even if a custom prompt is saved), and recommendation assembly excludes transitive chain-only tokens that are not directly linked to the canonical token.
- Auto Merge evaluation context now includes top 5 pages per token (page name, keyword count, volume, avg KD) for source and candidate tokens; token hover in Token Management + Auto Merge shows the same top-page context.
- Auto Merge completion now forces an immediate project flush and waits for cloud write completion before the final toast; completion toast now distinguishes synced success vs local-complete/cloud-failed.
- Auto Merge results table now defaults to highest confidence first, supports sorting on every column header (canonical, merge tokens, impact, confidence, actions/status), and colors confidence percentages (green/amber/red bands) for faster scan.
- Applying an auto-merge recommendation now routes users directly to the `Merge` sub-tab (page 1) so the resulting merge rule is visible immediately.
- Token Management now includes an `auto-merge` sub-tab for review workflow:
  - Review recommendation rows with canonical token, merge tokens, confidence, and impacted keyword/page counts.
  - Apply one merge, decline one recommendation, or bulk `Merge All` pending recommendations.
- Approved recommendations remain visible with `Undo`, which reverses the applied merge via the existing merge undo cascade.
- Auto-merge recommendations persist to IndexedDB + Firestore and sync across users/projects.

## Group Auto Merge (Grouped)

- Keyword Management now includes a dedicated `Auto Merge` tab immediately to the right of `Grouped` for finding semantic duplicate groups after they have already been accepted into the real grouped dataset.
- The `Embed` action analyzes only the current `Grouped` groups, builds embeddings from each group's name, normalized location summary, and top page names, then compares all group pairs without requiring shared tokens.
- Auto Merge recommendations are shown in a dedicated review table with similarity score, helper signals, expandable side-by-side page lists, per-row `Merge` / `Dismiss` actions, and bulk `Merge Selected` / `Dismiss Selected`.
- Applying selected recommendations resolves connected components (`A-B` plus `B-C` becomes one merge), rebuilds one merged grouped cluster per component, keeps the highest-volume group name as the surviving label, and sends the merged result back through the existing grouped review flow.
- Recommendations persist to IndexedDB + Firestore as project data, sync across users, and are fingerprinted against the current grouped dataset so they are automatically treated as stale if grouped membership changes after an embed run.
- Group Review settings now include a persisted `Group Auto Merge` embedding model and minimum similarity threshold, reusing the shared OpenRouter API key.

## 1. Project Management

### Create Project
- User creates a project with a name and optional description
- Saved immediately to localStorage, IndexedDB, and Firestore
- Each project stores its own independent keyword data
- After creation, the app runs the same `loadProject` path as **Select Project** so workspace refs (save id, load fence) match the new empty project instead of inheriting the previous session’s guards.

### CSV import (cross-project safety)
- Large CSVs parse in chunks; import is **pinned to the project that was active when the file was chosen**. If you switch projects before parsing finishes, the import is **cancelled** (warning toast) and no data is written, preventing the previous bug where persistence used the **current** project ref while the UI branch used a **stale** project id and could save one project’s file into another’s storage.

### Projects tab (folders & deleted)
- **Folders:** Create named folders (Firestore `app_settings/project_folders` + localStorage + IndexedDB cache). Drag project cards onto **Unassigned** or a folder to set `folderId` on the project doc, or use the **Move to folder** control on each card (keyboard-accessible). Rename a folder by clicking its title; remove a folder with the trash control — projects in that folder move back to **Unassigned** (nothing is deleted).
- **Delete project (soft):** Trash on a card moves the project to **Deleted projects**; keyword data stays in IDB + Firestore until **Delete forever**. Removing a folder never deletes projects.
- **Restore / permanent delete:** Deleted list shows **Restore** (clears `deletedAt`) or **Delete forever** (same as legacy hard delete: metadata doc, chunks, IDB).
- If the active project is deleted or soft-deleted, the workspace clears and the app returns to the Projects sub-tab.
- **Startup safety:** when Firestore initially reports an empty project collection but the local project cache still has projects, the app now keeps the cached project list visible during bootstrap instead of wiping the Projects tab to blank before the shared list catches up.
- **Shared-settings bootstrap hardening:** Group Review settings, Auto Group settings, starred models, and universal blocked tokens now use the same guarded cache/bootstrap pattern so cache-only empty/missing Firestore snapshots cannot silently reset visible shared state during startup.

### Delete Project
- Trash icon on project card moves it to **Deleted projects** (see above). **Delete forever** in that list performs the final removal.
- Confirmation before soft-delete and before permanent delete
- Permanent delete removes from all storage layers (localStorage project cache, IDB, Firestore metadata + data chunks)
- If deleting the active project (soft or permanent), clears all workspace state

### Select Project
- Click project card to load its data. The workspace **clears immediately** when you select a different project, then loads that project’s saved data — you never see the previous project’s keywords on screen while the new one is loading (each project, e.g. Installment Loans vs Title Loans, stays visually separate).
- Project switching is blocked while any Generate or Content run is active or still finalizing persistence, preventing in-flight shared-doc writes from landing in the wrong project workspace.
- **IDB-first instant loading** (two-phase): Phase 1 loads from IDB only (~5ms) and displays immediately with `skipRebuild` (skips the O(n) `rebuildClusters` if `clusterSummary` keyword count matches `results.length`). Phase 2 runs `reconcileWithFirestore` in the background — compares `lastSaveId`, applies Firestore data only if strictly newer. Guards prevent stale reconciliation if the user switches projects or makes edits before Phase 2 completes. Falls back to the blocking parallel IDB+Firestore load if IDB cache is empty.
- **Blocking fallback** (no IDB cache): Loads IDB + Firestore in parallel; Firestore leg uses **`getDocsFromServer`** (falls back to cache if offline). Merges with `pickNewerProjectPayload`: monotonic `lastSaveId` (incremented on **every** local mutation before IDB checkpoint, not only on cloud flush), then `updatedAt`; **ties prefer Firestore**; safety rules when IDB has higher `lastSaveId` but **fewer CSV rows or fewer groups** vs server.
- If Firestore wins, IDB cache is refreshed from it
- Restores all state: results, clusters, tokens, groups, blocked keywords, stats
- **`user_preferences` listener:** syncs **`savedClusters`** in realtime from the shared Firestore doc. It does **not** apply `activeProjectId` from remote snapshots — another collaborator (or stale cloud data) cannot switch your focused project; active project is chosen at init (URL + local/IDB prefs) and only changes from explicit in-app actions. Local changes still **write** `activeProjectId` to that doc for backup/cross-device visibility, but incoming listener updates ignore that field.

### Persistence
- Project metadata: localStorage + Firestore projects/{id} doc
- Project data: IDB (local cache) + Firestore chunked subcollections (results/clusters/suggestions in ~400 rows/doc; grouped/approved groups in smaller chunks to avoid Firestore 1MB doc limits)
- Firestore database selection is environment-configurable via `VITE_FIRESTORE_DATABASE_ID`; when unset, the app uses the default Firestore database so startup does not hard-crash with Firestore `NOT_FOUND` (code 5) if a named DB is missing
- **IndexedDB saves are serialized** with the same queue as Firestore writes (same order as local mutations). Previously IDB used concurrent writes — an older save could finish last and overwrite a newer one, so a refresh showed stale “ungrouped” state.
- **Serialized persist flushes:** each mutation queues `flushPersistQueue` immediately (no 500ms debounce). The flush worker’s **while** loop still coalesces if new mutations arrive **during** `await` I/O, so rapid bursts don’t stack dozens of redundant full writes. Auto-group **suggestion** text still uses a 2s idle debounce before enqueueing a flush (high-frequency typing).
- **Crash-safety IDB checkpoints:** every state mutation now writes an immediate best-effort snapshot to IndexedDB before queued Firestore flushes, and auto-group suggestion edits also checkpoint instantly. Each mutation bumps `lastSaveId` so the merge step always prefers that snapshot over stale cloud data until the next successful flush. This reduces data loss if the tab crashes or reloads before coalesced cloud writes finish.
- **Database targeting hard lock:** Firestore is now pinned to the workspace database (`first-db`) at runtime. `VITE_FIRESTORE_DATABASE_ID` cannot switch databases anymore; non-matching values are ignored and logged as configuration errors.
- **DB lock tests:** database resolution is centralized (`resolveFirestoreDatabaseId`) and covered by tests that enforce lock behavior for missing, matching, and invalid env values.
- Chunk hydration reconciles `meta` chunk counts with visible chunk docs so mid-save Firestore snapshots cannot drop grouped/approved rows; grouped/approved chunk docs are stamped with `saveId` and hydration rejects snapshots where chunk `saveId` doesn’t match `meta.saveId`
- Active project ID persisted in localStorage for session restore
- **Sync failure visibility:** Firestore listener errors and failed writes for project chunks, group review settings, starred models, universal blocked tokens, and project rename surface a toast plus `[PERSIST]` console context (see `persistenceErrors.ts`).
- **P0.1 atomic paths:** Remove-from-approved and ungroup flows call `removeFromApproved` / `ungroupPages` in `useProjectPersistence` (with matching `results` row rebuilds); project list fileName display uses `syncFileNameLocal`; CSV processing uses `syncFileNameLocal` when a project is active; Reset uses `clearProject()` when a project is active. The persistence hook’s `removeFromApproved` no longer pushes whole approved groups’ clusters into `clusterSummary` (that matched the previous App `bulkSet` behavior, not the buggy unused hook path).
- **Ungrouped duplicate guard:** restoring pages from `Grouped` / `Approved` now refuses to append a second copy of an already-present token signature, so duplicate pages and duplicate keyword rows cannot be re-added to Ungrouped even if an upstream selection or stale state tries to restore the same page twice.
- **Generate tab sync:** Generate 1/2 Firestore saves and listeners use the same toast + `reportPersistFailure` pattern as the Group tab.
- **Unified persistence contract:** team-shared `app_settings` documents (Generate rows/logs/settings, starred models, universal blocked tokens, group review settings, auto-group settings, cosine summary cache, topics loans data, user preferences, project folders, etc.) use the same path: local durable mirror first (IndexedDB, plus localStorage where used for quick paint), then Firestore, with common status/error reporting. **Per-browser only (no cross-user sync):** Generate 1/2 rail choice, Generate table vs log + status filter, and keyword table column widths — those persist in IndexedDB/localStorage on this device only.
- **Top-left status now shows write safety:** the cloud status chip turns amber for `Saving… don’t refresh` while IndexedDB durability is still pending, amber for `Saved locally — syncing…` while Firestore is still in flight, rose for local durability failures (`Save failed — local data at risk`) and cloud retry states, and keeps richer local/cloud details in the tooltip. When healthy, the chip adds a muted **clock suffix** after each successful Firestore write (project or shared doc), e.g. `Cloud: synced · 3:45:02 PM` — stable text that only changes when a new write completes (no per-second UI churn). The **Saved locally — syncing…** state uses **display hysteresis** (~600ms after writes finish) so rapid back-to-back Firestore operations do not flash synced/syncing.
- **Unsafe refresh warning:** the browser now shows a native unload warning if you try to refresh while a local durability write is still pending or after a local save failure that could lose the latest edits.
- **Visible local failure reporting:** IndexedDB failures now surface through the same status/toast flow instead of silently disappearing into the console.
- **IDB deadlock hardening:** local persistence writes now use bounded timeouts (open/read/write/delete). If an IDB operation stalls (for example cross-tab lock contention), the app marks local persistence failure instead of hanging forever on `Saving… don’t refresh`, and project/shared Firestore sync can continue.
- **IDB queue hardening:** all IndexedDB `readwrite` mutations now run through one explicit queue before opening a transaction, so a later save no longer burns its timeout budget just waiting behind earlier writes on the shared object store. This specifically reduces false local-durability failures in Generate/Content when many shared-doc caches are writing at once.
- **Duplicate error-toast hardening:** identical persistence errors fired back-to-back in the same tick now collapse into one toast immediately, preventing hidden Generate/Content instances from stacking a visible pile of the same `Local save failed` message.
- **Startup migration safety:** the Firebase-project migration path no longer calls `indexedDB.deleteDatabase` during startup, preventing cross-tab blocked-delete states from stalling live persistence.
- **Shared-project bootstrap write barrier:** legacy project chunk writes now stay blocked until the active project's storage mode is resolved, so V2/shared projects cannot briefly fall back to legacy chunk saves during startup and trip `permission-denied` rules failures.
- **Hidden runtime gating for Generate/Content:** Generate 1/2 and Content pipeline stages stay mounted for continuity, but hidden idle instances now suspend Firestore listeners, upstream auto-sync, OpenRouter model/balance fetches, and persistence effects until that surface becomes visible or actively busy.
- **Recovery diagnostics hardening:** shared-project recovery now distinguishes Firestore `permission-denied` / rules-state failures from generic connectivity problems, includes the failing V2 step in diagnostics, and shows a specific read-only warning when recovery itself is blocked by permissions.
- **Auto Group hydration baseline:** Auto Group shared settings now seed their saved baseline from the hydrated cache/Firestore payload so unchanged startup settings no longer immediately re-save on mount.
- **Refresh/data-loss hardening:** legacy project snapshot guards now block destructive effective-empty/legacy-saveId payloads unless they are server-authoritative and newer; Generate upstream sync now refuses transient empty clears when local rows still contain meaningful content (including input-only rows), dedupes repetitive upstream success notifications, and removes redundant row-level best-effort local writes that previously amplified IDB contention.
- **Generate logs/settings bootstrap safety:** Generate logs now use a Firestore-authoritative bootstrap guard before persisted writes, and immediate model-normalization settings writes no longer hit Firestore before settings bootstrap authority is established.
- **Status accuracy for active projects:** the top status headline now surfaces shared-doc and auxiliary failure states even with an active project open, and feedback write paths now feed shared cloud write telemetry so failures are visible in status diagnostics.

---

## 2. CSV Upload & Processing

### Upload
- Drag-and-drop or click-to-upload CSV file
- Supports CSVs with or without header rows
- Auto-detects header by checking if column E (volume) is numeric
- Auto-detects KD column by header name

### Processing Pipeline (in order)
1. Foreign entity blocking — Keywords with foreign countries/cities auto-blocked
2. Non-English/URL filtering — Routed to N/A cluster
3. Location extraction — City and state detected from raw keyword
4. Misspelling correction — 120+ common misspelling fixes
5. Hyphen/prefix normalization — "re-finance" to "refinance", "e-mail" to "email"
6. Local intent unification — "near me", "close to me", etc. to "nearby"
7. Singularization — Runs BEFORE synonym lookup (so map only needs singular forms)
8. Synonym replacement — 300+ curated SEO-intent synonym pairs
9. Stop word removal — common English stop words (includes `vancouver` so city tokens do not create separate page signatures; `no` / `not` / `without` / `with` are **not** stripped so negation phrases keep distinct signatures)
10. State normalization — Full names to abbreviations in token signatures
11. Number normalization — Word numbers to digits
12. Stemming — Lightweight suffix stripper (-ing, -ed, -er, -tion, -ment, -ness, -able, -ful, -ly)
13. Signature generation — Deduplicated, sorted tokens = cluster key
14. Clustering — Keywords grouped by matching signature
15. Label classification — FAQ, Commercial, Local, Informational, Navigational, etc.
16. Auto-grouping — Location clusters grouped by city/state automatically

### Location Detection
- States: All 50 US states recognized by full name or 2-letter abbreviation
- Unified state labels: Always displayed as full name (e.g., "Arizona" not "AZ")
- NYC unification: "nyc", "new york city" to city "New York City", state "New York"
- LA handling: "la" treated as "Los Angeles" (not Louisiana)
- State-in-city rejection: States detected in city column are moved to state column
- Cities: ~30,000 US cities from us-cities.json

### Blocking
- Foreign keywords: Auto-blocked during processing (200+ foreign countries, 45+ foreign cities)
- Edge cases handled: Panama City FL, Vancouver WA, Grenada MS, Mexico MO, New Mexico — not blocked
- Blocked tab: Shows all blocked keywords with reason, volume, KD

---

## 3. Keyword Management (Left Panel)

### Tabs
1. Auto-Group — Filtered auto-group workflow
2. Ungrouped — Clustered keywords (one row per unique token signature); **Rating** shows cluster average (1–3) from rated keywords
3. **All Keywords** — Every processed keyword row (page name, tokens, keyword, volume, KD, **Rating**, label, city, state)
4. Grouped — Manually or auto-grouped clusters; **Rating** is the group aggregate (weighted by keyword count)
5. Approved — Approved groups (same columns as Grouped, including **Rating**)
6. Blocked — Keywords blocked during processing; **Rating** when known (e.g. token-block rows carry `kwRating` from results)

### LLM keyword relevance (All Keywords)
- **Rate KWs** (compact control under Keyword Management): two-phase OpenRouter job using the **same API key** as Group Review; configure a **separate model, temperature, concurrency, max tokens, reasoning, and rating prompt** under **Keyword relevance rating** in the Group Review settings panel.
- **Phase 1 — Core intent summary:** model outputs JSON summarizing the shared semantic intent of all keywords; stored in settings (read-only textarea + timestamp).
- **Phase 2 — Per-keyword ratings:** each keyword receives JSON `{"rating":1|2|3}` (1 = relevant to core intent, 2 = unsure, 3 = not relevant). Ratings appear in the **Rating** column with soft green / amber / red styling.
- **Filters:** min/max **Rating** (1–3); rows without a rating are excluded when either bound is set.
- **Progress:** bar, percent, done/total; live **1 / 2 / 3** counts (same styling as the Rating column); **elapsed time**, **OpenRouter cost** (`usage.cost` when returned), **prompt/completion token totals**, and **API call count** (1 summary + one per keyword); checkmark when complete; success toast summarizes counts + duration + cost when known; **Cancel** aborts in-flight requests.
- **Done means cloud-written:** when `Rate KWs` finishes, the app now forces an immediate project flush (skips debounce) and waits for queued Firestore writes before showing the completion toast. Toast copy now distinguishes **synced** vs **local complete but cloud write failed**.
- **Persistence:** `kwRating` on each `ProcessedRow` is saved with the project (IndexedDB + Firestore); ratings are written in batches after each parallel chunk. Each batch merges into the **latest** results snapshot (ref + last merged write) so in-flight rating does not overwrite concurrent edits from a stale array.
- **Live UI:** After each batch, `clusterSummary` is rebuilt from results and **Grouped** / **Approved** groups get fresh cluster rows + aggregates so **Ungrouped / Grouped / Approved** rating columns update in real time (not only after the job finishes).
- **After refresh:** On project load (IDB/Firestore), `clusterSummary` and group cluster rows are **always rebuilt from `results`** so `kwRating` on rows is the source of truth — rating columns stay filled and the Rate KWs control shows **done** / partial progress from saved `kwRating` (job UI state itself is not persisted).

### Search
- Unified search across all tabs
- Searches page names (top-level cluster name)
- Instant results (no debounce delay)

### Filtering
- Label filter: Dropdown to exclude specific labels
- Token length filter: Min/max token count
- Token selection: Click any token to filter by it
- City/State filters: Text input filters
- Volume range: Min/max volume
- KD range: Min/max keyword difficulty
- **Rating** range (all keyword-management tabs): Min/max 1–3; **All Keywords** filters per-row `kwRating`; **Ungrouped / Grouped / Approved** filter by cluster/group **average** rating; **Blocked** filters by stored rating when present
- KW count range: Min/max keywords in cluster

### Sorting
- All column headers are sortable (click to toggle asc/desc)
- Sort indicators (arrows) shown on active sort column
- Works across all tabs: Keywords, Pages, Tokens, Grouped

### Pagination
- Options: 250, 500, 1000 rows per page
- Default: 500
- Page navigation with Previous/Next buttons
- Shows "Page X of Y" with filtered/total count

### Grouping
- Select multiple clusters via checkboxes
- Enter a group name (auto-populated from highest-volume selected cluster)
- Click "Group" to create a group
- "Grouping Progress" now shows a real-time ETA (and measured pages/sec) next to the percent while you’re grouping
- Groups appear in the Grouped tab
- Ungrouping: select groups/sub-clusters and ungroup them back to Pages

### Auto-Grouping (on CSV upload)
- City clusters: All clusters with the same city are grouped together
- State clusters: All state-only clusters (no city) are grouped by state
- Group name = highest volume cluster's page name
- If cluster has both city and state, it goes into the city group

---

## 4. Token Management (Right Panel)

### Sub-tabs
1. Current — Tokens from currently filtered keyword set
2. All — All tokens regardless of filters
3. Merge — Merged parent tokens with collapsible child tokens + unmerge controls
4. Blocked — Blocked tokens and their associated keywords

### Features
- Search bar for finding tokens (supports comma-separated terms, matches any)
- Sortable columns: Token, Volume, Frequency, KD
- Bulk select with checkboxes
- Block/Unblock tokens
- Unblocking from the Blocked sub-tab switches Keyword Management to **Ungrouped** and Token Management to **Current** (so the token is shown in the usual ungrouped scope)
- When a token is blocked, all keywords with that token move to Blocked tab
- Clusters and groups recalculate after blocking
- Merge/Unmerge tokens via token merge rules (parent + nested children shown under a collapsible row)
- Merge search matches both parent tokens and child tokens; if a child matches, its parent row auto-expands

### Token Display
- Each token wrapped in a light gray rounded pill/badge
- Makes individual tokens visually distinct

---

## 5. Stats Dashboard

### Collapsible/Expandable Cards
- Cards for: Original Rows, Valid KWs, Clusters, Tokens, Cities, States, Numbers, FAQ, Commercial, Local, Year, Informational, Navigational
- Default: expanded
- Click to collapse all; click again to expand all

### Summary Bar
- Total Groups | Pages Grouped / Total | % Grouped (2 decimal places) | Grouped KWs | Grouped Volume
- (?) tooltips on each metric explaining what it means
- CSS-based tooltips (appear instantly on hover, no delay)

---

## 6. Data Display

### Table Styling
- Alternating row colors (light gray on even rows)
- Columns sized to content (no stretching)
- Column headers: KWs, Vol., KD (abbreviated)
- Page name font: slightly lighter color for readability
- Token column: same width as page name column
- Len column: positioned to right of tokens

### Expandable Rows
- Pages tab: Click to expand — child keywords render as extra table rows: keyword text is indented under **Page Name**; **Len**, **KWs** (1 per child), **Vol.**, **KD**, **Rating**, and location columns align with the main header (no horizontal scroller, no “Keywords in Cluster” header or Save/Generate actions)
- Grouped tab: Click to expand groups to sub-clusters; expand a sub-cluster to see the same column-aligned child keyword rows

### CSV Export
- Export button downloads current view as CSV
- Includes all columns with proper headers
- Export buttons are available on both the `Grouped` and `Approved` tab toolbars
- For `Grouped` and `Approved`, export downloads a single `.xlsx` file with 2 tabs: `Rows` and `Unique Groups` (page count, summed KWs, volume, avg KD, labels)

---

## 7. Dictionaries

### Synonym Map (~300+ entries)
- Curated SEO-intent synonyms (not generic thesaurus)
- Verb-noun normalization: verify/verification, approve/approval, etc.
- Only singular forms needed (singularize runs first)

### Misspelling Map (~120 entries)
- Common typos for finance, legal, and general English terms

### Stop Words (~130 entries)
- Standard English stop words, plus `vancouver` (always stripped from signatures; also listed under foreign cities for foreign-entity detection)
- **Not** stripped: `no`, `not`, `without`, `with` (preserves negation / “with no title” style intent in token signatures)

### Foreign Countries/Cities
- ~200 foreign country names + abbreviations
- ~45 major foreign cities
- Edge cases: US cities sharing names with foreign places are NOT blocked

### Stemmer
- Lightweight rule-based suffix stripper
- Exception list for words that should not be stemmed (~100 entries)
- Results cached for performance

---

## 8. UI/UX

### Layout
- Two-panel layout: Keyword Management (left), Token Management (right)
- Both panels at same vertical level
- **Compact chrome:** main shell uses reduced padding (`px-4 py-3`); **status bar** (sync + clocks + weather) is denser; **SEO Magic** title + **breadcrumb** + **main tabs** (Group / Generate / Feedback / Feature ideas) share one header row on larger screens with a single subtitle line below; **Group** sub-tabs (Data / Projects / Settings / Log) use a thinner pill row
- **Unified tab system:** main tabs + sub-tabs now share one segmented-control style (soft rail + white active pill + consistent typography/spacing) across Group, Generate, Auto-Group/Cosine, and Settings for a cleaner, tighter visual rhythm with compact but readable hit targets
- **Tab density polish:** reduced tab-rail/button padding and tightened surrounding panel/header spacing in Group + Generate + Auto-Group so screens feel more minimalist while preserving clear active/inactive separation and status color cues
- Compact project header
- **Top status bar:** today’s date (**calendar** icon); **Local** clock line (**clock** icon); **US Eastern** line (**globe** icon); **local weather** from Open-Meteo (**thermometer** + condition icon; while loading: **Finding your location…** then **Loading forecast…** in a light sky-tint dashed pill; if location is **blocked**: amber **Location blocked — hover for help** with portal steps for Chrome/Edge/Safari/Firefox on Windows & Mac (+ OS location notes); **unavailable** uses cloud-off; **°F** when the device timezone is a known US zone, otherwise **°C** for Canada, EU, and the rest of the world; temperature tint follows cold→hot hues; **manual Refresh/Retry buttons** let users force an immediate weather re-fetch instead of waiting for cadence; **hover / focus / tap** opens a portal tooltip with a **7-day** min/max forecast, per-day icons, and per-day tint **plus short nowcast insight lines**: update cadence (**every 15 minutes**), **next refresh countdown**, likely hold duration for current conditions, estimated next weather-change time, and likely rain windows in the next 24h; day rows reserve a dedicated temperature column and truncate long condition labels to prevent overlap in narrow widths; graceful fallback if location is blocked/unavailable); **Status** badge (small **cloud** icon + `Status` + line such as Cloud: synced; colored dot) with **hover / focus / tap** (portal tooltip — structured panel with icons, sections, light gradient header, status-tinted accents; tight **4px** gap to anchor; not the slow browser `title` attribute) showing diagnostics (network, `first-db`, server snapshot, project id, flush queue, last save, listener channel errors) — not driven by one listener: **aggregated Firestore listener error callbacks** (projects list, project chunks, app_settings docs, Generate/AutoGroup/feedback/table width/group-review listeners, etc.), **any snapshot with server metadata** (`metadata.fromCache === false`) for “connected”, **project coalesced flush depth** (“Syncing…”), and **last project Firestore save success vs failure** from the persist queue. Copy: **Cloud: synced** / **Syncing…** / **Offline — saved locally** / **Sync problem — retry** / **Connecting…**

- **Weather visibility polish:** the 7-day tooltip now surfaces a **wettest chance** summary card and per-day **rain probability** + **temperature swing** chips, so users can scan not just highs/lows but also which day is most likely to turn wet and how wide each dayâ€™s range is.
### Visual Design
- Consistent font color hierarchy
- Alternating row colors for table readability
- Token pills with light gray background and rounded edges
- Static filter section (does not push content down)
- CSS-based tooltips (instant, no delay)

---

## 9. Generate Tab (LLM Prompt Table)

### Overview
- Standalone tab (not tied to any project) for batch LLM generation
- **Two independent sub-tabs: Generate 1 and Generate 2** — each with fully separate settings, API key, model, rows, outputs, logs, and persistence
- Generate 2 lazy-mounts on first click (no wasted network requests until needed), then stays mounted so generation can run in background while viewing the other tab
- Google Sheets-like table with columns: #, Status, Input (Column B), Output (Column C)
- Starts with 20 empty rows, auto-creates more when pasting beyond current rows

### Data Input
- Paste from Google Sheets (copies tab-separated rows, takes first column)
- Click any cell in Column B to start pasting
- Direct editing of Column B cells
- Each row in Column B is a complete prompt sent to the LLM

### Generation
- Click "Generate" to fire all pending rows
- Status per row: Pending → Generating → Generated (or Error)
- Batch parallel processing with configurable concurrency (1-100, default 5)
- Stop button to abort mid-generation (in-flight rows revert to Pending)
- Stats bar shows counts: total rows, generated, errors, generating, pending

### Settings (within Generate tab)
- OpenRouter API key input
- Auto-fetches all available models when API key is entered
- Model selector dropdown with search and cost display (price per million tokens)
- Rate limit slider (1-100 concurrent requests)
- Settings persisted to localStorage

### API Integration
- Uses OpenRouter.ai API (v1/chat/completions)
- Supports all models available on OpenRouter
- Displays per-model pricing and context length

---

## 9b. Content Tab (Content Pipeline)

### Overview
- Multi-step content generation pipeline accessible via the **Content** main tab
- Step-by-step workflow: Page Names & Guidelines → H2 Names → Extract Guidelines → H2 Content → ... → Export
- Each step uses a `GenerateTabInstance` with step-specific prompts and optional **prompt slots**
- **Page Name / H2 Names / Page Guidelines / H2 Content** view tabs: first three share one instance (`_page_names`); **H2 Content** opens a second instance (`_h2_content`) with extra metadata columns and “Sync from Page Names”
- **H2 Content auto-pipeline:** the H2 Content `GenerateTabInstance` stays mounted (hidden when not on that view) so Firestore listeners stay active; when the upstream Page Names rows document (`generate_rows_page_names`) **or** the H2 generate settings doc (`generate_settings_h2_content`, primary “H2 Body” prompt) changes, the H2 table auto-rebuilds row **Input** cells from the **saved** template plus `{PAGE_NAME}`, `{H2_NAME}`, `{ALL_H2S}`, `{CONTENT_GUIDELINES}` (debounced). If no saved prompt exists yet, the bundled default template is used. Auto-apply is skipped if any row already has generated body output (manual “Sync from Page Names” still available with confirm).
- **Layout:** Both instances use `rootLayout="flush"` under one parent `max-w-4xl mx-auto space-y-3` so the Generate toolbar and table share the same horizontal column and vertical rhythm as the single-instance steps (no nested `max-w-4xl` stacking)

### Page Names & Guidelines (Step 1)
- Combined subtab with **three column groups** (switchable via sub-tabs):
  - **Page Name** (primary): #, Status, Input, Output, Copy, Reset, Len, R, Date — user enters keywords, generates page titles
  - **H2 Names** (slot): Status, Input, Output, Copy, Reset, Len, R, Date — auto-populates prompt with `{PAGE_NAME}` (from primary output) and `{KEYWORD_VARIANTS}` (from row input/keywords), generates 7-11 H2 headings per page
  - **Page Guidelines** (slot): Status, Input, Output, Copy, Reset, Len, R, Date — auto-populates prompt with `{PAGE_NAME}` and `{H2_NAMES}`, generates content consistency guidelines
- Column groups separated by a thick left border (`border-l-2`) and spanning group header row
- **Three independent Generate buttons**: primary "Generate" (indigo) for page names, "H2 Names" (cyan) for H2 headings, "Page Guidelines" (cyan) for guidelines — each with its own worker pool, abort controller, progress, and cost tracking
- **Settings panel** has a **tabbed prompt editor**: "Page Name Prompt" tab, "H2 Names Template" tab (template with `{PAGE_NAME}` and `{KEYWORD_VARIANTS}` placeholders), and "Page Guidelines Template" tab (template with `{PAGE_NAME}` and `{H2_NAMES}` placeholders)

### Prompt Slot System (Reusable)
- `PromptSlotConfig` interface defines additional prompt slots for any step:
  - `id`, `label`, `promptLabel`, `defaultPrompt`, optional `buildInput()` function
  - `buildInput(template, primaryOutput, externalData?, rowInput?)` auto-populates slot Input cells from primary output, row input (keywords), and external data (e.g., H2 names from a future step)
- Auto-input only runs when generation is idle (prevents race conditions with batch flush)
- Uses functional `setRows()` updates to avoid overwriting concurrent state changes

### Dependency Warnings
- When slot dependencies are missing (e.g., H2 names not generated yet, page names not generated), amber warning banners appear below the toolbar
- Slot Generate button is disabled with a tooltip explaining what's needed
- Slot Input cells show "Waiting for dependencies..." placeholder when auto-input can't populate

### Persistence
- Slot data stored in `GenerateRow.slots` field (backward-compatible — existing rows without slots load fine)
- Slot prompts stored in `GenerateSettings.slotPrompts` (keyed by slot ID)
- All data persisted to IDB + Firestore via existing 3-tier storage pattern
- Chunked Firestore storage handles larger rows with slot data
- **`suppressSnapshotRef` guard** on all Firestore writes (rows, settings, logs) — prevents `onSnapshot` echo from overwriting newer local state when a save is in flight
- **`rowsFirestoreLoadedRef` guard** on rows load — prevents async IDB cache from overwriting authoritative Firestore data (matches existing settings guard pattern)

### Export / Clear / Undo
- CSV export includes slot columns (Status, Input, Output, Len, Retries, Cost, Tokens, Date per slot)
- Clear All / Clear Cell resets both primary and all slot data
- Undo stack captures full row state including slots
- Bulk Copy available per column group (primary and each slot independently)

---

## 10. Product feedback

### Send feedback (header)
- **Send feedback** uses **`FeedbackModalHost`**: open/close state lives outside the large **`App`** tree (so **`App` does not re-render** when toggling the dialog), and the modal is rendered via a **React portal** to **`document.body`**. The overlay is a solid dim (**no backdrop blur**); modal buttons and chrome avoid **CSS transition** animations for an instant feel.
- **Send feedback** button opens a modal: choose **Issue / bug** or **Feature**, then:
  - **Where in the app** — **required** dropdown grouped by area (Group sub-tabs, Settings segments, Generate 1/2, Feedback queue, header/navigation, cross-cutting sync, etc.). Stored as the sole `tags[]` entry (area id slug).
  - **Severity** (issues) or **impact** (features) — **required** **1–4** scale with **color ramp** (emerald → amber → orange → red) and short hints on each card.
  - **Details** — structured questions (not one blob): issues require *what you were trying* + *what went wrong*; *what you expected* and *steps to reproduce* are optional. Features require *problem/need* + *idea*; *anything else* is optional. Composed into the Firestore `body` with labeled sections.
- Optional **screenshots** (up to **3** images per submission, ~2 MB each, JPEG/PNG/GIF/WebP): stored in **Firebase Storage** under `feedback/{docId}/0..2.ext` (paths match Storage rules). The app **uploads first**, then writes the **Firestore** document **once** with `attachmentUrls`. If anything fails after uploads start, uploaded objects are **deleted** before the user sees an error (no orphan Firestore row with missing photos).
- If screenshot upload/auth fails (for example Anonymous auth disabled in Firebase), the app now **still saves the feedback text** without images and shows a warning toast, so submit never hard-fails just because images could not upload.
- **Auth for uploads:** Storage rules require a signed-in user. If the user is not on Google sign-in, the app uses **Firebase Anonymous sign-in** silently before uploading. **Authentication → Sign-in method → Anonymous** must be **enabled** in the Firebase Console for screenshots to work.
- **Optional hardening:** Set `VITE_FIREBASE_APPCHECK_SITE_KEY` and enable **App Check** in the Firebase Console (reCAPTCHA v3); you can then add App Check conditions to Storage rules per Firebase docs.
- Description field: Enter submits; Shift+Enter adds a line.
- Optional Google sign-in email is stored on the entry when the user is signed in.

### Feedback tab
- Main nav tab **Feedback** opens the **Queue** (live Firestore sync).
- **Table** columns: row #, type, rating, **Area** (human-readable label from area id), **photos** (thumbnails, link to full image), full feedback body, author, date, **Copy** action, queue controls.
- Feedback body now shows full text (no 3-line truncation) so reviewers can read all submitted details directly in the queue.
- Per-row **Copy** button copies a single combined text block (type, rating, area, author, created time, and full feedback body) to clipboard.
- **Filters:** type (all / issues / features), minimum rating (1+ … 4 only), tag substring, free-text search (body + tags).
- **Sort** (click column headers): type, rating, date, queue priority, with asc/desc toggle.
- **Queue** up/down swaps **priority** values in Firestore for that row vs. the row above/below in the **current filtered & sorted** list (two items exchange priority).
- Footer legend summarizes severity vs. impact scales.

### Persistence
- **Firestore:** collection `feedback` — fields include `kind`, `body`, `tags[]`, `issueSeverity` (issues) or `featureImpact` (features), `priority`, `createdAt`, `authorEmail`, optional `attachmentUrls[]` (screenshot URLs).
- **IndexedDB:** cache under key `__feedback__` for fast reload; small metadata in localStorage key `kwg_feedback_meta` (count + timestamp).

### URL routing (main tabs + Group sub-tabs)
- All routes use the **`/seo-magic`** prefix (product slug). Firebase Hosting rewrites `**` → `index.html`, so every path is a valid SPA entry.
- **Main tabs**
  - **Generate** → `/seo-magic/generate`
  - **Feedback** → `/seo-magic/feedback`
  - **Feature ideas** → `/seo-magic/feature-ideas` (read-only internal backlog; not persisted)
  - **Group** area → `/seo-magic/group/...` (see below)
- **Group sub-tabs** (project list, data workspace, settings, log)
  - **Projects** (all projects) → `/seo-magic/group/projects`
  - **Data** (keyword workspace) with no project selected → `/seo-magic/group/data`
  - **Data** with a project open → `/seo-magic/group/data/{projectUrlKey}` (stable slug from project name + id suffix; replaces legacy `?project=` in the address bar when syncing)
  - **Settings** (with inner tab in the URL) → `/seo-magic/group/settings/general` | `.../how-it-works` | `.../dictionaries` | `.../blocked`
  - **Log** → `/seo-magic/group/log`
  - **Shortcuts** (canonicalized on load): `/seo-magic/log` → `/seo-magic/group/log`; `/seo-magic/settings` → `/seo-magic/group/settings/general`
- Tab and sub-tab changes use `history.pushState`. **popstate** restores main tab, group sub-tab, and loads the project when the data route includes a key.
- **Legacy URLs** still work: `/`, `/seo-magic`, `/feedback`, `/generate`, `/feature-ideas` are canonicalized to `/seo-magic/group/projects` or the prefixed main-tab paths. `?project=` is still read on load for migration, then removed when possible.

---

## 11. Notifications Tab

- New top-level **Notifications** tab sits immediately left of **Updates** and is visible to all users.
- Route: `/seo-magic/notifications`.
- Shared notification history is persisted to Firestore collection `notifications` and mirrored into IndexedDB cache key `__notifications__`.
- Only explicitly marked shared alerts from the toast pipeline are written to this feed; local-only confirmations remain toast-only.
- Filters at the top include:
  - type (`all / success / info / warning / error`)
  - source (`all / group / generate / content / feedback / projects / settings / system`)
  - free-text search across message, source, and project name
- The table shows timestamp, type, source, scope (`Global` or a project name/id), the full notification text, and a **Copy** action.
- **Pagination**: 50 notifications per page with Prev/Next controls, "Showing X–Y of Z", and "Page N of M". Resets to page 1 when filters change.
- **Relative timestamps**: Primary display shows "just now", "Xm ago", "Xh ago", "yesterday", "Xd ago" with full absolute timestamps (local + US Eastern) below in smaller text.
- **Human-readable descriptions**: 16 regex-matched patterns map technical messages to plain-English explanations shown in italic below the original message (e.g., "Auto-synced 130 H2 rows from upstream step" → "130 heading outlines were automatically pulled from the previous step").
- **Summary stats bar**: Colored clickable badges above the filter bar showing counts per type (errors, warnings, success, info). Clicking a badge toggles the type filter as a quick shortcut.
- **Expandable long messages**: Notifications longer than 120 characters are truncated with a "more" toggle. Expanding reveals the full message plus the humanized description.
- **Improved empty states**: No-notifications state shows a Bell icon with helpful description. No-matches state shows a Search icon with "Clear all filters" button.
- Copy uses the stored full notification text when present, otherwise it composes a formatted block with source, scope, timestamps, and message.
- The Notifications feed starts from this rollout forward and does **not** backfill the existing Group activity log or the Updates changelog.

---

## 12. Updates Tab (Changelog)

- New top-level **Updates** tab (rightmost position, `History` icon) visible to all users.
- Displays the **current build name** at the top in a styled badge — stored in `app_settings/build_info` Firestore doc.
- Lists all changelog entries in reverse chronological order (newest first) from the `changelog` Firestore collection.
- Each entry shows: build name badge, summary text, date/time, and a bullet list of specific changes.
- Real-time updates via Firestore `onSnapshot` — entries appear instantly when added.
- Claude is mandated (CLAUDE.md rule #9) to write a changelog entry after every code-change session using `addChangelogEntry()` from `src/changelogStorage.ts`.
- Build name can be updated via `updateCurrentBuildName()`.
- Route: `/seo-magic/updates`.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-30 | Notifications tab: shared alert history with filters, search, timestamps, and copy-full-message actions |
| 2026-03-27 | Ungrouped duplicate guard: restoring pages from Grouped/Approved now skips already-present token signatures so duplicate pages and duplicate keyword rows cannot be appended back into Ungrouped |
| 2026-03-27 | Token signatures: removed `no`, `not`, `without`, `with` from stop-word stripping; added `vancouver` to stop words (still in foreign cities for detection) |
| 2026-03-27 | Auto-Group v1: assignment batch size up to **500** ungrouped keywords per API call; dynamic `max_tokens` for large assignment and cosine-summary JSON; default two-token LLM batches span up to 500 pages |
| 2026-03-27 | UI polish: unified main tabs/sub-tabs into a shared segmented-control pattern and tightened tab/header spacing for a more compact, consistent light-theme look across Group, Generate, Auto-Group, and Settings |
| 2026-03-26 | Feature ideas tab: four new backlog items (CSV relevance gate, token merge pass, unique-token auto-merge + tiers, unique-token 1–4 priority ranking) |
| 2026-03-26 | **Bugfixes:** Cosine similarity skips embedding when fewer than two pages (avoids useless API calls and NaN progress); grouped/approved sub-cluster keys parse only the first `::` so token strings containing `::` (e.g. cosine anchor pages) ungroup correctly |
| 2026-03-26 | **Cosine Test** (Auto-Group sub-tab): **Send mismatches to Ungrouped** — after Initial Cosine QA flags mismatches, one click removes those pages from grouped clusters so they only appear under Cosine Ungrouped (manual step until automatic handling lands) |
| 2026-03-26 | Grouped / Auto-Group QA: sub-page dots for **Mismatch** groups — green for pages that belong, red for mismatched; LLM mismatched page names normalized to canonical names; empty mismatch list shows amber (ambiguous) |
| 2026-03-26 | Feedback queue: show full body text (no truncation) + per-row Copy button for full combined feedback content |
| 2026-03-26 | Feedback submit resiliency: screenshot upload/auth failures now fall back to saving feedback text-only with warning toast |
| 2026-03-26 | Feedback submit gate: issue reports no longer require the "what you expected" field; section is now optional in UI/body |
| 2026-03-25 | **Feature ideas** main tab: read-only backlog + template at `/seo-magic/feature-ideas` (no IDB/Firestore) |
| 2026-03-25 | Feedback modal: `FeedbackModalHost` (local state + portal to `document.body` so `App` does not re-render on open); overlay without blur; no transition animations on modal chrome |
| 2026-03-26 | Realtime collaboration correctness: project saveId marker, conditional chunk cleanup, and realtime shared `user_preferences` syncing |
| 2026-03-27 | Generate tab: lowered default concurrency to 5 and expanded slider to 1-100 to reduce 429 backoff stalls on slower/rate-limited models |
| 2026-03-27 | Generate tab refresh durability: guarded against cached-empty Firestore snapshots; added immediate local cache fallback for Generate 1/2 rows, settings, logs, and active sub-tab; persisted per-tab Generate view state (Table/Log + status filter); and made unload flush use chunked row writes so large in-progress tables are not lost on refresh/close |
| 2026-03-27 | Keyword management tables: `<colgroup>` aligns header, filter row, and body columns; resize widths are **clamped** to a viewport-safe max; drag updates are **rAF-coalesced**; **IndexedDB persists once on mouseup** (per browser, not shared to collaborators); filter cells use **min-width / shrink** so min–max inputs stay inside their columns |
| 2026-03-27 | Collaboration: Generate rail (1/2), Generate view chrome (table/log + row-status filter), and table column widths no longer sync via Firestore — each browser keeps its own UI; shared settings and project/workspace data unchanged |
| 2026-03-26 | Auto-Group: `Shift+1` now requires active filters and supports 1 matching page |
| 2026-03-25 | Feedback modal ARIA (dialog, fieldsets, labels, radiogroup); queue: legacy rating “—” + sort/filter; firebase.ts module note |
| 2026-03-25 | Feedback modal: mandatory area dropdown, severity/impact with color ramp, structured Q&A body; queue shows Area column |
| 2026-03-25 | Feedback screenshots: upload-then-single Firestore write + Storage cleanup on failure; Storage rules (auth + path limits); optional App Check env; anonymous sign-in for uploads; modal file validation outside setState |
| 2026-03-25 | Feedback modal: up to 3 screenshot attachments (Firebase Storage); queue table shows photo thumbnails |
| 2026-03-25 | Feedback: tags, 1–4 severity/impact ratings, table with filters and sortable columns |
| 2026-03-25 | Group routes under `/seo-magic/group/...` (projects, data, settings, log); project-specific data URLs use `/group/data/{projectKey}` |
| 2026-03-25 | Main tabs sync to URL with history support |
| 2026-03-25 | Added product feedback: header modal, Feedback tab with prioritized queue, Firestore + IDB + localStorage metadata |
| 2026-03-21 | Initial FEATURES.md created documenting all existing functionality |
| 2026-03-21 | Added Generate tab with OpenRouter LLM integration, batch processing, model selector |
| 2026-03-22 | Added Generate 1 / Generate 2 sub-tabs with fully independent state, settings, and persistence |
| 2026-03-22 | Added status filter (All/Pending/Done/Error), per-row retry, bulk regenerate errors |
| 2026-03-22 | Fixed Copy All to use TSV format preserving paragraph formatting per cell |
| 2026-03-22 | Error rows now preserve last attempted output for copying |
| 2026-03-22 | Added Online (web search) toggle — OpenRouter plugin, ~$0.02/req extra (Generate 1 only for testing) |
| 2026-03-22 | Added (?) tooltip explanations to all headers, stats, settings labels, and table columns |
| 2026-03-22 | Sticky header bar + sticky table thead with dynamic top offset via ResizeObserver |
| 2026-03-22 | Generate button now shows queued count (pending + error rows) matching actual processing behavior |
| 2026-03-22 | Performance: Virtual scrolling for 10k+ rows (renders only visible rows + 20 buffer) |
| 2026-03-22 | Restructured keyword management tabs: All, Pages (Ungrouped), Pages (Grouped), Pages (Approved), Blocked |
| 2026-03-22 | Removed Tokens tab from keyword management |
| 2026-03-22 | Added Approve/Unapprove flow for moving groups between Grouped and Approved tabs |
| 2026-03-22 | Moved stats into tab badge counts; deleted grouped stats banner |
| 2026-03-22 | Tightened column widths (Page Name, Tokens, filter inputs) so KD visible without scrolling |
| 2026-03-22 | Repositioned filter results count next to Keyword Management header |
| 2026-03-22 | Performance: Memoized row component (React.memo) prevents unchanged rows from re-rendering |
| 2026-03-22 | Performance: Isolated timer component — 4/sec re-renders no longer cascade to parent |
| 2026-03-22 | Performance: Stats memoized — single O(n) pass instead of 9 separate filter/reduce calls |
| 2026-03-23 | Renamed tool: "Keyword Cluster Tool" → "SEO Tool" with updated description |
| 2026-03-23 | Restructured main tabs: 6 tabs → 2 (Group + Generate), with sub-tabs for Projects, How it Works, Dictionaries |
| 2026-03-23 | Compact project selector + CSV upload in single row, left-aligned |
| 2026-03-23 | Stats default to collapsed (expandable on click) |
| 2026-03-23 | Removed Saved Clusters tab entirely |
| 2026-03-23 | Added persistence rule #0 to CLAUDE.md: all state must persist to IDB + Firestore |
| 2026-03-23 | Default keyword management subtab changed to Pages (Ungrouped) |
| 2026-03-23 | Context-aware action buttons: Group (ungrouped), Approve+Ungroup (grouped), Unapprove (approved) |
| 2026-03-23 | Added grouping time estimator (rolling 15s average, updates every 10s) |
| 2026-03-23 | Selection count badge + active results count displayed inline with search bar |
| 2026-03-23 | File info (filename, New Upload, Export) moved inline to compact top bar |
| 2026-03-23 | Tab badges show groups/pages format: (35/3,314) for Grouped and Approved tabs |
| 2026-03-22 | Performance: Storage saves debounced 3s during generation, skip-if-unchanged for Firestore |
| 2026-03-22 | Performance: Batch flush returns same reference if no rows actually changed |
| 2026-03-23 | Added Inter font globally via Google Fonts with stylistic alternates |
| 2026-03-23 | Tokens column now shows aggregated tokens for group header rows (Grouped + Approved tabs) |
| 2026-03-23 | Standardized Grouped/Approved tab headers to match Pages (Ungrouped) exactly |
| 2026-03-23 | Added filter rows to Grouped and Approved tabs (Len, KWs, Vol, KD, Label, City, State) |
| 2026-03-23 | Column-level filters now apply to Grouped and Approved tab data |
| 2026-03-23 | AI Semantic Group Review: auto-reviews groups on creation via OpenRouter API |
| 2026-03-23 | Status column in Pages (Grouped) shows Approve/Mismatch/Error with tooltips |
| 2026-03-23 | Separate review settings panel (API key, model, concurrency, temperature, prompt) |
| 2026-03-23 | Review stats inline: review count, approve/mismatch counts, total cost |
| 2026-03-23 | Mismatch count badge on Pages (Grouped) tab |
| 2026-03-24 | Auto-Group: Token Clusters sub-tab (4+ shared token matching, instant, no API) |
| 2026-03-24 | Auto-Group: LLM-powered semantic grouping with concurrency + progress tracking |
| 2026-03-24 | Auto-Group: QA review pass on suggestions with separate cost tracking |
| 2026-03-24 | Auto-Group: Approve All / Dismiss All / Bulk select for suggestions |
| 2026-03-24 | Auto-Group: Sortable columns, search, KD column in both sub-tabs |
| 2026-03-24 | Auto-Group: Per-project isolation (key={activeProjectId} remount) |
| 2026-03-24 | Auto-Group: Settings persist to Firestore (API key, model, concurrency, prompt) |
| 2026-03-24 | Shared ModelSelector component (unified across Generate, Group Review, Auto-Group) |
| 2026-03-24 | Shared SettingsControls component (temperature, concurrency, reasoning, max tokens) |
| 2026-03-24 | Toast notification system (stacking, auto-dismiss, color-coded by action type) |
| 2026-03-24 | Activity Log tab per project (persisted to IDB + Firestore) |
| 2026-03-24 | Token merge system (parent/child, undo, CSV integration, project-level rules) |
| 2026-03-24 | Multi-sort (shift+click headers for secondary sort) |
| 2026-03-24 | Draggable column resize (persisted to localStorage) |
| 2026-03-24 | Breadcrumb navigation bar |
| 2026-03-24 | Editable project names (click-to-edit in breadcrumb + project cards) |
| 2026-03-24 | Google SERP button + Copy button on all page/group names |
| 2026-03-24 | Token click in Token Management → filters keyword management |
| 2026-03-26 | Toast UI: smaller/thinner bottom-left, no animations, faster auto-dismiss |
| 2026-03-30 | Toast UI: slimmer KWG notification cards with lighter chrome and +1s dwell time |
| 2026-03-26 | Fix old `/group/data/<key>` links: resolve by id suffix even if project name changes |
| 2026-03-26 | Fixed keyword management AI review badge flicker during rapid auto-grouping by preserving last known approve/mismatch results and re-reviewing only when group membership changes |
| 2026-03-26 | All Keywords tab: wired **Rating** column min/max filters (`kwRating`) through `FilterBag` / `useKeywordWorkspace`; filters apply to keyword rows; auto-group filter summary includes rating bounds |
| 2026-03-27 | Keyword management tab switches: removed deferred React transitions (instant tab highlight) and avoided redundant token-management recomputation when Token Management subtab is not “current” |
| 2026-03-27 | Unblock token: navigate to Ungrouped + Token Management “current” (was easy to land on Grouped scope after unblock) |
| 2026-03-27 | CRITICAL persistence fix: ungroup/unblock/block changes no longer revert on refresh (3 bugs in onSnapshot Guard 6 + pickNewerProjectPayload + IDB snapshot writes) |
| 2026-03-27 | Persistence hardening: saveCounterRef advances on remote snapshots; hasPendingWrites guard; isFlushingRef prevents mid-flush overwrites; reset via clearProject |

---

## ⚡ Next Up: Cross-Group Duplicate Reconciliation (LLM-Powered)

**Status:** Planned, not yet implemented. Ready to build.

**What it does:** After auto-grouping produces ~500-1,000 groups, takes each group name and compares it against ALL other group names via LLM to find semantic duplicates that ended up in different token clusters. User reviews merge candidates, approves/dismisses each.

**Where it lives:** New "Find Duplicates" button in the Auto-Group toolbar, between auto-group stats and QA button.

**Flow:**
```
Token Clusters → Run Auto-Group → ✨ Find Duplicates ✨ → Run QA → Approve
```

### Batching Strategy
- **3 groups per batch** checked against the full group list
- For 1,000 groups: 334 API calls
- Input per call: ~6,200 tokens (3 check groups + 1,000 numbered group names)
- Output per call: ~60 tokens (JSON with 0-3 matches)
- **Total cost varies by selected model and group count**; `GPT-5.4 mini` is now the default lower-cost choice for new model selections.
- **3 passes scale linearly from that per-pass cost**

### Prompt Design
```
"You are checking for semantic duplicate groups in an SEO keyword clustering project.

CHECK THESE 3 GROUPS for duplicates:
1. fast payday loans
2. auto loan refinance rates
3. legitimate credit repair services

FULL GROUP LIST (576 total):
1. payday loans
2. quick payday loans
3. payday loan calculator
...

RULES:
- Only flag groups with IDENTICAL semantic intent (just different wording)
- Synonyms (fast/quick, car/auto, legitimate/reputable) = DUPLICATE
- Different sub-intents (calculator vs rates vs meaning) = NOT duplicates
- Location variants (Houston vs Dallas) = NOT duplicates
- When in doubt, do NOT flag as duplicate

Return JSON only:
{ "duplicates": [
    { "checkIdx": 1, "matchIdx": 2, "confidence": 92, "reason": "fast/quick synonyms" }
] }"
```

### UX
**Results appear in a collapsible section ABOVE the main suggestions table:**
```
┌─ Duplicate Groups Found (14 pairs) ─────── [Merge All (14)] [Dismiss All] ─┐
│                                                                               │
│  ☐  "fast payday loans" (4 pages, 45k vol)                                  │
│      ↔ "quick payday loans" (3 pages, 32k vol)     92% match  [Merge] [✗]   │
│                                                                               │
│  ☐  "auto loan refinance" (2 pages, 12k vol)                                │
│      ↔ "car refinance loan" (3 pages, 18k vol)     88% match  [Merge] [✗]   │
│                                                                               │
│  ... 12 more                                                                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Merge Logic
- **Higher volume group absorbs the lower** (pages combine, stats recalculate)
- Absorbed group disappears from suggestions
- Group name = higher volume group's name
- **Chain merges:** If A↔B and B↔C, all three merge into highest volume
- Toast + activity log on each merge

### Multi-Pass Support
- User can click "Find Duplicates" again after merging
- Merged groups may now match OTHER groups (chain effect)
- Button shows pass number: "Find Duplicates (Pass 2)"
- When 0 duplicates found: "✓ No duplicates found" toast
- Each pass: ~$0.32, takes 30-60 seconds

### Edge Cases
1. **Chain merges (A↔B + B↔C)** — Build union-find structure in "Merge All", all collapse to highest vol
2. **User dismisses a pair** — Track dismissed pairs, don't re-show on next pass
3. **Group already merged/gone** — Skip gracefully, toast "Group no longer exists"
4. **Same group matches multiple others** — Show all pairs, merging one auto-resolves others
5. **LLM hallucinates non-existent group** — Validate all matchIdx against actual list, skip invalid
6. **JSON parse error** — Same error handling as auto-group, skip batch, count as error

### Implementation
- Add `findDuplicateGroups()` to `AutoGroupEngine.ts` (~80 lines)
- Add duplicate UI section to `AutoGroupPanel.tsx` (~100 lines)
- Add `DuplicateCandidate` interface to `types.ts`
- Uses same settings as auto-group (API key, model, concurrency)
- Persisted alongside autoGroupSuggestions in IDB + Firestore

---

## Future Roadmap (Shelved — Revisit Later)

### 🔮 Phase 2: Embedding-Based Reconciliation (Post-Auto-Group)

**Status:** Designed, not implemented. Builds on the existing auto-group pipeline.

**What it does:** After LLM auto-grouping completes, runs a second pass using TF-IDF cosine similarity to find duplicate/near-duplicate groups that ended up in different token clusters. Catches cross-cluster semantic matches that token overlap misses.

**How it works:**
1. Extract all auto-grouped suggestion names
2. Build TF-IDF vectors for each group name (client-side, instant, free)
3. Compute pairwise cosine similarity (~1-3 seconds for 900 groups)
4. Flag pairs with similarity > 0.85 as merge candidates
5. Show user: "These 2 groups from different clusters may be the same — merge?"
6. User clicks Merge or Keep Separate

**Implementation:** New file `src/EmbeddingReconciliation.ts` (~150 lines). Pure math, zero API cost. Plugs in right after auto-group completes, before QA review.

**Why it matters:** Token clustering requires exact 4-token matches. "fast payday loans" and "quick payday loans" end up in different clusters because `fast` ≠ `quick`. Cosine similarity catches this (0.94 similarity) without any LLM call.

---

### 🔮 Phase 3: Token Semantic Pre-Merge (Before Clustering)

**Status:** Designed, not implemented. Would run before the 4-token clustering step.

**What it does:** Uses the LLM to compare each unique token against all others (batched), finding semantic synonyms (fast↔quick, automobile↔car). Merges them using the existing token merge infrastructure before clustering occurs. Results in better, more accurate token clusters.

**How it works:**
1. For each unique token, send to LLM with 3-5 sample page names for context:
   ```
   Token: "fast"
   Appears in: "fast payday loans", "fast cash advance", "fast approval loans"
   Which of these tokens are semantic equivalents? [quick, rapid, instant, speedy, ...]
   ```
2. LLM returns matches → applied as merge rules via existing TokenMergeEngine
3. Signatures recalculate → pages regroup → better 4-token clusters
4. Cost: ~500 API calls (~$5-25 depending on model)

**Why it matters:** Eliminates synonym fragmentation BEFORE clustering. "fast payday loans" and "quick payday loans" would share the same token after merge, so they'd naturally cluster together.

---

### 🔮 Phase 4: Full Embedding Clustering (Alternative to Token Overlap)

**Status:** Concept only. Requires embedding API support.

**What it does:** Instead of (or in addition to) token overlap, embed ALL page names as vectors and cluster by cosine similarity. Catches semantic matches with ZERO token overlap (e.g., "home mortgage refinance" ↔ "refinancing your house loan").

**How it works:**
1. Send all page names to embedding model (OpenRouter or dedicated) — $0.001 for 3,000 pages
2. Compute pairwise cosine similarity — pure CPU math, 1-3 seconds
3. Build connected components at 0.85 threshold (pages reachable through similarity edges = same group)
4. Show as "Embedding Clusters" alongside Token Clusters

**Key insight:** Cosine similarity scores are precise (4+ decimal places) and the gap between same-intent (0.90-0.98) and different-intent (0.10-0.70) is usually large. No ambiguity in grouping.

**Performance:** 3,800 pages = 7.2M comparisons. With pre-computed magnitudes + early termination: ~3 seconds in browser. Not computationally expensive.

---

### 🔮 Phase 5: Additional Enhancement Ideas

**Cross-Cluster Reconciliation (Free):**
After auto-grouping, compare group names ACROSS clusters by token overlap >70%. Flag merge candidates. No API cost, instant.

**Suggest Split for Oversized Groups:**
Flag any auto-grouped group with >15 pages as potentially too broad. Offer re-run with stricter prompt for just that group.

**Learning from User Corrections:**
Log when user moves a page between groups or rejects a suggestion. Build a local correction dictionary over time. Use corrections to improve future auto-group accuracy. Zero API cost, compounds over time.

**Two-Pass Auto-Group:**
Pass 1 (current): 4-token clustering → LLM grouping. Gets 80% right.
Pass 2 (new): Take all single-page groups + ungrouped leftovers → embed → cluster by similarity → LLM group. Catches the remaining 20%.

**Token Role Detection:**
Classify tokens as topic tokens (payday, mortgage) vs modifier tokens (best, how, calculator). Cluster by topic tokens only (ignoring modifiers). Then LLM splits by modifier intent within each topic cluster. More accurate initial clustering.

---

*Last updated: 2026-03-30*

### 2026-03-28: HTML Prompt / Validator Alignment

- Tightened the default `H2 HTML` compiler prompt so it explicitly forbids bare `<a>` tags, placeholder hrefs, invented URLs, and malformed anchors without usable URLs.
- Added regression coverage for the exact validator failure `Anchor tag is missing href.` so the prompt contract and the deterministic HTML validator stay aligned.

### 2026-03-29: HTML Retry Feedback + H2 Summary Stage

- `H2 HTML` now appends the prior row-level validator failure into the next input prompt so retries explicitly target the exact HTML policy error instead of blindly regenerating.
- Added a live `H2 Summ.` stage wired into the same content pipeline stack, with persisted rows/settings, shared model selection, shared logs, and summary rows derived from generated `H2 Body` content.

### 2026-03-29: H1 Body Stage

- Added a live `H1 Body` stage that derives one page-level row from `Pages` plus generated `H2 Summ.` outputs, using the same shared API key, model persistence, logs, and Firestore-backed state flow as the other content stages.
- The `H1 Body` rows now carry concatenated H2 names, concatenated H2 body reference text, and concatenated H2 summaries in row metadata so the table and the prompt both reflect the same article-level context.

### 2026-03-29: H1 Body HTML Stage

- Added a live `H1 Body HTML` stage sourced from generated `H1 Body` rows, using the same shared HTML validator contract, retry feedback loop, model persistence, and logs as `H2 Body HTML`.
- The `H1 Body HTML` prompt now receives prior validator failure text on retries so repeated HTML resets target the exact failing rule instead of looping on the same malformed output.

### 2026-03-29: Quick Answer Stage

- Added a live `Quick Answer` stage sourced from generated `H1 Body` rows, using the same shared API key, model persistence, logs, and page-level metadata columns as the `H1 Body HTML` stage.
- The quick answer prompt now references the page title plus generated `H1 Body` content so its two-paragraph output stays contextually aligned with the article intro instead of drifting from the page-level content.

### 2026-03-29: Quick Answer HTML Stage

- Added a live `Quick Answer HTML` stage sourced from generated `Quick Answer` rows, using the same shared HTML validator contract, retry feedback loop, model persistence, and logs as the other HTML stages.
- The `Quick Answer HTML` prompt now receives prior validator failure text on retries so repeated resets target the exact failing rule instead of looping on the same malformed HTML.

### 2026-03-29: Shared OpenRouter Timeout Hardening

- Added a shared OpenRouter timeout helper that keeps the 60-second timeout active for the full request lifecycle, including response body reads.
- Migrated the shared Generate row path, Generate slot path, Group Review, Keyword Rating, Auto Group, Auto Group Panel, and Auto Merge OpenRouter calls to the shared timeout helper.
- Added regression coverage for hung requests, user aborts, and slot-active timeout handling so provider stalls fail visibly instead of leaving rows stuck in `generating`.

### 2026-03-29: Metas/Slug/CTAs Slot Stats Wiring

- The shared Generate summary bar now switches to the active slot's counts, elapsed time, live cost, throttle count, and error-reset behavior when a slot like `Slug` or `CTAs` is generating or selected.
- Added regression coverage for slot-stat aggregation and active-summary selection so slot completions now update the same `Done`/`active` surface that the primary generate path uses.

### 2026-03-29: Pro Tip / Red Flag / Key Takeaways Stage

- Added a live page-level `Pro Tip/Red Flag/Key Takeaways` stage sourced from `Metas/Slug/CTAs`, with `Pro Tip` as the primary output and `Red Flag` plus `Key Takeaways` as prompt slots.
- The new stage reuses the same shared model persistence, shared logs, slot-aware summary stats, and Firestore-backed state flow as the other page-level content stages.
- All three prompts now use the combined H2 summaries as article context so the final guidance outputs stay aligned to the full article rather than drifting to one section.
- Added a leftmost `Overview` content tab that reads the existing pipeline row docs and shows total active pages, per-stage completion/cost, overall progress, latest completed stage, and full pipeline cost without introducing any new persistence schema.

### 2026-03-29: Final Pages Aggregation

- Replaced the locked `Final Pages` placeholder with a live read-only table that assembles one final row per active page from the existing content pipeline docs.
- The final table now auto-populates `Title`, meta fields, quick answer, H1 body, CTA fields, pro tip, red flags, key takeaways, and `Dynamic Header` / `Dynamic Description` pairs from ordered H2 body rows.
- Final-page values are fully derived from upstream state, so clearing an upstream stage immediately clears the corresponding final-table cells instead of leaving stale data behind.
- `Final Pages` now includes a publish-readiness summary strip showing `Total Pages`, `Ready`, `Needs Review`, `Completion %`, and `Last Updated`, all derived from the assembled final rows instead of a separate saved audit state.
- Publish readiness is deterministic: a row is only marked ready when all required final fields are present, including the first dynamic header/description pair, and the summary exposes how many rows are still missing required fields.
- Final-page column headers now link directly to their source content subtabs, so users can jump from assembled output straight to `Pages`, `H2 Body HTML`, `H1 Body HTML`, `Quick Answer HTML`, `Metas/Slug/CTAs`, or `Pro Tip/Red Flag/Key Takeaways` without leaving the final handoff table.

### 2026-03-29: Content Subtab URLs

- Added URL-addressable content subtabs for `Overview`, `Pages`, `H2s`, `Page Guide`, `H2 Body`, `H2 Rate`, `H2 Body HTML`, `H2 Summ.`, `H1 Body`, `H1 Body HTML`, `Quick Answer`, `Quick Answer HTML`, `Metas/Slug/CTAs`, `Pro Tip/Red Flag/Key Takeaways`, and `Final Pages`.
- Content subtab links now restore the same visible content state for anyone opening the URL, including the page-level `H2s` and `Page Guide` slot views that previously lived only in local generate view state.
- Overview jump targets now map to the correct content subtabs instead of relying on mismatched internal stage ids.

### 2026-03-29: Per-Subtab Model Locking

- Added a per-subtab model lock on the shared Generate surface so each content stage can pin its own required model and make that choice visible to all users through the existing Firestore-backed settings flow.
- Locked subtabs now disable model changes locally, keep showing the pinned model after refresh, and ignore shared selected-model updates until the subtab is explicitly unlocked.

### 2026-03-29: GPT-5.4 Mini Default Alignment

- Replaced the remaining mixed default-model behavior so Generate/Content, Group Review, and dedicated Auto-Group settings now all start from `OpenAI GPT-5.4 mini` instead of blank/legacy provider fallbacks.
- Shared model hydration now normalizes blank or unavailable selections back to the preferred model when possible, while still preserving explicit valid selections and optional per-workflow overrides.
- Updated `README.md` so local setup uses `npm run setup` and the documented OpenRouter default matches the live application behavior.

### 2026-03-29: Content Subtab Stale-Upstream Guard

- `H2 Body` and `H1 Body` derivation now require the upstream page row and relevant slot outputs to still be in `generated` state before reusing their text.
- This prevents stale page titles, H2 names, and page-guide context from surviving resets/errors and silently reappearing in downstream content subtabs.

### 2026-03-30: Content Derived-Input Reuse Guard

- Derived content rows now keep generated output only when the saved row input still exactly matches the current upstream-derived prompt, making prompt changes and upstream content changes invalidate stale results deterministically instead of leaking them across subtabs.
- The stricter reuse rule now covers `H2 Body`, `H2 Rate`, `H2 Summ.`, `H1 Body`, `H1 Body HTML`, `Quick Answer`, `Quick Answer HTML`, `Metas/Slug/CTAs`, and `Pro Tip/Red Flag/Key Takeaways`.

### 2026-03-30: Page Guide -> H2 Body Local Fallback Guard

- `H2 Body` source rebuilding now still uses remote `Pages` rows as primary data, but it can selectively reuse local `Page Guide` slot output when remote rows temporarily arrive without generated guide payloads during sync races.
- Local fallback is only accepted when the local and remote H2 lists normalize to the exact same ordered signature, preventing stale/mismatched local guides from being copied into current H2 rows.
- Added regression coverage for all three paths: remote wins when complete, local fallback fills missing guide slots when signatures match, and fallback is rejected when H2 signatures diverge.
