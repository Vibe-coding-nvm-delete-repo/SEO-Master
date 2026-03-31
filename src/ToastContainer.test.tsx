import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToastContainer, { formatToastTimeLabels } from './ToastContainer';
import { AUTO_DISMISS_MS, TOAST_EXIT_MS, ToastProvider, useToast } from './ToastContext';

function Harness() {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast('Cloud sync failed (generate rows) [invalid-argument]. Firestore rejected the data payload.', 'error')}>
        Add error
      </button>
      <button
        onClick={() => {
          addToast('Local save failed (generate rows) [persist-timeout]. Refresh may lose your latest changes.', 'error');
          addToast('Local save failed (generate rows) [persist-timeout]. Refresh may lose your latest changes.', 'error');
          addToast('Local save failed (generate rows) [persist-timeout]. Refresh may lose your latest changes.', 'error');
        }}
      >
        Add burst
      </button>
    </div>
  );
}

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders local and eastern timestamps for each toast', () => {
    const labels = formatToastTimeLabels(new Date('2026-03-30T03:17:13.000Z').getTime());
    expect(labels.localLabel).toMatch(/^Local \| /);
    expect(labels.easternLabel).toMatch(/^US Eastern \| /);
  });

  it('dedupes repeated identical notifications and shows the repeat count', () => {
    render(
      <ToastProvider>
        <ToastContainer />
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add error'));
    fireEvent.click(screen.getByText('Add error'));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('x2')).toBeTruthy();
    expect(screen.getByText(/Local \| /)).toBeTruthy();
    expect(screen.getByText(/US Eastern \| /)).toBeTruthy();
  });

  it('dedupes identical toasts fired back-to-back in the same tick', () => {
    render(
      <ToastProvider>
        <ToastContainer />
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add burst'));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('x3')).toBeTruthy();
  });

  it('marks toasts exiting before removing them after the longer dwell time', () => {
    render(
      <ToastProvider>
        <ToastContainer />
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText('Add error'));
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-state')).toBe('visible');

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS);
    });
    expect(screen.getByRole('alert').getAttribute('data-state')).toBe('exiting');

    act(() => {
      vi.advanceTimersByTime(TOAST_EXIT_MS);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
