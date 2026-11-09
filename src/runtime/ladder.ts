/**
 * Number formats with a `ladder`: a number shown in the unit its size reaches. A catalog holds it (`numberLadder`) only
 * where a number format of the config's has a ladder, as the generated index imports it then, so an app with none ships none of it.
 */
import { shownSize, stepOf, type NumberFormatOptions } from './formats.ts';

/** A ladder's rungs, each a unit's size in the smallest and the format's options with its own, built once per format. */
const rungsOf = new WeakMap<NumberFormatOptions, [size: number, options: NumberFormatOptions][]>();

/**
 * The number as shown and the options it is shown with: in a format with a `ladder`, the value in the largest unit it has
 * one whole of, or the next where rounding reaches it; then the step of `steps` its size in that unit reaches.
 */
function scaledOf(
  options: NumberFormatOptions | undefined,
  value: number | bigint,
  make: (options: Intl.NumberFormatOptions) => Intl.NumberFormat,
): [number | bigint, Intl.NumberFormatOptions | undefined] {
  const ladder = options?.ladder;
  if (ladder === undefined) return [value, stepOf(options, value, make)];
  let rungs = rungsOf.get(options!);
  if (rungs === undefined) {
    let size = 1;
    rungs = ladder.units.map((u, i) => {
      const { unit, per, ...own } = typeof u === 'string' ? { unit: u } : u;
      if (i > 0) size *= per ?? ladder.per ?? 1000;
      return [size, { ...options, ladder: undefined, style: 'unit', unit, ...own }];
    });
    rungsOf.set(options!, rungs);
  }
  const n = Number(value);
  for (let at = 0; ; at++) {
    const [size, own] = rungs[at]!;
    const next = rungs[at + 1]?.[0];
    const scaled = n / size;
    const shown = stepOf(own, scaled, make);
    // Up while it has one whole of the next unit, or rounds to one: 999,999 bytes is "1,000 kB", a megabyte.
    if (next === undefined || (Math.abs(n) < next && shownSize(make(shown!), Math.abs(scaled)) * size < next)) return [scaled, shown];
  }
}

/** What shows a number by a ladder of units: the generated index puts it in the catalog's `ladder`. */
export const numberLadder = scaledOf;

export type NumberLadderTool = typeof numberLadder;
