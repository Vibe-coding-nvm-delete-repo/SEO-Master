import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppStatusBar, { formatStatusBarNow } from './AppStatusBar';
import {
  CLOUD_SYNC_CHANNELS,
  markListenerError,
  markListenerSnapshot,
  recordProjectCloudWriteStart,
  recordProjectFirestoreSaveOk,
  recordSharedCloudWriteStart,
  recordSharedCloudWriteOk,
  resetCloudSyncStateForTests,
} from './cloudSyncStatus';

vi.mock('./changelogStorage', () => ({
  subscribeBuildName: (onName: (name: string) => void) => {
    onName('Build test');
    return () => {};
  },
  subscribeChangelog: (onEntries: (entries: unknown[]) => void) => {
    onEntries([]);
    return () => {};
  },
}));

describe('AppStatusBar', () => {
  const flushCloud = async (action: () => void) => {
    await act(async () => {
      action();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    resetCloudSyncStateForTests();
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    cleanup();
    resetCloudSyncStateForTests();
  });

  it('returns date and two time lines with Eastern label', () => {
    const labels = formatStatusBarNow(new Date('2025-06-15T17:30:45.000Z'));
    expect(labels.dateLabel.length).toBeGreaterThan(5);
    expect(labels.localLine).toMatch(/^Local:/);
    expect(labels.localLine).toMatch(/\d/);
    expect(labels.easternLine).toMatch(/^US Eastern \(EST\/EDT\):/);
  });

  it('updates the open tooltip when auxiliary diagnostics change without changing the project-first headline', async () => {
    await flushCloud(() => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, { metadata: { fromCache: false } });
    });

    render(<AppStatusBar activeProjectId="proj_1" />);

    expect(screen.getByText('Cloud: synced')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('cloud-status-chip'));
    });
    expect(await screen.findByText('No auxiliary listener errors')).toBeTruthy();

    await flushCloud(() => {
      markListenerError(CLOUD_SYNC_CHANNELS.notifications);
    });

    await waitFor(() => {
      expect(screen.getByText(/1 error\(s\): Notifications/)).toBeTruthy();
    });
    expect(screen.getByTestId('cloud-status-chip').textContent).toContain('Cloud: synced');
  });

  it('renders the tooltip from the same current snapshot as the chip and shows split project/shared sync rows', async () => {
    await flushCloud(() => {
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.projectChunks, { metadata: { fromCache: false } });
      markListenerSnapshot(CLOUD_SYNC_CHANNELS.projects, { metadata: { fromCache: false } });
      recordProjectCloudWriteStart();
      recordProjectFirestoreSaveOk();
      recordSharedCloudWriteStart();
      recordSharedCloudWriteOk();
    });

    render(<AppStatusBar activeProjectId="proj_1" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('cloud-status-chip'));
    });

    expect(await screen.findByText('This tab only — the headline prioritizes the open project when one is selected.')).toBeTruthy();
    expect(screen.getByText('Last project cloud sync')).toBeTruthy();
    expect(screen.getByText('Last shared-doc sync')).toBeTruthy();

    await flushCloud(() => {
      markListenerError(CLOUD_SYNC_CHANNELS.projectChunks);
    });

    await waitFor(() => {
      expect(screen.getAllByText('Project sync problem — check status').length).toBeGreaterThan(0);
    });
  });
});
