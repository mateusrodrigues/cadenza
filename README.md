<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.svg">
    <img src="docs/images/banner-light.svg" alt="Cadenza, a quiet writing assistant" width="100%">
  </picture>
</h1>

Writing suggestions in any text field on the web. Cadenza underlines what it would change,
color-coded by kind (correctness, clarity, style, tone), using the AI provider you choose with
your own API key, or a model running on your own computer.

## Install from source

Until Cadenza is in the Chrome Web Store, you can build it yourself and load it into Chrome
(or another Chromium browser, such as Edge or Brave). You need [Git](https://git-scm.com/) and
[Node.js](https://nodejs.org/) 22.12 or later.

1. Get the code and build the extension:

   ```bash
   git clone https://github.com/mateusrodrigues/cadenza.git
   cd cadenza
   npm ci
   npm run build
   ```

2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Choose **Load unpacked** and select the `packages/extension/.output/chrome-mv3` folder.
4. A setup page opens. Pick an AI provider and paste your API key, or connect a model running
   on this computer. Then type in any text field and Cadenza underlines what it would change.

To update, pull the latest code and build again, then select the reload button on
Cadenza's card in `chrome://extensions`. Your settings, keys and dictionary are kept. Removing
the extension deletes them.

`npm run zip -w @cadenza/extension` makes the same build as a zip in
`packages/extension/.output/`, for the store or for copying to another computer (unzip it, then
load the folder as above).

## Development

Requires Node 22.12+.

```bash
npm install
npm run dev          # builds the extension in watch mode
npm run check        # lint, typecheck, naming guard, unit tests
npm run test:e2e     # builds, then runs browser tests against the built extension
```

Load the build as in [Install from source](#install-from-source). Test builds
(`CADENZA_E2E=1`, in `packages/extension/.output-e2e/chrome-mv3`) skip the setup page and start
on built-in test rules instead.

To run the engine against a local OpenAI-compatible server:

```bash
CADENZA_LIVE_BASE_URL=http://127.0.0.1:11434/v1 CADENZA_LIVE_MODEL=<model> npx vitest run live
```

Project plan: [docs/PLAN.md](docs/PLAN.md). Spike findings: [docs/spikes.md](docs/spikes.md).
