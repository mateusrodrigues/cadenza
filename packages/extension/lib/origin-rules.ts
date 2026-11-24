import { browser } from 'wxt/browser';

/**
 * Some local model servers reject requests whose `Origin` is a browser extension (Ollama does
 * unless OLLAMA_ORIGINS is set). With the user's permission, Cadenza removes the Origin header
 * from its own requests to that one server, so it is treated like any non-browser client.
 * Only requests initiated by Cadenza itself are affected.
 */
export async function allowOrigin(origin: string): Promise<void> {
  const urlFilter = `|${new URL(origin).origin}/`;
  const rules = await browser.declarativeNetRequest.getDynamicRules();
  if (rules.some((r) => r.condition.urlFilter === urlFilter)) return;
  const id = Math.max(0, ...rules.map((r) => r.id)) + 1;
  await browser.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'origin', operation: 'remove' }],
        },
        condition: {
          urlFilter,
          initiatorDomains: [browser.runtime.id],
          resourceTypes: ['xmlhttprequest', 'other'],
        },
      },
    ],
  });
}

export async function allowedOrigins(): Promise<string[]> {
  const rules = await browser.declarativeNetRequest.getDynamicRules();
  return rules
    .map((r) => r.condition.urlFilter?.replace(/^\|/, '').replace(/\/$/, ''))
    .filter((o): o is string => Boolean(o));
}
