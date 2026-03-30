export function hasTrueFlag(flags: Record<string, boolean>): boolean {
  return Object.values(flags).some(Boolean);
}

export function hasGenerateLifecycleActivity(opts: {
  isGenerating: boolean;
  slotGeneratingState: Record<string, boolean>;
  isStopping?: boolean;
  slotStoppingState?: Record<string, boolean>;
  isSyncingSource?: boolean;
}): boolean {
  return (
    opts.isGenerating ||
    hasTrueFlag(opts.slotGeneratingState) ||
    Boolean(opts.isStopping) ||
    hasTrueFlag(opts.slotStoppingState ?? {}) ||
    Boolean(opts.isSyncingSource)
  );
}

export function resolveAsyncRunButtonMode(opts: {
  isRunning: boolean;
  isStopping: boolean;
}): 'run' | 'stop' | 'stopping' {
  if (!opts.isRunning) return 'run';
  return opts.isStopping ? 'stopping' : 'stop';
}
