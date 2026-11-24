import { browser } from 'wxt/browser';
import type { StatusResponse } from '../../lib/messages';
import { loadSettings, saveSettings } from '../../lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const status = (await browser.runtime.sendMessage({
    type: 'cadenza/status',
  })) as StatusResponse;
  $('provider').textContent = status.provider?.name ?? 'Not set up';
  $('model').textContent = status.provider?.model ?? 'Not chosen';
  const toggle = $<HTMLInputElement>('enabled');
  toggle.checked = status.enabled;
  toggle.addEventListener('change', async () => {
    const settings = await loadSettings();
    await saveSettings({ ...settings, enabled: toggle.checked });
  });
  $('open-options').addEventListener('click', () => browser.runtime.openOptionsPage());
}

void init();
