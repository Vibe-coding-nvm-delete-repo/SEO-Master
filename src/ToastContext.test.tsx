import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './ToastContext';

const notificationMocks = vi.hoisted(() => ({
  addNotificationEntry: vi.fn(() => Promise.resolve('notif-1')),
}));

vi.mock('./notificationStorage', async () => {
  const actual = await vi.importActual<typeof import('./notificationStorage')>('./notificationStorage');
  return {
    ...actual,
    addNotificationEntry: notificationMocks.addNotificationEntry,
  };
});

function Harness() {
  const { addToast } = useToast();
  return (
    <div>
      <button
        onClick={() => addToast('Shared error', 'error', {
          notification: {
            mode: 'shared',
            source: 'generate',
            copyText: 'Shared error details',
            projectId: 'proj-1',
            projectName: 'Loan Pages',
          },
        })}
      >
        Shared
      </button>
      <button
        onClick={() => addToast('Local success', 'success', {
          notification: {
            mode: 'local',
            source: 'feedback',
          },
        })}
      >
        Local
      </button>
    </div>
  );
}

describe('ToastContext notification persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists shared notifications with metadata', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Shared'));

    expect(notificationMocks.addNotificationEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        source: 'generate',
        message: 'Shared error',
        copyText: 'Shared error details',
        projectId: 'proj-1',
        projectName: 'Loan Pages',
      }),
    );
  });

  it('does not persist local-only notifications', () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Local'));

    expect(notificationMocks.addNotificationEntry).not.toHaveBeenCalled();
  });
});
