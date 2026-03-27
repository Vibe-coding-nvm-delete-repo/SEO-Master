import { describe, it, expect, vi } from 'vitest';
import { reportPersistFailure, logPersistError } from './persistenceErrors';

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
    );
    spy.mockRestore();
  });

  it('reportPersistFailure skips toast when addToast omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reportPersistFailure(undefined, 'x', new Error('e'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logPersistError logs without throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logPersistError('ctx', 'oops');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
