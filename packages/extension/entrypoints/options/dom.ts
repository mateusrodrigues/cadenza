export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function button(label: string, onClick: () => void, ariaLabel?: string) {
  const b = Object.assign(document.createElement('button'), {
    type: 'button',
    textContent: label,
  });
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', onClick);
  return b;
}

/** A list row: a main line, an optional muted second line, and buttons. */
export function row(main: string, detail: string | null, ...actions: HTMLElement[]) {
  const li = document.createElement('li');
  const text = document.createElement('div');
  text.className = 'item-text';
  text.append(Object.assign(document.createElement('strong'), { textContent: main }));
  if (detail) {
    text.append(
      Object.assign(document.createElement('span'), { className: 'muted', textContent: detail }),
    );
  }
  li.append(text, ...actions);
  return li;
}

/** Short day for lists ("12 Nov"), or "today". */
export function shortDay(day: string, today: string): string {
  if (day === today) return 'today';
  return new Date(`${day}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function say(el: HTMLElement, text: string, kind: 'info' | 'ok' | 'error' = 'info') {
  el.textContent = text;
  el.dataset.kind = kind;
}
