# Cadenza

Writing assistant; first product is a Chrome MV3 extension that calls AI providers directly
with the user's own API key, or a local model server on their machine. No Cadenza backend.
Build plan: `docs/PLAN.md`.

## Rules

- Outward-facing material (UI strings, extension manifest, `_locales`, store listing, README,
  website, package metadata, screenshots) is branded only as **Cadenza**. Never name competing
  writing assistants, and never name an AI model or assistant brand as part of Cadenza's
  identity (no "powered by …"). Vendor names appear only as functional labels in the provider
  picker; model names only as returned by a provider's API. See PLAN §6.
- Never hard-code model IDs; list models from the provider at runtime.
- API keys live only in extension-origin IndexedDB (`lib/secrets.ts`), never in `chrome.storage`;
  content scripts never receive them;
  never use `chrome.storage.sync` for keys.
- Page text is untrusted: no tools in model calls, validate all model output, never apply a
  suggestion without a user click.
- Never log user text.
- Prompt changes bump `PROMPT_VERSION` and are measured with `npm run eval` before they ship;
  record results in `docs/evals.md`. Precision first.
