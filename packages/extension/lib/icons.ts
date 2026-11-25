/** Inline SVG icons for Cadenza's surfaces: nothing for a page's img-src policy to block. */

const SVG = 'http://www.w3.org/2000/svg';

type Shape = [tag: 'path' | 'circle', attrs: Record<string, string>];
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.6',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

const ICONS = {
  close: [['path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7', ...STROKE }]],
  prev: [['path', { d: 'M10 3.5L5.5 8l4.5 4.5', ...STROKE }]],
  next: [['path', { d: 'M6 3.5L10.5 8 6 12.5', ...STROKE }]],
  check: [['path', { d: 'M3.5 8.5l3 3 6-7', ...STROKE }]],
  fermata: [
    [
      'path',
      {
        d: 'M2.5 11.4C2.5 7 4.85 4 8 4s5.5 3 5.5 7.4h-.9C12.25 8.1 10.5 6.1 8 6.1S3.75 8.1 3.4 11.4Z',
        fill: 'currentColor',
      },
    ],
    ['circle', { cx: '8', cy: '10.5', r: '1.5', fill: 'currentColor' }],
  ],
  spinner: [['path', { d: 'M8 2.5A5.5 5.5 0 1 1 2.5 8', ...STROKE, 'stroke-width': '1.8' }]],
  pause: [['path', { d: 'M5.5 4.5v7M10.5 4.5v7', ...STROKE, 'stroke-width': '1.8' }]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // Built element by element: pages with Trusted Types reject innerHTML.
  for (const [tag, attrs] of ICONS[name] as Shape[]) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

/** The category's line sample (wavy, solid, dotted or dashed), as in the kit. */
export function lineSample(category: string, width = 22): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `cdz-u cdz-u--${category}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', '6');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute(
    'd',
    category === 'correctness'
      ? `M0 3q2.75-4 5.5 0${'t5.5 0'.repeat(Math.ceil(width / 5.5))}`
      : `M0 3H${width}`,
  );
  svg.append(path);
  return svg;
}
