import type { FieldKind } from './settings';

export type FieldElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

/** Which of the kinds of field a user can turn off this one is. */
export function fieldKind(field: FieldElement): FieldKind {
  if (field instanceof HTMLTextAreaElement) return 'textarea';
  if (field instanceof HTMLInputElement) return 'input';
  return 'rich';
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', '']);
const BLOCKED_AUTOCOMPLETE = /\b(cc-|one-time-code|current-password|new-password)/;

/** Is this a plain-text control whose value we read and write directly? */
export function isTextControl(el: Element): el is HTMLTextAreaElement | HTMLInputElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type.toLowerCase());
}

/** The outermost contenteditable element containing `el`, or null. */
export function editingHost(el: Element): HTMLElement | null {
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null;
  let host: HTMLElement = el;
  while (host.parentElement?.isContentEditable) host = host.parentElement;
  return host;
}

/**
 * Resolve the event target to a field Cadenza should check, or null.
 * Never activates on password or payment fields, disabled/read-only fields, or opted-out ones.
 */
export function resolveField(target: EventTarget | null): FieldElement | null {
  if (!(target instanceof Element)) return null;
  const field: FieldElement | null = isTextControl(target) ? target : editingHost(target);
  if (!field) return null;
  if (field.closest('[data-cadenza="off"]')) return null;
  if (isTextControl(field)) {
    if (field.disabled || field.readOnly) return null;
    if (BLOCKED_AUTOCOMPLETE.test(field.autocomplete ?? '')) return null;
  }
  if (field.dataset.cadenza === 'on') return field;
  if (isTextControl(field)) {
    // Inputs and textareas without spellcheck are usually codes, commands or usernames.
    if (field.getAttribute('spellcheck') === 'false') return null;
  } else if (field.getAttribute('spellcheck') === 'false' && looksLikeCode(field)) {
    // Rich editors turn browser spellcheck off for their own reasons (Gmail's message body
    // does, to use its own checker), so only code editors opt out.
    return null;
  }
  return field;
}

const CODE_EDITORS = '.cm-editor, .CodeMirror, .monaco-editor, .ace_editor, [data-language]';
const MONOSPACE = /^\s*["']?(monospace|ui-monospace|courier|consolas|menlo|monaco|[^,]*\bmono\b)/i;

/** A code editor: a known one, or an editable region set in a monospace font. */
export function looksLikeCode(el: HTMLElement): boolean {
  if (el.closest(CODE_EDITORS)) return true;
  return MONOSPACE.test(getComputedStyle(el).fontFamily);
}
