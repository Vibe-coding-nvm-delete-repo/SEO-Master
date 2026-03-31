import { useEffect } from 'react';

interface UseGlobalGroupingShortcutsParams {
  activeTab: string;
  canRunManualGroup: boolean;
  canApproveGrouped: boolean;
  canRunFilteredAutoGroup: boolean;
  handleGroupClusters: () => void;
  approveSelectedGrouped: () => void;
  handleRunFilteredAutoGroup: () => void;
}

export function useGlobalGroupingShortcuts({
  activeTab,
  canRunManualGroup,
  canApproveGrouped,
  canRunFilteredAutoGroup,
  handleGroupClusters,
  approveSelectedGrouped,
  handleRunFilteredAutoGroup,
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
        if (activeTab === 'pages' && !isTypingTarget && canRunFilteredAutoGroup) {
          event.preventDefault();
          event.stopPropagation();
          handleRunFilteredAutoGroup();
          return;
        }
      }

      if (event.key === 'Tab' || event.key === 'Shift') {
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
    handleGroupClusters,
    handleRunFilteredAutoGroup,
  ]);
}
