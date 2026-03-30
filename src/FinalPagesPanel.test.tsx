import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinalPagesPanel from './FinalPagesPanel';

const testState = vi.hoisted(() => ({
  cachedByIdbKey: {} as Record<string, unknown>,
  mockLoadChunkedAppSettingsRows: vi.fn(),
  mockLoadCachedState: vi.fn(),
}));
const PROJECT_PREFIX = 'project_proj-1__';

vi.mock('./appSettingsDocStore', () => ({
  loadChunkedAppSettingsRows: testState.mockLoadChunkedAppSettingsRows,
}));

vi.mock('./appSettingsPersistence', () => ({
  APP_SETTINGS_LOCAL_ROWS_UPDATED_EVENT: 'kwg:app-settings-local-rows-updated',
  appSettingsIdbKey: (docId: string) => `__app_settings__:${docId}`,
  loadCachedState: testState.mockLoadCachedState,
  subscribeAppSettingsDoc: vi.fn(() => () => undefined),
}));

function makeReadyRows() {
  return {
    [`${PROJECT_PREFIX}generate_rows_page_names`]: [
      {
        id: 'page-1',
        input: 'installment loans',
        output: 'Can You Get Installment Loans?',
        status: 'generated',
        generatedAt: '2026-03-29T03:40:00.000Z',
      },
    ],
    [`${PROJECT_PREFIX}generate_rows_h2_html`]: [
      {
        id: 'h2-1',
        status: 'generated',
        output: '<p>H2 body content.</p>',
        generatedAt: '2026-03-29T03:41:00.000Z',
        metadata: { sourceRowId: 'page-1', order: '1', h2Name: 'What Are Installment Loans?' },
      },
    ],
    [`${PROJECT_PREFIX}generate_rows_h1_html`]: [
      {
        id: 'h1-1',
        status: 'generated',
        output: '<p>H1 body text.</p>',
        generatedAt: '2026-03-29T03:42:00.000Z',
        metadata: { sourceRowId: 'page-1' },
      },
    ],
    [`${PROJECT_PREFIX}generate_rows_quick_answer_html`]: [
      {
        id: 'quick-1',
        status: 'generated',
        output: '<p>Quick answer text.</p>',
        generatedAt: '2026-03-29T03:43:00.000Z',
        metadata: { sourceRowId: 'page-1' },
      },
    ],
    [`${PROJECT_PREFIX}generate_rows_metas_slug_ctas`]: [
      {
        id: 'meta-1',
        status: 'generated',
        output: 'Meta description text.',
        generatedAt: '2026-03-29T03:44:00.000Z',
        metadata: {
          sourceRowId: 'page-1',
          metaTitle: 'Can You Get Installment Loans?',
          slug: 'can-you-get-installment-loans',
          ctaHeadline: 'Call us first',
          ctaBody: 'We can review your credit.',
        },
        slots: {
          slug: {
            status: 'generated',
            output: 'can-you-get-installment-loans',
            generatedAt: '2026-03-29T03:45:00.000Z',
          },
          cta: {
            status: 'generated',
            output: '{"headline":"Call us first","body":"We can review your credit."}',
            generatedAt: '2026-03-29T03:46:00.000Z',
          },
        },
      },
    ],
    [`${PROJECT_PREFIX}generate_rows_tips_redflags`]: [
      {
        id: 'tips-1',
        status: 'generated',
        output: 'Helpful pro tip.',
        generatedAt: '2026-03-29T03:47:00.000Z',
        metadata: { sourceRowId: 'page-1' },
        slots: {
          redflag: { status: 'generated', output: 'Red flag text.', generatedAt: '2026-03-29T03:48:00.000Z' },
          keytakeaways: { status: 'generated', output: 'Key takeaway text.', generatedAt: '2026-03-29T03:49:00.000Z' },
        },
      },
    ],
  };
}

describe('FinalPagesPanel', () => {
  beforeEach(() => {
    testState.cachedByIdbKey = {};
    testState.mockLoadChunkedAppSettingsRows.mockReset();
    testState.mockLoadCachedState.mockReset();
    testState.mockLoadCachedState.mockImplementation(async ({ idbKey }: { idbKey: string }) => testState.cachedByIdbKey[idbKey] ?? null);
    const readyRows = makeReadyRows();
    testState.mockLoadChunkedAppSettingsRows.mockImplementation(async (docId: string) => readyRows[docId as keyof typeof readyRows] ?? []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the publish-readiness summary and final pages table', async () => {
    const onSourceSelect = vi.fn();
    render(<FinalPagesPanel activeProjectId="proj-1" onSourceSelect={onSourceSelect} />);

    await waitFor(() => {
      expect(screen.getByTestId('final-pages-panel')).toBeTruthy();
    });

    expect(screen.getByText('Final Pages')).toBeTruthy();
    expect(screen.getByText('Total Pages')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Needs Review')).toBeTruthy();
    expect(screen.getByText('Completion %')).toBeTruthy();
    expect(screen.getByText('Last Updated')).toBeTruthy();
    expect(screen.getByText('0 rows missing required fields')).toBeTruthy();
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Meta Description')).toBeTruthy();
    expect(screen.getByText('CTA Title')).toBeTruthy();
    expect(screen.getByText('Dynamic Header 1')).toBeTruthy();
    expect(screen.getByText('Dynamic Description 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    expect(screen.getAllByText('Can You Get Installment Loans?').length).toBeGreaterThan(0);
    expect(screen.getByText('Meta description text.')).toBeTruthy();
    expect(screen.getByText('Call us first')).toBeTruthy();
    expect(screen.getByText('<p>H2 body content.</p>')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Open Title source tab'));
    fireEvent.click(screen.getByTitle('Open Meta Description source tab'));
    fireEvent.click(screen.getByTitle('Open Quick Answer source tab'));
    fireEvent.click(screen.getByTitle('Open H1 Body source tab'));
    fireEvent.click(screen.getByTitle('Open Dynamic Header 1 source tab'));

    expect(onSourceSelect.mock.calls.map(([subtab]) => subtab)).toEqual([
      'pages',
      'metas-slug-ctas',
      'quick-answer-html',
      'h1-body-html',
      'h2-body-html',
    ]);
  });

  it('refreshes from local cached rows before remote snapshots catch up', async () => {
    testState.mockLoadChunkedAppSettingsRows.mockImplementation(async (docId: string) => {
      if (docId === `${PROJECT_PREFIX}generate_rows_page_names`) {
        return [{
          id: 'page-1',
          input: 'installment loans',
          output: 'Can You Get Installment Loans?',
          status: 'generated',
        }];
      }
      return [];
    });

    render(<FinalPagesPanel activeProjectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('1 rows missing required fields')).toBeTruthy();
    });

    const readyRows = makeReadyRows();
    for (const [docId, value] of Object.entries(readyRows)) {
      testState.cachedByIdbKey[`__app_settings__:${docId}`] = value;
    }

    await act(async () => {
      window.dispatchEvent(new CustomEvent('kwg:app-settings-local-rows-updated', {
        detail: { docId: `${PROJECT_PREFIX}generate_rows_metas_slug_ctas` },
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('0 rows missing required fields')).toBeTruthy();
    });
    expect(screen.getByText('Meta description text.')).toBeTruthy();
  });

  it('exports CSV with proper escaping', async () => {
    testState.mockLoadChunkedAppSettingsRows.mockImplementation(async (docId: string) => {
      const readyRows = makeReadyRows();
      if (docId === `${PROJECT_PREFIX}generate_rows_metas_slug_ctas`) {
        return [
          {
            ...readyRows[`${PROJECT_PREFIX}generate_rows_metas_slug_ctas`][0],
            output: 'Meta "description", text',
            metadata: {
              ...readyRows[`${PROJECT_PREFIX}generate_rows_metas_slug_ctas`][0].metadata,
              ctaBody: 'Line one,\nline two',
            },
          },
        ];
      }
      return readyRows[docId as keyof typeof readyRows] ?? [];
    });

    const objectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:final-pages');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<FinalPagesPanel activeProjectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('final-pages-export')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('final-pages-export'));

    expect(objectUrlSpy).toHaveBeenCalledTimes(1);
    const blob = objectUrlSpy.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain('#,Title,Meta Title,Meta Description');
    expect(csv).toContain('"Meta ""description"", text"');
    expect(csv).toContain('"Line one,\nline two"');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:final-pages');
  });

  it('renders a load error state when final pages cannot be loaded', async () => {
    testState.mockLoadChunkedAppSettingsRows.mockRejectedValueOnce(new Error('load failed'));

    render(<FinalPagesPanel activeProjectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Final Pages unavailable')).toBeTruthy();
    });
    expect(screen.getByText('load failed')).toBeTruthy();
  });

  it('renders the empty state cleanly when there are no rows', async () => {
    testState.mockLoadChunkedAppSettingsRows.mockResolvedValue([]);

    render(<FinalPagesPanel activeProjectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('No active page rows found yet. Generate page names first to populate this table.')).toBeTruthy();
    });

    expect(screen.queryByText('Ready')).toBeNull();
  });
});
