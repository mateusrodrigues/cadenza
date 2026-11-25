import { describe, expect, it } from 'vitest';
import {
  hostOf,
  normalizeSite,
  siteIsOff,
  turnSiteOff,
  turnSiteOn,
  unsupportedEditor,
} from './sites';

describe('sites', () => {
  it('normalizes what the user types to a hostname', () => {
    expect(normalizeSite('Example.com')).toBe('example.com');
    expect(normalizeSite('https://www.example.com/path?q=1')).toBe('www.example.com');
    expect(normalizeSite('  mail.example.com  ')).toBe('mail.example.com');
    expect(normalizeSite('localhost:3000')).toBe('localhost');
    expect(normalizeSite('')).toBeNull();
    expect(normalizeSite('not a site')).toBeNull();
  });

  it('turns off a site and its subdomains, not lookalikes', () => {
    const off = ['example.com'];
    expect(siteIsOff('example.com', off)).toBe(true);
    expect(siteIsOff('mail.example.com', off)).toBe(true);
    expect(siteIsOff('notexample.com', off)).toBe(false);
    expect(siteIsOff('example.com.evil.net', off)).toBe(false);
  });

  it('only reads hosts of web pages', () => {
    expect(hostOf('https://a.example.com/x')).toBe('a.example.com');
    expect(hostOf('chrome://extensions')).toBeNull();
    expect(hostOf(undefined)).toBeNull();
  });

  it('notes the day a site was turned off, and forgets it when turned back on', () => {
    let s = { disabledSites: [] as string[], siteOffSince: {} as Record<string, string> };
    s = turnSiteOff(s, 'example.com', '2026-11-12');
    s = turnSiteOff(s, 'mail.other.com', '2026-11-20');
    expect(s.siteOffSince).toEqual({ 'example.com': '2026-11-12', 'mail.other.com': '2026-11-20' });
    expect(turnSiteOff(s, 'example.com', '2026-11-25').siteOffSince['example.com']).toBe(
      '2026-11-12',
    );
    // The popup turns a subdomain back on: the parent entry that covered it goes.
    const popup = turnSiteOn(s, 'docs.example.com');
    expect(popup.disabledSites).toEqual(['mail.other.com']);
    expect(popup.siteOffSince).toEqual({ 'mail.other.com': '2026-11-20' });
    // Settings turns on one entry only.
    expect(turnSiteOn(s, 'docs.example.com', true).disabledSites).toHaveLength(2);
  });
});

describe('unsupportedEditor', () => {
  it('names Google Docs documents', () => {
    expect(unsupportedEditor('https://docs.google.com/document/d/abc/edit')).toBe('Google Docs');
    expect(unsupportedEditor('https://docs.google.com/document/u/1/d/abc/edit#heading')).toBe(
      'Google Docs',
    );
  });

  it('leaves other Google pages and other sites alone', () => {
    for (const url of [
      'https://docs.google.com/forms/d/abc/viewform',
      'https://docs.google.com/spreadsheets/d/abc/edit',
      'https://mail.google.com/mail/u/0/',
      'https://example.com/document/x',
      'not a url',
      undefined,
    ]) {
      expect(unsupportedEditor(url)).toBeNull();
    }
  });
});
