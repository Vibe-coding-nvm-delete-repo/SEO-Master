import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGlobalGroupingShortcuts } from './useGlobalGroupingShortcuts';

function dispatchKeyDown(init: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('useGlobalGroupingShortcuts', () => {
  it('does not treat bare Shift as a manual grouping action and keeps Shift+1 on Pages for Auto Group', () => {
    const handleGroupClusters = vi.fn();
    const approveSelectedGrouped = vi.fn();
    const handleRunFilteredAutoGroup = vi.fn();
    const handleRunTokenAutoMerge = vi.fn();

    renderHook(() =>
      useGlobalGroupingShortcuts({
        activeTab: 'pages',
        tokenMgmtSubTab: 'current',
        canRunManualGroup: true,
        canApproveGrouped: false,
        canRunFilteredAutoGroup: true,
        canRunTokenAutoMerge: false,
        handleGroupClusters,
        approveSelectedGrouped,
        handleRunFilteredAutoGroup,
        handleRunTokenAutoMerge,
      }),
    );

    act(() => {
      dispatchKeyDown({ key: 'Shift', code: 'ShiftLeft' });
    });
    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(approveSelectedGrouped).not.toHaveBeenCalled();

    act(() => {
      dispatchKeyDown({ key: '1', code: 'Digit1', shiftKey: true });
    });
    expect(handleRunFilteredAutoGroup).toHaveBeenCalledTimes(1);
    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(handleRunTokenAutoMerge).not.toHaveBeenCalled();
  });

  it('routes Shift+1 to token auto merge when the auto-merge token view is active outside Pages', () => {
    const handleGroupClusters = vi.fn();
    const approveSelectedGrouped = vi.fn();
    const handleRunFilteredAutoGroup = vi.fn();
    const handleRunTokenAutoMerge = vi.fn();

    renderHook(() =>
      useGlobalGroupingShortcuts({
        activeTab: 'keywords',
        tokenMgmtSubTab: 'auto-merge',
        canRunManualGroup: false,
        canApproveGrouped: false,
        canRunFilteredAutoGroup: false,
        canRunTokenAutoMerge: true,
        handleGroupClusters,
        approveSelectedGrouped,
        handleRunFilteredAutoGroup,
        handleRunTokenAutoMerge,
      }),
    );

    act(() => {
      dispatchKeyDown({ key: '1', code: 'Digit1', shiftKey: true });
    });

    expect(handleRunTokenAutoMerge).toHaveBeenCalledTimes(1);
    expect(handleRunFilteredAutoGroup).not.toHaveBeenCalled();
    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(approveSelectedGrouped).not.toHaveBeenCalled();
  });
});
