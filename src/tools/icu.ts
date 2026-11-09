/**
 * What an ICU message declares, read off its AST: argument types, tags, and whether each number and
 * date style is one the formatter honors. Shared by the loader, the compiler and the lint.
 */
import { isDateElement, isNumberElement, isTimeElement, parse, SKELETON_TYPE, TYPE } from '@formatjs/icu-messageformat-parser';
import type {
  DateElement,
  DateTimeSkeleton,
  MessageFormatElement,
  NumberElement,
  NumberSkeleton,
  TimeElement,
} from '@formatjs/icu-messageformat-parser';

import {
  formatIn,
  type DurationFormatOptions,
  type DurationUnit,
  type Formats,
  type DateFormatOptions,
  type ListFormatOptions,
  type NumberFormatOptions,
  type RelativeFormatOptions,
} from '#src/runtime/formats.ts';

export type { MessageFormatElement };
export { TYPE };

/** An ICU message as the element tree, each style naming one of `formats` read as that format's options in `locale`. */
export function parseMessage(text: string, formats?: Formats, locale = 'en'): MessageFormatElement[] {
  const { stand, found } = standIns(text);
  const ast = withExtensions(parse(stand, { shouldParseSkeletons: true, requiresOtherClause: true }), found, formats, locale);
  walk(ast, (el) => {
    if ((isDateElement(el) || isTimeElement(el)) && typeof el.style === 'object' && el.style !== null && el.style.pattern.includes('j'))
      el.style.parsedOptions = localHour(el.style.pattern);
    if (!isNumberElement(el) && !isDateElement(el) && !isTimeElement(el)) return;
    if (typeof el.style !== 'string') return;
    const style = namedStyle(formats, el.type === TYPE.number ? 'number' : 'date', el.style, locale);
    if (style !== undefined) el.style = style as never;
  });
  return ast;
}

/**
 * prosebook's placeholders beyond ICU's: `{names, list}`, a list of strings joined as the locale
 * joins one, `{took, duration}`, milliseconds in the units the locale writes, and `{at, relative}`, a
 * point in time as how long ago or ahead of now it is. Their type numbers sit past formatjs's, so
 * code that doesn't know them passes them by, and the writers refuse them.
 */
export const LIST = 100;
export const DURATION = 101;
export const RELATIVE = 103;

/** Each of prosebook's placeholders by the word that writes it, `{x, list}`, and the function MF2 names. */
export const EXTENSIONS = { list: LIST, duration: DURATION, relative: RELATIVE } as const;
export type ExtensionKind = keyof typeof EXTENSIONS;

/** A list, duration or relative placeholder. `style` is as written; `options`, where a format is named or MF2 gave them. */
export interface ExtensionElement {
  type: typeof LIST | typeof DURATION | typeof RELATIVE;
  value: string;
  style: string | null;
  options?: ListFormatOptions | DurationFormatOptions | RelativeFormatOptions;
  /** The format of the config's it names. */
  named?: string;
  /** For a list whose format has `more`: that entry's message in the locale read, set as the catalog loads. */
  more?: MessageFormatElement[];
  /** For a relative time whose format has `now`: that entry's message, as `more` is a list's. */
  now?: MessageFormatElement[];
}

/** The element as a list, duration or relative placeholder, or nothing. */
export function extensionOf(el: MessageFormatElement): ExtensionElement | undefined {
  const type = (el as { type: number }).type;
  return type === LIST || type === DURATION || type === RELATIVE ? (el as unknown as ExtensionElement) : undefined;
}

/** The word that writes a placeholder of prosebook's: `list`, `duration` or `relative`. */
export function kindOf(el: ExtensionElement): ExtensionKind {
  return el.type === LIST ? 'list' : el.type === DURATION ? 'duration' : 'relative';
}

/**
 * The options of a format the config names, in `locale`. A relative format's `date` names a date format,
 * read in the same locale, so the compiler and the runtime take its options as they are.
 */
export function extensionFormat(
  formats: Formats | undefined,
  kind: ExtensionKind,
  name: string,
  locale: string,
): ExtensionElement['options'] | undefined {
  const options = formatIn(formats, kind, name, locale);
  if (kind !== 'relative' || options === undefined) return options;
  const { date } = options as RelativeFormatOptions;
  if (typeof date?.format !== 'string') return options;
  return { ...options, date: { ...date, format: formatIn(formats, 'date', date.format, locale) ?? {} } };
}

export const asElement = (el: ExtensionElement | EntryReference) => el as unknown as MessageFormatElement;

/**
 * `{app.title, entry}` (MF2's `{|app.title| :pb:entry}`): another entry's text said here, which only a
 * name may be. Its `form` picks an arm of the name's selects (`{app.title, entry, genitive}`). The
 * catalog sets `text` as it loads, the name in the locale read, so the compiler and every target
 * write it out as text (`inlined`) and nothing reads one key for another as the app runs.
 */
export const ENTRY = 102;

export interface EntryReference {
  type: typeof ENTRY;
  /** The key of the entry said. */
  value: string;
  form: string | null;
  text?: string;
}

export function entryOf(el: MessageFormatElement): EntryReference | undefined {
  return (el as { type: number }).type === ENTRY ? (el as unknown as EntryReference) : undefined;
}

/** An arm's name, which a form is. */
export const FORM = /^\w+$/;

/** The message with each entry it says written as that entry's text, and literals beside each other joined. */
export function inlined(ast: MessageFormatElement[]): MessageFormatElement[] {
  const out: MessageFormatElement[] = [];
  for (const el of ast) {
    const said = entryOf(el);
    const next: MessageFormatElement =
      said !== undefined
        ? { type: TYPE.literal, value: said.text ?? `{${said.value}}` }
        : el.type === TYPE.select || el.type === TYPE.plural
          ? { ...el, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, { ...o, value: inlined(o.value) }])) }
          : el.type === TYPE.tag
            ? { ...el, children: inlined(el.children) }
            : el;
    const last = out.at(-1);
    if (next.type === TYPE.literal && last?.type === TYPE.literal) out[out.length - 1] = { ...last, value: last.value + next.value };
    else out.push(next);
  }
  return out;
}

const EXTENSION = /\{\s*([^\s{},#<>']+)\s*,\s*(list|duration|relative|entry)\s*(?:,\s*([^{}]*?))?\s*\}/y;
const STAND_IN = '__prosebook_';

type StandIn = { name: string; kind: string; style: string | undefined };

/**
 * The message with each list, duration, relative and entry placeholder written as a plain one formatjs reads, which
 * `withExtensions` puts back. Quoted text is passed by, as ICU quotes: an apostrophe before a brace,
 * `#`, `|` or a tag's `<` opens a quote, and `''` is an apostrophe.
 */
function standIns(text: string): { stand: string; found: StandIn[] } {
  const found: StandIn[] = [];
  let stand = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") {
      if (text[i + 1] === "'") {
        stand += "''";
        i++;
        continue;
      }
      if (quoted || /[{}#|<>]/.test(text[i + 1] ?? '')) quoted = !quoted;
      stand += c;
      continue;
    }
    EXTENSION.lastIndex = i;
    const m = c === '{' && !quoted ? EXTENSION.exec(text) : null;
    if (m === null) {
      stand += c;
      continue;
    }
    stand += `{${STAND_IN}${found.length}}`;
    const style = m[3]?.trim();
    found.push({ name: m[1]!, kind: m[2]!, style: style === '' ? undefined : style });
    i += m[0].length - 1;
  }
  return { stand, found };
}

function withExtensions(
  ast: MessageFormatElement[],
  found: StandIn[],
  formats: Formats | undefined,
  locale: string,
): MessageFormatElement[] {
  if (found.length === 0) return ast;
  const put = (elements: MessageFormatElement[]): MessageFormatElement[] =>
    elements.map((el) => {
      if (el.type === TYPE.argument && el.value.startsWith(STAND_IN)) {
        const { name, kind, style } = found[Number(el.value.slice(STAND_IN.length))]!;
        if (kind === 'entry') {
          if (style !== undefined && !FORM.test(style))
            throw new Error(`{${name}, entry, ${style}} names a form, which is one arm of the name's select: {${name}, entry, genitive}`);
          return asElement({ type: ENTRY, value: name, form: style ?? null });
        }
        const options = style === undefined ? undefined : extensionFormat(formats, kind as ExtensionKind, style, locale);
        return asElement({
          type: EXTENSIONS[kind as ExtensionKind],
          value: name,
          style: style ?? null,
          ...(options && { options, named: style }),
        });
      }
      if (el.type === TYPE.select || el.type === TYPE.plural)
        return { ...el, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, { ...o, value: put(o.value) }])) };
      if (el.type === TYPE.tag) return { ...el, children: put(el.children) };
      return el;
    });
  return put(ast);
}

const LIST_WORDS: Record<string, Intl.ListFormatOptions> = {
  conjunction: { type: 'conjunction' },
  disjunction: { type: 'disjunction' },
  unit: { type: 'unit' },
  long: { style: 'long' },
  short: { style: 'short' },
  narrow: { style: 'narrow' },
};
export const DURATION_STYLES = ['long', 'short', 'narrow', 'digital'] as const;
export const DURATION_UNITS: readonly DurationUnit[] = ['days', 'hours', 'minutes', 'seconds', 'milliseconds'];

/** The options a list placeholder joins with. Throws, with the fix, where its style is wrong. */
export function listOptions(el: ExtensionElement): ListFormatOptions {
  if (el.options !== undefined) return el.options as ListFormatOptions;
  if (el.style === null) return {};
  const words = el.style.split(/\s+/);
  if (words.some((w) => LIST_WORDS[w] === undefined)) {
    throw new Error(
      `{${el.value}} asks for list style "${el.style}": ${Object.keys(LIST_WORDS).join(', ')}, or a format formats.list names`,
    );
  }
  return Object.assign({}, ...words.map((w) => LIST_WORDS[w])) as ListFormatOptions;
}

export const RELATIVE_STYLES = ['long', 'short', 'narrow'] as const;

/** The options a relative placeholder formats with. Throws, with the fix, where its style is wrong. */
export function relativeOptions(el: ExtensionElement): RelativeFormatOptions {
  if (el.options !== undefined) return el.options as RelativeFormatOptions;
  if (el.style === null) return {};
  const style = RELATIVE_STYLES.find((s) => s === el.style);
  if (style === undefined) {
    throw new Error(
      `{${el.value}} asks for relative style "${el.style}": ${RELATIVE_STYLES.join(', ')}, or a format formats.relative names`,
    );
  }
  return { style };
}

/** The options a duration placeholder formats with. Throws, with the fix, where its style is wrong. */
export function durationOptions(el: ExtensionElement): DurationFormatOptions {
  if (el.options !== undefined) return el.options as DurationFormatOptions;
  if (el.style === null) return {};
  const style = DURATION_STYLES.find((s) => s === el.style);
  if (style === undefined) {
    throw new Error(
      `{${el.value}} asks for duration style "${el.style}": ${DURATION_STYLES.join(', ')}, or a format formats.duration names`,
    );
  }
  return { style };
}

/**
 * A style the config names (`formats`): its options in the locale, as a skeleton's would be, so the
 * compiler and the native targets read it as any other, and its name, which the writers keep.
 */
/** Whether a named format shows values in a way its `Intl` options alone don't: by steps, or by the app's own formatter. */
export function beyondOptions(options: NumberFormatOptions | DateFormatOptions): boolean {
  return ('steps' in options && options.steps !== undefined) || options.formatter !== undefined;
}

export type NamedStyle = (NumberSkeleton | DateTimeSkeleton) & { named: string };

export function namedStyle(formats: Formats | undefined, kind: 'number' | 'date', name: string, locale: string): NamedStyle | undefined {
  if (kind === 'number') {
    const options = formatIn(formats, 'number', name, locale);
    return options && { type: SKELETON_TYPE.number, tokens: [], parsedOptions: options as NumberSkeleton['parsedOptions'], named: name };
  }
  const options = formatIn(formats, 'date', name, locale);
  return options && { type: SKELETON_TYPE.dateTime, pattern: '', parsedOptions: options, named: name };
}

/** The name of the format a number or date element is shown in, where the config names it. */
export function namedOf(el: MessageFormatElement): string | undefined {
  if (!isNumberElement(el) && !isDateElement(el) && !isTimeElement(el)) return undefined;
  const style = el.style;
  return typeof style === 'object' && style !== null && 'named' in style ? (style as NamedStyle).named : undefined;
}

/**
 * A skeleton's `j` is the hour as the locale writes it, 12 or 24. The parser resolves it only when
 * given a locale and drops it otherwise, so `::yMMMdjmm` showed the minute alone. Read here as an
 * hour with no cycle, which `Intl` gives the cycle of whatever locale formats it: "2:05 PM", "14:05".
 */
function localHour(pattern: string): Intl.DateTimeFormatOptions {
  const run = /j+/.exec(pattern)![0];
  const rest = pattern.replaceAll('j', '');
  return { ...(rest === '' ? {} : dateFields(rest)), hour: run.length % 2 === 0 ? '2-digit' : 'numeric' };
}

/** What the parser reads from a date skeleton on its own; nothing where it can't parse it. */
function dateFields(skeleton: string): Intl.DateTimeFormatOptions {
  try {
    const el = parse(`{d, date, ::${skeleton}}`, { shouldParseSkeletons: true })[0];
    return el !== undefined && isDateElement(el) && typeof el.style === 'object' && el.style !== null ? el.style.parsedOptions : {};
  } catch {
    return {};
  }
}

const OPEN = ' | (string & {})';
/** What a select with a `null` arm also takes: a value that isn't there, which that arm says. */
const NULLISH = ' | null | undefined';

export const isNullish = (type: string) => type.endsWith(NULLISH);
const baseOf = (type: string) => (isNullish(type) ? type.slice(0, -NULLISH.length) : type);
const withNullish = (base: string, nullish: boolean) => (nullish ? `${base}${NULLISH}` : base);

/** A type that takes any string: a bare placeholder's, or a select's, which `other` keeps open. */
export const takesText = (type: string) => baseOf(type) === 'string' || baseOf(type).endsWith(OPEN);

/** The arms a select's type names, `dark` and `light` in `"dark" | "light" | (string & {})`. */
export const armsOf = (type: string): string[] =>
  baseOf(type).endsWith(OPEN)
    ? baseOf(type)
        .slice(0, -OPEN.length)
        .split(' | ')
        .map((arm) => JSON.parse(arm) as string)
    : [];

/** A select's type taking only the arms it names, for an argument the entry says is `closed`. */
export const closedType = (type: string) => withNullish(baseOf(type).slice(0, -OPEN.length), isNullish(type));

/** A closed select's type open again, as its message alone types it. */
export const openType = (type: string) => withNullish(`${baseOf(type)}${OPEN}`, isNullish(type));

/**
 * ICU argument types, as TypeScript. A bare `{x}` is a string: a number spliced in raw is printed by
 * `String()`, which knows no locale, so a quantity says `{x, number}` and the type is what asks for it.
 * A `select` narrows to the arms it names, and still takes any string, since `other` catches the rest;
 * one whose arms are `true` and `false` takes a boolean.
 */
/** An item of a list placeholder: `ListItem`, written out, as the generated types import nothing for it. */
const LIST_ITEM = '(string | number | null | undefined | false)';

function argType(el: MessageFormatElement): string | undefined {
  const own = extensionOf(el);
  if (own !== undefined) return own.type === LIST ? `readonly ${LIST_ITEM}[]` : own.type === RELATIVE ? 'Date | number | string' : 'number';
  switch (el.type) {
    case TYPE.argument:
      return 'string';
    case TYPE.number:
    case TYPE.plural:
      return 'number';
    case TYPE.date:
    case TYPE.time:
      return 'Date | number';
    case TYPE.select: {
      // A `null` arm says what an absent value shows: `{role, select, null {} other {, as {role}}}`.
      const nullish = 'null' in el.options;
      const named = Object.keys(el.options).filter((o) => o !== 'other' && o !== 'null');
      // `{on, select, true {On} other {Off}}` selects on a boolean, which the runtime reads as its text.
      if (named.length > 0 && named.every((o) => o === 'true' || o === 'false')) return withNullish('boolean', nullish);
      return withNullish(named.length > 0 ? `${named.map((o) => JSON.stringify(o)).join(' | ')}${OPEN}` : 'string', nullish);
    }
    case TYPE.literal:
    case TYPE.pound:
    case TYPE.tag:
    default:
      return undefined;
  }
}

/**
 * Formatting options read from arguments as the message renders, by `Intl` option: MF2's
 * `{$price :currency currency=$code}`. MF1 has no way to say this, so only a tree read from MF2 has them.
 */
export type OptionArgs = Record<string, { arg: string; type: string }>;

export function optionArgsOf(el: MessageFormatElement): OptionArgs | undefined {
  if (el.type === TYPE.plural) return selectionOf(el)?.args;
  if (!isNumberElement(el) && !isDateElement(el) && !isTimeElement(el)) return undefined;
  const style = el.style;
  return typeof style === 'object' && style !== null && 'args' in style ? (style as { args: OptionArgs }).args : undefined;
}

/**
 * How an MF2 `.match` selects on a number, beyond its plural type: on the number as formatted, so
 * the selector's digit options (`Intl.PluralRules` takes the same ones, some from arguments) decide
 * the category, and on the value `:integer` rounds or `:percent` multiplies by 100. Kept with the
 * selector's function as written, to write it back. MF1 selects on the bare value.
 */
export interface Selection {
  fn: { name: string; options: Record<string, string>; args?: Record<string, string> };
  options: Intl.PluralRulesOptions;
  args?: OptionArgs;
  value?: 'round' | 'percent';
}

export function selectionOf(el: MessageFormatElement): Selection | undefined {
  return el.type === TYPE.plural ? (el as { selection?: Selection }).selection : undefined;
}

/**
 * The plural categories a plural's arms name as written. MF2's `.match` is read into an arm per
 * category once `*` is written, so its tree carries the keys written; an MF1 plural's arms are its own.
 */
export function categoriesOf(el: MessageFormatElement): string[] {
  if (el.type !== TYPE.plural) return [];
  return (el as { categories?: string[] }).categories ?? Object.keys(el.options).filter((arm) => !arm.startsWith('='));
}

/**
 * How a placeholder renders around its value: the text it shows when it has none, or one `Intl`
 * can't format, and the marks isolating its direction from the text around it. MF2 sets these
 * (`{$name}`, and isolation in a right-to-left locale); an MF1 placeholder shows `{name}`.
 */
export interface Placeholder {
  fallback: string;
  isolate?: readonly [open: string, close: string];
}

export function placeholderOf(el: MessageFormatElement, name: string): Placeholder {
  return (el as { placeholder?: Placeholder }).placeholder ?? { fallback: `{${name}}` };
}

/** Calls `visit` on every element, inside plural and select arms and tags too. */
export function walk(elements: MessageFormatElement[], visit: (el: MessageFormatElement) => void): void {
  for (const el of elements) {
    visit(el);
    if (el.type === TYPE.select || el.type === TYPE.plural) for (const option of Object.values(el.options)) walk(option.value, visit);
    if (el.type === TYPE.tag) walk(el.children, visit);
  }
}

/**
 * The type of an argument used twice in one message, or nothing where the uses can't agree. Text
 * meets text: `{tool, select, shell {Shell} other {{tool}}}` prints the name it didn't match, and two
 * selects on one argument take the arms of both.
 */
function unionOf(a: string, b: string): string | undefined {
  if (a === b) return a;
  // The `null` arm of one use makes the argument optional for all of them.
  const nullish = isNullish(a) || isNullish(b);
  const [x, y] = [baseOf(a), baseOf(b)];
  if (x === y) return withNullish(x, nullish);
  if (!takesText(x) || !takesText(y)) return undefined;
  const arms = [...new Set([x, y].flatMap((t) => (t === 'string' ? [] : t.slice(0, -OPEN.length).split(' | '))))];
  return withNullish(arms.length === 0 ? 'string' : `${arms.join(' | ')}${OPEN}`, nullish);
}

export function argsOf(elements: MessageFormatElement[], clash: (name: string) => void = () => {}): Map<string, string> {
  const args = new Map<string, string>();
  const add = (name: string, type: string) => {
    const seen = args.get(name);
    const union = seen === undefined ? type : unionOf(seen, type);
    if (union === undefined) clash(name);
    else args.set(name, union);
  };
  walk(elements, (el) => {
    for (const { arg, type } of Object.values(optionArgsOf(el) ?? {})) add(arg, type);
    const type = argType(el);
    if (type !== undefined && 'value' in el && typeof el.value === 'string') add(el.value, type);
  });
  return args;
}

export function tagsOf(elements: MessageFormatElement[]): string[] {
  const tags = new Set<string>();
  walk(elements, (el) => {
    if (el.type === TYPE.tag) tags.add(el.value);
  });
  return [...tags].sort();
}

/** A message with no placeholders and no tags renders to one literal, which ships as a plain string. */
export function staticLiteral(ast: MessageFormatElement[]): string | undefined {
  if (ast.length === 0) return '';
  if (ast.length === 1 && ast[0]!.type === TYPE.literal) return ast[0]!.value;
  return undefined;
}

const NUMBER_STYLES: Record<string, Intl.NumberFormatOptions> = {
  integer: { maximumFractionDigits: 0 },
  percent: { style: 'percent' },
};

const DATE_STYLES = ['short', 'medium', 'long', 'full'] as const;

/** The `Intl` options a number element formats with. Throws, with the fix, where the style is wrong. */
export function numberOptions(el: NumberElement): NumberFormatOptions | undefined {
  const style = el.style;
  if (style === null || style === undefined) return undefined;
  if (typeof style === 'string') {
    if (style === 'currency') throw new Error(`{${el.value}} needs its currency named: {${el.value}, number, ::currency/EUR}`);
    const named = NUMBER_STYLES[style];
    if (named === undefined)
      throw new Error(`{${el.value}} asks for number style "${style}": integer, percent, a ::skeleton, or a format formats.number names`);
    return named;
  }
  // The config checked a named format's options as it loaded.
  if (namedOf(el) !== undefined) return style.parsedOptions;
  const unknown = style.tokens.filter((t) => !stemIsKnown(t.stem, t.options)).map((t) => t.stem);
  if (unknown.length > 0) throw new Error(`{${el.value}} has skeleton stems the formatter drops without a word: ${unknown.join(', ')}`);
  const options = style.parsedOptions as Intl.NumberFormatOptions;
  // An option an argument gives is checked with a stand-in: `Intl` refuses a currency style without
  // its currency. Whether the argument's value suits it is known only as the message renders.
  const args = optionArgsOf(el) ?? {};
  const given = { ...(args.currency && { currency: 'EUR' }), ...(args.unit && { unit: 'meter' }) };
  try {
    new Intl.NumberFormat('en', { ...options, ...given }).resolvedOptions();
  } catch (e) {
    throw new Error(`{${el.value}} has a skeleton Intl refuses: ${(e as Error).message}`, { cause: e });
  }
  return options;
}

/** The `Intl` options a date or time element formats with. Throws, with the fix, where the style is wrong. */
export function dateOptions(el: DateElement | TimeElement): DateFormatOptions | undefined {
  const style = el.style;
  const field = el.type === TYPE.time ? 'timeStyle' : 'dateStyle';
  if (style === null || style === undefined) return el.type === TYPE.time ? { timeStyle: 'short' } : undefined;
  if (typeof style === 'string') {
    if (!(DATE_STYLES as readonly string[]).includes(style)) {
      const kind = el.type === TYPE.time ? 'time' : 'date';
      throw new Error(
        `{${el.value}} asks for ${kind} style "${style}": ${DATE_STYLES.join(', ')}, a ::skeleton, or a format formats.date names`,
      );
    }
    return { [field]: style };
  }
  if (namedOf(el) !== undefined) return style.parsedOptions;
  // Every field the parser understands sets an option, and one it doesn't is dropped without a word.
  const dropped = (style.pattern.match(/([A-Za-z])*/g) ?? []).filter((f) => !f.startsWith('j') && Object.keys(dateFields(f)).length === 0);
  if (dropped.length > 0) throw new Error(`{${el.value}} has date fields the formatter drops without a word: ${dropped.join(', ')}`);
  if (Object.keys(style.parsedOptions).length === 0)
    throw new Error(`{${el.value}} has a date skeleton the formatter reads nothing from: "${style.pattern}"`);
  try {
    new Intl.DateTimeFormat('en', style.parsedOptions).resolvedOptions();
  } catch (e) {
    throw new Error(`{${el.value}} has a skeleton Intl refuses: ${(e as Error).message}`, { cause: e });
  }
  return style.parsedOptions;
}

/**
 * Whether the formatter understands a skeleton stem. One it does not is dropped without a word, so
 * `::compact-shortt` reaches the screen as `5` where `5K` was written. Every stem it understands sets
 * at least one option, so an empty result is the answer.
 */
function stemIsKnown(stem: string, options: readonly string[]): boolean {
  try {
    const el = parse(`{n, number, ::${[stem, ...options].join('/')}}`, { shouldParseSkeletons: true })[0];
    if (el === undefined || !isNumberElement(el) || typeof el.style !== 'object' || el.style === null) return false;
    return Object.keys(el.style.parsedOptions).length > 0;
  } catch {
    return false;
  }
}

/**
 * What a number or date element's formatter resolves to in a locale, or one built with `options` in
 * its place: two that resolve alike show every value alike. Nothing where `Intl` refuses it.
 */
export function shownAs(el: NumberElement | DateElement | TimeElement, locale: string, options?: object): string | undefined {
  try {
    if (el.type === TYPE.number) return JSON.stringify(new Intl.NumberFormat(locale, options ?? numberOptions(el)).resolvedOptions());
    return JSON.stringify(new Intl.DateTimeFormat(locale, options ?? dateOptions(el)).resolvedOptions());
  } catch {
    return undefined;
  }
}

/** Every format problem in a message, as sentences. */
export function formatProblems(ast: MessageFormatElement[]): string[] {
  const found: string[] = [];
  walk(ast, (el) => {
    try {
      if (isNumberElement(el)) numberOptions(el);
      if (isDateElement(el) || isTimeElement(el)) dateOptions(el);
      const own = extensionOf(el);
      if (own?.type === LIST) listOptions(own);
      if (own?.type === DURATION) durationOptions(own);
      if (own?.type === RELATIVE) relativeOptions(own);
    } catch (e) {
      found.push((e as Error).message);
    }
  });
  return found;
}

/** How each number or date argument is formatted, for the generated doc comment: `date medium, time short`. */
export function formatsOf(ast: MessageFormatElement[]): Map<string, string> {
  const formats = new Map<string, string[]>();
  const add = (name: string, said: string) => {
    const list = formats.get(name) ?? [];
    if (!list.includes(said)) list.push(said);
    formats.set(name, list);
  };
  walk(ast, (el) => {
    const own = extensionOf(el);
    if (own !== undefined) {
      const kind = kindOf(own);
      const style = own.named ?? own.style;
      add(own.value, style === null ? kind : `${kind} \`${style}\``);
      return;
    }
    if (!isNumberElement(el) && !isDateElement(el) && !isTimeElement(el)) return;
    const style = el.style;
    if (style === null || style === undefined) return;
    const kind = el.type === TYPE.number ? 'number' : el.type === TYPE.date ? 'date' : 'time';
    let said: string;
    const named = namedOf(el);
    if (typeof style === 'string') {
      said = `${kind} \`${style}\``;
    } else if (named !== undefined) {
      said = `${kind} \`${named}\``;
    } else if ('mf2' in style) {
      // Read from MF2: the function as written.
      const {
        name,
        options,
        args = {},
      } = (style as { mf2: { name: string; options: Record<string, string>; args?: Record<string, string> } }).mf2;
      const written = [...Object.entries(options), ...Object.entries(args).map(([k, v]) => [k, `$${v}`])];
      said = `\`${[`:${name}`, ...written.map(([k, v]) => `${k}=${v}`)].join(' ')}\``;
    } else if ('tokens' in style) {
      said = `${kind} \`::${style.tokens.map((t) => [t.stem, ...t.options].join('/')).join(' ')}\``;
    } else {
      said = `${kind} \`::${style.pattern}\``;
    }
    add(el.value, said);
  });
  return new Map([...formats].map(([name, list]) => [name, list.join(', ')]));
}
