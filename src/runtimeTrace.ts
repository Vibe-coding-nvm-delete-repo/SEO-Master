type RuntimeTraceData = Record<string, unknown>;

export type RuntimeTraceEventInput = {
  traceId: string;
  event: string;
  source: string;
  projectId?: string | null;
  data?: RuntimeTraceData;
};

const TRACE_ENDPOINT = 'http://127.0.0.1:7673/ingest/205fa36c-ad66-4c4d-ae8d-1b7715a1d3dd';
const TRACE_ENABLED_KEY = 'kwg.runtimeTrace.enabled';
const TRACE_SESSION_KEY = 'kwg.runtimeTrace.sessionId';
const TRACE_RUN_KEY = 'kwg.runtimeTrace.runId';

const traceHopByTraceId = new Map<string, number>();

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStorageValue(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

function readOrCreateId(key: string): string {
  const existing = readStorageValue(key);
  if (existing && existing.trim()) return existing;
  const next = Math.random().toString(36).slice(2, 10);
  writeStorageValue(key, next);
  return next;
}

function runtimeTraceEnabled(): boolean {
  if (!isBrowser()) return false;
  const explicit = readStorageValue(TRACE_ENABLED_KEY);
  if (explicit === '1') return true;
  if (explicit === '0') return false;
  return false;
}

export function beginRuntimeTrace(source: string, projectId?: string | null, data?: RuntimeTraceData): string {
  const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  traceHopByTraceId.set(traceId, 0);
  traceRuntimeEvent({
    traceId,
    event: 'trace:start',
    source,
    projectId,
    data,
  });
  return traceId;
}

export function traceRuntimeEvent(input: RuntimeTraceEventInput): void {
  if (!runtimeTraceEnabled()) return;
  const previous = traceHopByTraceId.get(input.traceId) ?? 0;
  const hop = previous + 1;
  traceHopByTraceId.set(input.traceId, hop);

  const sessionId = readOrCreateId(TRACE_SESSION_KEY);
  const runId = readOrCreateId(TRACE_RUN_KEY);
  const payload = {
    sessionId,
    runId,
    hypothesisId: 'loop-proof',
    location: input.source,
    message: input.event,
    traceId: input.traceId,
    hop,
    data: {
      projectId: input.projectId ?? null,
      ...(input.data ?? {}),
    },
    timestamp: Date.now(),
  };

  fetch(TRACE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': sessionId,
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    /* ignore transport errors in instrumentation */
  });

  console.debug('[runtime-trace]', payload);
}
