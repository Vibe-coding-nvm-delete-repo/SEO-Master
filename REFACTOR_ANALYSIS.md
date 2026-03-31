# Refactor Analysis

Last updated: `2026-03-31`

This document is a fresh repo-wide analysis of the biggest refactor opportunities in `KWG`.

Use it for:
- current prioritization across app code, tests, tooling, scripts, and docs
- deciding what to tackle next
- understanding which debt is correctness-critical versus mainly velocity-related

Do not use it as the execution checklist for in-flight work. For that:
- use [`REFACTOR_PLAN.md`](./REFACTOR_PLAN.md) as the structured execution tracker for refactor work
- use [`FIXES.md`](./FIXES.md) for bug-level and tactical follow-up items
- use [`PERSISTENCE_AUDIT.md`](./PERSISTENCE_AUDIT.md) for the current shared-persistence status and limits

---

## Scoring

Importance is scored on a `1-10` scale:

- `10`: correctness or data-integrity risk in active paths, or a change that strongly gates safe future work
- `8-9`: major structural problem in frequently edited code
- `5-7`: important tooling, test, or operational debt that weakens confidence or slows delivery
- `1-4`: lower-leverage cleanup or consistency work

---

## Current Hotspots

These current file sizes are far beyond the repo guidelines in [`CONTRIBUTING.md`](./CONTRIBUTING.md) of about `400` lines for components and `800` for utilities:

| File | Current size | Why it matters |
|------|--------------|----------------|
| `src/App.tsx` | `5872` lines | Main app shell still mixes orchestration, persistence, table logic, AI flows, and UI |
| `src/GenerateTab.tsx` | `5651` lines | Large generation surface with persistence, queueing, OpenRouter calls, and rendering coupled together |
| `src/AutoGroupPanel.tsx` | `4383` lines | Settings sync, cosine workflows, QA, reconciliation, and UI all live together |
| `src/useProjectPersistence.ts` | `3040` lines | Correctness-sensitive persistence boundary with transitional APIs still exposed |
| `src/projectCollabV2.ts` | `2160` lines | Shared-project contract is concentrated in a large sensitive module |
| `src/AutoGroupEngine.ts` | `1446` lines | Prompting, parsing, clustering, and queue orchestration are mixed |
| `src/GroupReviewSettings.tsx` | `909` lines | Multiple settings sections and persistence logic are bundled together |
| `src/projectStorage.ts` | `900` lines | Chunking, Firestore, and IDB persistence helpers remain densely packed |
| `src/hooks/useFilteredTableData.ts` | `800` lines | Large derived-state hook in an active table path |
| `src/AppStatusBar.tsx` | `638` lines | Sync status, changelog, and weather behavior share one component |

Additional repo-level signals:
- `src/App.tsx`, `src/AutoGroupPanel.tsx`, and `src/GenerateTab.tsx` all start with file-level ESLint disables
- [`eslint.config.js`](./eslint.config.js) ignores `scripts/` and `src/*.test.*`
- [`vitest.config.ts`](./vitest.config.ts) excludes `src/approvedGroups.test.ts` and `src/uiStructure.test.ts`
- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs typecheck, tests, and build, but not ESLint
- [`package.json`](./package.json) still contains repo-hygiene drift like `name: "react-example"`, duplicate `vite`, and a Unix-only `clean` script

---

## Ranked Opportunities

| Score | Opportunity | Main files | Why this is important | Recommended first move |
|------:|-------------|------------|------------------------|------------------------|
| `10` | Unify the persistence boundary | `src/useProjectPersistence.ts`, `src/projectStorage.ts`, `src/GroupReviewSettings.tsx`, `src/GenerateTab.tsx`, `src/AutoGroupPanel.tsx` | Persistence semantics are still split across multiple patterns. That keeps ref-before-save and snapshot-suppression rules hard to enforce consistently. | Define one shared write/listener contract and move ad hoc settings/doc writes toward it. |
| `10` | Finish simplifying `useProjectPersistence` | `src/useProjectPersistence.ts` | The hook still exposes transitional setters and refs even though its header claims external code should not touch refs directly. That doubles the surface for stale-state mistakes in the most sensitive part of the app. | Extract snapshot guard decisions into pure helpers with tests, then remove or sharply shrink the transitional API. |
| `9` | Split `App.tsx` into a composition shell | `src/App.tsx` plus new hooks/modules | `App.tsx` is the largest runtime hotspot and absorbs unrelated changes across imports, persistence, tables, grouping, auth, tabs, and AI actions. It is expensive to review and risky to touch. | Extract pure helpers and orchestration hooks first, then move tab-specific JSX and handlers out. |
| `9` | Split `GenerateTab.tsx` by responsibility | `src/GenerateTab.tsx` | This file now rivals `App.tsx` in size and mixes app-settings persistence, queue control, model UX, OpenRouter calls, and rendering. It is a major velocity and regression risk. | Separate persistence, generation queue, OpenRouter client code, and table/log UI into dedicated modules. |
| `8` | Split `AutoGroupPanel.tsx` and `AutoGroupEngine.ts` together | `src/AutoGroupPanel.tsx`, `src/AutoGroupEngine.ts` | The panel and engine share a tangled boundary: settings sync, cosine and QA orchestration, prompt builders, and parsing logic are distributed across two oversized modules. | Split UI/state hooks from engine logic, then break engine code into prompts, parsers, clustering, and queue orchestration. |
| `8` | Centralize OpenRouter client and model-selection logic | `src/GenerateTab.tsx`, `src/AutoGroupPanel.tsx`, `src/GroupReviewSettings.tsx`, `src/ModelSelector.tsx`, engine modules | Retry behavior, model fetching, star handling, cost formatting, and JSON extraction are still duplicated. That creates inconsistent error handling and repeated UI logic. | Build shared `openRouterClient` and `useOpenRouterModels` layers, then migrate callers incrementally. |
| `8` | Make quality gates consistent across lint, tests, and CI | `.github/workflows/ci.yml`, `eslint.config.js`, `vitest.config.ts`, `package.json` | Repo confidence is weaker than it looks: CI does not enforce ESLint, some `*.test.ts` files are excluded from Vitest, and test/script code is outside lint coverage. | Decide the intended policy, then align CI, lint scope, and test naming so the green bar means one consistent thing. |
| `8` | Turn on stricter TypeScript enforcement over time | `tsconfig.json`, large runtime files | The repo currently runs without `strict` mode, which leaves nullability and implicit-shape bugs to runtime and review discipline. This is a cross-cutting debt item, not a single-file cleanup. | Stage a strictness migration by enabling targeted flags or a parallel strict config for new/refactored modules first. |
| `8` | Add Firestore rules tests for the V2 contract | `firestore.rules`, Firebase emulator test harness | The rules are now complex enough to be part of the product contract, but they are not protected by dedicated rules-unit tests. Client tests do not prove rule safety. | Add a small emulator-backed rules suite for V2 epoch, lock, and entity-write invariants. |
| `7` | Consolidate refactor and debt tracking docs | `REFACTOR_PLAN.md`, `FIXES.md`, `PERSISTENCE_AUDIT.md`, this doc | Several top-level trackers overlap, and one older plan still describes itself as the single source of truth even though parts of its baseline are stale. | Keep this file as the current audit snapshot, and narrow the other docs to execution tracking and persistence status. |
| `7` | Treat `ContentTab.tsx` as a peer monolith, not a secondary tab | `src/ContentTab.tsx`, related content pipeline modules | The first-pass hotspots are not the only oversized app surfaces. `ContentTab.tsx` is also large and wires many sibling content pipeline modules together, which makes it a real architectural target. | Split orchestration, shared settings, and panel wiring into smaller hooks/components before the next major content feature push. |
| `7` | Reduce support-module concentration around storage and table derivation | `src/projectStorage.ts`, `src/hooks/useFilteredTableData.ts`, `src/projectWorkspace.ts` | These files are not as visible as the main UI monoliths, but they sit in hot paths and are large enough to hide subtle regressions. | Extract pure storage helpers, cache/connection handling, and table derivation helpers into smaller testable units. |
| `7` | Break up cross-cutting status and observability layers | `src/cloudSyncStatus.ts`, `src/AppStatusBar.tsx`, `src/UpdatesTab.tsx` | Sync status, changelog subscriptions, build-name wiring, and status presentation are spread across a few large shared surfaces. Failures here can hide real persistence problems or duplicate subscription logic. | Split core sync-state aggregation from presentation hooks/components, then dedupe changelog/build subscriptions. |
| `6` | Break up oversized support UI modules | `src/GroupReviewSettings.tsx`, `src/AppStatusBar.tsx`, `src/FeedbackModal.tsx` | These files are smaller than the main hotspots but still mix multiple concerns and make simple UI changes feel riskier than they should. | Split by concern: settings sections, weather/sync, and feedback field groups plus submit hooks. |
| `6` | Centralize Firestore-first bootstrap guards | `src/App.tsx`, `src/GenerateTab.tsx`, `src/GroupReviewSettings.tsx`, `src/AutoGroupPanel.tsx` | The repo depends on cache-vs-Firestore bootstrap guards, but the pattern is repeated in several large components instead of being enforced by a shared hook or helper. | Extract a shared bootstrap/listener guard pattern so new persisted features cannot miss it. |
| `6` | Clean up package and script hygiene | `package.json`, `scripts/release.mjs`, `scripts/patch-content-tab.mjs`, backup scripts | Tooling friction accumulates: package metadata is stale, some scripts are platform-specific or powerful one-offs, and the release/build path is more implicit than ideal. | Normalize `package.json`, document dangerous scripts clearly, and consider separating one-off scripts from routine tooling. |
| `6` | Fix test-running ergonomics so developers do not bypass the gate | `.husky/pre-commit`, `vitest.config.ts`, `.github/workflows/ci.yml` | Running the full Vitest suite on every commit creates pressure to use `--no-verify`, while CI still does not enforce the full local gate. That is a process design mismatch. | Move the slowest checks to CI or pre-push, keep commit hooks fast, and make CI enforce the authoritative bar. |
| `5` | Tighten repo-level conventions once structural work lands | `eslint.config.js`, large runtime files, tests | Some relaxed rules are compensating for monolith size. Enforcing them now would create noise, but leaving them forever will preserve the current shape. | After the major splits, remove file-level disables and reintroduce stricter lint coverage where the codebase is ready. |
| `5` | Decouple QA runtime from production persistence paths | `src/qa/contentPipelineQaRuntime.ts`, `src/projectStorage.ts`, `src/appSettingsDocStore.ts`, `src/changelogStorage.ts` | The content QA runtime is large and useful, but production persistence code branches on it directly. That makes core storage modules harder to reason about and test in isolation. | Move QA-mode branching behind narrower adapters so core persistence modules are not directly coupled to the QA harness. |

---

## Area-By-Area Analysis

### 1. Runtime Architecture

The core product code still has three dominant monoliths: `App.tsx`, `GenerateTab.tsx`, and `AutoGroupPanel.tsx`. Together they concentrate most day-to-day change risk in a few files. The issue is not just size. Each one mixes UI rendering, data shaping, persistence edges, and async orchestration in the same unit, which makes bugs harder to localize and refactors harder to stage safely.

The main architectural opportunity is to turn those files into composition shells:
- page or tab shell components stay responsible for layout and wiring
- async workflows move into hooks
- pure transforms move into small testable modules
- shared UI elements move into focused reusable components

This aligns with the repo's own guidance in [`CONTRIBUTING.md`](./CONTRIBUTING.md) and lowers the need for broad hook-dependency disables.

### 2. Persistence And Collaboration

The most important refactor theme in the repo is still persistence consistency. Shared-project V2 has a much clearer contract now, but the broader app still uses more than one persistence style:
- `useProjectPersistence` for main project state
- app-settings doc patterns for Generate and Group Review surfaces
- direct Firestore calls in some UI flows
- separate IDB helpers in storage modules

That split is manageable only while a small set of people remember the rules. It becomes dangerous as soon as more code starts writing shared state. The best refactor here is not only code splitting. It is contract consolidation: fewer ways to write, fewer ways to listen, and fewer places where save and snapshot logic can drift.

### 3. AI And Model Infrastructure

OpenRouter access patterns are still more duplicated than they should be. The repo already has shared timeout utilities and a reusable `ModelSelector`, but actual model-fetch, star-state, retry, and parsing behavior are still spread across multiple surfaces. This is a classic refactor target because it pays off twice:
- fewer bugs and inconsistent retries
- much easier future changes to telemetry, pricing, defaults, or provider behavior

The biggest win is to centralize network behavior first, then unify model UX.

### 4. Tests, Tooling, And Confidence

The repo has strong validation culture, but the enforcement boundary is uneven:
- local hooks run ESLint, typecheck, and tests
- CI runs typecheck, tests, build, but not ESLint
- some files named like tests are intentionally excluded from Vitest
- tests and scripts are outside current lint scope
- Firestore rules have become critical, but they are not backed by rules-unit tests
- `tsconfig.json` still avoids strict-mode enforcement

That does not mean the repo is poorly tested. It means the meaning of a green signal is not fully standardized. A targeted tooling refactor here would likely return more confidence per hour than several medium-sized code cleanups.

Another miss in the first pass was developer ergonomics: the current pre-commit hook runs the full Vitest suite, which makes bypassing hooks more tempting while CI still does not enforce the complete local bar. That is a workflow design issue, not just a tooling detail.

### 5. Documentation And Process

The docs are rich, but refactor ownership is spread across multiple top-level trackers. That is workable when one document is clearly current, but harder when an older tracker still claims to be the single source of truth while newer files carry important context. The doc problem is not volume; it is overlap.

The simplest fix is:
- one current audit snapshot
- one execution tracker
- one persistence-status document
- short cross-links among them

That is the structure this update is meant to support.

One more non-obvious process issue is that some product guarantees are still enforced mostly by team discipline:
- `FEATURES.md` updates
- changelog entry creation
- bootstrap-guard patterns for cache plus Firestore listeners

Those are important, but they are only lightly automated today.

---

## Important Misses From The Second Pass

These did not make the first version strongly enough and deserve explicit callouts:

- `8`: `src/hooks/useFilteredTableData.ts` is a major secondary hotspot. It is effectively shared table logic for multiple views and is large enough to deserve its own staged split.
- `8`: `firestore.rules` is now a real correctness surface, but there is no emulator-backed rules test suite protecting it.
- `8`: `tsconfig.json` not running in strict mode is a meaningful repo-wide safety gap, especially given the size of the persistence and UI monoliths.
- `7`: `src/ContentTab.tsx` is large enough to treat as a first-class refactor target, not just supporting code for the content pipeline helpers.
- `7`: `src/cloudSyncStatus.ts` is an under-discussed shared boundary. It concentrates sync health semantics used across multiple features.
- `6`: the Firestore-first bootstrap guard pattern is repeated instead of encapsulated, which makes it easy to miss in future persisted features.
- `6`: the current pre-commit policy is heavy enough to encourage hook bypass, while CI still does not enforce the full local gate.
- `5`: QA-mode branching reaches directly into core persistence modules, which is useful but creates unnecessary coupling between test harness behavior and production storage paths.

---

## Recommended Sequence

1. Persistence contract consolidation and `useProjectPersistence` simplification.
2. Split `App.tsx` and `GenerateTab.tsx`, because they dominate the active-path risk.
3. Split `AutoGroupPanel.tsx` and `AutoGroupEngine.ts` as one coordinated effort.
4. Centralize OpenRouter client/model infrastructure.
5. Align CI, lint, and test coverage semantics.
6. Clean up secondary UI concentrations and tooling/document overlap.

If the goal is the highest immediate payoff, start with the persistence boundary and `App.tsx`. If the goal is developer velocity on AI surfaces, `GenerateTab.tsx` plus shared OpenRouter/model infrastructure is the best combined slice.
