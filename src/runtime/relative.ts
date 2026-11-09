/**
 * Relative times: which unit a point in time is counted in, how it rounds, when it next reads
 * differently, and the one timer that waits for that. A catalog holds it (`relativeTime`) only where
 * a message or a format of the config's says a relative time, as the generated index imports it
 * then, so an app that says none ships none of it.
 */
import { wait } from './clock.ts';
import {
  formatterOf,
  type DateFormatOptions,
  type Formatters,
  type RelativeContext,
  type RelativeFormatOptions,
  type RelativeText,
  type RelativeUnit,
} from './formats.ts';
import { flatten } from './helpers.ts';

const DAY = 86_400_000;
export const RELATIVE_UNITS: readonly (readonly [RelativeUnit, number])[] = [
  ['year', 365 * DAY],
  ['quarter', 90 * DAY],
  ['month', 30 * DAY],
  ['week', 7 * DAY],
  ['day', DAY],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
];

/** What a relative time reads as: a count of a unit (negative in the past, as `Intl` takes it), now, or a date. */
export type RelativeShown = { unit: RelativeUnit; value: number } | { now: 'past' | 'future' } | { date: true };

/** A time, as `Date`, milliseconds or an ISO 8601 string, in milliseconds. Throws where it is none. */
export function timeOf(value: Date | number | string): number {
  const at = typeof value === 'string' ? Date.parse(value) : +value;
  if (at !== at) throw new Error(`${String(value)} is not a time: give a Date, milliseconds or an ISO 8601 string`);
  return at;
}

type Units = (readonly [RelativeUnit, number])[];

/** The units a format counts in, largest first. */
function unitsOf(options: RelativeFormatOptions): Units {
  const index = (unit: RelativeUnit | undefined, or: number) => (unit === undefined ? or : RELATIVE_UNITS.findIndex(([u]) => u === unit));
  const skip = options.skip ?? ['quarter'];
  return RELATIVE_UNITS.slice(index(options.largest, 0), index(options.smallest, 6) + 1).filter(([u]) => !skip.includes(u));
}

/** What a time `ago` milliseconds back (negative: ahead) reads as. */
function shownAt(ago: number, units: Units, options: RelativeFormatOptions): RelativeShown {
  const size = Math.abs(ago);
  if (size < units.at(-1)![1]) return { now: ago < 0 ? 'future' : 'past' };
  if (options.date !== undefined && size >= options.date.after) return { date: true };
  let at = units.findIndex(([, s]) => size >= s);
  let n = (options.rounding === 'down' ? Math.floor : Math.round)(size / units[at]![1]);
  // Rounding may reach the unit above: 23 hours and 40 minutes is a day.
  if (at > 0 && n * units[at]![1] >= units[at - 1]![1]) n = Math.round(size / units[--at]![1]);
  return { unit: units[at]![0], value: ago < 0 ? n : -n };
}

/**
 * What the time `at` reads as at `now`, both in milliseconds, and the first moment after `now` it reads
 * otherwise: when its count changes, its unit, or it turns now or a date. Nothing where it never will.
 */
export function relativeOf(at: number, now: number, options: RelativeFormatOptions = {}): { shown: RelativeShown; next?: number } {
  const units = unitsOf(options);
  const shown = shownAt(now - at, units, options);
  const said = JSON.stringify(shown);
  // Each step goes to the next moment the reading could change: half a unit of the count shown, where
  // rounding moves it, a unit's length, where the unit changes, or where it turns now or a date. Time
  // runs `ago` up: a past time gets older, one ahead nearer.
  let ago = now - at;
  for (let step = 0; step < 64; step++) {
    const current = shownAt(ago, units, options);
    if ('date' in current && ago > 0) return { shown };
    const marks = [0, ...units.flatMap(([, s]) => [s, -s])];
    if (options.date !== undefined) marks.push(options.date.after, -options.date.after);
    // The unit below's too, ahead of now: a time carried into a unit by rounding drops back at one of its halves.
    const i = 'unit' in current ? units.findIndex(([u]) => u === current.unit) : units.length;
    const below = ago < 0 && options.rounding !== 'down' ? 2 : 1;
    for (const [, s] of units.slice(i, i + below)) marks.push(Math.floor(ago / (s / 2)) * (s / 2) + s / 2);
    const mark = Math.min(...marks.filter((m) => m > ago));
    if (mark === Infinity) return { shown };
    // Ahead of now, a count rounding half away from zero changes just past its mark; past, at it.
    for (const t of [mark, mark + 1]) if (JSON.stringify(shownAt(t, units, options)) !== said) return { shown, next: at + t };
    ago = mark + 1;
  }
  return { shown };
}

/** Where a relative time is said: the locale, and how a date shows there, its format by name or options. */
export interface RelativeTools {
  readonly locale: string;
  readonly timeZone?: string;
  readonly formatters?: Formatters;
  date(at: number, format: string | DateFormatOptions): string;
}

// `Intl.RelativeTimeFormat`s by locale and options, made once each.
const made = new Map<string, Intl.RelativeTimeFormat>();

function formatter(locale: string, options: RelativeFormatOptions | undefined, numeric: 'auto' | 'always') {
  const all = { ...options, numeric };
  const id = locale + JSON.stringify(all);
  let format = made.get(id);
  if (format === undefined) made.set(id, (format = new Intl.RelativeTimeFormat(locale, all)));
  return format;
}

/**
 * A point in time as how long ago or ahead of `now` it is. `said` renders the format's `now` entry.
 * Throws where the value is no time.
 */
export function relativeText(
  value: Date | number | string,
  options: RelativeFormatOptions | undefined,
  now: number,
  tools: RelativeTools,
  said?: (tense: 'past' | 'future') => unknown,
): RelativeText {
  const at = timeOf(value);
  const { locale } = tools;
  if (options?.formatter !== undefined) {
    const context: RelativeContext = { locale, timeZone: tools.timeZone, now };
    const out = formatterOf(tools.formatters, 'relative', options.formatter)(new Date(at), context) as string | RelativeText;
    return typeof out === 'string' ? { text: out } : out;
  }
  const { shown, next } = relativeOf(at, now, options);
  const text =
    'unit' in shown
      ? formatter(locale, options, options?.numeric ?? 'auto').format(shown.value, shown.unit)
      : 'date' in shown
        ? tools.date(at, options!.date!.format)
        : said === undefined
          ? // Now as `Intl` says it, which only `numeric: 'auto'` does: "now", not "in 0 seconds".
            formatter(locale, options, 'auto').format(0, 'second')
          : flatten(said(shown.now)).join('');
  return { text, next };
}

/**
 * A copy's clock, and what keeps its relative times fresh. `now` is `CopyOptions.now`: a number is
 * the time a server rendered the page at, read until the copy is first watched, as a binding does
 * once the page has hydrated. `live` waits for the soonest change of a read nobody claimed while the
 * copy is watched, then calls `changed`.
 */
function clockOf(now: number | (() => number) | undefined, live: boolean, changed: () => void) {
  let frozen = typeof now === 'number' ? now : undefined;
  const clock = typeof now === 'function' ? now : () => frozen ?? Date.now();
  // The soonest change of the read under way; the last read's, which `nextChange` claims from `live`;
  // and the soonest unclaimed one, which `live` waits for.
  let due: number | undefined;
  let last: { due: number; claimed: boolean } | undefined;
  let soonest: number | undefined;
  let watched = false;
  let stop: (() => void) | undefined;
  const arm = () => {
    stop?.();
    stop = undefined;
    if (soonest === undefined || !watched) return;
    stop = wait(soonest - clock(), () => {
      soonest = stop = undefined;
      changed();
    });
  };
  return {
    now: clock,
    // An arrow, as the helpers are handed it.
    due: (at: number) => {
      due = due === undefined ? at : Math.min(due, at);
    },
    read<T>(run: () => T): T {
      due = undefined;
      const out = run();
      if (due === undefined) {
        last = undefined;
        return out;
      }
      const mine = (last = { due, claimed: false });
      // After the reader has had its chance to claim it (`<Text>` does, right after reading).
      if (live) {
        queueMicrotask(() => {
          if (mine.claimed) return;
          soonest = soonest === undefined ? mine.due : Math.min(soonest, mine.due);
          arm();
        });
      }
      return out;
    },
    nextChange() {
      if (last === undefined) return undefined;
      last.claimed = true;
      return last.due;
    },
    at: (time: number, run: () => void) => wait(time - clock(), run),
    watch(on: boolean) {
      watched = on;
      if (on) frozen = undefined;
      arm();
    },
  };
}

/** What a catalog saying relative times holds: the generated index puts it in the catalog's `relative`. */
export const relativeTime = { text: relativeText, clock: clockOf };

export type RelativeTime = typeof relativeTime;
