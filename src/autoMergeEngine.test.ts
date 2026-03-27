import { describe, expect, it } from 'vitest';
import { parseAutoMergeJson } from './AutoMergeEngine';

describe('parseAutoMergeJson', () => {
  it('parses valid JSON payload', () => {
    const parsed = parseAutoMergeJson('{"matches":["hvac","h-v-a-c"],"confidence":0.93,"reason":"minor variants"}');
    expect(parsed).toEqual({
      matches: ['hvac', 'h-v-a-c'],
      confidence: 0.93,
      reason: 'minor variants',
    });
  });

  it('extracts JSON from wrapped text', () => {
    const parsed = parseAutoMergeJson('```json\n{"matches":["color"],"confidence":"0.8","reason":"us/uk"}\n```');
    expect(parsed).toEqual({
      matches: ['color'],
      confidence: 0.8,
      reason: 'us/uk',
    });
  });

  it('normalizes invalid shapes', () => {
    const parsed = parseAutoMergeJson('{"matches":[1,null,"  term  "],"confidence":9}');
    expect(parsed).toEqual({
      matches: ['term'],
      confidence: 1,
      reason: '',
    });
  });
});
