/**
 * What an ICU message declares, read off its AST: argument types, tags, and whether each number and
 * date style is one the formatter honors. Shared by the loader, the compiler and the lint.
 */
import { isDateElement, isNumberElement, isTimeElement, parse, TYPE } from '@formatjs/icu-messageformat-parser';
import type { DateElement, MessageFormatElement, NumberElement, TimeElement } from '@formatjs/icu-messageformat-parser';

export type { MessageFormatElement };
export { TYPE };

export function parseMessage(text: string): MessageFormatElement[] {
  const ast = parse(text, { shouldParseSkeletons: true, requiresOtherClause: true });
  walk(ast, (el) => {
    if ((isDateElement(el) || isTimeElement(el)) && typeof el.style === 'object' && el.style !== null && el.style.pattern.includes('j'))
      el.style.parsedOptions = localHour(el.style.pattern);
  });
  return ast;
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

/** A type that takes any string: a bare placeholder's, or a select's, which `other` keeps open. */
export const takesText = (type: string) => type === 'string' || type.endsWith(OPEN);

/** The arms a select's type names, `dark` and `light` in `"dark" | "light" | (string & {})`. */
export const armsOf = (type: string): string[] =>
  type.endsWith(OPEN)
    ? type
        .slice(0, -OPEN.length)
        .split(' | ')
        .map((arm) => JSON.parse(arm) as string)
    : [];

/** A select's type taking only the arms it names, for an argument the entry says is `closed`. */
export const closedType = (type: string) => type.slice(0, -OPEN.length);

/**
 * ICU argument types, as TypeScript. A bare `{x}` is a string: a number spliced in raw is printed by
 * `String()`, which knows no locale, so a quantity says `{x, number}` and the type is what asks for it.
 * A `select` narrows to the arms it names, and still takes any string, since `other` catches the rest;
 * one whose arms are `true` and `false` takes a boolean.
 */
function argType(el: MessageFormatElement): string | undefined {
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
      const named = Object.keys(el.options).filter((o) => o !== 'other');
      // `{on, select, true {On} other {Off}}` selects on a boolean, which the runtime reads as its text.
      if (named.length > 0 && named.every((o) => o === 'true' || o === 'false')) return 'boolean';
      return named.length > 0 ? `${named.map((o) => JSON.stringify(o)).join(' | ')}${OPEN}` : 'string';
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
  if (!takesText(a) || !takesText(b)) return undefined;
  const arms = [...new Set([a, b].flatMap((t) => (t === 'string' ? [] : t.slice(0, -OPEN.length).split(' | '))))];
  return arms.length === 0 ? 'string' : `${arms.join(' | ')}${OPEN}`;
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
export function numberOptions(el: NumberElement): Intl.NumberFormatOptions | undefined {
  const style = el.style;
  if (style === null || style === undefined) return undefined;
  if (typeof style === 'string') {
    if (style === 'currency') throw new Error(`{${el.value}} needs its currency named: {${el.value}, number, ::currency/EUR}`);
    const named = NUMBER_STYLES[style];
    if (named === undefined) throw new Error(`{${el.value}} asks for number style "${style}": integer, percent, or a ::skeleton`);
    return named;
  }
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
export function dateOptions(el: DateElement | TimeElement): Intl.DateTimeFormatOptions | undefined {
  const style = el.style;
  const field = el.type === TYPE.time ? 'timeStyle' : 'dateStyle';
  if (style === null || style === undefined) return el.type === TYPE.time ? { timeStyle: 'short' } : undefined;
  if (typeof style === 'string') {
    if (!(DATE_STYLES as readonly string[]).includes(style)) {
      const kind = el.type === TYPE.time ? 'time' : 'date';
      throw new Error(`{${el.value}} asks for ${kind} style "${style}": ${DATE_STYLES.join(', ')}, or a ::skeleton`);
    }
    return { [field]: style };
  }
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

/** Every format problem in a message, as sentences. */
export function formatProblems(ast: MessageFormatElement[]): string[] {
  const found: string[] = [];
  walk(ast, (el) => {
    try {
      if (isNumberElement(el)) numberOptions(el);
      if (isDateElement(el) || isTimeElement(el)) dateOptions(el);
    } catch (e) {
      found.push((e as Error).message);
    }
  });
  return found;
}

/** How each number or date argument is formatted, for the generated doc comment: `date medium, time short`. */
export function formatsOf(ast: MessageFormatElement[]): Map<string, string> {
  const formats = new Map<string, string[]>();
  walk(ast, (el) => {
    if (!isNumberElement(el) && !isDateElement(el) && !isTimeElement(el)) return;
    const style = el.style;
    if (style === null || style === undefined) return;
    const kind = el.type === TYPE.number ? 'number' : el.type === TYPE.date ? 'date' : 'time';
    let said: string;
    if (typeof style === 'string') {
      said = `${kind} \`${style}\``;
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
    const list = formats.get(el.value) ?? [];
    if (!list.includes(said)) list.push(said);
    formats.set(el.value, list);
  });
  return new Map([...formats].map(([name, list]) => [name, list.join(', ')]));
}
