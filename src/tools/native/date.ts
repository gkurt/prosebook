/**
 * A date format taken apart at build time, as `number.ts` takes numbers apart: the text between the
 * fields, how each field is written (a number, padded or not, or a name from a table), and the
 * locale's digits. Read from `Intl.DateTimeFormat` and checked against it on dates that cover every
 * month, weekday and hour before any code is written, so native code says what the browser says, or
 * the build says why it can't.
 *
 * Native code reads the fields of the date as the clock shows them in its time zone, and only the
 * Gregorian calendar: a format that names a time zone, or counts in another calendar, is refused.
 */

/** A part of a formatted date. */
export type DatePiece =
  | { type: 'text'; value: string }
  /** The field as a number, padded with zeros to `pad` digits. `year2` is the year's last two digits. */
  | { type: 'number'; field: 'year' | 'year2' | 'month' | 'day' | 'minute' | 'second'; pad: number }
  /** The hour on the locale's clock: 1 to 12 (`h12`), 0 to 11 (`h11`), 0 to 23 (`h23`) or 1 to 24 (`h24`). */
  | { type: 'hour'; cycle: HourCycle; pad: number }
  /**
   * The field as a name from `names`: a month's January first, a weekday's Sunday first, and the day
   * period's before noon, then after, or one for each hour of the day.
   */
  | { type: 'name'; field: 'month' | 'weekday' | 'dayPeriod'; names: string[] };

export type HourCycle = 'h11' | 'h12' | 'h23' | 'h24';

export interface DateSpec {
  pieces: DatePiece[];
  /** The numbering system's digits, 0 to 9, where it isn't ASCII's. */
  digits?: string[];
}

/** A date as the clock shows it. */
export interface DateFields {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday. */
  weekday: number;
}

/** Dates the spec must format as `Intl` does: every month and weekday, midnight, noon and the hours around them, and two-digit years. */
const SAMPLES: number[] = [
  Date.UTC(2001, 0, 5, 1, 2, 3),
  Date.UTC(2001, 10, 25, 13, 42, 53),
  Date.UTC(1999, 11, 31, 23, 59, 59),
  Date.UTC(2000, 1, 29, 0, 0, 0),
  Date.UTC(2024, 6, 4, 12, 0, 0),
  Date.UTC(2024, 6, 4, 12, 30, 5),
  Date.UTC(1970, 0, 1, 0, 0, 0),
  Date.UTC(2099, 8, 9, 9, 9, 9),
  Date.UTC(2010, 4, 15, 18, 45, 0),
  Date.UTC(2026, 2, 10, 6, 15, 30),
  Date.UTC(2005, 9, 31, 21, 7, 41),
  ...Array.from({ length: 12 }, (_, m) => Date.UTC(2023, m, 1 + m * 2, m * 2, m * 5, m * 4)),
  ...Array.from({ length: 24 }, (_, h) => Date.UTC(2022, 3, 3 + (h % 7), h, 30, 0)),
];

/** The fields of a date in UTC, which the spec is checked in. */
export function fieldsOf(date: number): DateFields {
  const d = new Date(date);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

const HOUR_CYCLES = new Set<string>(['h11', 'h12', 'h23', 'h24']);

/**
 * What a format with `options` takes in `locale`. Throws a sentence saying what a native target
 * can't reproduce, which the caller puts in front of a fix.
 */
export function dateSpec(locale: string, options: Intl.DateTimeFormatOptions = {}): DateSpec {
  if (options.timeZone !== undefined) throw new Error(`it names the time zone ${options.timeZone}, which native code can't look up`);
  const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  const resolved = format.resolvedOptions();
  if (resolved.calendar !== 'gregory' && resolved.calendar !== 'iso8601') throw new Error(`it counts in the ${resolved.calendar} calendar`);

  const native = new Intl.NumberFormat(locale, { numberingSystem: resolved.numberingSystem, useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, d) => native.format(d));
  const ascii = (text: string) => text.replace(/./gu, (c) => (digits.includes(c) ? String(digits.indexOf(c)) : c));
  /** The text `type` takes at `date`, in ASCII digits. */
  const partAt = (date: number, type: string) => ascii(format.formatToParts(date).find((p) => p.type === type)?.value ?? '');
  const isNumber = (text: string) => /^[0-9]+$/.test(text);
  const padOf = (date: number, type: string) => (partAt(date, type).startsWith('0') ? 2 : 1);

  const pieces: DatePiece[] = [];
  for (const part of format.formatToParts(SAMPLES[1])) {
    switch (part.type) {
      case 'literal':
        pieces.push({ type: 'text', value: part.value });
        break;
      case 'year':
        pieces.push(ascii(part.value) === '01' ? { type: 'number', field: 'year2', pad: 2 } : { type: 'number', field: 'year', pad: 1 });
        break;
      case 'month': {
        const names = Array.from(
          { length: 12 },
          (_, m) => format.formatToParts(Date.UTC(2023, m, 15, 12)).find((p) => p.type === 'month')!.value,
        );
        if (names.every((name) => isNumber(ascii(name))))
          pieces.push({ type: 'number', field: 'month', pad: padOf(Date.UTC(2023, 0, 15, 12), 'month') });
        else pieces.push({ type: 'name', field: 'month', names });
        break;
      }
      case 'day':
        pieces.push({ type: 'number', field: 'day', pad: padOf(Date.UTC(2023, 0, 5, 12), 'day') });
        break;
      case 'weekday':
        // 2023-01-01 is a Sunday.
        pieces.push({
          type: 'name',
          field: 'weekday',
          names: Array.from(
            { length: 7 },
            (_, d) => format.formatToParts(Date.UTC(2023, 0, 1 + d, 12)).find((p) => p.type === 'weekday')!.value,
          ),
        });
        break;
      case 'hour': {
        const cycle = resolved.hourCycle;
        if (cycle === undefined || !HOUR_CYCLES.has(cycle)) throw new Error('its hours follow no clock native code knows');
        pieces.push({ type: 'hour', cycle, pad: padOf(Date.UTC(2023, 0, 5, 1), 'hour') });
        break;
      }
      case 'minute':
      case 'second':
        pieces.push({ type: 'number', field: part.type, pad: padOf(Date.UTC(2023, 0, 5, 1, 5, 5), part.type) });
        break;
      case 'dayPeriod': {
        const byHour = Array.from(
          { length: 24 },
          (_, hour) => format.formatToParts(Date.UTC(2023, 0, 5, hour, 30)).find((p) => p.type === 'dayPeriod')!.value,
        );
        // Before noon and after, or a period by the hour (`zh-TW`'s 晚上, English's "at night").
        const halves = byHour.every((name, hour) => name === byHour[hour < 12 ? 0 : 12]);
        pieces.push({ type: 'name', field: 'dayPeriod', names: halves ? [byHour[0]!, byHour[12]!] : byHour });
        break;
      }
      case 'era':
      case 'fractionalSecond':
      case 'timeZoneName':
      case 'unknown':
      // A calendar's own parts, such as `relatedYear`, which the calendar check has already refused.
      default:
        throw new Error(`it writes the ${part.type as string}, which native code can't`);
    }
  }
  const spec: DateSpec = { pieces, ...(digits.join('') !== '0123456789' && { digits }) };
  for (const sample of SAMPLES) {
    const expected = format.format(sample);
    const actual = formatDate(spec, fieldsOf(sample));
    if (actual !== expected)
      throw new Error(`it writes ${new Date(sample).toISOString()} as "${expected}", which native code would write as "${actual}"`);
  }
  return spec;
}

/** The hour as a clock with `cycle` shows it. */
export function hourOn(cycle: HourCycle, hour: number): number {
  if (cycle === 'h23') return hour;
  if (cycle === 'h24') return hour === 0 ? 24 : hour;
  if (cycle === 'h11') return hour % 12;
  return ((hour + 11) % 12) + 1;
}

/** A date field as a target reads it, an integer expression. */
export type FieldAccess = (field: keyof DateFields) => string;

/**
 * A piece's number, or a name piece's index into its names, as an expression in the integer
 * arithmetic Rust, Swift and Kotlin share. Keep in step with `formatDate`.
 */
export function pieceExpr(piece: Exclude<DatePiece, { type: 'text' }>, at: FieldAccess): string {
  if (piece.type === 'hour') {
    const hour = at('hour');
    if (piece.cycle === 'h23') return hour;
    if (piece.cycle === 'h24') return `(${hour} + 23) % 24 + 1`;
    return piece.cycle === 'h11' ? `${hour} % 12` : `(${hour} + 11) % 12 + 1`;
  }
  if (piece.type === 'number') return piece.field === 'year2' ? `(${at('year')} % 100 + 100) % 100` : at(piece.field);
  if (piece.field === 'month') return `${at('month')} - 1`;
  if (piece.field === 'weekday') return at('weekday');
  return piece.names.length === 24 ? at('hour') : `${at('hour')} / 12`;
}

/** Which of a name piece's `count` names `date` takes. */
function nameIndex(field: 'month' | 'weekday' | 'dayPeriod', count: number, date: DateFields): number {
  if (field === 'month') return date.month - 1;
  if (field === 'weekday') return date.weekday;
  return count === 24 ? date.hour : date.hour < 12 ? 0 : 1;
}

/** `date` as the spec writes it: the reference for the code each target generates. */
export function formatDate(spec: DateSpec, date: DateFields): string {
  const digits = spec.digits;
  const number = (value: number, pad: number) => {
    const text = String(value).padStart(pad, '0');
    return digits === undefined ? text : text.replace(/[0-9]/g, (d) => digits[Number(d)]!);
  };
  return spec.pieces
    .map((piece) => {
      if (piece.type === 'text') return piece.value;
      if (piece.type === 'hour') return number(hourOn(piece.cycle, date.hour), piece.pad);
      if (piece.type === 'number') return number(piece.field === 'year2' ? ((date.year % 100) + 100) % 100 : date[piece.field], piece.pad);
      return piece.names[nameIndex(piece.field, piece.names.length, date)]!;
    })
    .join('');
}
