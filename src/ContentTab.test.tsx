import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContentTab from './ContentTab';
import { APP_BASE_PATH } from './appRouting';
import { buildContentHistoryState } from './contentSubtabRouting';

vi.mock('./GenerateTab', () => ({
  GenerateTabInstance: (props: Record<string, unknown>) => {
    const storageKey = String(props.storageKey ?? 'default');
    return (
      <div data-testid={`generate-instance-${storageKey}`}>
        <div data-testid={`generate-state-${storageKey}`}>
          {JSON.stringify({
            activeExternalView: props.activeExternalView ?? null,
            controlledTableView: props.controlledTableView ?? null,
            controlledGenSubTab: props.controlledGenSubTab ?? null,
            runtimeEffectsActive: props.runtimeEffectsActive ?? null,
          })}
        </div>
        {typeof props.onTableViewChange === 'function' && (
          <>
            <button type="button" data-testid={`table-h2qa-${storageKey}`} onClick={() => (props.onTableViewChange as (view: string) => void)('h2qa')}>
              H2 QA
            </button>
            <button type="button" data-testid={`table-primary-${storageKey}`} onClick={() => (props.onTableViewChange as (view: string) => void)('primary')}>
              Pages
            </button>
          </>
        )}
        {typeof props.onExternalViewSelect === 'function' && (
          <>
            <button type="button" data-testid={`external-h2-html-${storageKey}`} onClick={() => (props.onExternalViewSelect as (id: string) => void)('h2-html')}>
              H2 HTML
            </button>
            <button type="button" data-testid={`external-tips-${storageKey}`} onClick={() => (props.onExternalViewSelect as (id: string) => void)('tips-redflags')}>
              Tips
            </button>
          </>
        )}
        {typeof props.onGenSubTabChange === 'function' && (
          <>
            <button type="button" data-testid={`panel-log-${storageKey}`} onClick={() => (props.onGenSubTabChange as (tab: 'table' | 'log') => void)('log')}>
              Log
            </button>
            <button type="button" data-testid={`panel-table-${storageKey}`} onClick={() => (props.onGenSubTabChange as (tab: 'table' | 'log') => void)('table')}>
              Table
            </button>
          </>
        )}
        {typeof props.onBusyStateChange === 'function' && (
          <>
            <button type="button" data-testid={`mock-busy-on-${storageKey}`} onClick={() => (props.onBusyStateChange as (b: boolean) => void)(true)}>
              Busy on
            </button>
            <button type="button" data-testid={`mock-busy-off-${storageKey}`} onClick={() => (props.onBusyStateChange as (b: boolean) => void)(false)}>
              Busy off
            </button>
          </>
        )}
      </div>
    );
  },
}));

vi.mock('./ContentOverviewPanel', () => ({
  default: ({ onStageSelect }: { onStageSelect?: (stageId: string) => void }) => (
    <div data-testid="mock-content-overview">
      <button type="button" data-testid="overview-stage-h2-html" onClick={() => onStageSelect?.('h2-html')}>
        Go H2 HTML
      </button>
    </div>
  ),
}));

vi.mock('./FinalPagesPanel', () => ({
  default: ({ onSourceSelect }: { onSourceSelect?: (subtab: string) => void }) => (
    <div data-testid="mock-final-pages">
      <button type="button" data-testid="final-source-metas" onClick={() => onSourceSelect?.('metas-slug-ctas')}>
        Go Metas
      </button>
    </div>
  ),
}));

vi.mock('./ToastContext', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

vi.mock('./appSettingsPersistence', () => ({
  appSettingsIdbKey: (docId: string) => `__app_settings__:${docId}`,
  loadAppSettingsDoc: vi.fn(async () => null),
  loadAppSettingsRows: vi.fn(async () => []),
  subscribeAppSettingsDoc: vi.fn(() => () => undefined),
}));

vi.mock('./generateWorkspaceScope', () => ({
  ensureProjectGenerateWorkspace: vi.fn(async () => undefined),
  resolveGenerateScopedDocIds: (_projectId: string | null, docIds: Record<string, string>) => docIds,
}));

function setContentPath(search = ''): void {
  window.history.replaceState({}, '', `${APP_BASE_PATH}/content${search}`);
}

async function readPageShellState() {
  const stateNode = await screen.findByTestId('generate-state-_page_names');
  return JSON.parse(stateNode.textContent ?? '{}') as {
    activeExternalView: string | null;
    controlledTableView: string | null;
    controlledGenSubTab: 'table' | 'log' | null;
    runtimeEffectsActive: boolean | null;
  };
}

async function readGenerateState(storageKey: string) {
  const stateNode = await screen.findByTestId(`generate-state-${storageKey}`);
  return JSON.parse(stateNode.textContent ?? '{}') as {
    runtimeEffectsActive: boolean | null;
  };
}

describe('ContentTab', () => {
  beforeEach(() => {
    setContentPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { subtab: 'overview', panel: 'table', externalView: 'overview', tableView: 'primary' },
    { subtab: 'pages', panel: 'table', externalView: null, tableView: 'primary' },
    { subtab: 'h2s', panel: 'table', externalView: null, tableView: 'h2names' },
    { subtab: 'h2-qa', panel: 'log', externalView: null, tableView: 'h2qa' },
    { subtab: 'page-guide', panel: 'table', externalView: null, tableView: 'guidelines' },
    { subtab: 'h2-body', panel: 'table', externalView: 'h2-content', tableView: 'primary' },
    { subtab: 'h2-rate', panel: 'table', externalView: 'rating', tableView: 'primary' },
    { subtab: 'h2-body-html', panel: 'table', externalView: 'h2-html', tableView: 'primary' },
    { subtab: 'h2-summ', panel: 'table', externalView: 'h2-summary', tableView: 'primary' },
    { subtab: 'h1-body', panel: 'table', externalView: 'h1-body', tableView: 'primary' },
    { subtab: 'h1-body-html', panel: 'table', externalView: 'h1-html', tableView: 'primary' },
    { subtab: 'quick-answer', panel: 'table', externalView: 'quick-answer', tableView: 'primary' },
    { subtab: 'quick-answer-html', panel: 'table', externalView: 'quick-answer-html', tableView: 'primary' },
    { subtab: 'metas-slug-ctas', panel: 'table', externalView: 'metas-slug-ctas', tableView: 'primary' },
    { subtab: 'tips-redflags', panel: 'table', externalView: 'tips-redflags', tableView: 'primary' },
    { subtab: 'final-pages', panel: 'table', externalView: 'final-pages', tableView: 'primary' },
  ])('deep links %s into the expected routed content state', async ({ subtab, panel, externalView, tableView }) => {
    setContentPath(`?subtab=${subtab}${panel === 'log' ? '&panel=log' : ''}`);

    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} />);

    await expect(readPageShellState()).resolves.toMatchObject({
      activeExternalView: externalView,
      controlledTableView: tableView,
      controlledGenSubTab: panel,
    });
  });

  it('aggregates per-instance busy into a single parent onBusyStateChange', async () => {
    setContentPath('?subtab=pages');
    const onBusy = vi.fn();
    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} onBusyStateChange={onBusy} />);

    fireEvent.click(await screen.findByTestId('mock-busy-on-_page_names'));
    await waitFor(() => {
      expect(onBusy).toHaveBeenCalledWith(true);
    });

    fireEvent.click(screen.getByTestId('mock-busy-off-_page_names'));
    await waitFor(() => {
      expect(onBusy).toHaveBeenLastCalledWith(false);
    });

    expect(onBusy.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('activates only the visible or busy content stages while hidden', async () => {
    setContentPath('?subtab=pages');

    render(
      <ContentTab
        activeProjectId="proj-1"
        isVisible={false}
        runtimeEffectsActive
        starredModels={new Set()}
        onToggleStar={() => undefined}
      />,
    );

    await expect(readGenerateState('_page_names')).resolves.toMatchObject({
      runtimeEffectsActive: false,
    });
    await expect(readGenerateState('_h2_content')).resolves.toMatchObject({
      runtimeEffectsActive: false,
    });

    fireEvent.click(await screen.findByTestId('mock-busy-on-_h2_content'));

    await waitFor(async () => {
      expect(await readGenerateState('_page_names')).toMatchObject({
        runtimeEffectsActive: false,
      });
      expect(await readGenerateState('_h2_content')).toMatchObject({
        runtimeEffectsActive: true,
      });
    });
  });

  it('round-trips panel=log through the shared content route state', async () => {
    setContentPath('?subtab=h2-qa');

    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} />);

    fireEvent.click(await screen.findByTestId('panel-log-_page_names'));
    await waitFor(() => {
      expect(window.location.search).toBe('?subtab=h2-qa&panel=log');
    });
    expect((await readPageShellState()).controlledGenSubTab).toBe('log');

    fireEvent.click(await screen.findByTestId('panel-table-_page_names'));
    await waitFor(() => {
      expect(window.location.search).toBe('?subtab=h2-qa');
    });
    expect((await readPageShellState()).controlledGenSubTab).toBe('table');
  });

  it('uses overview stage navigation to update the route and reset panel=table', async () => {
    setContentPath('?subtab=overview&panel=log');

    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} />);

    fireEvent.click(await screen.findByTestId('overview-stage-h2-html'));

    await waitFor(() => {
      expect(window.location.search).toBe('?subtab=h2-body-html');
    });
    expect(await readPageShellState()).toMatchObject({
      activeExternalView: 'h2-html',
      controlledGenSubTab: 'table',
    });
  });

  it('uses final-pages source navigation to update the route and reset panel=table', async () => {
    setContentPath('?subtab=final-pages&panel=log');

    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} />);

    fireEvent.click(await screen.findByTestId('final-source-metas'));

    await waitFor(() => {
      expect(window.location.search).toBe('?subtab=metas-slug-ctas');
    });
    expect(await readPageShellState()).toMatchObject({
      activeExternalView: 'metas-slug-ctas',
      controlledGenSubTab: 'table',
    });
  });

  it('keeps source jumps on panel=table when shell navigation changes the visible stage', async () => {
    setContentPath('?subtab=h2-qa&panel=log');

    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} />);

    fireEvent.click(await screen.findByTestId('external-tips-_page_names'));
    await waitFor(() => {
      expect(window.location.search).toBe('?subtab=tips-redflags');
    });
    expect(await readPageShellState()).toMatchObject({
      activeExternalView: 'tips-redflags',
      controlledGenSubTab: 'table',
    });
  });

  it('responds to popstate and reconciles the visible content stage from the URL', async () => {
    setContentPath('?subtab=pages');

    render(<ContentTab activeProjectId="proj-1" starredModels={new Set()} onToggleStar={() => undefined} />);

    act(() => {
      const nextUrl = `${APP_BASE_PATH}/content?subtab=h2-qa&panel=log`;
      window.history.pushState(
        buildContentHistoryState({ subtab: 'h2-qa', panel: 'log' }, window.history.state),
        '',
        nextUrl,
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(async () => {
      expect(await readPageShellState()).toMatchObject({
        activeExternalView: null,
        controlledTableView: 'h2qa',
        controlledGenSubTab: 'log',
      });
    });

    act(() => {
      const nextUrl = `${APP_BASE_PATH}/content?subtab=quick-answer-html`;
      window.history.pushState(
        buildContentHistoryState({ subtab: 'quick-answer-html', panel: 'table' }, window.history.state),
        '',
        nextUrl,
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(async () => {
      expect(await readPageShellState()).toMatchObject({
        activeExternalView: 'quick-answer-html',
        controlledTableView: 'primary',
        controlledGenSubTab: 'table',
      });
    });
  });
});
