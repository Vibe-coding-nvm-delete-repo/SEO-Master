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
- **No mixed-mode bootstrap writes:** Shared-project bootstrap must not allow legacy whole-project writes before storage mode resolves. Preserve the startup write barrier in `useProjectPersistence.ts`.
- **No hidden idle shared-runtime work:** Mounted-but-hidden Generate/Content surfaces must not perform shared listeners, upstream auto-sync, model metadata fetches, or persistence work unless visible or actively busy.
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

## Bug Fix Protocol (mandatory for all bug fixes)

**Every bug fix must follow this protocol. Jumping straight to code is not allowed.**

This protocol exists because the natural tendency — see symptom, patch the line, move on — produces shallow fixes that leave the root cause intact and miss sibling instances of the same bug. Each phase counters a specific failure mode:

| Failure mode | What goes wrong | What prevents it |
|---|---|---|
| **Symptom fixation** | Fix the line that produces wrong output; never ask why it was wrong | Phase 1: Five-whys |
| **Confirmation bias** | Form hypothesis, find supporting evidence, stop looking | Phase 1: Falsification step |
| **Narrow reading** | Read 30 lines around bug, miss context 300 lines away | Phase 2: Full-file reads + caller enumeration |
| **Pattern blindness** | Bug exists in 7 places, fix the 1 that was reported | Phase 2: Codebase-wide grep |
| **Fix-introduced bugs** | The fix itself creates a new race condition or stale closure | Phase 3: Self-audit step |
| **History ignorance** | "Bug" was intentional, or a recent commit introduced regression | Phase 1: Git history check |
| **Premature coding** | Fix "seems obvious," skip diagnosis entirely | Hard gate: no code until Phase 2 complete |

### Phase 1 — Diagnose (before touching ANY code)

This is the most important phase. Rushing past it is the #1 cause of shallow fixes.

1. **Reproduce and trace.** Identify the exact trigger. Trace the full code path from trigger to symptom — every function call, every state read/write. **Read every file involved in full** (not just 20 lines around the bug). Context 200 lines away matters.

2. **Check git history.** Run `git log`/`git blame` on the affected lines. Was this recently changed? Was it written this way intentionally? Read the commit message — there may be a reason for what looks wrong.

3. **Five-whys root cause analysis.** Ask "why?" until you reach something that, if fixed, would prevent the entire CLASS of bug:
   - *Symptom:* "Approved groups disappear on refresh."
   - *Why 1?* setState is called without ref sync before save.
   - *Why 2?* The handler was copied from another handler that uses bulkSet differently.
   - *Why 3?* There's no enforced API that makes ref-before-save automatic.
   - *Why 4?* The persistence layer accepts raw calls without validating ref freshness.
   - → Root cause: the persistence API allows callers to skip ref sync. Fix the API, not just this one call site.
   - **Critical:** Each "why" must be verified by reading actual code. Show the specific line. No hand-waving.

4. **Challenge your hypothesis — actively try to disprove it.**
   - State your hypothesis explicitly: "I believe the bug is caused by X because Y."
   - If correct, what ELSE would you expect to see? Verify those symptoms exist.
   - If correct, what would NOT happen? Check if those things are actually happening (which would disprove you).
   - Is there an alternative explanation that fits the same evidence?
   - Could the bug have MULTIPLE interacting causes?
   - **If you can't disprove it after genuine effort, proceed. If you find contradicting evidence, revise and re-diagnose.**

5. **Explain it back (hard gate — do NOT proceed without this).** Before moving to Phase 2, state:
   - What the **correct** behavior is (specific expected state/output, not just "it shouldn't crash")
   - What the **current** behavior is (specific wrong state/output)
   - **Why** the current code produces wrong behavior (root mechanism)
   - What the fix **needs to change** at the conceptual level

   If you cannot clearly articulate all four, you do not understand the bug yet. Go back to step 1.

### Phase 2 — Map the blast radius (before writing the fix)

6. **Grep for the same pattern.** Search the entire codebase for every instance of the same broken pattern. The reported instance is rarely the only one. **List every instance with file:line.**

7. **Answer these questions in writing (output them in your response):**
   - What other code reads or writes the same state? List every consumer.
   - How many places use the same broken pattern? List each with file:line.
   - What are all callers of the function being fixed? Could any trigger the same class of bug?
   - Could sibling features have the same problem? (e.g., if Generate has this race condition, does Content have it too?)
   - What downstream behavior depends on the thing being fixed? Could fixing it break their assumptions?
   - If async/concurrent: what are ALL possible execution orderings? Enumerate them.
   - If data shape changes: what happens to existing persisted data?

8. **Design the correct solution before coding:**
   - What would the RIGHT design look like if building from scratch? (Prevents band-aid fixes)
   - How close can you get within the scope of this fix?
   - What's the minimal change that fixes the root cause for ALL instances?

### Phase 3 — Fix comprehensively

9. **Fix the root cause, not the symptom.** If the API is error-prone, fix the API. If the pattern is wrong, fix the pattern everywhere.
10. **Fix ALL instances found in Phase 2**, not just the reported one. Document each instance fixed.
11. **Make the wrong thing harder to do.** Can you:
    - Change a type signature so the broken pattern won't compile?
    - Add a runtime assertion that catches this during development?
    - Consolidate duplicated logic into one correct implementation?
    - Add a code comment at the danger point warning future developers?
12. **Add a regression test** that fails before the fix and passes after. Tests the root cause, not just the surface symptom. Non-negotiable.
13. **If the fix touches shared persistence or state:** verify multi-user behavior (two tabs, same project).

14. **Self-audit your own fix (mandatory).** Apply the SAME rigor to your fix:
    - Trace your fix through every code path that touches the modified code — not just the happy path.
    - Does your fix introduce any new race conditions or async timing dependencies?
    - Does your fix reference variables that could become stale in callbacks?
    - Does any downstream code assume the OLD behavior? Will your fix break it?
    - What happens if your fix runs twice? Concurrently? During a page reload?
    - **If you find issues in your self-audit, fix them before proceeding.**

### Phase 4 — Document the fix

15. **Update FIXES.md** — check off the item, add the date, note the root cause and all instances fixed (not just the reported symptom).
16. **If a new pattern was introduced** (e.g., a safer API, a shared helper), document it in AGENTS.md or CONTRIBUTING.md so future code follows it.
17. **If the same class of bug could recur**, add it to the "Non-negotiables" or checklist sections above and propose a structural prevention.

### Anti-patterns — STOP and restart from Phase 1 if you catch yourself doing any of these

- Fixing 1 call site when grep shows N others with the same bug
- Adding a special case / workaround instead of fixing the underlying logic
- Using `try/catch` to silence an error instead of preventing it
- Adding a timeout or delay to "fix" a race condition instead of fixing ordering
- Fixing the test to match wrong behavior instead of fixing the code
- Assuming existing code is correct without verifying — maybe the bug is in the "working" code
- Not checking git history for why code was written this way
- Writing a fix based on skimming 20 lines instead of reading the full file and all callers
- "Fixed the bug" without a regression test
- No blast-radius analysis in the response
- Skipping hypothesis falsification because you're "confident"
- Declaring done without listing scenarios verified and self-audit results

---

## Checklist — bug fix

- [ ] Root cause identified via five-whys (not just the symptom) — written out with code references.
- [ ] Hypothesis explicitly stated and falsification attempted.
- [ ] Git history checked on affected area.
- [ ] Blast radius mapped — all instances of the same pattern listed with file:line.
- [ ] ALL instances fixed, not just the reported one.
- [ ] Correct solution designed before coding (not just first idea).
- [ ] Self-audit performed on the fix itself (race conditions, stale closures, downstream assumptions).
- [ ] Regression test added that fails before the fix.
- [ ] At least 5 edge cases traced and verified.
- [ ] If persistence/state bug: multi-user scenario verified (two tabs).
- [ ] FIXES.md updated with root cause and all instances.
- [ ] `tsc`, `vitest`, `vite build` all pass.

---

## Checklist — new feature (e.g. keyword rating, new columns, new AI job)

- [ ] Types in `types.ts`; refs synced before saves; `suppressSnapshotRef` on writes.
- [ ] If cache fallback + Firestore listener both exist, guard startup so async cache cannot overwrite Firestore and an initial empty/missing snapshot cannot erase cached state.
- [ ] If shared-project bootstrap can still be in `legacy` mode locally, preserve the persistence-boundary write barrier so no legacy chunk save can fire before storage mode resolves.
- [ ] Settings and per-row fields appear in **IDB + Firestore** (and localStorage only if appropriate for tiny metadata).
- [ ] Column defs + filters in `tableConstants.ts` if it’s a table column.
- [ ] LLM calls isolated in a **dedicated module** with tests for parsing and edge cases; concurrency/rate limits aligned with existing engines.
- [ ] For shared-project persistence changes, document cache identity/invalidation, epoch activation behavior, and recovery steps.
- [ ] If Generate/Content mount behavior changes, verify hidden idle surfaces still do not perform background shared sync/persist/model-fetch work.
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
