/**
 * A message as a regular expression matching every text it can come to: what `prosebook/test`'s
 * `match` hands a test, and what the `test-text` check finds a test's literal by. A placeholder given a
 * value is that value as the runtime formats it; one not given matches any text, and a plural or select
 * not given matches any of its arms. A tag matches the words it wraps, as text on a page reads, and
 * whitespace matches any run of it, the no-break spaces `Intl` writes included.
 *
 * With a `distance`, the message's own words may differ from the text by that many characters in all,
 * each inserted, deleted or replaced: a Levenshtein distance written out as alternatives, since a test
 * runner hands a regular expression to the browser as its source, and no other matcher survives that.
 * Values given and placeholders aren't counted, being written as the runtime writes them, or any text.
 */
import type { HelperOptions } from '#src/runtime/helpers.ts';
import type { Values } from '#src/runtime/types.ts';

import { renderer } from './compile.ts';
import { extensionOf, inlined, optionArgsOf, TYPE, type MessageFormatElement } from './icu.ts';

/** Any text a placeholder not given may come to, none included: an empty name renders nothing. */
const ANY = '[\\s\\S]*?';

/** Text as a pattern matching it, each run of whitespace matching any. */
export const literalPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s+');

/** One character a distance may add or put in a word's place. */
const ONE = '[\\s\\S]';
/** Past this many characters, an expression costs a browser more than a test should: say so rather than hang. */
const LONGEST = 200_000;

/**
 * Text as a pattern matching it with up to `edits` characters inserted, deleted or replaced, a run of whitespace
 * counting as one: at each unit, it matches, or one edit is spent replacing or deleting it, or inserting before it.
 */
function fuzzyPattern(text: string, edits: number): string {
  const units = (text.match(/\s+|[\s\S]/gu) ?? []).map(literalPattern);
  const memo = new Map<string, string>();
  const from = (i: number, k: number): string => {
    if (k === 0) return units.slice(i).join('');
    if (i === units.length) return `${ONE}{0,${k}}`;
    const id = `${i},${k}`;
    let pattern = memo.get(id);
    if (pattern === undefined) {
      pattern = `(?:${units[i]}${from(i + 1, k)}|${ONE}?${from(i + 1, k - 1)}|${ONE}${from(i, k - 1)})`;
      memo.set(id, pattern);
    }
    return pattern;
  };
  return from(0, edits);
}

type Plural = Extract<MessageFormatElement, { type: TYPE.plural }>;
type Select = Extract<MessageFormatElement, { type: TYPE.select }>;

interface Context {
  locale: string;
  values: Values;
  helpers: HelperOptions;
  /** What a number not given matches: any text, or with `numbers`, text with no letters. */
  number: string;
}

/** A number written out, with no letter: `3`, `€1,234.50`, `12 %`. Only in a pattern with the `u` flag. */
const NUMBER = '\\P{L}+?';

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

/** Whether an element holds words of the message's own, which a distance may edit. */
function hasWords(el: MessageFormatElement): boolean {
  if (el.type === TYPE.literal) return el.value !== '';
  if (el.type === TYPE.tag) return el.children.some(hasWords);
  if (el.type === TYPE.select || el.type === TYPE.plural) return Object.values(el.options).some((o) => o.value.some(hasWords));
  return false;
}

/** The elements in a row, `edits` shared among them: each way of splitting them between the first with words and the rest. */
function patternOf(elements: MessageFormatElement[], cx: Context, pound: Pound, edits = 0): string {
  const [first, ...rest] = elements;
  if (first === undefined) return '';
  if (edits === 0 || !hasWords(first)) return elementPattern(first, cx, pound, 0) + patternOf(rest, cx, pound, edits);
  if (!rest.some(hasWords)) return elementPattern(first, cx, pound, edits) + patternOf(rest, cx, pound, 0);
  return alternatives(
    Array.from({ length: edits + 1 }, (_, k) => elementPattern(first, cx, pound, k) + patternOf(rest, cx, pound, edits - k)),
  );
}

function elementPattern(el: MessageFormatElement, cx: Context, pound: Pound, edits: number): string {
  if (el.type === TYPE.literal) {
    if (edits === 0) return literalPattern(el.value);
    // Word by word, the edits shared among them: an edit belongs to one word or space, so no alignment is lost, and
    // each word written out per split is far shorter than every character's.
    const words = el.value.match(/\s+|\S+/g) ?? [];
    if (words.length < 2) return fuzzyPattern(el.value, edits);
    return patternOf(
      words.map((value) => ({ type: TYPE.literal, value })),
      cx,
      pound,
      edits,
    );
  }
  if (el.type === TYPE.pound) return pound ?? cx.number;
  if (el.type === TYPE.tag) return patternOf(el.children, cx, pound, edits);
  if (el.type === TYPE.select) {
    if (!given(cx.values, el.value)) return alternatives(Object.values(el.options).map((o) => patternOf(o.value, cx, pound, edits)));
    const arm = rendered(
      rearmed(el, (name) => [{ type: TYPE.literal, value: name }]),
      cx,
    );
    return patternOf(el.options[arm]?.value ?? [], cx, pound, edits);
  }
  if (el.type === TYPE.plural) {
    const names = [el.value, ...Object.values(optionArgsOf(el) ?? {}).map((o) => o.arg)];
    if (!names.every((n) => given(cx.values, n)))
      return alternatives(Object.values(el.options).map((o) => patternOf(o.value, cx, undefined, edits)));
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
    return patternOf(el.options[arm]?.value ?? [], cx, shown, edits);
  }
  // A placeholder: plain, a number, a date, a time, or prosebook's list, duration or relative time.
  const name = extensionOf(el)?.value ?? (el as { value?: string }).value;
  const names = name === undefined ? [] : [name, ...Object.values(optionArgsOf(el) ?? {}).map((o) => o.arg)];
  if (names.length > 0 && names.every((n) => given(cx.values, n))) return literalPattern(rendered(el, cx));
  return el.type === TYPE.number ? cx.number : ANY;
}

export interface PatternOptions {
  /** Matches the text anywhere inside what it is tested on (`true`), at its start or at its end, not only the whole of it. */
  partial?: boolean | 'start' | 'end';
  /** How many characters of the message's own words may differ from the text, inserted, deleted or replaced. 0 unset. */
  distance?: number;
  /** How dates and relative times are written, as the copy's options say: its time zone and clock. */
  helpers?: HelperOptions;
  /** A number not given, a `#` or `{n, number}`, matches only text with no letters, as a number written out has none. */
  numbers?: boolean;
}

/** A message's text in `locale` as a regular expression, the placeholders in `values` as written and the rest any text. */
export function messageRegExp(ast: MessageFormatElement[], locale: string, values: Values = {}, options: PatternOptions = {}): RegExp {
  const distance = options.distance ?? 0;
  if (!Number.isInteger(distance) || distance < 0) throw new Error(`distance is ${distance}: give a whole number of characters, 0 or more`);
  const numbers = options.numbers === true;
  const cx = { locale, values, helpers: options.helpers ?? {}, number: numbers ? NUMBER : ANY };
  const body = patternOf(inlined(ast), cx, undefined, distance);
  if (body.length > LONGEST) {
    const why = `a distance of ${distance} makes this message an expression of ${body.length} characters`;
    throw new Error(`${why}: give a smaller one, or values for its plurals and selects`);
  }
  const { partial } = options;
  const start = partial === true || partial === 'end' ? '' : '^\\s*';
  const end = partial === true || partial === 'start' ? '' : '\\s*$';
  return new RegExp(`${start}${body}${end}`, numbers ? 'u' : '');
}
