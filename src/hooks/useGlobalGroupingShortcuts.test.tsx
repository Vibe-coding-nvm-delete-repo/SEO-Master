import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { groupingShortcutTargetProps } from '../groupingShortcutTargets';
import { useGlobalGroupingShortcuts } from './useGlobalGroupingShortcuts';

function dispatchKeyDown(init: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function dispatchKeyDownOnTarget(target: HTMLElement, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
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

  it('still runs Pages Shift+1 while an opted-in filter input is focused', () => {
    const handleGroupClusters = vi.fn();
    const approveSelectedGrouped = vi.fn();
    const handleRunFilteredAutoGroup = vi.fn();
    const handleRunTokenAutoMerge = vi.fn();
    const input = document.createElement('input');
    Object.entries(groupingShortcutTargetProps).forEach(([key, value]) => input.setAttribute(key, value));
    document.body.appendChild(input);

    renderHook(() =>
      useGlobalGroupingShortcuts({
        activeTab: 'pages',
        tokenMgmtSubTab: 'current',
        canRunManualGroup: false,
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
      input.focus();
      dispatchKeyDownOnTarget(input, { key: '1', code: 'Digit1', shiftKey: true });
    });

    expect(handleRunFilteredAutoGroup).toHaveBeenCalledTimes(1);
    expect(handleRunTokenAutoMerge).not.toHaveBeenCalled();
    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(approveSelectedGrouped).not.toHaveBeenCalled();

    input.remove();
  });

  it('still runs token auto merge Shift+1 while an opted-in filter control is focused', () => {
    const handleGroupClusters = vi.fn();
    const approveSelectedGrouped = vi.fn();
    const handleRunFilteredAutoGroup = vi.fn();
    const handleRunTokenAutoMerge = vi.fn();
    const select = document.createElement('select');
    Object.entries(groupingShortcutTargetProps).forEach(([key, value]) => select.setAttribute(key, value));
    document.body.appendChild(select);

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
      select.focus();
      dispatchKeyDownOnTarget(select, { key: '1', code: 'Digit1', shiftKey: true });
    });

    expect(handleRunTokenAutoMerge).toHaveBeenCalledTimes(1);
    expect(handleRunFilteredAutoGroup).not.toHaveBeenCalled();
    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(approveSelectedGrouped).not.toHaveBeenCalled();

    select.remove();
  });

  it('does not hijack Tab navigation from editable targets', () => {
    const handleGroupClusters = vi.fn();
    const approveSelectedGrouped = vi.fn();
    const handleRunFilteredAutoGroup = vi.fn();
    const handleRunTokenAutoMerge = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);

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
      input.focus();
      dispatchKeyDownOnTarget(input, { key: 'Tab', code: 'Tab' });
    });

    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(approveSelectedGrouped).not.toHaveBeenCalled();
    expect(handleRunFilteredAutoGroup).not.toHaveBeenCalled();
    expect(handleRunTokenAutoMerge).not.toHaveBeenCalled();

    input.remove();
  });

  it('keeps Shift+1 blocked for multiline editing targets', () => {
    const handleGroupClusters = vi.fn();
    const approveSelectedGrouped = vi.fn();
    const handleRunFilteredAutoGroup = vi.fn();
    const handleRunTokenAutoMerge = vi.fn();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    renderHook(() =>
      useGlobalGroupingShortcuts({
        activeTab: 'pages',
        tokenMgmtSubTab: 'current',
        canRunManualGroup: false,
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
      textarea.focus();
      dispatchKeyDownOnTarget(textarea, { key: '1', code: 'Digit1', shiftKey: true });
    });

    expect(handleRunFilteredAutoGroup).not.toHaveBeenCalled();
    expect(handleRunTokenAutoMerge).not.toHaveBeenCalled();
    expect(handleGroupClusters).not.toHaveBeenCalled();
    expect(approveSelectedGrouped).not.toHaveBeenCalled();

    textarea.remove();
  });
});
