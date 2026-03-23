# Architecture

## System Overview

SEO Master Tool is a client-side SPA for keyword clustering, page grouping, approval workflows, and AI content generation.

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ React UI │  │ IndexedDB│  │ localStorage  │  │
│  │ (Vite)   │  │ (cache)  │  │ (metadata)    │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
└───────┼──────────────┼───────────────┼───────────┘
        │              │               │
        ▼              ▼               ▼
  ┌───────────┐  ┌──────────┐  ┌──────────────┐
  │ OpenRouter│  │ Firestore│  │ Firebase Auth│
  │ (LLM API) │  │ (cloud)  │  │ (future)     │
  └───────────┘  └──────────┘  └──────────────┘
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | React 18 + TypeScript | UI components + type safety |
| Build | Vite 6 | Dev server + production bundler |
| Styling | Tailwind CSS (CDN) | Utility-first CSS |
| Font | Inter (Google Fonts) | Clean, readable typography |
| Icons | Lucide React | Consistent icon set |
| Database | Firebase Firestore | Cloud persistence (chunked docs) |
| Local Cache | IndexedDB | Fast offline reads |
| Metadata | localStorage | Small key-value pairs |
| CSV Parsing | PapaParse | Client-side CSV processing |
| Pluralization | pluralize | Singular/plural normalization |
| LLM API | OpenRouter.ai | Multi-model AI generation |

## Data Flow

### CSV Processing Pipeline (20 steps)
```
CSV Upload → Parse → Foreign Detection → Non-English Filter
  → Location Extraction → Misspelling Correction → 24/7 Normalization
  → Hyphen/Prefix Normalization → Local Intent Unification
  → Singularize → Synonym Replacement → Remove Locations
  → Remove Stop Words → State Abbreviation → Number Normalization
  → Stemming → Signature Generation → Clustering
  → Label Assignment → Token Summary
```

### Storage Flow
```
Save: React State → IDB (instant) + Firestore (background)
Load: IDB (fast) → if empty → Firestore → cache to IDB
Delete: localStorage + IDB + Firestore (all chunks)
```

### Firestore Document Structure
```
projects/{id}/
  meta          — stats, tokenSummary, groupedClusters, blockedTokens
  results_0..N  — ProcessedRow arrays (400 per doc, 1MB limit)
  clusters_0..N — ClusterSummary arrays
  blocked_0..N  — BlockedKeyword arrays

app_settings/
  generate_rows     — Generate tab 1 data
  generate_rows_2   — Generate tab 2 data
  generate_settings — Gen 1 API settings
  generate_settings_2 — Gen 2 API settings
  generate_logs     — Gen 1 execution logs
  generate_logs_2   — Gen 2 execution logs
```

## Key Data Types

| Type | Description |
|------|-------------|
| `ProcessedRow` | Single keyword with tokens, volume, KD, labels, location |
| `ClusterSummary` | A "page" — cluster of keywords sharing same token signature |
| `TokenSummary` | Aggregated stats for a single token across all keywords |
| `GroupedCluster` | A group of ClusterSummary items (manually grouped) |
| `BlockedKeyword` | Keyword removed during processing |
| `Stats` | Processing summary counts |

## Tab Structure

```
SEO Master Tool
├── Group (main tab)
│   ├── Data (sub-tab)
│   │   ├── Project selector + CSV upload
│   │   ├── Stats (collapsible)
│   │   └── Keyword Management
│   │       ├── All
│   │       ├── Pages (Ungrouped)
│   │       ├── Pages (Grouped) — with AI review
│   │       ├── Pages (Approved)
│   │       └── Blocked
│   ├── Projects
│   ├── How it Works
│   └── Dictionaries
└── Generate (main tab)
    ├── Generate 1
    └── Generate 2
```

## Component Architecture

```
App.tsx (5,246 lines — monolithic, planned for extraction)
├── ErrorBoundary (class component)
├── KeywordRow (React.memo)
├── ClusterRow (React.memo)
├── TokenRow (React.memo)
├── GroupedClusterRow (React.memo)
└── App() function
    ├── ~125 useState calls
    ├── ~12 useEffect blocks
    ├── ~30 useMemo computations
    └── ~15 useCallback functions

GenerateTab.tsx (2,020 lines)
├── GenerateTabInstance (the actual UI, React.memo)
└── GenerateTab (wrapper with sub-tab switching)

GroupReviewSettings.tsx (338 lines)
GroupReviewEngine.ts (generates AI review requests)
processing.ts (298 lines — utilities extracted from App.tsx)
types.ts (104 lines — shared TypeScript interfaces)
dictionaries.ts (791 lines — synonym maps, stop words, etc.)
firebase.ts (12 lines — SDK initialization)
```

## Performance Considerations

- Row components use `React.memo` to prevent expensive re-renders
- Filters use `useMemo` with dependency tracking
- Token management uses refs for zero-render cost tracking during generation
- IDB saves are instant; Firestore saves are background/non-blocking
- Generate tab uses 200ms batched flush for output updates
- Firestore docs capped at 400 rows (hard 1MB limit)
