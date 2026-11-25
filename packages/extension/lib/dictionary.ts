import type { Suggestion } from '@cadenza/shared';
import { browser } from 'wxt/browser';

/**
 * Personal dictionary: words the user says are spelled right (names, jargon). A correctness
 * suggestion that would change one of them is dropped; one that keeps it (a grammar fix
 * elsewhere in the span) still shows. Matching ignores case. Stored in `storage.local`, which
 * content scripts can't read; they ask the worker to add a word.
 */

const KEY = 'dictionary';
const MAX_WORDS = 5000;
const WORD = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’.-]{0,63}$/u;
const TOKENS = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’.-]*/gu;

export function validWord(word: unknown): word is string {
  return typeof word === 'string' && WORD.test(word) && !/[.'’-]$/.test(word);
}

/** The word a suggestion is about, if it flags exactly one word for spelling. */
export function dictionaryWord(s: Suggestion): string | null {
  if (s.category !== 'correctness') return null;
  if (s.subtype && !/spell|typo|misspell/i.test(s.subtype)) return null;
  return validWord(s.original) ? s.original : null;
}

export async function loadDictionary(): Promise<string[]> {
  const stored = (await browser.storage.local.get(KEY))[KEY];
  return Array.isArray(stored) ? (stored as string[]) : [];
}

export async function saveDictionary(words: string[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: words });
}

/** Add a word (newest last); false if it isn't a valid word. */
export async function addWord(word: unknown): Promise<boolean> {
  if (!validWord(word)) return false;
  const words = await loadDictionary();
  const lower = word.toLowerCase();
  const kept = words.filter((w) => w.toLowerCase() !== lower);
  kept.push(word);
  await saveDictionary(kept.slice(-MAX_WORDS));
  return true;
}

/** Remove a word, whatever its case (settings, or Undo on the card that added it). */
export async function removeWord(word: unknown): Promise<boolean> {
  if (!validWord(word)) return false;
  const lower = word.toLowerCase();
  const words = await loadDictionary();
  const kept = words.filter((w) => w.toLowerCase() !== lower);
  if (kept.length !== words.length) await saveDictionary(kept);
  return true;
}

function tokens(text: string): Set<string> {
  return new Set(
    Array.from(text.matchAll(TOKENS), (m) => m[0].replace(/[.'’-]+$/, '').toLowerCase()),
  );
}

export function withoutDictionary(suggestions: Suggestion[], words: string[]): Suggestion[] {
  if (words.length === 0) return suggestions;
  const dict = new Set(words.map((w) => w.toLowerCase()));
  return suggestions.filter((s) => {
    if (s.category !== 'correctness') return true;
    const kept = tokens(s.replacement);
    for (const t of tokens(s.original)) if (dict.has(t) && !kept.has(t)) return false;
    return true;
  });
}
