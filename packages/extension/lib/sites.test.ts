import { describe, expect, it } from 'vitest';
import { hostOf, normalizeSite, siteIsOff } from './sites';

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
});
