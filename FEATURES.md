# FEATURES.md — Keyword Grouper Application

> This file documents all features and functionality. **Updated every time a feature is added or modified.**

---

## 1. Project Management

### Create Project
- User creates a project with a name and optional description
- Saved immediately to localStorage, IndexedDB, and Firestore
- Each project stores its own independent keyword data

### Delete Project
- Trash icon on project card (always visible)
- Confirmation dialog before deletion
- Removes from all 3 storage layers (localStorage, IDB, Firestore metadata + data chunks)
- If deleting the active project, clears all state

### Select Project
- Click project card to load its data
- Loads from IDB first (fast), falls back to Firestore if IDB is empty
- Caches Firestore data to IDB for next load
- Restores all state: results, clusters, tokens, groups, blocked keywords, stats

### Persistence
- Project metadata: localStorage + Firestore projects/{id} doc
- Project data: IDB (local cache) + Firestore chunked subcollections (400 rows/doc)
- Active project ID persisted in localStorage for session restore

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
9. Stop word removal — 130+ common English stop words
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
1. Keywords — All individual processed keywords
2. Pages — Clustered keywords (one row per unique token signature)
3. Tokens — Individual tokens with aggregated stats
4. Grouped — Manually or auto-grouped clusters
5. Blocked — Keywords blocked during processing

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
3. Blocked — Blocked tokens and their associated keywords

### Features
- Search bar for finding tokens
- Sortable columns: Token, Volume, Frequency, KD
- Bulk select with checkboxes
- Block/Unblock tokens
- When a token is blocked, all keywords with that token move to Blocked tab
- Clusters and groups recalculate after blocking

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
- Pages tab: Click to expand and see individual keywords
- Grouped tab: Click to expand groups to sub-clusters to keywords

### CSV Export
- Export button downloads current view as CSV
- Includes all columns with proper headers

---

## 7. Dictionaries

### Synonym Map (~300+ entries)
- Curated SEO-intent synonyms (not generic thesaurus)
- Verb-noun normalization: verify/verification, approve/approval, etc.
- Only singular forms needed (singularize runs first)

### Misspelling Map (~120 entries)
- Common typos for finance, legal, and general English terms

### Stop Words (~130 entries)
- Standard English stop words

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
- Compact project header

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
- Batch parallel processing with configurable concurrency (10-100, default 10)
- Stop button to abort mid-generation (in-flight rows revert to Pending)
- Stats bar shows counts: total rows, generated, errors, generating, pending

### Settings (within Generate tab)
- OpenRouter API key input
- Auto-fetches all available models when API key is entered
- Model selector dropdown with search and cost display (price per million tokens)
- Rate limit slider (10-100 concurrent requests)
- Settings persisted to localStorage

### API Integration
- Uses OpenRouter.ai API (v1/chat/completions)
- Supports all models available on OpenRouter
- Displays per-model pricing and context length

---

## Changelog

| Date | Change |
|------|--------|
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
- **Total cost: ~$0.32 per pass** with a cheap model (GPT-4o-mini / OSS 120B)
- **3 passes to fully clean up: ~$0.96 total**

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

*Last updated: 2026-03-24*
