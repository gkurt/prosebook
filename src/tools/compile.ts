/**
 * Compiles ICU ASTs to JavaScript.
 *
 * A message with no placeholders becomes its string. Any other becomes `(a, h) => …`, where `a` holds
 * the arguments and `h` the locale's helpers (see `runtime/helpers.ts`): a plural is a call picking an
 * arm, a number is a call to a cached `Intl.NumberFormat`. A placeholder without a value, or with one
 * `Intl` refuses, shows as `{name}` and is reported (`h.e`) rather than throwing, so every such
 * message uses `h`. Formatting options are resolved here and
 * hoisted to module constants, so a skeleton costs nothing at runtime and its formatter is built once.
 * Options an argument gives (MF2's `currency=$code`) follow them as an object built per call, and the
 * runtime keeps a formatter per value.
 */
import { isDateElement, isNumberElement, isTimeElement } from '@formatjs/icu-messageformat-parser';

import {
  dateOptions,
  DURATION,
  durationOptions,
  extensionOf,
  inlined,
  LIST,
  listOptions,
  numberOptions,
  optionArgsOf,
  RELATIVE,
  relativeOptions,
  placeholderOf,
  selectionOf,
  staticLiteral,
  TYPE,
  type MessageFormatElement,
  type OptionArgs,
} from './icu.ts';

export type Entry = readonly [key: string, ast: MessageFormatElement[]];

/** Module-level constants for formatting options, one per distinct object. */
class Hoisted {
  private readonly byJson = new Map<string, string>();

  /** `, oN` naming the hoisted options, or nothing when there are none. */
  arg(options: object | undefined): string {
    // `{}` (a bare `:number`) formats as no options do, so it needs no constant.
    if (options === undefined || Object.keys(options).length === 0) return '';
    const json = JSON.stringify(options);
    let name = this.byJson.get(json);
    if (name === undefined) this.byJson.set(json, (name = `o${this.byJson.size}`));
    return `, ${name}`;
  }

  declarations(): string[] {
    return [...this.byJson].map(([json, name]) => `const ${name} = ${json};`);
  }
}

function access(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `a.${name}` : `a[${JSON.stringify(name)}]`;
}

/** The plural a `#` prints the value of. */
type Pound = { name: string; offset: number } | null;

function nodes(elements: MessageFormatElement[], hoisted: Hoisted, pound: Pound): string {
  if (elements.length === 0) return '""';
  const parts = elements.map((el) => node(el, hoisted, pound));
  return parts.length === 1 ? parts[0]! : `[${parts.join(', ')}]`;
}

function arms(options: Record<string, { value: MessageFormatElement[] }>, hoisted: Hoisted, pound: Pound): string {
  const body = Object.entries(options).map(([arm, option]) => `${JSON.stringify(arm)}: () => ${nodes(option.value, hoisted, pound)}`);
  return `{ ${body.join(', ')} }`;
}

/** The hoisted options, then the options arguments give as `{ currency: a.code }`, where there are any. */
function formatting(options: object | undefined, args: OptionArgs | undefined, hoisted: Hoisted): string {
  const given = Object.entries(args ?? {});
  const fixed = hoisted.arg(options);
  if (given.length === 0) return fixed;
  return `${fixed || ', undefined'}, { ${given.map(([option, { arg }]) => `${option}: ${access(arg)}`).join(', ')} }`;
}

/** A string literal, its invisible direction marks escaped so the generated code shows them. */
function text(value: string): string {
  return JSON.stringify(value).replace(/[\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

/**
 * A placeholder's value, or its fallback (`{name}`, reported through `h.e`) where it has none or
 * `Intl` refuses it, between the marks isolating its direction where it has them.
 */
function placed(el: MessageFormatElement, name: string, value: string): string {
  const { fallback, isolate } = placeholderOf(el, name);
  const shown = `${value} ?? h.e(${text(fallback)})`;
  return isolate === undefined ? shown : `[${text(isolate[0])}, ${shown}, ${text(isolate[1])}]`;
}

function node(el: MessageFormatElement, hoisted: Hoisted, pound: Pound): string {
  const formatted = (helper: string, name: string, options: object | undefined) =>
    placed(el, name, `h.${helper}(${access(name)}${formatting(options, optionArgsOf(el), hoisted)})`);
  if (isNumberElement(el)) return formatted('n', el.value, numberOptions(el));
  if (isDateElement(el) || isTimeElement(el)) return formatted('d', el.value, dateOptions(el));
  const own = extensionOf(el);
  if (own?.type === DURATION) return formatted('u', own.value, durationOptions(own));
  if (own?.type === RELATIVE) {
    // A time under the smallest unit is said by the entry the format's `now` names, compiled in here.
    const { now: _, ...options } = relativeOptions(own);
    const said = own.now === undefined ? undefined : message(own.now, hoisted);
    const now = said === undefined ? '' : `, (tense) => ${said.startsWith('(') ? `(${said})({ tense }, h)` : said}`;
    return placed(el, own.value, `h.r(${access(own.value)}${hoisted.arg(options) || (now && ', undefined')}${now})`);
  }
  if (own?.type === LIST) {
    // The rest of a list past its format's `max` is said by the entry its `more` names, compiled in here.
    const said = own.more === undefined ? undefined : message(own.more, hoisted);
    const more = said === undefined ? '' : `, (count) => ${said.startsWith('(') ? `(${said})({ count }, h)` : said}`;
    return placed(el, own.value, `h.l(${access(own.value)}${hoisted.arg(listOptions(own)) || (more && ', undefined')}${more})`);
  }
  switch (el.type) {
    case TYPE.literal:
      return JSON.stringify(el.value);
    case TYPE.argument:
      return placed(el, el.value, access(el.value));
    case TYPE.pound:
      // `#` is its plural's own value less its offset, formatted as a number.
      if (pound === null) return '"#"';
      return placed(el, pound.name, `h.n(${access(pound.name)}${pound.offset !== 0 ? ` - ${pound.offset}` : ''})`);
    case TYPE.select:
      return `h.s(${access(el.value)}, ${arms(el.options, hoisted, pound)})`;
    case TYPE.plural: {
      // Read from MF2, a plural selects on the number as formatted, and on what `:integer` and `:percent` make of it.
      const selection = selectionOf(el);
      const value = access(el.value);
      const on = selection?.value === 'round' ? `Math.round(${value})` : selection?.value === 'percent' ? `${value} * 100` : value;
      const rules = selection === undefined ? '' : formatting(selection.options, selection.args, hoisted);
      const own = { name: el.value, offset: el.offset };
      return `h.p(${on}, ${el.offset}, ${el.pluralType === 'ordinal'}, ${arms(el.options, hoisted, own)}${rules})`;
    }
    case TYPE.tag:
      return `h.t(a, ${JSON.stringify(el.value)}, ${nodes(el.children, hoisted, pound)})`;
    default:
      throw new Error(`prosebook: no compiler for ICU element type ${(el as MessageFormatElement).type}`);
  }
}

function message(written: MessageFormatElement[], hoisted: Hoisted): string {
  // An entry said in the message is its text, so one saying only names and words is still a string.
  const ast = inlined(written);
  const literal = staticLiteral(ast);
  if (literal !== undefined) return JSON.stringify(literal);
  return `(a, h) => ${nodes(ast, hoisted, null)}`;
}

export interface CompiledLocale {
  /** `const oN = {…};` lines the messages refer to. */
  declarations: string[];
  /** `"key": message,` lines. */
  rows: string[];
}

/** One locale's messages as code, keeping only `keep` when given. */
export function compileLocale(entries: Iterable<Entry>, keep?: (key: string) => boolean): CompiledLocale {
  const hoisted = new Hoisted();
  const rows: string[] = [];
  for (const [key, ast] of entries) {
    if (keep && !keep(key)) continue;
    rows.push(`  ${JSON.stringify(key)}: ${message(ast, hoisted)},`);
  }
  return { declarations: hoisted.declarations(), rows };
}

/**
 * A statement a formatter leaves as written. oxfmt, Prettier and `bun fmt` have no comment that skips
 * a whole JavaScript file, only one that skips the statement after it, so a generated module puts one
 * before each of its own.
 */
export const verbatim = (statement: string) => `// prettier-ignore\n${statement}`;

/** The locale as an ES module whose default export is its messages. */
export function localeModule(compiled: CompiledLocale, banner: string, ts: boolean): string {
  const head = ts ? `${banner}\n${verbatim("import type { CompiledMessages } from 'prosebook';")}\n` : `${banner}\n`;
  // `as const` keeps `style: "currency"` a literal, which is what `Intl`'s option types ask for.
  const declarations = ts ? compiled.declarations.map((d) => d.replace(/;$/, ' as const;')) : compiled.declarations;
  const consts = declarations.length > 0 ? `\n${declarations.map(verbatim).join('\n')}\n` : '';
  const close = ts ? '} satisfies CompiledMessages;' : '};';
  return `${head}${consts}\n${verbatim(`export default {\n${compiled.rows.join('\n')}\n${close}`)}\n`;
}

/** The locale as one expression, for a bundler to inline in place of the module. */
export function localeExpression(compiled: CompiledLocale): string {
  return `(() => {\n${compiled.declarations.join('\n')}\nreturn {\n${compiled.rows.join('\n')}\n};\n})()`;
}
