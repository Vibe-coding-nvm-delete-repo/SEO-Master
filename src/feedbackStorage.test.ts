import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  setDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  recordSharedCloudWriteStartMock: vi.fn(),
  recordSharedCloudWriteOkMock: vi.fn(),
  recordSharedCloudWriteErrorMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ path: 'feedback' })),
  doc: vi.fn(() => ({ id: 'doc_1' })),
  getDocs: mocked.getDocsMock,
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  setDoc: mocked.setDocMock,
  writeBatch: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  signInAnonymously: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  deleteObject: vi.fn(),
  getDownloadURL: vi.fn(),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
}));

vi.mock('./firebase', () => ({
  auth: {},
  db: {},
  storage: {},
}));

vi.mock('./cloudSyncStatus', () => ({
  clearListenerError: vi.fn(),
  CLOUD_SYNC_CHANNELS: { feedback: { id: 'feedback' } },
  markListenerError: vi.fn(),
  markListenerSnapshot: vi.fn(),
  recordSharedCloudWriteStart: mocked.recordSharedCloudWriteStartMock,
  recordSharedCloudWriteOk: mocked.recordSharedCloudWriteOkMock,
  recordSharedCloudWriteError: mocked.recordSharedCloudWriteErrorMock,
}));

import { addFeedback } from './feedbackStorage';

describe('feedbackStorage telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getDocsMock.mockResolvedValue({
      forEach: (cb: (doc: { data: () => { priority: number } }) => void) => {
        cb({ data: () => ({ priority: 1 }) });
      },
    });
  });

  it('tracks shared write success on text-only feedback save', async () => {
    mocked.setDocMock.mockResolvedValue(undefined);

    await addFeedback('issue', 'Broken save behavior', null, { tags: ['generate'], rating: 4 });

    expect(mocked.recordSharedCloudWriteStartMock).toHaveBeenCalledTimes(1);
    expect(mocked.recordSharedCloudWriteOkMock).toHaveBeenCalledTimes(1);
    expect(mocked.recordSharedCloudWriteErrorMock).not.toHaveBeenCalled();
  });

  it('tracks shared write failure on text-only feedback save', async () => {
    mocked.setDocMock.mockRejectedValue(new Error('write failed'));

    await expect(addFeedback('feature', 'Please add better retries', null, { tags: ['group'], rating: 3 }))
      .rejects.toThrow('write failed');

    expect(mocked.recordSharedCloudWriteStartMock).toHaveBeenCalledTimes(1);
    expect(mocked.recordSharedCloudWriteOkMock).not.toHaveBeenCalled();
    expect(mocked.recordSharedCloudWriteErrorMock).toHaveBeenCalledTimes(1);
  });
});
