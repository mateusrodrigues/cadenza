/**
 * Runs the labeled corpus through the real checking pipeline and scores the results.
 *
 *   npm run eval -- --preset llamacpp --base-url http://127.0.0.1:8360/v1 --model phi4-14b
 *   CADENZA_EVAL_API_KEY=… npm run eval -- --preset openai --model <id from the provider>
 *   npm run eval -- --rescore evals/results/<file>.json     (after editing labels)
 *   … --formality formal --audience general                 (writing goals, prompt v4+)
 *
 * The API key is read only from CADENZA_EVAL_API_KEY, never from the command line.
 * Results are saved after every sample; --resume <file> continues an interrupted run.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  anchorSuggestions,
  checkParagraphs,
  PROMPT_VERSION,
  splitParagraphs,
} from '@cadenza/engine';
import { createProvider, getPreset, ProviderError } from '@cadenza/providers';
import { CATEGORY_IDS, type CheckSettings, type Goals } from '@cadenza/shared';
import { loadCorpus, type Sample } from './corpus.js';
import { type SampleResult, type Summary, summarize } from './score.js';

interface RunFile {
  meta: {
    preset: string;
    model: string;
    endpoint: string;
    promptVersion: number;
    explanations: boolean;
    startedAt: string;
    filter: string | null;
    every: number | null;
    /** Writing goals sent with every sample (prompt v4+); absent in older runs. */
    goals?: Goals;
  };
  results: SampleResult[];
  summary?: Summary;
}

const { values: args } = parseArgs({
  options: {
    preset: { type: 'string', default: 'custom' },
    'base-url': { type: 'string' },
    model: { type: 'string' },
    explanations: { type: 'boolean', default: false },
    filter: { type: 'string' },
    limit: { type: 'string' },
    /** Every Nth sample of each group (spell-, clean-, …): a quicker, still balanced run. */
    every: { type: 'string' },
    concurrency: { type: 'string', default: '1' },
    out: { type: 'string' },
    resume: { type: 'string' },
    rescore: { type: 'string' },
    /** With --rescore: re-anchor the saved raw model items with the current engine first. */
    reanchor: { type: 'boolean', default: false },
    /** Writing goals (prompt v4+): any | informal | neutral | formal, any | general | expert. */
    formality: { type: 'string', default: 'any' },
    audience: { type: 'string', default: 'any' },
  },
});

const corpus = loadCorpus();

if (args.rescore) {
  const run = JSON.parse(readFileSync(args.rescore, 'utf8')) as RunFile;
  if (args.reanchor) {
    const texts = new Map(corpus.map((s) => [s.id, s.text]));
    for (const r of run.results) {
      if (!r.items) throw new Error(`${r.id}: no raw items saved (run predates --reanchor)`);
      const stats = { dropped: 0 };
      r.suggestions = anchorSuggestions(r.items, splitParagraphs(texts.get(r.id) ?? ''), stats);
      r.dropped = stats.dropped;
    }
  }
  run.summary = summarize(corpus, run.results);
  writeFileSync(args.rescore, `${JSON.stringify(run, null, 1)}\n`);
  printSummary(run);
  process.exit(0);
}

const run: RunFile = args.resume
  ? (JSON.parse(readFileSync(args.resume, 'utf8')) as RunFile)
  : newRun();
const outPath = args.resume ?? args.out ?? defaultOutPath(run.meta);
const preset = getPreset(run.meta.preset);
if (!preset) throw new Error(`Unknown preset ${run.meta.preset}`);
const provider = createProvider({
  presetId: preset.id,
  kind: preset.kind,
  baseURL: run.meta.endpoint,
  apiKey: process.env.CADENZA_EVAL_API_KEY ?? null,
  model: run.meta.model,
  ...(preset.extraHeaders ? { extraHeaders: preset.extraHeaders } : {}),
});

const done = new Set(run.results.map((r) => r.id));
let todo = corpus.filter((s) => !done.has(s.id));
if (run.meta.filter) todo = todo.filter((s) => s.id.startsWith(run.meta.filter ?? ''));
if (run.meta.every) todo = todo.filter((s) => inSlice(s, run.meta.every ?? 1));
if (args.limit) todo = todo.slice(0, Number(args.limit));
mkdirSync(dirname(outPath), { recursive: true });
console.log(`${todo.length} samples to run → ${outPath}`);

let tier: string | undefined;
let next = 0;
async function worker() {
  while (next < todo.length) {
    const sample = todo[next++] as Sample;
    const result = await runSample(sample);
    run.results.push(result);
    save();
    const status = result.error
      ? `error ${result.error.kind}`
      : `${result.suggestions.length} suggestions`;
    console.log(
      `[${run.results.length}/${corpus.length}] ${sample.id}: ${status} (${((result.ms ?? 0) / 1000).toFixed(1)} s)`,
    );
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
run.summary = summarize(corpus, run.results);
save();
printSummary(run);

// ---------------------------------------------------------------------------------------

function newRun(): RunFile {
  const preset = getPreset(args.preset ?? 'custom');
  if (!preset) throw new Error(`Unknown preset ${args.preset}`);
  const endpoint = args['base-url'] ?? preset.baseURL;
  if (!args.model) throw new Error('--model is required (use an id the provider lists)');
  if (!endpoint && preset.kind !== 'mock') throw new Error('--base-url is required');
  return {
    meta: {
      preset: preset.id,
      model: args.model,
      endpoint,
      promptVersion: PROMPT_VERSION,
      explanations: args.explanations ?? false,
      startedAt: new Date().toISOString(),
      filter: args.filter ?? null,
      every: args.every ? Number(args.every) : null,
      goals: parseGoals(),
    },
    results: [],
  };
}

function parseGoals(): Goals {
  const formality = args.formality as Goals['formality'];
  const audience = args.audience as Goals['audience'];
  if (!['any', 'informal', 'neutral', 'formal'].includes(formality)) {
    throw new Error('--formality must be any, informal, neutral or formal');
  }
  if (!['any', 'general', 'expert'].includes(audience)) {
    throw new Error('--audience must be any, general or expert');
  }
  return { formality, audience };
}

/** Keeps every Nth sample within each id group, so each category stays represented. */
function inSlice(sample: Sample, every: number): boolean {
  const n = Number(sample.id.match(/(\d+)$/)?.[1] ?? 0);
  return n % every === 1 % every;
}

function defaultOutPath(meta: RunFile['meta']): string {
  const dir = join(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const g = meta.goals;
  const goals = g && (g.formality !== 'any' || g.audience !== 'any');
  const slug =
    `${meta.preset}-${meta.model}${goals ? `-${g.formality}-${g.audience}` : ''}`.replace(
      /[^a-zA-Z0-9.-]+/g,
      '_',
    );
  const stamp = meta.startedAt.replace(/[:.]/g, '-').slice(0, 19);
  return join(dir, `${slug}-p${meta.promptVersion}-${stamp}.json`);
}

async function runSample(sample: Sample): Promise<SampleResult> {
  const settings: CheckSettings = {
    dialect: sample.dialect ?? 'en-US',
    categories: [...CATEGORY_IDS],
    explanations: run.meta.explanations,
    ...(run.meta.goals ? { goals: run.meta.goals } : {}),
  };
  const t0 = performance.now();
  try {
    const outcome = await checkParagraphs({
      provider,
      model: run.meta.model,
      paragraphs: splitParagraphs(sample.text),
      settings,
      ...(tier ? { tier: tier as never } : {}),
    });
    tier = outcome.tier;
    return {
      id: sample.id,
      ms: Math.round(performance.now() - t0),
      tier: outcome.tier,
      dropped: outcome.dropped,
      outputTokens: outcome.usage?.outputTokens ?? null,
      suggestions: outcome.suggestions,
      items: outcome.items,
    };
  } catch (err) {
    const e =
      err instanceof ProviderError
        ? { kind: err.kind, message: err.message }
        : { kind: 'unknown', message: String(err) };
    return { id: sample.id, ms: Math.round(performance.now() - t0), error: e, suggestions: [] };
  }
}

function save() {
  writeFileSync(outPath, `${JSON.stringify(run, null, 1)}\n`);
}

function printSummary({ meta, summary }: RunFile) {
  if (!summary) return;
  const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(0)}%`);
  console.log(
    `\n${meta.preset} / ${meta.model} — prompt v${meta.promptVersion}, explanations ${meta.explanations ? 'on' : 'off'}` +
      (meta.goals ? `, goals ${meta.goals.formality}/${meta.goals.audience}` : ''),
  );
  console.log(
    `samples ${summary.samples}, errors ${summary.errors}, dropped items ${summary.dropped}`,
  );
  console.log(
    `precision ${pct(summary.precision)} (correctness ${pct(summary.correctnessPrecision)})  ` +
      `tp ${summary.counts.tp}, wrong fix ${summary.counts.wrong_fix}, fp ${summary.counts.fp}, neutral ${summary.counts.neutral}`,
  );
  console.log(
    `clean text: ${summary.cleanFps} false positives in ${summary.cleanWords} words = ` +
      `${summary.cleanFpPer500Words?.toFixed(1) ?? '–'} per 500 words`,
  );
  for (const [c, r] of Object.entries(summary.recall)) {
    const fixed = c === 'correctness' ? `, fixed ${pct(r.issues ? r.fixed / r.issues : null)}` : '';
    console.log(
      `recall ${c}: found ${pct(r.issues ? r.found / r.issues : null)} of ${r.issues}${fixed}`,
    );
  }
  const s = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`);
  console.log(
    `latency p50 ${s(summary.latencyMs.p50)}, p95 ${s(summary.latencyMs.p95)}; output tokens ${summary.outputTokens}`,
  );
}
