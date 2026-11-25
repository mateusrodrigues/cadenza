# Google Docs support (design note)

Status: proposal, not started. Cadenza stays out of Google Docs for now, and the popup says
support is coming soon (`unsupportedEditor()` in `lib/sites.ts`). This note records why Docs
needs its own integration, the options looked at, and the recommended route: an Editor add-on
whose sidebar works through the extension.

Researched 2026-11-25 from Google's documentation and developer forums; sources at the end.
Points marked **unverified** need the spike in §5 before anything is built on them.

## 1. Why the extension can't do it

- **No text in the page.** Since 2021 Docs draws the document on `<canvas>`. The DOM has no
  document text, so there is nothing to read, map to positions, or underline.
- **No field to apply into.** Keystrokes go to a small hidden contenteditable iframe that holds
  only the current input. Synthetic input events, which work in other editors, are ignored.

## 2. Options considered

| Option                                       | Underlines in text | Sign-in        | Verdict                                                   |
| -------------------------------------------- | ------------------ | -------------- | --------------------------------------------------------- |
| Annotated canvas (Google's allowlist)        | Yes                | No             | Best experience; access isn't in our hands (below)        |
| Docs API from the extension                  | No                 | Google OAuth   | Workable, but sensitive-scope review and a clumsy picker  |
| Workspace add-on (card UI)                   | No                 | Add-on consent | Card UI too rigid for suggestions; short run time         |
| Editor add-on, standalone                    | No                 | Add-on consent | Keys stored in the user's Google account; no local models |
| **Editor add-on that works through Cadenza** | No                 | Add-on consent | **Recommended**                                           |

**Annotated canvas.** Docs can build a hidden, structured copy of the text (for screen
readers) with each line's position. An extension turns it on by setting
`window._docs_annotate_canvas_by_ext` to its own ID, and Docs honours it only for IDs on a list
Google keeps. Chrome's own reading mode uses the same switch. Established writing assistants
have this access. Google's 2021 announcement offers a request form, but a 2025 forum thread
reports repeated submissions with no reply, so a new extension may never get on the list.
Worth applying once Cadenza is in the store with a stable ID; not something to plan around.

**Docs API from the extension.** `chrome.identity` can sign in without a server. Reading any
Doc needs the `documents` scope (sensitive: Google verification). The narrow `drive.file`
scope avoids most of that, but users must pick each document in a file picker first. No
on-screen positions, so a side panel at best.

**Workspace add-on.** Google's recommended kind for new work. Its sidebar is built from
Google's fixed card components, not HTML, and a community report puts its run time per action
at about 30 seconds (**unverified**). A suggestion list with explanations, Show and Accept fits
poorly.

**Editor add-on, standalone.** HTML sidebar, opened from the Doc's Extensions menu. Calling the
provider itself means keeping the API key in Apps Script's per-user storage (on Google's
servers) and making requests from Google's servers, which can't reach a model on the user's
computer. That breaks two of Cadenza's promises.

## 3. Recommended design

An **Editor add-on** (Apps Script, HTML sidebar) that reads the document and applies changes,
while the **extension** does the checking with the user's existing setup.

```
Google Doc ── Apps Script (add-on) ──▶ sidebar page (googleusercontent.com frame)
                 ▲  read text, select,        │  text, via window messages
                 │  replace                   ▼
                 └──── Accept ◀──── Cadenza content script in the sidebar frame
                                              │  existing worker messages
                                              ▼
                                     Cadenza worker ──▶ the user's provider or local model
```

1. **Reading.** The add-on reads the body through `DocumentApp`. It has no change event in Docs
   (`onEdit` is Sheets only), so the sidebar polls every few seconds while it's open, and
   sends only changed paragraphs on.
2. **Checking.** The sidebar posts the paragraphs to Cadenza's content script, which runs in
   the sidebar's frame (all frames, all sites). The worker checks them as it does any field:
   same provider, key, model, dictionary, ignore list, cache and daily limit.
3. **Showing.** The sidebar lists suggestions by category, as the panel does. **Show** calls
   `setSelection()` so Docs scrolls to and selects the words. No underlines: marking words
   would mean changing their background colour, which edits the document for every
   collaborator and lands in version history.
4. **Applying.** **Accept** calls the add-on to replace that range, after checking the text
   there still matches what was flagged.

Why through the extension:

- **One setup.** Keys and settings stay in the extension; nothing is entered twice.
- **Same privacy story.** Keys never leave the browser; local models keep working; no server.
- **Detection.** The sidebar and the extension greet each other when the sidebar opens. The
  extension remembers it has seen the add-on, and the popup on a Doc shows either "Open
  Cadenza from Extensions › Cadenza" or "Get the Cadenza add-on". Chrome can't tell an
  extension whether an add-on is installed before its sidebar has opened at least once.

### Security

The sidebar page is untrusted, like any page: messages are validated, nothing is applied
without a click, and no key or provider response reaches it. One new risk: every Apps Script
page is served from `googleusercontent.com`, so another script could pose as Cadenza's add-on
and spend the user's API credit. The extension must recognise its own add-on (for example by
the script's stable frame address; **unverified**) and may require a click in the sidebar
before the first check.

## 4. What users would see

- Desktop browsers only (Editor add-ons don't run in the mobile apps).
- A sidebar list instead of underlines, refreshed every few seconds while it's open.
- A one-time Google consent screen when installing the add-on, asking to read and change only
  the open document.

## 5. Spike before committing

A script attached to a test Doc, a minimal sidebar, and the e2e extension build. Settle:

1. **Reach and pairing.** Does Cadenza's content script run in the sidebar frame? Can the
   extension reliably recognise its own add-on and ignore other scripts?
2. **Apply and undo.** Does a change made by the add-on undo with Ctrl+Z? How does it look to
   a collaborator? How long does a Show or Accept round trip take?
3. **Mapping.** Can suggestion offsets map cleanly onto Docs' paragraphs, lists, tables,
   footnotes and document tabs?
4. **Review.** Will Marketplace reviewers accept an add-on that needs a separate extension?
   No rule found either way. Check Google's guidance, or ask, before building it.

If 4 comes back no, the fallback is the standalone add-on, with its weaker privacy promise.

## 6. Build plan

- `packages/docs-addon`: TypeScript, deployed with `clasp` (Google's Apps Script CLI). Thin:
  read, select, replace, and the sidebar UI on the design kit. The engine stays in the
  extension.
- Extension: the sidebar pairing protocol (versioned, validated), the popup's Docs states, and
  e2e tests with a stand-in sidebar page.
- Size: roughly a Phase 4-to-6-sized piece of work.

## 7. Publishing

1. **Google Cloud project** (a standard one, not the default Apps Script project).
2. **OAuth consent screen:** the Cadenza name and logo, plus homepage and privacy policy links
   on a domain Cadenza owns and has verified with Google. The privacy policy must be hosted
   there, and needs a section on the add-on.
3. **Scopes:** `documents.currentonly` (the open document only) and the sidebar scope. Google
   asks published add-ons for the narrowest scopes they can. Whether `documents.currentonly`
   counts as sensitive (which adds OAuth verification) is **unverified**.
4. **Marketplace listing and review:** review "typically takes several days"; sensitive-scope
   verification is a separate check quoted at 3 to 5 working days, and Google suggests 2 to 3
   weeks overall. One developer reports verification stalled for over 8 weeks. The listing is
   outward-facing, so PLAN §6's naming rule applies.
5. **Updates:** code ships as new add-on versions. A changed listing or new scopes means
   another review.
6. **Quotas:** the add-on runs under each user's Apps Script quota. Polling only reads the
   document; provider calls happen in the extension, so the limits should be comfortable.

## 8. Order of work

1. Ship the extension (v1) with Cadenza off in Docs and the "coming soon" banner.
2. Apply for the annotated-canvas allowlist once the store listing has a stable ID.
3. Run the spike (§5).
4. If it holds up, build and publish the add-on as the Docs release. If allowlist access
   arrives later, underlines in the text can come on top; the two don't conflict.

## Sources

- [Add-on types](https://developers.google.com/workspace/add-ons/concepts/types)
- [Extend the Editors with Google Workspace add-ons](https://developers.google.com/workspace/add-ons/editors/gsao)
- [Triggers for Editor add-ons](https://developers.google.com/workspace/add-ons/concepts/editor-triggers)
- [Authorization scopes for Editor add-ons](https://developers.google.com/workspace/add-ons/concepts/editor-scopes)
- [Translate quickstart (sidebar pattern)](https://developers.google.com/workspace/add-ons/editors/docs/quickstart/translate)
- [Class Document (`setSelection`)](https://developers.google.com/apps-script/reference/document/document)
- [App review process](https://developers.google.com/workspace/add-ons/concepts/gmail-addon-review)
- [Configure OAuth for the Marketplace](https://developers.google.com/workspace/marketplace/configure-oauth-consent-screen)
- [OAuth verification stalled 8+ weeks (forum)](https://discuss.google.dev/t/oauth-verification-for-workspace-add-on-stuck-for-8-weeks-client-critical/318451)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Editor vs Workspace add-on run time (community)](https://groups.google.com/g/google-apps-script-community/c/0YCifQavtf0)
- [Google Docs canvas rendering announcement](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)
- [Chromium reading mode's Docs helper](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/reading_mode_gdocs_helper/gdocs_script.js)
- [Allowlist requests going unanswered (forum, 2025)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/zBrytYVx650)
