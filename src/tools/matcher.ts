/**
 * A message as a regular expression matching every text it can come to: what `prosebook/test`'s
 * `match` hands a test, and what the `test-text` check finds a test's literal by. A placeholder given a
 * value is that value as the runtime formats it; one not given matches any text, and a plural or select
 * not given matches any of its arms. A tag matches the words it wraps, as text on a page reads, and
 * whitespace matches any run of it, the no-break spaces `Intl` writes included.
 */
import type { HelperOptions } from '#src/runtime/helpers.ts';
import type { Values } from '#src/runtime/types.ts';

import { renderer } from './compile.ts';
import { extensionOf, inlined, optionArgsOf, TYPE, type MessageFormatElement } from './icu.ts';

/** Any text a placeholder not given may come to, none included: an empty name renders nothing. */
const ANY = '[\\s\\S]*?';

/** Text as a pattern matching it, each run of whitespace matching any. */
export const literalPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s+');

type Plural = Extract<MessageFormatElement, { type: TYPE.plural }>;
type Select = Extract<MessageFormatElement, { type: TYPE.select }>;

interface Context {
  locale: string;
  values: Values;
  helpers: HelperOptions;
}

const given = (values: Values, name: string) => Object.hasOwn(values, name) && values[name] !== undefined && values[name] !== null;

/** What `el` renders to alone, given the values, as the compiled message would render it. */
const rendered = (el: MessageFormatElement, cx: Context) => renderer([el], cx.locale, cx.helpers)(cx.values);

/** The same plural or select, each arm saying only what `say` makes of it: its name, to learn the arm the runtime picks. */
const rearmed = <E extends Plural | Select>(el: E, say: (arm: string) => MessageFormatElement[]): E => ({
  ...el,
  options: Object.fromEntries(Object.keys(el.options).map((arm) => [arm, { value: say(arm) }])),
});

const alternatives = (patterns: string[]) => {
  const distinct = [...new Set(patterns)];
  return distinct.length === 1 ? distinct[0]! : `(?:${distinct.join('|')})`;
};

/** The innermost plural, whose value a `#` prints: given, as the runtime writes it, or any text. */
type Pound = string | undefined;

function patternOf(elements: MessageFormatElement[], cx: Context, pound: Pound): string {
  return elements.map((el) => elementPattern(el, cx, pound)).join('');
}

function elementPattern(el: MessageFormatElement, cx: Context, pound: Pound): string {
  if (el.type === TYPE.literal) return literalPattern(el.value);
  if (el.type === TYPE.pound) return pound ?? ANY;
  if (el.type === TYPE.tag) return patternOf(el.children, cx, pound);
  if (el.type === TYPE.select) {
    if (!given(cx.values, el.value)) return alternatives(Object.values(el.options).map((o) => patternOf(o.value, cx, pound)));
    const arm = rendered(
      rearmed(el, (name) => [{ type: TYPE.literal, value: name }]),
      cx,
    );
    return patternOf(el.options[arm]?.value ?? [], cx, pound);
  }
  if (el.type === TYPE.plural) {
    const names = [el.value, ...Object.values(optionArgsOf(el) ?? {}).map((o) => o.arg)];
    if (!names.every((n) => given(cx.values, n)))
      return alternatives(Object.values(el.options).map((o) => patternOf(o.value, cx, undefined)));
    const arm = rendered(
      rearmed(el, (name) => [{ type: TYPE.literal, value: name }]),
      cx,
    );
    const shown = literalPattern(
      rendered(
        rearmed(el, () => [{ type: TYPE.pound }]),
        cx,
      ),
    );
    return patternOf(el.options[arm]?.value ?? [], cx, shown);
  }
  // A placeholder: plain, a number, a date, a time, or prosebook's list, duration or relative time.
  const name = extensionOf(el)?.value ?? (el as { value?: string }).value;
  const names = name === undefined ? [] : [name, ...Object.values(optionArgsOf(el) ?? {}).map((o) => o.arg)];
  return names.length > 0 && names.every((n) => given(cx.values, n)) ? literalPattern(rendered(el, cx)) : ANY;
}

export interface PatternOptions {
  /** Matches the text anywhere inside what it is tested on, not only the whole of it. */
  partial?: boolean;
  /** How dates and relative times are written, as the copy's options say: its time zone and clock. */
  helpers?: HelperOptions;
}

/** A message's text in `locale` as a regular expression, the placeholders in `values` as written and the rest any text. */
export function messageRegExp(ast: MessageFormatElement[], locale: string, values: Values = {}, options: PatternOptions = {}): RegExp {
  const body = patternOf(inlined(ast), { locale, values, helpers: options.helpers ?? {} }, undefined);
  return new RegExp(options.partial === true ? body : `^\\s*${body}\\s*$`);
}
