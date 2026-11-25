# Privacy review

Phase 7 review of what Cadenza sends, stores and shows. This is an engineering document; the
store privacy policy (Phase 9) is written from it.

## What leaves the computer

- **To the provider the user chose, and nowhere else.** When the user pauses typing in a field
  (or leaves it), the paragraphs that changed since the last check go from the service worker
  to the active provider, with the user's API key. With a local model the request goes to a
  server on the user's machine or network.
- **No Cadenza server, analytics, crash reporting or update checks.** The extension makes no
  other requests. Chrome itself updates the extension from the store.
- **Never sent:** password fields, payment fields (`autocomplete="cc-*"`), one-time codes,
  fields marked `data-cadenza="off"`, code editors, sites the user turned off, or anything while
  Cadenza is switched off. Text is only read from fields the user focuses.

## What is stored, and where

| Data                                                                                     | Where                                 | Lifetime                             | Content scripts can read it |
| ---------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ | --------------------------- |
| API keys (optionally passphrase-sealed)                                                  | Extension-origin IndexedDB            | Until removed or uninstall           | No (different origin)       |
| Unlocked passphrase key                                                                  | `storage.session`                     | Memory only; browser close           | No (trusted contexts only)  |
| Settings (providers without keys, goals, sites, limits)                                  | `storage.local`                       | Until changed or uninstall           | No (locked by the worker)   |
| Check results: per-paragraph hash → suggestions (flagged span, replacement, explanation) | `storage.session` and worker memory   | Memory only; browser close, 8 MB cap | No                          |
| "Don't suggest this again" rules (flagged text + category)                               | `storage.local`                       | Until removed in settings            | No                          |
| Dictionary words                                                                         | `storage.local`                       | Until removed in settings            | No                          |
| Usage counts per provider per day                                                        | `storage.local`                       | 31 days                              | No                          |
| "Allow connection" rules (server origins)                                                | `declarativeNetRequest` dynamic rules | Until uninstall                      | No                          |

Correction to the plan's original wording ("nothing stored but hashes, settings and keys"):
check results hold short spans of the user's text (the flagged words and their replacements),
but only in memory, and the ignore list and dictionary hold text the user chose to save.
Whole paragraphs are never stored; the cache is keyed by a hash.

## What the page can see

Cadenza's underlines, badge, card and panel live in the page's DOM (in closed shadow roots), so
a page could observe that Cadenza is installed and which spans it flagged. It already has the
text. What it must not see:

- **API keys or provider responses.** Errors sent to content scripts carry a fixed message per
  kind of error; the provider's own message (which can quote part of the key) only reaches the
  settings page. Covered by `e2e/setup.spec.ts`.
- **Other tabs' text.** Each field's requests carry only its own paragraphs; responses go back
  to the frame that asked.
- **The ability to act for the user.** Card and panel buttons only respond to trusted clicks
  (a real click, or Enter/Space on a focused button after the keyboard shortcut).
  Content scripts can add an ignore rule or a dictionary word (validated by the worker) and
  ask for checks; everything touching keys or settings is refused unless it comes from an
  extension page.

## Logs

No `console` calls in extension, engine or provider code; Biome's `noConsole` rule fails the
build if one is added (tests excepted). Errors are never logged with text.

## Disclosure

- Onboarding says where text goes for each choice before anything is sent ("Your text goes to
  the AI provider you pick" / "Your text never leaves this computer").
- The settings page repeats it above the provider list.
- The store listing and privacy policy (Phase 9) must say the same, and name what is stored.
