export function canReusePersistedDerivedRowState(opts: {
  derivedInput: string;
  persistedInput: unknown;
  persistedOutput?: unknown;
  requireNonEmptyOutput?: boolean;
  extraGuard?: boolean;
}): boolean {
  const {
    derivedInput,
    persistedInput,
    persistedOutput,
    requireNonEmptyOutput = true,
    extraGuard = true,
  } = opts;

  if (!extraGuard) return false;
  if (!derivedInput.trim()) return false;
  if (typeof persistedInput !== 'string' || persistedInput !== derivedInput) return false;
  if (!requireNonEmptyOutput) return true;
  return typeof persistedOutput === 'string' && persistedOutput.trim().length > 0;
}
