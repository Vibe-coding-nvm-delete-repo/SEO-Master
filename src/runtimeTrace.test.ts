import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtimeTrace', () => {
  const fetchMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses a configured trace endpoint when runtime tracing is enabled', async () => {
    localStorage.setItem('kwg.runtimeTrace.enabled', '1');
    localStorage.setItem('kwg.runtimeTrace.endpoint', 'https://trace.example.test/ingest');
    const { traceRuntimeEvent } = await import('./runtimeTrace');

    traceRuntimeEvent({
      traceId: 'trace-1',
      event: 'v2:test',
      source: 'runtimeTrace.test',
      projectId: 'project-1',
      data: { reason: 'configured-endpoint' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://trace.example.test/ingest',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    expect(console.debug).toHaveBeenCalled();
  });

  it('supports console-only tracing without issuing a network request', async () => {
    localStorage.setItem('kwg.runtimeTrace.enabled', '1');
    localStorage.setItem('kwg.runtimeTrace.endpoint', 'console-only');
    const { traceRuntimeEvent } = await import('./runtimeTrace');

    traceRuntimeEvent({
      traceId: 'trace-2',
      event: 'v2:test',
      source: 'runtimeTrace.test',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.debug).toHaveBeenCalled();
  });
});
