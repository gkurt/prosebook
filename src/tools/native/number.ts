/**
 * A number format taken apart at build time, so native code can put it back together with no
 * formatter of its own: the digits to round to, the symbols, how integers group, and the text around
 * the number for each sign. Read from `Intl.NumberFormat` and checked against it before any code is
 * written, so a native target says what the browser says, or the build says why it can't.
 */

/** The text before and after the number. */
export type Affix = readonly [prefix: string, suffix: string];

export interface NumberSpec {
  minInt: number;
  minFrac: number;
  maxFrac: number;
  /** How far the decimal point moves right before rounding: 2 for a percent. */
  shift: number;
  /** Integer digits grouped from the right, `primary` then `secondary` at a time, once there are `primary + min` of them; `min` 0 never groups. */
  grouping: { primary: number; secondary: number; min: number };
  decimal: string;
  group: string;
  /** The numbering system's digits, 0 to 9, where it isn't ASCII's. */
  digits?: string[];
  positive: Affix;
  negative: Affix;
  /** A value that rounds to zero, by its sign. */
  zero: Affix;
  negativeZero: Affix;
  nan: string;
  infinity: string;
  negativeInfinity: string;
}

/** The plural operands' digits: rounded as `Intl.PluralRules` rounds before it selects. */
export interface Rounding {
  minFrac: number;
  maxFrac: number;
}

const NUMBER_PARTS = new Set(['integer', 'group', 'decimal', 'fraction']);

/** Values the spec must format as `Intl` does: signs, zeros, ties, grouping thresholds, every plural form a unit could take. */
const SAMPLES = [
  0,
  -0,
  1,
  -1,
  2,
  3,
  5,
  11,
  21,
  0.5,
  1.5,
  2.5,
  -2.5,
  0.125,
  0.0001,
  -0.0001,
  0.07,
  1.005,
  12.345,
  999.9999,
  1000,
  10000,
  100000,
  1234.5678,
  -1234.5678,
  1e6,
  123456789.987,
  1e21,
  NaN,
  Infinity,
  -Infinity,
];

function affixOf(parts: Intl.NumberFormatPart[]): Affix {
  const first = parts.findIndex((p) => NUMBER_PARTS.has(p.type));
  const last = parts.findLastIndex((p) => NUMBER_PARTS.has(p.type));
  const text = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p) => p.value)
      .join('');
  return [text(0, first), text(last + 1, parts.length)];
}

function partOf(parts: Intl.NumberFormatPart[], type: string): string | undefined {
  return parts.find((p) => p.type === type)?.value;
}

/**
 * What a format with `options` takes in `locale`. Throws a sentence saying what a native target
 * can't reproduce, which the caller puts in front of a fix.
 */
export function numberSpec(locale: string, options: Intl.NumberFormatOptions = {}): NumberSpec {
  const format = new Intl.NumberFormat(locale, options);
  const resolved = format.resolvedOptions();
  if (resolved.notation !== 'standard') throw new Error(`${resolved.notation} notation reads the size of the number at runtime`);
  if (resolved.minimumSignificantDigits !== undefined) throw new Error('significant digits round by the size of the number');
  if (resolved.roundingIncrement !== 1 || resolved.roundingMode !== 'halfExpand')
    throw new Error('it rounds other than half away from zero');
  if (resolved.trailingZeroDisplay !== 'auto') throw new Error('it drops trailing zeros by value');

  const at = (more: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, { ...options, ...more });
  const whole = at({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const integers = whole
    .formatToParts(1234567891234)
    .filter((p) => p.type === 'integer')
    .map((p) => p.value.length);
  const grouped = (digits: number) =>
    whole.formatToParts(10 ** (digits - 1 - (resolved.style === 'percent' ? 2 : 0))).some((p) => p.type === 'group');
  const primary = integers.at(-1) ?? 3;
  const secondary = integers.length > 2 ? integers.at(-2)! : primary;
  const min = integers.length < 2 ? 0 : ([1, 2, 3, 4].find((m) => grouped(primary + m)) ?? 0);

  const native = new Intl.NumberFormat(locale, { numberingSystem: resolved.numberingSystem, useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, d) => native.format(d));
  const spec: NumberSpec = {
    minInt: resolved.minimumIntegerDigits,
    minFrac: resolved.minimumFractionDigits ?? 0,
    maxFrac: resolved.maximumFractionDigits ?? 0,
    shift: resolved.style === 'percent' ? 2 : 0,
    grouping: { primary, secondary, min },
    decimal: partOf(at({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).formatToParts(1.5), 'decimal') ?? '.',
    group: partOf(whole.formatToParts(1234567891234), 'group') ?? ',',
    ...(digits.join('') !== '0123456789' && { digits }),
    positive: affixOf(format.formatToParts(1)),
    negative: affixOf(format.formatToParts(-1)),
    zero: affixOf(format.formatToParts(0)),
    negativeZero: affixOf(format.formatToParts(-0)),
    nan: format.format(NaN),
    infinity: format.format(Infinity),
    negativeInfinity: format.format(-Infinity),
  };
  for (const sample of SAMPLES) {
    const expected = format.format(sample);
    const actual = formatNumber(spec, sample);
    if (actual !== expected) throw new Error(`it writes ${sample} as "${expected}", which native code would write as "${actual}"`);
  }
  return spec;
}

/** How `Intl.PluralRules` rounds before it selects, with `options` (MF2's selector options) in `locale`. */
export function roundingOf(locale: string, options: Intl.PluralRulesOptions = {}): Rounding {
  const resolved = new Intl.PluralRules(locale, options).resolvedOptions();
  if (resolved.minimumSignificantDigits !== undefined) throw new Error('significant digits select by the size of the number');
  return { minFrac: resolved.minimumFractionDigits ?? 0, maxFrac: resolved.maximumFractionDigits ?? 3 };
}

/**
 * The digits of a finite, non-negative double as the shortest decimal that reads back as it, which
 * is what `Intl` rounds: 1.005 is 1.00499… in binary, and still rounds to 1.01. Every target's
 * shortest form (`String()` here) may use an exponent, which moves the point.
 */
export function shortestDigits(value: number): { int: string; frac: string } {
  const [mantissa = '', exponent = '0'] = String(value).split('e');
  const [int = '', frac = ''] = mantissa.split('.');
  const point = int.length + Number(exponent);
  const all = int + frac;
  if (point <= 0) return { int: '0', frac: '0'.repeat(-point) + all };
  return { int: all.slice(0, point).padEnd(point, '0'), frac: all.slice(point) };
}

/**
 * Exact digits moved `shift` places right, rounded half away from zero to `maxFrac`, with trailing
 * zeros cut down to `minFrac`. The algorithm every target writes out; keep them in step.
 */
export function roundDigits(int: string, frac: string, shift: number, minFrac: number, maxFrac: number): { int: string; frac: string } {
  const padded = frac.padEnd(shift, '0');
  const whole = int + padded.slice(0, shift);
  const rest = padded.slice(shift);
  const kept = (whole + rest.slice(0, maxFrac).padEnd(maxFrac, '0')).split('').map(Number);
  if ((rest[maxFrac] ?? '0') >= '5') {
    let at = kept.length - 1;
    while (at >= 0 && kept[at] === 9) kept[at--] = 0;
    if (at < 0) kept.unshift(1);
    else kept[at]!++;
  }
  const all = kept.join('');
  let outFrac = all.slice(all.length - maxFrac);
  while (outFrac.length > minFrac && outFrac.endsWith('0')) outFrac = outFrac.slice(0, -1);
  return { int: all.slice(0, all.length - maxFrac).replace(/^0+/, ''), frac: outFrac };
}

function groupDigits(int: string, { primary, secondary, min }: NumberSpec['grouping'], separator: string): string {
  if (min === 0 || int.length < primary + min) return int;
  const groups = [int.slice(-primary)];
  let rest = int.slice(0, -primary);
  while (rest.length > secondary) {
    groups.unshift(rest.slice(-secondary));
    rest = rest.slice(0, -secondary);
  }
  groups.unshift(rest);
  return groups.join(separator);
}

/** `value` as the spec writes it: the reference for the code each target generates. */
export function formatNumber(spec: NumberSpec, value: number): string {
  if (Number.isNaN(value)) return spec.nan;
  if (!Number.isFinite(value)) return value > 0 ? spec.infinity : spec.negativeInfinity;
  const shortest = shortestDigits(Math.abs(value));
  const { int, frac } = roundDigits(shortest.int, shortest.frac, spec.shift, spec.minFrac, spec.maxFrac);
  const negative = value < 0 || Object.is(value, -0);
  const zero = /^0*$/.test(int + frac);
  const [prefix, suffix] = zero ? (negative ? spec.negativeZero : spec.zero) : negative ? spec.negative : spec.positive;
  const shown =
    groupDigits(int.padStart(Math.max(spec.minInt, 1), '0'), spec.grouping, spec.group) + (frac === '' ? '' : spec.decimal + frac);
  const digits = spec.digits;
  return prefix + (digits === undefined ? shown : shown.replace(/[0-9]/g, (d) => digits[Number(d)]!)) + suffix;
}
