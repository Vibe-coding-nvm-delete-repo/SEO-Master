# Contributing Guide

**AI agents / automation:** start with [`AGENTS.md`](./AGENTS.md) (persistence, testing, and technical-debt rules), then this file. For bug/debug/regression work, also invoke the local Codex `bug-fixing` skill when it is installed.

## Development Workflow

### Branch Strategy
- `main` — production-ready code, always deployable
- `feat/<name>` — new features (e.g., `feat/export-pdf`)
- `fix/<name>` — bug fixes (e.g., `fix/copy-all-formatting`)
- `refactor/<name>` — code restructuring without behavior change
- `chore/<name>` — tooling, deps, CI changes

### Commit Conventions (Conventional Commits)
Every commit message must follow this format:
```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `style`, `perf`
**Scope:** optional, e.g., `generate`, `grouping`, `tokens`, `ui`

Examples:
```
feat(generate): add web search toggle for OpenRouter
fix(grouping): prevent duplicate pages in ungrouped tab
refactor(app): extract types to types.ts
chore(ci): add GitHub Actions workflow
test(engine): fix dynamic concurrency worker count test
```

### Pull Request Process
1. Create a feature branch from `main`
2. Make changes, commit with conventional messages
3. Ensure all checks pass locally: `npm run lint && npm test`
4. Push and create PR using the PR template
5. PR title follows conventional commit format
6. Self-review the diff before requesting review
7. Squash merge to `main`

### Pre-Commit Checks (Automated)
Every commit automatically runs:
1. `tsc --noEmit` — TypeScript type checking
2. `eslint` — Code quality linting
3. `vitest run` — All tests must pass

If any check fails, the commit is blocked. Fix the issue and try again.

## Code Standards

### File Organization
- **Max ~400 lines** per component file
- **Max ~800 lines** per utility file
- **Types** go in `src/types.ts`
- **Processing utilities** go in `src/processing.ts`
- **Table column definitions** go in `src/tableConstants.ts`
- **Shared table header** — use `src/TableHeader.tsx` (never duplicate header JSX)
- **Label filter dropdown** — use `src/LabelFilterDropdown.tsx` (never duplicate)
- **New hooks** go in `src/hooks/use<Name>.ts`
- **New components** go in `src/components/<Name>.tsx`

### Shared Table System
All keyword management tabs share a single `TableHeader` component:
- Column definitions live in `src/tableConstants.ts` (widths, sort keys, filter types)
- To add a new tab: define a `ColumnDef[]` array in tableConstants, pass it to `<TableHeader>`
- To change column widths/padding: edit `COL` or `CELL` constants — all tabs update automatically
- Never hardcode column headers inline — always use the shared system

### Naming Conventions
- **Files:** camelCase for utils (`processing.ts`), PascalCase for components (`GenerateTab.tsx`)
- **Functions:** camelCase (`handleGroupClusters`)
- **Types/Interfaces:** PascalCase (`ProcessedRow`, `ClusterSummary`)
- **Constants:** UPPER_SNAKE for true constants (`IDB_VERSION`), camelCase for config objects
- **CSS:** Tailwind utility classes only — no custom CSS unless absolutely necessary

### Testing
- Every new feature must include tests appropriate to the change (see [`AGENTS.md`](./AGENTS.md))
- Every bug fix must include a regression test
- Every bug/debug session must follow the `bug-fixing` skill workflow plus the `AGENTS.md` bug-fix protocol before code changes start
- Test files: `src/<name>.test.ts` or `src/<name>.test.tsx`
- Use Vitest (`describe`, `it`, `expect`)
- Run tests: `npm test` or `npm run test:watch`

**Minimum expectations by change type:**
- **New pure logic** (parsers, validators, prompt/response helpers, rating extraction): unit tests covering happy path, invalid input, and at least one edge case (empty, boundary, duplicate).
- **New persisted fields** (rows, settings, chunks): exercise save/load or serialization in tests so round-trips do not drop data; follow existing `projectStorage` / storage tests.
- **New LLM integration:** isolate HTTP + parsing in a dedicated module; unit-test parsing without live API calls; mirror retry/`response_format` patterns from existing engines.

### Technical debt prevention (mandatory)
- **Do not** add user-facing state that only lives in React memory — it must follow the 3-tier persistence rules in this document and in [`AGENTS.md`](./AGENTS.md).
- **Do not** grow monolith files when the change can be a hook (`src/hooks/`) or engine module; respect the file-size guidelines above.
- **Do not** duplicate `TableHeader`, label dropdowns, or column definitions — extend `tableConstants.ts` and shared components.
- **Do not** skip tests for new logic “because it’s simple”; trivial helpers still regress when others edit them.
- **Do not** add raw `firebase/firestore` reads, writes, or listeners in app-facing UI/hooks without first classifying the callsite and routing it through the shared collaboration contract.
- Run `npm run collab:gate` before release work or any shared-persistence refactor; it is the Firestore census/audit barrier that prevents unclassified collaboration touchpoints from slipping in.

### State & Persistence (Critical Rule)
**ALL user-facing state MUST be persisted.** Follow the 3-tier pattern:
1. **localStorage** — small metadata only (project list, active ID)
2. **IndexedDB** — fast local cache (full datasets)
3. **Firestore** — cloud persistence (chunked for large data)

Never add state that only lives in React memory. If it matters to the user, it must survive a refresh.

When a feature uses both local fallback data and a Firestore listener, startup must be explicitly guarded:
- cached fallback must not overwrite authoritative Firestore once Firestore has loaded
- cache-only empty/missing snapshots must not wipe good local state during bootstrap
- the first truly authoritative empty state must be distinguished from “Firestore has not caught up yet”

### UI/Design Rules
- **Light theme only** — never use dark classes (`bg-zinc-800`, `text-white`)
- **Match existing patterns** — grep codebase for similar elements before writing new UI
- **Inter font** — loaded via CDN in index.html
- **No element shifting** — use fixed min-widths, reserved space for dynamic content
- **Consistent spacing** — follow existing padding/margin patterns

## Local Development

### Quick Start
```bash
npm run setup    # Full install + WASM patches
npm run dev      # Start dev server at localhost:3000
```

### Available Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | TypeScript + ESLint check |
| `npm run typecheck` | TypeScript only |
| `npm test` | Run all tests |
| `npm run test:watch` | Tests in watch mode |
| `npm run setup` | Full dependency install + WASM patches |

### Worktree Workflow (Claude Code Agents)

Claude Code agents work in isolated git worktrees under `.claude/worktrees/`. Here's the full merge + deploy process:

**1. Verify in the worktree** (agent does this before declaring done):
```bash
npx tsc --noEmit      # zero errors
npx vitest run        # all tests pass
npx vite build        # clean build
```

**2. Commit in the worktree** (pre-commit hooks may fail in worktrees due to missing `.bin` links — use `--no-verify` if the 3 checks above already passed):
```bash
git add <files>
git commit --no-verify -m "type(scope): description"
```

**3. Merge to main:**
```bash
cd C:/Users/chris/Downloads/KWG   # main repo root
git stash                          # stash any uncommitted main changes
git merge claude/<worktree-name> --no-edit
git stash pop                      # restore stashed changes
```

**4. Build + deploy:**
```bash
cd C:/Users/chris/Downloads/KWG
NAPI_RS_FORCE_WASI=1 npx vite build
npx firebase deploy --only hosting,storage --project new-final-8edfc
```

If `npm run build` fails with "vite not recognized", run setup first:
```bash
npm install --ignore-scripts --legacy-peer-deps
npm install --ignore-scripts --legacy-peer-deps esbuild-wasm @rollup/wasm-node --force
node scripts/patch-wasm.cjs
```

**5. Clean up worktree** (optional — use `/exit-worktree` or leave for reference):
```bash
git worktree remove .claude/worktrees/<name>
git branch -d claude/<name>
```

### Firebase Deployment

| Target | Command |
|--------|---------|
| Hosting + Storage | `npx firebase deploy --only hosting,storage --project new-final-8edfc` |
| Firestore rules only | `firebase deploy --only firestore --project new-final-8edfc` |
| Preview channel | `npx firebase hosting:channel:deploy kwg-verify --project new-final-8edfc` |

**Production URL:** https://new-final-8edfc.web.app
**Console:** https://console.firebase.google.com/project/new-final-8edfc/overview
