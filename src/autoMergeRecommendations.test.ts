import { describe, expect, it } from 'vitest';
import type { AutoMergeRecommendation } from './types';
import {
  markRecommendationApproved,
  markRecommendationPendingAfterUndo,
  mergeRecommendationsAfterRerun,
} from './autoMergeRecommendations';

const rec = (id: string, status: AutoMergeRecommendation['status']): AutoMergeRecommendation => ({
  id,
  sourceToken: id,
  canonicalToken: id,
  mergeTokens: [`${id}x`],
  confidence: 0.9,
  reason: '',
  affectedKeywordCount: 1,
  affectedPageCount: 1,
  affectedKeywords: [],
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('autoMergeRecommendations lifecycle', () => {
  it('preserves approved recommendations across reruns', () => {
    const existing: AutoMergeRecommendation[] = [
      { ...rec('a', 'approved'), reviewedAt: '2026-01-02T00:00:00.000Z' },
      rec('legacy-approved-only', 'approved'),
      rec('b', 'pending'),
    ];
    const fresh: AutoMergeRecommendation[] = [
      rec('a', 'pending'),
      rec('c', 'pending'),
    ];

    const merged = mergeRecommendationsAfterRerun(existing, fresh);
    expect(merged.find(r => r.id === 'a')?.status).toBe('approved');
    expect(merged.find(r => r.id === 'a')?.reviewedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(merged.find(r => r.id === 'legacy-approved-only')?.status).toBe('approved');
    expect(merged.some(r => r.id === 'b')).toBe(false);
  });

  it('marks a single recommendation approved without mutating others', () => {
    const input: AutoMergeRecommendation[] = [rec('a', 'pending'), rec('b', 'pending')];
    const out = markRecommendationApproved(input, 'a', '2026-01-03T00:00:00.000Z');
    expect(out.find(r => r.id === 'a')?.status).toBe('approved');
    expect(out.find(r => r.id === 'a')?.reviewedAt).toBe('2026-01-03T00:00:00.000Z');
    expect(out.find(r => r.id === 'b')?.status).toBe('pending');
  });

  it('restores approved recommendation to pending after undo', () => {
    const input: AutoMergeRecommendation[] = [
      { ...rec('a', 'approved'), reviewedAt: '2026-01-03T00:00:00.000Z' },
      rec('b', 'declined'),
    ];
    const out = markRecommendationPendingAfterUndo(input, 'a');
    expect(out.find(r => r.id === 'a')?.status).toBe('pending');
    expect(out.find(r => r.id === 'a')?.reviewedAt).toBeUndefined();
    expect(out.find(r => r.id === 'b')?.status).toBe('declined');
  });
});
