import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationState } from './hooks/useNavigationState';
import { APP_BASE_PATH } from './appRouting';
import { buildContentHistoryState } from './contentSubtabRouting';

function setPath(pathname: string): void {
  window.history.replaceState({}, '', pathname);
}

describe('useNavigationState main tab routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setPath(`${APP_BASE_PATH}/group/projects`);
  });

  it('navigates content to its own content URL', () => {
    const activeProjectIdRef = { current: null };
    const projectsRef = { current: [] };
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    const { result } = renderHook(() => useNavigationState({ activeProjectIdRef, projectsRef }));

    act(() => {
      result.current.navigateMainTab('content');
    });

    expect(result.current.mainTab).toBe('content');
    expect(window.location.pathname).toBe(`${APP_BASE_PATH}/content`);
    expect(pushStateSpy).toHaveBeenCalledWith({ kwgMainTab: 'content' }, '', `${APP_BASE_PATH}/content`);
  });

  it('preserves the last known content route when returning to content', () => {
    const activeProjectIdRef = { current: null };
    const projectsRef = { current: [] };
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    window.history.replaceState(
      buildContentHistoryState({ subtab: 'h2-qa', panel: 'log' }, { kwgMainTab: 'generate' }),
      '',
      `${APP_BASE_PATH}/generate`,
    );

    const { result } = renderHook(() => useNavigationState({ activeProjectIdRef, projectsRef }));

    act(() => {
      result.current.navigateMainTab('content');
    });

    expect(window.location.pathname + window.location.search).toBe(`${APP_BASE_PATH}/content?subtab=h2-qa&panel=log`);
    expect(pushStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kwgContentSubtab: 'h2-qa', kwgContentPanel: 'log', kwgMainTab: 'content' }),
      '',
      `${APP_BASE_PATH}/content?subtab=h2-qa&panel=log`,
    );
  });

  it('navigates updates to its own updates URL', () => {
    const activeProjectIdRef = { current: null };
    const projectsRef = { current: [] };
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    const { result } = renderHook(() => useNavigationState({ activeProjectIdRef, projectsRef }));

    act(() => {
      result.current.navigateMainTab('updates');
    });

    expect(result.current.mainTab).toBe('updates');
    expect(window.location.pathname).toBe(`${APP_BASE_PATH}/updates`);
    expect(pushStateSpy).toHaveBeenCalledWith({ kwgMainTab: 'updates' }, '', `${APP_BASE_PATH}/updates`);
  });

  it('navigates notifications to its own notifications URL', () => {
    const activeProjectIdRef = { current: null };
    const projectsRef = { current: [] };
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    const { result } = renderHook(() => useNavigationState({ activeProjectIdRef, projectsRef }));

    act(() => {
      result.current.navigateMainTab('notifications');
    });

    expect(result.current.mainTab).toBe('notifications');
    expect(window.location.pathname).toBe(`${APP_BASE_PATH}/notifications`);
    expect(pushStateSpy).toHaveBeenCalledWith({ kwgMainTab: 'notifications' }, '', `${APP_BASE_PATH}/notifications`);
  });
});
