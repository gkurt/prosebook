/**
 * The writing guide `generate` writes for whoever writes the copy next, a person or an agent: what
 * the lint can't check, said before the writing. Where an entry goes, what each kind and surface is
 * for, and the rules that ask to be said: guidelines, which have no check, and checked rules marked
 * `guide`. What the lint checks is left to the lint, which says it with the fix.
 *
 * Generated so it says what the config says, and `generate --check` fails on one the config has moved past.
 */
import { relative } from 'node:path';

import { durationParts, formatWith, stepOf, type DurationFormatOptions, type ListFormatOptions } from '#src/runtime/formats.ts';
import { shownItems } from '#src/runtime/helpers.ts';

import type { ResolvedConfig, Severity } from './config.ts';
import { isGuideline, languageName, severityIn, type CheckRule } from './lint.ts';
import { formalityOf } from './presets.ts';
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
const SAMPLE_DATE = new Date(Date.UTC(2026, 9, 28, 14, 5));

const SAMPLE_ITEMS = ['Ann', 'Bob', 'Cy', 'Dee'];
/**
 * Durations from under a second to over an hour: one alone would show "1h 2m" in most formats, as
 * rounding takes off the seconds, so a writer couldn't tell which keeps them, or their fraction.
 */
const SAMPLE_DURATIONS = [850, 4_237, 185_400, 3_725_400];
/** Between one sample and the next, where a format is shown with several. */
const SAMPLES = ' · ';
const MF2_FUNCTION: Record<string, string> = { number: 'number', date: 'datetime', list: 'list', duration: 'duration' };

/** A list as a format shows it, the rest past `max` named by the entry that says it. */
function sampleList(locale: string, o: ListFormatOptions): string {
  const rest = o.more === undefined ? undefined : () => `… (${o.more} says the rest)`;
  return new Intl.ListFormat(locale, o).format(shownItems(SAMPLE_ITEMS, o, rest));
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

/** A sample as the app's own formatter shows it in the source, or what it throws. */
function sampleOwn(config: ResolvedConfig, kind: 'number' | 'date', name: string, value: number | Date): string {
  try {
    return formatWith(config.formatters?.table, kind, name, value, { locale: config.source, timeZone: 'UTC' });
  } catch (e) {
    return `(throws: ${(e as Error).message})`;
  }
}

/** The formats the config names, each with what it shows in the source, so a number or date is written in one of them. */
function formatsSection(config: ResolvedConfig): string[] {
  const { number = {}, date = {}, list: lists = {}, duration = {} } = config.formats;
  const rows = [
    ...Object.entries(number).map(([name, o]) => [
      name,
      'number',
      SAMPLE_NUMBERS.map((n) => {
        if (o.formatter !== undefined) return sampleOwn(config, 'number', o.formatter, n);
        const make = (options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(config.source, options);
        return make(stepOf(o, n, make)).format(n);
      }).join(SAMPLES),
    ]),
    // In UTC, so the guide is the same wherever it is generated.
    ...Object.entries(date).map(([name, o]) => [
      name,
      'date',
      o.formatter === undefined
        ? new Intl.DateTimeFormat(config.source, { timeZone: 'UTC', ...o }).format(SAMPLE_DATE)
        : sampleOwn(config, 'date', o.formatter, SAMPLE_DATE),
    ]),
    ...Object.entries(lists).map(([name, o]) => [name, 'list', sampleList(config.source, o)]),
    ...Object.entries(duration).map(([name, o]) => [name, 'duration', sampleDurations(config.source, o)]),
  ];
  if (rows.length === 0) return [];
  const [name, kind] = rows[0]!;
  const example = config.messageFormat === 2 ? `{$value :${MF2_FUNCTION[kind!]} format=${name}}` : `{value, ${kind}, ${name}}`;
  return [
    '',
    '## Formats',
    '',
    `A number, date, list or duration is shown in a format the config names, so it reads the same on every page: ${code(example)}. Name the one that fits rather than writing its options in the message; one the config lacks is added there.`,
    '',
    ...rows.map(([n, k, shown]) => `- ${code(n!)} (${k}): ${shown}`),
  ];
}

/** The tone the presets and the config give, with its examples, and each area's that differs. */
function toneSection(config: ResolvedConfig): string[] {
  const { tone } = config;
  const areas = Object.entries(tone.areas);
  if (tone.doc === undefined && tone.notes === undefined && tone.formality === undefined && areas.length === 0) return [];
  const out = ['', '## Tone', ''];
  const said = [tone.doc, tone.notes].filter((s): s is string => s !== undefined);
  if (said.length > 0) out.push(said.join(' '), '');
  if (tone.formality !== undefined) out.push(`Translations address the reader with ${formalityOf(tone.formality)}.`, '');
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
      own.formality !== tone.formality && own.formality !== undefined
        ? `Translations address the reader with ${formalityOf(own.formality)}.`
        : undefined,
    ];
    out.push([head, ...parts.filter((p): p is string => p !== undefined)].join(' '), '');
  }
  out.pop();
  return out;
}

/** The guide, as Markdown. */
export function writingGuide(config: ResolvedConfig): string {
  const catalog = relative(config.root, config.catalog).replaceAll('\\', '/') || '.';
  const holds = `the message under ${code(config.source)}, in ${SYNTAX_NAME[config.messageFormat]}`;
  const context = config.require.includes('context')
    ? `${holds}, a \`context\` sentence saying where it appears, and under \`args\` what each placeholder holds`
    : holds;
  const out = [
    '<!-- Generated by `prosebook generate` from the config. Do not edit: change the config. -->',
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

  out.push(...formatsSection(config));

  out.push(...toneSection(config));

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
  if (config.judge === undefined || !guided.some(([, { rule }]) => isGuideline(rule))) return out.join('\n');
  out.push(
    'Then run `prosebook judge`, which asks a model whether each entry you changed keeps to the guidelines, and rewrite what it finds.',
    '',
  );
  return out.join('\n');
}
