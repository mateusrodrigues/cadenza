import { browser } from 'wxt/browser';
import type { StatusResponse } from '../../lib/messages';
import { unlock } from '../../lib/secrets';
import { loadSettings, saveSettings } from '../../lib/settings';
import { hostOf, siteIsOff } from '../../lib/sites';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function render() {
  const status = (await browser.runtime.sendMessage({
    type: 'cadenza/status',
  })) as StatusResponse;
  $('provider').textContent = status.provider?.name ?? 'Not set up';
  $('model').textContent = status.provider?.model ?? 'Not chosen';
  $<HTMLInputElement>('enabled').checked = status.enabled;
  $('set-up').hidden = status.provider !== null;
  $('unlock').hidden = !status.locked;
}

/** The site of the tab the popup was opened on (activeTab grants its URL on click). */
async function currentSite(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return hostOf(tab?.url);
}

async function init() {
  await render();

  $<HTMLInputElement>('enabled').addEventListener('change', async (e) => {
    const settings = await loadSettings();
    await saveSettings({ ...settings, enabled: (e.target as HTMLInputElement).checked });
  });

  const site = await currentSite();
  if (site) {
    const settings = await loadSettings();
    const toggle = $<HTMLInputElement>('site-enabled');
    toggle.checked = !siteIsOff(site, settings.disabledSites);
    $('site-label').textContent = `Check on ${site}`;
    $('site-row').hidden = false;
    toggle.addEventListener('change', async () => {
      const s = await loadSettings();
      // Turning a site back on also clears a parent entry that covered it.
      const disabledSites = toggle.checked
        ? s.disabledSites.filter((d) => !siteIsOff(site, [d]))
        : [...s.disabledSites.filter((d) => d !== site), site];
      await saveSettings({ ...s, disabledSites });
    });
  }

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
}

void init();
