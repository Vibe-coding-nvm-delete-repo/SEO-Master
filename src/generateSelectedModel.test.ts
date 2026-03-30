import { describe, expect, it } from 'vitest';

import {
  PRIMARY_MODEL_SCOPE,
  getSelectedModelForScope,
  hydrateGenerateSettings,
  isSelectedModelLockedForScope,
  mergeHydratedScopedModelState,
  preferExistingSelectedModel,
  resolveRequestApiKey,
  resolveHydratedSelectedModel,
  shouldAutoSelectDefaultModel,
  shouldApplySharedSelectedModel,
  withScopedSelectedModel,
  withScopedSelectedModelLock,
} from './GenerateTab';

describe('preferExistingSelectedModel', () => {
  it('preserves a non-empty current selection over incoming hydration', () => {
    expect(preferExistingSelectedModel('openai/gpt-5', 'ai21/jamba-large-1.7')).toBe('openai/gpt-5');
  });

  it('adopts the incoming selection only when current is empty', () => {
    expect(preferExistingSelectedModel('', 'ai21/jamba-large-1.7')).toBe('ai21/jamba-large-1.7');
  });

  it('trims whitespace when resolving the model id', () => {
    expect(preferExistingSelectedModel('  openai/gpt-5  ', '  ai21/jamba-large-1.7  ')).toBe('openai/gpt-5');
    expect(preferExistingSelectedModel('   ', '  ai21/jamba-large-1.7  ')).toBe('ai21/jamba-large-1.7');
  });
});

describe('resolveHydratedSelectedModel', () => {
  it('treats a locked incoming model as authoritative', () => {
    expect(resolveHydratedSelectedModel('openai/gpt-5', 'google/gemini-2.5-pro', true)).toBe('google/gemini-2.5-pro');
  });

  it('keeps the existing local model when the incoming model is unlocked', () => {
    expect(resolveHydratedSelectedModel('openai/gpt-5', 'google/gemini-2.5-pro', false)).toBe('openai/gpt-5');
  });
});

describe('shouldApplySharedSelectedModel', () => {
  it('blocks shared model adoption when a subtab model is locked', () => {
    expect(shouldApplySharedSelectedModel(true)).toBe(false);
  });

  it('allows shared model adoption when the subtab is unlocked', () => {
    expect(shouldApplySharedSelectedModel(false)).toBe(true);
  });
});

describe('resolveRequestApiKey', () => {
  it('prefers the shared key persisted by another generate surface', () => {
    localStorage.setItem('kwg_generate_cache:apiKeyShared', 'shared-key');
    expect(resolveRequestApiKey('stale-local-key', '_page_names')).toBe('shared-key');
  });

  it('falls back to the current in-memory key when no shared key exists', () => {
    localStorage.removeItem('kwg_generate_cache:apiKeyShared');
    expect(resolveRequestApiKey('  local-key  ', '_page_names')).toBe('local-key');
  });
});

describe('scoped model helpers', () => {
  it('falls back to the primary model when a slot-specific model is unset', () => {
    expect(getSelectedModelForScope({
      apiKey: '',
      selectedModel: 'openai/gpt-5',
      selectedModelLocked: false,
      selectedModelByView: {},
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, 'slug')).toBe('openai/gpt-5');
  });

  it('stores and reads a slot-specific model independently from primary', () => {
    const settings = withScopedSelectedModel({
      apiKey: '',
      selectedModel: 'openai/gpt-5',
      selectedModelLocked: false,
      selectedModelByView: {},
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, 'slug', 'google/gemini-2.5-pro');

    expect(getSelectedModelForScope(settings, PRIMARY_MODEL_SCOPE)).toBe('openai/gpt-5');
    expect(getSelectedModelForScope(settings, 'slug')).toBe('google/gemini-2.5-pro');
  });

  it('stores and reads a slot-specific lock independently from primary', () => {
    const settings = withScopedSelectedModelLock({
      apiKey: '',
      selectedModel: 'openai/gpt-5',
      selectedModelLocked: false,
      selectedModelByView: {},
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, 'cta', true);

    expect(isSelectedModelLockedForScope(settings, PRIMARY_MODEL_SCOPE)).toBe(false);
    expect(isSelectedModelLockedForScope(settings, 'cta')).toBe(true);
  });
});

describe('mergeHydratedScopedModelState', () => {
  it('preserves an existing unlocked scoped model over stale incoming hydration', () => {
    const merged = mergeHydratedScopedModelState({
      apiKey: '',
      selectedModel: 'openai/gpt-5',
      selectedModelLocked: false,
      selectedModelByView: { primary: 'openai/gpt-5', cta: 'google/gemini-2.5-pro' },
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, {
      apiKey: '',
      selectedModel: 'ai21/jamba-large-1.7',
      selectedModelLocked: false,
      selectedModelByView: { primary: 'ai21/jamba-large-1.7' },
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    });

    expect(merged.selectedModel).toBe('openai/gpt-5');
    expect(merged.selectedModelByView.primary).toBe('openai/gpt-5');
    expect(merged.selectedModelByView.cta).toBe('google/gemini-2.5-pro');
  });

  it('accepts an incoming locked scoped model as authoritative', () => {
    const merged = mergeHydratedScopedModelState({
      apiKey: '',
      selectedModel: 'openai/gpt-5',
      selectedModelLocked: false,
      selectedModelByView: { primary: 'openai/gpt-5', slug: 'google/gemini-2.5-pro' },
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, {
      apiKey: '',
      selectedModel: 'openai/gpt-5',
      selectedModelLocked: false,
      selectedModelByView: { primary: 'openai/gpt-5', slug: 'anthropic/claude-sonnet-4' },
      selectedModelLockedByView: { slug: true },
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    });

    expect(merged.selectedModelByView.slug).toBe('anthropic/claude-sonnet-4');
    expect(merged.selectedModelLockedByView.slug).toBe(true);
  });

  it('drops a lock when there is no model for that scope', () => {
    const merged = mergeHydratedScopedModelState({
      apiKey: '',
      selectedModel: '',
      selectedModelLocked: false,
      selectedModelByView: {},
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, {
      apiKey: '',
      selectedModel: '',
      selectedModelLocked: false,
      selectedModelByView: {},
      selectedModelLockedByView: { slug: true },
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    });

    expect(merged.selectedModelByView.slug).toBeUndefined();
    expect(merged.selectedModelLockedByView.slug).toBeUndefined();
  });
});

describe('hydrateGenerateSettings', () => {
  it('preserves the current scoped model in the effective hydrated settings and cache shape', () => {
    const hydrated = hydrateGenerateSettings({
      apiKey: '',
      selectedModel: 'google/gemini-2.5-pro',
      selectedModelLocked: true,
      selectedModelByView: { primary: 'google/gemini-2.5-pro' },
      selectedModelLockedByView: { primary: true },
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    }, {
      apiKey: '',
      selectedModel: 'ai21/jamba-large-1.7',
      selectedModelLocked: false,
      selectedModelByView: { primary: 'ai21/jamba-large-1.7' },
      selectedModelLockedByView: {},
      rateLimit: 5,
      minLen: 0,
      maxLen: 0,
      maxRetries: 3,
      temperature: 1,
      maxTokens: 0,
      reasoning: false,
      webSearch: false,
      prompt: '',
      slotPrompts: {},
    });

    expect(hydrated.selectedModel).toBe('google/gemini-2.5-pro');
    expect(hydrated.selectedModelLocked).toBe(true);
    expect(hydrated.selectedModelByView.primary).toBe('google/gemini-2.5-pro');
    expect(hydrated.selectedModelLockedByView.primary).toBe(true);
  });
});

describe('shouldAutoSelectDefaultModel', () => {
  const baseSettings = {
    apiKey: '',
    selectedModel: '',
    selectedModelLocked: false,
    selectedModelByView: {},
    selectedModelLockedByView: {},
    rateLimit: 5,
    minLen: 0,
    maxLen: 0,
    maxRetries: 3,
    temperature: 1,
    maxTokens: 0,
    reasoning: false as const,
    webSearch: false,
    prompt: '',
    slotPrompts: {},
  };

  it('blocks auto-select before settings hydration completes', () => {
    expect(shouldAutoSelectDefaultModel({
      settingsLoaded: false,
      firestoreLoaded: true,
      settings: baseSettings,
      scope: PRIMARY_MODEL_SCOPE,
    })).toBe(false);
  });

  it('blocks auto-select when the scope is locked but empty', () => {
    expect(shouldAutoSelectDefaultModel({
      settingsLoaded: true,
      firestoreLoaded: true,
      settings: {
        ...baseSettings,
        selectedModelLockedByView: { slug: true },
      },
      scope: 'slug',
    })).toBe(false);
  });

  it('blocks auto-select when a shared model surface is in use', () => {
    expect(shouldAutoSelectDefaultModel({
      settingsLoaded: true,
      firestoreLoaded: true,
      sharedSelectedModelStorageKey: '_page_names',
      settings: baseSettings,
      scope: PRIMARY_MODEL_SCOPE,
    })).toBe(false);
  });
});
