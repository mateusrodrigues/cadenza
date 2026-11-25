/**
 * Typing-lag measurement for test builds only (Phase 7 budget: < 4 ms of Cadenza work per input
 * event). Normal builds compile this to nothing. A test asks for the numbers by dispatching
 * `cadenza-perf` on the document; they come back on the <html> element's `data-cadenza-perf`.
 */
const ENABLED = typeof __CADENZA_E2E__ !== 'undefined' && __CADENZA_E2E__;
const samples: Record<string, number[]> = {};
let listening = false;

export function timed<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record(name, performance.now() - t0);
  }
}

function record(name: string, ms: number): void {
  let list = samples[name];
  if (!list) {
    list = [];
    samples[name] = list;
  }
  list.push(ms);
  if (!listening) {
    listening = true;
    document.addEventListener('cadenza-perf', () => {
      document.documentElement.dataset.cadenzaPerf = JSON.stringify(samples);
      for (const k of Object.keys(samples)) delete samples[k];
    });
  }
}
