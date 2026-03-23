// processing.ts — Extracted processing utilities from App.tsx
// Contains city/state lookups, foreign detection, stemming, regex patterns, and helper functions.

import pluralize from 'pluralize';
import { numberMap, stateMap, stateAbbrToFull, stateFullNames, synonymMap, stopWords, ignoredTokens, countries, foreignCountries, foreignCities, misspellingMap } from './dictionaries';
import citiesList from '../us-cities.json';

pluralize.addUncountableRule('us');

// Create a set for fast city lookups
export const citySet = new Set<string>();
export const cityFirstWords = new Map<string, number>(); // word -> max length of city starting with this word

citiesList.forEach((c: string) => {
  const normalized = c.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalized) return;

  citySet.add(normalized);
  const words = normalized.split(' ');
  const firstWord = words[0];
  const currentMax = cityFirstWords.get(firstWord) || 0;
  if (words.length > currentMax) {
    cityFirstWords.set(firstWord, words.length);
  }

  if (c.includes("'") || c.includes("-")) {
    const noPunctuation = c.toLowerCase().replace(/['\-]/g, '').replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    if (noPunctuation && noPunctuation !== normalized) {
      citySet.add(noPunctuation);
      const wordsNP = noPunctuation.split(' ');
      const firstWordNP = wordsNP[0];
      const currentMaxNP = cityFirstWords.get(firstWordNP) || 0;
      if (wordsNP.length > currentMaxNP) {
        cityFirstWords.set(firstWordNP, wordsNP.length);
      }
    }
  }
});

// Create a set for fast state lookups (both full names and abbreviations)
export const stateSet = new Set([
  ...Object.keys(stateMap),
  ...Object.values(stateMap)
]);

const statePattern = Object.keys(stateMap)
  .sort((a, b) => b.length - a.length)
  .map(state => state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
export const stateRegex = new RegExp(`\\b(${statePattern})\\b`, 'g');

// Helper: capitalize each word (e.g. "san francisco" → "San Francisco")
export const capitalizeWords = (s: string): string =>
  s.replace(/\b\w/g, c => c.toUpperCase());

// Helper: normalize any state match to full capitalized spelling
export const normalizeState = (raw: string): string => {
  const lower = raw.toLowerCase();
  // If it's an abbreviation, use reverse map
  if (stateAbbrToFull[lower]) return stateAbbrToFull[lower];
  // If it's a full name, capitalize it
  if (stateMap[lower]) return capitalizeWords(lower);
  return capitalizeWords(lower);
};

// Pre-build foreign detection patterns for fast matching
const foreignCountryPatterns = Array.from(foreignCountries)
  .sort((a, b) => b.length - a.length)
  .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const foreignCityPatterns = Array.from(foreignCities)
  .sort((a, b) => b.length - a.length)
  .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const foreignRegex = new RegExp(`\\b(${[...foreignCountryPatterns, ...foreignCityPatterns].join('|')})\\b`, 'i');

// US city/state names that overlap with foreign country/city names — never block these alone
const ambiguousNames = new Set([
  // Foreign countries that are also US city names
  'panama', 'grenada', 'mexico', 'peru', 'lebanon', 'jamaica', 'cuba', 'jordan',
  'turkey', 'china', 'malta', 'chad', 'colombia', 'dominica', 'guinea', 'monaco',
  'trinidad', 'haiti', 'honduras', 'niger',
  // Foreign cities that are also US city names
  'london', 'paris', 'melbourne', 'rome', 'amsterdam', 'delhi', 'moscow',
  'vancouver', 'perth', 'naples', 'florence', 'dublin', 'geneva', 'troy',
  'lima', 'canton', 'athens', 'ontario', 'kingston', 'hamilton', 'manchester',
  'plymouth', 'bristol', 'windsor', 'montreal', 'toronto',
]);

// Helper: check if keyword contains a foreign country or city
export const detectForeignEntity = (keywordLower: string): string | null => {
  const match = keywordLower.match(foreignRegex);
  if (!match) return null;
  const matched = match[1].toLowerCase();

  // If the matched name is ambiguous (also a US city), check for US context
  if (ambiguousNames.has(matched)) {
    // If keyword contains a US state name or abbreviation → it's US, don't block
    const tokens = keywordLower.split(/[^a-z0-9]+/);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t || t === matched) continue;
      // Check single-word state abbreviation or full name
      if (stateAbbrToFull[t] || stateFullNames.has(t)) return null;
      // Check two-word state names
      if (i < tokens.length - 1 && tokens[i+1]) {
        const twoWord = `${t} ${tokens[i+1]}`;
        if (stateFullNames.has(twoWord)) return null;
      }
    }
    // Check if keyword contains "near me", "fl", state-like context clues
    // Also check if the ambiguous name + next word forms a known US city (e.g., "panama city")
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === matched && i < tokens.length - 1) {
        const combined = `${matched} ${tokens[i+1]}`;
        if (citySet.has(combined)) return null; // "panama city" is a US city
      }
    }
    // If the matched name itself is in the US cities list as a standalone city, don't block
    if (citySet.has(matched)) return null;
  }

  // "new mexico" is a US state — never block
  if (matched === 'mexico' && keywordLower.includes('new mexico')) return null;

  return capitalizeWords(match[1]);
};

export const synonymPattern = Object.keys(synonymMap)
  .sort((a, b) => b.length - a.length)
  .map(syn => syn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
export const synonymRegex = new RegExp(`\\b(${synonymPattern})\\b`, 'g');

const multiWordLocationsPattern = Array.from(countries)
  .filter(c => c.includes(' '))
  .sort((a, b) => b.length - a.length)
  .map(loc => loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
export const multiWordLocationsRegex = new RegExp(`\\b(${multiWordLocationsPattern})\\b`, 'g');

export const pluralizeCache = new Map<string, string>();

// Misspelling correction regex
const misspellingPattern = Object.keys(misspellingMap)
  .sort((a, b) => b.length - a.length)
  .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
export const misspellingRegex = new RegExp(`\\b(${misspellingPattern})\\b`, 'g');

// #3: Hyphen/spacing normalization — join known prefixes with their root
export const prefixPattern = /\b(re|pre|un|non|anti|co|over|under|semi|multi|sub|out|mis|dis)\s*[-\s]\s*([a-z]{3,})\b/g;

// #10: Local intent phrases → unified __local__ token
const localIntentPhrases = [
  'near me', 'close to me', 'in my area', 'around me', 'next to me',
  'close by', 'closest to me', 'nearest to me',
];
const localIntentPattern = localIntentPhrases
  .sort((a, b) => b.length - a.length)
  .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
export const localIntentRegex = new RegExp(`\\b(${localIntentPattern})\\b`, 'g');

// #1: Lightweight stemmer — strip common suffixes to root form
const stemCache = new Map<string, string>();
// Words that should NOT be stemmed (stemming changes meaning)
const stemExceptions = new Set([
  'meeting', 'being', 'thing', 'nothing', 'something', 'everything', 'anything',
  'during', 'morning', 'evening', 'spring', 'string', 'ring', 'king', 'bring',
  'sing', 'wing', 'swing', 'cling', 'fling', 'ceiling', 'feeling', 'dealing',
  'billing', 'filing', 'mining', 'dining', 'lining', 'timing', 'rating',
  'listing', 'setting', 'letting', 'sitting', 'putting', 'cutting',
  'planning', 'beginning', 'winning', 'shipping', 'shopping',
  'mapping', 'tipping', 'topping', 'popping', 'dropping', 'stopping',
  'nation', 'station', 'ration', 'fashion', 'mention', 'section', 'action',
  'option', 'portion', 'caution', 'auction', 'function', 'junction',
  'condition', 'position', 'addition', 'tradition', 'ambition', 'nutrition',
  'able', 'table', 'cable', 'stable', 'fable', 'noble', 'bible', 'double', 'trouble',
  'single', 'simple', 'sample', 'example', 'temple', 'people', 'purple', 'little',
  'middle', 'bottle', 'battle', 'cattle', 'title', 'gentle', 'subtle', 'bundle',
  'handle', 'candle', 'noodle', 'needle', 'cradle', 'riddle', 'paddle', 'saddle',
  'agent', 'parent', 'client', 'patient', 'student', 'resident', 'president',
  'payment', 'moment', 'comment', 'element', 'segment', 'document', 'argument',
  'statement', 'apartment', 'department', 'equipment', 'requirement', 'management',
  'investment', 'government', 'environment', 'development', 'entertainment',
  'assessment', 'treatment', 'settlement', 'agreement', 'employment', 'adjustment',
  'replacement', 'improvement', 'achievement', 'announcement', 'advertisement',
  'ment', 'rent', 'sent', 'went', 'lent', 'bent', 'dent', 'tent', 'cent', 'vent',
  'ness', 'less', 'mess', 'press', 'dress', 'stress', 'access', 'process', 'success',
  'address', 'express', 'progress', 'congress', 'business',
  'fully', 'daily', 'early', 'family', 'only', 'apply', 'supply', 'reply', 'rely',
  'ally', 'tally', 'rally', 'valley', 'alley', 'volley', 'trolley', 'turkey',
]);

export function stem(word: string): string {
  if (word.length < 4) return word;
  if (stemExceptions.has(word)) return word;
  if (stemCache.has(word)) return stemCache.get(word)!;

  let result = word;

  // -ies → -y (but not if root < 3 chars)
  if (result.endsWith('ies') && result.length > 5) {
    result = result.slice(0, -3) + 'y';
  }
  // -ying → -y
  else if (result.endsWith('ying') && result.length > 5) {
    result = result.slice(0, -4) + 'y';
  }
  // -ation / -tion → strip (but verify root >= 3)
  else if (result.endsWith('ation') && result.length > 7) {
    result = result.slice(0, -5);
    // "ization" → root already stripped "ation", check if "iz" on end
    if (result.endsWith('iz')) result = result.slice(0, -2);
  }
  else if (result.endsWith('tion') && result.length > 6) {
    result = result.slice(0, -4);
  }
  // -ment → strip
  else if (result.endsWith('ment') && result.length > 6 && !stemExceptions.has(word)) {
    result = result.slice(0, -4);
  }
  // -ness → strip
  else if (result.endsWith('ness') && result.length > 6 && !stemExceptions.has(word)) {
    result = result.slice(0, -4);
  }
  // -able / -ible → strip
  else if ((result.endsWith('able') || result.endsWith('ible')) && result.length > 6 && !stemExceptions.has(word)) {
    result = result.slice(0, -4);
  }
  // -ful → strip
  else if (result.endsWith('ful') && result.length > 5) {
    result = result.slice(0, -3);
  }
  // -ly → strip (but not "ally", "ily" patterns that are base words)
  else if (result.endsWith('ly') && result.length > 4 && !stemExceptions.has(word)) {
    result = result.slice(0, -2);
  }
  // -ing → strip (handle doubling: "running"→"run" but NOT "installing"→"install")
  else if (result.endsWith('ing') && result.length > 5 && !stemExceptions.has(word)) {
    const base = result.slice(0, -3);
    // Only undouble if base is short (≤4 chars) — "runn"→"run" but not "install"→"instal"
    if (base.length <= 4 && base.length >= 3 && base[base.length - 1] === base[base.length - 2] && !/[aeiou]/.test(base[base.length - 1])) {
      result = base.slice(0, -1);
    } else if (base.length >= 3) {
      // If base ends in consonant and adding "e" makes a common pattern, use base+"e"
      // "refinanc"→"refinance", "mak"→"make", "financ"→"finance"
      const lastChar = base[base.length - 1];
      if (lastChar && !/[aeiou]/.test(lastChar) && !base.endsWith('ss') && !base.endsWith('ll')) {
        result = base + 'e';
      } else {
        result = base;
      }
    }
  }
  // -ed → strip (handle doubling)
  else if (result.endsWith('ed') && result.length > 4 && !stemExceptions.has(word)) {
    const base = result.slice(0, -2);
    if (base.length <= 4 && base.length >= 3 && base[base.length - 1] === base[base.length - 2] && !/[aeiou]/.test(base[base.length - 1])) {
      result = base.slice(0, -1);
    } else if (base.length >= 2) {
      result = base;
    }
  }
  // -er → strip (handle doubling)
  else if (result.endsWith('er') && result.length > 4 && !stemExceptions.has(word)) {
    const base = result.slice(0, -2);
    if (base.length <= 4 && base.length >= 3 && base[base.length - 1] === base[base.length - 2] && !/[aeiou]/.test(base[base.length - 1])) {
      result = base.slice(0, -1);
    } else if (base.length >= 3) {
      result = base;
    }
  }
  // -est → strip
  else if (result.endsWith('est') && result.length > 5) {
    const base = result.slice(0, -3);
    if (base.length <= 4 && base.length >= 3 && base[base.length - 1] === base[base.length - 2] && !/[aeiou]/.test(base[base.length - 1])) {
      result = base.slice(0, -1);
    } else if (base.length >= 3) {
      result = base;
    }
  }

  // Don't stem to less than 3 chars
  if (result.length < 3) result = word;

  stemCache.set(word, result);
  return result;
}

// Generate 100 distinct colors via golden-angle HSL rotation
export const getLabelColor = (index: number): { border: string; bg: string; text: string } => {
  const hue = (index * 137.5) % 360;
  return {
    border: `hsl(${hue}, 65%, 50%)`,
    bg: `hsl(${hue}, 65%, 94%)`,
    text: `hsl(${hue}, 65%, 30%)`,
  };
};
