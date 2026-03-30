import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPENROUTER_MODEL_ID,
  normalizePreferredOpenRouterModel,
  pickPreferredOpenRouterModelId,
} from './modelDefaults';

describe('modelDefaults', () => {
  it('prefers GPT-5.4 mini when it is available', () => {
    expect(pickPreferredOpenRouterModelId([
      { id: 'anthropic/claude-sonnet-4' },
      { id: DEFAULT_OPENROUTER_MODEL_ID },
      { id: 'openai/gpt-5' },
    ])).toBe(DEFAULT_OPENROUTER_MODEL_ID);
  });

  it('falls back to the first available model when GPT-5.4 mini is unavailable', () => {
    expect(pickPreferredOpenRouterModelId([
      { id: 'anthropic/claude-sonnet-4' },
      { id: 'openai/gpt-5' },
    ])).toBe('anthropic/claude-sonnet-4');
  });

  it('preserves a valid current selection and normalizes blank or unavailable values', () => {
    const availableModelIds = ['anthropic/claude-sonnet-4', DEFAULT_OPENROUTER_MODEL_ID];

    expect(normalizePreferredOpenRouterModel('anthropic/claude-sonnet-4', availableModelIds)).toBe('anthropic/claude-sonnet-4');
    expect(normalizePreferredOpenRouterModel('', availableModelIds)).toBe(DEFAULT_OPENROUTER_MODEL_ID);
    expect(normalizePreferredOpenRouterModel('openai/gpt-5', availableModelIds)).toBe(DEFAULT_OPENROUTER_MODEL_ID);
  });
});
