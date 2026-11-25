import { splitParagraphs } from '@cadenza/engine/paragraphs';
import type { Category, Paragraph, Suggestion } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { applyToEditable, applyToTextControl, type Edit, invertEdits } from './apply';
import { type BadgeState, FieldBadge } from './badge';
import { dictionaryWord, withoutDictionary } from './dictionary';
import { mapThroughEdit } from './edit-map';
import { type FieldElement, isTextControl } from './fields';
import { hits } from './geometry';
import { ruleKey } from './ignored';
import type {
  AddWordMessage,
  CheckMessage,
  CheckResponse,
  ContentMessage,
  ForgetMessage,
  GateMessage,
  GateResponse,
  IgnoreMessage,
  OffReason,
  RemoveWordMessage,
  TabStateMessage,
  UnignoreMessage,
} from './messages';
import { timed } from './perf';
import {
  closePopover,
  focusPopover,
  openKind,
  openPopover,
  popoverEngaged,
  repositionPopover,
  updatePopover,
} from './popover';
import { HighlightRenderer } from './render-highlights';
import { OverlayRenderer } from './render-overlay';
import type { Renderer } from './renderer';
import { pageSite } from './sites';
import { buildTextMap, offsetOf, type TextMap } from './text-map';
import { buildCard, buildDone, buildPanel, type PanelNote, type PanelUndo } from './views';

const DEBOUNCE_MS = 700;
const SLOW_DEBOUNCE_MS = 1500;
/** How long the "Won't suggest … again · Undo" card stays, unless the pointer or focus is on it. */
const DONE_MS = 6000;
let nextFieldId = 1;

/**
 * One editable field Cadenza is watching: reads its text after the user pauses, asks the
 * worker for suggestions, draws them if the text hasn't changed in the meantime, and applies
 * the ones the user accepts.
 */
export class FieldSession {
  readonly fieldId = `f${nextFieldId++}`;
  private readonly renderer: Renderer;
  private readonly badge: FieldBadge;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestSeq = 0;
  /** Text whose check completed with nothing pending; no need to ask again. */
  private settledText: string | null = null;
  /** Set from worker responses: the active provider is slow, so wait longer after typing. */
  private slow = false;
  /** What is drawn, and the text it was drawn for; edits map it forward (see edit-map). */
  private drawn: Suggestion[] = [];
  private drawnText = '';
  private inputFrame = 0;
  /**
   * Suggestions the user dismissed in this field. Edits move them like underlines, so a
   * recheck doesn't bring them back; editing the dismissed text itself forgets the dismissal.
   */
  private dismissed: Suggestion[] = [];
  /** "Don't suggest this again" rules added from this field; the worker filters the rest. */
  private readonly ignored = new Set<string>();
  /** Words added to the dictionary from this field; the worker filters the rest. */
  private readonly words: string[] = [];
  /** Cadenza is off for this page (or not set up): no checks until settings change. */
  private off: OffReason | null = null;
  /**
   * The worker said Cadenza is on here at the last check. Until it does, the field's text is
   * not read at all (not even to follow edits): when off, nothing is read or sent.
   */
  private on = false;
  /** Undo for the last Accept all in the panel, while the text is still what it left. */
  private undoAll: { edits: Edit[]; text: string; count: number } | null = null;
  /** The open card is the confirmation after "Don't suggest this again" or "Add to dictionary". */
  private doneOpen = false;
  private doneTimer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | null = null;
  private lastError: string | null = null;
  private panelError: string | null = null;

  private readonly onInput = () =>
    timed('input', () => {
      // Coalesce bursts of input events (paste, autocorrect) into one update per frame.
      if (!this.inputFrame) {
        this.inputFrame = requestAnimationFrame(() => {
          this.inputFrame = 0;
          timed('frame', () => this.followEdit());
        });
      }
      this.schedule();
    });
  private readonly onBlur = () => this.schedule(0);
  private readonly onFocusChange = () => {
    const focused = this.field.matches(':focus-within');
    this.badge.setFocused(focused);
    if (focused) this.report(true);
  };
  private readonly onClick = (event: Event) => {
    const e = event as MouseEvent;
    if (!e.isTrusted || e.button !== 0 || e.detail > 1 || this.hasSelection()) return;
    const hit = this.renderer.hitTest(e.clientX, e.clientY);
    if (hit) this.openCard(hit, e.clientX, e.clientY);
  };

  constructor(readonly field: FieldElement) {
    this.renderer = isTextControl(field)
      ? new OverlayRenderer(field)
      : new HighlightRenderer(field);
    this.badge = new FieldBadge(field, () => this.togglePanel());
    field.addEventListener('input', this.onInput);
    field.addEventListener('blur', this.onBlur);
    field.addEventListener('focusin', this.onFocusChange);
    field.addEventListener('focusout', this.onFocusChange);
    field.addEventListener('click', this.onClick);
    if (!isTextControl(field)) {
      // Editors that own their model (ProseMirror, Lexical…) cancel the browser's editing and
      // re-render themselves, so no input event fires; watch the DOM instead.
      this.observer = new MutationObserver(this.onInput);
      this.observer.observe(field, { characterData: true, childList: true, subtree: true });
    }
    this.badge.setFocused(field.matches(':focus-within'));
    this.schedule(0);
  }

  private badgeState: BadgeState = { kind: 'idle' };
  private reported = '';

  private setBadge(state: BadgeState): void {
    this.badgeState = state;
    this.badge.set(state);
    this.report();
  }

  /** Tell the worker what the focused field shows, for the toolbar icon. */
  private report(force = false): void {
    if (!this.field.matches(':focus-within')) return;
    const s = this.badgeState;
    const count = s.kind === 'done' ? s.suggestions.length : 0;
    const key = `${s.kind}:${count}`;
    if (key === this.reported && !force) return;
    this.reported = key;
    const message: TabStateMessage = { type: 'cadenza/tab-state', state: s.kind, count };
    toWorker(message).catch(() => {});
  }

  private readText(): { text: string; map?: TextMap } {
    if (isTextControl(this.field)) return { text: this.field.value };
    const map = buildTextMap(this.field);
    return { text: map.text, map };
  }

  /** Keep underlines on their words while the user types, until the next result arrives. */
  private followEdit(): void {
    if (!this.on) return;
    const { text, map } = this.readText();
    if (text === this.drawnText) return;
    // Back to a text checked before (e.g. undo) doesn't mean the drawn results fit it.
    this.settledText = null;
    this.draw(mapThroughEdit(this.drawn, this.drawnText, text), text, map);
  }

  /** Offset of the caret in the field text, if the caret is inside the field. */
  private caretOffset(): number | null {
    if (isTextControl(this.field)) {
      return document.activeElement === this.field ? this.field.selectionStart : null;
    }
    const sel = this.field.ownerDocument.getSelection();
    if (!sel?.focusNode || !this.field.contains(sel.focusNode)) return null;
    return offsetOf(buildTextMap(this.field), sel.focusNode, sel.focusOffset);
  }

  /** The user is selecting text, not clicking a word. */
  private hasSelection(): boolean {
    if (isTextControl(this.field)) return this.field.selectionStart !== this.field.selectionEnd;
    const sel = this.field.ownerDocument.getSelection();
    return !!sel && !sel.isCollapsed && this.field.contains(sel.anchorNode);
  }

  private schedule(delay = this.slow ? SLOW_DEBOUNCE_MS : DEBOUNCE_MS): void {
    clearTimeout(this.timer);
    if (this.off) return;
    this.timer = setTimeout(() => void this.check(), delay);
  }

  private async check(): Promise<void> {
    const seq = ++this.requestSeq;
    // Ask whether Cadenza is on here before reading anything; the question carries no text.
    const gate: GateMessage = { type: 'cadenza/gate', site: pageSite() };
    let off: OffReason | null;
    try {
      off = ((await toWorker(gate)) as GateResponse).off;
    } catch {
      // Extension reloaded or worker unavailable; the next edit retries.
      this.setBadge({ kind: 'idle' });
      return;
    }
    if (seq !== this.requestSeq) return;
    if (off) {
      this.goOff(off);
      return;
    }
    if (!this.on) {
      this.on = true;
      this.off = null;
      // Catch up with edits made while off (dismissals move with the text).
      this.followEdit();
    }
    const { text } = this.readText();
    if (text === this.settledText) return;
    const paragraphs = splitParagraphs(text);
    const message: CheckMessage = {
      type: 'cadenza/check',
      fieldId: this.fieldId,
      paragraphs,
      priority: caretParagraph(paragraphs, this.caretOffset()),
      site: pageSite(),
    };

    this.setBadge({ kind: 'checking' });
    let response: CheckResponse;
    try {
      response = (await toWorker(message)) as CheckResponse;
    } catch {
      // Extension reloaded or worker unavailable; the next edit retries.
      this.setBadge({ kind: 'idle' });
      return;
    }
    // A newer check superseded this one; it owns the badge now.
    if (seq !== this.requestSeq) return;
    if (!response.ok) {
      this.lastError = response.cancelled ? null : response.error.message;
      this.setBadge(this.lastError ? { kind: 'error', message: this.lastError } : { kind: 'idle' });
      this.refreshPanel();
      return;
    }
    this.lastError = null;
    if (response.off) {
      // Turned off between the gate and the check: the worker sent nothing on.
      this.goOff(response.off);
      return;
    }
    this.slow = response.slow;
    // The user may have kept typing while the model worked (a minute on a local model): move
    // the results onto the current text rather than throwing them away. The edit already
    // scheduled the next check.
    const now = this.readText();
    const edited = now.text !== text;
    this.draw(mapThroughEdit(response.suggestions, text, now.text), now.text, now.map);
    if (response.pending > 0) {
      // Slow mode checks one paragraph per request; continue with the rest.
      this.setBadge({ kind: 'checking' });
      if (!edited) this.schedule(0);
    } else {
      if (!edited) this.settledText = text;
      this.setBadge({ kind: 'done', suggestions: this.drawn });
    }
  }

  /** Cadenza is off for this page: clear what's drawn and stop reading the field. */
  private goOff(reason: OffReason): void {
    this.off = reason;
    this.on = false;
    this.settledText = null;
    this.undoAll = null;
    clearTimeout(this.timer);
    if (openKind(this) === 'card') closePopover(this);
    this.drawn = [];
    this.renderer.render([]);
    this.setBadge({ kind: 'paused', message: offMessage(reason) });
    this.refreshPanel();
  }

  private draw(suggestions: Suggestion[], text: string, map?: TextMap): void {
    if (text !== this.drawnText) {
      this.dismissed = mapThroughEdit(this.dismissed, this.drawnText, text);
    }
    const dismissed = (s: Suggestion) =>
      this.dismissed.some(
        (d) => d.start === s.start && d.end === s.end && d.original === s.original,
      );
    this.drawn = withoutDictionary(
      suggestions.filter((s) => !dismissed(s) && !this.ignored.has(ruleKey(s))),
      this.words,
    );
    this.drawnText = text;
    this.renderer.render(this.drawn, map);
    if (this.badge.kind === 'done') this.setBadge({ kind: 'done', suggestions: this.drawn });
    if (openKind(this) === 'card' && !this.doneOpen) {
      // The card follows its text, and goes when an edit removes it.
      if (this.drawn.some((s) => s.id === this.cardFor)) repositionPopover(this);
      else closePopover(this);
    }
    this.refreshPanel();
  }

  // ---- Card and panel ---------------------------------------------------------------------

  private cardFor: string | null = null;

  private openCard(s: Suggestion, x: number, y: number): void {
    const line = Math.max(
      0,
      this.renderer.rectsOf(s.id).findIndex((r) => hits(r, x, y)),
    );
    this.cardFor = s.id;
    const order = this.inOrder();
    openPopover({
      kind: 'card',
      owner: this,
      field: this.field,
      content: buildCard(s, {
        close: () => closePopover(this),
        nav: {
          index: order.findIndex((d) => d.id === s.id),
          total: order.length,
          prev: () => this.step(s.id, -1),
          next: () => this.step(s.id, 1),
        },
        accept: async () => {
          const ok = await this.accept([s]);
          if (ok) closePopover(this);
          return ok;
        },
        dismiss: () => {
          closePopover(this);
          this.dismiss(s);
        },
        ignore: () => this.ignore(s),
        ...(dictionaryWord(s) ? { addWord: () => this.addWord(dictionaryWord(s) ?? '', s) } : {}),
      }),
      anchor: () => {
        const rects = this.renderer.rectsOf(s.id);
        return rects[Math.min(line, rects.length - 1)] ?? null;
      },
      onClose: () => {
        this.cardFor = null;
        this.renderer.setActive(null);
        this.restoreFocus();
      },
    });
    this.renderer.setActive(s.id);
  }

  /** Suggestions in reading order (the card's "4 of 6" and its arrows). */
  private inOrder(): Suggestion[] {
    return [...this.drawn].sort((a, b) => a.start - b.start);
  }

  /** The card's previous and next buttons: open the neighbouring suggestion's card. */
  private step(fromId: string, by: number): void {
    const order = this.inOrder();
    const i = order.findIndex((d) => d.id === fromId);
    const target = order[(i + by + order.length) % order.length];
    if (i < 0 || !target) return;
    this.renderer.reveal(target.id);
    const rect = this.renderer.rectsOf(target.id)[0];
    if (!rect) return;
    this.swapPopover(() => this.openCard(target, rect.left + 1, rect.top + rect.height / 2), {
      action: by < 0 ? 'prev' : 'next',
    });
  }

  /** Replace the open popover, keeping keyboard focus inside it when it was there. */
  private swapPopover(open: () => void, focus: { row?: number; action?: string } = {}): void {
    const back = this.returnFocus;
    this.returnFocus = null;
    open();
    if (!openKind(this)) {
      back?.();
      return;
    }
    this.returnFocus = back;
    if (back) focusPopover(this, focus);
  }

  private togglePanel(): void {
    if (openKind(this) === 'panel') {
      closePopover(this);
      return;
    }
    this.panelError = null;
    openPopover({
      kind: 'panel',
      owner: this,
      field: this.field,
      content: this.panelView(),
      anchor: () => (this.field.isConnected ? this.badge.rect() : null),
      align: 'end',
      onClose: () => {
        this.panelError = null;
        this.undoAll = null;
        this.restoreFocus();
      },
    });
  }

  // ---- Keyboard ----------------------------------------------------------------------------

  /** Puts focus and the caret back in the field after a popover opened from the keyboard. */
  private returnFocus: (() => void) | null = null;

  /**
   * The keyboard shortcut: open the card for the suggestion at or after the caret, or the panel
   * when there is none (or a card is already open), and move focus into it. Escape or closing
   * it puts focus back where it was.
   */
  openFromKeyboard(): void {
    const back = this.returnFocus ?? this.saveFocus();
    // Swapping a card for the panel closes the card; focus moves on to the panel, not back.
    this.returnFocus = null;
    const target = openKind(this) === null ? this.suggestionAtCaret() : null;
    if (target) {
      const rect = this.renderer.rectsOf(target.id)[0] as DOMRect;
      this.openCard(target, rect.left + 1, rect.top + rect.height / 2);
    } else if (openKind(this) !== 'panel') {
      this.togglePanel();
    }
    if (!openKind(this)) return;
    this.returnFocus = back;
    focusPopover(this);
  }

  hasPopover(): boolean {
    return openKind(this) !== null;
  }

  /** The first visible suggestion that ends at or after the caret (else the first visible). */
  private suggestionAtCaret(): Suggestion | null {
    const visible = this.drawn.filter((s) => this.renderer.rectsOf(s.id).length > 0);
    if (visible.length === 0) return null;
    const caret = this.caretOffset() ?? 0;
    return visible.find((s) => s.end >= caret) ?? visible[0] ?? null;
  }

  private saveFocus(): () => void {
    const f = this.field;
    if (isTextControl(f)) {
      const { selectionStart, selectionEnd, selectionDirection } = f;
      const value = f.value;
      return () => {
        f.focus({ preventScroll: true });
        if (f.value === value && selectionStart !== null && selectionEnd !== null) {
          f.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
        }
      };
    }
    const sel = f.ownerDocument.getSelection();
    const range =
      sel && sel.rangeCount > 0 && f.contains(sel.anchorNode)
        ? sel.getRangeAt(0).cloneRange()
        : null;
    return () => {
      f.focus({ preventScroll: true });
      if (!range || !f.contains(range.startContainer)) return;
      const now = f.ownerDocument.getSelection();
      now?.removeAllRanges();
      now?.addRange(range);
    };
  }

  /** Called when a popover closes: return focus unless the user has moved it elsewhere. */
  private restoreFocus(): void {
    const back = this.returnFocus;
    this.returnFocus = null;
    if (!back) return;
    // Focus was in the popover, which is gone now (so it fell to the body). An accept already
    // focused the field; a click outside is moving focus where the user clicked.
    const active = this.field.ownerDocument.activeElement;
    if (active && active !== this.field.ownerDocument.body && active.localName !== 'cadenza-ui') {
      return;
    }
    back();
  }

  private refreshPanel(): void {
    if (openKind(this) === 'panel') updatePopover(this, this.panelView());
  }

  private panelView(): HTMLElement {
    const failed = "Couldn't change the text here. Edit it by hand instead.";
    return buildPanel(
      this.drawn,
      {
        accept: async (s) => {
          const ok = await this.accept([s]);
          this.panelError = ok ? null : failed;
          this.refreshPanel();
          return ok;
        },
        dismiss: (s) => this.dismiss(s),
        acceptAll: async (category: Category) => {
          const keyboard = this.focusInPopover();
          const ok = await this.accept(
            this.drawn.filter((s) => s.category === category),
            true,
          );
          this.panelError = ok ? null : failed;
          this.refreshPanel();
          if (keyboard) focusPopover(this, { action: 'undo' });
          return ok;
        },
        close: () => closePopover(this),
        focusRow: (index) => {
          if (openKind(this) === 'panel') focusPopover(this, { row: index });
        },
      },
      this.panelNote(),
      this.panelUndo(),
    );
  }

  private panelUndo(): PanelUndo | null {
    const u = this.undoAll;
    if (!u || u.text !== this.drawnText) return null;
    return {
      text: `Accepted ${u.count} ${u.count === 1 ? 'change' : 'changes'}.`,
      undo: () => void this.undoAccept(),
    };
  }

  /** Undo in the panel after Accept all: put back what it replaced. */
  private async undoAccept(): Promise<void> {
    const keyboard = this.focusInPopover();
    const u = this.undoAll;
    this.undoAll = null;
    this.followEdit();
    if (u && u.text === this.drawnText) {
      const ok = await this.applyEdits(u.edits);
      this.panelError = ok ? null : "Couldn't undo here. Press Ctrl+Z in the field instead.";
      // The worker has these paragraphs cached: their suggestions come back right away.
      if (ok) this.schedule(0);
    }
    this.refreshPanel();
    if (keyboard) focusPopover(this, { row: 0 });
  }

  /** Keyboard focus is in the card or panel (the user is working it from the keyboard). */
  private focusInPopover(): boolean {
    return this.field.ownerDocument.activeElement?.localName === 'cadenza-ui';
  }

  private panelNote(): PanelNote {
    const error = this.panelError ?? this.lastError;
    if (error) return { text: error, error: true };
    if (this.off) return { text: offMessage(this.off) };
    return null;
  }

  // ---- Actions (each starts from a trusted click; see views.ts) ------------------------------

  /**
   * Apply suggestions to the field. False if the text changed under them or the page refused.
   * With `undoable`, the panel offers Undo afterwards (Accept all).
   */
  private async accept(suggestions: Suggestion[], undoable = false): Promise<boolean> {
    this.followEdit();
    const edits: Edit[] = [];
    for (const s of suggestions) {
      const current = this.drawn.find((d) => d.id === s.id);
      if (!current) return false;
      const { start, end, original, replacement } = current;
      edits.push({ start, end, original, replacement });
    }
    if (edits.length === 0) return false;
    const undo = undoable ? invertEdits(this.drawnText, edits) : null;
    this.undoAll = null;
    const ok = await this.applyEdits(edits);
    // Offered only when the field holds exactly the text the undo edits expect.
    if (ok && undo && this.drawnText === undo.after) {
      this.undoAll = { edits: undo.inverse, text: undo.after, count: edits.length };
    }
    return ok;
  }

  private async applyEdits(edits: Edit[]): Promise<boolean> {
    const ok = isTextControl(this.field)
      ? applyToTextControl(this.field, edits)
      : await applyToEditable(this.field, edits);
    // Drop the accepted underlines now rather than on the next frame, and recheck.
    this.followEdit();
    this.schedule();
    return ok;
  }

  private dismiss(s: Suggestion): void {
    this.followEdit();
    const current = this.drawn.find((d) => d.id === s.id);
    if (current) this.dismissed.push(current);
    this.draw(this.drawn, this.drawnText);
  }

  /** "Don't suggest this again": hide it everywhere, and offer Undo on the card. */
  private ignore(s: Suggestion): void {
    const rule = { category: s.category, original: s.original, replacement: s.replacement };
    const key = ruleKey(rule);
    this.followEdit();
    const hidden = this.drawn.filter((d) => ruleKey(d) === key);
    const text = this.drawnText;
    this.showDone(s, `Won’t suggest “${s.original}” again.`, () => {
      this.ignored.delete(key);
      const undo: UnignoreMessage = { type: 'cadenza/unignore', rule };
      toWorker(undo).catch(() => {});
      this.restore(hidden, text);
    });
    this.ignored.add(key);
    this.draw(this.drawn, this.drawnText);
    const message: IgnoreMessage = { type: 'cadenza/ignore', rule, site: pageSite() };
    toWorker(message).catch(() => {});
  }

  /** "Add to dictionary": hide it everywhere, and offer Undo on the card. */
  private addWord(word: string, s: Suggestion): void {
    if (!word) return;
    this.followEdit();
    const hidden = this.drawn.filter((d) => withoutDictionary([d], [word]).length === 0);
    const text = this.drawnText;
    this.showDone(s, `Added “${word}” to your dictionary.`, () => {
      const lower = word.toLowerCase();
      for (let i = this.words.length - 1; i >= 0; i--) {
        if (this.words[i]?.toLowerCase() === lower) this.words.splice(i, 1);
      }
      const undo: RemoveWordMessage = { type: 'cadenza/remove-word', word };
      toWorker(undo).catch(() => {});
      this.restore(hidden, text);
    });
    this.words.push(word);
    this.draw(this.drawn, this.drawnText);
    const message: AddWordMessage = { type: 'cadenza/add-word', word };
    toWorker(message).catch(() => {});
  }

  /**
   * Replace the card with a short confirmation and its Undo, where the card was. It closes by
   * itself after a few seconds, unless the pointer or focus is on it.
   */
  private showDone(s: Suggestion, message: string, undo: () => void): void {
    // Pin the place now: the underline goes in a moment. It moves with the field.
    const at = this.renderer.rectsOf(s.id)[0] ?? null;
    const f0 = this.field.getBoundingClientRect();
    this.swapPopover(
      () => {
        openPopover({
          kind: 'card',
          owner: this,
          field: this.field,
          content: buildDone(message, {
            undo: () => {
              closePopover(this);
              undo();
            },
            close: () => closePopover(this),
          }),
          anchor: () => {
            if (!this.field.isConnected) return null;
            if (!at) return this.badge.rect();
            const f = this.field.getBoundingClientRect();
            return new DOMRect(at.x + f.x - f0.x, at.y + f.y - f0.y, at.width, at.height);
          },
          onClose: () => {
            this.doneOpen = false;
            clearTimeout(this.doneTimer);
            this.restoreFocus();
          },
        });
        this.doneOpen = true;
        const wait = () => {
          this.doneTimer = setTimeout(() => {
            if (!this.doneOpen) return;
            if (popoverEngaged(this)) wait();
            else closePopover(this);
          }, DONE_MS);
        };
        wait();
      },
      { action: 'undo' },
    );
  }

  /** Undo on the confirmation card: draw the hidden suggestions again where they are now. */
  private restore(hidden: Suggestion[], text: string): void {
    this.followEdit();
    const back = mapThroughEdit(hidden, text, this.drawnText);
    this.draw([...this.drawn, ...back], this.drawnText);
    // The settings change also brings a recheck, which confirms them.
  }

  /** Settings changed: check again, even text that was already checked. */
  refresh(): void {
    // The worker's lists are the truth now (a rule may have been removed in settings).
    this.ignored.clear();
    this.words.length = 0;
    this.settledText = null;
    // Check even while off (the gate decides); schedule() waits for this when off.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), 0);
  }

  destroy(): void {
    clearTimeout(this.timer);
    clearTimeout(this.doneTimer);
    cancelAnimationFrame(this.inputFrame);
    this.field.removeEventListener('input', this.onInput);
    this.field.removeEventListener('blur', this.onBlur);
    this.field.removeEventListener('focusin', this.onFocusChange);
    this.field.removeEventListener('focusout', this.onFocusChange);
    this.field.removeEventListener('click', this.onClick);
    this.observer?.disconnect();
    closePopover(this);
    this.renderer.destroy();
    this.badge.destroy();
    const forget: ForgetMessage = { type: 'cadenza/forget', fieldId: this.fieldId };
    toWorker(forget).catch(() => {});
  }
}

function caretParagraph(paragraphs: Paragraph[], caret: number | null): string[] {
  if (caret === null) return [];
  const p = paragraphs.find((p) => caret >= p.start && caret <= p.start + p.text.length);
  return p ? [p.pid] : [];
}

/** What the badge and panel say when Cadenza is off for a field. */
function offMessage(reason: OffReason): string {
  if (reason === 'site')
    return 'Off on this site. Turn it back on from the Cadenza toolbar button.';
  if (reason === 'disabled') return 'Cadenza is switched off. Turn it on from the toolbar button.';
  return 'Cadenza isn’t set up yet. Choose a provider in its settings.';
}

/**
 * Sends to the extension's worker. Once Cadenza is reloaded, updated or removed, this script
 * is orphaned in tabs that were already open, and Chrome *throws* from sendMessage ("Extension
 * context invalidated") rather than rejecting. Turn that into a rejection, so callers' catch
 * handlers cover it and nothing surfaces as an uncaught error on the page.
 */
export function toWorker(message: ContentMessage): Promise<unknown> {
  try {
    if (!browser.runtime?.id) return Promise.reject(new Error('Cadenza was reloaded'));
    return browser.runtime.sendMessage(message);
  } catch (error) {
    return Promise.reject(error);
  }
}
