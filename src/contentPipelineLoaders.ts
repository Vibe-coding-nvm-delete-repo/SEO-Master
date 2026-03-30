import {
  getAppSettingsDocData,
  loadChunkedAppSettingsRows,
  loadChunkedAppSettingsRowsLocalPreferred,
} from './appSettingsDocStore';
import { appSettingsIdbKey, loadCachedState } from './appSettingsPersistence';

export type ContentPipelineLoadMode = 'remote' | 'local-preferred';

export async function loadContentPipelineRows<T>(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<T[]> {
  if (loadMode === 'local-preferred') {
    return loadChunkedAppSettingsRowsLocalPreferred<T>(docId);
  }
  return loadChunkedAppSettingsRows<T>(docId);
}

export async function loadContentPipelineDocData(
  docId: string,
  loadMode: ContentPipelineLoadMode = 'remote',
): Promise<Record<string, unknown> | null> {
  if (loadMode === 'local-preferred') {
    const cached = await loadCachedState<Record<string, unknown>>({
      idbKey: appSettingsIdbKey(docId),
    });
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      return cached;
    }
  }
  return getAppSettingsDocData(docId);
}
