import { CATEGORIES } from '@cadenza/shared';
import { addWord, loadDictionary, saveDictionary, validWord } from '../../lib/dictionary';
import { type IgnoreRule, loadIgnored, ruleKey, saveIgnored } from '../../lib/ignored';
import { loadSettings, saveSettings } from '../../lib/settings';
import { normalizeSite } from '../../lib/sites';
import { $, button, row } from './dom';

// ---- Dictionary --------------------------------------------------------------------------

export async function renderDictionary() {
  const words = (await loadDictionary()).slice().reverse();
  $('dictionary-list').replaceChildren(
    ...words.map((w) =>
      row(
        w,
        null,
        button(
          'Remove',
          async () => {
            const lower = w.toLowerCase();
            await saveDictionary((await loadDictionary()).filter((x) => x.toLowerCase() !== lower));
          },
          `Remove ${w} from the dictionary`,
        ),
      ),
    ),
  );
}

export function wireDictionary() {
  const input = $<HTMLInputElement>('dictionary-word');
  const message = $('dictionary-message');
  $('dictionary-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = input.value.trim();
    if (!validWord(word)) {
      message.textContent = 'Enter a single word, without spaces.';
      return;
    }
    message.textContent = '';
    await addWord(word);
    input.value = '';
  });
}

// ---- Sites -------------------------------------------------------------------------------

export async function renderSites() {
  const { disabledSites } = await loadSettings();
  $('sites-list').replaceChildren(
    ...disabledSites.map((site) =>
      row(
        site,
        null,
        button(
          'Turn on',
          async () => {
            const s = await loadSettings();
            await saveSettings({ ...s, disabledSites: s.disabledSites.filter((d) => d !== site) });
          },
          `Turn Cadenza on for ${site}`,
        ),
      ),
    ),
  );
}

export function wireSites() {
  const input = $<HTMLInputElement>('site-input');
  const message = $('sites-message');
  $('sites-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const site = normalizeSite(input.value);
    if (!site) {
      message.textContent = 'Enter a site such as example.com.';
      return;
    }
    message.textContent = '';
    const s = await loadSettings();
    if (!s.disabledSites.includes(site)) {
      await saveSettings({ ...s, disabledSites: [...s.disabledSites, site] });
    }
    input.value = '';
  });
}

// ---- Ignored -----------------------------------------------------------------------------

export async function renderIgnored() {
  const rules = (await loadIgnored()).reverse();
  $('ignored-empty').hidden = rules.length > 0;
  $('ignored-list').replaceChildren(
    ...rules.map((rule) =>
      row(
        rule.original,
        CATEGORIES[rule.category].label,
        button('Remove', () => void unignore(rule), `Stop ignoring ${rule.original}`),
      ),
    ),
  );
}

async function unignore(rule: IgnoreRule) {
  const key = ruleKey(rule);
  await saveIgnored((await loadIgnored()).filter((r) => ruleKey(r) !== key));
}
