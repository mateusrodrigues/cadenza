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

**Later, not v1:** Chrome's built-in on-device model (Prompt API), as a zero-setup local
option when the browser supports it. It was a v1 stretch goal and wasn't built (see §8).

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
  unlocked once per browser session: the derived key goes into `chrome.storage.session`
  (memory only, never readable by content scripts). While locked, providers that have a key
  stop checking and the popup asks for the passphrase.
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
  is measured with the evals first (`docs/evals.md`). Currently v5 (v3 plus optional
  writing goals; with no goals set the text is exactly v3's).
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

| Field type                                              | Text access                | Underlines                                                                                 | Apply a suggestion                                                                                                                |
| ------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `<textarea>`, `<input type=text\|search\|email…>`       | `.value`                   | Mirror div (copied font/padding/scroll) in a shadow-DOM overlay; rects from mirror ranges  | Select range, `execCommand('insertText')` (native undo, real `input` events); `setRangeText()` + `input` fallback                 |
| `contenteditable` (Gmail, GitHub, LinkedIn, Slack web…) | DOM walk → text + node map | **CSS Custom Highlight API** (`CSS.highlights`, `::highlight(cadenza-*)`), no DOM mutation | Select range, offer a `beforeinput` (editors that own their model take it), else `execCommand('insertText')`; text verified after |

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

### Phase 2 — Providers (week 2) — ✅ done

Done: Anthropic and Gemini adapters (next to OpenAI-compatible), several saved providers with
one active, settings screen with model loading, Test connection and the "Allow connection" fix,
slow model mode with a checking/done badge, a per-paragraph cache and scheduler, API keys moved
to extension-origin IndexedDB. Findings in `docs/spikes.md`.

Exit check: Test connection passed by hand with Anthropic and a local Llama model. OpenAI,
Gemini, OpenRouter, Ollama and LM Studio weren't available to try; hosted APIs were verified
reachable with an invalid key, and the stub server covers Ollama's origin check.

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

### Phase 4 — Underlines (week 4) — ✅ done

Done: underlines are mapped through each edit (they follow the text while typing, and a result
that arrives after more typing is moved onto the current text instead of dropped); the overlay
is clipped to scrolled containers, hidden with its field, and follows reflows; highlights
render inside shadow roots and survive editors that replace their text nodes. Pixel-level
alignment tests in `e2e/alignment.spec.ts` check typing, field/page/container scrolling,
resizing, sideways-scrolled inputs and `wrap="off"` against an independent reference.
Not covered: real sites (Gmail, GitHub…) — Phase 5's site matrix; very large contenteditable
documents re-walk the DOM on every edit (coalesced per frame), which may need an incremental
text map.

- Textarea/input mirror overlay; contenteditable via Highlight API.
- Paragraph diffing, debounce, offset mapping during edits, scroll/resize tracking.
- **Exit:** underlines stay aligned while typing, scrolling and resizing on the test pages. Met.

### Phase 5 — Cards and applying changes (week 5) — ✅ done

Done: clicking an underline opens a card (category, before → after, explanation, Accept /
Dismiss / "Don't suggest this again"); the badge opens a panel grouped by category with
"Accept all" for correctness (one undo step in plain fields). Accepting goes through the
editor's own input path, so Ctrl+Z and framework state work; buttons act on trusted clicks
only. Dismissals follow edits; "Don't suggest this again" matches the flagged text and
category, is filtered in the worker, and is listed (removable) in settings. Fields focused
before the content script loads are now picked up, and editors that re-render without `input`
events are followed through a MutationObserver. Tests: `e2e/cards.spec.ts` (including a
React-style controlled textarea and a model-owning editor with its own undo) and
`e2e/sites.spec.ts` (ProseMirror, Lexical and Slate demo pages, `CADENZA_NET_TESTS=1`).
Manual pass: GitHub works. Gmail worked only in Subject: the message body sets
`spellcheck="false"`, which Cadenza read as a code editor; now only code editors (known ones,
or monospace) opt out that way, and Gmail needs a second look. Not covered: LinkedIn and Slack
still need a manual pass; editors in
`about:blank`/`srcdoc` iframes (TinyMCE, CKEditor 4) aren't reached yet; the card opens on
click, not hover; keyboard access to cards came in Phase 7.

- Card, Accept/Dismiss, "don't suggest again", undo works via Ctrl+Z.
- Field badge and panel.
- **Exit:** accept/dismiss works on the site matrix; framework state stays in sync
  (e.g. GitHub's comment preview reflects accepted changes).

### Phase 6 — Settings and onboarding (week 6) — ✅ done, except manual exit timing

Done: onboarding page that opens on install, with two paths: an API key (provider, key,
model) or a model on this computer (finds servers on the default ports, setup steps for
Ollama and LM Studio when none runs, any other address, and the "Allow connection" fix). It
ends with a test check and a box to try Cadenza in. New installs start with no provider.
Settings gained goals (tone and readers; prompt v5), a personal dictionary (also "Add to
dictionary" on spelling cards), sites where Cadenza stays off (also a per-site switch in the
popup), usage per provider per day with an optional daily limit for hosted providers, and an
optional passphrase that encrypts API keys. Changing any of these rechecks open fields.
Tests: `e2e/setup.spec.ts` and unit tests for sites, dictionary, usage, settings and prompt v4.
Not covered: the exit timing needs a person and a fresh profile; the popup's site switch and
the hosted onboarding path need the toolbar click and a real key, so they are manual checks;
detecting servers on the default ports isn't in e2e (the other-address path is). Goals were
measured on `claude-haiku-5-5` and phi4 (v4 was too loose, v5 kept; see `docs/evals.md`).

- Remaining options, dictionary, goals, usage view, key passphrase.
- Onboarding with local-server detection.
- **Exit:** a fresh profile goes from install to first underline in under 2 minutes with a
  hosted key, under 5 minutes with Ollama already installed.

### Phase 7 — Hardening (week 7) — ✅ done, except signed-in sites

Done, by part:

- **Privacy.** Review in `docs/privacy.md`. Errors shown in pages carry a fixed message per
  kind of error, never the provider's own message (which can quote part of a key). Biome's
  `noConsole` rule fails the build on any log in extension, engine or provider code. The
  storage audit corrected the claim below: check results hold short flagged spans, in memory
  only.
- **Performance.** The content script is 12.7 KB gz, checked on every e2e build by
  `scripts/check-size.mjs`. Typing costs 2.6 ms p95 per frame in a 60-paragraph textarea
  (2.3 ms in a rich editor), checked by `e2e/perf.spec.ts`. Two fixes got it there: the
  textarea mirror now lays out one block per line and reuses unchanged lines, and the badge
  skips redraws that change nothing.
- **Accessibility.** A keyboard shortcut (Alt+Shift+., can be changed in Chrome) opens the
  card for the suggestion at the cursor. Pressed again, it opens the panel. Focus moves into
  the card, Tab stays inside it, and Escape puts focus and the caret back in the field.
  Settings show the current shortcut. Screen readers hear each change as a sentence, and
  panel buttons say which change they act on. Categories already differ by line style, not
  only color. Tests: `e2e/keyboard.spec.ts`.
- **Site matrix.** Draft.js, Trix, CKEditor 5 and a CodeMirror "never checked" case join
  ProseMirror, Lexical and Slate in `e2e/sites.spec.ts` (network, `CADENZA_NET_TESTS=1`). A
  local block-editor page stands in for Notion (`e2e/blocks.spec.ts`). Two fixes came from
  this work:
  - Rich editors that turn spellcheck off (Gmail, CKEditor) are now checked, unless they look
    like code.
  - `beforeinput` now carries target ranges. Without them, CKEditor inserted the fix at its own
    stale caret.

Not covered:

- Signed-in sites (Gmail, Outlook, Slack, LinkedIn, X, Reddit, Notion, Jira, Google Forms)
  need a person.
- Quill's public demos don't take focus under automation.
- In Trix, one undo removes an accepted fix together with the typing just before it. That is
  Trix's own undo grouping.
- Browser-level shortcuts can't be pressed from tests, so the tests send the same message the
  shortcut sends.

Original scope:

- Site matrix: Gmail, Outlook web, GitHub, Slack web, LinkedIn, X, Reddit, Notion, Jira,
  Google Forms, plain `<textarea>` pages. Playwright e2e against the mock provider.
- Performance budget: content script < 50 KB gz, no measurable typing lag (< 4 ms per input
  event).
- Privacy review: no text in logs; nothing stored but hashes, settings and keys; clear
  disclosure that text goes to the provider the user chose (or stays on the machine with a
  local model).
- Accessibility: keyboard navigation of cards, screen-reader labels, non-color cues.

### Phase 8 — Cadenza UI/UX (design system) — ✅ done

Gives Cadenza its own look and feel, from a design system supplied as design artifacts
(tokens, components and screens). Everything a user sees today is functional placeholder
styling. This phase replaces it before the hands-on testing, so that testing exercises the
real UI.

- **Tokens:** color, type, spacing, radius, elevation, motion, and the light and dark themes,
  in one source that every surface uses. Today the styling is spread across `lib/ui.css`
  (extension pages), the `STYLE` strings in `lib/popover.ts` and `lib/badge.ts`, and
  `packages/shared/src/categories.ts` (category colors and underline styles).
- **In-page UI:** underlines, the field badge, the suggestion card and the panel. These live
  in closed shadow roots on any site, so they must not inherit page styles or load remote
  fonts or assets.
- **Extension pages:** popup, settings, onboarding, and the error and locked states.
- **Brand assets:** icon set (16–128 px plus toolbar states) and the wordmark, under the naming
  rule in §6 (Cadenza only).
- **Keep what Phase 7 established:**
  - Categories stay distinguishable without color, through their line styles.
  - Contrast meets WCAG AA, and focus rings stay visible.
  - Keyboard and screen-reader behavior stays as it is.
  - The content script stays under 50 KB gz, and typing under 4 ms per input event.
- Update e2e selectors and screenshots that change with the new markup. The full suite and
  `npm run check` must pass.
- **Exit:**
  - Every surface uses the design system's tokens and components.
  - Light and dark themes both match the artifacts.
  - The budgets and accessibility checks above still pass.

**Done:**

- Tokens and components come from the kit's `ui.css`, vendored as `lib/kit.css`. Extension
  pages link it, and in-page surfaces adopt it into their shadow roots (`lib/surface.ts`).
  Category tints live with the categories in `packages/shared`.
- In-page UI:
  - The card has the kit layout: the category with its line sample, a "1 of N" count with
    previous and next, the change, the reason, Accept and Dismiss, and quiet "Don't suggest
    this again" and "Add to dictionary".
  - The panel groups suggestions by category, with Accept all for correctness. Its rows use a
    roving tab stop (arrows, Home and End move, Enter accepts, Delete dismisses).
  - The badge shows a count, an error, a check in progress, the Cadenza mark when there's
    nothing to fix, and paused when Cadenza is off here. The quiet states show only while the
    field has focus.
  - The open suggestion's words are tinted in the text.
  - Surfaces follow the field's theme (light or dark by its background). They use the top
    layer, and sit inside a modal dialog when the field is in one.
- The toolbar icon shows the focused field's count, and normal, paused and error states.
- The popup, settings and onboarding are rebuilt on the kit. The popup gains a provider
  switcher and today's usage meter; settings gain a two-way provider picker and category rows
  with their line samples.
- Icons (16–128 plus paused and error), logos, and store art come from the kit. Store art is
  in `store/`.
- Deviations from the artifacts:
  - Cards open on click, not hover (the Phase 4 decision stands).
  - Underlines stay CSS text decorations (Highlight API, or the mirror overlay) rather than
    drawn SVG. They have the same line styles, and keep the typing budget.
- Content script: 17.8 KB gz. `npm run check`, the full e2e suite and the network site matrix
  pass. Hands-on checks of the new UI on real sites are in `docs/testing.md`.
- Follow-up, so the kit's copy holds:
  - Undo after "Don't suggest this again" and "Add to dictionary" (a confirmation card) and
    after Accept all (in the panel).
  - The Ignored list records the site each rule was added on.
  - Off, or off on a site, the field's text isn't read at all (see `docs/privacy.md`).
  - Content script now 18.9 KB gz.
- Settings follow the kit's tabbed layout: a side nav (Provider, Writing, Dictionary, Sites,
  Ignored, Usage, Passphrase) with one section per tab, linkable by `#tab`.
  - Provider: saved providers beside the form for the selected one (preset picker, show-key
    button, Use this provider, Delete with a confirmation).
  - Writing: English variant and formality as pills, category rows, audience, and the shortcut
    with a button to change it in Chrome.
  - Sites lists when each site was turned off; Ignored shows each rule's change and its site,
    with Restore; Usage is a 7-day table with totals, beside the optional daily limit.
  - Deviations: Formality keeps "No preference", the audience options are Cadenza's own, and
    the unlocked passphrase state (Lock now, Remove passphrase) has no artboard, so it reuses
    the kit's card.

### Phase 9 — Testing

The automated suites cover what a test browser can reach. This phase is the hands-on pass
that they can't do: a person in a real Chrome profile, with real sign-ins, keys and
keyboards. The checklist is `docs/testing.md`; results and bugs are recorded there.

- **Signed-in site matrix:** Gmail (subject and body), Outlook web, GitHub, Slack, LinkedIn,
  X, Reddit, Notion, Jira, Google Forms. On each one, an underline appears, Accept changes
  the text, the site's own state follows (preview, send, draft saved), and undo works.
- **Install and setup:** time a fresh profile from install to first underline (under 2 minutes
  with a hosted key, under 5 with Ollama already installed). Try both onboarding paths, the
  popup's per-site switch, and the passphrase lock and unlock across a browser restart.
- **Providers with real keys:** every provider you have a key for, plus a local model. Run
  Test connection, check a field, then confirm that a wrong key and a stopped server show
  clear errors.
- **Keyboard and screen reader:** press the real shortcut, Tab and Escape, and remap the
  shortcut in Chrome. Then run one screen reader through a card and the panel (Orca, NVDA or
  VoiceOver).
- **Display:** dark mode, page zoom 80–200%, forced colors (high contrast), a right-to-left
  page, and a field inside an iframe.
- **Updates:** install the previous build, set it up, update to the new build in place, then
  confirm settings, keys and the dictionary survive.
- **Daily use:** use Cadenza for normal writing for a week. Note false positives, missed
  mistakes, slow checks and anything confusing.
- Each bug found gets a fix and, where a test browser can reach it, an e2e test.
- **Exit:** the checklist is complete, with no open bug that loses text, applies a wrong
  change, leaks text or keys, or breaks typing on a site in the matrix.

### Phase 10 — Release

- Chrome Web Store listing, icons, screenshots, privacy policy.
- Permission justifications for review (content scripts on all sites, vendor API hosts,
  optional localhost).
- Drafts (not yet submitted):
  - `store/listing.md`: name, summary, category and description.
  - `store/privacy-policy.md`: the public policy, written from `docs/privacy.md`. It still
    needs a home (a public URL), an effective date and a contact address.
  - `store/review.md`: single purpose, a justification per permission, remote code, the
    data-usage answers, and test steps for the reviewer using the built-in test rules.
  - Icons, promo tiles and screenshots in `store/` come from the design kit and are final.

### Later (not v1)

Google Docs (canvas-rendered, needs its own integration), Firefox/Safari, per-site provider
choice, a second "deep review" model, full-document and tone rewrites, Bedrock/Vertex, Chrome's
built-in on-device model, desktop app.

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

## 8. Decisions

All settled before release.

1. **Presets at launch:** the table under "Provider support" (§1); everything else uses "Custom OpenAI-compatible
   endpoint". The list lives in `packages/providers/src/presets.ts`.
2. **Chrome's built-in on-device model:** not in v1. Local models are covered by the
   local-server presets; the built-in model moves to Later.
3. **Build tool:** WXT.
4. **Brand palette and icon:** the design kit's (Phase 8), including the fermata icon and the
   store art in `store/`.
