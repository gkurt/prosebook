/**
 * `prosebook judge`: the guidelines no pattern can check, each entry held to them by its judges.
 *
 * A guideline (a `guideline` rule, as the `voice` plugin's are) is a matter of meaning, so the lint
 * can't find a string breaking it. A decision model can: each entry, in each locale its guidelines
 * read, goes to each model as one request, the entry as its state and two yes-or-no questions per
 * guideline, and the model answers with the probability that the entry breaks it. prosebook never
 * calls a model itself: the config's `judge.models` do, as `prosebook/ai`'s `decisionJudge` makes one
 * from an AI SDK decision model. With several, an entry breaks a guideline by their mean.
 *
 * The author is a judge too, one no request asks: `prosebook approve` records that an entry keeps to
 * its guidelines as written, which passes it whatever the models say, until its words change.
 *
 * Each answer is kept in the lock, beside a hash of everything the request said: the model, the
 * prompt, the entry and the guidelines, every one the entry is held to, as each is weighed with the
 * rest, so a guideline changed asks again of every entry it reads. An approval's hash is the entry's
 * and its one guideline's alone, so a new model or prompt keeps it. A run asks only of what changed,
 * and `lint` reads the lock's verdicts without a model: the probability is kept rather than the
 * verdict, so a new `threshold` needs no new run.
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
  /** By an ID of prosebook's own. */
  questions: Record<string, JudgeQuestion>;
  signal?: AbortSignal;
}

export interface JudgeResponse {
  /** By question ID: the probability, from 0 to 1, that the answer is yes. */
  probabilities: Record<string, number>;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** What the request cost, in US dollars, where the provider says or the judge knows its prices. */
  cost?: number;
}

/** A decision model, as the config's `judge.models` take one. */
export interface Judge {
  /** Names the model in the lock, beside each of its answers, so adding a model asks only it. */
  id: string;
  judge(request: JudgeRequest): Promise<JudgeResponse>;
}

export interface JudgeConfig {
  /**
   * The models: `decisionJudge(model)` from `prosebook/ai`, or `Judge`s of your own, for a model the AI
   * SDK doesn't reach. An entry breaks a guideline by the mean of their probabilities.
   */
  models: Judge[];
  /** Said to the models beside every entry: what the app is, who reads it, what its copy holds to. */
  prompt?: string;
  /**
   * The probability from which an entry breaks a guideline: 0.7 by default. Under it a fast model is
   * more often unsure than right: Jev finds the clear breaks of the `voice` guidelines from 0.7 up.
   */
  threshold?: number;
  /** Requests in flight at once: 8 by default. */
  concurrency?: number;
}

export type ResolvedJudge = Required<Omit<JudgeConfig, 'prompt'>> & Pick<JudgeConfig, 'prompt'>;

/** The judge no request asks: the one who wrote the entry, through `prosebook approve`. */
export const AUTHOR = 'author';

/** Raised when what the request says changes in a way the hash can't see: the questions' words. */
const PROMPT = 4;

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

/**
 * Each question names its guideline, and the state holds every guideline the entry is held to, so
 * the guideline is weighed with the rest: they're guidelines, not rules, and one gives way to another
 * where they pull apart. Asked alone, a guideline against pointing at what the screen never names
 * found `Added` breaking it, where writing it as a sentence would break another.
 */
function questionsOf(description: string, noted: boolean): Questions {
  const notes = noted ? ' Read it in the light of `notes`, what the app’s writers say of its copy.' : '';
  const guideline = `A writing guideline for the copy of an app, one of those in \`guidelines\`: ${description}${notes}`;
  return {
    concerns: {
      instructions: `${guideline}\n\nIs the guideline about messages like \`message\`, in the role its \`kind\`, \`surface\` and \`context\` give it?`,
      criteria: {
        true: 'The guideline speaks of messages in this role, so it holds this one to something.',
        false: 'The guideline speaks of other messages, in another role, so it says nothing of this one.',
      },
    },
    breaks: {
      instructions: `${guideline}\n\nSupposing the guideline is about \`message\`, and weighing it with the other guidelines in \`guidelines\`, which give way to one another where they pull apart, does the message do what this guideline warns against?`,
      criteria: {
        true: 'The message does what this guideline warns against, and rewriting it would serve the guidelines taken together.',
        false: 'The message does as this guideline asks, or does what another of the guidelines asks for where the two pull apart.',
      },
    },
  };
}

/** The verdicts the lock holds: per locale, per key, per rule, per judge, `<hash>:<probability>`. */
export type Verdicts = Record<string, Record<string, Record<string, Record<string, string>>>>;

/** One entry in one locale, and the guidelines it is held to there. */
export interface Asked {
  message: Message;
  locale: string;
  state: JudgeRequest['state'];
  /** By rule name: its questions, and the hash each judge's answer is kept under, the author's as `AUTHOR`. */
  questions: Map<string, { questions: Questions; hashes: Record<string, string> }>;
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
export function askedOf(config: ResolvedConfig, judge: ResolvedJudge, messages: readonly Message[]): Asked[] {
  const guidelines = Object.entries(config.lint.rules).filter(([, { rule }]) => isGuideline(rule));
  const asked: Asked[] = [];
  for (const message of messages) {
    for (const locale of [config.source, ...message.translations.keys()]) {
      const held = guidelines.filter(
        ([name, { rule }]) => severityOf(config, name, message) !== 'off' && applies(rule, message, locale, config.source),
      );
      if (held.length === 0) continue;
      const entry = stateOf(config, message, locale);
      const state = {
        ...entry,
        ...(judge.prompt !== undefined && { notes: judge.prompt }),
        guidelines: held.map(([, { rule }]) => rule.description),
      };
      const questions = new Map(
        held.map(([name, { rule }]) => {
          const questions = questionsOf(rule.description, judge.prompt !== undefined);
          const hashes = Object.fromEntries(judge.models.map((m) => [m.id, hash(JSON.stringify([PROMPT, m.id, state, questions]))]));
          // The author approved the words against the guideline, whatever else a model was told.
          hashes[AUTHOR] = hash(JSON.stringify([AUTHOR, entry, rule.description]));
          return [name, { questions, hashes }];
        }),
      );
      asked.push({ message, locale, state, questions });
    }
  }
  return asked;
}

const recorded = (verdicts: Verdicts | undefined, a: Asked, rule: string, id: string) =>
  verdicts?.[a.locale]?.[a.message.key]?.[rule]?.[id];

/** The probability a judge gave, when it was asked of the entry as it is now. */
function answerOf(verdicts: Verdicts | undefined, a: Asked, rule: string, id: string): number | undefined {
  const [at, p] = (recorded(verdicts, a, rule, id) ?? '').split(':');
  return at === a.questions.get(rule)?.hashes[id] && p !== undefined && p !== '' ? Number(p) : undefined;
}

const approved = (verdicts: Verdicts | undefined, a: Asked, rule: string) => answerOf(verdicts, a, rule, AUTHOR) !== undefined;

/** The models yet to answer of a guideline: none once the author approved the entry against it. */
const openModels = (verdicts: Verdicts | undefined, a: Asked, rule: string, models: readonly Judge[]) =>
  approved(verdicts, a, rule) ? [] : models.filter((m) => answerOf(verdicts, a, rule, m.id) === undefined);

/** The entries with a guideline no judge has answered of them as they are now, each with only those guidelines. */
export function unanswered(asked: Asked[], verdicts: Verdicts | undefined, models: readonly Judge[]): Asked[] {
  return asked.flatMap((a) => {
    const open = [...a.questions].filter(([rule]) => openModels(verdicts, a, rule, models).length > 0);
    return open.length === 0 ? [] : [{ ...a, questions: new Map(open) }];
  });
}

/** What `lint` asks of a guideline, from the lock's verdicts; none when the config has no `judge`. */
export function verdictsOf(config: ResolvedConfig, messages: readonly Message[], lock: Lock): Verdict | undefined {
  const { judge } = config;
  if (judge === undefined) return undefined;
  const byEntry = new Map(askedOf(config, judge, messages).map((a) => [`${a.locale}\u0000${a.message.key}`, a]));
  return (message, locale, rule) => {
    const a = byEntry.get(`${locale}\u0000${message.key}`);
    if (a === undefined) return undefined;
    if (approved(lock.judged, a, rule)) return false;
    const ps = judge.models.map((m) => answerOf(lock.judged, a, rule, m.id));
    if (ps.some((p) => p === undefined)) return undefined;
    return ps.reduce((sum: number, p) => sum + p!, 0) / ps.length >= judge.threshold;
  };
}

/** A verdict kept as it was, in a copy of the verdicts being built. */
function keeper(verdicts: Verdicts) {
  return (locale: string, key: string, rule: string, id: string, value: string) =>
    ((((verdicts[locale] ??= {})[key] ??= {})[rule] ??= {})[id] = value);
}

export interface ApproveOptions {
  /** The locale approved in: the source by default. */
  locale?: string;
  /** Only these guidelines: every one the entry is held to by default. */
  rules?: readonly string[];
}

/**
 * The author's approval of entries as written: each passes its guidelines whatever the models say,
 * until its words, its role or the guideline change. Gives back the verdicts with the approvals in,
 * and why a key couldn't be approved.
 */
export function approve(
  config: ResolvedConfig,
  messages: readonly Message[],
  verdicts: Verdicts | undefined,
  keys: readonly string[],
  options: ApproveOptions = {},
): { verdicts: Verdicts; approved: { key: string; rules: string[] }[]; problems: string[] } {
  const judge = config.judge;
  if (judge === undefined) throw new Error('judge is off: set judge.models in the config, as decisionJudge from prosebook/ai makes one');
  const locale = options.locale ?? config.source;
  const next: Verdicts = structuredClone(verdicts ?? {});
  const keep = keeper(next);
  const byKey = new Map(
    askedOf(config, judge, messages)
      .filter((a) => a.locale === locale)
      .map((a) => [a.message.key, a]),
  );
  const done: { key: string; rules: string[] }[] = [];
  const problems: string[] = [];
  for (const key of keys) {
    const a = byKey.get(key);
    if (a === undefined) {
      problems.push(`${key} (${locale}) is held to no guideline: check the key, and that it has a translation in ${locale}`);
      continue;
    }
    const rules = options.rules ?? [...a.questions.keys()];
    const unheld = rules.filter((r) => !a.questions.has(r));
    if (unheld.length > 0) {
      problems.push(`${key} (${locale}) is not held to ${unheld.join(', ')}: name one of ${[...a.questions.keys()].join(', ')}`);
      continue;
    }
    for (const rule of rules) keep(locale, key, rule, AUTHOR, `${a.questions.get(rule)!.hashes[AUTHOR]}:0`);
    done.push({ key, rules: [...rules] });
  }
  return { verdicts: next, approved: done, problems };
}

/** The keys whose guideline findings the author would approve with `--all`: those broken now, in the locale. */
export function brokenKeys(config: ResolvedConfig, messages: readonly Message[], lock: Lock, locale = config.source): string[] {
  const verdict = verdictsOf(config, messages, lock);
  if (verdict === undefined) return [];
  const guidelines = Object.entries(config.lint.rules).filter(([, { rule }]) => isGuideline(rule));
  return messages.filter((m) => guidelines.some(([name]) => verdict(m, locale, name) === true)).map((m) => m.key);
}

/** What a run took. */
export interface JudgeStats {
  /** Entries in a locale held to some guideline. */
  entries: number;
  /** Of them, those the lock answered in full, so none was asked. */
  cached: number;
  /** Requests made: one per entry in a locale and model with a question the lock didn't answer. */
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
  failures: { key: string; locale: string; model: string; error: unknown }[];
}

export interface JudgeOptions {
  /** Called as each request ends, with how many have and how many will. */
  progress?: (done: number, total: number) => void;
  /** Ask nothing: only bring the verdicts up to date with the catalog, as `--check` does. */
  dry?: boolean;
}

/** One request: an entry in a locale, a model, and the guidelines it has yet to answer of it. */
interface Request {
  a: Asked;
  model: Judge;
  rules: string[];
}

/** Asks the models what the lock can't answer, and gives back the lock's verdicts with the answers in. */
export async function judgeCatalog(config: ResolvedConfig, catalog: Catalog, lock: Lock, options: JudgeOptions = {}): Promise<JudgeRun> {
  const judge = config.judge;
  if (judge === undefined) throw new Error('judge is off: set judge.models in the config, as decisionJudge from prosebook/ai makes one');
  const asked = askedOf(config, judge, catalog.messages);
  const open: Request[] =
    options.dry === true
      ? []
      : asked.flatMap((a) =>
          judge.models.flatMap((model) => {
            const rules = [...a.questions.keys()].filter((rule) => openModels(lock.judged, a, rule, [model]).length > 0);
            return rules.length === 0 ? [] : [{ a, model, rules }];
          }),
        );
  const verdicts: Verdicts = {};
  const keep = keeper(verdicts);
  for (const a of asked) {
    for (const [rule, { hashes }] of a.questions) {
      for (const id of Object.keys(hashes))
        if (answerOf(lock.judged, a, rule, id) !== undefined) keep(a.locale, a.message.key, rule, id, recorded(lock.judged, a, rule, id)!);
    }
  }
  // An entry left out for being broken keeps what the lock said of it, as `keepUnread` keeps its translations.
  if (catalog.problems.some((p) => p.severity === 'error')) {
    const read = new Set(catalog.messages.map((m) => m.key));
    for (const [locale, keys] of Object.entries(lock.judged ?? {})) {
      for (const [key, rules] of Object.entries(keys)) {
        if (read.has(key)) continue;
        for (const [rule, judges] of Object.entries(rules)) for (const [id, v] of Object.entries(judges)) keep(locale, key, rule, id, v);
      }
    }
  }
  const stats: JudgeStats = {
    entries: asked.length,
    cached: asked.length - unanswered(asked, lock.judged, judge.models).length,
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
  const ask = async ({ a, model, rules }: Request) => {
    // By a plain ID of its own, as a provider may hold IDs to a pattern a rule's name doesn't keep to.
    const questions = Object.fromEntries(
      rules.flatMap((rule, i) => {
        const q = a.questions.get(rule)!.questions;
        return [
          [`concerns${i}`, q.concerns],
          [`breaks${i}`, q.breaks],
        ];
      }),
    );
    const at = performance.now();
    const response = await model.judge({ state: a.state, questions, signal: stop.signal });
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
        throw new Error(`${model.id} gave no probability for ${rule}: check that it answers boolean questions`);
      return p;
    };
    rules.forEach((rule, i) => {
      const p = probability(`concerns${i}`, rule) * probability(`breaks${i}`, rule);
      keep(a.locale, a.message.key, rule, model.id, `${a.questions.get(rule)!.hashes[model.id]}:${Math.round(p * 100) / 100}`);
    });
    options.progress?.(stats.requests, open.length);
  };
  const worker = async () => {
    while (next < open.length && !stop.signal.aborted) {
      const request = open[next++]!;
      try {
        await ask(request);
      } catch (error) {
        if (!stop.signal.aborted) failures.push({ key: request.a.message.key, locale: request.a.locale, model: request.model.id, error });
        stop.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(judge.concurrency, open.length) }, worker));
  stats.ms = performance.now() - started;
  return { verdicts, stats, failures };
}
