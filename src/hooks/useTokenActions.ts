import { useCallback } from 'react';
import type { GroupDataTab } from './useKeywordWorkspace';
import { isAcceptedSharedMutation, type SharedMutationResult } from '../sharedMutation';

type ToastKind = 'info' | 'warning' | 'success' | 'error';
type LogAndToast = (action: any, details: string, affectedRows: number, toastMsg: string, toastType: ToastKind) => void;

export interface UseTokenActionsInput {
  logAndToast: LogAndToast;
  setSelectedMgmtTokens: (next: Set<string>) => void;
  setTokenMgmtSubTab: (tab: 'current' | 'all' | 'merge' | 'auto-merge' | 'blocked') => void;
  setTokenMgmtPage: (page: number) => void;
  /** After unblock, land on Pages (Ungrouped) so tokens are visible in the right scope. */
  switchTab: (tab: GroupDataTab) => void;
  blockTokens: (tokens: string[]) => Promise<SharedMutationResult>;
  unblockTokens: (tokens: string[]) => Promise<SharedMutationResult>;
}

export function useTokenActions(input: UseTokenActionsInput) {
  const {
    logAndToast,
    setSelectedMgmtTokens,
    setTokenMgmtSubTab,
    setTokenMgmtPage,
    switchTab,
    blockTokens,
    unblockTokens,
  } = input;

  const handleBlockSingleToken = useCallback(async (token: string) => {
    const result = await blockTokens([token]);
    if (!isAcceptedSharedMutation(result)) return;
    logAndToast('block', `Blocked: ${token}`, 1, `Blocked token: ${token}`, 'error');
  }, [blockTokens, logAndToast]);

  const handleBlockTokens = useCallback(async (tokens: string[]) => {
    if (tokens.length === 0) return;
    const result = await blockTokens(tokens);
    if (!isAcceptedSharedMutation(result)) return;
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('blocked');
    setTokenMgmtPage(1);
    logAndToast(
      'block',
      `Blocked: ${tokens.join(', ')}`,
      tokens.length,
      `Blocked ${tokens.length} token${tokens.length > 1 ? 's' : ''}: ${tokens.slice(0, 3).join(', ')}${tokens.length > 3 ? '...' : ''}`,
      'error',
    );
  }, [blockTokens, logAndToast, setSelectedMgmtTokens, setTokenMgmtPage, setTokenMgmtSubTab]);

  const handleUnblockTokens = useCallback(async (tokens: string[]) => {
    if (tokens.length === 0) return;
    const result = await unblockTokens(tokens);
    if (!isAcceptedSharedMutation(result)) return;
    setSelectedMgmtTokens(new Set());
    setTokenMgmtSubTab('current');
    setTokenMgmtPage(1);
    switchTab('pages');
    logAndToast(
      'unblock',
      `Unblocked: ${tokens.join(', ')}`,
      tokens.length,
      `Unblocked ${tokens.length} token${tokens.length > 1 ? 's' : ''}: ${tokens.slice(0, 3).join(', ')}`,
      'success',
    );
  }, [logAndToast, setSelectedMgmtTokens, setTokenMgmtPage, setTokenMgmtSubTab, switchTab, unblockTokens]);

  return {
    handleBlockSingleToken,
    handleBlockTokens,
    handleUnblockTokens,
  };
}
