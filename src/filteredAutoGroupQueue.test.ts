import { describe, expect, it } from 'vitest';
import { enqueueLatestFilteredAutoGroupJob } from './filteredAutoGroupQueue';

describe('enqueueLatestFilteredAutoGroupJob', () => {
  it('queues the first pending job', () => {
    expect(
      enqueueLatestFilteredAutoGroupJob([], { id: 'job-1', signature: 'filters:a' }),
    ).toEqual([{ id: 'job-1', signature: 'filters:a' }]);
  });

  it('replaces the pending queue with only the latest distinct job', () => {
    expect(
      enqueueLatestFilteredAutoGroupJob(
        [
          { id: 'job-1', signature: 'filters:a' },
          { id: 'job-2', signature: 'filters:b' },
        ],
        { id: 'job-3', signature: 'filters:c' },
      ),
    ).toEqual([{ id: 'job-3', signature: 'filters:c' }]);
  });

  it('refreshes the pending job when the same filter signature is re-run', () => {
    expect(
      enqueueLatestFilteredAutoGroupJob(
        [{ id: 'job-1', signature: 'filters:a' }],
        { id: 'job-2', signature: 'filters:a' },
      ),
    ).toEqual([{ id: 'job-2', signature: 'filters:a' }]);
  });
});
