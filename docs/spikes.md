# Phase 0 — Spike findings

Run on 2026-11-24. Chrome 158 (installed), Playwright Chromium 159, Node 24, Linux.
Local model: phi4 14B (Q4_K_M) on a llama.cpp server, **CPU only**, at `127.0.0.1:8360/v1`.
No hosted-provider keys were available, so the hosted items are carried into Phase 2.

## Summary

| Question                                                    | Answer                                                                                                                          | Evidence                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Can the service worker call a local server?                 | **Yes, with no host permission** (llama.cpp reflects any `Origin` in CORS headers)                                              | `e2e/spikes.spec.ts`                    |
| Do the vendor SDKs run in an MV3 service worker?            | **Yes**: OpenAI, Anthropic and Google GenAI SDKs all bundle for the browser with no Node built-ins and complete requests        | Extension build + scratch spike (below) |
| Can API keys be hidden from content scripts?                | **Yes**: `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` is available and now runs at worker startup | `e2e/spikes.spec.ts`                    |
| Does `::highlight()` render colored wavy/dotted underlines? | **Yes**; highlights registered from the content script's isolated world are visible to the page and render correctly            | `e2e/extension.spec.ts` + screenshots   |
| Do textarea/input overlays line up with the text?           | **Yes** on the test page (screenshot-checked)                                                                                   | `e2e/extension.spec.ts`                 |
| Is a 14B model on CPU fast enough for live checks?          | **No**: ~40–140 s per check. Needs a GPU or a much smaller model                                                                | Below                                   |

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

## Still open (moved to Phase 2)

- Hosted providers: latency (p50/p95), structured-output support, and whether their APIs
  accept direct calls from an extension without `host_permissions`.
- Ollama, LM Studio and vLLM: origin handling and `json_schema` support.
- Hit-testing underlines (for cards) in Gmail and GitHub.
- Confirm from a content script that `storage.local` is actually unreadable after
  `setAccessLevel` (the API call succeeds; the effect wasn't observed directly).
