/**
 * Compiles ICU ASTs to JavaScript.
 *
 * A message with no placeholders becomes its string. Any other becomes `(a, h) => …`, where `a` holds
 * the arguments and `h` the locale's helpers (see `runtime/helpers.ts`): a plural is a call picking an
 * arm, a number is a call to a cached `Intl.NumberFormat`. Formatting options are resolved here and
 * hoisted to module constants, so a skeleton costs nothing at runtime and its formatter is built once.
 */
import { isDateElement, isNumberElement, isTimeElement } from '@formatjs/icu-messageformat-parser';

import { dateOptions, numberOptions, staticLiteral, TYPE, type MessageFormatElement } from './icu.ts';

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

function nodes(elements: MessageFormatElement[], hoisted: Hoisted, pound: string | null): string {
  if (elements.length === 0) return '""';
  const parts = elements.map((el) => node(el, hoisted, pound));
  return parts.length === 1 ? parts[0]! : `[${parts.join(', ')}]`;
}

function arms(options: Record<string, { value: MessageFormatElement[] }>, hoisted: Hoisted, pound: string | null): string {
  const body = Object.entries(options).map(([arm, option]) => `${JSON.stringify(arm)}: () => ${nodes(option.value, hoisted, pound)}`);
  return `{ ${body.join(', ')} }`;
}

function node(el: MessageFormatElement, hoisted: Hoisted, pound: string | null): string {
  if (isNumberElement(el)) return `h.n(${access(el.value)}${hoisted.arg(numberOptions(el))})`;
  if (isDateElement(el) || isTimeElement(el)) return `h.d(${access(el.value)}${hoisted.arg(dateOptions(el))})`;
  switch (el.type) {
    case TYPE.literal:
      return JSON.stringify(el.value);
    case TYPE.argument:
      return access(el.value);
    case TYPE.pound:
      return pound ?? '"#"';
    case TYPE.select:
      return `h.s(${access(el.value)}, ${arms(el.options, hoisted, pound)})`;
    case TYPE.plural: {
      // `#` is the plural's own value less its offset, formatted as a number.
      const value = access(el.value);
      const hash = `h.n(${value}${el.offset !== 0 ? ` - ${el.offset}` : ''})`;
      return `h.p(${value}, ${el.offset}, ${el.pluralType === 'ordinal'}, ${arms(el.options, hoisted, hash)})`;
    }
    case TYPE.tag:
      return `h.t(a, ${JSON.stringify(el.value)}, ${nodes(el.children, hoisted, pound)})`;
    default:
      throw new Error(`prosebook: no compiler for ICU element type ${(el as MessageFormatElement).type}`);
  }
}

function message(ast: MessageFormatElement[], hoisted: Hoisted): string {
  const literal = staticLiteral(ast);
  return literal === undefined ? `(a, h) => ${nodes(ast, hoisted, null)}` : JSON.stringify(literal);
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

/** The locale as an ES module whose default export is its messages. */
export function localeModule(compiled: CompiledLocale, banner: string, ts: boolean): string {
  const head = ts ? `${banner}\nimport type { CompiledMessages } from 'prosebook';\n` : `${banner}\n`;
  // `as const` keeps `style: "currency"` a literal, which is what `Intl`'s option types ask for.
  const declarations = ts ? compiled.declarations.map((d) => d.replace(/;$/, ' as const;')) : compiled.declarations;
  const consts = declarations.length > 0 ? `\n${declarations.join('\n')}\n` : '';
  const close = ts ? '} satisfies CompiledMessages;' : '};';
  return `${head}${consts}\nexport default {\n${compiled.rows.join('\n')}\n${close}\n`;
}

/** The locale as one expression, for a bundler to inline in place of the module. */
export function localeExpression(compiled: CompiledLocale): string {
  return `(() => {\n${compiled.declarations.join('\n')}\nreturn {\n${compiled.rows.join('\n')}\n};\n})()`;
}
