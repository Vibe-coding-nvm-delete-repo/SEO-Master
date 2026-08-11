import { getRuntimeTraceSessionContext } from './runtimeTrace';

export type CollabDiagnosticEventKind =
  | 'authoritative-sync-state'
  | 'shared-project-sync-state'
  | 'listener-snapshot-server'
  | 'listener-error'
  | 'listener-error-cleared'
  | 'mutation-accepted'
  | 'mutation-blocked'
  | 'mutation-failed'
  | 'listener-apply';

export type CollabDiagnosticEntry = {
  id: string;
  atMs: number;
  sessionId: string | null;
  runId: string | null;
  kind: CollabDiagnosticEventKind;
  projectId?: string | null;
  actionId?: string;
  channelId?: string;
  data?: Record<string, unknown>;
};

const LOG_KEY = 'kwg.collabDiagnostics.log.v1';
const MAX_ENTRIES = 1200;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function nowMs(): number {
  return Date.now();
}

function buildId(): string {
  return `${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readEntries(): CollabDiagnosticEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = nowMs() - MAX_AGE_MS;
    return parsed.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const atMs = (item as { atMs?: unknown }).atMs;
      return typeof atMs === 'number' && atMs >= cutoff;
    }) as CollabDiagnosticEntry[];
  } catch {
    return [];
  }
}

function writeEntries(entries: CollabDiagnosticEntry[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Ignore storage quota/write errors.
  }
}

export function appendCollaborationDiagnostic(input: {
  kind: CollabDiagnosticEventKind;
  projectId?: string | null;
  actionId?: string;
  channelId?: string;
  data?: Record<string, unknown>;
  atMs?: number;
}): void {
  if (!isBrowser()) return;
  const { sessionId, runId } = getRuntimeTraceSessionContext();
  const entries = readEntries();
  entries.push({
    id: buildId(),
    atMs: input.atMs ?? nowMs(),
    sessionId,
    runId,
    kind: input.kind,
    projectId: input.projectId ?? null,
    actionId: input.actionId,
    channelId: input.channelId,
    data: input.data,
  });
  writeEntries(entries);
}

export function getCollaborationDiagnostics(limit = 300): readonly CollabDiagnosticEntry[] {
  const safeLimit = Math.max(1, Math.min(limit, MAX_ENTRIES));
  return readEntries().slice(-safeLimit);
}

export function clearCollaborationDiagnostics(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(LOG_KEY);
  } catch {
    // Ignore storage failures.
  }
}

declare global {
  interface Window {
    __kwgCollabDiagnostics?: {
      read: (limit?: number) => readonly CollabDiagnosticEntry[];
      clear: () => void;
    };
  }
}

if (isBrowser() && !window.__kwgCollabDiagnostics) {
  window.__kwgCollabDiagnostics = {
    read: (limit?: number) => getCollaborationDiagnostics(limit),
    clear: () => clearCollaborationDiagnostics(),
  };
}
