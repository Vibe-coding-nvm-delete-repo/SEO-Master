import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const rulesSource = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

const V2_META = {
  schemaVersion: 2,
  revision: 1,
  updatedAt: '2026-04-01T00:00:00.000Z',
  updatedByClientId: 'owner-1',
  datasetEpoch: 4,
  baseCommitId: 'commit-4',
  commitState: 'ready',
  migrationState: 'complete',
  readMode: 'v2',
  requiredClientSchema: 2,
};

describeWithEmulator('firestore.rules emulator', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-kwg',
      firestore: { rules: rulesSource },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('allows open shared app_settings writes for workspace collaboration docs', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(db, 'app_settings/group_review_settings'), {
      updatedAt: '2026-04-01T00:00:00.000Z',
      prompt: 'Shared prompt',
    }));
    await assertSucceeds(getDoc(doc(db, 'app_settings/group_review_settings')));
  });

  it('allows open project metadata writes outside the protected V2 collections', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(db, 'projects/proj-open'), {
      name: 'Shared Project',
      description: 'collab',
      createdAt: '2026-04-01T00:00:00.000Z',
      uid: 'user-1',
    }));
    await assertSucceeds(setDoc(doc(db, 'project_folders/default'), {
      folders: [{ id: 'folder-1', name: 'Shared Folder', order: 0 }],
    }));
  });

  it('[project-v2-canonical-rules] only allows valid base commit manifest writes for canonical project state', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'projects/proj-v2'), {
        name: 'Shared V2 Project',
        description: 'collab',
        createdAt: '2026-04-01T00:00:00.000Z',
        uid: 'user-1',
      });
    });

    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(setDoc(doc(db, 'projects/proj-v2/base_commits/commit-4'), {
      id: 'manifest',
      type: 'meta',
      commitId: 'commit-4',
      datasetEpoch: 4,
      revision: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      updatedByClientId: 'owner-1',
      commitState: 'writing',
      resultChunkIds: [],
      resultChunkCount: 0,
      clusterChunkIds: [],
      clusterChunkCount: 0,
      suggestionChunkIds: [],
      suggestionChunkCount: 0,
      autoMergeChunkIds: [],
      autoMergeChunkCount: 0,
      groupMergeChunkIds: [],
      groupMergeChunkCount: 0,
      contentHash: null,
    }));

    await assertFails(setDoc(doc(db, 'projects/proj-v2/base_commits/invalid-commit'), {
      id: 'manifest',
      type: 'meta',
      commitId: 'invalid-commit',
      datasetEpoch: 'bad',
      revision: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      updatedByClientId: 'owner-1',
      commitState: 'writing',
      resultChunkIds: [],
      resultChunkCount: 0,
      clusterChunkIds: [],
      clusterChunkCount: 0,
      suggestionChunkIds: [],
      suggestionChunkCount: 0,
      autoMergeChunkIds: [],
      autoMergeChunkCount: 0,
      groupMergeChunkIds: [],
      groupMergeChunkCount: 0,
      contentHash: null,
    }));
  });

  it('[project-v2-entity-rules] rejects stale V2 entity writes and accepts current-epoch entity writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'projects/proj-entity'), {
        name: 'Shared Entity Project',
        description: 'collab',
        createdAt: '2026-04-01T00:00:00.000Z',
        uid: 'user-1',
      });
      await setDoc(doc(adminDb, 'projects/proj-entity/collab/meta'), V2_META);
    });

    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(setDoc(doc(db, 'projects/proj-entity/groups/group-1'), {
      id: 'group-1',
      groupName: 'Alpha Group',
      status: 'grouped',
      clusterTokens: ['alpha'],
      datasetEpoch: 3,
      revision: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      updatedByClientId: 'owner-1',
    }));

    await assertSucceeds(setDoc(doc(db, 'projects/proj-entity/groups/group-1'), {
      id: 'group-1',
      groupName: 'Alpha Group',
      status: 'grouped',
      clusterTokens: ['alpha'],
      datasetEpoch: 4,
      revision: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      updatedByClientId: 'owner-1',
    }));
  });

  it('[project-v2-listener-rules] blocks collab meta epoch activation without the owned operation lock and allows it with the lock', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'projects/proj-meta'), {
        name: 'Shared Listener Project',
        description: 'collab',
        createdAt: '2026-04-01T00:00:00.000Z',
        uid: 'user-1',
      });
      await setDoc(doc(adminDb, 'projects/proj-meta/base_commits/commit-4'), {
        id: 'manifest',
        type: 'meta',
        commitId: 'commit-4',
        datasetEpoch: 4,
        revision: 1,
        updatedAt: '2026-04-01T00:00:00.000Z',
        updatedByClientId: 'owner-1',
        commitState: 'ready',
        resultChunkIds: [],
        resultChunkCount: 0,
        clusterChunkIds: [],
        clusterChunkCount: 0,
        suggestionChunkIds: [],
        suggestionChunkCount: 0,
        autoMergeChunkIds: [],
        autoMergeChunkCount: 0,
        groupMergeChunkIds: [],
        groupMergeChunkCount: 0,
        contentHash: null,
      });
      await setDoc(doc(adminDb, 'projects/proj-meta/base_commits/commit-5'), {
        id: 'manifest',
        type: 'meta',
        commitId: 'commit-5',
        datasetEpoch: 5,
        revision: 1,
        updatedAt: '2026-04-01T00:00:00.000Z',
        updatedByClientId: 'owner-1',
        commitState: 'ready',
        resultChunkIds: [],
        resultChunkCount: 0,
        clusterChunkIds: [],
        clusterChunkCount: 0,
        suggestionChunkIds: [],
        suggestionChunkCount: 0,
        autoMergeChunkIds: [],
        autoMergeChunkCount: 0,
        groupMergeChunkIds: [],
        groupMergeChunkCount: 0,
        contentHash: null,
      });
      await setDoc(doc(adminDb, 'projects/proj-meta/collab/meta'), V2_META);
    });

    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(setDoc(doc(db, 'projects/proj-meta/collab/meta'), {
      ...V2_META,
      revision: 2,
      datasetEpoch: 5,
      baseCommitId: 'commit-5',
      updatedByClientId: 'owner-1',
    }));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'projects/proj-meta/project_operations/current'), {
        type: 'bulk-update',
        ownerId: 'owner-1',
        ownerClientId: 'owner-1',
        startedAt: '2026-04-01T00:00:00.000Z',
        heartbeatAt: '2026-04-01T00:00:00.000Z',
        expiresAt: '2099-04-01T00:00:00.000Z',
        status: 'running',
      });
    });

    await assertSucceeds(setDoc(doc(db, 'projects/proj-meta/collab/meta'), {
      ...V2_META,
      revision: 2,
      datasetEpoch: 5,
      baseCommitId: 'commit-5',
      updatedByClientId: 'owner-1',
      commitState: 'ready',
    }));
  });
});
