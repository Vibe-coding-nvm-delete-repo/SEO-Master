export const DEFAULT_OPENROUTER_MODEL_ID = 'openai/gpt-5.4-mini';
export const DEFAULT_OPENROUTER_MODEL_LABEL = 'OpenAI GPT-5.4 mini';

export function pickPreferredOpenRouterModelId<T extends { id: string }>(models: readonly T[]): string {
  if (!models.length) return DEFAULT_OPENROUTER_MODEL_ID;
  const preferred = models.find((model) => model.id === DEFAULT_OPENROUTER_MODEL_ID);
  return preferred?.id ?? models[0].id;
}

export function normalizePreferredOpenRouterModel(currentModelId: string, availableModelIds: readonly string[]): string {
  const current = currentModelId.trim();
  if (current && availableModelIds.includes(current)) return current;
  return pickPreferredOpenRouterModelId(availableModelIds.map((id) => ({ id })));
}
