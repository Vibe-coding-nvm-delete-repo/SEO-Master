import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  getAppSettingsDocData: vi.fn(),
  loadChunkedAppSettingsRows: vi.fn(),
  loadChunkedAppSettingsRowsLocalPreferred: vi.fn(),
  loadCachedState: vi.fn(),
}));

vi.mock('./appSettingsDocStore', () => ({
  getAppSettingsDocData: testState.getAppSettingsDocData,
  loadChunkedAppSettingsRows: testState.loadChunkedAppSettingsRows,
  loadChunkedAppSettingsRowsLocalPreferred: testState.loadChunkedAppSettingsRowsLocalPreferred,
}));

vi.mock('./appSettingsPersistence', () => ({
  appSettingsIdbKey: (docId: string) => `__app_settings__:${docId}`,
  loadCachedState: testState.loadCachedState,
}));

import {
  loadContentPipelineDocData,
  loadContentPipelineRows,
} from './contentPipelineLoaders';

describe('contentPipelineLoaders', () => {
  beforeEach(() => {
    testState.getAppSettingsDocData.mockReset();
    testState.loadChunkedAppSettingsRows.mockReset();
    testState.loadChunkedAppSettingsRowsLocalPreferred.mockReset();
    testState.loadCachedState.mockReset();
  });

  it('uses remote rows for the default load mode', async () => {
    testState.loadChunkedAppSettingsRows.mockResolvedValue([{ id: 'remote-row' }]);

    await expect(loadContentPipelineRows('generate_rows_page_names')).resolves.toEqual([{ id: 'remote-row' }]);
    expect(testState.loadChunkedAppSettingsRows).toHaveBeenCalledWith('generate_rows_page_names');
    expect(testState.loadChunkedAppSettingsRowsLocalPreferred).not.toHaveBeenCalled();
  });

  it('uses local-preferred rows when requested', async () => {
    testState.loadChunkedAppSettingsRowsLocalPreferred.mockResolvedValue([{ id: 'cached-row' }]);

    await expect(loadContentPipelineRows('generate_rows_page_names', 'local-preferred')).resolves.toEqual([{ id: 'cached-row' }]);
    expect(testState.loadChunkedAppSettingsRowsLocalPreferred).toHaveBeenCalledWith('generate_rows_page_names');
    expect(testState.loadChunkedAppSettingsRows).not.toHaveBeenCalled();
  });

  it('uses cached settings docs for local-preferred loads before falling back to Firestore', async () => {
    testState.loadCachedState.mockResolvedValueOnce({ prompt: 'cached prompt' });

    await expect(loadContentPipelineDocData('generate_settings_h2_content', 'local-preferred')).resolves.toEqual({
      prompt: 'cached prompt',
    });
    expect(testState.loadCachedState).toHaveBeenCalledWith({
      idbKey: '__app_settings__:generate_settings_h2_content',
    });
    expect(testState.getAppSettingsDocData).not.toHaveBeenCalled();
  });

  it('falls back to Firestore when no cached settings doc exists', async () => {
    testState.loadCachedState.mockResolvedValueOnce(null);
    testState.getAppSettingsDocData.mockResolvedValueOnce({ prompt: 'remote prompt' });

    await expect(loadContentPipelineDocData('generate_settings_h2_content', 'local-preferred')).resolves.toEqual({
      prompt: 'remote prompt',
    });
    expect(testState.getAppSettingsDocData).toHaveBeenCalledWith('generate_settings_h2_content');
  });
});
