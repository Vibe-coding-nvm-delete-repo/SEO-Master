/**
 * Token Management search helpers.
 *
 * Users can enter comma-separated partial tokens, e.g.:
 *   "foo, bar" -> matches any token that includes "foo" OR includes "bar".
 */
export function parseTokenMgmtSearchTerms(input: string): string[] {
  return input
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function tokenIncludesAnyTerm(token: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const tokenLower = token.toLowerCase();
  for (const term of terms) {
    if (tokenLower.includes(term.toLowerCase())) return true;
  }
  return false;
}

