import { describe, it, expect, vi } from 'vitest';
import { getPersistErrorInfo, reportPersistFailure, logPersistError } from './persistenceErrors';

describe('persistenceErrors', () => {
  it('reportPersistFailure logs and invokes toast when provided', () => {
    const err = new Error('network');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const addToast = vi.fn();
    reportPersistFailure(addToast, 'test op', err);
    expect(spy).toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('test op'),
      'error',
      expect.objectContaining({
        notification: expect.objectContaining({
          mode: 'shared',
          source: 'system',
        }),
      }),
    );
    spy.mockRestore();
  });

  it('reportPersistFailure skips toast when addToast omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportPersistFailure(undefined, 'x', new Error('e'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('uses payload-rejected copy for invalid-argument failures', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const addToast = vi.fn();
    reportPersistFailure(addToast, 'generate rows', { code: 'invalid-argument' });
    expect(addToast).toHaveBeenCalledWith(
      'Cloud sync failed (generate rows) [invalid-argument]. Firestore rejected the data payload.',
      'error',
      expect.objectContaining({
        notification: expect.objectContaining({
          mode: 'shared',
          source: 'system',
        }),
      }),
    );
    spy.mockRestore();
  });

  it('uses rules-focused copy for permission-denied failures', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const addToast = vi.fn();
    reportPersistFailure(addToast, 'project V2 save (activate collab meta)', { code: 'permission-denied' });
    expect(addToast).toHaveBeenCalledWith(
      'Cloud sync blocked (project V2 save (activate collab meta)) [permission-denied]. Firestore denied this write. Check shared-project recovery or deployed rules.',
      'error',
      expect.objectContaining({
        notification: expect.objectContaining({
          mode: 'shared',
          source: 'system',
        }),
      }),
    );
    spy.mockRestore();
  });

  it('extracts normalized code and tagged step details', () => {
    expect(getPersistErrorInfo({ code: 'firestore/permission-denied', persistStep: 'activate collab meta' })).toEqual({
      code: 'permission-denied',
      kind: 'permission-denied',
      step: 'activate collab meta',
    });
  });

  it('logPersistError logs without throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logPersistError('ctx', 'oops');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
