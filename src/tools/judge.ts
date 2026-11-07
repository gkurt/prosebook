/**
 * `prosebook judge`: the guidelines no pattern can check, each entry held to them by a model.
 *
 * A guideline (a `guideline` rule, as the `voice` plugin's are) is a matter of meaning, so the lint
 * can't find a string breaking it. A decision model can: each entry, in each locale its guidelines
 * read, goes to the model as one request, the entry as its state and one yes-or-no question per
 * guideline, and the model answers each with the probability that the entry breaks it. prosebook
 * never calls a model itself: the config's `judge.model` does, as `prosebook/ai`'s `decisionJudge`
 * makes one from an AI SDK decision model.
 *
 * Each answer is kept in the lock, beside a hash of everything the request said: the model, the
 * prompt, the entry and the guideline. An entry whose request would say the same is not asked again,
 * so a run asks only of what changed, and `lint` reads the lock's verdicts without a model: the
 * probability is kept rather than the verdict, so a new `threshold` needs no new run.
 */
import type { Catalog, Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { applies, isGuideline, languageName, severityOf, type Verdict } from './lint.ts';
import { hash, type Lock } from './lock.ts';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A yes-or-no question, as the AI SDK's `boolean` decision question takes it. */
export interface JudgeQuestion {
  instructions: string;
  criteria: { true: string; false: string };
}

export interface JudgeRequest {
  /** The entry, in the locale judged: what every question is asked of. */
  state: { [key: string]: Json };
  /** By rule name. */
  questions: Record<string, JudgeQuestion>;
  signal?: AbortSignal;
}

export interface JudgeResponse {
  /** By rule name: the probability, from 0 to 1, that the entry breaks the guideline. */
  probabilities: Record<string, number>;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** What the request cost, in US dollars, where the provider says or the judge knows its prices. */
  cost?: number;
}

/** A decision model, as the config's `judge.model` takes one. */
export interface Judge {
  /** Names the model in each verdict's hash, so a verdict another model gave is asked again. */
  id: string;
  judge(request: JudgeRequest): Promise<JudgeResponse>;
}

export interface JudgeConfig {
  /** The model: `decisionJudge(model)` from `prosebook/ai`, or a `Judge` of your own. */
  model: Judge;
  /**
   * The probability from which an entry breaks a guideline: 0.7 by default. Under it a fast model is
   * more often unsure than right: Jev finds the clear breaks of the `voice` guidelines from 0.7 up.
   */
  threshold?: number;
  /** Requests in flight at once: 8 by default. */
  concurrency?: number;
}

/** Raised when what the request says changes in a way the hash can't see: the questions' words. */
const PROMPT = 2;

/**
 * A guideline is asked as two questions, as one yes-or-no question answers best when it asks one
 * thing: whether the guideline speaks of a message in this one's role at all, and supposing it does,
 * whether the message breaks it. The entry breaks it by the product of the two: asked in one, a
 * guideline for controls was found broken by every hint that says what to do.
 */
export interface Questions {
  concerns: JudgeQuestion;
  breaks: JudgeQuestion;
}

function questionsOf(description: string): Questions {
  const guideline = `A writing guideline for the copy of an app: ${description}`;
  return {
    concerns: {
      instructions: `${guideline}\n\nIs the guideline about messages like \`message\`, in the role its \`kind\`, \`surface\` and \`context\` give it?`,
      criteria: {
        true: 'The guideline speaks of messages in this role, so it holds this one to something.',
        false: 'The guideline speaks of other messages, in another role, so it says nothing of this one.',
      },
    },
    breaks: {
      instructions: `${guideline}\n\nSupposing the guideline is about \`message\`, does the message do what the guideline warns against?`,
      criteria: {
        true: 'The message does what the guideline warns against, or misses what it asks for.',
        false: 'The message does as the guideline asks.',
      },
    },
  };
}

/** The verdicts the lock holds: per locale, per key, per rule, `<hash>:<probability>`. */
export type Verdicts = Record<string, Record<string, Record<string, string>>>;

/** One entry in one locale, and the guidelines it is held to there. */
export interface Asked {
  message: Message;
  locale: string;
  state: JudgeRequest['state'];
  /** By rule name, each with its hash. */
  questions: Map<string, { questions: Questions; hash: string }>;
}

/** The entry as the model reads it: its words, and what the catalog and the config say about it. */
function stateOf(config: ResolvedConfig, message: Message, locale: string): JudgeRequest['state'] {
  const translated = locale !== config.source;
  const state: JudgeRequest['state'] = {
    message: translated ? message.translations.get(locale)!.text : message.text,
    language: languageName(locale),
    key: message.key,
  };
  if (translated) state['source'] = message.text;
  if (message.context !== undefined) state['context'] = message.context;
  if (message.kind !== undefined) state['kind'] = named(message.kind, config.kinds[message.kind]?.doc);
  if (message.surface !== undefined) state['surface'] = named(message.surface, config.surfaces[message.surface]);
  if (message.argDocs.size > 0) state['placeholders'] = Object.fromEntries(message.argDocs);
  return state;
}

/** A kind or a surface, with what the config says it means. */
const named = (name: string, meaning: string | undefined): Json => (meaning === undefined ? { name } : { name, meaning });

/** Every entry and locale some guideline reads, with what it would be asked. */
export function askedOf(config: ResolvedConfig, judge: Judge, messages: readonly Message[]): Asked[] {
  const guidelines = Object.entries(config.lint.rules).filter(([, { rule }]) => isGuideline(rule));
  const asked: Asked[] = [];
  for (const message of messages) {
    for (const locale of [config.source, ...message.translations.keys()]) {
      const held = guidelines.filter(
        ([name, { rule }]) => severityOf(config, name, message) !== 'off' && applies(rule, message, locale, config.source),
      );
      if (held.length === 0) continue;
      const state = stateOf(config, message, locale);
      const questions = new Map(
        held.map(([name, { rule }]) => {
          const questions = questionsOf(rule.description);
          return [name, { questions, hash: hash(JSON.stringify([PROMPT, judge.id, state, questions])) }];
        }),
      );
      asked.push({ message, locale, state, questions });
    }
  }
  return asked;
}

const recorded = (verdicts: Verdicts | undefined, a: Asked, rule: string) => verdicts?.[a.locale]?.[a.message.key]?.[rule];

/** The probability the lock holds for a question, when it was asked as it would be now. */
function probabilityIn(verdicts: Verdicts | undefined, a: Asked, rule: string): number | undefined {
  const [at, p] = (recorded(verdicts, a, rule) ?? '').split(':');
  return at === a.questions.get(rule)?.hash && p !== undefined && p !== '' ? Number(p) : undefined;
}

/** The questions the lock has no answer to, as they would be asked now. */
export function unanswered(asked: Asked[], verdicts: Verdicts | undefined): Asked[] {
  return asked.flatMap((a) => {
    const open = [...a.questions].filter(([rule]) => probabilityIn(verdicts, a, rule) === undefined);
    return open.length === 0 ? [] : [{ ...a, questions: new Map(open) }];
  });
}

/** What `lint` asks of a guideline, from the lock's verdicts; none when the config has no `judge`. */
export function verdictsOf(config: ResolvedConfig, messages: readonly Message[], lock: Lock): Verdict | undefined {
  const { judge } = config;
  if (judge === undefined) return undefined;
  const byEntry = new Map(askedOf(config, judge.model, messages).map((a) => [`${a.locale}\u0000${a.message.key}`, a]));
  return (message, locale, rule) => {
    const a = byEntry.get(`${locale}\u0000${message.key}`);
    const p = a === undefined ? undefined : probabilityIn(lock.judged, a, rule);
    return p === undefined ? undefined : p >= judge.threshold;
  };
}

/** What a run took. */
export interface JudgeStats {
  /** Entries in a locale held to some guideline. */
  entries: number;
  /** Of them, those the lock answered in full, so none was asked. */
  cached: number;
  /** Requests made: one per entry in a locale with a question the lock didn't answer. */
  requests: number;
  /** Questions asked, over every request. */
  questions: number;
  /** From the first request to the last answer. */
  ms: number;
  /** Each request's time, in milliseconds, in the order they ended. */
  latencies: number[];
  inputTokens: number;
  outputTokens: number;
  /** In US dollars, summed over the requests whose cost is known. */
  cost: number;
  /** Requests whose cost the judge couldn't say: `cost` leaves them out. */
  unpriced: number;
}

export interface JudgeRun {
  /** The lock's verdicts, brought up to date: every entry's, those asked and those kept. */
  verdicts: Verdicts;
  stats: JudgeStats;
  /** Why requests failed; a run stops asking at the first, and keeps what was answered. */
  failures: { key: string; locale: string; error: unknown }[];
}

export interface JudgeOptions {
  /** Called as each request ends, with how many have and how many will. */
  progress?: (done: number, total: number) => void;
  /** Ask nothing: only bring the verdicts up to date with the catalog, as `--check` does. */
  dry?: boolean;
}

/** Asks the model what the lock can't answer, and gives back the lock's verdicts with the answers in. */
export async function judgeCatalog(config: ResolvedConfig, catalog: Catalog, lock: Lock, options: JudgeOptions = {}): Promise<JudgeRun> {
  const judge = config.judge;
  if (judge === undefined) throw new Error('judge is off: set judge.model in the config, as decisionJudge from prosebook/ai makes one');
  const asked = askedOf(config, judge.model, catalog.messages);
  const open = options.dry === true ? [] : unanswered(asked, lock.judged);
  const verdicts: Verdicts = {};
  const keep = (locale: string, key: string, rule: string, value: string) => (((verdicts[locale] ??= {})[key] ??= {})[rule] = value);
  for (const a of asked) {
    for (const rule of a.questions.keys())
      if (probabilityIn(lock.judged, a, rule) !== undefined) keep(a.locale, a.message.key, rule, recorded(lock.judged, a, rule)!);
  }
  // An entry left out for being broken keeps what the lock said of it, as `keepUnread` keeps its translations.
  if (catalog.problems.some((p) => p.severity === 'error')) {
    const read = new Set(catalog.messages.map((m) => m.key));
    for (const [locale, keys] of Object.entries(lock.judged ?? {})) {
      for (const [key, rules] of Object.entries(keys))
        if (!read.has(key)) for (const [r, v] of Object.entries(rules)) keep(locale, key, r, v);
    }
  }
  const stats: JudgeStats = {
    entries: asked.length,
    cached: asked.length - unanswered(asked, lock.judged).length,
    requests: 0,
    questions: 0,
    ms: 0,
    latencies: [],
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    unpriced: 0,
  };
  const failures: JudgeRun['failures'] = [];
  const stop = new AbortController();
  const started = performance.now();
  let next = 0;
  const ask = async (a: Asked) => {
    // By a plain ID of its own, as a provider may hold IDs to a pattern a rule's name doesn't keep to.
    const rules = [...a.questions];
    const questions = Object.fromEntries(
      rules.flatMap(([, { questions: q }], i) => [
        [`concerns${i}`, q.concerns],
        [`breaks${i}`, q.breaks],
      ]),
    );
    const at = performance.now();
    const response = await judge.model.judge({ state: a.state, questions, signal: stop.signal });
    stats.latencies.push(performance.now() - at);
    stats.requests++;
    stats.questions += Object.keys(questions).length;
    stats.inputTokens += response.usage?.inputTokens ?? 0;
    stats.outputTokens += response.usage?.outputTokens ?? 0;
    if (response.cost === undefined) stats.unpriced++;
    else stats.cost += response.cost;
    const probability = (id: string, rule: string) => {
      const p = response.probabilities[id];
      if (typeof p !== 'number' || !(p >= 0 && p <= 1))
        throw new Error(`the model gave no probability for ${rule}: check that it answers boolean questions`);
      return p;
    };
    rules.forEach(([rule, { hash }], i) => {
      const p = probability(`concerns${i}`, rule) * probability(`breaks${i}`, rule);
      keep(a.locale, a.message.key, rule, `${hash}:${Math.round(p * 100) / 100}`);
    });
    options.progress?.(stats.requests, open.length);
  };
  const worker = async () => {
    while (next < open.length && !stop.signal.aborted) {
      const a = open[next++]!;
      try {
        await ask(a);
      } catch (error) {
        if (!stop.signal.aborted) failures.push({ key: a.message.key, locale: a.locale, error });
        stop.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(judge.concurrency, open.length) }, worker));
  stats.ms = performance.now() - started;
  return { verdicts, stats, failures };
}
