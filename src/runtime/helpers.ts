import type { Arms, Helpers, Values } from './types.ts';

/** Formatters by options object, then by the options arguments gave, as JSON (`''` for none). */
type Formatters<F> = Map<object | undefined, Map<string, F>>;

/**
 * The helpers compiled messages call, for one locale. Formatters are built once per options object:
 * the generator hoists each message's options to a module-level constant, so identity is a stable key.
 * Options an argument gives are built per call, so those are told apart by value.
 */
export function createHelpers(locale: string): Helpers {
  const numbers: Formatters<Intl.NumberFormat> = new Map();
  const dates: Formatters<Intl.DateTimeFormat> = new Map();
  let cardinal: Intl.PluralRules | undefined;
  let ordinal: Intl.PluralRules | undefined;

  return {
    locale,
    n(value, options, given) {
      return formatter(numbers, options, given, (o) => new Intl.NumberFormat(locale, o)).format(value);
    },
    d(value, options, given) {
      return formatter(dates, options, given, (o) => new Intl.DateTimeFormat(locale, o)).format(value);
    },
    p(value, offset, isOrdinal, arms) {
      const exact = arms[`=${value}`];
      if (exact !== undefined) return exact();
      const rules = isOrdinal
        ? (ordinal ??= new Intl.PluralRules(locale, { type: 'ordinal' }))
        : (cardinal ??= new Intl.PluralRules(locale));
      return pick(arms, rules.select(value - offset));
    },
    s(value, arms) {
      return pick(arms, String(value));
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
