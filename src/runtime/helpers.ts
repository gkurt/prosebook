import type { Arms, Helpers, Values } from './types.ts';

/** Formatters by options object, then by the options arguments gave, as JSON (`''` for none). */
type Formatters<F> = Map<object | undefined, Map<string, F>>;

/**
 * The helpers compiled messages call, for one locale. Formatters are built once per options object:
 * the generator hoists each message's options to a module-level constant, so identity is a stable key.
 * Options an argument gives are built per call, so those are told apart by value.
 *
 * A value missing, or one `Intl` refuses, never throws: `n` and `d` give nothing back, and the message
 * shows the placeholder's fallback through `e`, which hands `report` what went wrong.
 */
export function createHelpers(locale: string, report?: (error: Error) => void): Helpers {
  const numbers: Formatters<Intl.NumberFormat> = new Map();
  const dates: Formatters<Intl.DateTimeFormat> = new Map();
  const rules: Formatters<Intl.PluralRules>[] = [new Map(), new Map()];
  let failure: unknown;

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
      return attempt(value, () => formatter(numbers, options, given, (o) => new Intl.NumberFormat(locale, o)).format(value));
    },
    d(value, options, given) {
      return attempt(value, () => formatter(dates, options, given, (o) => new Intl.DateTimeFormat(locale, o)).format(value));
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
      return pick(arms, value === null || value === undefined ? 'null' : String(value));
    },
    t(values: Values, tag, children) {
      const render = values[tag];
      return typeof render === 'function' ? (render as (chunks: unknown[]) => unknown)(flatten(children)) : children;
    },
  };
}

function formatter<O extends object, F>(cache: Formatters<F>, options: O | undefined, given: O | undefined, make: (o?: O) => F): F {
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
