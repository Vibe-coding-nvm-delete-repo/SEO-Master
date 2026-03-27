import { describe, it, expect } from 'vitest';
import {
  FILTERED_AUTO_GROUP_SETTINGS_OK_SUMMARY,
  getFilteredAutoGroupSettingsStatus,
} from './filteredAutoGroupSettingsStatus';
import type { GroupReviewSettingsData } from './GroupReviewSettings';

function minimalSettings(overrides: Partial<GroupReviewSettingsData> = {}): GroupReviewSettingsData {
  return {
    apiKey: 'k',
    selectedModel: 'openai/gpt-4',
    concurrency: 1,
    temperature: 0.2,
    maxTokens: 4096,
    systemPrompt: '',
    autoGroupPrompt: '',
    reasoningEffort: 'none',
    keywordRatingModel: '',
    keywordRatingTemperature: 0,
    keywordRatingMaxTokens: 0,
    keywordRatingConcurrency: 1,
    keywordRatingReasoningEffort: 'none',
    keywordRatingPrompt: '',
    keywordCoreIntentSummary: '',
    keywordCoreIntentSummaryUpdatedAt: '',
    autoMergeModel: '',
    autoMergeTemperature: 0,
    autoMergeMaxTokens: 0,
    autoMergeConcurrency: 1,
    autoMergeReasoningEffort: 'none',
    autoMergePrompt: '',
    ...overrides,
  };
}

describe('getFilteredAutoGroupSettingsStatus', () => {
  it('returns loading summary when not hydrated', () => {
    const r = getFilteredAutoGroupSettingsStatus(false, minimalSettings());
    expect(r.missing).toEqual([]);
    expect(r.summary).toContain('Loading');
  });

  it('when hydrated and snapshot is null, reports missing API key and model', () => {
    const r = getFilteredAutoGroupSettingsStatus(true, null);
    expect(r.missing).toEqual(['API key', 'model']);
    expect(r.summary).toBe(FILTERED_AUTO_GROUP_SETTINGS_OK_SUMMARY);
  });

  it('treats whitespace-only API key as missing', () => {
    const r = getFilteredAutoGroupSettingsStatus(
      true,
      minimalSettings({ apiKey: '   ', selectedModel: 'm' })
    );
    expect(r.missing).toEqual(['API key']);
  });

  it('reports missing model when empty string', () => {
    const r = getFilteredAutoGroupSettingsStatus(
      true,
      minimalSettings({ apiKey: 'x', selectedModel: '' })
    );
    expect(r.missing).toEqual(['model']);
  });

  it('returns empty missing and OK summary when key and model present', () => {
    const r = getFilteredAutoGroupSettingsStatus(true, minimalSettings());
    expect(r.missing).toEqual([]);
    expect(r.summary).toBe(FILTERED_AUTO_GROUP_SETTINGS_OK_SUMMARY);
    expect(r.requiresLocalKey).toBe(false);
  });
});
