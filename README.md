# SEO Magic

`KWG` is the only approved source repo for the Firebase site `new-final-8edfc`.

## Documentation Map

- [`docs/group-project-flow.md`](./docs/group-project-flow.md) — visual Group workspace flow, shared sync path, and collaboration guarantees
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system shape and storage model
- [`SHARED_PROJECT_COLLAB_V2.md`](./SHARED_PROJECT_COLLAB_V2.md) — shared-project persistence contract
- [`PERSISTENCE_AUDIT.md`](./PERSISTENCE_AUDIT.md) — current persistence-state summary and remaining limits
- [`REFACTOR_ANALYSIS.md`](./REFACTOR_ANALYSIS.md) — latest repo-wide refactor analysis and importance scoring
- [`REFACTOR_PLAN.md`](./REFACTOR_PLAN.md) — execution tracker for refactor work
- [`FIXES.md`](./FIXES.md) — tactical bug and follow-up tracker

## Local Development

1. Install dependencies with `npm run setup`
2. Run the app with `npm run dev`
3. Build with `npm run build`

## AI Defaults

- The preferred default OpenRouter model across `Generate`, `Content`, `Group Review`, and dedicated `Auto-Group` settings is `OpenAI GPT-5.4 mini` (`openai/gpt-5.4-mini`).
- `Keyword Rating` and `Auto Merge` still support dedicated override models, but when those override fields are left empty they inherit the main Group Review model.

## Release Commands

Use only these checked-in commands for hosting releases. Do not run ad hoc `firebase deploy` commands.

- `npm run release:check`
  - Validates that you are in the `KWG` repo root
  - Verifies the Firebase project/site config
  - Verifies the expected app markers (`SEO Magic`, `Content`, and the content-generation tagline)
  - Fails on dirty tracked files unless you intentionally use `--allow-dirty` through `node scripts/release.mjs ...`

- `npm run release:preview`
  - Runs the predeploy guard
  - Builds from `KWG`
  - Deploys to the Firebase preview channel
  - Verifies the hosted preview HTML title, JS bundle path, and bundle markers

- `npm run release:live`
  - Runs the full preview flow first
  - Only deploys live after preview verification succeeds
  - Verifies the live hosted HTML title, JS bundle path, and bundle markers

## Release Rules

- Production deploys are locked to the `KWG` repo root.
- Preview-first is the default release path.
- HTML must stay non-cacheable so the wrong app shell cannot stay pinned after deploy.
- Deploys from a dirty tracked worktree are blocked by default.
- The release is not considered successful unless the hosted site serves the same app shell and bundle path that `KWG/dist/index.html` references.

## Local Backups

Use the checked-in backup scripts from `KWG` only.

- `powershell -ExecutionPolicy Bypass -File scripts/register-kwg-auto-backup.ps1`
  - Registers the Windows scheduled task `KWG Auto Git Snapshot`
  - Runs every 3 hours
- `powershell -ExecutionPolicy Bypass -File scripts/kwg-auto-backup.ps1`
  - Runs one backup immediately
  - Creates a git bundle snapshot in `backups/git-snapshots/`
  - Creates an untracked-file zip in `backups/untracked-snapshots/` when needed
  - Appends a summary log to `backups/logs/kwg-auto-backup.log`

Restore sources:

- `backups/git-snapshots/*.bundle`
  - Contains a restorable git snapshot reference from that run
- `backups/untracked-snapshots/*.zip`
  - Contains untracked files that git would not preserve

## Firebase Data Backups

Use the checked-in Firestore backup manager from `KWG` only.

- `npm run backup:firestore:status`
  - Shows the current Firestore database location, PITR state, and backup schedules
- `npm run backup:firestore:ensure`
  - Ensures a native Firestore backup schedule exists on `first-db`
  - Default policy is `DAILY` retention of `30d`

Notes:

- This protects Cloud Firestore data in Firebase itself; it is separate from the local git snapshot backups.
- Point-in-time recovery is reported by the status command, but is not automatically enabled because it has ongoing cost implications.
