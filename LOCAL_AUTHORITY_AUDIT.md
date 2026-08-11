# Local Authority Audit

Status: OPEN

Last updated: 2026-04-01

Rule:
- Firestore/server must be the only source of truth for collaborative and user-visible state.
- IndexedDB/localStorage may exist only as non-authoritative mirrors or browser-private state.
- No collaborative path may choose project identity, project data, shared settings, shared docs/rows, or displayed counts from local cache before server confirmation.
- All authoritative app-data mutations must route through one approved persistence boundary per domain; UI/components/hooks must not issue raw Firestore writes directly.
- Target end state for authoritative app-data mutations: server-managed writes only (Cloud Functions or equivalent API boundary), with client code prohibited from issuing direct authoritative Firestore writes.
- "Remote" loaders must be truly server-authoritative or explicitly classified as cache-capable provisional reads; the code may not label browser-cache-capable reads as authoritative remote state.

Current scope:
- Shared project bootstrap
- Legacy/non-shared project bootstrap
- Project metadata and folder metadata
- Workspace preferences
- Cross-session workspace selection coupling
- Shared app settings
- Generate/Content project-scoped shared docs and rows
- Other user-visible tabs that currently hydrate from local cache before live Firestore

Search commands used in this audit pass:

```powershell
git grep -n "loadCachedState" -- src
git grep -n "loadFromIDB" -- src
git grep -n "localStorage.getItem" -- src
git grep -n "localStorage.setItem\|saveToLS\|loadFromLS" -- src
git grep -n "localPreferred\|allowProjectScopedLocalCache\|local-preferred\|pickNewerProjectPayload\|local_cache_fallback\|local-cache\|provisional-cache" -- src
git grep -n "loadSavedWorkspacePrefs\|loadProjectDataForView\|loadFeedbackFromIDB\|loadNotificationsFromIDB" -- src
git grep -n "activeProjectId" -- src
git grep -n "fromCache\|getDoc(\|getDocs(\|getDocFromServer\|getDocsFromServer" -- src
```

## Confirmed Violations

| Status | Domain | File | Current local-authority behavior | Why invalid |
|---|---|---|---|---|
| confirmed | Project bootstrap | `src/projectStorage.ts:860` | Falls back to browser `localStorage` project metadata when Firestore returns empty/errors | Different browser profiles can start from different project lists and project metadata |
| confirmed | Active project restore | `src/hooks/useProjectLifecycle.ts:252` | Mount restore uses cached bootstrap projects plus cached prefs before live projects snapshot settles | Active project selection can be driven by stale local state |
| confirmed | Workspace preferences | `src/projectWorkspace.ts:129` | `loadSavedWorkspacePrefs()` reads IDB first, then Firestore | Session bootstrap can depend on local cached collaborative prefs |
| confirmed | Legacy/non-shared project data | `src/projectWorkspace.ts:193` | `loadProjectDataForView()` merges IDB and Firestore and can pick local payload as visible truth | Project data and counts can diverge per browser cache |
| confirmed | Project bootstrap server gap | `src/projectStorage.ts:862` | Projects bootstrap uses Firestore `getDocs()` without forcing server, so the `'firestore'` branch can still come from browser SDK cache | Different tabs can treat cached Firestore data as authoritative even before any live server-confirmed snapshot |
| confirmed | Legacy project remote-read fallback | `src/projectStorage.ts:824` | `loadProjectDataFromFirestore()` falls back from `getDocsFromServer()` to cache-backed `getDocs()` | Legacy project “remote” loads are not strictly server-authoritative |
| confirmed | Shared V2 bootstrap | `src/useProjectPersistence.ts:2303` | Shared project load reads canonical cache/IDB first and threads it into bootstrap | Shared project can start from local cache instead of authoritative server state |
| confirmed | Shared V2 visible cached apply | `src/useProjectPersistence.ts:2327` | Shared project applies `idbData` to live view before canonical server state resolves | Shared project rows/counts can visibly diverge by browser cache during bootstrap |
| confirmed | Shared V2 local fallback handoff | `src/useProjectPersistence.ts:2346` | Shared project passes `localFallbackPayload` into canonical loader | Canonical resolution path still accepts a local payload as fallback input |
| confirmed | Shared V2 fallback state | `src/projectCollabV2.ts:1919` | Shared `loadCanonicalProjectState()` can return resolved fallback payload from local cache | Shared project can display cached data as live truth |
| confirmed | Shared V2 base commit loader server gap | `src/projectCollabV2.ts:1162` | Canonical base-commit load uses `getDoc()` / `getDocs()` without forcing server or validating cache origin | Shared canonical bootstrap can accept browser Firestore cache as authoritative input |
| confirmed | Shared V2 meta loader server gap | `src/projectCollabV2.ts:1245` | `loadCollabMeta()` uses `getDoc()` with no server-forced read or cache-origin guard | Shared mode classification can come from browser Firestore cache |
| confirmed | Shared V2 entity loader server gap | `src/projectCollabV2.ts:1268` | Entity/bootstrap loaders use `getDoc()` / `getDocs()` for operation lock and entity collections without forcing server | Shared entity state can be built from browser Firestore cache instead of server-confirmed reads |
| confirmed | Shared docs API | `src/appSettingsPersistence.ts:271` | Project-scoped shared docs allow `localPreferred` reads when opted in | Shared settings/docs still have a local truth path |
| confirmed | Shared rows API | `src/appSettingsPersistence.ts:432` | Project-scoped shared rows allow `local-preferred` reads when opted in | Shared rows can bypass remote authority |
| confirmed | Shared rows helper | `src/appSettingsDocStore.ts:193` | `loadChunkedAppSettingsRowsLocalPreferred()` compares IDB vs remote timestamp and can return cached rows | Explicit local-authority helper exists in production code |
| confirmed | Shared app-settings remote-read gap | `src/appSettingsDocStore.ts:107` | `getAppSettingsDocData()` uses Firestore `getDoc()` for nominally remote shared doc loads | Shared docs/rows “remote” loads can still resolve from browser Firestore cache |
| confirmed | Content pipeline loader | `src/contentPipelineLoaders.ts:1` | Public loader exposes `local-preferred` mode for project-scoped shared content data | Unsafe mode is intentionally available to callers |
| confirmed | Content overview | `src/ContentOverviewPanel.tsx:236` | Reloads overview inputs with `local-preferred` on local update events | Shared pipeline rows can refresh from local cache instead of server |
| confirmed | Final pages | `src/FinalPagesPanel.tsx:92` | Reloads inputs with `local-preferred` on local update events | Shared pipeline rows can refresh from local cache instead of server |
| confirmed | Generate rows | `src/GenerateTab.tsx:1665` | Rows hydrate from cached IDB/localStorage before Firestore | User-visible shared rows can differ by browser cache |
| confirmed | Generate rows missing-doc path | `src/GenerateTab.tsx:1811` | On non-cache missing server doc, cached rows may be reapplied | Cached shared rows can become visible truth after remote result |
| confirmed | Generate logs | `src/GenerateTab.tsx:2052` | Logs hydrate from local cache before Firestore | User-visible shared log stream can differ per browser |
| confirmed | Generate settings | `src/GenerateTab.tsx:2928` | Shared/project-scoped generate settings hydrate from cache before Firestore | Shared settings still have local-authority bootstrap |
| confirmed | Group review settings sync bootstrap | `src/GroupReviewSettings.tsx:257` | Shared settings synchronously hydrate from `localStorage` before any Firestore confirmation | Shared settings can immediately diverge per browser before remote state arrives |
| confirmed | Group review settings | `src/GroupReviewSettings.tsx:371` | Shared settings hydrate from IDB/localStorage before Firestore | Shared settings can differ per browser at bootstrap |
| confirmed | Auto-group settings | `src/AutoGroupPanel.tsx:443` | Shared settings hydrate from cache before Firestore | Shared settings still have local-authority bootstrap |
| confirmed | Universal blocked tokens | `src/hooks/useUniversalBlockedTokens.ts:36` | Shared blocked-token set hydrates from cache before Firestore | Shared blocking rules can differ by browser |
| confirmed | Starred models | `src/hooks/useStarredModels.ts:19` | Shared starred-model set hydrates from cache before Firestore | Shared user-visible state still has local-authority bootstrap |
| confirmed | Project folders | `src/ProjectsTab.tsx:74` | Folder list initializes synchronously from browser `localStorage` before shared Firestore listener | User-visible shared metadata can differ by browser |
| confirmed | Topics library | `src/TopicsSubTab.tsx:71` | Topics load from IDB before Firestore | Shared user-visible library can diverge by browser cache |
| confirmed | Feedback tab | `src/FeedbackTab.tsx:73` | Feedback UI shows cached IDB items before live Firestore snapshot | User-visible shared list can differ per browser during bootstrap |
| confirmed | Notifications tab | `src/NotificationsTab.tsx:84` | Notifications UI shows cached IDB items before live Firestore snapshot | User-visible shared list can differ per browser during bootstrap |
| confirmed | Shared registry workspace prefs | `src/sharedCollaboration.ts:133` | `workspace.preferences` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for shared workspace prefs |
| confirmed | Shared registry group review | `src/sharedCollaboration.ts:149` | `settings.group_review` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for shared group-review settings |
| confirmed | Shared registry auto-group | `src/sharedCollaboration.ts:165` | `settings.autogroup` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for shared auto-group settings |
| confirmed | Shared registry topics | `src/sharedCollaboration.ts:181` | `settings.topics_loans` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for shared topics data |
| confirmed | Shared registry starred models | `src/sharedCollaboration.ts:197` | `settings.starred_models` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for shared starred models |
| confirmed | Shared registry blocked tokens | `src/sharedCollaboration.ts:213` | `settings.universal_blocked` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for shared blocked-token rules |
| confirmed | Shared registry generate rows | `src/sharedCollaboration.ts:228` | `generate.rows` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for project-scoped shared rows |
| confirmed | Shared registry generate logs | `src/sharedCollaboration.ts:243` | `generate.logs` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for project-scoped shared logs |
| confirmed | Shared registry generate settings | `src/sharedCollaboration.ts:258` | `generate.settings` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for project-scoped shared settings |
| confirmed | Shared registry generate pipeline settings | `src/sharedCollaboration.ts:273` | `generate.pipeline_settings` declares `recovery: 'local_cache_fallback'` | Collaboration contract still blesses cache fallback for project-scoped shared pipeline settings |

## Exposure Points

These are production helpers/contracts that enable the violations above even when not every callsite has been removed yet.

| Status | File | Exposure |
|---|---|---|
| confirmed | `src/appSettingsPersistence.ts:69` | `loadCachedState()` is the general cache bootstrap helper used by multiple shared/user-visible flows |
| confirmed | `src/projectStorage.ts:180` | `loadProjectsFromLocalCache()` is the helper that turns the browser project mirror into bootstrap truth |
| confirmed | `src/projectStorage.ts:457` | `saveProjectFoldersToFirestore()` writes the local folder mirror later used as bootstrap state |
| confirmed | `src/projectStorage.ts:514` | `saveProjectToFirestore()` maintains the local project mirror that later feeds the invalid bootstrap fallback |
| confirmed | `src/projectStorage.ts:542` | `saveAppPrefsToFirestore()` persists `activeProjectId` alongside shared workspace prefs, coupling session selection to shared state |
| confirmed | `src/projectStorage.ts:588` | `loadAppPrefsFromIDB()` provides the local workspace-prefs mirror that mount bootstrap trusts first |
| confirmed | `src/projectStorage.ts:872` | Firestore project bootstrap refresh also rewrites the local project mirror that powers the invalid fallback path |
| confirmed | `src/projectStorage.ts:134` | `pickNewerProjectPayload()` allows local payloads to beat server payloads in visible project loads |
| confirmed | `src/appSettingsDocStore.ts:92` | `getAppSettingsDocData()` is the base shared-doc reader used by nominally remote app-settings loads, but it uses cache-capable `getDoc()` |
| confirmed | `src/projectCollabV2.ts:1223` | Canonical V2 cache loader exists and is used during shared bootstrap |
| confirmed | `src/projectWorkspace.ts:158` | `loadProjectDataFromIDBOnly()` gives project bootstrap a local-first path |
| confirmed | `src/hooks/useWorkspacePrefsSync.ts:49` | Shared `user_preferences` listener mirrors remote prefs back into the IDB record that mount bootstrap trusts first |
| confirmed | `src/sharedCollabContract.ts:33` | `performSharedMutation()` records outcomes but does not enforce a single persistence boundary; raw shared Firestore writes still exist in multiple modules |
| confirmed | `src/projectCollabV2Storage.ts:92` | Authoritative V2 storage module reads `collab/meta` via cache-capable `getDoc()` |
| confirmed | `src/projectCollabV2Storage.ts:282` | Authoritative V2 storage module reads base commit manifests via cache-capable `getDoc()` |
| confirmed | `src/projectCollabV2Storage.ts:294` | Authoritative V2 storage module reads base commit chunks via cache-capable `getDocs()` |
| confirmed | `src/projectCollabV2Storage.ts:466` | Authoritative V2 storage module loads epoch entities via cache-capable `getDocs()` |

## Follow-Up / Lower-Severity Review

These are not yet classified as core source-of-truth violations, but they still read local state for data that can influence visible behavior.

| Status | Domain | File | Notes |
|---|---|---|---|
| review | Auto-group cosine cache | `src/AutoGroupPanel.tsx:782` | Auxiliary cache; currently marked `userVisibleSharedState: false` in registry, but still affects visible summaries/workflow |
| review | Firebase cache guard | `src/firebaseProjectCacheGuard.ts:4` | Not a source-of-truth path, but it globally clears caches based on local sentinel state; keep audited |
| review | Feedback priority preflight server gap | `src/feedbackStorage.ts:184` | Uses cache-capable `getDocs()` to assign next feedback priority; not the main incident path, but still not strictly server-authoritative |
| review | Changelog live feed cache-only gap | `src/changelogStorage.ts:129` | Updates tab uses `onSnapshot` with no cache-origin gating, so initial user-visible changelog state may come from Firestore SDK cache | Auxiliary/user-visible, not core project truth, but still worth tracking under the broader server-authority census |
| review | Build info cache-only gap | `src/changelogStorage.ts:158` | Build-info listener uses `onSnapshot` with no cache-origin gating, so displayed build name may come from Firestore SDK cache | Auxiliary/user-visible, not core project truth, but still worth tracking under the broader server-authority census |
| review | Cloud status wording | `src/cloudSyncStatus.ts:924`, `src/cloudSyncStatus.ts:1109`, `src/cloudSyncStatus.ts:1123`, `src/cloudSyncStatus.ts:1209` | Downstream status model still has explicit `provisional-cache` / cached-view semantics; not a bootstrap reader, but it normalizes the unsafe state in user-facing diagnostics |
| review | Shared recovery type | `src/sharedCollaboration.ts:27` | `SharedRecoveryPolicy` still includes `local_cache_fallback`, so the type system itself allows the forbidden policy |

## Cross-Session / Wrong-Scope State

These are not browser-local fallback reads, but they are still relevant because they let session-private navigation leak into shared persistence.

| Status | Domain | File | Current behavior | Why it matters |
|---|---|---|---|---|
| review | Shared workspace prefs payload | `src/projectStorage.ts:542` | Firestore `user_preferences` doc persists `activeProjectId` together with shared `savedClusters` | `activeProjectId` should be browser-private; keeping it in shared prefs couples one session's selection to another session's state |
| review | Workspace prefs listener mirror | `src/hooks/useWorkspacePrefsSync.ts:45` | Listener records remote `activeProjectId` into `lastPersistedPrefsRef` and mirrors it to IDB | Makes the shared/private coupling durable and feeds the local-first bootstrap path |
| review | Workspace prefs writer | `src/hooks/useWorkspacePrefsSync.ts:74` | Local session writes `activeProjectId` back through `persistAppSettingsDoc({ docId: 'user_preferences' ... })` | Reinforces cross-session hijack risk even if local-cache authority is removed |

## Non-Production / Excluded

These were checked and intentionally left out of the confirmed local-authority count.

| Status | File | Classification |
|---|---|---|
| excluded | `src/collabV2Cache.ts` | Cache helper module is currently only referenced by tests (`src/collabV2ContractParity.test.ts`), not by production imports |
| excluded | `src/App.tsx:289` | Orchestrates already-audited hooks/components (`useWorkspacePrefsSync`, `AppStatusBar`, project lifecycle); no direct local-authority read in this file |
| excluded | `src/AppStatusBar.tsx:344` | Consumes derived sync status and `activeProjectId` only; no cache/bootstrap read path |
| excluded | `src/CloudStatusTooltipBody.tsx:171` | Displays `activeProjectId` and sync diagnostics only; no cache/bootstrap read path |
| excluded | `src/ContentTab.tsx:1212` | Uses `activeProjectId` only to scope project content workspace/doc ids; no local-authority read in this file |
| excluded | `src/GroupDataView.tsx:255` | UI gating based on `activeProjectId` / edit-block flags only; no cache/bootstrap read path |
| excluded | `src/GroupWorkspaceShell.tsx:56` | UI rendering and input enablement based on `activeProjectId`; no local-authority read path |
| excluded | `src/ProjectsTabProjectCard.tsx:30` | Pure active-project highlighting; no cache/bootstrap read path |
| excluded | `src/firebase.ts` | Firebase app/bootstrap wiring only; no Firestore read path that chooses user-visible state |
| excluded | `src/projectMetadataCollab.ts:24` | Shared projects listener wrapper forwards snapshot metadata (`fromCache` / `hasPendingWrites`) but does not itself choose local data as truth |
| excluded | `src/csvImportProjectScope.ts:3` | Safety helper documenting and checking pinned project id during async import; prevents wrong-project writes rather than causing local-authority reads |
| excluded | `src/hooks/useAutoMerge.ts:459` | Uses `activeProjectId` only for cloud-failure toast context; no cache/bootstrap read path |
| excluded | `src/hooks/useCsvExport.ts:75` | Uses `activeProjectId` only to derive export file naming; no cache/bootstrap read path |
| excluded | `src/hooks/useCsvImport.ts:77` | Uses `activeProjectIdRef` to pin import scope and prevent cross-project writes; no local-authority read path |
| excluded | `src/hooks/useKeywordRating.ts:334` | Uses `activeProjectId` only for cloud-failure toast context; no cache/bootstrap read path |
| excluded | `src/hooks/useNavigationState.ts:123` | Uses `activeProjectIdRef` only for URL routing/path construction; no cache/bootstrap read path |
| excluded | `src/sharedCollabContract.ts` | Collaboration wrapper/metrics layer only; no direct Firestore reads or local-authority decisions |
| excluded | `scripts/collab/firestoreCallsites.mjs` | Census/reporting script only; string references to local-preferred helpers are used for static Firestore-callsite auditing, not runtime app authority |
| excluded | `scripts/migrate-shared-projects-v2.ts` | Maintenance script, not runtime app code; uses Firestore reads for migration tooling and is tracked separately from production UX authority |
| excluded | `scripts/patch-content-tab.mjs` | One-off source patch script, not runtime app code |

## Allowed Local-Only State

These are currently acceptable to remain browser-local because they are not collaborative truth.

| Status | Domain | File | Why allowed |
|---|---|---|---|
| allowed | API keys | `src/GenerateTab.tsx:715`, `src/GenerateTab.tsx:717` | Secret/browser-private by design; never shared truth |
| allowed | Generate local view prefs | `src/GenerateTab.tsx:1636`, `src/GenerateTab.tsx:1652`, `src/GenerateTab.tsx:2466`, `src/GenerateTab.tsx:5562` | Local UI state only |
| allowed | Table column widths | `src/TableHeader.tsx:155` | Browser-only presentation state |
| allowed | Runtime trace flags | `src/runtimeTrace.ts:26` | Dev/diagnostic local toggles |
| allowed | Collaboration diagnostics log | `src/collabDiagnosticsLog.ts:45` | Local diagnostics only |
| allowed | Feedback local meta mirror | `src/feedbackStorage.ts:95` | Small count/timestamp mirror only; not used as truth for feedback items |
| allowed | Notifications local meta mirror | `src/notificationStorage.ts:115` | Small count/timestamp mirror only; not used as truth for notification items |
| allowed | QA harness/runtime | `src/qa/ContentPipelineQaHarness.tsx:62`, `src/qa/contentPipelineQaRuntime.ts:176` | QA-only local simulation state |

## Tests That Encode Unsafe Behavior

| Status | File | Why it must change |
|---|---|---|
| rewrite | `src/projectStorage.bootstrap.test.ts:41` | Treats cached project bootstrap as valid production behavior |
| rewrite | `src/projectCollabV2.storage.test.ts:518` | Treats shared fallback payloads as valid resolved state |
| rewrite | `src/appSettingsCollab.integration.test.ts:195` | Allows project-scoped shared docs/rows to use local-preferred with opt-in |
| rewrite | `src/contentPipelineLoaders.test.ts:48` | Treats local-preferred content pipeline loads as valid behavior |
| rewrite | `src/hooks/useProjectLifecycle.actions.test.ts:152` | Treats cached project visibility after local-cache bootstrap as expected behavior |
| rewrite | `src/appSettingsPersistence.test.ts:200` | Treats explicit local-preferred shared doc load as valid behavior |

## Fix Queue

1. Remove project metadata and active-project bootstrap authority from local cache.
2. Remove `pickNewerProjectPayload()` from visible project bootstrap paths.
3. Remove shared V2 resolved fallback payload behavior.
4. Delete `localPreferred` / `allowProjectScopedLocalCache` from project-scoped shared docs/rows.
5. Remove cached bootstrap from Generate/Content shared/project-scoped surfaces.
6. Remove cached bootstrap from global shared settings and metadata tabs.
7. Update `sharedCollaboration.ts` so shared/user-visible channels do not declare `local_cache_fallback`.
8. Rewrite the tests above so unsafe behavior fails.
9. Cut authoritative app-data mutations over to a server-managed persistence boundary (Cloud Functions or equivalent API layer), with client code no longer allowed to issue direct authoritative Firestore writes.
10. Route any remaining allowed client-side persistence through one allowlisted boundary per domain while the server-managed cutover is in progress.
11. Add static/CI checks that fail if collaborative/user-visible modules call local-authority helpers or raw Firestore mutation primitives outside allowlisted infrastructure modules.

## Current Code Answers

These are code-backed answers to the current incident questions. They are not claims about the exact live tab without runtime evidence; they are the best current repo-level answers.

| Question | Current answer | Evidence |
|---|---|---|
| Are all clients definitely listening to the same paths/epoch? | Core shared V2 entity listeners and V2 entity writes appear path-aligned and epoch-aligned. This is not the leading suspected failure mode. | Listeners query `where('datasetEpoch', '==', datasetEpoch)` in [src/useProjectPersistence.ts:2864](src/useProjectPersistence.ts:2864), [src/useProjectPersistence.ts:2892](src/useProjectPersistence.ts:2892), [src/useProjectPersistence.ts:2920](src/useProjectPersistence.ts:2920), [src/useProjectPersistence.ts:2948](src/useProjectPersistence.ts:2948), [src/useProjectPersistence.ts:2976](src/useProjectPersistence.ts:2976), [src/useProjectPersistence.ts:3004](src/useProjectPersistence.ts:3004). Writes target the matching subcollections using the same epoch in [src/useProjectPersistence.ts:2105](src/useProjectPersistence.ts:2105), [src/useProjectPersistence.ts:2134](src/useProjectPersistence.ts:2134), [src/useProjectPersistence.ts:2163](src/useProjectPersistence.ts:2163), [src/useProjectPersistence.ts:2192](src/useProjectPersistence.ts:2192), [src/useProjectPersistence.ts:2220](src/useProjectPersistence.ts:2220), [src/useProjectPersistence.ts:2237](src/useProjectPersistence.ts:2237). |
| Do updates show up after refresh but not live, or not at all? | Unknown from static code alone. The repo proves both stale-bootstrap and stale-cache-backed-read outcomes are possible, but not which one the live incident hit. | Shared bootstrap applies cached view state before authoritative convergence in [src/useProjectPersistence.ts:2303](src/useProjectPersistence.ts:2303), [src/useProjectPersistence.ts:2327](src/useProjectPersistence.ts:2327). Shared canonical/meta/entity loaders also use cache-capable Firestore reads in [src/projectCollabV2.ts:1664](src/projectCollabV2.ts:1664), [src/projectCollabV2.ts:1665](src/projectCollabV2.ts:1665), [src/projectCollabV2.ts:1666](src/projectCollabV2.ts:1666). |
| Is `loadCanonicalEpoch()` ever overwriting state after listeners fire? | Less likely than the authority/cache problem. There are explicit generation/project/abort guards around canonical reload application. | `loadCanonicalEpoch()` itself is a loader at [src/projectCollabV2.ts:1657](src/projectCollabV2.ts:1657). The guarded apply path is in [src/useProjectPersistence.ts:3233](src/useProjectPersistence.ts:3233) through [src/useProjectPersistence.ts:3305](src/useProjectPersistence.ts:3305), plus reload guards in [src/useProjectPersistence.ts:1542](src/useProjectPersistence.ts:1542) through [src/useProjectPersistence.ts:1562](src/useProjectPersistence.ts:1562). |
| Are writes going to the exact collections your listeners are subscribed to? | For core shared V2 entities and meta/operation listeners, yes, they appear aligned. | Listener paths are in [src/useProjectPersistence.ts:2864](src/useProjectPersistence.ts:2864) through [src/useProjectPersistence.ts:3053](src/useProjectPersistence.ts:3053). Shared V2 write paths target the same domain via `commitRevisionedDocChanges` / `appendActivityLogEntry` in [src/useProjectPersistence.ts:2105](src/useProjectPersistence.ts:2105) through [src/useProjectPersistence.ts:2247](src/useProjectPersistence.ts:2247). |

Current conclusion:
- The repo evidence points more strongly to split bootstrap authority and cache-capable reads than to a core V2 listener/write path mismatch.
- The path/epoch parity still needs explicit regression coverage, but it is not currently the top-ranked hypothesis.

## Additional Fix Ideas

These are additional architecture and execution ideas to include before implementation begins.

- Split the fix into two coupled tracks:
  - `Authority cutover`: remove local/cache authority and cache-capable pseudo-remote reads.
  - `Mutation cutover`: move authoritative app-data writes behind the server-managed boundary.
- Treat "server-managed writes" as mandatory, not aspirational.
  - Client code should request mutations.
  - Server code should validate, assign timestamps/revisions/epochs, and write canonical shared state.
- Keep one shared path manifest.
  - All shared collections/doc ids/subcollection names/epoch filters should come from one authoritative path/contract module.
  - Do not let read paths, listener paths, and write paths define their own strings independently.
- Make idempotency explicit.
  - Every authoritative app-data mutation request should carry a durable `mutationId`.
  - Server-managed handlers should be able to safely retry/replay without double-applying.
- Move session-private navigation fully out of shared persistence.
  - `activeProjectId` must become URL/local-session only.
  - Shared `user_preferences` should keep only truly shared values such as `savedClusters` if that sharing is still desired.
- Fail closed on unresolved shared bootstrap.
  - If shared canonical/meta/epoch state is not authoritative, the client shows `Connecting`, `Converging`, or `Read-only`.
  - It does not render cached collaborative state as current truth.
- Remove "provisional cache" as a normal runtime state for collaborative data.
  - Cache may exist for diagnostics/recovery, but should not become the visible truth path.
- Keep local mirrors as durability aids only.
  - IDB/localStorage writes can still happen after remote acceptance for crash recovery and fast warm-start diagnostics.
  - They must not participate in truth selection.
- Add a kill switch for the cutover.
  - If the server-managed path is degraded, shared editing should flip to read-only rather than silently falling back to direct client writes or local truth.
- Add stronger runtime diagnostics.
  - `projectSelectionAuthority`
  - `sharedBootstrapAuthority`
  - `canonicalReadAuthority`
  - `mutationBoundary`
  - `listenerEpoch`
  - `writeEpoch`
  - `listenerPath`
  - `writePath`
  - `serverAckRevision`
- Make the wrong thing structurally hard.
  - Remove generic `localPreferred` options from shared loaders.
  - Ban direct Firestore mutation imports outside allowlisted infrastructure/server-boundary modules.
  - Ban cache-capable reads in shared/bootstrap code unless the function name and return type mark them as provisional/non-authoritative.

## Server-Managed Boundary Design

Target authoritative app-data domains for server-managed cutover:

1. Project metadata and folders
2. Shared app settings docs
3. Shared app settings rows/logs/settings/pipeline settings
4. Shared V2 entity mutations
5. Shared V2 epoch activation / operation lock transitions

Minimum boundary contract:

- Client sends validated command/request objects, not raw Firestore writes.
- Server validates:
  - project scope
  - epoch/base commit expectations
  - mutation type and payload shape
  - lock ownership / concurrency rules
  - revision expectations for CAS mutations
- Server writes canonical state and returns:
  - `accepted` / `rejected`
  - canonical revision/epoch info
  - mutation id / ack info

Boundary requirements:

- No UI/component/hook code imports raw Firestore mutation primitives for shared domains.
- Shared client code may only call boundary helpers.
- `performSharedMutation()` can remain as telemetry/wrapper, but it is not sufficient as the boundary by itself.
- The allowlist of direct Firestore write modules should shrink to:
  - server boundary implementation
  - truly auxiliary non-collaborative support modules if intentionally excluded

## Listener And Path Parity Requirements

Even though path mismatch is not the leading current hypothesis, the implementation must still prove parity.

Required guarantees:

- Every authoritative write domain has one canonical path definition.
- Every shared listener subscribes to that same canonical path definition.
- Every epoch-scoped authoritative listener and every epoch-scoped authoritative write use the same epoch source.
- Path strings may not be duplicated across multiple modules without a shared definition.

Required tests:

- For each shared entity domain, assert that the listener query path and mutation target path are the same collection/subcollection family.
- For each epoch-scoped write, assert that the emitted doc keys/queries use the same `datasetEpoch` that listeners subscribe to.
- Two-client integration test:
  - client A writes
  - client B receives live update without refresh
  - both clients agree after refresh

## Bootstrap And Read Rules

Shared/project-scoped reads must follow these rules:

- Shared bootstrap does not apply IDB/localStorage state to the visible view.
- Shared bootstrap does not classify the project as shared from local metadata.
- Shared reads used for truth must be server-forced or server-confirmed.
- Cache-capable reads must be explicitly marked provisional/non-authoritative in API shape and naming.
- The first cache-only empty snapshot must never blank a good local/server-backed state.
- Missing shared docs/meta during bootstrap must not trigger local fallback truth.

Legacy/non-shared reads during cutover:

- Prefer server-authoritative reads for visible truth.
- If offline survivability is kept, it must be labeled as local/offline and not masquerade as converged cloud state.

## Observability And Triage

Before and during implementation, add or preserve enough diagnostics to answer live incidents quickly:

- Which source chose the active project?
- Which source populated the initial visible dataset?
- Was the canonical read server-forced, cache-only, or unknown?
- Which epoch did listeners attach to?
- Which epoch did the last accepted write target?
- Did the client ever receive a non-cache snapshot for:
  - project collection
  - `collab/meta`
  - `project_operations/current`
  - each epoch-scoped entity subcollection
- Did the app show `Cloud: synced` before all authoritative targets were confirmed?

Recommended incident-dump fields:

- browser profile type (`normal`, `incognito`)
- user id/client id
- project id
- active epoch
- active base commit id
- bootstrap authority
- canonical read authority
- last listener authoritative timestamps per domain
- last server ack per mutation domain

## Rollout And Safety

- Do not ship the server-managed write cutover as a partial mixed runtime for the same domain longer than necessary.
- Prefer domain-by-domain cutover with hard gating:
  - server boundary ready
  - client write callsites removed or blocked
  - tests green
  - diagnostics present
- If the boundary is unavailable, fail to read-only for shared edits.
- Do not fall back from server-managed authoritative writes to direct client writes.
- Do not fall back from server-authoritative app-data reads to local truth.

Suggested rollout order:

1. Project metadata / active-project coupling cleanup
2. Shared app-settings read authority cleanup
3. Generate/Content shared/project-scoped authority cleanup
4. Shared V2 canonical/meta/entity read authority cleanup
5. Server-managed mutation cutover by domain
6. Remove residual client-side authoritative write paths

## Acceptance Criteria

The fix is not done until all of these are true:

- Normal Chrome, incognito, and a second user converge on the same visible counts for the same project.
- Shared/project-scoped data cannot render from local cache as authoritative truth.
- Shared bootstrap cannot open from local metadata/cache authority.
- Shared reads that power visible truth are server-authoritative.
- Authoritative app-data writes flow only through the approved server-managed boundary.
- `activeProjectId` is not shared across sessions/users.
- `Cloud: synced` cannot appear before authoritative readiness is complete.
- CI/gates fail on:
  - `localPreferred`
  - `allowProjectScopedLocalCache`
  - `local_cache_fallback`
  - direct shared Firestore mutation primitives outside allowlisted boundary modules
  - cache-capable truth reads in shared/bootstrap code

## Runtime Evidence Still Needed

Static audit is strong enough to rank the likely bug classes, but it does not prove which branch the live incident hit.

Still useful to capture from affected tabs/users:

- `window.__kwgCollabDiagnostics?.read(200)`
- cached project metadata / cache identity
- shared bootstrap source
- canonical read authority
- active epoch / base commit id

This evidence is optional for beginning the cutover, but still valuable for confirming the exact live failure path and for validating that the final fix actually eliminates it.

## Verification Log

- 2026-04-01: initial repo-wide census completed from the grep commands listed above.
- Result: inventory still open; production code still contains confirmed collaborative/user-visible local-authority paths.
- 2026-04-01: follow-up sweep of `window.localStorage`, `loadFromLS`, and `saveToLS` found no additional production source-of-truth violations beyond the items already listed here.
- 2026-04-01: pattern sweep for `firestoreLoadedRef`, `applyCached*`, `LS_*`, and `local-preferred` confirmed the existing cache-first families and added the explicit synchronous Group Review localStorage bootstrap plus project-list helper/mirror exposure entries.
- 2026-04-01: production-only sweep of `localStorage.setItem`, `saveToLS`, and `activeProjectId` broke out the per-channel `local_cache_fallback` registry entries, added the explicit shared-V2 cached-view apply/handoff lines in `useProjectPersistence.ts`, and separated the `user_preferences.activeProjectId` cross-session coupling path from the core local-authority list.
- 2026-04-01: downstream-only audit of the remaining `activeProjectId` matches classified App/status/routing/import/export/UI consumers as excluded so they do not remain implicit false positives in the census.
- 2026-04-01: expanded the census to Firestore SDK cache authority (`fromCache`, `getDoc`, `getDocs`). This added a second bug class: several loaders labeled or treated as remote are still cache-capable and therefore not truly server-authoritative, including app-settings shared doc reads, project bootstrap, and shared V2 canonical/meta/entity loads.
- 2026-04-01: compared the audit against the broader production Firestore-import list and classified the remaining infrastructure/support files plus the Updates/build-info listeners, so auxiliary Firestore-only modules are no longer implicit omissions.
- 2026-04-01: explicitly added the persistence-boundary requirement: authoritative app-data mutation routing is not considered solved unless raw authoritative writes are collapsed behind one allowlisted boundary and CI blocks direct Firestore mutation usage elsewhere.
- 2026-04-01: upgraded the target architecture for authoritative writes from "single client boundary" to "server-managed boundary required" per user direction. Direct client authoritative writes are now considered an end-state violation, not just a code-smell.
- 2026-04-01: final pre-implementation census pass rechecked production cache-authority, Firestore cache-authority, and raw mutation patterns; the only remaining unclassified match was `scripts/collab/firestoreCallsites.mjs`, which is now explicitly excluded as a static audit script rather than runtime authority code.
- Exit criterion for this file:
  - all production grep hits classified
  - no confirmed collaborative/user-visible local-authority paths remain
  - authoritative app-data writes flow only through the approved server-managed persistence boundary
  - tests and gates updated to block regression
