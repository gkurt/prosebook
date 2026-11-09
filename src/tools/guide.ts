/**
 * The writing guide `generate` writes for whoever writes the copy next, a person or an agent: what
 * the lint can't check, said before the writing. Where an entry goes, what each kind and surface is
 * for, and the rules that ask to be said: guidelines, which have no check, and checked rules marked
 * `guide`. What the lint checks is left to the lint, which says it with the fix.
 *
 * Generated so it says what the config says, and `generate --check` fails on one the config has moved past.
 */
import { relative } from 'node:path';

import {
  durationParts,
  formatIn,
  formatWith,
  type DurationFormatOptions,
  type NumberFormatOptions,
  type ListFormatOptions,
  type RelativeFormatOptions,
} from '#src/runtime/formats.ts';
import { joinList, shownItems } from '#src/runtime/helpers.ts';
import { numberLadder } from '#src/runtime/ladder.ts';
import { relativeText, type RelativeTools } from '#src/runtime/relative.ts';

import type { Message } from './catalog.ts';
import { renderer } from './compile.ts';
import type { ResolvedConfig, Severity } from './config.ts';
import { isGuideline, languageName, severityIn, type CheckRule } from './lint.ts';
import { addressIn, type Formality } from './presets.ts';
import { SYNTAX_NAME } from './syntax.ts';

const code = (s: string) => `\`${s}\``;
// Not Intl.ListFormat, whose English has the serial comma this prose doesn't.
const list = (items: string[], joiner = 'or') =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${joiner} ${items.at(-1)}`;

/** Which entries a rule reads, in words to lead its line: `On toast, not in native.*`. */
function scopeOf({ on }: CheckRule, offIn: string[], onlyIn: string[]): string | undefined {
  const areas = [...(on?.area ?? []), ...onlyIn];
  const parts = [
    on?.kind && `for ${list(on.kind.map(code))}`,
    on?.surface && `on ${list(on.surface.map(code))}`,
    areas.length > 0 && `in ${list(areas.map((a) => code(`${a}.*`)))}`,
    on?.locale === undefined ? undefined : on.locale === 'all' ? 'in every locale' : `in ${list(on.locale.map(code), 'and')}`,
    offIn.length > 0 ? `not in ${list(offIn.map((a) => code(`${a}.*`)))}` : undefined,
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return undefined;
  const scope = parts.join(', ');
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

/**
 * A number with a fraction, a whole one and a negative one under 1: formats that differ only in how
 * they write a whole amount (`trailingZeroDisplay`) or a negative one (`currencySign: 'accounting'`)
 * would look alike in the first.
 */
const SAMPLE_NUMBERS = [1234.5, 12, -0.25];
/**
 * The numbers a format is shown with: with a ladder, one of a few in each of its first units and one just under the
 * third, which rounding carries into it (999,999 bytes, "1 MB"), so a writer sees where each unit starts.
 */
function samplesOf(o: NumberFormatOptions): number[] {
  if (o.ladder === undefined) return SAMPLE_NUMBERS;
  let size = 1;
  const sizes = o.ladder.units
    .slice(0, 4)
    .map((u, i) => (size *= i === 0 ? 1 : ((typeof u === 'string' ? undefined : u.per) ?? o.ladder!.per ?? 1000)));
  const samples = [512, ...sizes.slice(1).map((s) => 1.5 * s)];
  if (sizes.length > 2) samples.splice(2, 0, sizes[2]! - 1);
  return samples;
}

const SAMPLE_DATE = new Date(Date.UTC(2026, 9, 28, 14, 5));

const SAMPLE_ITEMS = ['Ann', 'Bob', 'Cy', 'Dee'];
/**
 * Durations from under a second to over an hour: one alone would show "1h 2m" in most formats, as
 * rounding takes off the seconds, so a writer couldn't tell which keeps them, or their fraction.
 */
const SAMPLE_DURATIONS = [850, 4_237, 185_400, 3_725_400];
/**
 * How long ago each sample time is, in milliseconds: under a minute, minutes, a day, weeks, and
 * ahead, so a writer sees where now ends, which unit a time takes, and the future said.
 */
const SAMPLE_AGES = [20_000, 300_000, 93_600_000, 1_814_400_000, -7_200_000];
/** Between one sample and the next, where a format is shown with several. */
const SAMPLES = ' · ';
const MF2_FUNCTION: Record<string, string> = {
  number: 'number',
  date: 'datetime',
  list: 'list',
  duration: 'duration',
  relative: 'relative',
};

/** An entry's source as it reads given `values`, or nothing where the catalog has no entry of that key. */
type Say = (key: string, values: Record<string, unknown>) => string | undefined;

function sayer(config: ResolvedConfig, messages: readonly Message[]): Say {
  const byKey = new Map(messages.map((m) => [m.key, m]));
  return (key, values) => {
    const message = byKey.get(key);
    return message === undefined ? undefined : renderer(message.ast, config.source)(values);
  };
}

/** A list as a format shows it, the rest past `max` said by the entry `more` names. */
function sampleList(locale: string, o: ListFormatOptions, say: Say): string {
  const more = o.more;
  const rest = more === undefined ? undefined : (count: number) => say(more, { count }) ?? `… (${more} says the rest)`;
  const shown = joinList(shownItems(SAMPLE_ITEMS, o, rest), o, () => new Intl.ListFormat(locale, o));
  // A line of facts, whose optional ones the code leaves empty.
  return o.separator === undefined ? shown : `${shown}, an empty item left out`;
}

/** The sample durations as a format shows them: "850ms · 4.2s · 3m 5s · 1h 2m". */
function sampleDurations(locale: string, o: DurationFormatOptions): string {
  const shown = SAMPLE_DURATIONS.map((ms) => {
    const { parts, display } = durationParts(ms, o);
    // A Node or Bun without `Intl.DurationFormat` says the units it would show.
    if (typeof Intl.DurationFormat !== 'function') return JSON.stringify(parts);
    return new Intl.DurationFormat(locale, { ...o, ...display } as Intl.DurationFormatOptions).format(parts);
  });
  return shown.join(SAMPLES);
}

/** The sample times as a format shows them from the sample date, in UTC: "now · 5 minutes ago · yesterday · …". */
function sampleRelative(config: ResolvedConfig, o: RelativeFormatOptions, say: Say): string {
  const locale = config.source;
  const tools: RelativeTools = {
    locale,
    timeZone: 'UTC',
    formatters: config.formatters?.table,
    date: (at, format) => {
      const opts = typeof format === 'string' ? (formatIn(config.formats, 'date', format, locale) ?? {}) : format;
      if (opts.formatter !== undefined)
        return formatWith(config.formatters?.table, 'date', opts.formatter, at, { locale, timeZone: 'UTC' });
      return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(at);
    },
  };
  const now = SAMPLE_DATE.getTime();
  const entry = o.now;
  // Now as the entry says it, ahead of time too where that reads otherwise: "just now / in a moment".
  const said =
    entry === undefined
      ? undefined
      : () => {
          const [past, future] = (['past', 'future'] as const).map((tense) => say(entry, { tense }));
          if (past === undefined) return `(${entry} says now)`;
          return future === undefined || future === past ? past : `${past} / ${future}`;
        };
  try {
    return SAMPLE_AGES.map((ago) => relativeText(now - ago, o, now, tools, said).text).join(SAMPLES);
  } catch (e) {
    return `(throws: ${(e as Error).message})`;
  }
}

/** A sample as the app's own formatter shows it in the source, or what it throws. */
function sampleOwn(config: ResolvedConfig, kind: 'number' | 'date', name: string, value: number | Date): string {
  try {
    return formatWith(config.formatters?.table, kind, name, value, { locale: config.source, timeZone: 'UTC' });
  } catch (e) {
    return `(throws: ${(e as Error).message})`;
  }
}

/** The formats the config names, each with what it shows in the source, so a number or date is written in one of them. */
function formatsSection(config: ResolvedConfig, say: Say): string[] {
  const { number = {}, date = {}, list: lists = {}, duration = {}, relative: relatives = {} } = config.formats;
  const rows = [
    ...Object.entries(number).map(([name, o]) => [
      name,
      'number',
      samplesOf(o)
        .map((n) => {
          if (o.formatter !== undefined) return sampleOwn(config, 'number', o.formatter, n);
          const make = (options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(config.source, options);
          const [shown, options] = numberLadder(o, n, make);
          return make(options).format(shown);
        })
        .join(SAMPLES),
    ]),
    // In UTC, so the guide is the same wherever it is generated.
    ...Object.entries(date).map(([name, o]) => [
      name,
      'date',
      o.formatter === undefined
        ? new Intl.DateTimeFormat(config.source, { timeZone: 'UTC', ...o }).format(SAMPLE_DATE)
        : sampleOwn(config, 'date', o.formatter, SAMPLE_DATE),
    ]),
    ...Object.entries(lists).map(([name, o]) => [name, 'list', sampleList(config.source, o, say)]),
    ...Object.entries(duration).map(([name, o]) => [name, 'duration', sampleDurations(config.source, o)]),
    ...Object.entries(relatives).map(([name, o]) => [name, 'relative', sampleRelative(config, o, say)]),
  ];
  if (rows.length === 0) return [];
  const [name, kind] = rows[0]!;
  const example = config.messageFormat === 2 ? `{$value :${MF2_FUNCTION[kind!]} format=${name}}` : `{value, ${kind}, ${name}}`;
  return [
    '',
    '## Formats',
    '',
    `A number, date, list, duration or relative time is shown in a format the config names, so it reads the same on every page: ${code(example)}. Name the one that fits rather than writing its options in the message; one the config lacks is added there.`,
    '',
    ...rows.map(([n, k, shown]) => `- ${code(n!)} (${k}): ${shown}`),
  ];
}

const adverb = (form: Formality) => (form === 'formal' ? 'formally' : 'informally');

/**
 * The form of `you` in every locale, and in each that takes its own, in words for the writer of each.
 * Each language's own form is said only where the catalog has translations, which a catalog in
 * English alone, with one `you`, has none of.
 */
function addressing(formality: Record<string, Formality>, source: string, translated: boolean): string[] {
  const { '*': every, ...locales } = formality;
  const out: string[] = [];
  if (every !== undefined) {
    const inSource = addressIn(every, source);
    const inEach = translated ? ", in each language's own form of `you`" : '';
    out.push(`The copy addresses the reader ${adverb(every)}${inEach}.${inSource === undefined ? '' : ` ${inSource}`}`, '');
  }
  const own = Object.entries(locales);
  if (own.length === 0) return out;
  out.push(every === undefined ? 'The form of `you`:' : 'Except:', '');
  for (const [locale, form] of own)
    out.push(`- ${languageName(locale)} (${code(locale)}): ${addressIn(form, locale) ?? `the reader is addressed ${adverb(form)}.`}`);
  out.push('');
  return out;
}

/** The tone the presets and the config give, with its examples, and each area's that differs. */
function toneSection(config: ResolvedConfig, translations: readonly string[]): string[] {
  const { tone } = config;
  const areas = Object.entries(tone.areas);
  const formality = addressing(tone.formality, config.source, translations.length > 0);
  if (tone.doc === undefined && tone.notes === undefined && formality.length === 0 && areas.length === 0) return [];
  const out = ['', '## Tone', ''];
  const said = [tone.doc, tone.notes].filter((s): s is string => s !== undefined);
  if (said.length > 0) out.push(said.join(' '), '');
  out.push(...formality);
  if (tone.examples.length > 0) {
    out.push('As it reads:', '');
    for (const { kind, surface, say, not } of tone.examples)
      out.push(`- ${code(kind)} on ${code(surface)}: "${say}"${not === undefined ? '' : `, not "${not}"`}`);
    out.push('');
  }
  for (const [area, own] of areas) {
    const named = own.presets.at(-1);
    const head = `In ${code(`${area}.*`)}${named === undefined ? '' : `, ${named}`}:`;
    const parts = [
      own.doc !== tone.doc ? own.doc : undefined,
      own.formality['*'] !== tone.formality['*'] && own.formality['*'] !== undefined
        ? `The reader is addressed ${adverb(own.formality['*'])}.`
        : undefined,
    ];
    out.push([head, ...parts.filter((p): p is string => p !== undefined)].join(' '), '');
  }
  out.pop();
  return out;
}

/**
 * The guide, as Markdown, for a catalog translated into `translations` (none: the source alone), whose
 * `messages` say the entries formats name (a list's `more`, a relative time's `now`) in its samples.
 */
export function writingGuide(config: ResolvedConfig, translations: readonly string[] = [], messages: readonly Message[] = []): string {
  const catalog = relative(config.root, config.catalog).replaceAll('\\', '/') || '.';
  const holds = `the message under ${code(config.source)}, in ${SYNTAX_NAME[config.messageFormat]}`;
  const context = config.require.includes('context')
    ? `${holds}, a \`context\` sentence saying where it appears, and under \`args\` what each placeholder holds`
    : holds;
  const out = [
    '<!-- Generated by `prosebook generate` from the config. Do not edit: change the config. -->',
    // Markdown has comments that skip a range, which oxfmt, Prettier and `bun fmt` read alike.
    '<!-- markdownlint-disable -->',
    '<!-- prettier-ignore-start -->',
    '',
    '# Writing the copy',
    '',
    'Read this before adding or changing an entry in the catalog. It says what the lint cannot check; `prosebook lint` checks the rest.',
    '',
    `Every string a person reads is an entry in \`${catalog}/<area>.yaml\`, in ${languageName(config.source)}, read from the code by its key. A key's first segment names its file: \`cart.items\` lives in \`cart.yaml\`. An entry holds ${context}. Give it a \`kind\` and a \`surface\` from the lists below.${
      config.extract.shared === undefined
        ? ''
        : ` Words several features say, \`Cancel\` and \`Loading…\`, are one entry in \`${config.extract.shared}.yaml\`: read that one rather than adding another.`
    }`,
    '',
    'Before adding an entry, look for one that says it already: `prosebook find "Save changes" --kind action --surface action`. Read the one it names rather than adding another, unless it means something else there.',
    '',
    '## Kinds',
    '',
    ...Object.entries(config.kinds).map(([name, kind]) => `- ${code(name)}: ${kind.doc}`),
    '',
    '## Surfaces',
    '',
    ...Object.entries(config.surfaces).map(([name, doc]) => `- ${code(name)}: ${doc}`),
  ];

  out.push(...formatsSection(config, sayer(config, messages)));

  out.push(...toneSection(config, translations));

  // A rule off but in the areas that turn it on, as an area's preset does, is said for those.
  const inAreas = (name: string, severity: Severity) =>
    Object.entries(config.lint.areas).flatMap(([area, set]) => {
      const own = severityIn(set, name);
      return (severity === 'off' ? own !== undefined && own !== 'off' : own === 'off') ? [area] : [];
    });
  const guided = Object.entries(config.lint.rules).filter(
    ([name, { rule, severity }]) => rule.guide === true && (severity !== 'off' || inAreas(name, severity).length > 0),
  );
  if (guided.length > 0) {
    out.push('', '## Guidelines', '');
    for (const [name, { rule, severity }] of guided) {
      const areas = inAreas(name, severity);
      const scope = severity === 'off' ? scopeOf(rule, [], areas) : scopeOf(rule, areas, []);
      out.push(`- ${scope === undefined ? '' : `${scope}: `}${rule.description}`);
    }
  }

  out.push(
    '',
    '## Before you finish',
    '',
    "Run `prosebook lint` and fix what it finds; `--fix` writes the fixes it offers. Where a rule is wrong about an entry, exempt the entry under `allow` with the reason. An entry's `comment` or `remove` is a request: make the change, then delete the field.",
    '',
  );
  if (config.judge === undefined || !guided.some(([, { rule }]) => isGuideline(rule))) return unformatted(out);
  out.push(
    'Then run `prosebook judge`, which asks a model whether each entry you changed keeps to the guidelines, and rewrite what it finds.',
    '',
  );
  return unformatted(out);
}

const unformatted = (lines: string[]) => [...lines, '<!-- prettier-ignore-end -->', ''].join('\n');
