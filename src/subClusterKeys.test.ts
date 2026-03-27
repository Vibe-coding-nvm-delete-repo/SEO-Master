import { describe, it, expect } from 'vitest';
import { parseSubClusterKey } from './subClusterKeys';

describe('parseSubClusterKey', () => {
  it('splits on first separator only', () => {
    expect(parseSubClusterKey('g1::tokens::with::colons')).toEqual({
      groupId: 'g1',
      clusterTokens: 'tokens::with::colons',
    });
  });

  it('handles simple keys', () => {
    expect(parseSubClusterKey('abc::foo bar')).toEqual({
      groupId: 'abc',
      clusterTokens: 'foo bar',
    });
  });

  it('returns null when malformed', () => {
    expect(parseSubClusterKey('noseparator')).toBeNull();
    expect(parseSubClusterKey('::onlytokens')).toBeNull();
  });
});
