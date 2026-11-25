import { CATEGORIES } from '@cadenza/shared';
import { addWord, loadDictionary, removeWord, validWord } from '../../lib/dictionary';
import { icon, lineSample } from '../../lib/icons';
import { loadIgnored, removeIgnored } from '../../lib/ignored';
import { loadSettings, updateSettings } from '../../lib/settings';
import { normalizeSite, turnSiteOff, turnSiteOn } from '../../lib/sites';
import { today } from '../../lib/usage';
import { $, button, row, shortDay } from './dom';

// ---- Dictionary --------------------------------------------------------------------------

export async function renderDictionary() {
  const words = (await loadDictionary())
    .slice()
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  $('dictionary-empty').hidden = words.length > 0;
  $('dictionary-list').replaceChildren(
    ...words.map((w) => {
      const li = document.createElement('li');
      const word = Object.assign(document.createElement('span'), {
        className: 'word',
        textContent: w,
      });
      const remove = button('', () => void removeWord(w), `Remove ${w}`);
      remove.className = 'icon';
      remove.title = `Remove ${w}`;
      remove.append(icon('close'));
      li.append(word, remove);
      return li;
    }),
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
  const { disabledSites, siteOffSince } = await loadSettings();
  const now = today();
  $('sites-empty').hidden = disabledSites.length > 0;
  $('sites-list').replaceChildren(
    ...disabledSites.map((site) => {
      const since = siteOffSince[site];
      return row(
        site,
        since ? `Since ${shortDay(since, now)}` : null,
        button(
          'Turn on',
          async () => {
            await updateSettings((s) => turnSiteOn(s, site, true));
          },
          `Turn on for ${site}`,
        ),
      );
    }),
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
    await updateSettings((s) => turnSiteOff(s, site, today()));
    input.value = '';
  });
}

// ---- Ignored -----------------------------------------------------------------------------

export async function renderIgnored() {
  const rules = (await loadIgnored()).reverse();
  $('ignored-empty').hidden = rules.length > 0;
  $('ignored-foot').hidden = rules.length === 0;
  $('ignored-list').replaceChildren(
    ...rules.map((rule) => {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'ignored-row';
      const cat = document.createElement('span');
      cat.className = `cdz-cat cdz-cat--${rule.category}`;
      cat.append(lineSample(rule.category), CATEGORIES[rule.category].label);
      const change = document.createElement('span');
      change.className = 'change';
      change.append(Object.assign(document.createElement('del'), { textContent: rule.original }));
      // Rules saved before replacements were kept show the flagged text alone.
      if (rule.replacement !== undefined) {
        const arrow = Object.assign(document.createElement('span'), {
          className: 'arrow',
          textContent: '→',
        });
        arrow.setAttribute('aria-hidden', 'true');
        change.append(
          arrow,
          rule.replacement
            ? Object.assign(document.createElement('ins'), { textContent: rule.replacement })
            : Object.assign(document.createElement('span'), {
                className: 'arrow',
                textContent: 'remove',
              }),
        );
      }
      info.append(cat, change);
      if (rule.site) {
        info.append(
          Object.assign(document.createElement('span'), {
            className: 'from',
            textContent: `from ${rule.site}`,
          }),
        );
      }
      li.append(
        info,
        button('Restore', () => void removeIgnored(rule), `Restore ${rule.original}`),
      );
      return li;
    }),
  );
}
