# Website

Cadenza's landing page and privacy policy. Plain HTML, CSS and one script: no build step, no
dependencies, no requests to other servers.

## Preview

```bash
python3 -m http.server --directory website 8000
```

Then open <http://localhost:8000>.

## Files

| Path                  | What it is                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| `index.html`          | The landing page                                                           |
| `privacy.html`        | The privacy policy, generated from `store/privacy-policy.md`               |
| `styles.css`          | Styles for both pages, light and dark                                      |
| `site.js`             | The sample in the hero, the copy button and the store link                 |
| `build-privacy.mjs`   | Regenerates `privacy.html`                                                 |
| `assets/img/`         | Screenshots of the extension (1.0.0 build), light and dark, wide and phone |
| `assets/logo/`        | Lockups, the same drawings the extension ships                             |
| `assets/icons/`       | Favicon, touch icon and web manifest icons                                 |
| `assets/fonts/`       | Newsreader (SIL Open Font License, see `OFL.txt`), Latin, 400 to 600       |
| `assets/og-image.png` | The picture shown when a link to the site is shared (1200×630)             |
| `favicon.ico`         | 16, 32 and 48 px                                                           |
| `site.webmanifest`    | Name, colors and icons                                                     |

## Before publishing

1. After any change to `store/privacy-policy.md`, update its effective date and run
   `node website/build-privacy.mjs`.
2. The pages assume the address `https://cadenza.mateus.tech/`, the custom domain set in
   **Settings → Pages** (no `CNAME` file needed when publishing with Actions). For another
   address, change it there and replace it in `index.html` (canonical and `og:` tags) and
   `build-privacy.mjs`.
3. When the extension is in the Chrome Web Store, put its address in `data-store-url` at the
   top of `index.html`. The install buttons and steps switch over.

## Publish with GitHub Pages

`.github/workflows/pages.yml` publishes this folder whenever a change to it reaches `main`, or
when run by hand from the Actions tab. It needs **Settings → Pages → Source** set to
**GitHub Actions**, once.

The store's privacy policy address is
`https://cadenza.mateus.tech/privacy.html`. CI fails if `privacy.html` is out of
step with `store/privacy-policy.md`.

## Keeping it true

The page's claims come from `store/listing.md`, `store/privacy-policy.md` and the extension
itself. When one changes, check the page. The naming rule (`docs/PLAN.md` §6) covers this
folder too; `npm run check:naming` scans it.
