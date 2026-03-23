# CLAUDE.md — Project Instructions for AI Agents

## Core Principles

0. **ALL state must be persisted to IDB + Firestore. ALWAYS.** Every new piece of user-facing state (settings, rows, groups, approved items, toggles, preferences — everything) MUST be saved to IndexedDB and Firestore. No exceptions. No "we'll add persistence later." If it exists in React state, it must be saved and loaded on refresh. Follow the existing 3-tier storage pattern: localStorage (small metadata), IDB (fast cache), Firestore (cloud persistence). This is the #1 rule.
1. **Use full best practices for every implementation.** No shortcuts. No "good enough." Production-quality code every time.
2. **Ask follow-up questions if you are not 100% clear on something.** The user will never be annoyed by clarifying questions. Getting it right matters more than speed.
3. **After every task, run tests and verify the build compiles cleanly.** Run `npx tsc --noEmit` and `npx vite build` before declaring anything done.
4. **Check component sizes.** If any single file exceeds ~800 lines or any single function exceeds ~100 lines, refactor using the best practices outlined below.
5. **Update FEATURES.md** every time a new feature is added or existing functionality changes. This is mandatory, not optional.
6. **Output a clear summary** of all changes made to the user after each task, in a consistent format:
   - What was changed (files modified)
   - Why it was changed
   - How it works now
   - Any follow-up items or known limitations
7. **Match existing UI patterns before writing new UI.** Before creating any new button, tab, card, or layout, grep the codebase for existing examples of that element and copy the exact class names. Never invent new color schemes, spacing, or border styles. This app uses a light theme — see the Design Reference section below.

---

## Dev Environment Setup (CRITICAL — Read Before Doing Anything)

### WDAC (Windows Application Control) is enforced on this machine
This machine has WDAC enforcement level 2 (kernel + usermode). **All native `.node` and `.exe` binaries are blocked from running** — including esbuild, rollup, lightningcss, and @tailwindcss/oxide. This is a machine-level policy that CANNOT be overridden by exclusions or admin commands.

### How the dev server works
We use **WASM/WASI fallbacks** for all native dependencies + **Tailwind CDN** for CSS processing:
- `esbuild` → patched to use `esbuild-wasm` (pure JS, no native binary)
- `rollup` → patched with `@rollup/wasm-node` (WASM bindings copied to `node_modules/rollup/dist/`)
- `lightningcss` → stubbed out (not needed — Tailwind CDN handles CSS)
- `@tailwindcss/oxide` → uses `@tailwindcss/oxide-wasm32-wasi` via `NAPI_RS_FORCE_WASI=1` env var
- `@tailwindcss/vite` plugin → **DISABLED** in vite.config.ts (Tailwind CDN in index.html handles it)
- Tailwind CSS → loaded via **CDN script tag** in `index.html` (processes classes at runtime in browser)

### How to start the dev server
The `.claude/launch.json` is configured to run:
```
NAPI_RS_FORCE_WASI=1 node node_modules/vite/bin/vite.js --port=3000 --host=0.0.0.0
```
Use `preview_start` with name `vite-dev` to start it.

### NEVER DO THESE THINGS
- **NEVER delete `node_modules`** — the WASM patches are inside it. Deleting forces a full reinstall + re-patch cycle.
- **NEVER run `npm install` without `--ignore-scripts`** — the postinstall scripts try to execute native binaries and FAIL.
- **NEVER re-enable `@tailwindcss/vite` plugin** in vite.config.ts — it depends on native oxide which is blocked.
- **NEVER remove the Tailwind CDN script** from index.html — it's the only thing providing CSS.

### If node_modules is accidentally deleted, run this recovery sequence:
```bash
npm install --ignore-scripts
npm install --ignore-scripts esbuild-wasm @rollup/wasm-node @tailwindcss/oxide-wasm32-wasi --force
node scripts/patch-wasm.cjs  # Patches esbuild/rollup/lightningcss to use WASM fallbacks
```

### Firebase / Firestore Setup
- **Config file:** `firebase-applet-config.json` (NEVER modify — contains production credentials)
- **Project:** `gen-lang-client-0051720373`
- **Database ID:** `ai-studio-ce311d87-660a-4b45-9478-db6c56d1e645`
- **Auth:** Currently open access (no auth required). Firestore rules allow all reads/writes.
- **SDK init:** `src/firebase.ts` — exports `db` (Firestore), `auth`, `googleProvider`
- **Console URL:** https://console.firebase.google.com/project/gen-lang-client-0051720373/firestore

### Firestore Security Rules (must be set in Firebase Console > Firestore > Rules)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
If you see `permission-denied` errors in the console, the rules above need to be re-published.

### Deployment (Firebase Hosting)
To deploy for public access:
```bash
npm install -g firebase-tools
firebase login
firebase init hosting  # Select existing project, set public dir to "dist"
npm run build
firebase deploy
```
Live URL: `gen-lang-client-0051720373.web.app`

---

## Refactoring Best Practices

When a component or file is too large, follow these rules:

### File Size Limits
- **Components:** Max ~400 lines per component file. Extract sub-components.
- **Utility files (dictionaries, helpers):** Max ~800 lines. Split by domain (e.g., `synonyms.ts`, `states.ts`, `misspellings.ts`).
- **App.tsx is currently monolithic (~4000+ lines).** This is a known debt. When making changes, prefer extracting new logic into separate files/hooks rather than adding more to App.tsx.

### Extraction Patterns
- **Custom hooks:** Extract `useState`/`useEffect`/`useMemo` clusters into `useProjectStorage.ts`, `useFilters.ts`, `useTokenManagement.ts`, etc.
- **Sub-components:** Row components (KeywordRow, ClusterRow, GroupedClusterRow) are already extracted via `React.memo`. Follow this pattern for new table rows or UI sections.
- **Constants/config:** Move hardcoded values to a `constants.ts` file.
- **Processing logic:** The CSV processing pipeline should eventually move to a dedicated `processor.ts` or web worker.

### When NOT to Refactor
- Don't refactor mid-feature. Finish the feature first, then refactor if needed.
- Don't split files just to hit a line count. Split when there's a logical boundary.

---

## Project Architecture

### Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS v4
- **Backend/DB:** Firebase (Firestore) — chunked subcollections for large data
- **Local cache:** IndexedDB (fast reads) + localStorage (small metadata)
- **CSV parsing:** PapaParse
- **Pluralization:** `pluralize` npm package
- **Icons:** Lucide React
- **No Gemini API needed** — the API key import exists but is unused. Do not add Gemini calls.

### File Structure
```
src/
  App.tsx          — Main application component (monolithic, ~4000 lines)
  dictionaries.ts  — Synonym map, misspelling map, stop words, state maps, foreign countries/cities
  firebase.ts      — Firebase SDK initialization (Firestore + Auth)
  index.css        — Tailwind imports + custom styles
us-cities.json     — US city names for location detection
firebase-applet-config.json — Firebase project config
CLAUDE.md          — This file (agent instructions)
FEATURES.md        — Living documentation of all features
```

### Storage Layer (3-tier)
1. **localStorage** — Project metadata list, active project ID, saved clusters (small data only)
2. **IndexedDB** — Full project data (results, clusters, tokens, groups). Fast local cache.
3. **Firestore** — Persistent cloud storage. Chunked subcollections (400 rows/doc) under `projects/{id}/chunks/`.
   - `meta` doc: stats, tokenSummary, groupedClusters, blockedTokens, chunk counts
   - `results_0..N` docs: ProcessedRow arrays (400 per doc)
   - `clusters_0..N` docs: ClusterSummary arrays
   - `blocked_0..N` docs: BlockedKeyword arrays

**Save flow:** IDB (instant) + Firestore (background, non-blocking) simultaneously.
**Load flow:** Try IDB first → if empty, load from Firestore → cache to IDB.
**Delete flow:** Remove from localStorage + IDB + Firestore (metadata doc + all chunk docs).

**Constraint:** Firestore has a hard 1MB per document limit. Never store more than 400 rows per chunk doc. Never try to increase this limit — it cannot be changed.

---

## Key Data Structures

```typescript
ProcessedRow       — Single keyword with its tokens, volume, KD, labels, location
ClusterSummary     — A "page" (cluster of keywords sharing the same token signature)
TokenSummary       — Aggregated stats for a single token across all keywords
GroupedCluster     — A group of ClusterSummary items (manually grouped or auto-grouped by location)
BlockedKeyword     — A keyword blocked during processing (foreign, token-blocked, etc.)
Stats              — Processing summary counts
```

### Terminology
- **Keyword** = raw search term from CSV
- **Token** = normalized word unit after processing pipeline
- **Signature** = sorted, deduplicated token string (used as cluster key)
- **Page / Cluster** = group of keywords sharing the same signature (displayed as "Pages" tab)
- **Group** = user-defined or auto-generated collection of clusters (displayed as "Grouped" tab)
- **Blocked** = keywords removed during processing (foreign entities, blocked tokens)

---

## CSV Processing Pipeline (Order Matters!)

The processing pipeline runs in this exact order. Do NOT reorder steps without understanding the dependencies:

1. **Parse CSV** — PapaParse, skip empty lines, detect header row
2. **Foreign entity detection** — Block keywords containing foreign countries/cities
3. **Non-English/URL detection** — Route to N/A cluster
4. **Location extraction** — Detect city/state from raw keyword tokens BEFORE normalization
   - NYC/NYS aliases → "New York City" / "New York"
   - LA alias → "Los Angeles" / "California"
   - State detection (2-word then 1-word, using stateSet)
   - City detection (multi-word then single-word, using citySet from us-cities.json)
   - Reject states appearing as cities
5. **Misspelling correction** — `misspellingMap` regex replacement
6. **24/7 normalization** — Collapse "24/7", "24 hour" variants
7. **Hyphen/prefix normalization** — Join split prefixes (re-finance → refinance, e-mail → email)
8. **Local intent unification** — "near me", "close to me", etc. → "nearby"
9. **Singularize** — `pluralize.singular()` on each word (runs BEFORE synonym lookup)
10. **Synonym replacement** — `synonymMap` regex (matches against singularized words)
11. **Remove countries/cities** — Strip multi-word location names from token string
12. **Remove stop words** — Filter out articles, prepositions, etc.
13. **State abbreviation normalization** — Full state names → 2-letter abbreviations in tokens
14. **Number normalization** — Word numbers → digits via `numberMap`
15. **Stemming** — Lightweight suffix stripper (`stem()` function)
16. **Signature generation** — Deduplicate tokens, sort alphabetically, join with spaces
17. **Clustering** — Group keywords by signature, pick highest-volume keyword as page name
18. **Label assignment** — Classify clusters (FAQ, Commercial, Local, Informational, etc.)
19. **Auto-grouping** — Group location clusters by city/state automatically
20. **Token summary** — Aggregate per-token statistics

---

## Don't-Touch Rules

- **Never modify `firebase-applet-config.json`** — contains production Firebase credentials
- **Never change the IDB schema** without a proper migration (increment `IDB_VERSION`, handle `onupgradeneeded`)
- **Never change the Firestore chunk doc structure** without updating both save and load functions
- **Never reorder processing pipeline steps** without understanding cascading effects
- **Never add Gemini API calls** — the import exists but is intentionally unused
- **Never remove `React.memo`** from row components — they prevent expensive re-renders
- **Never use `w-full` on the data table** — columns are sized to content per user preference

---

## Design Reference (Light Theme)

All UI must match the existing light theme. **Never** use dark-themed classes (`bg-zinc-800`, `bg-zinc-950`, `text-white`, `border-zinc-700`, etc.) for UI elements. Grep the codebase for existing patterns before writing any new UI.

### Existing class patterns to copy
- **Main tabs (Tool, Generate, etc.):** `px-4 py-2 text-sm font-medium rounded-md transition-all` — Active: `bg-white shadow-sm text-zinc-900` — Inactive: `text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50`
- **Sub-tabs (Table/Log, Generate 1/2):** `px-3 py-1 text-xs font-medium rounded-md transition-all` — Active: `bg-white shadow-sm text-zinc-900 border border-zinc-200` — Inactive: `text-zinc-500 hover:text-zinc-700`
- **Cards/containers:** `bg-white border border-zinc-200 rounded-xl shadow-sm`
- **Content width:** `max-w-4xl mx-auto`
- **Status badges:** `text-[10px] font-medium px-1.5 py-0.5 rounded-full`
- **Action buttons:** `text-zinc-400 hover:text-zinc-600` (icons) or `bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg` (primary)

### When adding new UI
1. Search for the closest existing element (button, tab, card, badge)
2. Copy its exact Tailwind classes
3. Only deviate if there's a clear functional reason (and document why)

---

## Common Patterns

### Adding a new synonym
Add to `synonymMap` in `dictionaries.ts`. Only add the **singular** form (singularize runs before synonym lookup). The key is lowercase. Example:
```typescript
"automobile": "car",  // singular only, "automobiles" handled by singularize
```

### Adding a new tab
1. Add to the `activeTab` union type
2. Add tab button in the tab bar section
3. Add table headers in the `<thead>` conditional
4. Add table body rendering in the `<tbody>` conditional
5. Add pagination logic for the new tab's data

### Blocking logic
- **Token blocking:** User blocks a token in Token Management → all keywords containing that token move to Blocked tab → clusters/groups recalculate
- **Foreign blocking:** Automatic during CSV processing via `detectForeignEntity()`
- Blocked tokens persist in IndexedDB + Firestore as `blockedTokens` array

---

## Testing Checklist (Run After Every Task)

1. `npx tsc --noEmit` — must pass with zero errors
2. `npx vite build` — must build successfully
3. Verify dev server starts: `npm run dev` → http://localhost:3000
4. If CSV processing changed: re-upload a test CSV and verify counts
5. If storage changed: create a new project, upload CSV, refresh browser, verify data persists
6. If UI changed: visually verify the affected tab/section renders correctly
