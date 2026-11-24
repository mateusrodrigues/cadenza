import type { StatusResponse } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { loadSettings, saveSettings } from '../../lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const status = (await browser.runtime.sendMessage({
    type: 'cadenza/status',
  })) as StatusResponse;
  $('provider').textContent = status.provider.label;
  $('model').textContent = status.provider.model ?? 'Not chosen';
  const toggle = $<HTMLInputElement>('enabled');
  toggle.checked = status.enabled;
  toggle.addEventListener('change', async () => {
    const settings = await loadSettings();
    await saveSettings({ ...settings, enabled: toggle.checked });
  });
  $('open-options').addEventListener('click', () => browser.runtime.openOptionsPage());
}

void init();
