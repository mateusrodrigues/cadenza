/**
 * Call `onChange` whenever an element may have moved or resized: page or container scroll,
 * window resize, the element's own size changing, fonts loading, or the page reflowing around
 * it (checked a few times a second, since no event reports that). Returns a function that
 * stops tracking.
 */
export function trackPosition(el: Element, onChange: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(el);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  document.fonts?.addEventListener('loadingdone', schedule);

  let last = '';
  const poll = setInterval(() => {
    if (document.hidden) return;
    const r = el.getBoundingClientRect();
    const key = `${r.top},${r.left},${r.width},${r.height}`;
    if (key !== last) {
      last = key;
      schedule();
    }
  }, 250);

  return () => {
    cancelAnimationFrame(frame);
    clearInterval(poll);
    observer.disconnect();
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    document.fonts?.removeEventListener('loadingdone', schedule);
  };
}
