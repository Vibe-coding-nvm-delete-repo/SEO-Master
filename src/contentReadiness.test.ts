import { describe, it, expect } from 'vitest';
import {
  cleanGeneratedContent,
  hasMeaningfulContent,
  hasGeneratedPrimaryOutput,
  hasGeneratedSlotOutput,
} from './contentReadiness';

describe('cleanGeneratedContent', () => {
  it('returns empty string for non-string values', () => {
    expect(cleanGeneratedContent(null)).toBe('');
    expect(cleanGeneratedContent(undefined)).toBe('');
    expect(cleanGeneratedContent(123)).toBe('');
    expect(cleanGeneratedContent({})).toBe('');
    expect(cleanGeneratedContent([])).toBe('');
    expect(cleanGeneratedContent(true)).toBe('');
  });

  it('trims whitespace from regular strings', () => {
    expect(cleanGeneratedContent('  hello world  ')).toBe('hello world');
    expect(cleanGeneratedContent('\n\ntest\n\n')).toBe('test');
    expect(cleanGeneratedContent('  ')).toBe('');
  });

  it('extracts content from <answer> tags', () => {
    expect(cleanGeneratedContent('<answer>hello</answer>')).toBe('hello');
    expect(cleanGeneratedContent('<answer>  hello world  </answer>')).toBe('hello world');
    expect(cleanGeneratedContent('  <answer>\nline 1\nline 2\n</answer>  ')).toBe('line 1\nline 2');
  });

  it('handles case-insensitive <answer> tags', () => {
    expect(cleanGeneratedContent('<ANSWER>uppercase</ANSWER>')).toBe('uppercase');
    expect(cleanGeneratedContent('<Answer>mixed</Answer>')).toBe('mixed');
  });

  it('ignores invalid <answer> tags but might still trim', () => {
    expect(cleanGeneratedContent('before <answer>inside</answer> after')).toBe('before <answer>inside</answer> after');
    expect(cleanGeneratedContent('<answer>unclosed')).toBe('<answer>unclosed');
    expect(cleanGeneratedContent('unopened</answer>')).toBe('unopened</answer>');
    expect(cleanGeneratedContent('<answer>multiple</answer> tags <answer>here</answer>')).toBe('multiple</answer> tags <answer>here');
  });

  it('removes markdown code block backticks', () => {
    expect(cleanGeneratedContent('```\nhello\n```')).toBe('hello');
    expect(cleanGeneratedContent('```javascript\nconst a = 1;\n```')).toBe('const a = 1;');
    expect(cleanGeneratedContent('```json\n{"key": "value"}\n```')).toBe('{"key": "value"}');
    expect(cleanGeneratedContent('```html\n<div>test</div>\n```')).toBe('<div>test</div>');
  });

  it('removes multiple code blocks', () => {
    expect(cleanGeneratedContent('```\nfirst\n```\nsecond\n```\nthird\n```')).toBe('first\nsecond\nthird');
  });

  it('handles empty code blocks', () => {
    expect(cleanGeneratedContent('```\n```')).toBe('');
    expect(cleanGeneratedContent('```json\n```')).toBe('');
  });

  it('extracts from <answer> tags and removes markdown code block backticks together', () => {
    expect(cleanGeneratedContent('<answer>\n```json\n{"data": 1}\n```\n</answer>')).toBe('{"data": 1}');
    expect(cleanGeneratedContent('  <answer>```javascript\nhello()\n```</answer>  ')).toBe('hello()');
  });
});

describe('hasMeaningfulContent', () => {
  it('returns false for empty or whitespace-only content', () => {
    expect(hasMeaningfulContent('')).toBe(false);
    expect(hasMeaningfulContent('   ')).toBe(false);
    expect(hasMeaningfulContent('\n\t')).toBe(false);
    expect(hasMeaningfulContent(null)).toBe(false);
    expect(hasMeaningfulContent(undefined)).toBe(false);
  });

  it('returns true for content with visible characters', () => {
    expect(hasMeaningfulContent('a')).toBe(true);
    expect(hasMeaningfulContent('hello world')).toBe(true);
    expect(hasMeaningfulContent('<answer>content</answer>')).toBe(true);
  });

  it('returns false for empty <answer> tags', () => {
    expect(hasMeaningfulContent('<answer></answer>')).toBe(false);
    expect(hasMeaningfulContent('<answer>   </answer>')).toBe(false);
    expect(hasMeaningfulContent('  <answer>\n\n</answer>  ')).toBe(false);
  });

  it('returns false for empty markdown blocks', () => {
    expect(hasMeaningfulContent('```\n```')).toBe(false);
    expect(hasMeaningfulContent('```json\n   \n```')).toBe(false);
  });
});

describe('hasGeneratedPrimaryOutput', () => {
  it('returns false for undefined or null row', () => {
    expect(hasGeneratedPrimaryOutput(undefined)).toBe(false);
    // @ts-ignore - testing runtime behavior
    expect(hasGeneratedPrimaryOutput(null)).toBe(false);
  });

  it('returns false when status is not "generated"', () => {
    expect(hasGeneratedPrimaryOutput({ status: 'pending', output: 'content' })).toBe(false);
    expect(hasGeneratedPrimaryOutput({ status: 'failed', output: 'content' })).toBe(false);
    expect(hasGeneratedPrimaryOutput({ status: undefined, output: 'content' })).toBe(false);
    expect(hasGeneratedPrimaryOutput({ output: 'content' })).toBe(false);
  });

  it('returns false when status is "generated" but output is not meaningful', () => {
    expect(hasGeneratedPrimaryOutput({ status: 'generated', output: '' })).toBe(false);
    expect(hasGeneratedPrimaryOutput({ status: 'generated', output: '   ' })).toBe(false);
    expect(hasGeneratedPrimaryOutput({ status: 'generated', output: undefined })).toBe(false);
  });

  it('returns true when status is "generated" and output is meaningful', () => {
    expect(hasGeneratedPrimaryOutput({ status: 'generated', output: 'hello' })).toBe(true);
    expect(hasGeneratedPrimaryOutput({ status: 'generated', output: ' <answer>content</answer> ' })).toBe(true);
    expect(hasGeneratedPrimaryOutput({ status: 'generated', output: ' ```\ncontent\n``` ' })).toBe(true);
  });
});

describe('hasGeneratedSlotOutput', () => {
  it('returns false for undefined or null slot', () => {
    expect(hasGeneratedSlotOutput(undefined)).toBe(false);
    // @ts-ignore - testing runtime behavior
    expect(hasGeneratedSlotOutput(null)).toBe(false);
  });

  it('returns false when status is not "generated"', () => {
    expect(hasGeneratedSlotOutput({ status: 'pending', output: 'content' })).toBe(false);
    expect(hasGeneratedSlotOutput({ status: 'failed', output: 'content' })).toBe(false);
    expect(hasGeneratedSlotOutput({ status: undefined, output: 'content' })).toBe(false);
    expect(hasGeneratedSlotOutput({ output: 'content' })).toBe(false);
  });

  it('returns false when status is "generated" but output is not meaningful', () => {
    expect(hasGeneratedSlotOutput({ status: 'generated', output: '' })).toBe(false);
    expect(hasGeneratedSlotOutput({ status: 'generated', output: '   ' })).toBe(false);
    expect(hasGeneratedSlotOutput({ status: 'generated', output: undefined })).toBe(false);
  });

  it('returns true when status is "generated" and output is meaningful', () => {
    expect(hasGeneratedSlotOutput({ status: 'generated', output: 'hello' })).toBe(true);
    expect(hasGeneratedSlotOutput({ status: 'generated', output: ' <answer>content</answer> ' })).toBe(true);
    expect(hasGeneratedSlotOutput({ status: 'generated', output: ' ```\ncontent\n``` ' })).toBe(true);
  });
});
