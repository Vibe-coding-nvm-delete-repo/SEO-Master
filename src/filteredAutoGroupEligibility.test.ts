import { describe, expect, it } from 'vitest';
import {
  computeCanRunFilteredAutoGroup,
  effectiveFilterSummaryForPrompt,
  FILTERED_AUTO_GROUP_NO_EXTRA_FILTERS_SENTINEL,
  filteredAutoGroupDisabledReason,
  FILTERED_AUTO_GROUP_SCOPE_ALL_VISIBLE,
} from './filteredAutoGroupEligibility';

describe('effectiveFilterSummaryForPrompt', () => {
  it('expands no-filters sentinel for the LLM scope line', () => {
    expect(effectiveFilterSummaryForPrompt(FILTERED_AUTO_GROUP_NO_EXTRA_FILTERS_SENTINEL)).toBe(
      FILTERED_AUTO_GROUP_SCOPE_ALL_VISIBLE,
    );
  });

  it('passes through explicit filter summaries', () => {
    expect(effectiveFilterSummaryForPrompt('tokens=foo, bar')).toBe('tokens=foo, bar');
  });
});

describe('computeCanRunFilteredAutoGroup', () => {
  const ok = {
    isBulkSharedEditBlocked: false,
    filteredClusterCount: 3,
    groupReviewSettingsHydrated: true,
    settingsMissing: [] as string[],
  };

  it('is true when pages exist, settings ready, and not bulk-blocked', () => {
    expect(computeCanRunFilteredAutoGroup(ok)).toBe(true);
  });

  it('is false when bulk-blocked', () => {
    expect(computeCanRunFilteredAutoGroup({ ...ok, isBulkSharedEditBlocked: true })).toBe(false);
  });

  it('is false when no filtered clusters', () => {
    expect(computeCanRunFilteredAutoGroup({ ...ok, filteredClusterCount: 0 })).toBe(false);
  });

  it('is false when settings not hydrated', () => {
    expect(computeCanRunFilteredAutoGroup({ ...ok, groupReviewSettingsHydrated: false })).toBe(false);
  });

  it('is false when API key or model missing', () => {
    expect(computeCanRunFilteredAutoGroup({ ...ok, settingsMissing: ['API key'] })).toBe(false);
  });
});

describe('filteredAutoGroupDisabledReason', () => {
  const ok = {
    isBulkSharedEditBlocked: false,
    filteredClusterCount: 2,
    groupReviewSettingsHydrated: true,
    settingsMissing: [] as string[],
  };

  it('returns null when eligible', () => {
    expect(filteredAutoGroupDisabledReason(ok)).toBeNull();
  });

  it('returns bulk-block message when shared edits blocked', () => {
    const r = filteredAutoGroupDisabledReason({ ...ok, isBulkSharedEditBlocked: true });
    expect(r).toContain('read-only');
  });

  it('returns missing-settings message when model/key absent', () => {
    const r = filteredAutoGroupDisabledReason({ ...ok, settingsMissing: ['API key', 'model'] });
    expect(r).toContain('Group Review');
    expect(r).toContain('API key');
  });
});
