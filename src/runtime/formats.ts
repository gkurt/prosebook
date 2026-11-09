/**
 * Named formats: a number, date, list, duration or relative format the config names once (`price`, `receipt`),
 * which a message names in place of its options (`{total, number, price}`) and `copy.number(total,
 * 'price')` names in code, so every page shows the same thing the same way and one edit changes it
 * everywhere.
 */

/**
 * A list as `Intl.ListFormat` joins it, or with `separator`, each item after the one before it, and with `max`, its first
 * items and the entry `more` names for the rest. An empty item, `null`, `undefined` or `false`, is left out, so an
 * optional one needs no filtering: `[author, draft && 'Draft']`.
 */
export interface ListFormatOptions extends Intl.ListFormatOptions {
  /**
   * What goes between every two items, in place of the locale's commas and "and": `' · '` writes a line of facts,
   * "Ann · Draft · 2 new commits". Set it per locale under `formats.locales`. A named format's, or options in code.
   */
  readonly separator?: string;
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

/** A number as `Intl.NumberFormat` shows it, and with `steps`, shown otherwise from a size up. */
export interface NumberFormatOptions extends Intl.NumberFormatOptions {
  /**
   * Options over the format's own from a size up, by `from` ascending: `[{ from: 10, maximumFractionDigits: 0 }]`
   * shows $9.99 and $13. A named format's only.
   */
  readonly steps?: readonly NumberStep[];
  /**
   * The units a number is shown in by its size, smallest first, as `Intl` names them: the largest it has one whole of,
   * "1.5 MB" for 1,500,000 bytes. Each is `per` of the one before, 1000 unless said: `{ per: 1024, units: [...] }` for
   * binary bytes, `{ unit: 'minute', per: 60 }` for time. A unit's own options (`unitDisplay`) go over the format's, and
   * `steps` read the number in its unit. Rounding into the next unit moves it there: 999,999 bytes is "1 MB". A named format's only.
   */
  readonly ladder?: NumberLadder;
  /** Set by prosebook, not the config: the name of the formatter that shows the number (`formatters`). */
  readonly formatter?: string;
}

/** A date as `Intl.DateTimeFormat` shows it. */
export interface DateFormatOptions extends Intl.DateTimeFormatOptions {
  /** Set by prosebook, not the config: the name of the formatter that shows the date (`formatters`). */
  readonly formatter?: string;
}

/** What a formatter is told of where it shows a value. */
export interface FormatterContext {
  readonly locale: string;
  /** The copy's `timeZone`, where it was given one. */
  readonly timeZone?: string;
}

/**
 * Formats of the app's own, by name, as code: what options can't say. A message names one as it does
 * a format of the config's (`{total, number, money}`), and so does code (`copy.number(total, 'money')`).
 */
export interface Formatters {
  readonly number?: { readonly [name: string]: (value: number | bigint, context: FormatterContext) => string };
  readonly date?: { readonly [name: string]: (value: Date | number, context: FormatterContext) => string };
  /**
   * A point in time as how long ago or ahead it is, at `context.now`. Return `{ text, next }` to say when
   * it next reads differently, so `<Text>` and a `live` copy show it fresh; a string alone is never refreshed.
   */
  readonly relative?: { readonly [name: string]: (at: Date, context: RelativeContext) => string | RelativeText };
}

export interface RelativeContext extends FormatterContext {
  /** The copy's clock, in milliseconds: what the time is measured from. */
  readonly now: number;
}

/** A relative time as text, and the moment, by the copy's clock, it next reads differently. */
export interface RelativeText {
  readonly text: string;
  readonly next?: number;
}

/** Typed formatters, for the module the config's `formatters` names. */
export function defineFormatters<const F extends Formatters>(formatters: F): F {
  return formatters;
}

/** `value` as the formatter `name` shows it. Throws where the catalog has none of that name, or the formatter throws. */
export function formatWith(
  formatters: Formatters | undefined,
  kind: 'number' | 'date',
  name: string,
  value: number | bigint | Date,
  context: FormatterContext,
): string {
  return String(formatterOf(formatters, kind, name)(value, context));
}

/** The formatter `name` of a kind. Throws where the catalog has none of that name. */
export function formatterOf(
  formatters: Formatters | undefined,
  kind: keyof Formatters,
  name: string,
): (value: unknown, context: FormatterContext) => unknown {
  const format = formatters?.[kind]?.[name] as ((value: unknown, context: FormatterContext) => unknown) | undefined;
  // The generated index imports the module whose names it lists, so only a catalog written by hand lacks one.
  if (format === undefined) throw new Error(`no ${kind} formatter "${name}"`);
  return format;
}

export interface NumberLadder {
  /** How many of each unit make the next, unless the unit says its own: 1000, or 1024 for binary bytes. */
  readonly per?: number;
  readonly units: readonly (string | LadderUnit)[];
}

/** A unit of a ladder, with how many of the one before make it, and options of its own: `{ unit: 'byte', unitDisplay: 'narrow' }`. */
export interface LadderUnit extends Intl.NumberFormatOptions {
  readonly unit: string;
  readonly per?: number;
}

export interface NumberStep extends Intl.NumberFormatOptions {
  /** The size, either side of 0, from which the step shows a number: as shown, so 9.996 shown as 10.00 is 10. */
  readonly from: number;
}

/** Each format's options at every step, the format's own first, built once so a formatter cache can key on them. */
const stepped = new WeakMap<NumberFormatOptions, Intl.NumberFormatOptions[]>();
/** What a formatter rounds a number to, as a plain number to compare. */
const plain = new WeakMap<Intl.NumberFormat, Intl.NumberFormat>();

/**
 * The options `value` is shown with: the format's own, or those of the last step its size reaches as
 * shown. Rounding may carry a number into the next step (9.996 to two digits is 10.00), so it goes on
 * while the step it is in shows it at the next one's `from`. `make` builds, or finds, a formatter.
 */
export function stepOf(
  options: NumberFormatOptions | undefined,
  value: number | bigint,
  make: (options: Intl.NumberFormatOptions) => Intl.NumberFormat,
): Intl.NumberFormatOptions | undefined {
  const steps = options?.steps;
  if (steps === undefined) return options;
  let all = stepped.get(options!);
  if (all === undefined) {
    const own = { ...options, steps: undefined };
    stepped.set(options!, (all = [own, ...steps.map((step) => ({ ...own, ...step, from: undefined }))]));
  }
  const size = Number(value < 0 ? -value : value);
  let at = 0;
  while (at < steps.length && (size >= steps[at]!.from || shownSize(make(all[at]!), size) >= steps[at]!.from)) at++;
  return all[at];
}

/** A size as `format` rounds it. A compact or scientific number is compared as it is. */
export function shownSize(format: Intl.NumberFormat, size: number): number {
  const resolved = format.resolvedOptions();
  if (resolved.notation !== 'standard') return size;
  let rounding = plain.get(format);
  // The format's own rounding, written as a plain number. A percent shows the number times 100.
  if (rounding === undefined) {
    rounding = new Intl.NumberFormat('en', { ...resolved, style: 'decimal', useGrouping: false, numberingSystem: 'latn' });
    plain.set(format, rounding);
  }
  const scale = resolved.style === 'percent' ? 100 : 1;
  return Number(rounding.format(size * scale)) / scale;
}

type OptionsOf = {
  number: NumberFormatOptions;
  date: DateFormatOptions;
  list: ListFormatOptions;
  duration: DurationFormatOptions;
  relative: RelativeFormatOptions;
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

/**
 * The entries formats name, which a build keeps: the copy reads them for `copy.list` (a list's `more`)
 * and `copy.relative` (a relative time's `now`).
 */
export function moreKeys(formats: Formats | undefined): string[] {
  const tables = [formats, ...Object.values(formats?.locales ?? {})];
  const named = (t: FormatTable | undefined) => [
    ...Object.values(t?.list ?? {}).flatMap((o) => o.more ?? []),
    ...Object.values(t?.relative ?? {}).flatMap((o) => o.now ?? []),
  ];
  return [...new Set(tables.flatMap(named))];
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

export type RelativeUnit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

/**
 * A point in time as how long ago or ahead of now it is: "3 days ago", "yesterday", "in 2 hours". It
 * is counted in the largest unit it has a whole one of, rounded, and below one of the smallest unit
 * it is now. Units have fixed lengths: a day is 24 hours, a week 7 days, a month 30 days, a quarter
 * 90 days and a year 365 days.
 */
export interface RelativeFormatOptions {
  /** As `Intl.RelativeTimeFormat` takes it: "3 days ago", "3d ago". Long unless said. */
  readonly style?: 'long' | 'short' | 'narrow';
  /** As `Intl.RelativeTimeFormat` takes it: `auto` says a day back as "yesterday", `always` as "1 day ago". Auto unless said. */
  readonly numeric?: 'always' | 'auto';
  /** The largest unit counted in: `day` says a month back as "30 days ago". Years unless said. */
  readonly largest?: RelativeUnit;
  /** The smallest unit counted in, which a time under one of reads as now. Minutes unless said. */
  readonly smallest?: RelativeUnit;
  /** Units between those left out. Quarters unless said: `[]` counts in them too. */
  readonly skip?: readonly RelativeUnit[];
  /**
   * How a time is counted in its unit: `nearest` rounds, so 1 day and 14 hours is "2 days ago", and
   * reaching the unit above moves to it (23 hours and 40 minutes is "yesterday"); `down` counts whole
   * units only, "1 day ago". Nearest unless said.
   */
  readonly rounding?: 'nearest' | 'down';
  /**
   * The key of the entry a time under one of the smallest unit reads as, "just now", given `{tense}`:
   * `past` or `future`. A named format's only. Unless said, it reads as `Intl` says now in the locale.
   */
  readonly now?: string;
  /**
   * Past this many milliseconds from now, either way, the time shows as a date, in a date format the
   * config names: `{ after: 7 * 86_400_000, format: 'short' }`. A named format's only.
   */
  readonly date?: { readonly after: number; readonly format: string | DateFormatOptions };
  /** Set by prosebook, not the config: the name of the formatter that shows the time (`formatters`). */
  readonly formatter?: string;
}
