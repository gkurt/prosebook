import { durationParts, formatWith, stepOf, type DateFormatOptions, type Formatters, type ListFormatOptions } from './formats.ts';
import type { RelativeTime, RelativeTools } from './relative.ts';
import type { Arms, Helpers, ListItem, Values } from './types.ts';

/** Formatters by options object, then by the options arguments gave, as JSON (`''` for none). */
type Cache<F> = Map<object | undefined, Map<string, F>>;

/**
 * The helpers compiled messages call, for one locale. Formatters are built once per options object:
 * the generator hoists each message's options to a module-level constant, so identity is a stable key.
 * Options an argument gives are built per call, so those are told apart by value.
 *
 * A value missing, or one `Intl` refuses, never throws: `n` and `d` give nothing back, and the message
 * shows the placeholder's fallback through `e`, which hands `report` what went wrong. `timeZone` is the
 * zone dates are shown in unless a message names its own. A format naming a `formatter` is the app's
 * own, from `formatters`. Relative times are formatted by `relative`, the catalog's, read by the
 * clock `now`, and `due` is told when each one read next reads differently.
 */
export function createHelpers(
  locale: string,
  { report, timeZone, formatters, relative, now = Date.now, due }: HelperOptions = {},
): Helpers {
  const context = { locale, timeZone };
  const numbers: Cache<Intl.NumberFormat> = new Map();
  const dates: Cache<Intl.DateTimeFormat> = new Map();
  const rules: Cache<Intl.PluralRules>[] = [new Map(), new Map()];
  const lists: Cache<Intl.ListFormat> = new Map();
  const durations: Cache<Intl.DurationFormat> = new Map();
  let failure: unknown;
  const date = (value: Date | number, options?: DateFormatOptions, given?: Intl.DateTimeFormatOptions) =>
    options?.formatter !== undefined
      ? formatWith(formatters, 'date', options.formatter, value, context)
      : formatter(dates, options, given, (o) => dateFormat(locale, timeZone, o)).format(value);
  // A relative format's date is options already: the compiler read its name in the locale.
  const tools: RelativeTools = { ...context, formatters, date: date as RelativeTools['date'] };

  function attempt(value: unknown, format: () => string): string | undefined {
    failure = undefined;
    // `value !== value`: NaN, which `Intl` prints as "NaN".
    if (value === undefined || value === null || value !== value) return undefined;
    try {
      return format();
    } catch (error) {
      failure = error;
      return undefined;
    }
  }

  return {
    locale,
    n(value, options, given) {
      if (options?.formatter !== undefined)
        return attempt(value, () => formatWith(formatters, 'number', options.formatter!, value, context));
      const make = (o?: Intl.NumberFormatOptions) => formatter(numbers, o, given, (all) => new Intl.NumberFormat(locale, all));
      return attempt(value, () => make(stepOf(options, value, make)).format(value));
    },
    d(value, options, given) {
      return attempt(value, () => date(value, options, given));
    },
    l(value, options, more) {
      return attempt(value, () =>
        joinList(shownItems(value, options, more), options, () =>
          formatter(lists, options, undefined, (o) => new Intl.ListFormat(locale, o)),
        ),
      );
    },
    u(value, options) {
      return attempt(value, () => {
        // Older browsers have no `Intl.DurationFormat`: the placeholder's fallback shows, and says why.
        if (typeof Intl.DurationFormat !== 'function') throw new Error('Intl.DurationFormat is not in this browser');
        const { parts, display } = durationParts(value, options);
        return formatter(durations, options, display, (o) => new Intl.DurationFormat(locale, o as Intl.DurationFormatOptions)).format(
          parts,
        );
      });
    },
    r(value, options, said) {
      return attempt(value, () => {
        if (relative === undefined) throw new Error(NO_RELATIVE);
        const { text, next } = relative.text(value, options, now(), tools, said);
        if (next !== undefined) due?.(next);
        return text;
      });
    },
    e(fallback) {
      const why = failure instanceof Error ? `could not be formatted: ${failure.message}` : 'has no value';
      report?.(new Error(`${fallback} ${why}`, { cause: failure }));
      failure = undefined;
      return fallback;
    },
    p(value, offset, isOrdinal, arms, options, given) {
      const exact = arms[`=${value}`];
      if (exact !== undefined) return exact();
      let category = 'other';
      try {
        const type = isOrdinal ? 'ordinal' : 'cardinal';
        category = formatter(rules[+isOrdinal]!, options, given, (o) => new Intl.PluralRules(locale, { ...o, type })).select(
          value - offset,
        );
      } catch {
        // Options an argument gave that `Intl` refuses: the catch-all arm, as MF2 falls back to `*`.
      }
      return pick(arms, category);
    },
    s(value, arms) {
      // A value that isn't there picks the `null` arm, where the message has one.
      const arm: unknown = value ?? 'null';
      return pick(arms, String(arm));
    },
    t(values: Values, tag, children) {
      const render = values[tag];
      return typeof render === 'function' ? (render as (chunks: unknown[]) => unknown)(flatten(children)) : children;
    },
  };
}

export interface HelperOptions {
  /** Told why a placeholder shows its fallback. */
  report?: (error: Error) => void;
  /** The IANA time zone dates are shown in, unless a message names its own. Defaults to the environment's. */
  timeZone?: string;
  /** The app's own formats, which a format of the config's names (`formatter`). */
  formatters?: Formatters;
  /** What formats relative times: the catalog's `relative`, where a message or format says one. */
  relative?: RelativeTime;
  /** The time relative times are measured from, in milliseconds. `Date.now` unless given. */
  now?: () => number;
  /** Told, of each relative time read, the moment by `now` it next reads differently. */
  due?: (at: number) => void;
}

/** Why a relative time shows its fallback in a catalog generated before anything said one. */
export const NO_RELATIVE = 'prosebook: no message or format says a relative time: name one under formats.relative';

/** A date formatter in `timeZone`, under any the options name. */
export function dateFormat(locale: string, timeZone: string | undefined, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, timeZone === undefined ? options : { timeZone, ...options });
}

/** A list's items as text, empty ones left out, the first `max` of them and the `more` entry saying the rest. */
export function shownItems(items: Iterable<ListItem>, options?: ListFormatOptions, more?: (count: number) => unknown): string[] {
  const all: string[] = [];
  for (const item of items) if (item !== null && item !== undefined && item !== false && item !== '') all.push(String(item));
  const max = options?.max;
  if (max === undefined || all.length <= max) return all;
  const rest = all.length - max;
  return more === undefined ? all.slice(0, max) : [...all.slice(0, max), flatten(more(rest)).join('')];
}

/** Items joined by the format's `separator`, or by the locale's words for a list, from `format`. */
export function joinList(items: string[], options: ListFormatOptions | undefined, format: () => Intl.ListFormat): string {
  return options?.separator === undefined ? format().format(items) : items.join(options.separator);
}

function formatter<O extends object, F>(cache: Cache<F>, options: O | undefined, given: O | undefined, make: (o?: O) => F): F {
  let byGiven = cache.get(options);
  if (byGiven === undefined) cache.set(options, (byGiven = new Map()));
  const key = given === undefined ? '' : JSON.stringify(given);
  let format = byGiven.get(key);
  if (format === undefined) byGiven.set(key, (format = make(given === undefined ? options : { ...options, ...given })));
  return format;
}

function pick(arms: Arms, arm: string): unknown {
  // ICU requires an `other` arm, and the generator refuses a message without one.
  return (Object.hasOwn(arms, arm) ? arms[arm]! : arms['other']!)();
}

/**
 * A compiled message's output as a flat list: nested arrays opened, adjacent text joined, and
 * `null`, `undefined` and booleans dropped, as React drops them.
 */
export function flatten(output: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (part: unknown) => {
    if (Array.isArray(part)) {
      for (const p of part) walk(p);
      return;
    }
    if (part === null || part === undefined || typeof part === 'boolean') return;
    if (typeof part === 'number' || typeof part === 'bigint') part = String(part);
    if (typeof part === 'string' && typeof out.at(-1) === 'string') out[out.length - 1] += part;
    else out.push(part);
  };
  walk(output);
  return out;
}
