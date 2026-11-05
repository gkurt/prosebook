/**
 * The element tree written as MF1 (ICU MessageFormat) text, for `migrate`. A tree read from MF2 holds
 * `Intl` options where MF1 holds skeletons, so each is written as the skeleton that parses back to the
 * same options, or as the named style MF2's function was mapped from; where neither exists the
 * message is reported rather than changed.
 */
import { isDateElement, isNumberElement, isTimeElement, parse, TYPE } from '@formatjs/icu-messageformat-parser';
import type { DateElement, DateTimeSkeleton, NumberElement, NumberSkeleton, TimeElement } from '@formatjs/icu-messageformat-parser';

import { extensionOf, LIST, namedOf, selectionOf, type MessageFormatElement } from './icu.ts';
import type { Mf2DateSkeleton, Mf2Function, Mf2NumberSkeleton } from './mf2.ts';

type Element = MessageFormatElement;

export function toMf1(ast: Element[]): string {
  return print(native(ast, undefined), false);
}

const CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * Printed as a person would write it: `{n, plural, =0 {…} one {…} other {…}}`, exact arms first and
 * `other` last. (formatjs's printer packs and reorders arms.)
 */
function print(elements: Element[], inPlural: boolean): string {
  return elements
    .map((el, i) => {
      const own = extensionOf(el);
      if (own !== undefined) {
        const kind = own.type === LIST ? 'list' : 'duration';
        const style = own.named ?? own.style;
        return style === null ? `{${own.value}, ${kind}}` : `{${own.value}, ${kind}, ${style}}`;
      }
      switch (el.type) {
        case TYPE.literal:
          return escape(el.value, inPlural, elements[i + 1] === undefined);
        case TYPE.argument:
          return `{${el.value}}`;
        case TYPE.number:
        case TYPE.date:
        case TYPE.time: {
          const kind = el.type === TYPE.number ? 'number' : el.type === TYPE.date ? 'date' : 'time';
          const style = el.style;
          if (style === null || style === undefined) return `{${el.value}, ${kind}}`;
          if (typeof style === 'string') return `{${el.value}, ${kind}, ${style}}`;
          const named = namedOf(el);
          if (named !== undefined) return `{${el.value}, ${kind}, ${named}}`;
          const skeleton = 'tokens' in style ? style.tokens.map((t) => [t.stem, ...t.options].join('/')).join(' ') : style.pattern;
          return `{${el.value}, ${kind}, ::${skeleton}}`;
        }
        case TYPE.pound:
          return '#';
        case TYPE.tag:
          return `<${el.value}>${print(el.children, inPlural)}</${el.value}>`;
        case TYPE.select:
        case TYPE.plural: {
          const arms = Object.entries(el.options);
          const rank = (arm: string) => (arm.startsWith('=') ? -1 : arm === 'other' ? 99 : Math.max(0, CATEGORY_ORDER.indexOf(arm)));
          if (el.type === TYPE.plural)
            arms.sort(([a], [b]) => (rank(a) !== rank(b) ? rank(a) - rank(b) : Number(a.slice(1)) - Number(b.slice(1))));
          else arms.sort(([a], [b]) => (a === 'other' ? 1 : 0) - (b === 'other' ? 1 : 0));
          const head = el.type === TYPE.select ? 'select' : el.pluralType === 'ordinal' ? 'selectordinal' : 'plural';
          const offset = el.type === TYPE.plural && el.offset !== 0 ? ` offset:${el.offset}` : '';
          const body = arms.map(([arm, o]) => `${arm} {${print(o.value, el.type === TYPE.plural)}}`).join(' ');
          return `{${el.value}, ${head},${offset} ${body}}`;
        }
        default:
          return '';
      }
    })
    .join('');
}

/**
 * Literal text, quoted where ICU would read it as syntax. An apostrophe starts a quote only before a
 * special character, so one before ordinary text (`don't`) stays single.
 */
function escape(text: string, inPlural: boolean, last: boolean): string {
  const special = (c: string | undefined) => c === '{' || c === '}' || c === '<' || (inPlural && c === '#');
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (special(c)) out += `'${c}'`;
    // Before the next placeholder or tag, a trailing apostrophe would quote its brace.
    else if (c === "'") out += special(text[i + 1]) || text[i + 1] === "'" || (!last && i === text.length - 1) ? "''" : "'";
    else out += c;
  }
  return out;
}

/** The tree with MF2 styles replaced by MF1 ones, and `#` where a plural prints its own value. */
function native(elements: Element[], plural: { value: string; offset: number } | undefined): Element[] {
  return elements.map((el): Element => {
    if (isNumberElement(el)) {
      if (plural?.offset === 0 && el.value === plural.value && plainNumber(el)) return { type: TYPE.pound };
      return { ...el, style: numberStyle(el) };
    }
    if (isDateElement(el) || isTimeElement(el)) return dateElement(el);
    if (el.type === TYPE.plural) {
      // Digit options and `:integer`'s rounding change only which arm some values reach, which
      // `migrate` reports when it renders both; an argument's option MF1 can't say at all.
      const args = Object.keys(selectionOf(el)?.args ?? {});
      if (args.length > 0) throw new Error(`{${el.value}} is selected with ${args.join(', ')} from an argument, which MF1 can't say`);
      const inner = { value: el.value, offset: el.offset };
      return { ...el, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, { value: native(o.value, inner) }])) };
    }
    // formatjs reads `#` as text inside a select, even one inside a plural.
    if (el.type === TYPE.select)
      return { ...el, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, { value: native(o.value, undefined) }])) };
    if (el.type === TYPE.tag) return { ...el, children: native(el.children, plural) };
    return el;
  });
}

function plainNumber(el: NumberElement): boolean {
  const style = el.style;
  if (style === null || style === undefined) return true;
  if (namedOf(el) !== undefined) return false;
  const mf2 = 'mf2' in Object(style) ? (style as Mf2NumberSkeleton) : undefined;
  return mf2 !== undefined && mf2.args === undefined && Object.keys(mf2.parsedOptions).length === 0;
}

function same(a: object, b: object): boolean {
  const norm = (o: object) =>
    JSON.stringify(
      Object.entries(o)
        .filter(([, v]) => v !== undefined)
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return norm(a) === norm(b);
}

function numberStyle(el: NumberElement): NumberElement['style'] {
  const style = el.style;
  if (style === null || style === undefined || typeof style === 'string' || !('mf2' in style)) return style;
  // A named format is written as its name, which the config holds the options of.
  if (namedOf(el) !== undefined) return style;
  refuseArgs(el.value, style as Mf2NumberSkeleton);
  const options = (style as Mf2NumberSkeleton).parsedOptions as Record<string, unknown>;
  if (Object.keys(options).length === 0) return null;
  if (same(options, { maximumFractionDigits: 0 })) return 'integer';
  if (same(options, { style: 'percent' })) return 'percent';
  const skeleton = numberSkeleton(options);
  const parsed = skeleton === undefined ? undefined : skeletonStyle(`{n, number, ::${skeleton}}`);
  // `unit-width-*` sets both displays; `Intl` reads only the one its style uses.
  const relevant = (o: Record<string, unknown>) => {
    const { currencyDisplay, unitDisplay, ...rest } = o;
    return { ...rest, ...(o.style === 'currency' ? { currencyDisplay } : {}), ...(o.style === 'unit' ? { unitDisplay } : {}) };
  };
  if (parsed === undefined || !same(relevant(parsed.parsedOptions as Record<string, unknown>), relevant(options)))
    throw new Error(`{${el.value} ${mf2Text((style as Mf2NumberSkeleton).mf2)}} formats in a way no MF1 skeleton says`);
  return parsed as NumberSkeleton;
}

function skeletonStyle(source: string): NumberSkeleton | DateTimeSkeleton | undefined {
  try {
    const el = parse(source, { shouldParseSkeletons: true })[0];
    return el !== undefined && 'style' in el && typeof el.style === 'object' && el.style !== null ? el.style : undefined;
  } catch {
    return undefined;
  }
}

/** The ICU number skeleton for `Intl` options, as far as formatjs reads skeletons back. */
function numberSkeleton(o: Record<string, unknown>): string | undefined {
  const tokens: string[] = [];
  if (o.style === 'percent') tokens.push('percent');
  if (o.style === 'currency') tokens.push(`currency/${String(o.currency)}`);
  if (o.style === 'unit') tokens.push(`unit/${String(o.unit)}`);
  const width =
    o.style === 'currency'
      ? { narrowSymbol: 'unit-width-narrow', code: 'unit-width-short', name: 'unit-width-full-name' }[String(o.currencyDisplay)]
      : o.style === 'unit'
        ? { narrow: 'unit-width-narrow', short: 'unit-width-short', long: 'unit-width-full-name' }[String(o.unitDisplay)]
        : undefined;
  if (width !== undefined) tokens.push(width);
  if (o.currencySign === 'accounting') tokens.push('sign-accounting');
  const sign = { always: 'sign-always', exceptZero: 'sign-except-zero', never: 'sign-never' }[String(o.signDisplay)];
  if (sign !== undefined) tokens.push(sign);
  if (o.useGrouping === false) tokens.push('group-off');
  if (typeof o.minimumIntegerDigits === 'number') tokens.push(`integer-width/*${'0'.repeat(o.minimumIntegerDigits)}`);

  const minF = o.minimumFractionDigits as number | undefined;
  const maxF = o.maximumFractionDigits as number | undefined;
  let fraction: string | undefined;
  if (minF !== undefined && maxF !== undefined) fraction = `.${'0'.repeat(minF)}${'#'.repeat(maxF - minF)}`;
  else if (maxF !== undefined) fraction = maxF === 0 ? '.' : `.${'#'.repeat(maxF)}`;
  else if (minF !== undefined) fraction = `.${'0'.repeat(minF)}*`;
  const minS = o.minimumSignificantDigits as number | undefined;
  const maxS = o.maximumSignificantDigits as number | undefined;
  let significant: string | undefined;
  if (minS !== undefined && maxS !== undefined) significant = `${'@'.repeat(minS)}${'#'.repeat(maxS - minS)}`;
  else if (maxS !== undefined) significant = `@${'#'.repeat(maxS - 1)}`;
  else if (minS !== undefined) significant = `${'@'.repeat(minS)}+`;
  if (significant !== undefined)
    significant += o.roundingPriority === 'morePrecision' ? 'r' : o.roundingPriority === 'lessPrecision' ? 's' : '';
  if (fraction !== undefined)
    tokens.push(fraction + (o.trailingZeroDisplay === 'stripIfInteger' ? '/w' : significant !== undefined ? `/${significant}` : ''));
  else if (significant !== undefined) tokens.push(significant);

  const mode = {
    floor: 'rounding-mode-floor',
    ceil: 'rounding-mode-ceiling',
    trunc: 'rounding-mode-down',
    expand: 'rounding-mode-up',
    halfEven: 'rounding-mode-half-even',
    halfTrunc: 'rounding-mode-half-down',
    halfExpand: 'rounding-mode-half-up',
  }[String(o.roundingMode)];
  if (mode !== undefined) tokens.push(mode);
  return tokens.length > 0 ? tokens.join(' ') : undefined;
}

/** MF2 date and time functions as the MF1 named style they were mapped from (see `dateFunction` in mf2.ts). */
const NAMED: Record<string, readonly [TYPE.date | TYPE.time, string]> = {
  'date length=short': [TYPE.date, 'short'],
  date: [TYPE.date, 'medium'],
  'date length=long': [TYPE.date, 'long'],
  'date fields=year-month-day-weekday length=long': [TYPE.date, 'full'],
  time: [TYPE.time, 'short'],
  'time precision=second': [TYPE.time, 'medium'],
  'time precision=second timeZoneStyle=short': [TYPE.time, 'long'],
  'time precision=second timeZoneStyle=long': [TYPE.time, 'full'],
};

function dateElement(el: DateElement | TimeElement): Element {
  const style = el.style;
  if (typeof style !== 'object' || style === null || !('mf2' in style) || namedOf(el) !== undefined) return el;
  refuseArgs(el.value, style as Mf2DateSkeleton);
  const fn = (style as Mf2DateSkeleton).mf2;
  const named = NAMED[mf2Text(fn, true).slice(1)];
  if (named !== undefined) return { type: named[0], value: el.value, style: named[1] };
  const skeleton = dateSkeleton(style.parsedOptions);
  const parsed = skeleton === undefined ? undefined : skeletonStyle(`{d, date, ::${skeleton}}`);
  if (parsed === undefined || !same(parsed.parsedOptions, style.parsedOptions))
    throw new Error(`{${el.value} ${mf2Text(fn)}} formats in a way no MF1 date skeleton says: use :date or :time with a length`);
  return { type: TYPE.date, value: el.value, style: parsed as DateTimeSkeleton };
}

function dateSkeleton(o: Intl.DateTimeFormatOptions): string | undefined {
  if (o.hour !== undefined || o.timeZone !== undefined || o.calendar !== undefined || o.hour12 !== undefined) return undefined;
  const letters: Record<string, Record<string, string>> = {
    weekday: { short: 'EEE', long: 'EEEE', narrow: 'EEEEE' },
    year: { numeric: 'y', '2-digit': 'yy' },
    month: { numeric: 'M', '2-digit': 'MM', short: 'MMM', long: 'MMMM', narrow: 'MMMMM' },
    day: { numeric: 'd', '2-digit': 'dd' },
  };
  let out = '';
  for (const [field, forms] of Object.entries(letters)) {
    const value = o[field as keyof Intl.DateTimeFormatOptions];
    if (value === undefined) continue;
    const letter = forms[String(value)];
    if (letter === undefined) return undefined;
    out += letter;
  }
  return out === '' ? undefined : out;
}

/** A skeleton names every option, so one an argument gives has no MF1 spelling. */
function refuseArgs(name: string, style: Mf2NumberSkeleton | Mf2DateSkeleton): void {
  if (style.args === undefined) return;
  throw new Error(
    `{${name} ${mf2Text(style.mf2)}} takes an option from an argument, which MF1 can't: write the option's value in the message`,
  );
}

function mf2Text(fn: Mf2Function, sortOptions = false): string {
  const options = [...Object.entries(fn.options), ...Object.entries(fn.args ?? {}).map(([k, v]) => [k, `$${v}`] as const)];
  if (sortOptions) options.sort(([a], [b]) => a.localeCompare(b));
  return [`:${fn.name}`, ...options.map(([k, v]) => `${k}=${v}`)].join(' ');
}
