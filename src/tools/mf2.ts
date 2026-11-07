/**
 * Unicode MessageFormat 2, read into the element tree MF1 messages parse to, so the compiler, the
 * types, the lint and the pseudo-locale treat both syntaxes alike; and written back from that tree,
 * for `extract` and `migrate`.
 *
 * The tree holds what a message does, not how it was written. `.input {$n :number}` becomes a number
 * element at each `{$n}`, and `.match` becomes plural and select elements, one level per selector,
 * built so the runtime's ICU-style selection picks the variant MF2's would (see `matchTree`). Literal
 * option values are resolved here into `Intl` options, so the runtime is the same for both. An option
 * an argument gives (`currency=$code`, of those in `FROM_ARGUMENT`) rides on the style as the `Intl`
 * option it sets, which the compiled message passes beside the hoisted ones.
 */
import { SKELETON_TYPE, TYPE } from '@formatjs/icu-messageformat-parser';
import type {
  DateElement,
  DateTimeSkeleton,
  NumberElement,
  NumberSkeleton,
  PluralElement,
  PluralOrSelectOption,
  SelectElement,
  TimeElement,
} from '@formatjs/icu-messageformat-parser';
import { MessageSyntaxError, parseMessage, stringifyMessage, validate, type Model } from 'messageformat';

import { formatIn, type FormatKind, type Formats } from '#src/runtime/formats.ts';

import {
  asElement,
  DURATION,
  durationOptions,
  ENTRY,
  entryOf,
  extensionOf,
  FORM,
  LIST,
  listOptions,
  namedOf,
  selectionOf,
  walk,
  type ExtensionElement,
  type MessageFormatElement,
  type NamedStyle,
  type OptionArgs,
  type Placeholder,
  type Selection,
} from './icu.ts';

type Element = MessageFormatElement;

/** A function as written: `:number minimumFractionDigits=2`. Kept on the styles it produces, to write back. */
export interface Mf2Function {
  name: string;
  options: Record<string, string>;
  /** Options given by an argument, as `currency=$code`: the option's name to the argument's. */
  args?: Record<string, string>;
  /** `u:dir`: the direction the value is written in, which picks the mark isolating it. */
  dir?: 'ltr' | 'rtl' | 'auto';
  /** The options of the format `format=` names, in the locale read: the config's (`formats`), not the message's. */
  named?: Intl.NumberFormatOptions | Intl.DateTimeFormatOptions;
}

type Value = { kind: 'literal'; value: string; fn?: Mf2Function } | { kind: 'variable'; name: string; fn?: Mf2Function; offset: number };

type Scope = Map<string, Value>;

interface Selector {
  name: string;
  kind: 'plural' | 'ordinal' | 'exact' | 'string';
  offset: number;
  /** For a number selected on other than as a bare `:number`. */
  selection?: Selection;
}

/** The `Intl.NumberFormat` options `Intl.PluralRules` takes too, which change a number's category. */
const PLURAL_OPTIONS = new Set([
  'minimumIntegerDigits',
  'minimumFractionDigits',
  'maximumFractionDigits',
  'minimumSignificantDigits',
  'maximumSignificantDigits',
  'roundingIncrement',
  'roundingMode',
  'roundingPriority',
  'trailingZeroDisplay',
]);

export const NUMBER_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const NAME = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;

const DIGITS = [
  'minimumIntegerDigits',
  'minimumFractionDigits',
  'maximumFractionDigits',
  'minimumSignificantDigits',
  'maximumSignificantDigits',
  'roundingIncrement',
];
const ROUNDING = ['trailingZeroDisplay', 'roundingPriority', 'roundingMode'];
const SIGNIFICANT = ['minimumSignificantDigits', 'maximumSignificantDigits'];

/** The options each default function takes, from the MF2 spec. */
const OPTIONS: Record<string, readonly string[]> = {
  string: [],
  // prosebook's own: a list of strings, and a duration in milliseconds, as MF1's `{x, list}` and `{x, duration}`.
  list: ['format', 'type', 'style'],
  duration: ['format', 'style'],
  // prosebook's own too: another entry's text, a name, said here as MF1's `{app.title, entry}`.
  'pb:entry': ['form'],
  number: ['format', 'select', 'signDisplay', 'useGrouping', ...DIGITS, ...ROUNDING],
  integer: ['select', 'signDisplay', 'useGrouping', 'minimumIntegerDigits', 'maximumSignificantDigits'],
  currency: [
    'currency',
    'currencySign',
    'currencyDisplay',
    'useGrouping',
    'minimumIntegerDigits',
    'fractionDigits',
    ...SIGNIFICANT,
    ...ROUNDING,
    'roundingIncrement',
  ],
  percent: ['signDisplay', 'useGrouping', 'minimumFractionDigits', 'maximumFractionDigits', ...SIGNIFICANT, ...ROUNDING],
  unit: ['unit', 'unitDisplay', 'signDisplay', 'useGrouping', ...DIGITS, ...ROUNDING],
  offset: ['add', 'subtract'],
  date: ['format', 'fields', 'length', 'calendar', 'timeZone'],
  time: ['format', 'precision', 'timeZoneStyle', 'hour12', 'calendar', 'timeZone'],
  datetime: ['format', 'dateFields', 'dateLength', 'timePrecision', 'timeZoneStyle', 'hour12', 'calendar', 'timeZone'],
};

/** Options whose values are a fixed set, checked here because MF2's names differ from `Intl`'s. */
const DATE_FIELDS = ['weekday', 'day-weekday', 'month-day', 'month-day-weekday', 'year-month-day', 'year-month-day-weekday'];
const ENUMS: Record<string, readonly string[]> = {
  select: ['plural', 'ordinal', 'exact'],
  useGrouping: ['auto', 'always', 'never', 'min2'],
  currencyDisplay: ['narrowSymbol', 'symbol', 'name', 'code'],
  fields: DATE_FIELDS,
  dateFields: DATE_FIELDS,
  length: ['long', 'medium', 'short'],
  dateLength: ['long', 'medium', 'short'],
  precision: ['hour', 'minute', 'second'],
  timePrecision: ['hour', 'minute', 'second'],
  timeZoneStyle: ['long', 'short'],
  hour12: ['true', 'false'],
};

const oneOf = (values: readonly string[]) => values.map((v) => JSON.stringify(v)).join(' | ');

/**
 * Options an argument may give, with the `Intl` options each sets and the argument's type. These pass
 * to `Intl` as they are, so the runtime merges them in; the rest change what the formatter is (a
 * date's fields, how a number selects) and are settled when the message compiles.
 */
const FROM_ARGUMENT: Record<string, { intl: readonly string[]; type: string }> = {
  currency: { intl: ['currency'], type: 'string' },
  currencyDisplay: { intl: ['currencyDisplay'], type: oneOf(ENUMS.currencyDisplay!) },
  currencySign: { intl: ['currencySign'], type: oneOf(['standard', 'accounting']) },
  unit: { intl: ['unit'], type: 'string' },
  unitDisplay: { intl: ['unitDisplay'], type: oneOf(['long', 'short', 'narrow']) },
  signDisplay: { intl: ['signDisplay'], type: oneOf(['auto', 'always', 'exceptZero', 'negative', 'never']) },
  fractionDigits: { intl: ['minimumFractionDigits', 'maximumFractionDigits'], type: 'number' },
  ...Object.fromEntries(DIGITS.filter((d) => d !== 'roundingIncrement').map((d) => [d, { intl: [d], type: 'number' }])),
  timeZone: { intl: ['timeZone'], type: 'string' },
  calendar: { intl: ['calendar'], type: 'string' },
};

/** Options an operand's function doesn't pass on to these, per the spec. */
const DISCARDED: Record<string, readonly string[]> = {
  integer: ['minimumFractionDigits', 'maximumFractionDigits', 'minimumSignificantDigits'],
  percent: ['minimumIntegerDigits', 'roundingIncrement', 'select'],
};

const NUMERIC = new Set(['number', 'integer', 'currency', 'percent', 'unit']);
const TEMPORAL = new Set(['date', 'time', 'datetime']);

const family = (name: string) => (NUMERIC.has(name) ? 'number' : TEMPORAL.has(name) ? 'date' : name);

const HINTS: Record<string, string> = {
  'missing-selector-annotation': 'a .match variable needs a function that selects, declared first: .input {$count :number}',
  'missing-fallback': 'a .match needs a variant whose keys are all *',
  'key-mismatch': 'each variant has one key per .match variable',
  'duplicate-variant': 'two variants have the same keys',
  'duplicate-declaration': 'a variable is declared twice, or declared after a use',
  'duplicate-option-name': 'an option is given twice',
  'duplicate-attribute': 'an attribute is given twice',
  'bad-escape': 'only \\\\, \\{, \\} and \\| are escapes',
  'bad-input-expression': '.input takes a variable: .input {$count :number}',
  'extra-content': 'something follows the end of the message: a message with .match ends with its last variant',
  'empty-token': 'a name or value is missing',
};

/** Thrown from `validate`'s callback, which reports a data-model error without throwing. */
class ModelError extends Error {
  readonly type: string;
  constructor(type: string) {
    super(type);
    this.type = type;
  }
}

function syntaxProblem(text: string, e: unknown): string {
  const type = e instanceof MessageSyntaxError || e instanceof ModelError ? e.type : undefined;
  const hint = type === undefined ? undefined : HINTS[type];
  let where = '';
  if (e instanceof MessageSyntaxError) {
    const before = text.slice(0, e.start).split('\n');
    const near = text.slice(e.start, e.start + 16).split('\n')[0];
    where = ` at line ${before.length}, column ${before.at(-1)!.length + 1}${near ? ` (near "${near}")` : ''}`;
  }
  const reason = hint ?? (e instanceof Error ? e.message.replace(/ at \d+$/, '') : String(e));
  return `is not valid MessageFormat 2${where}: ${reason}`;
}

/** How a message is read: `isolate` (see `Isolate`), and the formats the config names, which `format=` names. */
export interface ReadOptions {
  isolate?: Isolate;
  formats?: Formats;
}

/** An MF2 message as the element tree. Throws, with the fix, where it can't be read or compiled. */
export function parseMf2(text: string, locale: string, { isolate = 'rtl', formats }: ReadOptions = {}): Element[] {
  const reading: Reading = { locale, isolate, dir: directionOf(locale), formats };
  let message: Model.Message;
  try {
    message = parseMessage(text);
    validate(message, (type) => {
      throw new ModelError(type);
    });
  } catch (e) {
    throw new Error(syntaxProblem(text, e), { cause: e });
  }
  const scope: Scope = new Map();
  for (const declaration of message.declarations)
    // `.input` reads the argument itself; a `.local` can build on what is declared before it. The
    // options of either can name what is declared before them.
    scope.set(declaration.name, resolve(declaration.value, reading, declaration.type === 'input' ? new Map() : scope, scope));

  if (message.type === 'message') return pattern(message.pattern, scope, reading);
  const selectors = message.selectors.map((s) => selectorOf(s.name, scope));
  const candidates = message.variants.map((variant) => {
    const keys = variant.keys.map((k) => (k.type === '*' ? null : k.value));
    keys.forEach((key, i) => checkKey(selectors[i]!, key, message.selectors[i]!.name));
    return { keys, prefs: [], value: pattern(variant.value, scope, reading) };
  });
  return matchTree(selectors, candidates, 0, locale);
}

/**
 * When a placeholder is isolated from the text around it, so a value written the other way can't
 * reorder it: `'rtl'` in a locale not known to run left to right, or where `u:dir` asks; `'always'`
 * also for every value of unknown direction (a string), as the spec's default strategy has it.
 */
export type Isolate = 'rtl' | 'always' | false;

type Direction = 'ltr' | 'rtl' | 'auto';

interface Reading {
  locale: string;
  isolate: Isolate;
  /** The locale's direction, which the message's is. */
  dir: Direction;
  formats: Formats | undefined;
}

// The scripts CLDR writes right to left, as the `messageformat` package lists them.
const RTL_SCRIPTS = new Set(['Adlm', 'Arab', 'Hebr', 'Mand', 'Nkoo', 'Rohg', 'Syrc', 'Thaa']);
const [LRI, RLI, FSI, PDI] = ['\u2066', '\u2067', '\u2068', '\u2069'];

function directionOf(locale: string): Direction {
  try {
    const script = new Intl.Locale(locale).maximize().script;
    return script === undefined ? 'auto' : RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
  } catch {
    return 'auto';
  }
}

/** The fallback a placeholder shows, and the marks isolating it where `isolate` and `u:dir` ask. */
function placeholderFor(name: string, fn: Mf2Function | undefined, r: Reading): Placeholder {
  const fallback = `{$${name}}`;
  if (r.isolate === false) return { fallback };
  // A number or date is written as the locale writes; a string's direction is its own.
  const dir = fn?.dir ?? (fn === undefined || fn.name === 'string' ? 'auto' : r.dir);
  const isolate = r.dir !== 'ltr' || (dir !== 'ltr' && (r.isolate === 'always' || fn?.dir !== undefined));
  if (!isolate) return { fallback };
  return { fallback, isolate: [dir === 'ltr' ? LRI : dir === 'rtl' ? RLI : FSI, PDI] };
}

function functionOf(ref: Model.FunctionRef, scope: Scope, r: Reading): Mf2Function {
  const allowed = OPTIONS[ref.name];
  if (allowed === undefined) {
    const known = Object.keys(OPTIONS).map((n) => `:${n}`);
    throw new Error(`:${ref.name} is not a function prosebook knows: ${known.join(', ')}`);
  }
  const options: Record<string, string> = {};
  const args: Record<string, string> = {};
  let dir: Mf2Function['dir'];
  for (const [key, value] of Object.entries(ref.options ?? {})) {
    // `u:id` names a part of the formatted output, which this runtime doesn't hand out.
    if (key === 'u:id') continue;
    if (key === 'u:dir') {
      const dirs = ['ltr', 'rtl', 'auto', 'inherit'];
      if (value.type !== 'literal' || !dirs.includes(value.value))
        throw new Error(`:${ref.name} u:dir is one of ${dirs.join(', ')}, written in the message`);
      // `inherit` is the direction it would have had anyway.
      if (value.value !== 'inherit') dir = value.value as Mf2Function['dir'];
      continue;
    }
    if (!allowed.includes(key))
      throw new Error(`:${ref.name} has no option "${key}"${allowed.length > 0 ? `: ${allowed.join(', ')}` : ''}`);
    if (key === 'format' && value.type !== 'literal')
      throw new Error(`:${ref.name} format=$${value.name}: a format is named in the message, as format=price`);
    const literal = value.type === 'literal' ? value.value : optionArg(ref.name, key, value.name, scope);
    if (typeof literal !== 'string') {
      args[key] = literal.arg;
      continue;
    }
    const values = ENUMS[key];
    if (values !== undefined && !values.includes(literal))
      throw new Error(`:${ref.name} ${key}=${literal} is not a value it takes: ${values.join(', ')}`);
    if (DIGITS.includes(key) && !/^\d+$/.test(literal)) throw new Error(`:${ref.name} ${key}=${literal} is not a whole number`);
    options[key] = literal;
  }
  if (ref.name === 'unit' && ref.options?.usage !== undefined)
    throw new Error(":unit usage converts between units, which `Intl` can't do: convert the value before passing it");
  const named = options.format === undefined ? undefined : namedFormat(ref.name, options.format, r);
  if (options.timeZone === 'input') throw new Error(`:${ref.name} timeZone=input needs a zoned value, which a JavaScript Date isn't`);
  if (ref.name === 'offset') {
    const given = ['add', 'subtract'].filter((k) => options[k] !== undefined);
    if (given.length !== 1 || !/^\d+$/.test(options[given[0]!]!))
      throw new Error(':offset takes one of add or subtract, as a whole number: {$count :offset subtract=1}');
  }
  return { name: ref.name, options, ...(Object.keys(args).length > 0 && { args }), ...(dir && { dir }), ...(named && { named }) };
}

/** The options of the format `format=` names, in the locale read. */
function namedFormat(fn: string, name: string, r: Reading): object {
  const kind = family(fn) as FormatKind;
  const options = formatIn(r.formats, kind, name, r.locale);
  if (options !== undefined) return options;
  const names = Object.keys(r.formats?.[kind] ?? {});
  const known = names.length > 0 ? `: ${names.join(', ')}` : `, and it names none: add ${name} under formats.${kind}`;
  throw new Error(`:${fn} format=${name} names no format of the config's (formats.${kind})${known}`);
}

/**
 * A named format is the whole format, so an option beside it would say something it doesn't: a
 * format of its own is another name in the config. `select` says how `.match` picks, so it may stay.
 */
function checkFormat(fn: Mf2Function): void {
  if (fn.options.format === undefined) return;
  if (!OPTIONS[fn.name]!.includes('format'))
    throw new Error(`:${fn.name} adds to a named format (format=${fn.options.format}), which is whole: format it with :number`);
  const beside = [...Object.keys(fn.options), ...Object.keys(fn.args ?? {})].filter((k) => k !== 'format' && k !== 'select');
  if (beside.length > 0) {
    throw new Error(
      `:${fn.name} format=${fn.options.format} has ${beside.join(', ')} beside it: a named format is whole, so name another format in the config for this one`,
    );
  }
}

/**
 * The argument an option names, or the literal a `.local` it names holds. A variable declared with a
 * function of its own is refused: what it would give the option is its formatted text.
 */
function optionArg(fn: string, key: string, name: string, scope: Scope): string | { arg: string } {
  const bound = scope.get(name);
  if (bound?.fn?.name === 'pb:entry') throw new Error(nameIsText(`:${fn} ${key}=$${name} gives an option`, name));
  const plain = bound?.fn === undefined || bound.fn.name === 'string';
  if (bound?.kind === 'literal' && plain) return bound.value;
  if (FROM_ARGUMENT[key] === undefined) {
    const which = Object.keys(FROM_ARGUMENT).filter((k) => OPTIONS[fn]!.includes(k));
    const can = which.length > 0 ? `: of :${fn}'s, only ${which.join(', ')} can` : '';
    throw new Error(`:${fn} ${key}=$${name}: ${key} is settled as the message compiles, so write its value in the message${can}`);
  }
  if (bound === undefined) return { arg: name };
  if (bound.kind === 'variable' && plain && bound.offset === 0) return { arg: bound.name };
  throw new Error(`:${fn} ${key}=$${name}: $${name} is formatted, so it can't give an option: name the argument itself`);
}

function resolve(expr: Model.Expression, r: Reading, scope: Scope, optionScope = scope): Value {
  const fn = expr.functionRef === undefined ? undefined : functionOf(expr.functionRef, optionScope, r);
  if (expr.arg === undefined) throw new Error(`{:${fn!.name}} has nothing to format: give it a value, {$value :${fn!.name}}`);
  const base: Value =
    expr.arg.type === 'literal'
      ? { kind: 'literal', value: expr.arg.value }
      : (scope.get(expr.arg.name) ?? { kind: 'variable', name: expr.arg.name, offset: 0 });
  // Its key is the literal it holds, which another function would format in its place.
  if (fn !== undefined && fn.name !== 'pb:entry' && base.fn?.name === 'pb:entry' && expr.arg.type === 'variable')
    throw new Error(nameIsText(`:${fn.name} formats $${expr.arg.name}`, expr.arg.name));
  const value = apply(base, fn);
  if (value.fn !== undefined) {
    checkNamed(value.fn);
    checkFormat(value.fn);
  }
  return value;
}

/**
 * A currency or a unit named, on the function or on the one its operand was declared with: after
 * `.input {$price :currency currency=EUR}`, `{$price :currency fractionDigits=0}` is still in euros.
 */
function checkNamed(fn: Mf2Function): void {
  const given = (key: string) => fn.options[key] !== undefined || fn.args?.[key] !== undefined;
  if (fn.name === 'currency' && !given('currency'))
    throw new Error(':currency needs its currency named: {$price :currency currency=EUR}, or currency=$code to take it from an argument');
  if (fn.name === 'unit' && !given('unit')) throw new Error(':unit needs its unit named: {$distance :unit unit=kilometer}');
}

/** `fn` applied to a value that may already carry one: options carry over within a family, as the spec has it. */
function apply(base: Value, fn: Mf2Function | undefined): Value {
  if (fn === undefined) return base;
  if (fn.name === 'offset') {
    const by = Number(fn.options.subtract ?? 0) - Number(fn.options.add ?? 0);
    const numeric = base.fn ?? { name: 'number', options: {} };
    if (base.kind === 'literal') return { ...base, value: String(Number(literalNumber(base.value)) - by), fn: numeric };
    return { ...base, offset: base.offset + by, fn: numeric };
  }
  if (base.fn === undefined || family(base.fn.name) !== family(fn.name)) return { ...base, fn };
  const inherited = { ...base.fn.options };
  const inheritedArgs = { ...base.fn.args };
  for (const key of DISCARDED[fn.name] ?? []) {
    delete inherited[key];
    delete inheritedArgs[key];
  }
  // An option given again replaces the one inherited, whether either is a literal or an argument.
  for (const key of Object.keys(fn.options)) delete inheritedArgs[key];
  for (const key of Object.keys(fn.args ?? {})) delete inherited[key];
  const args = { ...inheritedArgs, ...fn.args };
  const options = { ...inherited, ...fn.options };
  const named = fn.options.format === undefined ? base.fn.named : fn.named;
  return {
    ...base,
    fn: {
      name: fn.name,
      options,
      ...(Object.keys(args).length > 0 && { args }),
      ...(fn.dir && { dir: fn.dir }),
      ...(named && { named }),
    },
  };
}

function literalNumber(value: string): string {
  if (!NUMBER_LITERAL.test(value)) throw new Error(`|${value}| is not a number: write it as one, like 42 or 1.5`);
  return value;
}

function selectorOf(name: string, scope: Scope): Selector {
  const value = scope.get(name);
  // `validate` has refused a selector declared without a function.
  if (value === undefined || value.fn === undefined) throw new Error(`.match $${name} needs a function: .input {$${name} :number}`);
  if (value.fn.name === 'pb:entry') throw new Error(nameIsText(`.match selects on $${name}`, name));
  if (value.kind === 'literal')
    throw new Error(`.match $${name} selects on a literal, which always picks the same variant: use that variant's text`);
  const { fn } = value;
  if (fn.name === 'string') return { name: value.name, kind: 'string', offset: 0 };
  if (fn.name === 'number' || fn.name === 'integer' || fn.name === 'percent') {
    const kind = (fn.options.select ?? 'plural') as Selector['kind'];
    return { name: value.name, kind, offset: value.offset, ...selectionWith(fn) };
  }
  throw new Error(`.match $${name} selects with :${fn.name}, which prosebook can't select on: use :number, :integer, :percent or :string`);
}

/**
 * What a number is selected with beyond its kind, as the spec has it: its category as formatted
 * (`1.0` is `other` in English), `:integer` on the value rounded, `:percent` on it times 100. None
 * for a bare `:number`, which selects as MF1 does.
 */
function selectionWith(fn: Mf2Function): { selection?: Selection } {
  // Plural rules take one set of options, where a format with steps rounds a number by its size.
  if (fn.named !== undefined && 'steps' in fn.named && fn.named.steps !== undefined) {
    throw new Error(
      `.match on :${fn.name} format=${fn.options.format}, whose steps show a number by its size: match on a :number of the same value declared apart`,
    );
  }
  const pick = <T>(from: Record<string, T>) => Object.fromEntries(Object.entries(from).filter(([k]) => PLURAL_OPTIONS.has(k)));
  const options = pick(intlNumber(fn) as Record<string, unknown>) as Intl.PluralRulesOptions;
  const args = pick(optionArgs(fn).args ?? {});
  const value = fn.name === 'integer' ? 'round' : fn.name === 'percent' ? 'percent' : undefined;
  const plain = Object.keys(options).length === 0 && Object.keys(args).length === 0 && value === undefined;
  // `select=exact` is kept too, so it is written back.
  if (plain && fn.options.select !== 'exact') return {};
  return { selection: { fn, options, ...(Object.keys(args).length > 0 && { args }), ...(value && { value }) } };
}

function checkKey(selector: Selector, key: string | null, name: string): void {
  if (key === null) return;
  if (selector.kind === 'string') {
    // The runtime's select falls back to its `other` arm, so a key named `other` would catch everything.
    if (key === 'other') throw new Error(`.match $${name} has a key "other", which can't be told from *: name it something else`);
    return;
  }
  if (NUMBER_LITERAL.test(key)) {
    if (String(Number(key)) !== key) throw new Error(`.match $${name} has the key ${key}: write it as ${Number(key)}, as values print`);
    return;
  }
  if (selector.kind === 'exact') throw new Error(`.match $${name} selects exactly, so its keys are numbers, not "${key}"`);
  if (!CATEGORIES.has(key))
    throw new Error(`.match $${name} has the key "${key}": a number key is a number or one of ${[...CATEGORIES].join(', ')}`);
}

interface Candidate {
  keys: (string | null)[];
  /** How well each key so far matched: lower is better, as the spec ranks them. */
  prefs: number[];
  value: Element[];
}

/**
 * `.match` as nested plural and select elements. MF2 picks, among the variants whose every key
 * matches, the one whose keys match best, the first selector deciding first; an exact number beats
 * a plural category, which beats `*`. The runtime picks an arm per selector instead, so each arm
 * here holds every variant that can still match a value reaching it, and the leaf takes the best.
 * An exact arm `=1` holds the variants keyed `one` as well, since 1 is also in that category: which
 * category is the locale's, which is why this runs per locale.
 */
function matchTree(selectors: Selector[], candidates: Candidate[], i: number, locale: string): Element[] {
  // Never empty: `validate` requires a variant whose keys are all `*`.
  if (i === selectors.length) return candidates.reduce((a, b) => (compare(b.prefs, a.prefs) < 0 ? b : a)).value;
  const s = selectors[i]!;
  const keys = [...new Set(candidates.map((c) => c.keys[i]).filter((k): k is string => k !== null && k !== undefined))];
  const options: Record<string, PluralOrSelectOption> = {};
  const arm = (name: string, preference: (key: string | null) => number | undefined) => {
    const next = candidates.flatMap((c) => {
      const p = preference(c.keys[i]!);
      return p === undefined ? [] : [{ ...c, prefs: [...c.prefs, p] }];
    });
    options[name] = { value: matchTree(selectors, next, i + 1, locale) };
  };

  if (s.kind === 'string') {
    for (const k of keys) arm(k, (key) => (key === k ? 0 : key === null ? 1 : undefined));
    arm('other', (key) => (key === null ? 1 : undefined));
    return [{ type: TYPE.select, value: s.name, options }];
  }
  const rules = new Intl.PluralRules(locale, { ...s.selection?.options, type: s.kind === 'ordinal' ? 'ordinal' : 'cardinal' });
  for (const k of keys.filter((key) => NUMBER_LITERAL.test(key))) {
    const category = s.kind === 'exact' ? undefined : rules.select(Number(k));
    // The runtime compares the value before its offset; the key is the value after it.
    arm(`=${Number(k) + s.offset}`, (key) => (key === k ? 0 : key === category ? 1 : key === null ? 2 : undefined));
  }
  if (s.kind !== 'exact') {
    // With a key named `other`, an arm for every category, so that the catch-all arm is reached only
    // by values whose category is `other`.
    const categories: string[] = keys.includes('other') ? rules.resolvedOptions().pluralCategories : keys.filter((k) => CATEGORIES.has(k));
    for (const c of categories) arm(c, (key) => (key === c ? 1 : key === null ? 2 : undefined));
  }
  if (!('other' in options)) arm('other', (key) => (key === null ? 2 : undefined));
  const pluralType = s.kind === 'ordinal' ? 'ordinal' : 'cardinal';
  // The arms above hold every category once `*` is written, so the lint learns which were written here.
  const written = keys.filter((k) => CATEGORIES.has(k));
  return [
    {
      type: TYPE.plural,
      value: s.name,
      offset: s.offset,
      pluralType,
      options,
      categories: written,
      ...(s.selection && { selection: s.selection }),
    } as Element,
  ];
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function pattern(parts: Model.Pattern, scope: Scope, r: Reading): Element[] {
  const root: Element[] = [];
  const open: { name: string; children: Element[] }[] = [];
  const push = (el: Element) => {
    const into = open.at(-1)?.children ?? root;
    const last = into.at(-1);
    if (el.type === TYPE.literal && last?.type === TYPE.literal) last.value += el.value;
    else into.push(el);
  };
  for (const part of parts) {
    if (typeof part === 'string') {
      push({ type: TYPE.literal, value: part });
    } else if (part.type === 'expression') {
      push(element(resolve(part, r, scope), r));
    } else if (part.kind === 'close') {
      const top = open.pop();
      if (top?.name !== part.name) {
        throw new Error(
          top
            ? `{/${part.name}} closes {#${top.name}}: close tags in the order they opened`
            : `{/${part.name}} closes nothing: open it with {#${part.name}}`,
        );
      }
      push({ type: TYPE.tag, value: top.name, children: top.children });
    } else {
      const options = Object.keys(part.options ?? {}).filter((k) => k !== 'u:id');
      if (options.length > 0)
        throw new Error(`{#${part.name}} has options (${options.join(', ')}): tags take none here, so give them to its function`);
      if (part.kind === 'open') open.push({ name: part.name, children: [] });
      else push({ type: TYPE.tag, value: part.name, children: [] });
    }
  }
  if (open.length > 0) throw new Error(`{#${open.at(-1)!.name}} is never closed: end it with {/${open.at(-1)!.name}}`);
  return root;
}

function element(value: Value, r: Reading): Element {
  if (value.fn?.name === 'pb:entry') return entryElement(value);
  if (value.kind === 'literal') return { type: TYPE.literal, value: formatLiteral(value, r.locale) };
  const { name, fn, offset } = value;
  const placeholder = placeholderFor(name, fn, r);
  // A value less its offset is what `#` prints inside a plural, so a plural with only `other` prints it.
  if (offset !== 0) {
    const pound = { type: TYPE.pound, placeholder } as Element;
    return { type: TYPE.plural, value: name, offset, pluralType: 'cardinal', options: { other: { value: [pound] } } };
  }
  if (fn === undefined || fn.name === 'string')
    return { type: TYPE.argument, value: name, placeholder, ...(fn?.dir && { dir: fn.dir }) } as Element;
  if (NUMERIC.has(fn.name)) return { type: TYPE.number, value: name, style: numberStyle(fn), placeholder } as Element;
  if (fn.name === 'list' || fn.name === 'duration') {
    const { format, ...options } = fn.options;
    // Written as MF1's style would be, so `listOptions` and `durationOptions` check it as they check MF1's.
    const style = (fn.name === 'list' ? [options.type, options.style] : [options.style]).filter((o) => o !== undefined).join(' ');
    const own: ExtensionElement & { placeholder: Placeholder } = {
      type: fn.name === 'list' ? LIST : DURATION,
      value: name,
      style: style === '' ? null : style,
      // `namedFormat` read the options from `formats.list` or `formats.duration`, by the function's name.
      ...(fn.named !== undefined && { options: fn.named as ExtensionElement['options'], named: format }),
      placeholder,
    };
    return asElement(own);
  }
  return { type: TYPE.date, value: name, style: dateStyle(fn), placeholder } as Element;
}

/** A name used other than said: it is filled in as text, so nothing formats, selects on or reads it. */
const nameIsText = (what: string, name: string) =>
  `${what}, which holds a name (:pb:entry): a name is text the message says where it stands, as {$${name}}`;

/** `{|app.title| :pb:entry form=genitive}`: the entry's key is written in the message, as a literal. */
function entryElement(value: Value): Element {
  if (value.kind !== 'literal')
    throw new Error(`{$${value.name} :pb:entry} names an entry by a variable: write its key in the message, {|app.title| :pb:entry}`);
  const { form } = value.fn!.options;
  if (form !== undefined && !FORM.test(form))
    throw new Error(`:pb:entry form=${form} names a form, which is one arm of the name's select: form=genitive`);
  return asElement({ type: ENTRY, value: value.value, form: form ?? null });
}

/** A literal with a function is the same in every render, so it is formatted now. */
function formatLiteral(value: Extract<Value, { kind: 'literal' }>, locale: string): string {
  const { fn } = value;
  if (fn === undefined || fn.name === 'string') return value.value;
  if (fn.name === 'list' || fn.name === 'duration')
    throw new Error(`|${value.value}| :${fn.name} formats a value the message is given: {$value :${fn.name}}`);
  const [option, arg] = Object.entries(fn.args ?? {})[0] ?? [];
  if (option !== undefined) {
    const why = 'a literal is formatted as the message compiles, so its options are literals too';
    throw new Error(`|${value.value}| :${fn.name} ${option}=$${arg}: ${why}`);
  }
  if (NUMERIC.has(fn.name)) return new Intl.NumberFormat(locale, intlNumber(fn)).format(Number(literalNumber(value.value)));
  const date = new Date(value.value);
  if (Number.isNaN(date.getTime())) throw new Error(`|${value.value}| is not a date: write it as an ISO 8601 date, like 2026-01-05`);
  return new Intl.DateTimeFormat(locale, intlDate(fn)).format(date);
}

export type Mf2NumberSkeleton = NumberSkeleton & { mf2: Mf2Function; args?: OptionArgs };
export type Mf2DateSkeleton = DateTimeSkeleton & { mf2: Mf2Function; args?: OptionArgs };

function numberStyle(fn: Mf2Function): Mf2NumberSkeleton {
  if (fn.named !== undefined) return { ...namedStyle(fn), type: SKELETON_TYPE.number, tokens: [] };
  const parsedOptions = intlNumber(fn) as NumberSkeleton['parsedOptions'];
  return { type: SKELETON_TYPE.number, tokens: [], parsedOptions, mf2: fn, ...optionArgs(fn) };
}

function dateStyle(fn: Mf2Function): Mf2DateSkeleton {
  if (fn.named !== undefined) return { ...namedStyle(fn), type: SKELETON_TYPE.dateTime, pattern: '' };
  return { type: SKELETON_TYPE.dateTime, pattern: '', parsedOptions: intlDate(fn), mf2: fn, ...optionArgs(fn) };
}

/** A named format's style, as MF1's reader makes it, with the function as written. */
function namedStyle(fn: Mf2Function): Pick<NamedStyle, 'named' | 'parsedOptions'> & { mf2: Mf2Function } {
  return { named: fn.options.format!, parsedOptions: fn.named as NamedStyle['parsedOptions'], mf2: fn };
}

/** The function's options given by arguments, as the `Intl` options the runtime merges in. */
function optionArgs(fn: Mf2Function): { args?: OptionArgs } {
  if (fn.args === undefined) return {};
  const args: OptionArgs = {};
  for (const [key, arg] of Object.entries(fn.args))
    for (const intl of FROM_ARGUMENT[key]!.intl) args[intl] = { arg, type: FROM_ARGUMENT[key]!.type };
  return { args };
}

/** The `Intl.NumberFormat` options a numeric function formats with. */
export function intlNumber(fn: Mf2Function): Intl.NumberFormatOptions {
  if (fn.named !== undefined) return fn.named;
  const allowed = OPTIONS[fn.name] ?? [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fn.options)) {
    if (!allowed.includes(key) || key === 'select') continue;
    if (key === 'useGrouping') {
      out.useGrouping = value === 'never' ? false : value;
    } else if (key === 'fractionDigits') {
      if (value !== 'auto') out.minimumFractionDigits = out.maximumFractionDigits = Number(value);
    } else if (DIGITS.includes(key)) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  if (fn.name === 'integer') out.maximumFractionDigits = 0;
  if (fn.name === 'percent' || fn.name === 'currency' || fn.name === 'unit') out.style = fn.name;
  return out;
}

/**
 * The `Intl.DateTimeFormat` options a date or time function formats with. MF2's date and time
 * functions are still a draft; this follows the spec's semantic options as the `messageformat`
 * package does, so a message reads the same in both.
 */
export function intlDate(fn: Mf2Function): Intl.DateTimeFormatOptions {
  if (fn.named !== undefined) return fn.named;
  const o = fn.options;
  const out: Intl.DateTimeFormatOptions = {};
  if (o.calendar !== undefined) out.calendar = o.calendar;
  if (fn.name !== 'date' && o.hour12 !== undefined) out.hour12 = o.hour12 === 'true';
  if (o.timeZone !== undefined) out.timeZone = o.timeZone;
  if (fn.name !== 'time') {
    const fields = new Set((o[fn.name === 'date' ? 'fields' : 'dateFields'] ?? 'year-month-day').split('-'));
    const length = o[fn.name === 'date' ? 'length' : 'dateLength'];
    if (fields.has('year')) out.year = 'numeric';
    if (fields.has('month')) out.month = length === 'long' ? 'long' : length === 'short' ? 'numeric' : 'short';
    if (fields.has('day')) out.day = 'numeric';
    if (fields.has('weekday')) out.weekday = length === 'long' ? 'long' : 'short';
  }
  if (fn.name !== 'date') {
    const precision = o[fn.name === 'time' ? 'precision' : 'timePrecision'];
    out.hour = 'numeric';
    if (precision !== 'hour') out.minute = 'numeric';
    if (precision === 'second') out.second = 'numeric';
    if (o.timeZoneStyle !== undefined) out.timeZoneName = o.timeZoneStyle as 'long' | 'short';
  }
  return out;
}

// Writing MF2 ////////////////////////////////////////////////////////////////////////////////////////

interface Found {
  /** The argument a plural or select reads. */
  arg: string;
  /** The variable `.match` names: the argument, or a local less the offset. */
  variable: string;
  kind: 'plural' | 'ordinal' | 'string';
  offset: number;
  /** MF2 keys, in order of appearance; `*` is implied. */
  keys: string[];
  /** The function it was selected with, read from MF2; a bare `:number` where none is kept. */
  fn?: Mf2Function;
}

/** A message tree as MF2 text. Throws, saying what has no MF2 equivalent, where it can't be written. */
export function toMf2(ast: Element[], locale: string): string {
  const found = selectorsOf(ast);
  if (found.length === 0) {
    const pattern = toPattern(ast, { choice: new Map(), variables: new Map(), numeric: new Set(), locale });
    return stringifyMessage({ type: 'message', declarations: [], pattern });
  }

  const declarations: Model.Declaration[] = [];
  for (const s of found) {
    const fn: Model.FunctionRef =
      s.kind === 'string'
        ? functionRef('string')
        : s.fn !== undefined
          ? written(s.fn)
          : functionRef('number', s.kind === 'ordinal' ? { select: 'ordinal' } : {});
    declarations.push({ type: 'input', name: s.arg, value: { type: 'expression', arg: variable(s.arg), functionRef: fn } });
    if (s.offset !== 0) {
      declarations.push({
        type: 'local',
        name: s.variable,
        value: { type: 'expression', arg: variable(s.arg), functionRef: functionRef('offset', { subtract: String(s.offset) }) },
      });
    }
  }

  // Every combination of keys, `*` last, rendered by picking each plural's and select's arm.
  let combos: (string | null)[][] = [[]];
  for (const s of found) combos = combos.flatMap((c) => [...s.keys, null].map((k) => [...c, k]));
  const variables = new Map(found.map((s) => [s.arg, s.variable]));
  // Under a selector declared with more than a bare `:number`, a placeholder spells out its own.
  const numeric = new Set(found.filter((s) => s.kind !== 'string' && s.fn === undefined).map((s) => s.arg));
  const render = (keys: (string | null)[]) =>
    toPattern(ast, { choice: new Map(found.map((s, i) => [s.arg, keys[i]!])), variables, numeric, locale });
  const variants = combos.map((keys) => ({ keys, pattern: render(keys), text: '' }));
  for (const v of variants) v.text = JSON.stringify(v.pattern);
  const kept = prune(variants, found, locale);

  return stringifyMessage({
    type: 'select',
    declarations,
    selectors: found.map((s) => variable(s.variable)),
    variants: kept.map((v) => ({
      keys: v.keys.map((k): Model.Literal | Model.CatchallKey => (k === null ? { type: '*' } : { type: 'literal', value: k })),
      value: v.pattern,
    })),
  });
}

function selectorsOf(ast: Element[]): Found[] {
  const found = new Map<string, Found>();
  const names = new Set<string>();
  walk(ast, (el) => {
    if ('value' in el && typeof el.value === 'string' && el.type !== TYPE.literal) names.add(el.value);
  });
  walk(ast, (el) => {
    if (el.type !== TYPE.plural && el.type !== TYPE.select) return;
    const kind = el.type === TYPE.select ? 'string' : el.pluralType === 'ordinal' ? 'ordinal' : 'plural';
    const offset = el.type === TYPE.plural ? el.offset : 0;
    let s = found.get(el.value);
    if (s === undefined) {
      checkName(el.value);
      let local = `${el.value}_minus_${offset}`;
      while (names.has(local)) local += '_';
      const fn = selectionOf(el)?.fn;
      s = { arg: el.value, variable: offset === 0 ? el.value : local, kind, offset, keys: [], ...(fn && { fn }) };
      found.set(el.value, s);
    } else if (s.kind !== kind || s.offset !== offset) {
      throw new Error(
        `{${el.value}} is selected on in two ways (${s.kind}, ${kind}${offset !== s.offset ? ', with different offsets' : ''}), which one .match can't say: make them the same`,
      );
    }
    for (const arm of Object.keys(el.options)) {
      if (arm === 'other') continue;
      const key = el.type === TYPE.plural && arm.startsWith('=') ? String(Number(arm.slice(1)) - offset) : arm;
      if (!s.keys.includes(key)) s.keys.push(key);
    }
  });
  return [...found.values()];
}

/**
 * The variants a reader needs: one that renders like the variant it would fall back to is dropped,
 * as long as every combination of values still lands on a variant rendering what it should.
 */
function prune<V extends { keys: (string | null)[]; text: string }>(variants: V[], found: Found[], locale: string): V[] {
  const rules = found.map((s) =>
    s.kind === 'string' ? undefined : new Intl.PluralRules(locale, { type: s.kind === 'ordinal' ? 'ordinal' : 'cardinal' }),
  );
  const preference = (i: number, key: string | null, value: string | null): number | undefined => {
    if (key === null) return 2;
    if (value === null) return undefined;
    if (key === value) return NUMBER_LITERAL.test(key) || rules[i] === undefined ? 0 : 1;
    if (rules[i] !== undefined && NUMBER_LITERAL.test(value) && rules[i].select(Number(value)) === key) return 1;
    return undefined;
  };
  const pick = (kept: V[], values: (string | null)[]) => {
    let best: { v: V; prefs: number[] } | undefined;
    for (const v of kept) {
      const prefs = values.map((value, i) => preference(i, v.keys[i]!, value));
      if (prefs.some((p) => p === undefined)) continue;
      if (best === undefined || compare(prefs as number[], best.prefs) < 0) best = { v, prefs: prefs as number[] };
    }
    return best?.v;
  };
  let kept = [...variants];
  const specificFirst = [...variants].sort((a, b) => b.keys.filter((k) => k !== null).length - a.keys.filter((k) => k !== null).length);
  for (const candidate of specificFirst) {
    if (candidate.keys.every((k) => k === null)) continue;
    const without = kept.filter((v) => v !== candidate);
    if (variants.every((v) => pick(without, v.keys)?.text === v.text)) kept = without;
  }
  return kept;
}

interface Writing {
  /** The key each selected argument takes in the variant being written. */
  choice: Map<string, string | null>;
  /** The variable `.match` names for each selected argument. */
  variables: Map<string, string>;
  /** Arguments declared `.input {$n :number}`, whose plain `{$n}` already formats as a number. */
  numeric: Set<string>;
  locale: string;
}

function toPattern(elements: Element[], w: Writing, pound?: string): Model.Pattern {
  const out: Model.Pattern = [];
  const text = (value: string) => {
    const last = out.at(-1);
    if (typeof last === 'string') out[out.length - 1] = last + value;
    else if (value !== '') out.push(value);
  };
  for (const el of elements) {
    const said = entryOf(el);
    if (said !== undefined) {
      const fn = functionRef('pb:entry', said.form === null ? {} : { form: said.form });
      out.push({ type: 'expression', arg: { type: 'literal', value: said.value }, functionRef: fn });
      continue;
    }
    const own = extensionOf(el);
    if (own !== undefined) {
      checkName(own.value);
      out.push({ type: 'expression', arg: variable(own.value), functionRef: extensionFunction(own) });
      continue;
    }
    switch (el.type) {
      case TYPE.literal:
        text(el.value);
        break;
      case TYPE.argument: {
        checkName(el.value);
        const dir = (el as { dir?: Mf2Function['dir'] }).dir;
        out.push({
          type: 'expression',
          arg: variable(el.value),
          ...(dir && { functionRef: written({ name: 'string', options: {}, dir }) }),
        });
        break;
      }
      case TYPE.number: {
        checkName(el.value);
        const fn = numberFunction(el);
        const declared = w.numeric.has(el.value) && fn.name === 'number' && fn.options === undefined;
        out.push(
          declared ? { type: 'expression', arg: variable(el.value) } : { type: 'expression', arg: variable(el.value), functionRef: fn },
        );
        break;
      }
      case TYPE.date:
      case TYPE.time:
        checkName(el.value);
        out.push({ type: 'expression', arg: variable(el.value), functionRef: dateFunction(el) });
        break;
      case TYPE.pound:
        out.push({ type: 'expression', arg: variable(pound ?? '') });
        break;
      case TYPE.plural:
      case TYPE.select: {
        const arm = armFor(el, w.choice.get(el.value) ?? null, w.locale);
        const own = w.variables.get(el.value) ?? el.value;
        for (const part of toPattern(arm, w, el.type === TYPE.plural ? own : pound)) {
          if (typeof part === 'string') text(part);
          else out.push(part);
        }
        break;
      }
      case TYPE.tag:
        checkName(el.value);
        out.push({ type: 'markup', kind: 'open', name: el.value });
        for (const part of toPattern(el.children, w, pound)) {
          if (typeof part === 'string') text(part);
          else out.push(part);
        }
        out.push({ type: 'markup', kind: 'close', name: el.value });
        break;
    }
  }
  return out;
}

function armFor(el: PluralElement | SelectElement, key: string | null, locale: string): Element[] {
  const other = el.options.other!.value;
  if (key === null) return other;
  if (el.type === TYPE.plural && NUMBER_LITERAL.test(key)) {
    const exact = el.options[`=${Number(key) + el.offset}`];
    if (exact !== undefined) return exact.value;
    const category = new Intl.PluralRules(locale, { type: el.pluralType }).select(Number(key));
    return el.options[category]?.value ?? other;
  }
  return el.options[key]?.value ?? other;
}

function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`"${name}" can't be a MessageFormat 2 name: start it with a letter`);
}

function variable(name: string): Model.VariableRef {
  return { type: 'variable', name };
}

function functionRef(name: string, options: Record<string, string> = {}, args: Record<string, string> = {}): Model.FunctionRef {
  const entries: [string, Model.Literal | Model.VariableRef][] = [
    ...Object.entries(options).map(([k, v]): [string, Model.Literal] => [k, { type: 'literal', value: v }]),
    ...Object.entries(args).map(([k, v]): [string, Model.VariableRef] => [k, variable(v)]),
  ];
  if (entries.length === 0) return { type: 'function', name };
  return { type: 'function', name, options: Object.fromEntries(entries) };
}

function written(fn: Mf2Function): Model.FunctionRef {
  return functionRef(fn.name, { ...fn.options, ...(fn.dir && { 'u:dir': fn.dir }) }, fn.args);
}

/** A list or duration as `:list` or `:duration`, its format by name or its options as written. */
function extensionFunction(el: ExtensionElement): Model.FunctionRef {
  const name = el.type === LIST ? 'list' : 'duration';
  if (el.named !== undefined) return functionRef(name, { format: el.named });
  if (el.type === DURATION) {
    const { style } = durationOptions(el);
    return functionRef(name, style === undefined ? {} : { style });
  }
  const { type, style } = listOptions(el);
  return functionRef(name, { ...(type && { type }), ...(style && { style }) });
}

function numberFunction(el: NumberElement): Model.FunctionRef {
  const style = el.style;
  if (style === null || style === undefined) return functionRef('number');
  if (typeof style === 'string') {
    if (style === 'integer' || style === 'percent') return functionRef(style);
    throw new Error(`{${el.value}, number, ${style}} has no MessageFormat 2 equivalent`);
  }
  if ('mf2' in style) return written((style as Mf2NumberSkeleton).mf2);
  const named = namedOf(el);
  if (named !== undefined) return functionRef('number', { format: named });
  const {
    style: kind,
    currency,
    currencyDisplay,
    currencySign,
    unit,
    unitDisplay,
    ...rest
  } = style.parsedOptions as Record<string, string | number | boolean | undefined>;
  const name = kind === 'percent' || kind === 'currency' || kind === 'unit' ? kind : 'number';
  const options: Record<string, string> = {};
  const own = name === 'currency' ? { currency, currencyDisplay, currencySign } : name === 'unit' ? { unit, unitDisplay } : {};
  for (const [key, value] of Object.entries(own)) if (value !== undefined) options[key] = String(value);
  if (name === 'currency' && rest.minimumFractionDigits !== undefined && rest.minimumFractionDigits === rest.maximumFractionDigits) {
    options.fractionDigits = String(rest.minimumFractionDigits);
    delete rest.minimumFractionDigits;
    delete rest.maximumFractionDigits;
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    if (key === 'useGrouping') options.useGrouping = value === false ? 'never' : String(value);
    else if (OPTIONS[name]!.includes(key) && key !== 'select') options[key] = String(value);
    else throw new Error(`{${el.value}}'s ${key}: ${String(value)} has no MessageFormat 2 equivalent`);
  }
  return functionRef(name, options);
}

/**
 * The MF2 function for a date or time element. MF1's named styles have no exact counterpart, so they
 * map to the nearest; `migrate` renders both and reports any that come out different.
 */
function dateFunction(el: DateElement | TimeElement): Model.FunctionRef {
  const style = el.style;
  if (typeof style === 'object' && style !== null && 'mf2' in style) return written((style as Mf2DateSkeleton).mf2);
  const named = namedOf(el);
  if (named !== undefined) return functionRef('datetime', { format: named });
  if (el.type === TYPE.time && (style === null || style === undefined || typeof style === 'string')) {
    const time: Record<string, Record<string, string>> = {
      short: {},
      medium: { precision: 'second' },
      long: { precision: 'second', timeZoneStyle: 'short' },
      full: { precision: 'second', timeZoneStyle: 'long' },
    };
    return functionRef('time', time[style ?? 'short'] ?? {});
  }
  if (style === null || style === undefined || typeof style === 'string') {
    const date: Record<string, Record<string, string>> = {
      // MF1's default is `Intl`'s: numeric year, month and day.
      default: { length: 'short' },
      short: { length: 'short' },
      medium: {},
      long: { length: 'long' },
      full: { fields: 'year-month-day-weekday', length: 'long' },
    };
    return functionRef('date', date[style ?? 'default'] ?? {});
  }
  const { calendar, timeZone, hour12, ...fields } = style.parsedOptions;
  const overrides: Record<string, string> = {};
  if (calendar !== undefined) overrides.calendar = calendar;
  if (timeZone !== undefined) overrides.timeZone = timeZone;
  if (hour12 !== undefined) overrides.hour12 = String(hour12);
  const wanted = JSON.stringify(sorted(fields));
  for (const candidate of dateCandidates()) {
    const { calendar: _c, timeZone: _t, hour12: _h, ...got } = intlDate(candidate);
    if (JSON.stringify(sorted(got)) === wanted) return functionRef(candidate.name, { ...candidate.options, ...overrides });
  }
  throw new Error(`{${el.value}}'s date skeleton "${style.pattern}" has no MessageFormat 2 equivalent: use a named style`);
}

function sorted(o: object): [string, unknown][] {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
}

function* dateCandidates(): Generator<Mf2Function> {
  const lengths = [undefined, 'long', 'short'];
  const precisions = [undefined, 'hour', 'second'];
  const zones = [undefined, 'long', 'short'];
  const defined = (o: Record<string, string | undefined>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, string>;
  // Defaults first, so the shortest spelling wins.
  const fieldsList = [undefined, ...DATE_FIELDS.filter((f) => f !== 'year-month-day')];
  const dates = fieldsList.flatMap((fields) => lengths.map((length) => ({ fields, length })));
  const times = precisions.flatMap((precision) => zones.map((timeZoneStyle) => ({ precision, timeZoneStyle })));
  for (const d of dates) yield { name: 'date', options: defined(d) };
  for (const t of times) yield { name: 'time', options: defined(t) };
  for (const d of dates) {
    for (const t of times) {
      const options = { dateFields: d.fields, dateLength: d.length, timePrecision: t.precision, timeZoneStyle: t.timeZoneStyle };
      yield { name: 'datetime', options: defined(options) };
    }
  }
}
