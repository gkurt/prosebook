/**
 * What an ICU message declares, read off its AST: argument types, tags, and whether each number and
 * date style is one the formatter honors. Shared by the loader, the compiler and the lint.
 */
import { isDateElement, isNumberElement, isTimeElement, parse, TYPE } from '@formatjs/icu-messageformat-parser';
import type { DateElement, MessageFormatElement, NumberElement, TimeElement } from '@formatjs/icu-messageformat-parser';

export type { MessageFormatElement };
export { TYPE };

export function parseMessage(text: string): MessageFormatElement[] {
  return parse(text, { shouldParseSkeletons: true, requiresOtherClause: true });
}

/**
 * ICU argument types, as TypeScript. A bare `{x}` is a string: a number spliced in raw is printed by
 * `String()`, which knows no locale, so a quantity says `{x, number}` and the type is what asks for it.
 * A `select` narrows to the arms it names, and still takes any string, since `other` catches the rest.
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
      return named.length > 0 ? `${named.map((o) => JSON.stringify(o)).join(' | ')} | (string & {})` : 'string';
    }
    case TYPE.literal:
    case TYPE.pound:
    case TYPE.tag:
    default:
      return undefined;
  }
}

/** Calls `visit` on every element, inside plural and select arms and tags too. */
export function walk(elements: MessageFormatElement[], visit: (el: MessageFormatElement) => void): void {
  for (const el of elements) {
    visit(el);
    if (el.type === TYPE.select || el.type === TYPE.plural) for (const option of Object.values(el.options)) walk(option.value, visit);
    if (el.type === TYPE.tag) walk(el.children, visit);
  }
}

export function argsOf(elements: MessageFormatElement[], clash: (name: string) => void = () => {}): Map<string, string> {
  const args = new Map<string, string>();
  walk(elements, (el) => {
    const type = argType(el);
    if (type === undefined || !('value' in el) || typeof el.value !== 'string') return;
    const seen = args.get(el.value);
    if (seen !== undefined && seen !== type) clash(el.value);
    else args.set(el.value, type);
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
  try {
    new Intl.NumberFormat('en', options).resolvedOptions();
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
    const said =
      typeof style === 'string'
        ? style
        : 'tokens' in style
          ? `::${style.tokens.map((t) => [t.stem, ...t.options].join('/')).join(' ')}`
          : `::${style.pattern}`;
    const list = formats.get(el.value) ?? [];
    if (!list.includes(`${kind} \`${said}\``)) list.push(`${kind} \`${said}\``);
    formats.set(el.value, list);
  });
  return new Map([...formats].map(([name, list]) => [name, list.join(', ')]));
}
