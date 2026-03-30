import { getAppSettingsDocData, loadChunkedAppSettingsRows, setAppSettingsDocData, writeChunkedAppSettingsRows } from './appSettingsDocStore';

export const GENERATE_WORKSPACE_META_BASE_DOC_ID = 'generate_workspace_meta';
const PROJECT_DOC_PREFIX = 'project_';
const SCOPED_DOC_SEPARATOR = '__';
const LEGACY_WORKSPACE_SOURCE = 'global-app-settings-v1';

const GENERATE_WORKSPACE_SHARED_BASE_DOC_IDS = [
  'generate_rows',
  'generate_settings',
  'generate_logs',
  'generate_rows_2',
  'generate_settings_2',
  'generate_logs_2',
  'generate_rows_page_names',
  'generate_settings_page_names',
  'generate_logs_page_names',
  'generate_rows_h2_content',
  'generate_settings_h2_content',
  'generate_rows_h2_rating',
  'generate_settings_h2_rating',
  'generate_rows_h2_html',
  'generate_settings_h2_html',
  'generate_rows_h2_summary',
  'generate_settings_h2_summary',
  'generate_rows_h1_body',
  'generate_settings_h1_body',
  'generate_rows_h1_html',
  'generate_settings_h1_html',
  'generate_rows_quick_answer',
  'generate_settings_quick_answer',
  'generate_rows_quick_answer_html',
  'generate_settings_quick_answer_html',
  'generate_rows_metas_slug_ctas',
  'generate_settings_metas_slug_ctas',
  'generate_rows_tips_redflags',
  'generate_settings_tips_redflags',
] as const;

const pendingWorkspaceEnsures = new Map<string, Promise<void>>();

function isRowsDocId(docId: string): boolean {
  return docId.startsWith('generate_rows');
}

export function scopeGenerateWorkspaceDocId(projectId: string | null, baseDocId: string): string {
  if (!projectId) return baseDocId;
  return `${PROJECT_DOC_PREFIX}${projectId}${SCOPED_DOC_SEPARATOR}${baseDocId}`;
}

export function getGenerateWorkspaceMetaDocId(projectId: string | null): string {
  return scopeGenerateWorkspaceDocId(projectId, GENERATE_WORKSPACE_META_BASE_DOC_ID);
}

export function resolveGenerateScopedDocIds<T extends Record<string, string>>(
  projectId: string | null,
  docIds: T,
): T {
  return Object.fromEntries(
    Object.entries(docIds).map(([key, value]) => [key, scopeGenerateWorkspaceDocId(projectId, value)]),
  ) as T;
}

async function cloneLegacyWorkspaceDoc(projectId: string, baseDocId: string): Promise<boolean> {
  const legacyDoc = await getAppSettingsDocData(baseDocId);
  if (!legacyDoc) return false;

  const scopedDocId = scopeGenerateWorkspaceDocId(projectId, baseDocId);
  if (isRowsDocId(baseDocId)) {
    const rows = await loadChunkedAppSettingsRows<Record<string, unknown>>(baseDocId);
    await writeChunkedAppSettingsRows(scopedDocId, rows, {
      updatedAt: typeof legacyDoc.updatedAt === 'string' ? legacyDoc.updatedAt : undefined,
      totalRows: typeof legacyDoc.totalRows === 'number' ? legacyDoc.totalRows : rows.length,
    });
    return true;
  }

  await setAppSettingsDocData(scopedDocId, legacyDoc);
  return true;
}

export async function ensureProjectGenerateWorkspace(projectId: string | null): Promise<void> {
  if (!projectId) return;

  const existing = pendingWorkspaceEnsures.get(projectId);
  if (existing) {
    await existing;
    return;
  }

  const ensurePromise = (async () => {
    const metaDocId = getGenerateWorkspaceMetaDocId(projectId);
    const existingMeta = await getAppSettingsDocData(metaDocId);
    if (existingMeta) return;

    let importedLegacyAt = '';
    for (const baseDocId of GENERATE_WORKSPACE_SHARED_BASE_DOC_IDS) {
      const scopedDocId = scopeGenerateWorkspaceDocId(projectId, baseDocId);
      const scopedDoc = await getAppSettingsDocData(scopedDocId);
      if (scopedDoc) continue;
      const migrated = await cloneLegacyWorkspaceDoc(projectId, baseDocId);
      if (migrated && !importedLegacyAt) {
        importedLegacyAt = new Date().toISOString();
      }
    }

    await setAppSettingsDocData(metaDocId, {
      version: 1,
      importedLegacyAt,
      source: LEGACY_WORKSPACE_SOURCE,
    });
  })().finally(() => {
    pendingWorkspaceEnsures.delete(projectId);
  });

  pendingWorkspaceEnsures.set(projectId, ensurePromise);
  await ensurePromise;
}

export const LEGACY_GENERATE_WORKSPACE_DOC_IDS = [...GENERATE_WORKSPACE_SHARED_BASE_DOC_IDS];
