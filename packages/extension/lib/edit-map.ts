import type { Suggestion } from '@cadenza/shared';

/** The single changed region between two versions of a text. */
export interface TextEdit {
  /** Where the change starts (same in both texts). */
  start: number;
  /** End of the replaced region in the old text. */
  oldEnd: number;
  /** End of the inserted region in the new text. */
  newEnd: number;
}

/** Find the changed region by trimming the common prefix and suffix. */
export function diffText(oldText: string, newText: string): TextEdit | null {
  if (oldText === newText) return null;
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

const WORD_CHAR = /[\p{L}\p{N}'’_-]/u;

/**
 * Move suggestions to where their text is after an edit, so underlines follow the text while
 * the user types instead of disappearing until the next check. A suggestion the edit touches
 * is dropped: its text changed, or a letter typed right next to it changed the word. Typing a
 * space or punctuation right after a word keeps its underline.
 */
export function mapThroughEdit(
  suggestions: Suggestion[],
  oldText: string,
  newText: string,
): Suggestion[] {
  const edit = diffText(oldText, newText);
  if (!edit) return suggestions;
  const delta = edit.newEnd - edit.oldEnd;
  const inserted = newText.slice(edit.start, edit.newEnd);
  const out: Suggestion[] = [];
  for (const s of suggestions) {
    if (s.end < edit.start || (s.end === edit.start && !joinsAfter(s, edit, inserted, oldText))) {
      out.push(s); // entirely before the edit
    } else if (
      s.start > edit.oldEnd ||
      (s.start === edit.oldEnd && !joinsBefore(edit, inserted, oldText))
    ) {
      out.push({ ...s, start: s.start + delta, end: s.end + delta });
    }
    // otherwise the edit overlaps or extends the suggestion's text: drop it
  }
  return out.filter((s) => newText.slice(s.start, s.end) === s.original);
}

/** The edit starts right where the suggestion ends: does it extend the suggestion's word? */
function joinsAfter(s: Suggestion, edit: TextEdit, inserted: string, oldText: string): boolean {
  if (edit.oldEnd > edit.start) return true; // deleting text right after it
  const last = oldText[s.end - 1] ?? '';
  const first = inserted[0] ?? '';
  return WORD_CHAR.test(last) && WORD_CHAR.test(first);
}

/** The edit ends right where the suggestion starts: does it extend the suggestion's word? */
function joinsBefore(edit: TextEdit, inserted: string, oldText: string): boolean {
  if (edit.oldEnd > edit.start) return true;
  const first = oldText[edit.oldEnd] ?? '';
  const last = inserted.at(-1) ?? '';
  return WORD_CHAR.test(first) && WORD_CHAR.test(last);
}
