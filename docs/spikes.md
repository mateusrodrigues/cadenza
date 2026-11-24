# Phase 0 — Spike findings

Run on 2026-11-24. Chrome 158 (installed), Playwright Chromium 159, Node 24, Linux.
Local model: phi4 14B (Q4_K_M) on a llama.cpp server, **CPU only**, at `127.0.0.1:8360/v1`.
No hosted-provider keys were available, so the hosted items are carried into Phase 2.

## Summary

| Question                                                    | Answer                                                                                                                   | Evidence                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Can the service worker call a local server?                 | **Yes, with no host permission** (llama.cpp reflects any `Origin` in CORS headers)                                       | `e2e/spikes.spec.ts`                    |
| Do the vendor SDKs run in an MV3 service worker?            | **Yes**: OpenAI, Anthropic and Google GenAI SDKs all bundle for the browser with no Node built-ins and complete requests | Extension build + scratch spike (below) |
| Can API keys be hidden from content scripts?                | **Yes, but not by `setAccessLevel` alone** — see Phase 2 below; keys moved to extension-origin IndexedDB                 | `e2e/providers.spec.ts`                 |
| Does `::highlight()` render colored wavy/dotted underlines? | **Yes**; highlights registered from the content script's isolated world are visible to the page and render correctly     | `e2e/extension.spec.ts` + screenshots   |
| Do textarea/input overlays line up with the text?           | **Yes** on the test page (screenshot-checked)                                                                            | `e2e/extension.spec.ts`                 |
| Is a 14B model on CPU fast enough for live checks?          | **No**: ~40–140 s per check. Needs a GPU or a much smaller model                                                         | Below                                   |

## Local server (llama.cpp + phi4, CPU)

**Origins.** Preflight and normal requests with `Origin: chrome-extension://…` return
`Access-Control-Allow-Origin` set to that origin. From the extension's service worker,
`fetch('http://127.0.0.1:8360/v1/models')` succeeds while
`chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })` is `false`.

→ **Plan change:** don't ask for a host permission up front. Try the request first and only
call `chrome.permissions.request` for that origin if it fails as a network/CORS error. Ollama,
LM Studio and vLLM origin handling still needs checking (no servers here); carried to Phase 2.

**Structured output tiers** (3 short paragraphs, one clean):

| Tier                   | Result                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json_schema` (strict) | Valid JSON matching the schema. Accepts `type: [..., "null"]`, `enum`, `additionalProperties: false`. **Rejects `items: false`** with HTTP 400 ("JSON schema conversion failed") → mapped to `unsupported_output`, engine falls back a tier. |
| `json_object`          | **Not enforced**: output came back wrapped in a ` ```json ` fence, identical to prompted. The lenient parser handles it.                                                                                                                     |
| prompted               | Same as above; parsed fine.                                                                                                                                                                                                                  |

**Quality.** With the full prompt, phi4 found every planted error with exact, anchorable
`original` spans and left the clean paragraph alone (6/6 anchored). Through the real extension
it underlined "definately" and "teh" but missed "tomorow" in one run; recall will be measured in
the Phase 3 evals.

**Coarse rewrites.** A terse prompt made phi4 return whole sentences as `original`. The engine
now splits such rewrites into minimal word-level edits with a word diff (`refine()` in
`packages/engine/src/anchor.ts`), so these still become precise underlines.

**Latency** (~4.3 output tokens/s on this CPU; prompt processing ~15 tokens/s cold, cached after):

| Setup                                                             | Output tokens | Time      |
| ----------------------------------------------------------------- | ------------- | --------- |
| Verbose schema with explanations, 3 paragraphs                    | 455           | 103–137 s |
| Engine prompt, explanations on, 2 paragraphs                      | —             | 68 s      |
| Engine prompt, explanations off (schema still allowed strings)    | 231           | 56 s      |
| Engine prompt, explanations forced `null` by schema               | 202           | 39 s      |
| Full pipeline in the browser (type → underline), explanations off | —             | 43 s      |

The model ignored "explanation: null" in the prompt until the schema forced it, so the schema
is now built from settings (`outputJsonSchema()`): disabled categories are excluded from the
enum and explanations are typed `null` when off.

→ **Plan change:** add a "slow local model" mode for Phase 3: explanations off by default for
local providers, only the edited paragraph is sent, longer debounce, and a visible "checking…"
state. The recommended-models table should point CPU-only users to small (≈3–4B) models.

## Vendor SDKs in a service worker

Scratch extension (not in the repo) bundling `@anthropic-ai/sdk` 1.13.0 and `@google/genai`
3.6.1 with esbuild (`--platform=browser`), calling a local stub of each API from the worker:

- Both requests succeeded. Anthropic sent `anthropic-version` and
  `anthropic-dangerous-direct-browser-access`; Gemini sent `x-goog-api-key`.
- No `node:` imports in the bundle.
- Minified sizes: Anthropic 416 KB (94 KB gz), GenAI 457 KB (89 KB gz). The OpenAI SDK
  accounts for most of the current 498 KB worker. With all three, expect ~1.4 MB for the
  worker. MV3 service workers can't use dynamic `import()`, so all adapters load at worker
  start. Acceptable for a locally installed extension; revisit if worker startup time is
  noticeable (the alternative is small hand-written fetch adapters).

## Extension build

- Content script: **11 KB (4 KB gz)**, well under the 50 KB budget, after importing only
  `@cadenza/engine/paragraphs` instead of the whole engine.
- `storage.local.setAccessLevel` and `storage.session.setAccessLevel` both succeed.
- Branded Google Chrome no longer loads unpacked extensions from the command line, so e2e tests
  use Playwright's Chromium (`channel: 'chromium'`).

## Phase 2 findings

Run on 2026-11-24 with Playwright Chromium. No real API keys or Ollama/LM Studio/vLLM installs
were available; hosted APIs were called with a deliberately invalid key.

### Hosted APIs from the extension

OpenAI, Anthropic, Gemini, OpenRouter, Mistral, Groq, DeepSeek, xAI, Together and Fireworks
all accept direct calls from the service worker **with no host permission**: each answers an
invalid key with an auth error, not a CORS/network failure (`CADENZA_NET_TESTS=1` in
`e2e/providers.spec.ts`). Mistral's fixed CORS header list does accept the OpenAI SDK's
`x-stainless-*` headers. OpenRouter lists models without a key.

- xAI (and Gemini) answer a bad key with **400**, not 401; `classifyHttpError` now reads a 400
  that mentions the API key as `auth`.
- → No `host_permissions` for hosted vendors.
- Still unmeasured (needs real keys): latency p50/p95 and which output tier each model reaches.
  Run `npm test` with `CADENZA_LIVE_BASE_URL` / `CADENZA_LIVE_MODEL` / `CADENZA_LIVE_API_KEY`.

### Local servers that reject extension origins

Ollama rejects `chrome-extension://` origins unless `OLLAMA_ORIGINS` includes them. Tested with
a stub server that returns 403 for any extension `Origin` (`e2e/stub-server.ts`):

- With the host permission granted, Chrome sends **no `Origin` on GET** (`/v1/models` works)
  but **does send `chrome-extension://…` on POST** (checks are refused).
- A `declarativeNetRequest` dynamic rule (`declarativeNetRequestWithHostAccess`) that removes
  `Origin` for Cadenza's own requests to that origin fixes it. Settings offers this as
  "Allow connection" when a local endpoint answers 403 or can't be reached; it requests the
  host permission and adds the rule.
- So users don't need to set `OLLAMA_ORIGINS`. Not yet tried against real Ollama, LM Studio or
  vLLM; LM Studio's CORS switch default and Ollama's `json_schema` support remain unconfirmed.

### API-key storage

`storage.local.setAccessLevel('TRUSTED_CONTEXTS')` does lock content scripts out — but only
once the service worker has run. Before that, a content script **could** read `storage.local`
(observed in e2e). The level isn't stored with the data, so this window can recur whenever the
worker hasn't started yet.

→ API keys now live in the extension origin's **IndexedDB** (`lib/secrets.ts`), which content
scripts (running in the page's origin) can never open. Settings in `storage.local` hold
`apiKey: null`; the worker moves keys out of settings saved by earlier builds at startup. The
access-level lock stays as a second layer.

### Bug found: batched paragraphs lost suggestions

The scheduler gave every paragraph in a batch offset 0, so overlap resolution dropped
suggestions in later paragraphs that overlapped earlier ones by position. Paragraphs are now
laid out end to end; covered by a unit test.

## Still open

- Hosted latency (p50/p95) and structured-output tier per provider — needs real keys.
- Real Ollama, LM Studio and vLLM: confirm "Allow connection" and `json_schema` support.
- Hit-testing underlines (for cards) in Gmail and GitHub (Phase 4/5).
