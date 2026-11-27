# Chrome Web Store review answers (draft)

Answers for the store's Privacy practices tab, and notes for the reviewer. Each field is
written to paste as is; the store's limit is 1,000 characters per field.

## Single purpose

> Cadenza suggests corrections and improvements to text the user writes in text fields on web
> pages, using an AI provider or local model the user chooses.

## Permission justifications

### storage

> Saves the user's settings in the browser: the providers they set up (without keys), which
> kinds of suggestions they want, their personal dictionary, suggestions they chose to ignore,
> sites they turned Cadenza off on, and daily check counts. Recent suggestions are cached in
> session storage so unchanged text isn't sent again. Nothing is synced.

### declarativeNetRequestWithHostAccess

> Some model servers that run on the user's own computer (for example on localhost) refuse
> requests that carry a browser extension's Origin header. When the user sets up such a server
> and clicks "Allow connection", Cadenza adds one rule that removes the Origin header from its
> own requests to that one server. The rule only applies to hosts the user has granted, and
> Cadenza adds no rules for any other site.

### activeTab

> The toolbar popup reads the current tab's site name so the user can turn Cadenza off, or
> back on, for that site in one click.

### Host permissions: content script on all sites

> Cadenza is a writing assistant for any text field on the web, so its content script runs on
> all sites and in their frames (comment widgets and editors are often in iframes). It only
> reads a field's text while the user is typing in it and Cadenza is on for that site. It
> never reads password, payment or one-time-code fields, or code editors. The text goes to the
> extension's service worker and from there only to the provider the user chose. The user can
> turn Cadenza off for any site, and then the script reads nothing on it.

### Optional host permissions (http://localhost/_, http://127.0.0.1/_, https://_/_)

> Not granted at install. Cadenza calls hosted AI providers without any host permission. It
> asks for access to one origin only when the user adds their own endpoint (a model server on
> their computer, or a custom URL) and the browser blocks the connection. The user then clicks
> "Allow connection" and Chrome asks them to approve that single origin.

## Remote code

**No, I am not using remote code.** All JavaScript is in the package. Providers return JSON
suggestions, which are validated and shown as text; nothing they return is run.

## Data usage

Cadenza has no server, so the developer collects nothing. The store's form counts data that
the extension sends to a third party, so two categories apply because text and keys go to
the provider the user chose:

| Category                   | Tick | Why                                                                                      |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| Website content            | Yes  | The text the user writes in a field is sent to their chosen provider to get suggestions. |
| Authentication information | Yes  | The user's own API key is sent to the provider it belongs to, with each request.         |
| All other categories       | No   | No personal details, health, financial, location, history or activity data.              |

The three certifications all apply:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single
      purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: [where `store/privacy-policy.md` is published]

## Notes for the reviewer

Paste into the "Test instructions" field (500 characters at most; this is 458), so a reviewer
can try Cadenza without an API key:

```text
No API key needed: Cadenza has built-in test rules.
1. Close the setup page that opens on install. Right-click the toolbar icon, then Options.
2. On the Provider tab, set Preset to "Test rules (no AI)" and click Save provider.
3. In any text box on a web page, type: Read teh book tomorow.
"teh" and "tomorow" are underlined. Click one to see the suggestion, then Accept to apply it.
The test rules run inside the extension and send nothing over the network.
```

## Before submitting

- Publish the privacy policy and paste its URL above and in the store's privacy field.
- Fill in the policy's effective date and contact address.
- Answer the data-usage form from this file, and keep it in step with the policy.
