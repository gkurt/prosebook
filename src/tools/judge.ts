/**
 * `prosebook judge`: the guidelines no pattern can check, each entry held to them by its judges.
 *
 * A guideline (a `guideline` rule, as the `voice` plugin's are) is a matter of meaning, so the lint
 * can't find a string breaking it. A decision model can: each entry, in each locale its guidelines
 * read, goes to each model as one request, the entry as its state and two yes-or-no questions per
 * guideline, and the model answers with the probability that the entry breaks it. prosebook never
 * calls a model itself: the config's `judge.models` do, as `prosebook/ai`'s `decisionJudge` makes one
 * from an AI SDK decision model. With several, the first that answered an entry decides.
 *
 * The author is a judge too, one no request asks: `prosebook approve` records that an entry is right
 * as written, which passes it against a guideline whatever the models say, and against any other rule
 * whatever the rule finds, until its words change. The lint reads the approvals with or without a judge.
 *
 * Each answer is kept in the lock, beside a hash of everything the request said: the model, the
 * prompt, the entry and the guidelines, every one the entry is held to, as each is weighed with the
 * rest, so a guideline changed asks again of every entry it reads. An approval's hash is the entry's
 * and its one guideline's alone, so a new model or prompt keeps it. A run asks only of what changed,
 * and `lint` reads the lock's verdicts without a model: the probability is kept rather than the
 * verdict, so a new `threshold` needs no new run.
 */
import { driftFrom, type Catalog, type Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { applies, isGuideline, languageName, lint, severityOf, type Verdict } from './lint.ts';
import { hash, type Lock } from './lock.ts';
import { toneIn } from './presets.ts';
import { readMessage } from './syntax.ts';

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
  /**
   * The entry's `message` rewritten to keep to every guideline asked of it, where the judge finds one
   * broken: in the message's own syntax, with its placeholders and tags. A decision model gives none.
   * One that drops or changes a placeholder is left out; one kept is written by `lint --fix --unsafe`.
   */
  suggestion?: string;
}

/** A decision model, as the config's `judge.models` take one. */
export interface Judge {
  /** Names the model in the lock, beside each of its answers, so adding a model asks only it. */
  id: string;
  judge(request: JudgeRequest): Promise<JudgeResponse>;
  /**
   * `false` where this machine can't ask the model, as without its key: no run asks it, and `--check`
   * waits on no answer of its, but its answers and suggestions in the lock count as any model's do,
   * so every machine reads the same verdicts. True unless set.
   */
  ask?: boolean;
  /**
   * The probability from which this model's answer is a break, over `judge.threshold`: models spread
   * their answers differently, and one model's clear breaks may start lower or higher than another's.
   */
  threshold?: number;
}

/** The models a run asks, and whose answers `--check` waits on: those not set `ask: false`. */
export const modelsAsked = (judge: Pick<JudgeConfig, 'models'>): Judge[] => judge.models.filter((m) => m.ask !== false);

export interface JudgeConfig {
  /**
   * The models, the one trusted most first: `decisionJudge(model)` or `languageJudge(model)` from
   * `prosebook/ai`, or `Judge`s of your own, for a model the AI SDK doesn't reach. The first that
   * answered an entry decides whether it breaks a guideline, and gives its suggestion; the rest stand in
   * where it hasn't answered, as when it isn't asked here.
   */
  models: Judge[];
  /** Said to the models beside every entry: what the app is, who reads it, what its copy holds to. */
  prompt?: string;
  /**
   * The probability from which an entry breaks a guideline: 0.5 by default, the product of two answers
   * of about 0.7 each. Jev gives a guideline's own bad examples 0.7 or more, but an app's real breaks
   * from about 0.5: on 1,686 entries of one app, 0.7 found 1 break in 11,802 answers, and 0.5 found 174.
   */
  threshold?: number;
  /** Requests in flight at once: 8 by default. */
  concurrency?: number;
  /**
   * What `prosebook check` makes of an entry the lock holds no verdict on as written: `error` by
   * default, so an entry nobody ran `prosebook judge` on fails CI, or `warn`.
   */
  unjudged?: 'error' | 'warn';
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

/**
 * The verdicts the lock holds: per locale, per key, per rule, per judge, `<hash>:<probability>`. A model's
 * may hold several, space-separated, one per entry the key names: the same words in code or the docs in two
 * roles are two entries with one key, each asked apart, as each says its role. The author's is one, since an
 * approval holds for the words in any role.
 */
export type Verdicts = Record<string, Record<string, Record<string, Record<string, string>>>>;

/** One entry in one locale, and the guidelines it is held to there. */
export interface Asked {
  message: Message;
  locale: string;
  state: JudgeRequest['state'];
  /** By rule name: its questions, and the hash each judge's answer is kept under, the author's as `AUTHOR`. */
  questions: Map<string, { questions: Questions; hashes: Record<string, string> }>;
}

/**
 * The entry as the model reads it: its words, and what the catalog and the config say about it. Text
 * in code has no key but its words, which the state says already.
 */
function stateOf(config: ResolvedConfig, message: Message, locale: string): JudgeRequest['state'] {
  const translated = locale !== config.source;
  const state: JudgeRequest['state'] = {
    message: translated ? message.translations.get(locale)!.text : message.text,
    language: languageName(locale),
  };
  if (message.places === undefined) state['key'] = message.key;
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
      // What the writers say of the copy: the judge's prompt, and the tone the entry is written in.
      const tone = toneIn(config, message.places === undefined ? message.area : undefined);
      const notes = [judge.prompt, tone.doc, tone.notes].filter((s): s is string => s !== undefined).join(' ');
      const state = {
        ...entry,
        ...(notes !== '' && { notes }),
        guidelines: held.map(([, { rule }]) => rule.description),
      };
      const questions = new Map(
        held.map(([name, { rule }]) => {
          const questions = questionsOf(rule.description, notes !== '');
          const hashes = Object.fromEntries(judge.models.map((m) => [m.id, hash(JSON.stringify([PROMPT, m.id, state, questions]))]));
          hashes[AUTHOR] = authorHash(config, message, locale, name)!;
          return [name, { questions, hashes }];
        }),
      );
      asked.push({ message, locale, state, questions });
    }
  }
  return asked;
}

/**
 * What the author's approval of an entry against a rule is kept under: the entry's words and role and
 * the rule's description, whatever else a model was told, so a new model or prompt keeps it. Text in
 * code by its words alone, so moving it keeps it too. None for a rule the config doesn't have.
 */
function authorHash(config: ResolvedConfig, message: Message, locale: string, rule: string): string | undefined {
  const description = config.lint.rules[rule]?.rule.description;
  if (description === undefined) return undefined;
  const entry =
    message.places === undefined
      ? stateOf(config, message, locale)
      : { message: locale === config.source ? message.text : message.translations.get(locale)!.text, language: languageName(locale) };
  return hash(JSON.stringify([AUTHOR, entry, description]));
}

/** Whether the author approved the entry against the rule, as it is now. */
function approvedNow(config: ResolvedConfig, verdicts: Verdicts | undefined, message: Message, locale: string, rule: string): boolean {
  const at = verdicts?.[locale]?.[message.key]?.[rule]?.[AUTHOR]?.split(':')[0];
  return at !== undefined && at === authorHash(config, message, locale, rule);
}

/** The entries a rule comparing entries holds one to: not text in code, which has no entries to merge. */
const comparedWith = (messages: readonly Message[]) => messages.filter((m) => m.places === undefined);

const recorded = (verdicts: Verdicts | undefined, a: Asked, rule: string, id: string) =>
  verdicts?.[a.locale]?.[a.message.key]?.[rule]?.[id];

/** The probability a judge gave, when it was asked of the entry as it is now. */
function answerOf(verdicts: Verdicts | undefined, a: Asked, rule: string, id: string): number | undefined {
  const hash = a.questions.get(rule)?.hashes[id];
  for (const answer of (recorded(verdicts, a, rule, id) ?? '').split(' ')) {
    const [at, p] = answer.split(':');
    if (at === hash && p !== undefined && p !== '') return Number(p);
  }
  return undefined;
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

/**
 * What `lint` asks of a rule, from the lock's verdicts: whether the author approved the entry against
 * it, and for a guideline, what the models judged, where the config has a `judge`.
 */
export function verdictsOf(config: ResolvedConfig, messages: readonly Message[], lock: Lock): Verdict {
  const { judge } = config;
  // By entry, not key: the same words in code or the docs in two roles are two entries with one key.
  const byEntry = new Map<Message, Map<string, Asked>>();
  for (const a of judge === undefined ? [] : askedOf(config, judge, messages)) {
    const locales = byEntry.get(a.message) ?? new Map<string, Asked>();
    byEntry.set(a.message, locales.set(a.locale, a));
  }
  const verdict: Verdict = (message, locale, rule) => {
    if (approvedNow(config, lock.judged, message, locale, rule)) return false;
    const a = byEntry.get(message)?.get(locale);
    if (a === undefined || judge === undefined || !a.questions.has(rule)) return undefined;
    // The first model that answered decides: one not asked here, or not yet, leaves the next to.
    for (const { id, threshold = judge.threshold } of judge.models) {
      const p = answerOf(lock.judged, a, rule, id);
      if (p !== undefined) return p >= threshold;
    }
    return undefined;
  };
  // The first judge's, in the config's order, that holds for the entry as it reads.
  verdict.suggestion = (message, locale) => {
    const a = byEntry.get(message)?.get(locale);
    if (a === undefined || judge === undefined) return undefined;
    for (const { id } of judge.models) {
      const text = suggestionOf(lock.suggested?.[locale]?.[message.key]?.[id] ?? [], a);
      if (text !== undefined) return text;
    }
    return undefined;
  };
  return verdict;
}

/**
 * The rewrites the judges suggested, which the lock holds: per locale, per key, per judge, each
 * `<hash>:<text>`, the hash over the entry's state as given, so a suggestion holds only while the entry
 * reads as it did. Several where the same words in code or the docs stand in two roles, as verdicts are.
 */
export type Suggestions = Record<string, Record<string, Record<string, string[]>>>;

/** The hash a suggestion is kept under: the entry as the judge was given it. */
const stateHash = (a: Asked) => hash(JSON.stringify(a.state));

/** A suggestion's text, where it was given for the entry as it reads now. */
function suggestionOf(said: readonly string[], a: Asked): string | undefined {
  const at = `${stateHash(a)}:`;
  return said.find((s) => s.startsWith(at))?.slice(at.length);
}

/** A suggestion kept, in place of one given for the same entry as it read. */
function suggester(suggestions: Suggestions) {
  return (a: Asked, id: string, text: string) => {
    const judges = ((suggestions[a.locale] ??= {})[a.message.key] ??= {});
    const at = `${stateHash(a)}:`;
    judges[id] = [...(judges[id] ?? []).filter((s) => !s.startsWith(at)), `${at}${text}`].sort();
  };
}

/**
 * Whether a suggestion can stand for the entry's text: read in the catalog's syntax, with the source's
 * placeholders and tags, and saying something else than the text does. A judge's rewrite is a guess,
 * so one that would break the message is left out rather than written.
 */
function suggestionHolds(config: ResolvedConfig, a: Asked, text: string): boolean {
  if (text.trim() === '' || text === a.state['message']) return false;
  // Text in code or the docs is read as ICU whatever the catalog's syntax (`scanned.ts`).
  const syntax = a.message.places === undefined ? config.messageFormat : 1;
  try {
    return driftFrom(a.message, readMessage(syntax, text, a.locale, { formats: config.formats })) === undefined;
  } catch {
    return false;
  }
}

/** A verdict kept as it was, in a copy of the verdicts being built. */
function keeper(verdicts: Verdicts) {
  return (locale: string, key: string, rule: string, id: string, value: string) => {
    const judges = (((verdicts[locale] ??= {})[key] ??= {})[rule] ??= {});
    // A model's answer joins those it gave other entries with the key, in place of any under the same hash.
    const hash = value.split(':')[0];
    const others = id === AUTHOR ? [] : (judges[id]?.split(' ') ?? []).filter((answer) => answer.split(':')[0] !== hash);
    judges[id] = [...others, value].sort().join(' ');
  };
}

export interface ApproveOptions {
  /** The locale approved in: the source by default. */
  locale?: string;
  /** Only these rules: by default every rule the entry breaks now, and every guideline it is held to. */
  rules?: readonly string[];
}

/**
 * The rules an entry can be approved against in a locale: those it breaks now, as the lint finds it
 * with no approval, and where the config has a `judge`, every guideline it is held to, broken or not.
 * The same words in code may be several entries, each place's exemptions apart, and are approved as one.
 */
function heldTo(config: ResolvedConfig, same: readonly Message[], all: readonly Message[], locale: string): Set<string> {
  const held = new Set<string>();
  const guidelines = config.judge === undefined ? [] : Object.entries(config.lint.rules).filter(([, { rule }]) => isGuideline(rule));
  for (const message of same) {
    for (const [name, { rule }] of guidelines)
      if (severityOf(config, name, message) !== 'off' && applies(rule, message, locale, config.source)) held.add(name);
  }
  for (const f of lint([...same], config, comparedWith(all))) if (f.locale === locale && f.rule !== 'allow') held.add(f.rule);
  return held;
}

/**
 * The author's approval of entries as written: each passes the rules named whatever they or the models
 * say, until its words, its role or the rule change. Gives back the verdicts with the approvals in, and
 * why a key couldn't be approved. Text in code (`catalog: false`) and the docs keep no approval of
 * words no longer found, as nothing else would ever drop it.
 */
export function approve(
  config: ResolvedConfig,
  messages: readonly Message[],
  verdicts: Verdicts | undefined,
  keys: readonly string[],
  options: ApproveOptions = {},
): { verdicts: Verdicts; approved: { key: string; rules: string[] }[]; problems: string[] } {
  const locale = options.locale ?? config.source;
  const next: Verdicts = structuredClone(verdicts ?? {});
  // Words in code or the docs (`--docs`, approved into the lock's `docs`) are keys nothing else drops.
  if (messages.every((m) => m.places !== undefined)) {
    const found = new Set(messages.map((m) => m.key));
    for (const keyed of Object.values(next)) for (const key of Object.keys(keyed)) if (!found.has(key)) delete keyed[key];
  }
  const keep = keeper(next);
  const done: { key: string; rules: string[] }[] = [];
  const problems: string[] = [];
  for (const key of keys) {
    const same = messages.filter((m) => m.key === key && (locale === config.source || m.translations.has(locale)));
    const shown = config.inCode || /\s/.test(key) ? `"${key}"` : key;
    if (same.length === 0) {
      problems.push(`${shown} (${locale}) is no entry: check the key, and that it has a translation in ${locale}`);
      continue;
    }
    const held = heldTo(config, same, messages, locale);
    if (held.size === 0) {
      problems.push(
        `${shown} (${locale}) breaks no rule${config.judge === undefined ? '' : ' and is held to no guideline'}: nothing to approve`,
      );
      continue;
    }
    const rules = options.rules ?? [...held];
    const unheld = rules.filter((r) => !held.has(r));
    if (unheld.length > 0) {
      problems.push(`${shown} (${locale}) is not held to ${unheld.join(', ')}: name one of ${[...held].join(', ')}`);
      continue;
    }
    for (const rule of rules) keep(locale, key, rule, AUTHOR, `${authorHash(config, same[0]!, locale, rule)!}:0`);
    done.push({ key, rules: [...rules] });
  }
  return { verdicts: next, approved: done, problems };
}

/** The keys the author would approve with `--all`: those breaking some rule now, in the locale, unapproved. */
export function brokenKeys(config: ResolvedConfig, messages: readonly Message[], lock: Lock, locale = config.source): string[] {
  const findings = lint([...messages], config, comparedWith(messages), verdictsOf(config, messages, lock));
  return [...new Set(findings.filter((f) => f.locale === locale && f.rule !== 'allow').map((f) => f.key))];
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
  /** Suggestions given and kept: each in the message's syntax, with its placeholders and tags. */
  suggestions: number;
}

export interface JudgeRun {
  /** The lock's verdicts, brought up to date: every entry's, those asked and those kept. */
  verdicts: Verdicts;
  /** The lock's suggestions the same way: those given now, and those kept that still hold. */
  suggestions: Suggestions;
  stats: JudgeStats;
  /** Why requests failed; a run stops asking at the first, and keeps what was answered. */
  failures: { key: string; locale: string; model: string; error: unknown }[];
}

export interface JudgeOptions {
  /** Called as each request ends, with how many have and how many will. */
  progress?: (done: number, total: number) => void;
  /** Ask nothing: only bring the verdicts up to date with the catalog, as `--check` does. */
  dry?: boolean;
  /** Ask only of these entries, as `judge <paths>` does; the lock keeps what it said of the rest. */
  only?: (message: Message) => boolean;
}

/** One request: an entry in a locale, a model, and the guidelines it has yet to answer of it. */
interface Request {
  a: Asked;
  model: Judge;
  rules: string[];
}

/** Asks the models what the lock can't answer, and gives back the lock's verdicts with the answers in. */
export async function judgeCatalog(
  config: ResolvedConfig,
  catalog: Pick<Catalog, 'messages' | 'problems'>,
  lock: Lock,
  options: JudgeOptions = {},
): Promise<JudgeRun> {
  const judge = config.judge;
  if (judge === undefined) throw new Error('judge is off: set judge.models in the config, as decisionJudge from prosebook/ai makes one');
  const asked = askedOf(config, judge, catalog.messages);
  const { only } = options;
  const asking = only === undefined ? asked : asked.filter((a) => only(a.message));
  const open: Request[] =
    options.dry === true
      ? []
      : asking.flatMap((a) =>
          modelsAsked(judge).flatMap((model) => {
            const rules = [...a.questions.keys()].filter((rule) => openModels(lock.judged, a, rule, [model]).length > 0);
            return rules.length === 0 ? [] : [{ a, model, rules }];
          }),
        );
  const verdicts: Verdicts = {};
  const keep = keeper(verdicts);
  for (const a of asked) {
    for (const [rule, { hashes }] of a.questions) {
      for (const [id, hash] of Object.entries(hashes)) {
        // Only this entry's answer: one the key's other entries gave is kept as each of them is read.
        const answer = answerOf(lock.judged, a, rule, id);
        if (answer !== undefined) keep(a.locale, a.message.key, rule, id, `${hash}:${answer}`);
      }
    }
  }
  // An approval against a rule no model is asked of, as the entry still is.
  for (const m of catalog.messages) {
    for (const locale of [config.source, ...m.translations.keys()]) {
      for (const [rule, judges] of Object.entries(lock.judged?.[locale]?.[m.key] ?? {})) {
        const approval = judges[AUTHOR];
        if (approval !== undefined && approvedNow(config, lock.judged, m, locale, rule)) keep(locale, m.key, rule, AUTHOR, approval);
      }
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
    entries: asking.length,
    cached: asking.length - unanswered(asking, lock.judged, modelsAsked(judge)).length,
    requests: 0,
    questions: 0,
    ms: 0,
    latencies: [],
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    unpriced: 0,
    suggestions: 0,
  };
  const failures: JudgeRun['failures'] = [];
  // A suggestion holds while the entry is as it was given for: kept for an entry read now, dropped for the rest.
  const suggestions: Suggestions = {};
  const suggest = suggester(suggestions);
  for (const a of asked) {
    for (const [id, said] of Object.entries(lock.suggested?.[a.locale]?.[a.message.key] ?? {})) {
      const text = suggestionOf(said, a);
      if (text !== undefined) suggest(a, id, text);
    }
  }
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
    if (response.suggestion !== undefined && suggestionHolds(config, a, response.suggestion)) {
      suggest(a, model.id, response.suggestion);
      stats.suggestions++;
    }
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
  return { verdicts, suggestions, stats, failures };
}
