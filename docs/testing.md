# Testing checklist (Phase 9)

Hands-on checks the automated suites can't do. They need a real Chrome profile, sign-ins,
keys or a person at the keyboard. Load the normal build (`npm run build`, then load
`packages/extension/.output/chrome-mv3` unpacked), not the e2e build.

Mark each item `[x]` when it passes, or link a bug under **Bugs** below. Write the date and
Chrome version next to each section you run.

## Signed-in site matrix

For each site, in a field you would really write in, type `Read teh book tomorow.` and check
these four things:

- **U:** an underline appears.
- **A:** Accept changes the text.
- **S:** the site's own state follows (preview, draft saved, sent text is correct).
- **Z:** Ctrl+Z undoes the change.

| Site           | Field                | U   | A   | S   | Z   | Notes                              |
| -------------- | -------------------- | --- | --- | --- | --- | ---------------------------------- |
| Gmail          | Subject              | [x] | [ ] | [ ] | [ ] | Underlines confirmed               |
| Gmail          | Message body         | [ ] | [ ] | [ ] | [ ] | Re-test after spellcheck fix       |
| Outlook web    | Message body         | [ ] | [ ] | [ ] | [ ] |                                    |
| GitHub         | Issue or PR comment  | [x] | [x] | [ ] | [ ] | Check that the Preview tab matches |
| Slack          | Message box          | [ ] | [ ] | [ ] | [ ] | Quill-based                        |
| LinkedIn       | Post or message      | [ ] | [ ] | [ ] | [ ] | Quill-based                        |
| X              | Post box             | [ ] | [ ] | [ ] | [ ] | Draft.js-based                     |
| Reddit         | Comment              | [ ] | [ ] | [ ] | [ ] |                                    |
| Notion         | Page text            | [ ] | [ ] | [ ] | [ ] | One editable per block             |
| Jira           | Description, comment | [ ] | [ ] | [ ] | [ ] |                                    |
| Google Forms   | Long answer          | [ ] | [ ] | [ ] | [ ] |                                    |
| Any plain page | `<textarea>`         | [ ] | [ ] | [ ] | [ ] |                                    |

Also check that a code block or code editor on any of these sites is never underlined.

## Install and setup

- [ ] Fresh profile, hosted key: from install to first underline in under 2 minutes. Time: \_\_\_
- [ ] Fresh profile, Ollama already installed: from install to first underline in under
      5 minutes. Time: \_\_\_
- [ ] Onboarding, API-key path: pick a provider, paste a key, pick a model, try the box.
- [ ] Onboarding, local path: the server is found on its default port, or the "any other
      address" path works.
- [ ] The popup's per-site switch turns Cadenza off on that site, and back on.
- [ ] In a Google Doc: no underlines or badge, and the popup says Google Docs support is
      coming soon in place of the site switch. Google Forms and Gmail still work.
- [ ] Passphrase: set it, restart the browser, confirm checks stop until you unlock from the
      popup, then confirm they resume.

## Providers with real keys

For each provider you have: Test connection passes and a field gets checked. A wrong key
should show "The API key was rejected", and a stopped local server should show "Couldn’t reach
the provider".

- [x] Anthropic: Test connection
- [x] Local model (llama.cpp / Llama): Test connection
- [ ] Anthropic: field check and wrong-key message
- [ ] Local model: field check and stopped-server message
- [ ] Others you have keys for: \_\_\_

## Keyboard and screen reader

- [ ] The real shortcut (Alt+Shift+.) in a text field opens the card at the cursor.
- [ ] Pressed again, it opens the panel.
- [ ] Tab stays inside the card, Enter accepts, and Escape puts the cursor back where it was.
- [ ] Remap the shortcut in `chrome://extensions/shortcuts`; settings show the new keys.
- [ ] A screen reader (Orca, NVDA or VoiceOver) reads the change as a sentence on the card,
      and reads each panel button together with its change.
- [ ] In the panel, the arrow keys move between rows, Enter accepts and Delete dismisses; the
      screen reader reads each row's change.
- [ ] The card's previous and next buttons step through the field's suggestions in reading
      order, scrolling the field to each one.
- [ ] "Don't suggest this again" and "Add to dictionary" leave a confirmation with Undo where
      the card was; Undo brings the suggestion back. From the keyboard, focus lands on Undo.
- [ ] Accept all in the panel shows "Accepted N changes" with Undo, which puts back every change
      (also in a rich editor such as Gmail, keeping the formatting). Typing removes the Undo.
- [ ] Settings → Ignored shows the site each rule was added on.

## Display

- [ ] Dark mode: card, panel, badge, popup and settings are readable.
- [ ] Settings: each side tab opens its section, the address keeps the tab (`#writing` and
      so on) across a reload, and Back returns to the previous tab. At a narrow window the nav
      sits above the section.
- [ ] On a dark site (for example, GitHub's dark theme), the card, panel and badge follow the
      field and use the dark theme.
- [ ] The toolbar icon shows the count for the focused field, the paused icon on a site that
      is turned off and when Cadenza is switched off, and the error icon after a failed check.
      It resets when the tab navigates.
- [ ] A field inside a modal dialog (for example, a GitHub or Jira dialog): the card and panel
      show above the dialog and take clicks.
- [ ] Page zoom at 80%, 125% and 200%: underlines sit on their words.
- [ ] Forced colors (high contrast): underlines and buttons are visible.
- [ ] A right-to-left page (for example, Hebrew Wikipedia's edit box): nothing breaks.
- [ ] A field inside an iframe (for example, a comment widget): it is checked.

## Updates

- [ ] Install the previous commit's build and set it up (provider, dictionary word, a site
      turned off).
- [ ] Build the new version and reload the extension in place.
- [ ] Settings, keys, the dictionary and the site list are all still there, and checks work.

## Daily use (one week)

Use Cadenza for normal writing. Note anything below:

- False positives (a change that was wrong or unneeded):
- Missed mistakes:
- Slow checks (site, provider, roughly how long):
- Anything confusing:

## Bugs

| #   | Found on | What happened | Status |
| --- | -------- | ------------- | ------ |
