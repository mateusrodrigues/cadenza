# Cadenza — Build Plan

Cadenza is a writing assistant. Its first product is a Chrome extension: while you type in any
text field on the web, Cadenza underlines passages it would change, color-coded by the kind of
change, and a click shows the suggestion with one-click Accept or Dismiss.

Cadenza does not run its own AI service. The user brings an API key for the provider they
prefer, or points Cadenza at a model running on their own machine. All checking happens between
the extension and that provider; Cadenza has no server.

---

## 1. Architecture

```
┌───────────────────────────── Chrome ─────────────────────────────┐
│                                                                  │
│  Content script (every page)            Service worker (MV3)     │
│   • finds editable fields                • holds API keys        │
│   • splits text into paragraphs  ──────► • queue, cancel, cache  │
│   • draws underlines + cards     ◄────── • provider adapters  ───┼──► Hosted provider
│        (never sees API keys)             • validates output   ───┼──► Local model server
│                                                                  │     (localhost)
│  Popup / Options / Onboarding pages                              │
└──────────────────────────────────────────────────────────────────┘
```

Everything ships as one extension: no native host, no installer, no Cadenza backend. Requests
go straight from the service worker to the provider the user configured. Extension
`host_permissions` let the service worker make these cross-origin calls.

### Provider support

Three protocol adapters cover the vendors. Each uses that vendor's official JavaScript SDK in
browser mode, so we don't hand-maintain request formats.

| Adapter                | SDK                                                          | Providers                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic Messages** | `@anthropic-ai/sdk` (`dangerouslyAllowBrowser: true`)        | Anthropic                                                                                                                                 |
| **Google GenAI**       | `@google/genai`                                              | Google Gemini                                                                                                                             |
| **OpenAI-compatible**  | `openai` (`dangerouslyAllowBrowser: true`, custom `baseURL`) | OpenAI, Azure OpenAI (`AzureOpenAI` client), OpenRouter, Mistral, Groq, DeepSeek, xAI, Together, Fireworks — and every local server below |

**Local models** (all speak the OpenAI-compatible API):

| Server                   | Default endpoint                                                  |
| ------------------------ | ----------------------------------------------------------------- |
| Ollama                   | `http://localhost:11434/v1`                                       |
| LM Studio                | `http://localhost:1234/v1`                                        |
| llama.cpp `llama-server` | `http://localhost:8080/v1`                                        |
| vLLM                     | `http://localhost:8000/v1`                                        |
| Jan, LocalAI, others     | "Custom OpenAI-compatible endpoint" with any URL and optional key |

Presets are just a base URL, auth header style, and any extra headers (e.g. OpenRouter's
`HTTP-Referer` / `X-Title: Cadenza`). Adding a new OpenAI-compatible vendor is a one-entry change.

**Stretch for v1:** Chrome's built-in on-device model (Prompt API), as a zero-setup local
option when the browser supports it.

**Not in v1:** Amazon Bedrock and Google Vertex AI (they need cloud credentials and request
signing rather than an API key). Users can reach most of the same models through OpenRouter.

### Provider interface (`packages/providers`)

```ts
interface Provider {
  listModels(signal: AbortSignal): Promise<ModelInfo[]>;
  check(req: CheckRequest, signal: AbortSignal): Promise<CheckResult>; // returns raw JSON + usage
  capabilities: { jsonSchema: boolean; jsonMode: boolean; maxContext?: number };
}
```

- **No hard-coded model IDs.** Each provider's model list comes from its models endpoint
  (`/v1/models`, Gemini `models.list`, Ollama `/api/tags`). The user picks one; Cadenza
  remembers it per provider. This keeps us from shipping stale model names.
- **Structured output, best available tier:**
  1. Native JSON Schema (Anthropic `output_config.format`, OpenAI `response_format:
     json_schema`, Gemini `responseSchema`, Ollama / LM Studio / llama.cpp / vLLM
     `json_schema` where supported).
  2. JSON mode (`response_format: json_object`).
  3. Prompted JSON with lenient parsing and one repair attempt.
     The tier is detected per provider+model during "Test connection" and cached.
- **Errors normalized** to `auth`, `rate_limited` (with retry-after), `context_too_long`,
  `bad_output`, `network`, `unavailable`, so the UI can say something useful for every vendor.
- **Usage normalized** (input/output tokens) so Options can show daily usage per provider.

### API keys

- Entered on the Options page and stored in the extension origin's IndexedDB
  (`lib/secrets.ts`), apart from the other settings. Content scripts run in the page's origin,
  so they can never open it; they never receive keys and only send text and receive
  suggestions. The worker also calls `storage.local.setAccessLevel({ accessLevel:
  'TRUSTED_CONTEXTS' })` at startup, which only takes effect once the worker has run (Phase 2).
- Optional passphrase lock: keys encrypted with WebCrypto (AES-GCM, PBKDF2-derived key),
  unlocked once per browser session into `chrome.storage.session`.
- Never in `chrome.storage.sync` (it would copy keys to the user's Google account).
- Several providers can be saved; one is active. Per-site provider override is a later feature.

### Permissions

- Requests are tried **without** a host permission first: servers that answer with CORS
  headers (llama.cpp does, see `docs/spikes.md`) need none.
- `optional_host_permissions`: `http://localhost/*`, `http://127.0.0.1/*`, `https://*/*` —
  requested at runtime with `chrome.permissions.request` only for an endpoint that fails
  without it.
- No `host_permissions` for hosted vendors: Phase 2 showed all ten hosted presets accept direct
  calls from the extension.
- `declarativeNetRequestWithHostAccess`: for a local server that rejects extension origins
  (Ollama), "Allow connection" adds a rule that drops `Origin` on Cadenza's requests to it.
- Content scripts on `<all_urls>` (needed to work in any text field).

---

## 2. Suggestion model

### Categories and colors

| Category        | Covers                                                     | Underline color  |
| --------------- | ---------------------------------------------------------- | ---------------- |
| **Correctness** | spelling, grammar, punctuation, agreement, typos           | red `#E5484D`    |
| **Clarity**     | wordiness, ambiguity, run-ons, passive voice that obscures | blue `#3E63DD`   |
| **Style**       | word choice, repetition, clichés, variety                  | amber `#F5A623`  |
| **Tone**        | formality, confidence, politeness, hedging                 | violet `#8E4EC6` |

Colors are tokens in one file so design can retune them. Each underline also carries a
non-color cue (solid vs. dotted vs. dashed) for color-blind users.

### Request/response contract (`packages/shared`)

Models are unreliable with character offsets, so we never ask for them. The extension sends
paragraphs with IDs; the model returns the exact substring to change and which occurrence it is.

```ts
// Request (content script → service worker)
{ id, paragraphs: [{ pid, text }], settings: { dialect, goals, categories } }

// Model output (enforced by schema where the provider supports it, validated always)
{ suggestions: [{
    pid: string,
    original: string,        // exact substring of that paragraph
    occurrence: number,      // 1 = first match in the paragraph
    replacement: string,     // "" = delete
    category: "correctness" | "clarity" | "style" | "tone",
    subtype: string,         // e.g. "spelling", "comma-splice"
    explanation: string      // one sentence, shown in the card
}] }
```

The service worker validates every item with zod (shape, `original` actually found, replacement
differs, no overlapping spans; correctness wins overlaps) and computes offsets itself. Invalid
items are dropped, never shown.

### Prompt

- One system prompt in `packages/engine/src/prompt.ts`; a change bumps `PROMPT_VERSION` and
  is measured with the evals first (`docs/evals.md`). Currently v3.
- Page text goes in the user message, wrapped and labeled as text to check. The prompt tells
  the model to treat it only as data. Because the model has no tools and suggestions never
  apply without a click, injected instructions can at worst produce bad suggestions.
- A compact variant for small local models (shorter instructions, fewer categories per call)
  if evals show it helps. Not needed so far: the main local cost was output tokens, which
  compact JSON cut by ~40%.

### When checks run

- Debounce: 700 ms after typing stops, plus on blur.
- Only paragraphs whose hash changed are sent; results are cached by
  `hash(text + settings + provider + model + prompt version)` in memory and in
  `chrome.storage.session` (in memory only, cleared when the browser closes), so results survive
  Chrome suspending the idle worker.
- A newer edit to a paragraph aborts its in-flight request (`AbortController`).
- Per-provider concurrency limit (1 for local servers, 4 hosted); queued requests nobody needs
  any more are dropped before they're sent; after a rate limit, pause and retry once.
- Between results, existing underlines are kept in place by mapping offsets through the edit;
  a suggestion whose `original` text no longer matches is removed.

---

## 3. Extension

### Field adapters

| Field type                                              | Text access                | Underlines                                                                                 | Apply a suggestion                                                                                 |
| ------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `<textarea>`, `<input type=text                         | search                     | email…>`                                                                                   | `.value`                                                                                           | Mirror div (copied font/padding/scroll) in a shadow-DOM overlay; rects from mirror ranges | `setRangeText()` + dispatch `input` |
| `contenteditable` (Gmail, GitHub, LinkedIn, Slack web…) | DOM walk → text + node map | **CSS Custom Highlight API** (`CSS.highlights`, `::highlight(cadenza-*)`), no DOM mutation | Select range, `execCommand('insertText')` (keeps undo and framework state); `beforeinput` fallback |

The editor's own DOM is never modified: React/ProseMirror/Lexical editors break if we inject
spans. Because highlights aren't elements, clicks/hover are hit-tested by comparing the pointer
to `range.getClientRects()`.

Never active on: `type=password`, `autocomplete="cc-*" / one-time-code`, fields marked
`data-cadenza="off"`, or sites in the user's blocklist.

### UI pieces (all inside a closed shadow root, Cadenza-branded)

1. **Underlines** in the four category colors.
2. **Suggestion card** on hover/click: category chip, before → after, explanation,
   Accept / Dismiss / "Don't suggest this again".
3. **Field badge** in the field's corner: a small Cadenza mark with a count, colored by the
   most severe open category; click opens the panel.
4. **Panel**: all suggestions for the field, grouped by category, "Accept all correctness".
5. **Popup**: on/off, per-site toggle, active provider + model, status.
6. **Options**:
   - **Providers**: add a provider from presets or a custom endpoint, paste a key, pick a
     model from the fetched list, **Test connection** (latency, structured-output tier, a
     sample check), set active.
   - Categories, dialect (US/UK/CA/AU), goals (audience, formality), personal dictionary,
     site blocklist, daily usage per provider, optional key passphrase.
7. **Onboarding page** (opens on install): choose "Use an API key" or "Use a model on this
   computer". The local path detects running servers on the default ports and shows setup
   steps for Ollama / LM Studio if none is found.

---

## 4. Repository layout

npm workspaces, TypeScript throughout.

```
cadenza/
  packages/
    shared/      protocol types, zod schemas, suggestion JSON schema, category tokens
    providers/   Provider interface, three adapters, presets, error/usage normalization, mock
    engine/      prompt building, paragraph diffing, validation, offsets, cache, scheduling
    extension/   MV3 extension built with WXT (Vite): content script, worker, popup, options
  e2e/           Playwright tests that load the built extension
  evals/         labeled corpus + runner scoring precision/recall per category, per model
  scripts/       naming guard
  docs/
```

The system prompt lives in `packages/engine/src/prompt.ts` with `PROMPT_VERSION`.

`providers` and `engine` are plain TypeScript with no Chrome APIs, so the evals runner and
unit tests use them directly from Node, and a future desktop app or other browser can reuse them.

---

## 5. Phases

### Phase 0 — Spikes (2–3 days) — ✅ done, see `docs/spikes.md`

Hosted-provider items and the Ollama/LM Studio/vLLM checks moved to Phase 2 (no keys or
servers were available).

- **Local servers from an extension:** confirm the service worker can call Ollama, LM Studio,
  llama.cpp and vLLM on localhost — check each server's Origin/CORS handling for
  `chrome-extension://` origins and Chrome's private-network rules. Document any setting the
  user must change (e.g. `OLLAMA_ORIGINS`, LM Studio's CORS toggle).
- **Vendor SDKs in a service worker:** confirm the three SDKs bundle and run in an MV3 worker
  (no Node built-ins), and their browser-access flags work.
- **Structured output matrix:** which tier each provider and common local model families
  reach.
- **Latency:** p50/p95 for a 3-paragraph check on a fast hosted model and a 7–8B local model.
  Target: p50 under 2 s hosted.
- **Key storage:** confirm content scripts cannot read the key store. (Phase 2: they can read
  `storage.local` until the worker runs, so keys moved to extension-origin IndexedDB.)
- `::highlight()` supports colored wavy/dotted `text-decoration`; hit-testing in Gmail and GitHub.
- **Exit:** findings in `docs/spikes.md`.

### Phase 1 — Skeleton (week 1) — ✅ done

Beyond the original scope, Phase 1 also includes the OpenAI-compatible adapter (so local
models work end to end), the engine's anchoring and word-diff refinement, contenteditable
underlines via the Highlight API, and a basic settings page.

- Monorepo, lint, typecheck, Vitest, CI (including the naming guard, §6).
- Mock provider returning fixture suggestions (used by UI work and e2e, so tests cost nothing).
- Extension loads, worker answers content-script messages with mock suggestions.
- **Exit:** load unpacked; a textarea on a test page gets mock underlines.

### Phase 2 — Providers (week 2) — ✅ done, except live-key checks

Done: Anthropic and Gemini adapters (next to OpenAI-compatible), several saved providers with
one active, settings screen with model loading, Test connection and the "Allow connection" fix,
slow model mode with a checking/done badge, a per-paragraph cache and scheduler, API keys moved
to extension-origin IndexedDB. Findings in `docs/spikes.md`.

Not done here: the exit check needs real keys and Ollama/LM Studio installs. Hosted APIs were
verified reachable with an invalid key; the stub server covers Ollama's origin check.

- Three adapters, presets, model listing, error/usage normalization.
- Options → Providers screen with key entry, model picker, Test connection.
- Optional host permission flow, only when an endpoint fails without it.
- Carried from Phase 0: hosted latency and structured-output support; Ollama, LM Studio and
  vLLM origin handling; whether hosted APIs need `host_permissions`.
- "Slow local model" mode: explanations off by default for local providers, send only the
  edited paragraph, longer debounce, visible "checking…" state.
- **Exit:** Test connection passes against at least OpenAI, Anthropic, Gemini, OpenRouter,
  Ollama and LM Studio.

### Phase 3 — Checking engine and evals (week 3) — ✅ done

Done: 205-sample labeled corpus and runner (`evals/`), prompt v3, request limiter with
rate-limit backoff, session-storage cache, truncated-output recovery. Results and recommended
models in `docs/evals.md`; the exit target is met on `claude-haiku-5-5`. Only one hosted and one
local model were measured (no other keys here).

- Prompt v1, structured-output tiers, validation, offsets, cache, scheduling, cancellation.
- Evals: 150+ labeled samples (typos, grammar, wordy prose, tone, plus _clean_ text to measure
  false positives), run across a provider/model matrix. Precision first; a noisy checker gets
  uninstalled.
- Publish a short "recommended models" table in docs from eval results, including the best
  small local models.
- **Exit:** on the recommended hosted models, correctness precision ≥ 0.85 and ≤ 1 false
  positive per 500 words of clean text; local models measured and documented.

### Phase 4 — Underlines (week 4)

- Textarea/input mirror overlay; contenteditable via Highlight API.
- Paragraph diffing, debounce, offset mapping during edits, scroll/resize tracking.
- **Exit:** underlines stay aligned while typing, scrolling and resizing on the test pages.

### Phase 5 — Cards and applying changes (week 5)

- Card, Accept/Dismiss, "don't suggest again", undo works via Ctrl+Z.
- Field badge and panel.
- **Exit:** accept/dismiss works on the site matrix; framework state stays in sync
  (e.g. GitHub's comment preview reflects accepted changes).

### Phase 6 — Settings and onboarding (week 6)

- Remaining options, dictionary, goals, usage view, key passphrase.
- Onboarding with local-server detection.
- **Exit:** a fresh profile goes from install to first underline in under 2 minutes with a
  hosted key, under 5 minutes with Ollama already installed.

### Phase 7 — Hardening (week 7)

- Site matrix: Gmail, Outlook web, GitHub, Slack web, LinkedIn, X, Reddit, Notion, Jira,
  Google Forms, plain `<textarea>` pages. Playwright e2e against the mock provider.
- Performance budget: content script < 50 KB gz, no measurable typing lag (< 4 ms per input
  event).
- Privacy review: no text in logs; nothing stored but hashes, settings and keys; clear
  disclosure that text goes to the provider the user chose (or stays on the machine with a
  local model).
- Accessibility: keyboard navigation of cards, screen-reader labels, non-color cues.

### Phase 8 — Release

- Chrome Web Store listing, icons, screenshots, privacy policy.
- Permission justifications for review (content scripts on all sites, vendor API hosts,
  optional localhost).

### Later (not v1)

Google Docs (canvas-rendered, needs its own integration), Firefox/Safari, per-site provider
choice, a second "deep review" model, full-document and tone rewrites, Bedrock/Vertex, desktop app.

---

## 6. Naming rule for outward-facing material

Everything a user, reviewer or store visitor sees — extension name and description, UI
strings, store listing, screenshots, website, README, package metadata — is branded only as
**Cadenza**. It never names competing writing assistants, and never names an AI model or
assistant brand as part of Cadenza's identity ("powered by …" and similar are out).

The one exception is functional: the provider picker lists vendor names (OpenAI, Anthropic,
Google, OpenRouter, Ollama…) so users can choose where their key goes, and the model picker
shows model names exactly as the provider's API returns them. Neither is hard-coded in brand
copy.

A CI step fails the build if a blocklist of names appears in the manifest, `_locales`, UI
string files, store assets, README or website. Provider adapter code and preset definitions
are excluded from the check.

---

## 7. Risks

| Risk                                            | Mitigation                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latency too high for live underlines            | Paragraph-level checks, cache, cancellation; recommended fast models from evals.                                                                           |
| Small local models produce poor or invalid JSON | Structured-output tiers, schema-constrained decoding where the server supports it, strict validation, compact prompt; set expectations in the model table. |
| Local servers reject extension origins          | Phase 0 findings turned into one-click instructions in onboarding.                                                                                         |
| Provider API drift                              | Official SDKs, models fetched at runtime, adapter tests against recorded fixtures.                                                                         |
| Noisy suggestions                               | Precision-first evals gate every prompt change, per model.                                                                                                 |
| Editors fighting injected changes               | Never mutate editor DOM; apply via native input paths; per-site adapters where needed.                                                                     |
| Prompt injection via page text                  | No tools, schema-validated output, nothing applied without a click.                                                                                        |
| API key exposure                                | Keys only in the service worker; optional passphrase encryption; never synced.                                                                             |
| User cost on paid keys                          | Hash cache, only changed paragraphs, usage shown in Options, optional daily cap.                                                                           |
| Store review of broad permissions               | Optional permissions for custom endpoints; clear justifications.                                                                                           |

## 8. Open decisions

1. Which providers get first-class presets at launch vs. "custom endpoint".
2. Whether Chrome's built-in on-device model ships in v1.
3. WXT vs. plain Vite for the extension build (WXT assumed).
4. Final brand palette and icon.
