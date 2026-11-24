import { buildTextMap, rangeFor } from './text-map';

/** One replacement in field-text offsets. */
export interface Edit {
  start: number;
  end: number;
  original: string;
  replacement: string;
}

/**
 * Replace text in a <textarea> or <input> the way typing would: select the range and insert
 * with `execCommand('insertText')`, so the browser records it for Ctrl+Z and fires the native
 * `input` events frameworks listen to. Falls back to `setRangeText()` plus an `input` event if
 * the browser refused (no undo then). All edits become one step, so one Ctrl+Z reverts them.
 * Returns false, leaving the field alone, if the text no longer matches.
 */
export function applyToTextControl(
  field: HTMLTextAreaElement | HTMLInputElement,
  edits: Edit[],
): boolean {
  const before = field.value;
  const merged = mergeEdits(before, edits);
  if (!merged) return false;
  const { start, end, replacement } = merged;
  const expected = before.slice(0, start) + replacement + before.slice(end);

  field.focus({ preventScroll: true });
  field.setSelectionRange(start, end);
  insert(field.ownerDocument, replacement);
  if (field.value === expected) return true;
  if (field.value !== before) return false; // The page did something else with it.

  field.setRangeText(replacement, start, end, 'end');
  field.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: replacement,
    }),
  );
  return field.value === expected;
}

/**
 * Replace text in a contenteditable editor without touching its DOM ourselves. The range is
 * selected and offered to the editor as a `beforeinput`; editors that handle input
 * themselves apply it to their own model. Otherwise `execCommand('insertText')` edits as
 * typing would, so the browser's undo history and the page's `input` listeners stay in sync.
 * Edits are applied last to first so earlier offsets stay valid.
 */
export async function applyToEditable(root: HTMLElement, edits: Edit[]): Promise<boolean> {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as Edit).end > (sorted[i - 1] as Edit).start) return false;
  }
  for (const edit of sorted) {
    if (!(await applyOneToEditable(root, edit))) return false;
  }
  return true;
}

async function applyOneToEditable(root: HTMLElement, edit: Edit): Promise<boolean> {
  const map = buildTextMap(root);
  if (map.text.slice(edit.start, edit.end) !== edit.original) return false;
  const { start, end, replacement } = widenDeletion(map.text, edit);
  const range = rangeFor(map, start, end);
  if (!range) return false;
  const expected = normalize(map.text.slice(0, start) + replacement + map.text.slice(end));
  const current = () => normalize(buildTextMap(root).text);

  const doc = root.ownerDocument;
  if (doc.activeElement !== root && !root.contains(doc.activeElement)) {
    root.focus({ preventScroll: true });
  }
  const select = () => {
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  select();
  const original = normalize(map.text);
  // Editors that own their model (ProseMirror, Lexical, Slate…) apply beforeinput themselves
  // and cancel it. execCommand doesn't fire beforeinput, so offer them the edit first.
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: replacement ? 'insertText' : 'deleteContentBackward',
    data: replacement || null,
  });
  (range.startContainer.parentElement ?? root).dispatchEvent(event);
  if (event.defaultPrevented) {
    // Some editors apply the change on their next update rather than synchronously.
    await settled(() => current() !== original);
    return current() === expected;
  }
  // Nobody took it: let the browser edit, as typing would (undo history included).
  select();
  insert(doc, replacement);
  await settled(() => current() !== original);
  return current() === expected;
}

function insert(doc: Document, text: string): void {
  try {
    if (text) doc.execCommand('insertText', false, text);
    else doc.execCommand('delete', false);
  } catch {
    // Some pages make execCommand throw; the caller checks the result.
  }
}

/** Wait up to two frames for `done()` to become true. */
async function settled(done: () => boolean): Promise<boolean> {
  for (let i = 0; i < 2 && !done(); i++) {
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
  }
  return done();
}

/** Editors write spaces next to each other or at line ends as no-break spaces. */
function normalize(text: string): string {
  return text.replace(/ /g, ' ');
}

/**
 * Deleting a word ("basically") would leave two spaces, or a space before punctuation: take
 * one neighboring space with it.
 */
export function widenDeletion(text: string, edit: Edit): Edit {
  if (edit.replacement !== '') return edit;
  const before = text[edit.start - 1];
  const after = text[edit.end];
  if (before === ' ' && (after === undefined || after === ' ' || /[.,;:!?)\n]/.test(after))) {
    return { ...edit, start: edit.start - 1, original: text.slice(edit.start - 1, edit.end) };
  }
  if ((before === undefined || before === '\n') && after === ' ') {
    return { ...edit, end: edit.end + 1, original: text.slice(edit.start, edit.end + 1) };
  }
  return edit;
}

/**
 * Combine edits into one replacement spanning all of them, or null if any no longer matches
 * the text or two overlap.
 */
export function mergeEdits(
  text: string,
  edits: Edit[],
): { start: number; end: number; replacement: string } | null {
  const list: Edit[] = [];
  for (const e of edits) {
    if (text.slice(e.start, e.end) !== e.original) return null;
    list.push(widenDeletion(text, e));
  }
  list.sort((a, b) => a.start - b.start);
  if (list.length === 0) return null;
  const start = (list[0] as Edit).start;
  let end = start;
  let replacement = '';
  for (const e of list) {
    if (e.start < end) return null;
    replacement += text.slice(end, e.start) + e.replacement;
    end = e.end;
  }
  return { start, end, replacement };
}
