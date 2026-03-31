import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTokenActions } from './useTokenActions';
import { SHARED_MUTATION_ACCEPTED } from '../sharedMutation';

describe('useTokenActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleUnblockTokens switches to Ungrouped (pages) and Current token sub-tab', async () => {
    const logAndToast = vi.fn();
    const setSelectedMgmtTokens = vi.fn();
    const setTokenMgmtSubTab = vi.fn();
    const setTokenMgmtPage = vi.fn();
    const switchTab = vi.fn();
    const blockTokens = vi.fn(async () => SHARED_MUTATION_ACCEPTED);
    const unblockTokens = vi.fn(async () => SHARED_MUTATION_ACCEPTED);

    const { result } = renderHook(() =>
      useTokenActions({
        logAndToast,
        setSelectedMgmtTokens,
        setTokenMgmtSubTab,
        setTokenMgmtPage,
        switchTab,
        blockTokens,
        unblockTokens,
      }),
    );

    await act(async () => {
      await result.current.handleUnblockTokens(['foo']);
    });

    expect(unblockTokens).toHaveBeenCalledWith(['foo']);
    expect(setSelectedMgmtTokens).toHaveBeenCalledWith(new Set());
    expect(setTokenMgmtSubTab).toHaveBeenCalledWith('current');
    expect(setTokenMgmtPage).toHaveBeenCalledWith(1);
    expect(switchTab).toHaveBeenCalledWith('pages');
    expect(logAndToast).toHaveBeenCalled();
  });

  it('handleUnblockTokens no-ops on empty list', async () => {
    const switchTab = vi.fn();
    const unblockTokens = vi.fn();

    const { result } = renderHook(() =>
      useTokenActions({
        logAndToast: vi.fn(),
        setSelectedMgmtTokens: vi.fn(),
        setTokenMgmtSubTab: vi.fn(),
        setTokenMgmtPage: vi.fn(),
        switchTab,
        blockTokens: vi.fn(async () => SHARED_MUTATION_ACCEPTED),
        unblockTokens,
      }),
    );

    await act(async () => {
      await result.current.handleUnblockTokens([]);
    });

    expect(unblockTokens).not.toHaveBeenCalled();
    expect(switchTab).not.toHaveBeenCalled();
  });
});
