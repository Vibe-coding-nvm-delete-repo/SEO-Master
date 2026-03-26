# Plan: Technical Debt Prevention — CLAUDE.md Update + REFACTOR_PLAN.md

## Problem

The codebase has massive technical debt despite having rules that should have prevented it:
- `App.tsx`: **5,656 lines** (limit: ~400 for components)
- `AutoGroupPanel.tsx`: **4,116 lines**
- `GenerateTab.tsx`: **1,974 lines**
- `AutoGroupEngine.ts`: **1,409 lines**
- App.tsx alone has 54+ useState, 30+ useCallback, 12+ useMemo, 10 useEffect blocks

The rules in CONTRIBUTING.md say "max ~400 lines per component" but were never enforced.

## Deliverables

### 1. Add "Technical Debt Prevention" section to CLAUDE.md (after Core Principles)

New rules to add:

**A. Hard Ceiling Enforcement (the "debt ceiling" rule)**
- Before adding ANY feature or logic to a file, check its line count
- If a file is already over 400 lines (component) or 800 lines (utility), you MUST extract before adding
- No exceptions. No "I'll refactor after." Extract first, implement second.

**B. Pre-Implementation Size Check**
- Run `wc -l` on target files before writing code
- If over limit: identify what to extract, do the extraction, verify tests pass, THEN implement the feature

**C. Extraction Patterns (concrete guidance)**
- State + effects for a feature area → custom hook in `src/hooks/use<Feature>.ts`
- Pure logic/helpers → utility in `src/<feature>.ts`
- JSX sections with their own state → component in `src/components/<Name>.tsx`
- JSX sections that are just markup → component in `src/components/<Name>.tsx`
- Shared row renderers → `src/components/<Name>Row.tsx`
- Types → `src/types.ts` (or `src/<feature>.types.ts` if large)

**D. New Feature Checklist (mandatory before declaring done)**
- [ ] No file I touched exceeds its size limit
- [ ] No function I wrote exceeds 100 lines
- [ ] New hooks/components follow existing naming patterns
- [ ] Tests pass, types check, build succeeds

**E. Never-Grow Rules**
- Never add a new useState to App.tsx — extract a hook instead
- Never add new JSX sections inline — create a component
- Never add handler functions >50 lines inline — extract to hook or utility

### 2. Create REFACTOR_PLAN.md — Specific extraction roadmap

This is a standalone doc with the concrete plan for paying down existing debt. Organized by file, priority order, with specific extraction targets and line ranges.

#### App.tsx (5,656 → target ~600 lines)

**Phase 1 — Row Components (quick wins, ~490 lines)**
- Extract `ClusterRow` (lines 277-449) → `src/components/ClusterRow.tsx`
- Extract `TokenRow` (lines 451-492) → `src/components/TokenRow.tsx`
- Extract `GroupedClusterRow` (lines 494-767) → `src/components/GroupedClusterRow.tsx`

**Phase 2 — Utility Functions (~177 lines)**
- Extract `buildGroupedClusterFromPages()`, `mergeGroupedClustersByName()`, `slugifyProjectName()`, `projectUrlKey()`, `escapeJsonFromModelResponse()`, `parseFilteredAutoGroupResponse()` → `src/clustering.ts`

**Phase 3 — Custom Hooks (biggest impact, ~1,500+ lines)**
- `useFilteredData` — all filtering useMemo blocks (lines 1927-2154)
- `useSorting` — multi-sort logic (lines 2158-2258)
- `useTokenMerge` — merge handlers (lines 2657-2778)
- `useTokenBlocking` — block/unblock (lines 2781-2828)
- `useGroupApproval` — approve/unapprove/remove (lines 2829-2921)
- `useFilteredAutoGroup` — AI auto-group pipeline (lines 3155-3430)
- `useKeyboardShortcuts` — shortcuts (lines 3431-3471)
- `useProjectManagement` — project CRUD (lines 1121-1167)

**Phase 4 — JSX Components (~1,500+ lines)**
- `src/components/UploadZone.tsx` — drag-drop upload area
- `src/components/StatsCard.tsx` — collapsible stats
- `src/components/LabelSidebar.tsx` — label filter sidebar
- `src/components/TableControls.tsx` — search, filter, pagination controls
- `src/components/DataTable.tsx` — main data table rendering
- `src/components/ProjectsTab.tsx` — projects management tab
- `src/components/SettingsTab.tsx` — settings/token management tab

#### AutoGroupPanel.tsx (4,116 → target ~800 lines)

**Phase 1 — Custom Hooks (~1,300 lines)**
- `useCosineSearch` — entire cosine similarity pipeline (lines 750-1468)
- `useAutoGroupPipeline` — auto-group v1 + QA + reconciliation (lines 1677-2215)
- `useAutoGroupSettings` — Firestore-synced settings (lines 317-396)

**Phase 2 — Utilities (~250 lines)**
- `src/cosineHelpers.ts` — cluster builders, resolved groups, embedding helpers
- `src/suggestionHelpers.ts` — suggestion normalization, rebuild
- Move CSV export helpers to shared `src/csvExport.ts`

**Phase 3 — Sub-Components (~800 lines)**
- `<AutoGroupSettings />` — settings panel
- `<UngroupedPagesView />` — ungrouped table
- `<GroupedSuggestionsView />` — grouped suggestions table
- `<CosineInitialStage />` — cosine initial tab
- `<CosineRetryLoopStage />` — retry loop results

#### GenerateTab.tsx (1,974 → target ~500 lines)

**Phase 1 — Custom Hooks (~700 lines)**
- `useGenerationEngine` — worker pool, retry logic, batch updates (lines 912-1216)
- `useRowPersistence` — Firestore chunked save/load for rows + logs (lines 264-411)
- `useSettingsPersistence` — settings load/save with live-sync (lines 619-677)
- `useModelManagement` — OpenRouter model fetch, filter, star (lines 750-830)

**Phase 2 — Utilities (~100 lines)**
- `src/formatters.ts` — formatElapsed, formatCost
- `src/clipboardUtils.ts` — parseSheetsPaste, bulk copy, export CSV

**Phase 3 — Sub-Components (~300 lines)**
- `<GenerateSettingsPanel />` — settings form
- `<ModelDropdown />` — model selector with search/sort/star

#### AutoGroupEngine.ts (1,409 → target ~400 lines)

- Split into `src/autoGroupAssignment.ts` (assignment logic) and `src/autoGroupQA.ts` (QA logic)
- Extract prompt builders to `src/autoGroupPrompts.ts`

### 3. Update ARCHITECTURE.md

Update the component architecture section to reflect the target state after refactoring.

## Implementation Steps

1. Write the new "Technical Debt Prevention" section in CLAUDE.md (after line 37, before "Dev Environment Setup")
2. Create REFACTOR_PLAN.md at the project root with the full extraction roadmap
3. Update ARCHITECTURE.md component section to note the planned refactor targets
4. Run `npx tsc --noEmit` and `npx vitest run` to verify nothing was broken (docs-only change)

## What This Does NOT Do

- Does not execute any refactoring (that's a separate task)
- Does not change any source code
- Only adds documentation and enforcement rules
