// The Cadenza website's behavior: the sample in the hero, the copy button, and the switch to
// the Chrome Web Store link. No network requests, no storage.

const SUGGESTIONS = [
  {
    category: 'correctness',
    from: 'have went',
    to: 'have gone',
    why: 'After “have”, use the past participle “gone”.',
  },
  {
    category: 'correctness',
    from: 'their are',
    to: 'there are',
    why: '“There are” points to something; “their” shows ownership.',
  },
  {
    category: 'correctness',
    from: 'friday',
    to: 'Friday',
    why: 'Days of the week take a capital letter.',
  },
  {
    category: 'clarity',
    from: 'In order to',
    to: 'To',
    why: '“To” says the same thing in fewer words.',
  },
  {
    category: 'style',
    from: 'basically cut',
    to: 'cut',
    why: '“Basically” weakens the request.',
  },
  {
    category: 'tone',
    from: 'Obviously you missed my last note',
    to: 'You may not have seen my last note',
    why: '“Obviously” can read as blame.',
  },
];

const NAMES = { correctness: 'Correctness', clarity: 'Clarity', style: 'Style', tone: 'Tone' };

const ICONS = {
  prev: 'M10 3.5 5.5 8l4.5 4.5',
  next: 'M6 3.5 10.5 8 6 12.5',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5l3 3 6-7',
};

const FERMATA =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 12c0-5 2.5-9 6-9s6 4 6 9h-2c-.3-3.6-1.8-6-4-6s-3.7 2.4-4 6Z"/><circle fill="currentColor" cx="8" cy="10" r="2"/></svg>';

const SPINNER =
  '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke-width="2"><circle cx="8" cy="8" r="5.5" stroke="var(--border)"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" stroke-linecap="round"/></svg>';

function element(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function button(label, className, onClick) {
  const b = element('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function iconButton(icon, label, onClick) {
  const b = button('', 'icon-button', onClick);
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
  return b;
}

function category(name) {
  const el = element('span', `category ${name}`);
  // The legend holds the one drawing of each line style.
  const line = document.querySelector(`#legend .line.${name}`).cloneNode(true);
  el.append(line, NAMES[name]);
  return el;
}

// Like the extension: a long change stacks, old words above new, without the arrow.
function change({ from, to }, compact = false) {
  const long = from.length + to.length > (compact ? 40 : 60);
  const p = element('p', long ? 'change stacked' : 'change');
  p.append(element('span', 'sr-only', `Change “${from}” to “${to}”.`));
  const arrow = long ? [] : [element('span', 'arrow', '→')];
  const parts = [element('del', '', from), ...arrow, element('ins', '', to)];
  for (const part of parts) part.setAttribute('aria-hidden', 'true');
  p.append(...parts);
  return p;
}

function sample() {
  const sheet = document.getElementById('sheet');
  const field = document.getElementById('field');
  const writing = document.getElementById('writing');
  const badge = document.getElementById('badge');
  const legend = document.getElementById('legend');
  const reset = document.getElementById('reset');
  const announce = document.getElementById('announce');
  const original = writing.innerHTML;

  let items = [];
  let popover = null;
  let openItem = null;
  let touched = false;
  let timers = [];

  const open = () => items.filter((item) => item.open);

  function close() {
    popover?.remove();
    popover = null;
    openItem?.mark.classList.remove('is-open');
    openItem = null;
  }

  function show(el, label) {
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const back = openItem?.mark ?? badge;
      close();
      back.focus();
    });
    popover = el;
    field.append(el);
  }

  function place(card, mark) {
    const outer = field.getBoundingClientRect();
    const rects = mark.getClientRects();
    const first = rects[0];
    const last = rects[rects.length - 1];
    const left = Math.min(first.left - outer.left, outer.width - card.offsetWidth - 8);
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${last.bottom - outer.top + 8}px`;
  }

  function openCard(item, focus) {
    close();
    const left = open();
    const at = left.indexOf(item);
    const card = element('div', 'popover card');

    const head = element('div', 'card-head');
    head.append(category(item.category));
    if (left.length > 1) {
      const step = (by) => openCard(left[(at + by + left.length) % left.length], true);
      head.append(
        element('span', 'count-of', `${at + 1} of ${left.length}`),
        iconButton('prev', 'Previous suggestion', () => step(-1)),
        iconButton('next', 'Next suggestion', () => step(1)),
      );
    }
    head.append(
      iconButton('close', 'Close', () => {
        close();
        item.mark.focus();
      }),
    );

    const actions = element('div', 'card-actions');
    const accept = button('Accept', 'button button-primary', () => {
      apply([item]);
      focusNext();
    });
    actions.append(
      accept,
      button('Dismiss', 'button', () => {
        drop(item);
        say('Dismissed.');
        focusNext();
      }),
    );

    const never = element('div', 'never');
    never.append(button("Don't suggest this again", 'button quiet', () => ignore(item)));

    card.append(head, change(item), element('p', 'why', item.why), actions, never);
    show(card, `${NAMES[item.category]} suggestion`);
    openItem = item;
    item.mark.classList.add('is-open');
    place(card, item.mark);
    if (focus) accept.focus({ preventScroll: false });
  }

  function openPanel() {
    close();
    const panel = element('div', 'popover panel');
    const left = open();
    const head = element('div', 'panel-head');
    const title =
      left.length === 0
        ? 'Cadenza'
        : `${left.length} ${left.length === 1 ? 'suggestion' : 'suggestions'}`;
    head.append(
      element('span', '', title),
      iconButton('close', 'Close', () => {
        close();
        badge.focus();
      }),
    );
    panel.append(head);
    if (left.length === 0)
      panel.append(element('p', 'panel-note', 'No suggestions. Nice writing.'));

    for (const name of Object.keys(NAMES)) {
      const group = left.filter((item) => item.category === name);
      if (group.length === 0) continue;
      const section = element('section');
      const groupHead = element('div', 'group-head');
      groupHead.append(category(name));
      if (name === 'correctness' && group.length > 1) {
        groupHead.append(
          button('Accept all', 'button button-primary', () => {
            apply(group);
            openPanel();
          }),
        );
      }
      const list = element('ul');
      for (const item of group) {
        const row = element('li');
        row.append(
          change(item, true),
          iconButton('check', `Accept: ${item.to}`, () => {
            apply([item]);
            openPanel();
          }),
          iconButton('close', `Dismiss: ${item.from}`, () => {
            drop(item);
            say('Dismissed.');
            openPanel();
          }),
        );
        list.append(row);
      }
      section.append(groupHead, list);
      panel.append(section);
    }
    show(panel, 'Suggestions');
    panel.querySelector('section button, .panel-head button').focus({ preventScroll: true });
  }

  function say(message) {
    const n = open().length;
    announce.textContent = `${message} ${n} ${n === 1 ? 'suggestion' : 'suggestions'} left.`;
  }

  function update() {
    const left = open();
    badge.hidden = false;
    badge.dataset.state = left.length ? 'count' : 'idle';
    if (left.length) badge.textContent = String(left.length);
    else badge.innerHTML = FERMATA;
    badge.setAttribute(
      'aria-label',
      left.length ? `${left.length} suggestions. Open the list` : 'No suggestions. Open the list',
    );
    for (const row of legend.children) {
      const count = row.querySelector('.count');
      const n = left.filter((item) => item.category === row.dataset.category).length;
      const name = NAMES[row.dataset.category];
      count.textContent = String(n);
      count.disabled = n === 0;
      count.setAttribute('aria-label', `${n} ${name} left${n ? '. Show one' : ''}`);
    }
    reset.hidden = left.length === items.length;
  }

  function retire(item) {
    item.open = false;
    item.mark.classList.remove('mark', 'is-open', item.category);
    item.mark.removeAttribute('role');
    item.mark.removeAttribute('tabindex');
    item.mark.removeAttribute('aria-label');
    item.mark.removeAttribute('aria-haspopup');
  }

  function apply(list) {
    close();
    for (const item of list) {
      retire(item);
      item.mark.textContent = item.to;
      item.mark.classList.add('changed');
    }
    update();
    say(list.length === 1 ? `Changed to “${list[0].to}”.` : `Made ${list.length} changes.`);
  }

  function drop(item) {
    close();
    retire(item);
    update();
  }

  function dress(item) {
    const { mark } = item;
    item.open = true;
    mark.classList.add('mark', item.category);
    mark.setAttribute('role', 'button');
    mark.setAttribute('tabindex', '0');
    mark.setAttribute('aria-haspopup', 'dialog');
    mark.setAttribute('aria-label', `${item.from}: ${NAMES[item.category]} suggestion`);
  }

  function ignore(item) {
    drop(item);
    const card = element('div', 'popover card done');
    const undo = button('Undo', 'button', () => {
      dress(item);
      update();
      openCard(item, true);
    });
    card.append(
      element('p', '', "Cadenza won't suggest this again."),
      undo,
      iconButton('close', 'Close', () => {
        close();
        focusNext();
      }),
    );
    show(card, 'Cadenza');
    place(card, item.mark);
    say("Cadenza won't suggest this again.");
    undo.focus();
  }

  function focusNext() {
    (open()[0]?.mark ?? badge).focus({ preventScroll: true });
  }

  function interact() {
    touched = true;
    for (const t of timers) clearTimeout(t);
    timers = [];
    sheet.classList.remove('is-checking');
    for (const item of items) item.mark.style.transitionDelay = '';
    if (badge.dataset.state === 'checking') update();
  }

  function start() {
    close();
    writing.innerHTML = original;
    items = Array.from(writing.querySelectorAll('.mark'), (mark) => ({
      ...SUGGESTIONS[Number(mark.dataset.id)],
      mark,
    }));
    for (const item of items) dress(item);
    update();
  }

  /** One pass the way the extension works: checking, then underlines, then a suggestion. */
  function check() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    sheet.classList.add('is-checking');
    badge.dataset.state = 'checking';
    badge.innerHTML = SPINNER;
    badge.setAttribute('aria-label', 'Checking');
    timers = [
      setTimeout(() => {
        items.forEach((item, i) => {
          item.mark.style.transitionDelay = `${i * 110}ms`;
        });
        sheet.classList.remove('is-checking');
        update();
      }, 900),
      setTimeout(() => {
        for (const item of items) item.mark.style.transitionDelay = '';
        const wide = matchMedia('(min-width: 981px)').matches;
        if (wide && !touched) openCard(items[3], false);
      }, 1800),
    ];
  }

  for (const row of legend.children) {
    const count = button('', 'count', () => {
      interact();
      const item = open().find((i) => i.category === row.dataset.category);
      if (item) openCard(item, true);
    });
    row.append(count);
  }

  const itemAt = (target) => open().find((item) => item.mark === target);

  writing.addEventListener('click', (e) => {
    const item = itemAt(e.target.closest('.mark'));
    if (!item) return;
    interact();
    openCard(item, e.detail === 0);
  });
  writing.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = itemAt(e.target);
    if (!item) return;
    e.preventDefault();
    interact();
    openCard(item, true);
  });
  badge.addEventListener('click', () => {
    const wasPanel = popover?.classList.contains('panel');
    interact();
    if (wasPanel) close();
    else openPanel();
  });
  reset.addEventListener('click', () => {
    interact();
    start();
    announce.textContent = 'The sample is back to how it started.';
    open()[0].mark.focus();
  });
  // composedPath keeps the way the click came, even when it has since replaced the card it was in.
  document.addEventListener('click', (e) => {
    const ours = e
      .composedPath()
      .some(
        (el) => el === badge || el === legend || el === reset || el.classList?.contains('popover'),
      );
    if (!ours && !e.target.closest?.('.mark')) close();
  });
  window.addEventListener('resize', () => {
    if (openItem) place(popover, openItem.mark);
  });

  start();
  check();
}

function copyButton() {
  const copy = document.getElementById('copy');
  if (!copy || !navigator.clipboard) return;
  copy.hidden = false;
  copy.addEventListener('click', async () => {
    const commands = document.getElementById('commands').textContent;
    try {
      await navigator.clipboard.writeText(commands);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select the text to copy';
    }
    setTimeout(() => {
      copy.textContent = 'Copy';
    }, 2500);
  });
}

function storeLink() {
  const url = document.documentElement.dataset.storeUrl;
  if (!url) return;
  for (const link of document.querySelectorAll('[data-store-link]')) {
    link.href = url;
    link.textContent = 'Add to Chrome';
  }
  for (const el of document.querySelectorAll('[data-when]')) {
    el.hidden = el.dataset.when !== 'store';
  }
}

storeLink();
copyButton();
if (document.getElementById('sheet')) sample();
