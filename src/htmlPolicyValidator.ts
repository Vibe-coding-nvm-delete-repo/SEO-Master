export type HtmlValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

export type HtmlValidationOptions = {
  allowedTags?: string[];
  forbiddenTags?: string[];
  requireCapitalizedTextStart?: boolean;
};

const DEFAULT_ALLOWED_TAGS = ['p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'h2', 'h3', 'br'];
const DEFAULT_FORBIDDEN_TAGS = ['h4', 'script', 'style', 'iframe', 'object', 'embed'];
const BLOCK_TEXT_SELECTORS = ['p', 'li', 'h2', 'h3'];
const MARKDOWN_LEFTOVER_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\*\*/u, message: 'Contains leftover bold markdown markers (**).' },
  { pattern: /__/u, message: 'Contains leftover bold markdown markers (__).' },
  { pattern: /`/u, message: 'Contains leftover backticks.' },
  { pattern: /^\s{0,3}#{1,6}\s+/mu, message: 'Contains leftover markdown heading markers.' },
  { pattern: /\[[^\]]+\]\([^)]+\)/u, message: 'Contains leftover markdown links.' },
];

function getDocumentFromHtml(html: string): Document {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(html, 'text/html');
  }
  throw new Error('DOMParser is unavailable in this environment.');
}

function firstMeaningfulCharacter(text: string): string | null {
  const match = text.trim().match(/[A-Za-z]/u);
  return match ? match[0] : null;
}

function hasWrapperQuotes(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  const start = trimmed[0];
  const end = trimmed[trimmed.length - 1];
  return (start === '"' && end === '"') || (start === '\'' && end === '\'');
}

export function validateHtmlPolicy(html: string, options: HtmlValidationOptions = {}): HtmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowedTags = new Set((options.allowedTags ?? DEFAULT_ALLOWED_TAGS).map(tag => tag.toLowerCase()));
  const forbiddenTags = new Set((options.forbiddenTags ?? DEFAULT_FORBIDDEN_TAGS).map(tag => tag.toLowerCase()));
  const requireCapitalizedTextStart = options.requireCapitalizedTextStart ?? true;

  if (!html.trim()) {
    return { passed: false, errors: ['HTML output is empty.'], warnings };
  }

  if (hasWrapperQuotes(html)) {
    errors.push('HTML output is wrapped in stray quotes.');
  }

  const doc = getDocumentFromHtml(html);
  const bodyHtml = doc.body.innerHTML;
  const bodyText = doc.body.textContent?.trim() ?? '';

  if (!bodyText) {
    errors.push('HTML output does not contain visible text.');
  }

  for (const { pattern, message } of MARKDOWN_LEFTOVER_PATTERNS) {
    if (pattern.test(bodyHtml)) errors.push(message);
  }

  const allElements = Array.from(doc.body.querySelectorAll('*'));

  for (const element of allElements) {
    const tag = element.tagName.toLowerCase();
    if (forbiddenTags.has(tag)) {
      errors.push(`Forbidden tag <${tag}> detected.`);
    }
    if (!allowedTags.has(tag)) {
      errors.push(`Unexpected tag <${tag}> detected.`);
    }
    if (hasWrapperQuotes(element.outerHTML)) {
      errors.push(`Element <${tag}> is wrapped in stray quotes.`);
    }
  }

  for (const selector of BLOCK_TEXT_SELECTORS) {
    for (const el of Array.from(doc.body.querySelectorAll(selector))) {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim() ?? '';
      if (!text) {
        errors.push(`Empty <${tag}> element detected.`);
        continue;
      }
      if (requireCapitalizedTextStart) {
        const first = firstMeaningfulCharacter(text);
        if (first && first !== first.toUpperCase()) {
          errors.push(`Text inside <${tag}> must start with a capital letter.`);
        }
      }
    }
  }

  for (const link of Array.from(doc.body.querySelectorAll('a'))) {
    const href = link.getAttribute('href')?.trim() ?? '';
    if (!href) {
      errors.push('Anchor tag is missing href.');
      continue;
    }
    if (/^javascript:/iu.test(href)) {
      errors.push('Anchor tag uses a forbidden javascript: href.');
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
