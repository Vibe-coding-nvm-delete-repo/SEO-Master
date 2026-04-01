/**
 * Pure helpers for Pages-tab filtered Auto Group (Shift+1) enablement and prompt scope.
 */

/** Sentinel when no search/tokens/geo/column filters are applied — still a valid full-list run. */
export const FILTERED_AUTO_GROUP_NO_EXTRA_FILTERS_SENTINEL = 'No additional filters active';

/** User-facing / LLM "Current filters" line when the table has no extra narrowing beyond ungrouped scope. */
export const FILTERED_AUTO_GROUP_SCOPE_ALL_VISIBLE =
  'Scope: all visible ungrouped pages in the current table (no extra search, token, geographic, or column-range filters).';

export function effectiveFilterSummaryForPrompt(internalSummary: string): string {
  if (internalSummary === FILTERED_AUTO_GROUP_NO_EXTRA_FILTERS_SENTINEL) {
    return FILTERED_AUTO_GROUP_SCOPE_ALL_VISIBLE;
  }
  return internalSummary;
}

export function computeCanRunFilteredAutoGroup(params: {
  isBulkSharedEditBlocked: boolean;
  filteredClusterCount: number;
  groupReviewSettingsHydrated: boolean;
  settingsMissing: string[];
}): boolean {
  return (
    !params.isBulkSharedEditBlocked &&
    params.filteredClusterCount >= 1 &&
    params.groupReviewSettingsHydrated &&
    params.settingsMissing.length === 0
  );
}

/** Non-null when Auto Group should be disabled; use for button title / tooltips. */
export function filteredAutoGroupDisabledReason(params: {
  isBulkSharedEditBlocked: boolean;
  filteredClusterCount: number;
  groupReviewSettingsHydrated: boolean;
  settingsMissing: string[];
}): string | null {
  if (params.isBulkSharedEditBlocked) {
    return 'Shared project is read-only, write-unsafe, or busy with another operation. Wait until grouping is available.';
  }
  if (params.filteredClusterCount < 1) {
    return 'No ungrouped pages in the current view. Adjust filters or add data.';
  }
  if (!params.groupReviewSettingsHydrated) {
    return 'Group Review settings are still loading. Try again in a moment.';
  }
  if (params.settingsMissing.length > 0) {
    return `Open Group Review settings and configure: ${params.settingsMissing.join(', ')}.`;
  }
  return null;
}
