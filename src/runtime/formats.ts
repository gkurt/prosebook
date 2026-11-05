/**
 * Named formats: a number, date, list or duration format the config names once (`price`, `receipt`),
 * which a message names in place of its options (`{total, number, price}`) and `copy.number(total,
 * 'price')` names in code, so every page shows the same thing the same way and one edit changes it
 * everywhere.
 */

/** A list as `Intl.ListFormat` joins it, and with `max`, its first items and the entry `more` names for the rest. */
export interface ListFormatOptions extends Intl.ListFormatOptions {
  /** The most items shown; the rest are counted by the `more` entry, as a last item: "a, b, and 3 more". */
  readonly max?: number;
  /** The key of the entry that says the rest, given their number as `{count}`. A named format's only. */
  readonly more?: string;
}

export type DurationUnit = 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds';

/** A duration in milliseconds, split into units as `Intl.DurationFormat` writes them: "3 min, 5 sec". */
export interface DurationFormatOptions {
  readonly style?: 'long' | 'short' | 'narrow' | 'digital';
  /** The largest unit a duration is counted in: `hours` writes a day as 24 hours. Days unless said. */
  readonly largest?: DurationUnit;
  /** The smallest unit shown, which the duration is rounded to. Milliseconds unless said, seconds when digital. */
  readonly smallest?: DurationUnit;
  /** The most units shown, from the largest the duration reaches: 2 writes "1 hr, 2 min", not "1 hr, 2 min, 5 sec". All when digital. */
  readonly units?: number;
  /**
   * The most digits of a second shown as its fraction, 1 to 3: 1 writes "4.2s" where milliseconds would
   * write "4s 200ms", and "12s" for 12 seconds. The fraction is a unit of `units`, so with 2, "3m 5s"
   * has none. Digital shows every digit, "0:03:05.40", so a clock keeps its width.
   */
  readonly fractionalDigits?: number;
}

type OptionsOf = {
  number: Intl.NumberFormatOptions;
  date: Intl.DateTimeFormatOptions;
  list: ListFormatOptions;
  duration: DurationFormatOptions;
};

export type FormatKind = keyof OptionsOf;

export type FormatTable = { readonly [K in FormatKind]?: { readonly [name: string]: OptionsOf[K] } };

export interface Formats extends FormatTable {
  /**
   * A format as one locale or language shows it, in place of the one above: `{ de: { date: { receipt: … } } }`.
   * A locale takes its own, then its parents' (`de-AT`, then `de`).
   */
  readonly locales?: { readonly [locale: string]: FormatTable };
}

/** The options a named format has in `locale`, or nothing where no format has that name. */
export function formatIn<K extends FormatKind>(
  formats: Formats | undefined,
  kind: K,
  name: string,
  locale: string,
): OptionsOf[K] | undefined {
  if (formats === undefined) return undefined;
  // TypeScript can't follow `kind` into the mapped table, so the lookup names the type it reads.
  const own = (table: FormatTable | undefined) => table?.[kind]?.[name];
  for (let tag = locale; ; tag = tag.slice(0, tag.lastIndexOf('-'))) {
    const found = own(formats.locales?.[tag]);
    if (found !== undefined) return found;
    if (!tag.includes('-')) break;
  }
  return own(formats);
}

/** The entries list formats name for their rest, which a build keeps: the copy reads them for `copy.list`. */
export function moreKeys(formats: Formats | undefined): string[] {
  const tables = [formats, ...Object.values(formats?.locales ?? {})];
  return [...new Set(tables.flatMap((t) => Object.values(t?.list ?? {}).flatMap((o) => o.more ?? [])))];
}

const UNITS: readonly (readonly [DurationUnit, number])[] = [
  ['days', 86_400_000],
  ['hours', 3_600_000],
  ['minutes', 60_000],
  ['seconds', 1000],
  ['milliseconds', 1],
];

/**
 * Milliseconds as the units `options` shows: from the largest the duration reaches, at most `units`
 * of them, the last rounded, so 185,400 ms is 3 minutes and 5 seconds and 59,600 ms to the second is
 * a minute. With `fractionalDigits`, the smallest unit is the seconds' fraction, in milliseconds a
 * unit of its own, so it counts towards `units` as any other does. `display` is what
 * `Intl.DurationFormat` takes beside the format's own options to show them: a duration of nothing as
 * 0 in the smallest unit, and milliseconds folded into the seconds.
 */
export function durationParts(
  ms: number,
  options: DurationFormatOptions = {},
): { parts: Partial<Record<DurationUnit, number>>; display?: Record<string, string | undefined> } {
  const digital = options.style === 'digital';
  const fraction = options.fractionalDigits;
  const index = (unit: DurationUnit | undefined, or: number) => (unit === undefined ? or : UNITS.findIndex(([u]) => u === unit));
  const range =
    fraction === undefined
      ? UNITS.slice(index(options.largest, 0), index(options.smallest, digital ? 3 : 4) + 1)
      : [...UNITS.slice(index(options.largest, 0), 4), ['milliseconds', 10 ** (3 - fraction)] as const];
  const units = options.units ?? (digital ? range.length : 2);
  // `Intl` writes milliseconds as the seconds' fraction only where they are `numeric`, as digital has
  // them, and pads it to `fractionalDigits`: left out, it writes the digits there are, so 12 seconds is "12s".
  const folded = fraction === undefined || digital ? undefined : { milliseconds: 'numeric', fractionalDigits: undefined };
  const sign = ms < 0 ? -1 : 1;
  let rest = Math.abs(ms);
  let first = 0;
  let last = 0;
  // Rounding may carry into a larger unit (59.6 seconds to the second is a minute), so round until it settles.
  for (let settled = false; !settled;) {
    first = Math.max(
      0,
      range.findIndex(([, size]) => rest >= size),
    );
    if (rest < range.at(-1)![1]) first = range.length - 1;
    last = Math.min(first + units - 1, range.length - 1);
    const size = range[last]![1];
    const rounded = Math.round(rest / size) * size;
    settled = rounded === rest;
    rest = rounded;
  }
  const parts: Partial<Record<DurationUnit, number>> = {};
  for (const [unit, size] of range.slice(first, last + 1)) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    // The fraction's unit is tenths or hundredths of a second, which `Intl` takes as milliseconds.
    if (n !== 0) parts[unit] = sign * (unit === 'milliseconds' ? n * size : n);
  }
  if (Object.keys(parts).length > 0) return folded === undefined ? { parts } : { parts, display: folded };
  // Nothing is 0 seconds, not 0 tenths of one.
  const zero = fraction === undefined ? range[last]![0] : 'seconds';
  return { parts: { [zero]: 0 }, display: { ...folded, [`${zero}Display`]: 'always' } };
}
