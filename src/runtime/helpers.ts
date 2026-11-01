import type { Arms, Helpers, Values } from './types.ts';

/**
 * The helpers compiled messages call, for one locale. Formatters are built once per options object:
 * the generator hoists each message's options to a module-level constant, so identity is a stable key.
 */
export function createHelpers(locale: string): Helpers {
  const numbers = new Map<Intl.NumberFormatOptions | undefined, Intl.NumberFormat>();
  const dates = new Map<Intl.DateTimeFormatOptions | undefined, Intl.DateTimeFormat>();
  let cardinal: Intl.PluralRules | undefined;
  let ordinal: Intl.PluralRules | undefined;

  return {
    locale,
    n(value, options) {
      let format = numbers.get(options);
      if (format === undefined) numbers.set(options, (format = new Intl.NumberFormat(locale, options)));
      return format.format(value);
    },
    d(value, options) {
      let format = dates.get(options);
      if (format === undefined) dates.set(options, (format = new Intl.DateTimeFormat(locale, options)));
      return format.format(value);
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
