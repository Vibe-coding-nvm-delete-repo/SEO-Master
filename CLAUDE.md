# CLAUDE.md — AI Agent Instructions

> For architecture details, see `ARCHITECTURE.md`.
> For development workflow rules, see `CONTRIBUTING.md`.

## Core Principles

0. **ALL state must be persisted to IDB + Firestore. ALWAYS.** Every new piece of user-facing state (settings, rows, groups, approved items, toggles, preferences — everything) MUST be saved to IndexedDB and Firestore. No exceptions. No "we'll add persistence later." If it exists in React state, it must be saved and loaded on refresh. Follow the existing 3-tier storage pattern: localStorage (small metadata), IDB (fast cache), Firestore (cloud persistence). This is the #1 rule.
1. **Use full best practices for every implementation.** No shortcuts. No "good enough." Production-quality code every time.
2. **Ask follow-up questions if you are not 100% clear on something.** The user will never be annoyed by clarifying questions. Getting it right matters more than speed.
3. **After every task, run tests and verify the build compiles cleanly.** Run `npx tsc --noEmit`, `npx vitest run`, and `npx vite build` before declaring anything done.
4. **Check component sizes.** If any single file exceeds ~800 lines or any single function exceeds ~100 lines, refactor. See `CONTRIBUTING.md` for extraction patterns.
5. **Update FEATURES.md** every time a new feature is added or existing functionality changes. Mandatory.
6. **Output a clear summary** of all changes made after each task: files modified, why, how it works now, follow-up items.
7. **Match existing UI patterns before writing new UI.** Grep the codebase for existing elements. Copy exact Tailwind classes. Never invent new color schemes. Light theme only — never use `bg-zinc-800`, `text-white`, etc.
8. **Use conventional commits.** Format: `<type>(<scope>): <description>`. Types: feat, fix, refactor, chore, test, docs.

---

## Dev Environment Setup (CRITICAL)

### WDAC (Windows Application Control) is enforced on this machine
WDAC enforcement level 2 (kernel + usermode). **All native `.node` and `.exe` binaries are blocked.** This is a machine-level policy that CANNOT be overridden.

### How the dev server works
WASM/WASI fallbacks for all native deps + Tailwind CDN for CSS:
- `esbuild` → patched to `esbuild-wasm`
- `rollup` → patched with `@rollup/wasm-node`
- `lightningcss` → stubbed out
- `@tailwindcss/oxide` → `@tailwindcss/oxide-wasm32-wasi` via `NAPI_RS_FORCE_WASI=1`
- `@tailwindcss/vite` plugin → **DISABLED** in vite.config.ts
- Tailwind CSS → **CDN script tag** in `index.html`

### Starting the dev server
Use `preview_start` with name `vite-dev`. Config in `.claude/launch.json`.

### NEVER DO THESE THINGS
- **NEVER delete `node_modules`** — WASM patches live inside it
- **NEVER run `npm install` without `--ignore-scripts`** — postinstall scripts fail on WDAC
- **NEVER re-enable `@tailwindcss/vite` plugin** — depends on blocked native oxide
- **NEVER remove the Tailwind CDN script** from index.html
- **NEVER modify `firebase-applet-config.json`** — production Firebase credentials
- **NEVER change the IDB schema** without migration
- **NEVER change the Firestore chunk doc structure** without updating save AND load
- **NEVER reorder CSV processing pipeline steps** without understanding cascading effects
- **NEVER remove `React.memo`** from row components
- **NEVER use `w-full` on the data table** — columns are sized to content

### Recovery (if node_modules is deleted)
```bash
npm run setup
# OR manually:
npm install --ignore-scripts
npm install --ignore-scripts esbuild-wasm @rollup/wasm-node @tailwindcss/oxide-wasm32-wasi --force
node scripts/patch-wasm.cjs
```

### Firebase / Firestore
- **Config:** `firebase-applet-config.json`
- **Project:** `gen-lang-client-0051720373`
- **Database ID:** `ai-studio-ce311d87-660a-4b45-9478-db6c56d1e645`
- **Auth:** Open access (no auth required)
- **Console:** https://console.firebase.google.com/project/gen-lang-client-0051720373/firestore
- **Rules:** Named database — must deploy via `firebase deploy --only firestore` (console doesn't support named DBs)

### Git Push (WDAC blocks libcurl)
Git HTTPS is blocked by WDAC. Use `isomorphic-git` (installed) with a GitHub Personal Access Token:
```bash
node -e "require('isomorphic-git').push({fs:require('fs'),http:require('isomorphic-git/http/node'),dir:'.',remote:'origin',ref:'main',onAuth:()=>({username:'x-access-token',password:'TOKEN'})})"
```

---

## Design Reference (Light Theme)

### Existing class patterns to copy
- **Main tabs:** `px-4 py-2 text-sm font-medium rounded-md transition-all` — Active: `bg-white shadow-sm text-zinc-900` — Inactive: `text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50`
- **Sub-tabs:** `px-3 py-1 text-xs font-medium rounded-md transition-all` — Active: `bg-white shadow-sm text-zinc-900 border border-zinc-200` — Inactive: `text-zinc-500 hover:text-zinc-700`
- **Cards:** `bg-white border border-zinc-200 rounded-xl shadow-sm`
- **Content width:** `max-w-4xl mx-auto`
- **Status badges:** `text-[10px] font-medium px-1.5 py-0.5 rounded-full`
- **Action buttons:** `text-zinc-400 hover:text-zinc-600` (icons) or `bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg` (primary)

### When adding new UI
1. Search for the closest existing element
2. Copy its exact Tailwind classes
3. Only deviate with a clear functional reason

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (localhost:3000) |
| `npm run build` | Production build |
| `npm run lint` | TypeScript + ESLint |
| `npm test` | Run all tests (160+) |
| `npm run setup` | Full install + WASM patches |
