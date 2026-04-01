import { collection, getDocs } from 'firebase/firestore';
import { db } from '../src/firebase';
import { migrateLegacyProjectToV2 } from '../src/projectCollabV2';
import { loadCollabMeta } from '../src/projectCollabV2Storage';
import { isSharedProject } from '../src/projectSharing';
import {
  loadProjectDataFromFirestore,
  projectFromFirestoreData,
  type ProjectDataPayload,
} from '../src/projectStorage';

const PROJECTS_COLLECTION = 'projects';

const EMPTY_PAYLOAD: ProjectDataPayload = {
  results: [],
  clusterSummary: [],
  tokenSummary: [],
  groupedClusters: [],
  approvedGroups: [],
  stats: null,
  datasetStats: null,
  blockedTokens: [],
  blockedKeywords: [],
  labelSections: [],
  activityLog: [],
  tokenMergeRules: [],
  autoGroupSuggestions: [],
  autoMergeRecommendations: [],
  groupMergeRecommendations: [],
  updatedAt: new Date(0).toISOString(),
  lastSaveId: 1,
};

function getArg(name: string): string | null {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const onlyProjectId = getArg('--project');
  const actorId = `shared-v2-cutover-${Date.now().toString(36)}`;

  const projectsSnapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
  const sharedProjects = projectsSnapshot.docs
    .map((docSnap) => projectFromFirestoreData(docSnap.id, docSnap.data()))
    .filter((project) => isSharedProject(project))
    .filter((project) => !onlyProjectId || project.id === onlyProjectId);

  console.log(
    `[shared-v2-migrate] discovered ${sharedProjects.length} shared project(s)` +
      (onlyProjectId ? ` for ${onlyProjectId}` : ''),
  );

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of sharedProjects) {
    const meta = await loadCollabMeta(project.id).catch(() => null);
    const alreadyV2 = Boolean(
      meta &&
      meta.readMode === 'v2' &&
      meta.migrationState === 'complete' &&
      meta.commitState === 'ready' &&
      meta.baseCommitId,
    );
    if (alreadyV2) {
      skipped += 1;
      console.log(`[shared-v2-migrate] skip ${project.id} (${project.name}) already ready on V2`);
      continue;
    }

    const legacyPayload = await loadProjectDataFromFirestore(project.id);
    const payload = legacyPayload ?? EMPTY_PAYLOAD;
    const payloadKind = legacyPayload ? 'legacy chunks' : 'empty payload';

    if (dryRun) {
      console.log(`[shared-v2-migrate] would migrate ${project.id} (${project.name}) using ${payloadKind}`);
      continue;
    }

    try {
      await migrateLegacyProjectToV2(project.id, payload, actorId);
      migrated += 1;
      console.log(`[shared-v2-migrate] migrated ${project.id} (${project.name}) using ${payloadKind}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[shared-v2-migrate] FAILED ${project.id} (${project.name}): ${message}`);
    }
  }

  if (dryRun) {
    console.log('[shared-v2-migrate] dry run complete');
    return;
  }

  console.log(
    `[shared-v2-migrate] complete migrated=${migrated} skipped=${skipped} failed=${failed}`,
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[shared-v2-migrate] fatal: ${message}`);
  process.exitCode = 1;
});
