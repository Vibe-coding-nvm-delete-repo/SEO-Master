import { describe, expect, it } from 'vitest';

import { validateHtmlPolicy } from './htmlPolicyValidator';

describe('validateHtmlPolicy', () => {
  it('passes clean html that matches the allowed policy', () => {
    const result = validateHtmlPolicy('<h2>Heading</h2><p><strong>Valid</strong> body text.</p><ul><li>List item</li></ul>');
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails leftover markdown markers', () => {
    const result = validateHtmlPolicy('<p>**bold** text</p>');
    expect(result.passed).toBe(false);
    expect(result.errors.some(error => error.includes('markdown'))).toBe(true);
  });

  it('fails forbidden and unexpected tags', () => {
    const result = validateHtmlPolicy('<h4>Bad</h4><div>Oops</div>');
    expect(result.errors).toContain('Forbidden tag <h4> detected.');
    expect(result.errors).toContain('Unexpected tag <div> detected.');
  });

  it('fails table markup because tables are outside the allowed html policy', () => {
    const result = validateHtmlPolicy('<table><tr><td>Bad</td></tr></table>');
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Unexpected tag <table> detected.');
  });

  it('fails lowercase text starts when capitalization is required', () => {
    const result = validateHtmlPolicy('<p>lowercase start</p>');
    expect(result.errors).toContain('Text inside <p> must start with a capital letter.');
  });

  it('fails invalid links and wrapper quotes', () => {
    const result = validateHtmlPolicy('"<p><a href="javascript:alert(1)">bad</a></p>"');
    expect(result.errors.some(error => error.includes('wrapped in stray quotes'))).toBe(true);
    expect(result.errors).toContain('Anchor tag uses a forbidden javascript: href.');
  });

  it('fails anchors that omit href entirely', () => {
    const result = validateHtmlPolicy('<p>Check <a>this source</a> before applying.</p>');
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Anchor tag is missing href.');
  });

  it('fails empty html blocks', () => {
    const result = validateHtmlPolicy('<p></p>');
    expect(result.errors).toContain('HTML output does not contain visible text.');
    expect(result.errors).toContain('Empty <p> element detected.');
  });
});
