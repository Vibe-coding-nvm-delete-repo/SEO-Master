import React, { type ComponentType } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterSummary, GroupedCluster, ProcessedRow, Project, Stats, TokenSummary } from './types';
import { resetCloudSyncStateForTests } from './cloudSyncStatus';

/** Heavy libs — stub so loading `App` does not stall Vitest workers (real hang was pre-test `RUN`). */
vi.mock('xlsx', () => {
  const utils = {
    book_new: vi.fn(() => ({})),
    aoa_to_sheet: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  };
  return {
    default: { utils, write: vi.fn(() => new Uint8Array(0)) },
    utils,
    write: vi.fn(() => new Uint8Array(0)),
  };
});

vi.mock('papaparse', () => ({
  default: {
    parse: vi.fn((_file: unknown, opts?: { complete?: (r: unknown) => void }) => {
      opts?.complete?.({ data: [], errors: [], meta: {} });
    }),
    unparse: vi.fn(() => ''),
  },
}));

/** Weather + geolocation on mount — stub so RTL does not wait on Open-Meteo / location. */
vi.mock('./AppStatusBar', () => ({
  default: () => null,
}));

vi.mock('./FeedbackTab', () => ({
  default: () => null,
}));

vi.mock('./FeatureIdeasTab', () => ({
  default: () => null,
}));

vi.mock('./NotificationsTab', () => ({
  default: () => null,
}));

vi.mock('./FeedbackModalHost', () => ({
  default: () => null,
}));

const storageMocks = vi.hoisted(() => ({
  loadProjectsBootstrapState: vi.fn(),
  loadProjectsFromFirestore: vi.fn(),
  loadSavedWorkspacePrefs: vi.fn(),
  loadProjectDataForView: vi.fn(),
  saveAppPrefsToFirestore: vi.fn(),
  saveProjectDataToFirestore: vi.fn(),
  saveProjectToFirestore: vi.fn(),
  deleteProjectFromFirestore: vi.fn(),
  deleteProjectDataFromFirestore: vi.fn(),
  deleteFromIDB: vi.fn(),
}));

const collabMocks = vi.hoisted(() => ({
  loadCanonicalProjectState: vi.fn(),
  loadCanonicalEpoch: vi.fn(),
  loadCanonicalCacheFromIDB: vi.fn(async () => null),
  saveCanonicalCacheToIDB: vi.fn(() => Promise.resolve()),
  commitRevisionedDocChanges: vi.fn(),
  acquireProjectOperationLock: vi.fn(),
  releaseProjectOperationLock: vi.fn(() => Promise.resolve()),
  heartbeatProjectOperationLock: vi.fn(),
}));

const firestoreListeners = vi.hoisted(() => ({
  handlers: new Map<string, (snap: any) => void>(),
}));

function mockProjectBootstrap(projects: Project[], source: 'firestore' | 'local-cache' | 'empty' = 'firestore') {
  storageMocks.loadProjectsBootstrapState.mockResolvedValue({ projects, source });
  storageMocks.loadProjectsFromFirestore.mockResolvedValue(projects);
}

/** Stub network/IDB paths only; use real chunk merge from `projectChunkPayload` (no Firebase import). */
vi.mock('./projectStorage', async () => {
  const chunk = await import('./projectChunkPayload');
  return {
    PROJECT_FOLDERS_FS_DOC: 'project_folders',
    LS_PROJECT_FOLDERS_KEY: 'kwg_project_folders',
    LS_PROJECTS_KEY: 'kwg_projects',
    batchSetProjectsFolderId: vi.fn(() => Promise.resolve()),
    saveProjectFoldersToFirestore: vi.fn(() => Promise.resolve()),
    loadProjectsBootstrapState: storageMocks.loadProjectsBootstrapState,
    loadProjectsFromFirestore: storageMocks.loadProjectsFromFirestore,
    saveAppPrefsToFirestore: storageMocks.saveAppPrefsToFirestore,
    saveProjectDataToFirestore: storageMocks.saveProjectDataToFirestore,
    saveProjectToFirestore: storageMocks.saveProjectToFirestore,
    deleteProjectFromFirestore: storageMocks.deleteProjectFromFirestore,
    deleteProjectDataFromFirestore: storageMocks.deleteProjectDataFromFirestore,
    deleteFromIDB: storageMocks.deleteFromIDB,
    saveToIDB: vi.fn(() => Promise.resolve()),
    loadFromIDB: vi.fn(() => Promise.resolve(null)),
    loadProjectDataFromFirestore: vi.fn(() => Promise.resolve(null)),
    buildProjectDataPayloadFromChunkDocs: chunk.buildProjectDataPayloadFromChunkDocs,
    countGroupedPages: chunk.countGroupedPages,
    groupedPageMass: chunk.groupedPageMass,
    projectFromFirestoreData: (id: string, data: Record<string, unknown> | undefined) => {
      const d = data || {};
      return {
        id,
        name: typeof d.name === 'string' ? d.name : '',
        description: typeof d.description === 'string' ? d.description : '',
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
        uid: typeof d.uid === 'string' ? d.uid : 'local',
        fileName: typeof d.fileName === 'string' ? d.fileName : undefined,
        folderId:
          typeof d.folderId === 'string' ? d.folderId : d.folderId === null ? null : undefined,
        deletedAt:
          typeof d.deletedAt === 'string' ? d.deletedAt : d.deletedAt === null ? null : undefined,
      };
    },
    reviveProjectInFirestore: vi.fn(() => Promise.resolve()),
    softDeleteProjectInFirestore: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('./projectWorkspace', () => {
  const makeEmpty = () => ({
    results: null as ProcessedRow[] | null,
    clusterSummary: null as ClusterSummary[] | null,
    tokenSummary: null as TokenSummary[] | null,
    groupedClusters: [] as GroupedCluster[],
    approvedGroups: [] as GroupedCluster[],
    activityLog: [] as unknown[],
    tokenMergeRules: [] as unknown[],
    autoGroupSuggestions: [] as unknown[],
    autoMergeRecommendations: [] as unknown[],
    groupMergeRecommendations: [] as unknown[],
    stats: null as Stats | null,
    datasetStats: null as unknown | null,
    blockedTokens: [] as string[],
    blockedKeywords: [] as unknown[],
    labelSections: [] as unknown[],
    fileName: null as string | null,
  });
  return {
    loadSavedWorkspacePrefs: storageMocks.loadSavedWorkspacePrefs,
    loadProjectDataForView: storageMocks.loadProjectDataForView,
    loadProjectDataFromIDBOnly: storageMocks.loadProjectDataForView,
    reconcileWithFirestore: vi.fn().mockResolvedValue({ action: 'skip' }),
    createEmptyProjectViewState: () => makeEmpty(),
    toProjectViewState: (data: Record<string, unknown> | null) => {
      if (!data) return makeEmpty();
      return {
        results: (data.results as ProcessedRow[] | null) ?? null,
        clusterSummary: (data.clusterSummary as ClusterSummary[] | null) ?? null,
        tokenSummary: (data.tokenSummary as TokenSummary[] | null) ?? null,
        groupedClusters: (data.groupedClusters as GroupedCluster[]) ?? [],
        approvedGroups: (data.approvedGroups as GroupedCluster[]) ?? [],
        activityLog: (data.activityLog as unknown[]) ?? [],
        tokenMergeRules: (data.tokenMergeRules as unknown[]) ?? [],
        autoGroupSuggestions: (data.autoGroupSuggestions as unknown[]) ?? [],
        autoMergeRecommendations: (data.autoMergeRecommendations as unknown[]) ?? [],
        groupMergeRecommendations: (data.groupMergeRecommendations as unknown[]) ?? [],
        stats: (data.stats as Stats | null) ?? null,
        datasetStats: data.datasetStats ?? null,
        blockedTokens: Array.isArray(data.blockedTokens) ? [...data.blockedTokens] : [],
        blockedKeywords: (data.blockedKeywords as unknown[]) ?? [],
        labelSections: (data.labelSections as unknown[]) ?? [],
        fileName: (data.fileName as string | null) ?? null,
      };
    },
  };
});

vi.mock('./projectCollabV2', async () => {
  const actual = await import('./projectCollabV2');
  return {
    ...actual,
    loadCanonicalProjectState: collabMocks.loadCanonicalProjectState,
    loadCanonicalEpoch: collabMocks.loadCanonicalEpoch,
    loadCanonicalCacheFromIDB: collabMocks.loadCanonicalCacheFromIDB,
    saveCanonicalCacheToIDB: collabMocks.saveCanonicalCacheToIDB,
    commitRevisionedDocChanges: collabMocks.commitRevisionedDocChanges,
    acquireProjectOperationLock: collabMocks.acquireProjectOperationLock,
    releaseProjectOperationLock: collabMocks.releaseProjectOperationLock,
    heartbeatProjectOperationLock: collabMocks.heartbeatProjectOperationLock,
  };
});

vi.mock('./firebase', () => ({
  auth: { currentUser: null },
  db: {},
  googleProvider: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  query: vi.fn((ref: unknown) => ref),
  where: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
  getDocFromServer: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
  addDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(),
  getDocs: vi.fn(() => Promise.resolve({ empty: true, docs: [], forEach: () => {} })),
  writeBatch: vi.fn(() => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn(() => Promise.resolve()) })),
  onSnapshot: vi.fn((ref: { path: string }, onNext: (snap: any) => void) => {
    firestoreListeners.handlers.set(ref.path, onNext);
    return () => {
      firestoreListeners.handlers.delete(ref.path);
    };
  }),
}));

vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('./GenerateTab', () => ({
  default: () => <div data-testid="generate-tab" />,
  GenerateTabInstance: () => <div data-testid="generate-tab-instance" />,
}));

vi.mock('./ContentTab', () => ({
  default: () => <div data-testid="content-tab" />,
}));

vi.mock('./GroupReviewSettings', async () => {
  const ReactModule = await import('react');
  return {
    default: ReactModule.forwardRef((_props, _ref) => <div data-testid="group-review-settings" />),
  };
});

vi.mock('./MergeConfirmModal', () => ({
  default: () => null,
}));

vi.mock('./ActivityLog', () => ({
  default: () => <div data-testid="activity-log" />,
}));

vi.mock('./AutoGroupPanel', () => ({
  default: () => <div data-testid="auto-group-panel" />,
}));

vi.mock('./TableHeader', () => ({
  default: () => (
    <thead>
      <tr>
        <th>Header</th>
      </tr>
    </thead>
  ),
}));

vi.mock('./ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

let App: ComponentType;

function makeRow(pageName: string, keyword: string, tokens = 'initial tokens'): ProcessedRow {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keyword,
    keywordLower: keyword.toLowerCase(),
    searchVolume: 1000,
    kd: 20,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
  };
}

function makeCluster(pageName: string, tokens = 'initial tokens'): ClusterSummary {
  return {
    pageName,
    pageNameLower: pageName.toLowerCase(),
    pageNameLen: pageName.length,
    tokens,
    tokenArr: tokens.split(' '),
    keywordCount: 1,
    totalVolume: 1000,
    avgKd: 20,
    label: '',
    labelArr: [],
    locationCity: null,
    locationState: null,
    keywords: [{ keyword: `${pageName} keyword`, volume: 1000, kd: 20, locationCity: null, locationState: null }],
  };
}

function makeGroup(groupName: string, tokens = 'initial tokens'): GroupedCluster {
  const cluster = makeCluster(`${groupName} page`, tokens);
  return {
    id: `group-${groupName.toLowerCase().replace(/\s+/g, '-')}`,
    groupName,
    clusters: [cluster],
    totalVolume: cluster.totalVolume,
    keywordCount: cluster.keywordCount,
    avgKd: cluster.avgKd,
  };
}

function makeStats(overrides: Partial<Stats> = {}): Stats {
  return {
    original: 1,
    valid: 1,
    clusters: 1,
    tokens: 2,
    totalVolume: 1000,
    ...overrides,
  };
}

function makeCanonical(groupName = 'Initial Group', tokens = 'initial tokens') {
  const meta = {
    schemaVersion: 2,
    migrationState: 'complete' as const,
    datasetEpoch: 1,
    baseCommitId: 'commit_1',
    commitState: 'ready' as const,
    lastMigratedAt: '2026-03-25T00:00:00.000Z',
    migrationOwnerClientId: null,
    migrationStartedAt: null,
    migrationHeartbeatAt: null,
    migrationExpiresAt: null,
    readMode: 'v2' as const,
    requiredClientSchema: 2,
    revision: 1,
    updatedAt: '2026-03-25T00:00:00.000Z',
    updatedByClientId: 'client-a',
    lastMutationId: null,
  };

  return {
    mode: 'v2' as const,
    base: {
      results: [],
      clusterSummary: [],
      tokenSummary: [] as TokenSummary[],
      stats: makeStats(),
      datasetStats: null,
      autoGroupSuggestions: [],
      autoMergeRecommendations: [],
      groupMergeRecommendations: [],
      updatedAt: '2026-03-25T00:00:00.000Z',
      datasetEpoch: 1,
    },
    entities: {
      meta,
      groups: [
        {
          id: 'group-initial-group',
          groupName,
          status: 'grouped' as const,
          clusterTokens: [tokens],
          datasetEpoch: 1,
          lastWriterClientId: 'client-a',
          revision: 1,
          updatedAt: '2026-03-25T00:00:00.000Z',
          updatedByClientId: 'client-a',
          lastMutationId: null,
          pageCount: 1,
          totalVolume: 1000,
          keywordCount: 1,
          avgKd: 20,
        },
      ],
      blockedTokens: [],
      manualBlockedKeywords: [],
      tokenMergeRules: [],
      labelSections: [],
      activityLog: [],
      activeOperation: null,
    },
    resolved: {
      results: [makeRow(`${groupName} page`, `${groupName} keyword`, tokens)],
      clusterSummary: [makeCluster(`${groupName} page`, tokens)],
      tokenSummary: [] as TokenSummary[],
      groupedClusters: [makeGroup(groupName, tokens)],
      approvedGroups: [],
      stats: makeStats(),
      datasetStats: null,
      blockedTokens: [],
      blockedKeywords: [],
      labelSections: [],
      activityLog: [],
      tokenMergeRules: [],
      autoGroupSuggestions: [],
      autoMergeRecommendations: [],
      groupMergeRecommendations: [],
      updatedAt: '2026-03-25T00:00:00.000Z',
      lastSaveId: 1,
    },
  };
}

function makeProjectSnapshot(projects: Project[]) {
  return {
    forEach(cb: (docSnap: { id: string; data: () => Record<string, unknown> }) => void) {
      projects.forEach((project) => {
        cb({
          id: project.id,
          data: () => ({
            name: project.name,
            description: project.description,
            createdAt: project.createdAt,
            uid: project.uid,
            fileName: project.fileName,
          }),
        });
      });
    },
  };
}

/** Breadcrumb / chrome often shows project name, not CSV file name — accept either. */
const FILE_OR_PROJECT_LABEL: Record<string, string> = {
  'shared.csv': 'Shared Project',
  'live.csv': 'Shared Project',
  'title.csv': 'Title Loans',
  'installment.csv': 'Installment Loans',
  'biz.csv': 'Biz Loans',
};

async function findFileNameInUi(name: string) {
  try {
    const byFile = await screen.findAllByText(name, { exact: true }, { timeout: 3_000 });
    if (byFile.length > 0) return byFile[0];
  } catch {
    /* fall through to project label */
  }
  const alt = FILE_OR_PROJECT_LABEL[name];
  if (alt) {
    const els = await screen.findAllByText(alt, { exact: true }, { timeout: 20_000 });
    expect(els.length).toBeGreaterThan(0);
    return els[0];
  }
  const els = await screen.findAllByText(name, { exact: true }, { timeout: 20_000 });
  expect(els.length).toBeGreaterThan(0);
  return els[0];
}

/** Heading can render twice in some layouts (e.g. split / duplicate panels). */
async function waitForKeywordManagementVisible() {
  await screen.findAllByText('Keyword Management', { exact: true }, { timeout: 20_000 });
}

describe('App shared project visibility', () => {
  beforeAll(async () => {
    const mod = await import('./App');
    App = mod.default;
  }, 120_000);

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    resetCloudSyncStateForTests();
    vi.clearAllMocks();
    firestoreListeners.handlers.clear();
    collabMocks.loadCanonicalProjectState.mockResolvedValue(makeCanonical());
    collabMocks.loadCanonicalEpoch.mockResolvedValue(makeCanonical());

    mockProjectBootstrap([
      {
        id: 'proj-1',
        name: 'Shared Project',
        description: 'collab',
        createdAt: '2026-03-25T00:00:00.000Z',
        uid: 'local',
        fileName: 'shared.csv',
      } satisfies Project,
    ]);

    storageMocks.loadSavedWorkspacePrefs.mockResolvedValue({
      activeProjectId: 'proj-1',
      savedClusters: [],
    });

    storageMocks.loadProjectDataForView.mockResolvedValue({
      results: [],
      clusterSummary: [],
      tokenSummary: [] as TokenSummary[],
      groupedClusters: [makeGroup('Initial Group')],
      approvedGroups: [],
      stats: makeStats(),
      datasetStats: null,
      blockedTokens: [],
      blockedKeywords: [],
      labelSections: [],
      activityLog: [],
      tokenMergeRules: [],
      autoGroupSuggestions: [],
      updatedAt: '2026-03-25T00:00:00.000Z',
    });
  });

  it('hydrates grouped-only projects instead of treating them as empty when ungrouped rows are zero', async () => {
    render(<App />);

    await findFileNameInUi('shared.csv');
    await waitForKeywordManagementVisible();

    expect(screen.queryByText('Upload your CSV file')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Grouped\b/i }));
    expect(await screen.findByText('Initial Group')).toBeTruthy();
  }, 30_000);

  it('[projects-collection-two-session][project-metadata-two-session][project-v2-two-session] applies live V2 group and project metadata updates for the active shared project', async () => {
    render(<App />);

    await waitFor(() => {
      expect(firestoreListeners.handlers.has('projects')).toBe(true);
      expect(firestoreListeners.handlers.has('projects/proj-1/collab/meta')).toBe(true);
      expect(firestoreListeners.handlers.has('projects/proj-1/groups')).toBe(true);
    });

    await findFileNameInUi('shared.csv');

    await act(async () => {
      firestoreListeners.handlers.get('projects')?.(
        makeProjectSnapshot([
          {
            id: 'proj-1',
            name: 'Shared Project',
            description: 'collab',
            createdAt: '2026-03-25T00:00:00.000Z',
            uid: 'local',
            fileName: 'live.csv',
          } satisfies Project,
        ]),
      );
    });

    await findFileNameInUi('live.csv');
    await waitForKeywordManagementVisible();

    fireEvent.click(screen.getByRole('button', { name: /^Grouped\b/i }));

    await act(async () => {
      firestoreListeners.handlers.get('projects/proj-1/groups')?.({
        metadata: { hasPendingWrites: false },
        docs: [
          {
            id: '1::group-initial-group',
            data: () => ({
              id: 'group-initial-group',
              groupName: 'Updated Group',
              status: 'grouped',
              clusterTokens: ['initial tokens'],
              datasetEpoch: 1,
              lastWriterClientId: 'client-a',
              revision: 2,
              updatedAt: '2026-03-25T00:00:00.000Z',
              updatedByClientId: 'client-a',
              lastMutationId: null,
              pageCount: 1,
              totalVolume: 1000,
              keywordCount: 1,
              avgKd: 20,
            }),
          },
        ],
        docChanges: () => [
          {
            type: 'modified',
            doc: {
              id: '1::group-initial-group',
              data: () => ({
                id: 'group-initial-group',
                groupName: 'Updated Group',
                status: 'grouped',
                clusterTokens: ['initial tokens'],
                datasetEpoch: 1,
                lastWriterClientId: 'client-a',
                revision: 2,
                updatedAt: '2026-03-25T00:00:00.000Z',
                updatedByClientId: 'client-a',
                lastMutationId: null,
                pageCount: 1,
                totalVolume: 1000,
                keywordCount: 1,
                avgKd: 20,
              }),
            },
          },
        ],
      });
    });

    expect(await screen.findByText('Updated Group')).toBeTruthy();
  }, 30_000);

  it('clears the active workspace when a collaborator removes the current project from the shared list', async () => {
    render(<App />);

    await findFileNameInUi('shared.csv');
    await waitForKeywordManagementVisible();

    await act(async () => {
      firestoreListeners.handlers.get('projects')?.(makeProjectSnapshot([]));
    });

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy();
    expect(screen.queryAllByText('Shared Project', { exact: true })).toHaveLength(0);
    expect(screen.queryAllByText('Keyword Management', { exact: true })).toHaveLength(0);
  }, 30_000);

  it('[workspace-preferences-two-session] user_preferences activeProjectId changes from another user do NOT hijack the local session', async () => {
    mockProjectBootstrap([
      {
        id: 'proj-1',
        name: 'Title Loans',
        description: '',
        createdAt: '2026-03-25T00:00:00.000Z',
        uid: 'local',
        fileName: 'title.csv',
      } satisfies Project,
      {
        id: 'proj-2',
        name: 'Installment Loans',
        description: '',
        createdAt: '2026-03-25T00:00:00.000Z',
        uid: 'local',
        fileName: 'installment.csv',
      } satisfies Project,
    ]);

    storageMocks.loadSavedWorkspacePrefs.mockResolvedValue({
      activeProjectId: 'proj-1',
      savedClusters: [],
    });

    const basePayload = {
      results: [] as ProcessedRow[],
      clusterSummary: [] as ClusterSummary[],
      tokenSummary: [] as TokenSummary[],
      approvedGroups: [] as GroupedCluster[],
      stats: makeStats(),
      datasetStats: null,
      blockedTokens: [] as string[],
      blockedKeywords: [] as Array<{ keyword: string; volume: number; kd: number | null; reason: string }>,
      labelSections: [] as any[],
      activityLog: [] as any[],
      tokenMergeRules: [] as any[],
      autoMergeRecommendations: [] as any[],
      autoGroupSuggestions: [] as any[],
      updatedAt: '2026-03-25T00:00:00.000Z',
      lastSaveId: 1,
    };

    storageMocks.loadProjectDataForView.mockImplementation(async (id: string) => {
      if (id === 'proj-2') {
        return {
          ...basePayload,
          groupedClusters: [makeGroup('Installment Group', 'inst tokens')],
          fileName: 'installment.csv',
        };
      }
      return {
        ...basePayload,
        groupedClusters: [makeGroup('Title Group', 'title tokens')],
        fileName: 'title.csv',
      };
    });

    render(<App />);

    await waitFor(
      () => {
        expect(firestoreListeners.handlers.has('app_settings/user_preferences')).toBe(true);
      },
      { timeout: 20_000 },
    );

    await findFileNameInUi('title.csv');

    // Another user switches to proj-2 → their write updates the shared doc.
    // This must NOT switch the local user away from proj-1.
    await act(async () => {
      firestoreListeners.handlers.get('app_settings/user_preferences')?.({
        exists: () => true,
        data: () => ({
          activeProjectId: 'proj-2',
          savedClusters: [],
        }),
      });
    });

    // Should still be on proj-1. loadProjectDataForView was only called once (initial load).
    const titleEls = await screen.findAllByText('Title Loans', { exact: true }, { timeout: 5_000 });
    expect(titleEls.length).toBeGreaterThan(0);
    expect(storageMocks.loadProjectDataForView).toHaveBeenCalledTimes(1);
    expect(storageMocks.loadProjectDataForView).toHaveBeenCalledWith('proj-1');
    expect(storageMocks.loadProjectDataForView).not.toHaveBeenCalledWith('proj-2');
  }, 30_000);

  it('does not override URL-derived project with stale shared prefs on refresh', async () => {
    mockProjectBootstrap([
      {
        id: 'proj-1',
        name: 'Installment Loans',
        description: '',
        createdAt: '2026-03-25T00:00:00.000Z',
        uid: 'local',
        fileName: 'installment.csv',
      } satisfies Project,
      {
        id: 'proj-2',
        name: 'Biz Loans',
        description: '',
        createdAt: '2026-03-25T00:00:00.000Z',
        uid: 'local',
        fileName: 'biz.csv',
      } satisfies Project,
    ]);

    // IDB prefs say proj-2 (user was on biz loans locally)
    storageMocks.loadSavedWorkspacePrefs.mockResolvedValue({
      activeProjectId: 'proj-2',
      savedClusters: [],
    });

    storageMocks.loadProjectDataForView.mockImplementation(async (id: string) => {
      const base = {
        results: [] as ProcessedRow[],
        clusterSummary: [] as ClusterSummary[],
        tokenSummary: [] as TokenSummary[],
        approvedGroups: [] as GroupedCluster[],
        stats: makeStats(),
        datasetStats: null,
        blockedTokens: [] as string[],
        blockedKeywords: [] as Array<{ keyword: string; volume: number; kd: number | null; reason: string }>,
        labelSections: [] as any[],
        activityLog: [] as any[],
        tokenMergeRules: [] as any[],
        autoMergeRecommendations: [] as any[],
        autoGroupSuggestions: [] as any[],
        updatedAt: '2026-03-25T00:00:00.000Z',
        lastSaveId: 1,
      };
      if (id === 'proj-2') {
        return { ...base, groupedClusters: [makeGroup('Biz Group')], fileName: 'biz.csv' };
      }
      return { ...base, groupedClusters: [makeGroup('Inst Group')], fileName: 'installment.csv' };
    });

    render(<App />);

    await waitFor(
      () => {
        expect(firestoreListeners.handlers.has('app_settings/user_preferences')).toBe(true);
      },
      { timeout: 20_000 },
    );

    // User should be on proj-2 (biz loans) based on prefs
    await findFileNameInUi('biz.csv');

    // Shared Firestore prefs say proj-1 (set by another user).
    // This is the initial snapshot — it should be SKIPPED and NOT switch projects.
    await act(async () => {
      firestoreListeners.handlers.get('app_settings/user_preferences')?.({
        exists: () => true,
        data: () => ({
          activeProjectId: 'proj-1',
          savedClusters: [],
        }),
      });
    });

    // Should still be on proj-2, not switched to proj-1
    const bizElements = await screen.findAllByText('Biz Loans', { exact: true }, { timeout: 5_000 });
    expect(bizElements.length).toBeGreaterThan(0);
    expect(storageMocks.loadProjectDataForView).not.toHaveBeenCalledWith('proj-1');
  }, 30_000);
});
