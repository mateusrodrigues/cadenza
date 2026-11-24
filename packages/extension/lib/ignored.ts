import { CATEGORY_IDS, type Category, type Suggestion } from '@cadenza/shared';
import { browser } from 'wxt/browser';

/**
 * Text the user asked never to be flagged again ("Don't suggest this again"), per category.
 * Kept in `storage.local`, which only extension pages and the worker can read; content
 * scripts ask the worker to add an entry. The model's replacement varies from run to run, so
 * a rule matches on the flagged text alone.
 */
export interface IgnoreRule {
  category: Category;
  original: string;
}

const KEY = 'ignored';
const MAX_RULES = 2000;
const MAX_LENGTH = 500;

export function ruleKey(r: IgnoreRule): string {
  return `${r.category}\u0000${r.original}`;
}

export async function loadIgnored(): Promise<IgnoreRule[]> {
  const stored = (await browser.storage.local.get(KEY))[KEY];
  return Array.isArray(stored) ? (stored as IgnoreRule[]) : [];
}

export async function saveIgnored(rules: IgnoreRule[]): Promise<void> {
  await browser.storage.local.set({ [KEY]: rules });
}

/** Add a rule (newest last); returns false if it isn't a valid rule. */
export async function addIgnored(rule: IgnoreRule): Promise<boolean> {
  if (!validRule(rule)) return false;
  const rules = await loadIgnored();
  const key = ruleKey(rule);
  const kept = rules.filter((r) => ruleKey(r) !== key);
  kept.push({ category: rule.category, original: rule.original });
  await saveIgnored(kept.slice(-MAX_RULES));
  return true;
}

export function validRule(rule: unknown): rule is IgnoreRule {
  const r = rule as IgnoreRule | null;
  return (
    typeof r?.original === 'string' &&
    r.original.length > 0 &&
    r.original.length <= MAX_LENGTH &&
    (CATEGORY_IDS as readonly string[]).includes(r.category)
  );
}

export function withoutIgnored(suggestions: Suggestion[], rules: IgnoreRule[]): Suggestion[] {
  if (rules.length === 0) return suggestions;
  const keys = new Set(rules.map(ruleKey));
  return suggestions.filter((s) => !keys.has(ruleKey(s)));
}
