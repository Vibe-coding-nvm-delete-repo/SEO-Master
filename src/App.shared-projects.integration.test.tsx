import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterSummary, GroupedCluster, ProcessedRow, Project, Stats, TokenSummary } from './types';

const storageMocks = vi.hoisted(() => ({
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

const firestoreListeners = vi.hoisted(() => ({
  handlers: new Map<string, (snap: any) => void>(),
}));

vi.mock('./projectStorage', async () => {
  const actual = await vi.importActual<typeof import('./projectStorage')>('./projectStorage');
  return {
    ...actual,
    loadProjectsFromFirestore: storageMocks.loadProjectsFromFirestore,
    saveAppPrefsToFirestore: storageMocks.saveAppPrefsToFirestore,
    saveProjectDataToFirestore: storageMocks.saveProjectDataToFirestore,
    saveProjectToFirestore: storageMocks.saveProjectToFirestore,
    deleteProjectFromFirestore: storageMocks.deleteProjectFromFirestore,
    deleteProjectDataFromFirestore: storageMocks.deleteProjectDataFromFirestore,
    deleteFromIDB: storageMocks.deleteFromIDB,
  };
});

vi.mock('./projectWorkspace', async () => {
  const actual = await vi.importActual<typeof import('./projectWorkspace')>('./projectWorkspace');
  return {
    ...actual,
    loadSavedWorkspacePrefs: storageMocks.loadSavedWorkspacePrefs,
    loadProjectDataForView: storageMocks.loadProjectDataForView,
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

function makeChunksSnapshot(payload: {
  results?: ProcessedRow[];
  clusterSummary?: ClusterSummary[];
  groupedClusters?: GroupedCluster[];
  approvedGroups?: GroupedCluster[];
  tokenSummary?: TokenSummary[];
  blockedTokens?: string[];
  blockedKeywords?: Array<{ keyword: string; volume: number; kd: number | null; reason: string }>;
  labelSections?: any[];
  activityLog?: any[];
  tokenMergeRules?: any[];
  autoGroupSuggestions?: any[];
  stats?: Stats | null;
  datasetStats?: unknown | null;
}) {
  const results = payload.results || [];
  const clusters = payload.clusterSummary || [];
  const blockedKeywords = payload.blockedKeywords || [];
  const suggestions = payload.autoGroupSuggestions || [];

  const docs: Array<{ data: () => any }> = [
    {
      data: () => ({
        type: 'meta',
        stats: payload.stats || null,
        datasetStats: payload.datasetStats || null,
        tokenSummary: payload.tokenSummary || [],
        groupedClusters: payload.groupedClusters || [],
        approvedGroups: payload.approvedGroups || [],
        blockedTokens: payload.blockedTokens || [],
        labelSections: payload.labelSections || [],
        activityLog: payload.activityLog || [],
        tokenMergeRules: payload.tokenMergeRules || [],
        resultChunkCount: results.length > 0 ? 1 : 0,
        clusterChunkCount: clusters.length > 0 ? 1 : 0,
        blockedChunkCount: blockedKeywords.length > 0 ? 1 : 0,
        suggestionChunkCount: suggestions.length > 0 ? 1 : 0,
      }),
    },
  ];

  if (results.length > 0) {
    docs.push({ data: () => ({ type: 'results', index: 0, data: results }) });
  }
  if (clusters.length > 0) {
    docs.push({ data: () => ({ type: 'clusters', index: 0, data: clusters }) });
  }
  if (blockedKeywords.length > 0) {
    docs.push({ data: () => ({ type: 'blocked', index: 0, data: blockedKeywords }) });
  }
  if (suggestions.length > 0) {
    docs.push({ data: () => ({ type: 'suggestions', index: 0, data: suggestions }) });
  }

  return {
    empty: docs.length === 0,
    docs,
  };
}

describe('App shared project visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestoreListeners.handlers.clear();

    storageMocks.loadProjectsFromFirestore.mockResolvedValue([
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
    const { default: App } = await import('./App');
    render(<App />);

    await screen.findByText('shared.csv');
    await screen.findByText('Keyword Management');

    expect(screen.queryByText('Upload your CSV file')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Grouped\b/i }));
    expect(await screen.findByText('Initial Group')).toBeTruthy();
  });

  it('applies live chunk and project metadata updates for the active shared project', async () => {
    const { default: App } = await import('./App');
    render(<App />);

    await waitFor(() => {
      expect(firestoreListeners.handlers.has('projects')).toBe(true);
      expect(firestoreListeners.handlers.has('projects/proj-1/chunks')).toBe(true);
    });

    await screen.findByText('shared.csv');

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

    expect(await screen.findByText('live.csv')).toBeTruthy();
    await screen.findByText('Keyword Management');

    fireEvent.click(screen.getByRole('button', { name: /^Grouped\b/i }));

    await act(async () => {
      firestoreListeners.handlers.get('projects/proj-1/chunks')?.(
        makeChunksSnapshot({
          results: [makeRow('Updated Page', 'updated kw', 'updated tokens')],
          clusterSummary: [],
          groupedClusters: [makeGroup('Updated Group', 'updated tokens')],
          approvedGroups: [],
          tokenSummary: [] as TokenSummary[],
          stats: makeStats(),
          blockedTokens: [],
          blockedKeywords: [],
          labelSections: [],
          activityLog: [],
          tokenMergeRules: [],
          autoGroupSuggestions: [],
        }),
      );
    });

    expect(await screen.findByText('Updated Group')).toBeTruthy();
  });

  it('clears the active workspace when a collaborator removes the current project from the shared list', async () => {
    const { default: App } = await import('./App');
    render(<App />);

    await screen.findByText('shared.csv');
    await screen.findByText('Keyword Management');

    await act(async () => {
      firestoreListeners.handlers.get('projects')?.(makeProjectSnapshot([]));
    });

    expect(await screen.findByText('Select a project to view or upload keyword data.')).toBeTruthy();
    expect(screen.queryByText('shared.csv')).toBeNull();
    expect(screen.queryByText('Keyword Management')).toBeNull();
  });
});
