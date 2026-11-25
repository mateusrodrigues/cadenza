import { browser } from 'wxt/browser';
import type { StatusResponse } from '../../lib/messages';
import { unlock } from '../../lib/secrets';
import {
  activeProvider,
  isHosted,
  loadSettings,
  type Settings,
  saveSettings,
} from '../../lib/settings';
import { hostOf, siteIsOff } from '../../lib/sites';
import { loadUsage, today } from '../../lib/usage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function render() {
  const status = (await browser.runtime.sendMessage({
    type: 'cadenza/status',
  })) as StatusResponse;
  const settings = await loadSettings();
  $<HTMLInputElement>('enabled').checked = status.enabled;
  $('enabled-label').textContent = status.enabled ? 'On' : 'Off';
  $('unlock').hidden = !status.locked;
  $('setup').hidden = status.provider !== null;
  renderProvider(settings);
  await renderToday(settings);
}

function renderProvider(settings: Settings) {
  const active = activeProvider(settings);
  $('provider-box').hidden = !active;
  if (!active) return;
  const select = $<HTMLSelectElement>('provider');
  select.replaceChildren(
    ...settings.providers.map((p) => new Option(p.name, p.id, false, p.id === active.id)),
  );
  $('model').textContent = active.model ?? 'Not chosen';
  const local = !isHosted(active);
  const where = $('where');
  where.replaceChildren(icon(local ? LAPTOP : CLOUD));
  where.append(local ? 'Runs on this computer' : 'Hosted, with your key');
}

/** Today's checks and tokens; against the daily limit when the active provider has one. */
async function renderToday(settings: Settings) {
  const day = (await loadUsage())[today()] ?? {};
  let checks = 0;
  let tokens = 0;
  for (const u of Object.values(day)) {
    checks += u.checks;
    tokens += u.inputTokens + u.outputTokens;
  }
  $('tokens').textContent = tokens > 0 ? `${tokens.toLocaleString('en')} tokens` : '';
  const active = activeProvider(settings);
  const limited = settings.dailyLimit !== null && active && isHosted(active);
  const meter = $('meter');
  meter.hidden = !limited;
  if (limited && settings.dailyLimit) {
    // The limit counts checks sent to hosted providers only.
    const hosted = settings.providers.filter(isHosted).map((p) => p.id);
    const used = hosted.reduce((n, id) => n + (day[id]?.checks ?? 0), 0);
    (meter.firstElementChild as HTMLElement).style.width =
      `${Math.min(100, (used / settings.dailyLimit) * 100)}%`;
    $('checks').textContent = `${used} of ${settings.dailyLimit} checks`;
  } else {
    $('checks').textContent =
      checks === 0 ? 'No checks yet' : `${checks} ${checks === 1 ? 'check' : 'checks'}`;
  }
}

/** The site of the tab the popup was opened on (activeTab grants its URL on click). */
async function currentSite(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return hostOf(tab?.url);
}

function showSite(site: string, off: boolean) {
  $('site-row').dataset.off = String(off);
  $<HTMLInputElement>('site-off').checked = off;
  $('site-status').textContent = off ? `Off on ${site}` : `On for ${site}`;
}

async function init() {
  await render();

  $<HTMLInputElement>('enabled').addEventListener('change', async (e) => {
    const settings = await loadSettings();
    const enabled = (e.target as HTMLInputElement).checked;
    $('enabled-label').textContent = enabled ? 'On' : 'Off';
    await saveSettings({ ...settings, enabled });
  });

  const site = await currentSite();
  if (site) {
    const settings = await loadSettings();
    showSite(site, siteIsOff(site, settings.disabledSites));
    $('site-row').hidden = false;
    const toggle = $<HTMLInputElement>('site-off');
    toggle.addEventListener('change', async () => {
      const s = await loadSettings();
      // Turning a site back on also clears a parent entry that covered it.
      const disabledSites = toggle.checked
        ? [...s.disabledSites.filter((d) => d !== site), site]
        : s.disabledSites.filter((d) => !siteIsOff(site, [d]));
      await saveSettings({ ...s, disabledSites });
      showSite(site, toggle.checked);
    });
  }

  $<HTMLSelectElement>('provider').addEventListener('change', async (e) => {
    const s = await loadSettings();
    await saveSettings({ ...s, activeProviderId: (e.target as HTMLSelectElement).value });
    await render();
  });

  $<HTMLFormElement>('unlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('passphrase');
    const message = $('unlock-message');
    message.textContent = 'Unlocking…';
    if (await unlock(input.value)) {
      input.value = '';
      message.textContent = '';
      await render();
    } else {
      message.textContent = 'That passphrase is not right.';
      input.select();
    }
  });

  $('set-up').addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
    window.close();
  });
  $('open-options').addEventListener('click', () => browser.runtime.openOptionsPage());

  const command = (await browser.commands.getAll()).find((c) => c.name === 'open-suggestion');
  if (command?.shortcut) {
    const keys = command.shortcut
      .split('+')
      .map((k) => ({ Period: '.', Comma: ',' })[k] ?? k)
      .join(' ');
    $('shortcut').textContent = `${keys} opens suggestions`;
  }
}

const LAPTOP = 'M3 4.5h10v6.5H3zM1.5 12.5h13';
const CLOUD = 'M4.5 12h7a3 3 0 0 0 .3-6 4 4 0 0 0-7.6 1A2.5 2.5 0 0 0 4.5 12Z';

function icon(d: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

void init();
