export class PersistOperationTimeoutError extends Error {
  readonly code = 'persist-timeout';
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`[PERSIST TIMEOUT] ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'PersistOperationTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export function withPersistTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PersistOperationTimeoutError(operation, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
