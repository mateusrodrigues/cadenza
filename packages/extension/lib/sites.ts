/**
 * Sites where the user turned Cadenza off. An entry matches its host and every subdomain
 * ("example.com" also turns off "mail.example.com").
 */

/** A hostname from what the user typed ("https://www.example.com/x" → "www.example.com"). */
export function normalizeSite(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return /^[a-z\d.:-]+$/.test(host) && host.length <= 253 ? host : null;
}

export function siteIsOff(host: string, disabled: readonly string[]): boolean {
  const h = host.toLowerCase();
  return disabled.some((d) => h === d || h.endsWith(`.${d}`));
}

/** The hostname of an http(s) URL, or null for other pages (chrome://, file://, the store…). */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

/**
 * Hostname of the tab's top-level page, from a content script in any frame. Chrome lists the
 * ancestor origins of a frame even when they are cross-origin.
 */
export function pageSite(): string {
  const origins = location.ancestorOrigins;
  const top = origins && origins.length > 0 ? origins[origins.length - 1] : location.href;
  try {
    return new URL(top ?? location.href).hostname;
  } catch {
    return location.hostname;
  }
}
