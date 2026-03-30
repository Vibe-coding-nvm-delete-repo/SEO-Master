import { describe, expect, it } from 'vitest';

import { canReusePersistedDerivedRowState } from './contentPipelineReuse';

describe('contentPipelineReuse', () => {
  it('reuses persisted state only when the derived input matches exactly', () => {
    expect(canReusePersistedDerivedRowState({
      derivedInput: 'Prompt A',
      persistedInput: 'Prompt A',
      persistedOutput: 'Saved output',
    })).toBe(true);

    expect(canReusePersistedDerivedRowState({
      derivedInput: 'Prompt A',
      persistedInput: 'Prompt B',
      persistedOutput: 'Saved output',
    })).toBe(false);
  });

  it('rejects rows that are no longer eligible to run', () => {
    expect(canReusePersistedDerivedRowState({
      derivedInput: '',
      persistedInput: '',
      persistedOutput: 'Saved output',
    })).toBe(false);
  });

  it('can preserve multi-output state even when the primary output is blank', () => {
    expect(canReusePersistedDerivedRowState({
      derivedInput: 'Prompt A',
      persistedInput: 'Prompt A',
      persistedOutput: '',
      requireNonEmptyOutput: false,
    })).toBe(true);
  });
});
