import { describe, expect, it } from 'vitest';

import {
  H2_CONTENT_DEFAULT_PROMPT,
  PAGE_GUIDELINES_DEFAULT_PROMPT_V2,
  PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT,
} from './ContentTab';

describe('content prompt table policy', () => {
  it('forbids table recommendations in the page guide prompt', () => {
    expect(PAGE_GUIDELINES_DEFAULT_PROMPT_V2).toContain('Never recommend tables, comparison tables, tabular layouts');
    expect(PAGE_GUIDELINES_DEFAULT_PROMPT_V2).toContain('"formatting" must never recommend tables');
  });

  it('forbids table recommendations in the page guide validator contract', () => {
    expect(PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT).toContain('must not recommend tables');
    expect(PAGE_GUIDELINES_VALIDATOR_DEFAULT_CONTRACT).toContain('table-style format');
  });

  it('forbids table output in the h2 body prompt', () => {
    expect(H2_CONTENT_DEFAULT_PROMPT).toContain('Never use tables, comparison tables, rows/columns, tabular layouts');
    expect(H2_CONTENT_DEFAULT_PROMPT).toContain('use paragraphs, bullets, or numbered steps instead');
  });
});
