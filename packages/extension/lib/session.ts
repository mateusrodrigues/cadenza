import { splitParagraphs } from '@cadenza/engine/paragraphs';
import type { Category, Paragraph, Suggestion } from '@cadenza/shared';
import { browser } from 'wxt/browser';
import { applyToEditable, applyToTextControl, type Edit } from './apply';
import { FieldBadge } from './badge';
import { mapThroughEdit } from './edit-map';
import { type FieldElement, isTextControl } from './fields';
import { hits } from './geometry';
import { ruleKey } from './ignored';
import type { CheckMessage, CheckResponse, ForgetMessage, IgnoreMessage } from './messages';
import { closePopover, openKind, openPopover, repositionPopover, updatePopover } from './popover';
import { HighlightRenderer } from './render-highlights';
import { OverlayRenderer } from './render-overlay';
import type { Renderer } from './renderer';
import { buildTextMap, offsetOf, type TextMap } from './text-map';
import { buildCard, buildPanel } from './views';

const DEBOUNCE_MS = 700;
const SLOW_DEBOUNCE_MS = 1500;
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
  private observer: MutationObserver | null = null;
  private lastError: string | null = null;
  private panelError: string | null = null;

  private readonly onInput = () => {
    // Coalesce bursts of input events (paste, autocorrect) into one update per frame.
    if (!this.inputFrame) {
      this.inputFrame = requestAnimationFrame(() => {
        this.inputFrame = 0;
        this.followEdit();
      });
    }
    this.schedule();
  };
  private readonly onBlur = () => this.schedule(0);
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
    field.addEventListener('click', this.onClick);
    if (!isTextControl(field)) {
      // Editors that own their model (ProseMirror, Lexical…) cancel the browser's editing and
      // re-render themselves, so no input event fires; watch the DOM instead.
      this.observer = new MutationObserver(this.onInput);
      this.observer.observe(field, { characterData: true, childList: true, subtree: true });
    }
    this.schedule(0);
  }

  private readText(): { text: string; map?: TextMap } {
    if (isTextControl(this.field)) return { text: this.field.value };
    const map = buildTextMap(this.field);
    return { text: map.text, map };
  }

  /** Keep underlines on their words while the user types, until the next result arrives. */
  private followEdit(): void {
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
    this.timer = setTimeout(() => void this.check(), delay);
  }

  private async check(): Promise<void> {
    const { text } = this.readText();
    if (text === this.settledText) return;
    const seq = ++this.requestSeq;
    const paragraphs = splitParagraphs(text);
    const message: CheckMessage = {
      type: 'cadenza/check',
      fieldId: this.fieldId,
      paragraphs,
      priority: caretParagraph(paragraphs, this.caretOffset()),
    };

    this.badge.set({ kind: 'checking' });
    let response: CheckResponse;
    try {
      response = (await browser.runtime.sendMessage(message)) as CheckResponse;
    } catch {
      // Extension reloaded or worker unavailable; the next edit retries.
      this.badge.set({ kind: 'idle' });
      return;
    }
    // A newer check superseded this one; it owns the badge now.
    if (seq !== this.requestSeq) return;
    if (!response.ok) {
      this.lastError = response.cancelled ? null : response.error.message;
      this.badge.set(
        this.lastError ? { kind: 'error', message: this.lastError } : { kind: 'idle' },
      );
      this.refreshPanel();
      return;
    }
    this.lastError = null;
    this.slow = response.slow;
    // The user may have kept typing while the model worked (a minute on a local model): move
    // the results onto the current text rather than throwing them away. The edit already
    // scheduled the next check.
    const now = this.readText();
    const edited = now.text !== text;
    this.draw(mapThroughEdit(response.suggestions, text, now.text), now.text, now.map);
    if (response.pending > 0) {
      // Slow mode checks one paragraph per request; continue with the rest.
      this.badge.set({ kind: 'checking' });
      if (!edited) this.schedule(0);
    } else {
      if (!edited) this.settledText = text;
      this.badge.set({ kind: 'done', suggestions: this.drawn });
    }
  }

  private draw(suggestions: Suggestion[], text: string, map?: TextMap): void {
    if (text !== this.drawnText) {
      this.dismissed = mapThroughEdit(this.dismissed, this.drawnText, text);
    }
    const dismissed = (s: Suggestion) =>
      this.dismissed.some(
        (d) => d.start === s.start && d.end === s.end && d.original === s.original,
      );
    this.drawn = suggestions.filter((s) => !dismissed(s) && !this.ignored.has(ruleKey(s)));
    this.drawnText = text;
    this.renderer.render(this.drawn, map);
    if (this.badge.kind === 'done') this.badge.set({ kind: 'done', suggestions: this.drawn });
    if (openKind(this) === 'card') {
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
    openPopover({
      kind: 'card',
      owner: this,
      content: buildCard(s, {
        accept: async () => {
          const ok = await this.accept([s]);
          if (ok) closePopover(this);
          return ok;
        },
        dismiss: () => {
          closePopover(this);
          this.dismiss(s);
        },
        ignore: () => {
          closePopover(this);
          this.ignore(s);
        },
      }),
      anchor: () => {
        const rects = this.renderer.rectsOf(s.id);
        return rects[Math.min(line, rects.length - 1)] ?? null;
      },
      onClose: () => {
        this.cardFor = null;
      },
    });
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
      content: this.panelView(),
      anchor: () => (this.field.isConnected ? this.badge.rect() : null),
      align: 'end',
      onClose: () => {
        this.panelError = null;
      },
    });
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
          const ok = await this.accept(this.drawn.filter((s) => s.category === category));
          this.panelError = ok ? null : failed;
          this.refreshPanel();
          return ok;
        },
        close: () => closePopover(this),
      },
      this.panelError ?? this.lastError,
    );
  }

  // ---- Actions (each starts from a trusted click; see views.ts) ------------------------------

  /** Apply suggestions to the field. False if the text changed under them or the page refused. */
  private async accept(suggestions: Suggestion[]): Promise<boolean> {
    this.followEdit();
    const edits: Edit[] = [];
    for (const s of suggestions) {
      const current = this.drawn.find((d) => d.id === s.id);
      if (!current) return false;
      const { start, end, original, replacement } = current;
      edits.push({ start, end, original, replacement });
    }
    if (edits.length === 0) return false;
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

  private ignore(s: Suggestion): void {
    const rule = { category: s.category, original: s.original };
    this.ignored.add(ruleKey(rule));
    this.draw(this.drawn, this.drawnText);
    const message: IgnoreMessage = { type: 'cadenza/ignore', rule };
    browser.runtime.sendMessage(message).catch(() => {});
  }

  destroy(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.inputFrame);
    this.field.removeEventListener('input', this.onInput);
    this.field.removeEventListener('blur', this.onBlur);
    this.field.removeEventListener('click', this.onClick);
    this.observer?.disconnect();
    closePopover(this);
    this.renderer.destroy();
    this.badge.destroy();
    const forget: ForgetMessage = { type: 'cadenza/forget', fieldId: this.fieldId };
    browser.runtime.sendMessage(forget).catch(() => {});
  }
}

function caretParagraph(paragraphs: Paragraph[], caret: number | null): string[] {
  if (caret === null) return [];
  const p = paragraphs.find((p) => caret >= p.start && caret <= p.start + p.text.length);
  return p ? [p.pid] : [];
}
