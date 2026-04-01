import { loadAppSettingsDoc, loadAppSettingsRows } from './appSettingsPersistence';

export type ContentPipelineLoadMode = 'remote' | 'local-preferred';

export async function loadContentPipelineRows<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  return loadAppSettingsRows<T>({
    docId,
    loadMode,
    registryKind: 'rows',
  });
}

export async function loadContentPipelineDocData(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<Record<string, unknown> | null> {
  return loadAppSettingsDoc<Record<string, unknown>>({
    docId,
    localPreferred: loadMode === 'local-preferred',
  });
}
