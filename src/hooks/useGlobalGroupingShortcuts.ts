import { useEffect } from 'react';

interface UseGlobalGroupingShortcutsParams {
  activeTab: string;
  tokenMgmtSubTab: string;
  canRunManualGroup: boolean;
  canApproveGrouped: boolean;
  canRunFilteredAutoGroup: boolean;
  canRunTokenAutoMerge: boolean;
  handleGroupClusters: () => void;
  approveSelectedGrouped: () => void;
  handleRunFilteredAutoGroup: () => void;
  handleRunTokenAutoMerge: () => void;
}

export function useGlobalGroupingShortcuts({
  activeTab,
  tokenMgmtSubTab,
  canRunManualGroup,
  canApproveGrouped,
  canRunFilteredAutoGroup,
  canRunTokenAutoMerge,
  handleGroupClusters,
  approveSelectedGrouped,
  handleRunFilteredAutoGroup,
  handleRunTokenAutoMerge,
}: UseGlobalGroupingShortcutsParams) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (event.shiftKey && event.code === 'Digit1') {
        if (
          !isTypingTarget &&
          tokenMgmtSubTab === 'auto-merge' &&
          activeTab !== 'pages' &&
          activeTab !== 'group-auto-merge' &&
          canRunTokenAutoMerge
        ) {
          event.preventDefault();
          event.stopPropagation();
          handleRunTokenAutoMerge();
          return;
        }

        if (activeTab === 'pages' && !isTypingTarget && canRunFilteredAutoGroup) {
          event.preventDefault();
          event.stopPropagation();
          handleRunFilteredAutoGroup();
          return;
        }
      }

      if (event.key === 'Tab') {
        if (activeTab === 'pages' && canRunManualGroup) {
          event.preventDefault();
          event.stopPropagation();
          handleGroupClusters();
          return;
        }
        if (activeTab === 'grouped' && canApproveGrouped) {
          event.preventDefault();
          event.stopPropagation();
          approveSelectedGrouped();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [
    activeTab,
    approveSelectedGrouped,
    canApproveGrouped,
    canRunFilteredAutoGroup,
    canRunManualGroup,
    canRunTokenAutoMerge,
    handleGroupClusters,
    handleRunFilteredAutoGroup,
    handleRunTokenAutoMerge,
    tokenMgmtSubTab,
  ]);
}
