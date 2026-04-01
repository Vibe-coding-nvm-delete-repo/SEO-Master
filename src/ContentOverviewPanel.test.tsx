import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as appSettingsPersistence from './appSettingsPersistence';
import ContentOverviewPanel from './ContentOverviewPanel';

let cachedRowsByDocId: Record<string, unknown[] | null> = {};
const PROJECT_PREFIX = 'project_proj-1__';

vi.mock('./appSettingsPersistence', () => ({
  APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT: 'kwg:app-settings-local-rows-updated',
  appSettingsIdbKey: (docId: string) => `__app_settings__:${docId}`,
  loadCachedState: vi.fn(async ({ idbKey }: { idbKey: string }) => {
    const docId = idbKey.replace('__app_settings__:', '');
    return cachedRowsByDocId[docId] ?? null;
  }),
  loadAppSettingsRows: vi.fn(async ({ docId, loadMode }: { docId: string; loadMode?: 'remote' | 'local-preferred' }) => {
    if (loadMode === 'local-preferred' && cachedRowsByDocId[docId]) {
      return cachedRowsByDocId[docId];
    }
    if (docId === `${PROJECT_PREFIX}generate_rows_page_names`) {
      return [
        { id: 'page-1', input: 'keyword one', status: 'generated', output: 'Keyword One Title', cost: 0.01 },
        { id: 'page-2', input: 'keyword two', status: 'pending', output: '', cost: 0.02 },
      ];
    }
    return [];
  }),
  subscribeAppSettingsDoc: vi.fn(() => () => undefined),
}));

const appSettingsMocks = vi.mocked(appSettingsPersistence);

describe('ContentOverviewPanel', () => {
  afterEach(() => {
    cachedRowsByDocId = {};
    vi.clearAllMocks();
  });

  it('renders summary metrics and progress rows from persisted docs', async () => {
    const onStageSelect = vi.fn();
    render(<ContentOverviewPanel activeProjectId="proj-1" onStageSelect={onStageSelect} />);

    await waitFor(() => {
      expect(screen.getByTestId('content-overview-panel')).toBeTruthy();
    });

    expect(screen.getByText('Total Pages')).toBeTruthy();
    expect(screen.getByText('Completed Outputs')).toBeTruthy();
    expect(screen.getByText('Pipeline Progress')).toBeTruthy();
    expect(screen.getByText('Overall Completion')).toBeTruthy();
    expect(screen.getAllByText('Pages').length).toBeGreaterThan(0);
    expect(screen.getByText('Metas/Slug/CTAs')).toBeTruthy();
    expect(screen.getByText('Pro Tip/Red Flag/Key Takeaways')).toBeTruthy();
    expect(screen.getByText('Bottleneck')).toBeTruthy();
    expect(screen.getByText('Highest Cost')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Total Pages/i }));
    expect(onStageSelect).toHaveBeenCalledWith('pages');
  });

  it('refreshes from local cached rows when a content subtab updates before Firestore catches up', async () => {
    render(<ContentOverviewPanel activeProjectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('content-overview-panel')).toBeTruthy();
    });

    expect(screen.getByText('H2 Rate')).toBeTruthy();
    expect(screen.getAllByText('0/2').length).toBeGreaterThan(0);

    cachedRowsByDocId[`${PROJECT_PREFIX}generate_rows_page_names`] = [
      { id: 'page-1', input: 'keyword one', status: 'generated', output: 'Keyword One Title', cost: 0.01 },
      { id: 'page-2', input: 'keyword two', status: 'pending', output: '', cost: 0.02 },
    ];
    cachedRowsByDocId[`${PROJECT_PREFIX}generate_rows_h2_rating`] = [
      { id: 'rating-1', status: 'generated', output: '4', cost: 0.05, metadata: { sourceRowId: 'page-1' } },
      { id: 'rating-2', status: 'generated', output: '4', cost: 0.06, metadata: { sourceRowId: 'page-2' } },
    ];

    await act(async () => {
      window.dispatchEvent(new CustomEvent('kwg:app-settings-local-rows-updated', {
        detail: { docId: `${PROJECT_PREFIX}generate_rows_h2_rating` },
      }));
    });

    await waitFor(() => {
      expect(screen.getAllByText('2/2').length).toBeGreaterThan(0);
    });
  });

  it('stays idle while runtime effects are disabled', async () => {
    render(<ContentOverviewPanel activeProjectId="proj-1" runtimeEffectsActive={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('content-overview-panel')).toBeTruthy();
    });

    expect(appSettingsMocks.loadAppSettingsRows).not.toHaveBeenCalled();
    expect(appSettingsMocks.subscribeAppSettingsDoc).not.toHaveBeenCalled();
  });
});
