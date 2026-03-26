import { describe, it, expect } from 'vitest';
import { detectForeignEntity, normalizeKeywordToSignature, stem } from './processing';

const normalizeKeyword = (keyword: string): string => normalizeKeywordToSignature(keyword.toLowerCase());

describe('Singularize-first pipeline', () => {

  describe('Plural forms should match their singular synonym', () => {
    it('"lawyers" and "attorney" should produce the same signature', () => {
      // lawyers → singularize → lawyer → synonym → attorney
      // attorney → singularize → attorney (no change) → no synonym match → attorney
      const sig1 = normalizeKeyword('lawyers');
      const sig2 = normalizeKeyword('attorney');
      expect(sig1).toBe(sig2);
    });

    it('"companies" and "firm" should produce the same signature', () => {
      const sig1 = normalizeKeyword('companies');
      const sig2 = normalizeKeyword('firm');
      expect(sig1).toBe(sig2);
    });

    it('"businesses" and "agency" should produce different signatures', () => {
      const sig1 = normalizeKeyword('businesses');
      const sig2 = normalizeKeyword('agency');
      expect(sig1).not.toBe(sig2);
    });

    it('"photos" and "image" should produce the same signature', () => {
      const sig1 = normalizeKeyword('photos');
      const sig2 = normalizeKeyword('image');
      expect(sig1).toBe(sig2);
    });

    it('"reviews" and "rating" should produce the same signature', () => {
      const sig1 = normalizeKeyword('reviews');
      const sig2 = normalizeKeyword('rating');
      expect(sig1).toBe(sig2);
    });

    it('"coupons" and "discount" should produce the same signature', () => {
      const sig1 = normalizeKeyword('coupons');
      const sig2 = normalizeKeyword('discount');
      expect(sig1).toBe(sig2);
    });

    it('"developers" and "programmer" should produce the same signature', () => {
      const sig1 = normalizeKeyword('developers');
      const sig2 = normalizeKeyword('programmer');
      expect(sig1).toBe(sig2);
    });

    it('"doctors" and "physician" should produce the same signature', () => {
      const sig1 = normalizeKeyword('doctors');
      const sig2 = normalizeKeyword('physician');
      expect(sig1).toBe(sig2);
    });
  });

  describe('Multi-word keywords should cluster correctly', () => {
    it('"best lawyers near me" and "top attorney nearby" should match', () => {
      // best→top, lawyers→lawyer→attorney, near/nearby→ignored
      const sig1 = normalizeKeyword('best lawyers near me');
      const sig2 = normalizeKeyword('top attorney nearby');
      expect(sig1).toBe(sig2);
    });

    it('"cheap businesses for sale" and "affordable company sale" should match', () => {
      const sig1 = normalizeKeyword('cheap businesses for sale');
      const sig2 = normalizeKeyword('affordable company sale');
      // cheap→affordable, company→business, for→stop word, sale→discount
      expect(sig1).toBe(sig2);
    });

    it('"how to guides" and "tutorial" should match (deduped)', () => {
      // "how to" → tutorial, guides → guide → tutorial
      // Both map to "tutorial", deduped in signature = "tutorial"
      const sig1 = normalizeKeyword('how to guides');
      const sig2 = normalizeKeyword('tutorial');
      expect(sig1).toBe('tutorial');
      expect(sig1).toBe(sig2);
    });
  });

  describe('Singular forms should still work (no double-singularize issues)', () => {
    it('"lawyer" should still map to "attorney"', () => {
      const sig = normalizeKeyword('lawyer');
      expect(sig).toBe('attorney');
    });

    it('"business" should remain "business"', () => {
      const sig = normalizeKeyword('business');
      expect(sig).toBe('business');
    });

    it('"photo" should still map to "image"', () => {
      const sig = normalizeKeyword('photo');
      expect(sig).toBe('image');
    });

    it('"coupon" should still map to "discount"', () => {
      const sig = normalizeKeyword('coupon');
      expect(sig).toBe('discount');
    });
  });

  describe('Non-synonym words should still singularize', () => {
    it('"loans" should become "loan"', () => {
      const sig = normalizeKeyword('loans');
      expect(sig).toBe('loan');
    });

    it('"payday loans online" should become "loan online payday" (sorted)', () => {
      // payday→payday, loans→loan, online stays (site→online but online stays)
      const sig = normalizeKeyword('payday loans online');
      expect(sig).toBe('loan online payday');
    });

    it('"credit cards" should become "card credit"', () => {
      const sig = normalizeKeyword('credit cards');
      expect(sig).toBe('card credit');
    });
  });

  describe('24/7 and number normalization', () => {
    it('"24/7 service" should normalize', () => {
      const sig = normalizeKeyword('24/7 service');
      expect(sig).toBe('24hour service');
    });

    it('"24 hour service" should match "24/7 service"', () => {
      const sig1 = normalizeKeyword('24 hour service');
      const sig2 = normalizeKeyword('24/7 service');
      expect(sig1).toBe(sig2);
    });

    it('"24 hr service" should match "24/7 service"', () => {
      const sig1 = normalizeKeyword('24 hr service');
      const sig2 = normalizeKeyword('24/7 service');
      expect(sig1).toBe(sig2);
    });
  });

  describe('Compound normalization', () => {
    it('"sign in" and "signin" should match', () => {
      expect(normalizeKeyword('sign in')).toBe(normalizeKeyword('signin'));
    });

    it('"log in" and "login" should match', () => {
      expect(normalizeKeyword('log in')).toBe(normalizeKeyword('login'));
    });

    it('"check out" and "checkout" should match', () => {
      expect(normalizeKeyword('check out')).toBe(normalizeKeyword('checkout'));
    });

    it('"health care" and "healthcare" should match', () => {
      expect(normalizeKeyword('health care')).toBe(normalizeKeyword('healthcare'));
    });

    it('"day care" and "daycare" should match', () => {
      expect(normalizeKeyword('day care')).toBe(normalizeKeyword('daycare'));
    });
  });

  describe('Acronym normalization', () => {
    it('"faq" and "frequently asked questions" should match', () => {
      expect(normalizeKeyword('faq')).toBe(normalizeKeyword('frequently asked questions'));
    });

    it('"crm" and "customer relationship management" should match', () => {
      expect(normalizeKeyword('crm')).toBe(normalizeKeyword('customer relationship management'));
    });

    it('"seo" and "search engine optimization" should match', () => {
      expect(normalizeKeyword('seo')).toBe(normalizeKeyword('search engine optimization'));
    });
  });

  describe('Symbol and possessive normalization', () => {
    it('"womens clinic" and "women\'s clinic" should match', () => {
      expect(normalizeKeyword('womens clinic')).toBe(normalizeKeyword("women's clinic"));
    });

    it('"mens shoes" and "men\'s shoes" should match', () => {
      expect(normalizeKeyword('mens shoes')).toBe(normalizeKeyword("men's shoes"));
    });

    it('"a & b testing" and "a and b testing" should match', () => {
      expect(normalizeKeyword('a & b testing')).toBe(normalizeKeyword('a and b testing'));
    });
  });

  describe('Stop words and ignored tokens are removed', () => {
    it('"what is the best" should reduce to "top what"', () => {
      // what→not a stop word (used for FAQ labeling), is→stop, the→stop, best→top
      const sig = normalizeKeyword('what is the best');
      expect(sig).toBe('top what');
    });

    it('"loans near me" should reduce to "loan"', () => {
      // loans→loan, near→ignored, me→stop
      const sig = normalizeKeyword('loans near me');
      expect(sig).toBe('loan');
    });
  });

  describe('State normalization', () => {
    it('"loans california" should normalize state to abbreviation', () => {
      const sig = normalizeKeyword('loans california');
      expect(sig).toBe('ca loan');
    });

    it('"new york attorney" should normalize state', () => {
      const sig = normalizeKeyword('new york attorney');
      expect(sig).toBe('attorney ny');
    });
  });

  describe('Edge cases', () => {
    it('empty string should return empty', () => {
      expect(normalizeKeyword('')).toBe('');
    });

    it('only stop words should return empty', () => {
      expect(normalizeKeyword('the is a')).toBe('');
    });

    it('"us" should not be singularized (uncountable rule)', () => {
      const sig = normalizeKeyword('loans us');
      expect(sig).toBe('loan');
    });
  });

  describe('#3: Hyphen/spacing normalization', () => {
    it('"re-finance" and "refinance" should produce the same signature', () => {
      expect(normalizeKeyword('re-finance')).toBe(normalizeKeyword('refinance'));
    });

    it('"pre-approval" and "preapproval" should match', () => {
      expect(normalizeKeyword('pre-approval')).toBe(normalizeKeyword('preapproval'));
    });

    it('"non-profit" and "nonprofit" should match', () => {
      expect(normalizeKeyword('non-profit')).toBe(normalizeKeyword('nonprofit'));
    });

    it('"un secured loan" and "unsecured loan" should match', () => {
      expect(normalizeKeyword('un secured loan')).toBe(normalizeKeyword('unsecured loan'));
    });

    it('"e-mail" and "email" should match', () => {
      expect(normalizeKeyword('e-mail')).toBe(normalizeKeyword('email'));
    });

    it('"co-signer" and "cosigner" should match', () => {
      expect(normalizeKeyword('co-signer')).toBe(normalizeKeyword('cosigner'));
    });
  });

  describe('#10: Local intent unification', () => {
    it('"plumber near me" and "plumber nearby" should match', () => {
      expect(normalizeKeyword('plumber near me')).toBe(normalizeKeyword('plumber nearby'));
    });

    it('"plumber close to me" and "plumber near me" should match', () => {
      expect(normalizeKeyword('plumber close to me')).toBe(normalizeKeyword('plumber near me'));
    });

    it('"plumber in my area" and "plumber nearby" should match', () => {
      expect(normalizeKeyword('plumber in my area')).toBe(normalizeKeyword('plumber nearby'));
    });

    it('"lawyer around me" and "lawyer near me" should match', () => {
      expect(normalizeKeyword('lawyer around me')).toBe(normalizeKeyword('lawyer near me'));
    });

    it('"dentist next to me" and "dentist nearby" should match', () => {
      expect(normalizeKeyword('dentist next to me')).toBe(normalizeKeyword('dentist nearby'));
    });
  });

  describe('#1: Lightweight stemmer', () => {
    it('"installing" and "install" should produce the same signature', () => {
      expect(normalizeKeyword('installing')).toBe(normalizeKeyword('install'));
    });

    it('"installed" and "install" should match', () => {
      expect(normalizeKeyword('installed')).toBe(normalizeKeyword('install'));
    });

    it('"installer" and "install" should match', () => {
      expect(normalizeKeyword('installer')).toBe(normalizeKeyword('install'));
    });

    it('"refinancing" and "refinance" should match (both become "refinance")', () => {
      const sig1 = normalizeKeyword('refinancing');
      const sig2 = normalizeKeyword('refinance');
      expect(sig1).toBe(sig2);
      expect(sig1).toBe('refinance');
    });

    it('"affordable" and "afford" should match', () => {
      // "affordable" → synonym → "affordable" (since "cheap"→"affordable" but not reverse)
      // Actually "affordable" is a target, not a source — it stays. Let's test stemming directly.
      expect(stem('affordable')).toBe('afford');
    });

    it('"quickly" and "quick" should produce same stem', () => {
      expect(stem('quickly')).toBe('quick');
    });

    it('"helpful" and "help" should produce same stem', () => {
      expect(stem('helpful')).toBe('help');
    });

    it('"running" should stem to "run" (doubled consonant)', () => {
      expect(stem('running')).toBe('run');
    });

    it('"getting" should stem to "get" (doubled consonant)', () => {
      expect(stem('getting')).toBe('get');
    });

    it('should NOT stem exception words', () => {
      expect(stem('meeting')).toBe('meeting');
      expect(stem('morning')).toBe('morning');
      expect(stem('payment')).toBe('payment');
      expect(stem('business')).toBe('business');
      expect(stem('nation')).toBe('nation');
    });

    it('should NOT stem words shorter than 4 chars', () => {
      expect(stem('ran')).toBe('ran');
      expect(stem('the')).toBe('the');
    });

    it('"application" should stem via -ation', () => {
      expect(stem('application')).toBe('applic');
    });

    it('"darkness" should stem via -ness', () => {
      expect(stem('darkness')).toBe('dark');
    });
  });

  describe('#5: Expanded synonyms', () => {
    it('"free plumber" and "no cost plumber" should match', () => {
      expect(normalizeKeyword('free plumber')).toBe(normalizeKeyword('no cost plumber'));
    });

    it('"help with loan" and "assistance with loan" should match', () => {
      expect(normalizeKeyword('help with loan')).toBe(normalizeKeyword('assistance with loan'));
    });

    it('"big house" and "large house" should match', () => {
      expect(normalizeKeyword('big house')).toBe(normalizeKeyword('large house'));
    });

    it('"used car" and "pre owned car" should match', () => {
      expect(normalizeKeyword('used car')).toBe(normalizeKeyword('pre owned car'));
    });

    it('"estimate" and "quote" should match', () => {
      expect(normalizeKeyword('estimate')).toBe(normalizeKeyword('quote'));
    });

    it('"start" and "begin" should match', () => {
      expect(normalizeKeyword('start')).toBe(normalizeKeyword('begin'));
    });

    it('"choose" and "select" should match', () => {
      expect(normalizeKeyword('choose')).toBe(normalizeKeyword('select'));
    });

    it('"local plumber" and "nearby plumber" should match', () => {
      expect(normalizeKeyword('local plumber')).toBe(normalizeKeyword('nearby plumber'));
    });

    it('"contractor" and "provider" should not match', () => {
      expect(normalizeKeyword('contractor')).not.toBe(normalizeKeyword('provider'));
    });

    it('"deal" and "discount" should match', () => {
      expect(normalizeKeyword('deal')).toBe(normalizeKeyword('discount'));
    });
  });

  describe('#7: Misspelling correction', () => {
    it('"morgage" should correct to "mortgage"', () => {
      expect(normalizeKeyword('morgage rates')).toBe(normalizeKeyword('mortgage rates'));
    });

    it('"refinace" should correct to "refinance"', () => {
      expect(normalizeKeyword('refinace loan')).toBe(normalizeKeyword('refinance loan'));
    });

    it('"attourney" should correct to "attorney"', () => {
      expect(normalizeKeyword('attourney')).toBe(normalizeKeyword('attorney'));
    });

    it('"insurence" should correct to "insurance"', () => {
      expect(normalizeKeyword('insurence quote')).toBe(normalizeKeyword('insurance quote'));
    });

    it('"bankrupcy" should correct to "bankruptcy"', () => {
      expect(normalizeKeyword('bankrupcy lawyer')).toBe(normalizeKeyword('bankruptcy lawyer'));
    });

    it('"bussiness" should correct to "business"', () => {
      expect(normalizeKeyword('bussiness loan')).toBe(normalizeKeyword('business loan'));
    });

    it('"restaraunt" should correct to "restaurant"', () => {
      expect(normalizeKeyword('restaraunt nearby')).toBe(normalizeKeyword('restaurant nearby'));
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Foreign Entity Detection Tests
// ──────────────────────────────────────────────────────────────────────

const detectForeignEntity2 = (keywordLower: string): string | null => {
  const match = detectForeignEntity(keywordLower);
  return match ? match.toLowerCase() : null;
};

describe('Foreign Entity Detection — Edge Cases', () => {

  describe('Should NOT block US cities/states with foreign-sounding names', () => {
    it('"panama city fl plumber" — Panama City is a US city', () => {
      expect(detectForeignEntity2('panama city fl plumber')).toBeNull();
    });

    it('"panama city florida" — has US state', () => {
      expect(detectForeignEntity2('panama city florida')).toBeNull();
    });

    it('"vancouver wa plumber" — Vancouver, WA', () => {
      expect(detectForeignEntity2('vancouver wa plumber')).toBeNull();
    });

    it('"vancouver washington" — has US state name', () => {
      expect(detectForeignEntity2('vancouver washington')).toBeNull();
    });

    it('"grenada ms" — Grenada, MS', () => {
      expect(detectForeignEntity2('grenada ms')).toBeNull();
    });

    it('"mexico mo plumber" — Mexico, MO', () => {
      expect(detectForeignEntity2('mexico mo plumber')).toBeNull();
    });

    it('"new mexico plumber" — US state', () => {
      expect(detectForeignEntity2('new mexico plumber')).toBeNull();
    });

    it('"peru indiana" — Peru, IN', () => {
      expect(detectForeignEntity2('peru indiana')).toBeNull();
    });

    it('"lebanon pa" — Lebanon, PA', () => {
      expect(detectForeignEntity2('lebanon pa')).toBeNull();
    });

    it('"paris tx" — Paris, TX', () => {
      expect(detectForeignEntity2('paris tx')).toBeNull();
    });

    it('"london ky" — London, KY', () => {
      expect(detectForeignEntity2('london ky')).toBeNull();
    });

    it('"rome ga" — Rome, GA', () => {
      expect(detectForeignEntity2('rome ga')).toBeNull();
    });

    it('"moscow idaho" — Moscow, ID', () => {
      expect(detectForeignEntity2('moscow idaho')).toBeNull();
    });

    it('"melbourne fl" — Melbourne, FL', () => {
      expect(detectForeignEntity2('melbourne fl')).toBeNull();
    });

    it('"troy ny" — Troy, NY', () => {
      expect(detectForeignEntity2('troy ny')).toBeNull();
    });

    it('"lima ohio" — Lima, OH', () => {
      expect(detectForeignEntity2('lima ohio')).toBeNull();
    });
  });

  describe('Should still block actual foreign keywords', () => {
    it('"plumber london" — London without US state = ambiguous but London is a US city too', () => {
      // London is in US cities list (London, KY / London, OH)
      expect(detectForeignEntity2('plumber london')).toBeNull();
    });

    it('"plumber tokyo" — Tokyo is not a US city', () => {
      expect(detectForeignEntity2('plumber tokyo')).toBe('tokyo');
    });

    it('"dubai real estate" — clearly foreign', () => {
      expect(detectForeignEntity2('dubai real estate')).toBe('dubai');
    });

    it('"toronto canada" — Toronto + Canada = foreign', () => {
      // toronto is ambiguous but "canada" confirms foreign context
      // regex matches first foreign term found — either works, just verify it blocks
      expect(detectForeignEntity2('toronto canada')).not.toBeNull();
    });

    it('"sydney australia" — clearly foreign', () => {
      expect(detectForeignEntity2('sydney australia')).not.toBeNull();
    });

    it('"best plumber india" — clearly foreign', () => {
      expect(detectForeignEntity2('best plumber india')).toBe('india');
    });

    it('"panama travel" — Panama without US state context = foreign country', () => {
      // "panama" is NOT in US cities list standalone → blocks
      expect(detectForeignEntity2('panama travel')).toBe('panama');
    });
  });
});
