# Contributing Guide

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
- **New hooks** go in `src/hooks/use<Name>.ts`
- **New components** go in `src/components/<Name>.tsx`

### Naming Conventions
- **Files:** camelCase for utils (`processing.ts`), PascalCase for components (`GenerateTab.tsx`)
- **Functions:** camelCase (`handleGroupClusters`)
- **Types/Interfaces:** PascalCase (`ProcessedRow`, `ClusterSummary`)
- **Constants:** UPPER_SNAKE for true constants (`IDB_VERSION`), camelCase for config objects
- **CSS:** Tailwind utility classes only — no custom CSS unless absolutely necessary

### Testing
- Every new feature must include tests
- Every bug fix must include a regression test
- Test files: `src/<name>.test.ts` or `src/<name>.test.tsx`
- Use Vitest (`describe`, `it`, `expect`)
- Run tests: `npm test` or `npm run test:watch`

### State & Persistence (Critical Rule)
**ALL user-facing state MUST be persisted.** Follow the 3-tier pattern:
1. **localStorage** — small metadata only (project list, active ID)
2. **IndexedDB** — fast local cache (full datasets)
3. **Firestore** — cloud persistence (chunked for large data)

Never add state that only lives in React memory. If it matters to the user, it must survive a refresh.

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
