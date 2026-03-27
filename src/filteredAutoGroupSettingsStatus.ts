import type { GroupReviewSettingsData } from './GroupReviewSettings';

/** Tooltip / title when Group Review settings are present and Auto Group can use them */
export const FILTERED_AUTO_GROUP_SETTINGS_OK_SUMMARY =
  'Same as Group Review: API key, model, temperature, max tokens, reasoning, Auto-Group prompt.';

export interface FilteredAutoGroupSettingsStatus {
  missing: string[];
  requiresLocalKey: boolean;
  summary: string;
}

/**
 * Derives UI copy for the Pages → Auto Group status strip (shared Group Review settings).
 */
export function getFilteredAutoGroupSettingsStatus(
  hydrated: boolean,
  settings: GroupReviewSettingsData | null
): FilteredAutoGroupSettingsStatus {
  if (!hydrated) {
    return {
      missing: [],
      requiresLocalKey: false,
      summary: 'Loading shared Group Review settings...',
    };
  }
  const missing: string[] = [];
  if (!settings?.apiKey.trim()) missing.push('API key');
  if (!settings?.selectedModel) missing.push('model');
  return {
    missing,
    requiresLocalKey: false,
    summary: FILTERED_AUTO_GROUP_SETTINGS_OK_SUMMARY,
  };
}
