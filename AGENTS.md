# AGENTS.md — Instructions for AI agents and maintainers

This file is the **entry point** for anyone (human or agent) implementing features in this repo. Follow it before writing code.

## Read order

1. **This file** — scope, checklists, debt rules.
2. [`CLAUDE.md`](./CLAUDE.md) — persistence, ref-before-save, Firestore snapshot suppression, verification commands, environment constraints (WDAC, Tailwind CDN, etc.).
3. [`CONTRIBUTING.md`](./CONTRIBUTING.md) — workflow, file layout, testing requirements, technical debt prevention.
4. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data flow, storage shape, where logic should live.
5. [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md) — authoritative shared-project persistence contract, recovery limits, and rollout rules.

## Non‑negotiables (summary)

- **Persistence:** All user-facing state is saved to **IndexedDB and Firestore** (3-tier pattern). No “we’ll persist later.”
- **Ref-before-save:** Update matching `.current` refs **before** any `saveProjectData` / Firestore write so saves never read stale React state. See `CLAUDE.md` for examples.
- **Snapshots:** Set `suppressSnapshotRef` during writes so `onSnapshot` does not clobber in-flight updates.
- **Bootstrap guards:** Any feature that combines async local fallback (IndexedDB/localStorage) with a Firestore listener must use an explicit “Firestore is authoritative” guard so an initial empty/missing snapshot cannot wipe good local state during startup.
- **Multi-user:** Treat Firestore as source of truth for shared projects; design for concurrent editors.
- **Shared-project V2:** Before touching shared-project persistence, read `SHARED_PROJECT_COLLAB_V2.md` and preserve the commit-barrier model. Do not reintroduce whole-project mutable snapshot semantics or legacy fallback reads in V2 mode.
- **Verification before “done”:** `npx tsc --noEmit`, `npx vitest run`, `npx vite build` — zero new errors/failures.
- **FEATURES.md:** Update when user-visible behavior changes ([`FEATURES.md`](./FEATURES.md)).

## Technical debt prevention

The codebase already flags **high-risk concentration** (large `App.tsx`, `AutoGroupPanel.tsx`, `GenerateTab.tsx`). New work must **not** make that worse.

| Do | Don’t |
|----|--------|
| Put **pure logic** (parsing, normalization, prompt building, JSON extraction) in **small, testable modules** (e.g. `*Engine.ts`, `processing.ts`) | Embed hundreds of lines of domain logic inside giant components |
| Add **types** to `src/types.ts` and thread them through saves/loads | Use untyped `any` or ad-hoc shapes on rows/settings |
| Reuse **table column** definitions in `src/tableConstants.ts` + shared `TableHeader` | Duplicate column headers or filter UI |
| Keep new UI/components under the **line limits** in `CONTRIBUTING.md`; extract when approaching limits | Grow a single file past the documented thresholds without a split plan |
| Follow **existing OpenRouter** patterns (`GroupReviewEngine`, `AutoGroupEngine`): fetch in one place, retries for 429, `response_format` where applicable | One-off `fetch` scattered in UI with no shared error handling |
| Extend **existing settings** patterns (e.g. group review settings + Firestore) for new AI toggles | New silent-only local state for settings that should sync |

## Testing requirements (complete coverage for new behavior)

“No additional technical debt” here means: **shipping without tests for new logic is not acceptable** when that logic can be unit-tested.

- **Pure functions** (parsers, validators, rating extraction, prompt builders): **Vitest unit tests** in `src/<module>.test.ts` — happy path, malformed input, edge cases (empty list, duplicate keys, etc.).
- **Persistence / schema changes** (new fields on rows or project docs): extend or add tests next to **`projectStorage` / serialization** (see `src/projectStorage.test.ts` and related) so round-trips and migrations are covered.
- **Regression:** Every bug fix should include a test that fails before the fix.
- **UI:** Prefer testing **behavior** via small component tests or integration tests where the project already does so; don’t skip tests only because something is “UI” if critical logic lives in hooks (test the hook or extracted pure helpers).

If a feature touches **Firestore chunk layout** or **IDB schema**, you must update **both** save and load paths and document or test migration behavior — see `CLAUDE.md` / `ARCHITECTURE.md`.

## Checklist — new feature (e.g. keyword rating, new columns, new AI job)

- [ ] Types in `types.ts`; refs synced before saves; `suppressSnapshotRef` on writes.
- [ ] If cache fallback + Firestore listener both exist, guard startup so async cache cannot overwrite Firestore and an initial empty/missing snapshot cannot erase cached state.
- [ ] Settings and per-row fields appear in **IDB + Firestore** (and localStorage only if appropriate for tiny metadata).
- [ ] Column defs + filters in `tableConstants.ts` if it’s a table column.
- [ ] LLM calls isolated in a **dedicated module** with tests for parsing and edge cases; concurrency/rate limits aligned with existing engines.
- [ ] For shared-project persistence changes, document cache identity/invalidation, epoch activation behavior, and recovery steps.
- [ ] `FEATURES.md` updated.
- [ ] `tsc`, `vitest`, `vite build` all pass.

## Checklist — refactor only

- [ ] No behavior change, or behavior is preserved and covered by tests.
- [ ] Still run `tsc`, `vitest`, `vite build`.

## Where to look for examples

| Concern | Example areas |
|--------|----------------|
| OpenRouter chat + JSON | `GroupReviewEngine.ts`, `groupReviewEngine.test.ts`, `AutoGroupEngine.ts` |
| Settings UI + API key | `GroupReviewSettings.tsx` |
| Table columns / min-max filters | `tableConstants.ts`, `TableHeader.tsx` |
| Persistence boundary | `useProjectPersistence.ts` (treat as sensitive; follow existing patterns) |

---

When in doubt, **ask** before inventing a parallel pattern. One pattern used consistently creates less debt than two “almost the same” implementations.
