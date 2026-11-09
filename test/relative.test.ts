import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  createCopy,
  createHelpers,
  defineCatalog,
  flatten,
  relativeTime,
  type Catalog,
  type Formats,
  type RelativeFormatOptions,
} from 'prosebook';
import { generate, loadCatalog, readMessage, writeMessage, type ProsebookConfig } from 'prosebook/tools';

import { relativeOf } from '#src/runtime/relative.ts';
import type { Entry } from '#src/tools/compile.ts';
import { formatsCode } from '#src/tools/generate.ts';
import { writingGuide } from '#src/tools/guide.ts';
import { argsOf, formatProblems } from '#src/tools/icu.ts';
import { pseudoAst } from '#src/tools/pseudo.ts';
import { formattedInCode } from '#src/tools/scan.ts';
import { cli, compiled, fixture } from './fixture.ts';

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;

const formats = {
  date: { day: { dateStyle: 'medium', timeZone: 'UTC' } },
  relative: {
    recent: { now: { entry: 'time.now' }, date: { after: 7 * D, format: 'day' } },
    terse: { style: 'narrow', smallest: 'second', largest: 'day', numeric: 'always' },
  },
} as const satisfies ProsebookConfig['formats'];

/** What a time `ago` milliseconds back (ahead, below 0) reads as, by the default format or `options`. */
const shown = (ago: number, options?: RelativeFormatOptions) => relativeOf(NOW - ago, NOW, options).shown;

describe('which unit a time is counted in, and how it rounds', () => {
  test.each([
    [0, { now: 'past' }],
    [20 * S, { now: 'past' }],
    [59 * S, { now: 'past' }],
    [60 * S, { unit: 'minute', value: -1 }],
    [89 * S, { unit: 'minute', value: -1 }],
    [90 * S, { unit: 'minute', value: -2 }],
    // Rounding reaches the unit above: 59 minutes and 40 seconds is an hour.
    [59 * MIN + 40 * S, { unit: 'hour', value: -1 }],
    [5 * H, { unit: 'hour', value: -5 }],
    [23 * H + 40 * MIN, { unit: 'day', value: -1 }],
    [36 * H, { unit: 'day', value: -2 }],
    [6 * D + 13 * H, { unit: 'week', value: -1 }],
    [25 * D, { unit: 'week', value: -4 }],
    [31 * D, { unit: 'month', value: -1 }],
    // A month is 30 days and a year 365, so 12 months of 30 days aren't yet a year.
    [355 * D, { unit: 'month', value: -12 }],
    [365 * D, { unit: 'year', value: -1 }],
    [3 * 365 * D, { unit: 'year', value: -3 }],
  ])('%p ms ago reads as %p', (ago, expected) => {
    expect(shown(ago)).toEqual(expected as never);
  });

  test.each([
    [-20 * S, { now: 'future' }],
    [-61 * S, { unit: 'minute', value: 1 }],
    [-2 * H, { unit: 'hour', value: 2 }],
    [-(23 * H + 40 * MIN), { unit: 'day', value: 1 }],
    [-10 * D, { unit: 'week', value: 1 }],
  ])('%p ms ahead reads as %p', (ago, expected) => {
    expect(shown(ago)).toEqual(expected as never);
  });

  test.each([
    // [ago, options, expected]
    [36 * H, { rounding: 'down' }, { unit: 'day', value: -1 }],
    [23 * H + 40 * MIN, { rounding: 'down' }, { unit: 'hour', value: -23 }],
    [10 * D, { largest: 'day' }, { unit: 'day', value: -10 }],
    [100 * D, { skip: [] }, { unit: 'quarter', value: -1 }],
    [10 * D, { skip: ['week'] }, { unit: 'day', value: -10 }],
    [20 * S, { smallest: 'second' }, { unit: 'second', value: -20 }],
    [10 * MIN, { smallest: 'hour' }, { now: 'past' }],
    [8 * D, { date: { after: 7 * D, format: {} } }, { date: true }],
    [-8 * D, { date: { after: 7 * D, format: {} } }, { date: true }],
    [6 * D, { date: { after: 7 * D, format: {} } }, { unit: 'day', value: -6 }],
  ] as const)('%p ms ago, with %p, reads as %p', (ago, options, expected) => {
    expect(shown(ago, options as RelativeFormatOptions)).toEqual(expected as never);
  });
});

describe('when a time next reads differently', () => {
  test.each([
    // [ago, options, in how long it changes, what it says then]
    [0, {}, 60 * S, '1 minute ago'],
    [59 * S, {}, 1 * S, '1 minute ago'],
    [60 * S, {}, 30 * S, '2 minutes ago'],
    [3 * H, {}, 30 * MIN, '4 hours ago'],
    [3 * H, { rounding: 'down' }, 1 * H, '4 hours ago'],
    [36 * H, {}, 24 * H, '3 days ago'],
    // Ahead of now, a count rounding half away from zero changes a moment past its half.
    [-2 * H, {}, 30 * MIN + 1, 'in 1 hour'],
    [-(23 * H + 40 * MIN), {}, 10 * MIN + 1, 'in 23 hours'],
    [-20 * S, {}, 20 * S, 'now'],
    [-8 * D, { date: { after: 7 * D, format: {} } }, 1 * D + 1, 'next week'],
    [6 * D + 12 * H, { date: { after: 7 * D, format: {} } }, 12 * H, '11/3/2026'],
  ] as const)('%p ms ago, with %p, changes in %p ms, to %p', (ago, options, after, then) => {
    const at = NOW - ago;
    const { next } = relativeOf(at, NOW, options);
    expect(next! - NOW).toBe(after);
    const helpers = createHelpers('en', { now: () => next!, timeZone: 'UTC', relative: relativeTime });
    expect(helpers.r(at, options as RelativeFormatOptions)).toBe(then);
  });

  test('a time past the switch to a date never changes again', () => {
    expect(relativeOf(NOW - 8 * D, NOW, { date: { after: 7 * D, format: {} } }).next).toBeUndefined();
  });
});

/** A message read in a locale with the formats above, rendered at `NOW` with `values`. */
function render(version: 1 | 2, text: string, locale: string, values: Record<string, unknown>) {
  const ast = readMessage(version, text, locale, { formats, isolate: false });
  const { m } = compiled([['m', ast]]);
  return typeof m === 'string'
    ? m
    : flatten(m!(values, createHelpers(locale, { now: () => NOW, timeZone: 'UTC', relative: relativeTime }))).join('');
}

describe('a relative time in a message', () => {
  test.each([
    // [syntax, message, locale, how long ago, what it reads]
    [1, 'Opened {at, relative}', 'en', 3 * D, 'Opened 3 days ago'],
    [1, 'Opened {at, relative}', 'en', 1 * D, 'Opened yesterday'],
    [1, 'Opened {at, relative}', 'en', 20 * S, 'Opened now'],
    [1, 'Due {at, relative}', 'en', -2 * H, 'Due in 2 hours'],
    [1, '{at, relative, short}', 'en', 3 * MIN, '3 min. ago'],
    [1, '{at, relative, terse}', 'en', 20 * S, '20s ago'],
    [1, '{at, relative, terse}', 'en', 1 * D, '1d ago'],
    [1, 'Geöffnet {at, relative}', 'de', 3 * D, 'Geöffnet vor 3 Tagen'],
    [1, 'Geöffnet {at, relative}', 'de', 1 * D, 'Geöffnet gestern'],
    [1, '{at, relative}', 'de', -2 * D, 'übermorgen'],
    [1, '{at, relative}', 'ja', 5 * H, '5 時間前'],
    [2, 'Opened {$at :relative}', 'en', 3 * D, 'Opened 3 days ago'],
    [2, '{$at :relative style=narrow}', 'en', 5 * H, '5h ago'],
    [2, '{$at :relative format=terse}', 'en', 1 * D, '1d ago'],
  ] as const)('MF%p %p in %p, %p ms ago, reads %p', (version, text, locale, ago, expected) => {
    expect(render(version, text, locale, { at: NOW - ago })).toBe(expected);
  });

  test('takes a Date, milliseconds or an ISO string, and shows its fallback for anything else', () => {
    const at = NOW - 2 * H;
    for (const value of [at, new Date(at), new Date(at).toISOString()])
      expect(render(1, 'Opened {at, relative}', 'en', { at: value })).toBe('Opened 2 hours ago');
    expect(render(1, 'Opened {at, relative}', 'en', { at: 'last week' })).toBe('Opened {at}');
    expect(render(1, 'Opened {at, relative}', 'en', {})).toBe('Opened {at}');
  });

  test('is typed as a time, and a style no one knows is refused with the fix', () => {
    expect(argsOf(readMessage(1, '{at, relative}', 'en'))).toEqual(new Map([['at', 'Date | number | string']]));
    expect(argsOf(readMessage(2, '{$at :relative}', 'en'))).toEqual(new Map([['at', 'Date | number | string']]));
    expect(formatProblems(readMessage(1, '{at, relative, digital}', 'en'))).toEqual([
      '{at} asks for relative style "digital": long, short, narrow, or a format formats.relative names',
    ]);
  });

  test('migrates between the syntaxes', () => {
    const one = '{at, relative} {at, relative, recent} {at, relative, narrow}';
    const two = '{$at :relative} {$at :relative format=recent} {$at :relative style=narrow}';
    const options = { formats, isolate: false } as const;
    expect(writeMessage(2, readMessage(1, one, 'en', options), 'en')).toBe(two);
    expect(writeMessage(1, readMessage(2, two, 'en', options), 'en')).toBe(one);
  });

  test('native targets refuse it with the fix', () => {
    const native = (language: 'android' | 'rust') =>
      fixture(
        { 'copy/catalog/app.yaml': 'app.a: "Opened {at, relative}"\n' },
        { require: [], native: [{ language, out: language === 'android' ? 'android/res' : 'native/copy.rs' }] },
      );
    expect(() => generate(native('android'))).toThrow("{at} is a relative time, which Android resources don't format");
    expect(() => generate(native('rust'))).toThrow('{at} is a relative time, which native code does not format');
  });
});

const CONFIG = { require: [], formats } satisfies ProsebookConfig;

/** A project saying times in English and German, with `now` said by an entry, and a copy over it at `now`. */
function project(nowEntry = '"{tense, select, future {in a moment} other {just now}}"') {
  const config = fixture(
    {
      'copy/catalog/time.yaml': [`time.now: ${nowEntry}`, ''].join('\n'),
      'copy/catalog/pr.yaml': ['pr.opened: "Opened {at, relative, recent}"', 'pr.updated: "Updated {at, relative}"', ''].join('\n'),
      'copy/locales/de.yaml':
        'pr.opened: "Geöffnet {at, relative, recent}"\ntime.now: "{tense, select, future {gleich} other {gerade eben}}"\n',
      'src/App.tsx': "export const App = ({ t }) => [t('pr.opened'), t('pr.updated')];\n",
      'prosebook.config.json': JSON.stringify(CONFIG),
    },
    CONFIG,
  );
  // Partial, so a broken entry's problems are reported rather than thrown.
  const catalog = loadCatalog(config, undefined, { partial: true });
  const entries = (locale: string): Entry[] =>
    catalog.messages.flatMap((m): Entry[] => {
      const ast = locale === 'en' ? m.ast : m.translations.get(locale)?.ast;
      return ast === undefined ? [] : [[m.key, ast]];
    });
  const messages = { en: compiled(entries('en')), de: compiled(entries('de')) };
  const made: Catalog = defineCatalog({
    source: 'en',
    locales: ['en', 'de'],
    messages,
    loaders: {},
    formats: config.formats,
    relative: relativeTime,
  });
  return { config, catalog, made };
}

describe('a relative format the config names', () => {
  test('says now with its entry, in each locale, and a date past its distance', async () => {
    const { made } = project();
    const copy = createCopy(made, { now: () => NOW, timeZone: 'UTC' });
    const opened = (ago: number) => copy.t('pr.opened', { at: NOW - ago });
    expect([20 * S, -20 * S, 5 * MIN, 2 * D, 8 * D].map(opened)).toEqual([
      'Opened just now',
      'Opened in a moment',
      'Opened 5 minutes ago',
      'Opened 2 days ago',
      'Opened Nov 1, 2026',
    ]);
    await copy.setLocale('de');
    expect([20 * S, 2 * D, 8 * D].map(opened)).toEqual(['Geöffnet gerade eben', 'Geöffnet vorgestern', 'Geöffnet 01.11.2026']);
  });

  test('code says a time as a message does, by the same format', async () => {
    const { made } = project();
    const copy = createCopy(made, { now: () => NOW, timeZone: 'UTC' });
    for (const ago of [20 * S, 5 * MIN, 2 * D, 8 * D])
      expect(`Opened ${copy.relative(NOW - ago, 'recent' as never)}`).toBe(copy.t('pr.opened', { at: NOW - ago }));
    expect(copy.relative(NOW - 3 * H)).toBe('3 hours ago');
    expect(copy.relative(NOW - 20 * S, { smallest: 'second', numeric: 'always' })).toBe('20 seconds ago');
    await copy.setLocale('de');
    expect(copy.relative(NOW - 20 * S, 'recent' as never)).toBe('gerade eben');
  });

  test('its now entry is there, and takes {tense} alone', () => {
    const problems = (entry: string) => loadCatalog(project(entry).config, undefined, { partial: true }).problems.map((p) => p.message);
    expect(problems('"just now, {who}"')).toContain(
      'says now for a relative time (formats.relative.recent.now), which gives it {tense} alone, past or future: {tense, select, future {in a moment} other {just now}}',
    );
    const missing = fixture({ 'copy/catalog/pr.yaml': 'pr.opened: "Opened {at, relative, recent}"\n' }, CONFIG);
    expect(loadCatalog(missing, undefined, { partial: true }).problems.map((p) => p.message)).toEqual([
      '{at} is shown as formats.relative.recent.now says, and the catalog has no time.now: add it, saying now, as "just now", with {tense} if it tells past from future',
    ]);
  });

  test('its now entry is kept as read, and accented in the pseudo-locale', () => {
    const { config, catalog } = project();
    generate(config);
    expect(cli(config.root, 'scan').stderr).not.toContain('time.now');
    const opened = catalog.messages.find((m) => m.key === 'pr.opened')!;
    const { m } = compiled([['m', pseudoAst(opened.ast)]]);
    const said = flatten(
      (m as (a: object, h: unknown) => unknown)({ at: NOW }, createHelpers('en', { now: () => NOW, relative: relativeTime })),
    ).join('');
    expect(said).toBe('⟦ÓÓþééñééð ĵúúšţ ñóóŵ ·⟧');
  });

  test.each([
    [{ smallest: 'fortnight' }, 'formats.relative.r.smallest is a unit: year, quarter, month, week, day, hour, minute, second'],
    [{ largest: 'minute', smallest: 'day' }, 'formats.relative.r.largest is minute, which is smaller than smallest'],
    [{ largest: 'week', smallest: 'week', skip: ['week'] }, 'formats.relative.r.skip leaves out every unit between largest and smallest'],
    [{ rounding: 'up' }, 'formats.relative.r.rounding is nearest or down'],
    [{ numeric: 'sometimes' }, 'formats.relative.r is refused by Intl.RelativeTimeFormat'],
    [{ date: { after: 0, format: 'day' } }, 'formats.relative.r.date.after is the milliseconds from now past which a date shows'],
    [{ date: { after: D, format: 'receipt' } }, 'formats.relative.r.date.format names receipt, which is no date format of the config'],
    [{ when: 1 }, 'formats.relative.r.when is not an option of Intl.RelativeTimeFormat'],
  ])('%p is refused: %p', (options, message) => {
    const formatsWith = { date: formats.date, relative: { r: options } } as never;
    expect(() => fixture({}, { formats: formatsWith })).toThrow(message);
  });

  test('the writing guide shows each from under a minute to weeks, and ahead', () => {
    const config = fixture({}, { formats });
    expect(
      writingGuide(config)
        .split('\n')
        .filter((l) => l.includes('(relative)')),
    ).toEqual([
      '- `recent` (relative): (time.now says now) · 5 minutes ago · yesterday · Oct 7, 2026 · in 2 hours',
      '- `terse` (relative): 20s ago · 5m ago · 1d ago · 21d ago · in 2h',
    ]);
  });

  test.each([
    ['"{tense, select, future {in a moment} other {just now}}"', 'just now / in a moment'],
    ['"just now"', 'just now'],
    ['"{tense, select, past {a moment ago} other {now}}"', 'a moment ago / now'],
  ])('the writing guide says now as its entry %s does: %s', (entry, said) => {
    const { config, catalog } = project(entry);
    const line = writingGuide(config, [], catalog.messages)
      .split('\n')
      .find((l) => l.startsWith('- `recent`'));
    expect(line).toBe(`- \`recent\` (relative): ${said} · 5 minutes ago · yesterday · Oct 7, 2026 · in 2 hours`);
  });
});

describe('now said as text or by an entry', () => {
  /** A copy as generate ships it, saying `pr.opened` with `now` as given, at NOW. */
  const opened = (now: unknown, entries = '') => {
    const config = fixture(
      { 'copy/catalog/pr.yaml': 'pr.opened: "Opened {at, relative, recent}"\n', ...(entries && { 'copy/catalog/time.yaml': entries }) },
      { require: [], formats: { relative: { recent: { now } } } as never },
    );
    const catalog = loadCatalog(config, undefined, { partial: true });
    const messages = { en: compiled(catalog.messages.map((m): Entry => [m.key, m.ast])) };
    // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- the formats as the generated index ships them
    const formats = new Function(`return ${formatsCode(config)!};`)() as Formats;
    const copy = createCopy(defineCatalog({ source: 'en', locales: ['en'], messages, loaders: {}, formats, relative: relativeTime }), {
      now: () => NOW,
    });
    return { copy, problems: catalog.problems.map((p) => p.message) };
  };

  test.each([
    // [now, entries, a time just past, and just ahead]
    ['just now', '', 'just now', 'just now'],
    ['{tense, select, future {in a moment} other {a moment ago}}', '', 'a moment ago', 'in a moment'],
    [{ entry: 'time.now' }, 'time.now: "{tense, select, future {soon} other {right now}}"\n', 'right now', 'soon'],
  ])('%p says %p, in a message and in code', (now, entries, past, future) => {
    const { copy, problems } = opened(now, entries);
    expect(problems).toEqual([]);
    expect([
      copy.t('pr.opened' as never, { at: NOW - 20 * S } as never),
      copy.t('pr.opened' as never, { at: NOW + 20 * S } as never),
    ]).toEqual([`Opened ${past}`, `Opened ${future}`]);
    expect([copy.relative(NOW - 20 * S, 'recent' as never), copy.relative(NOW + 20 * S, 'recent' as never)]).toEqual([past, future]);
  });

  test.each([
    ['{when} now', '', 'formats.relative.recent.now takes {when}, and is given {tense} alone'],
    // What `now` took before it took text: a key, which would show as itself.
    [
      'time.now',
      'time.now: "just now"\n',
      "formats.relative.recent.now is text, and time.now is an entry's key: write now: { entry: 'time.now' } to say it with the entry",
    ],
  ])('%p is refused as the catalog loads', (now, entries, message) => {
    expect(opened(now, entries).problems.join('\n')).toContain(message);
  });
});

describe('what ships', () => {
  test('the index imports what says relative times only where a message or a format says one', () => {
    const index = (files: Record<string, string>, config: ProsebookConfig = {}) => {
      const made = fixture(files, { require: [], ...config });
      return generate(made, { check: true }).files.get(join(made.out, 'index.ts'))!;
    };
    const says = index({ 'copy/catalog/a.yaml': 'a.b: "Opened {at, relative}"\n' });
    expect(says).toContain("import { relativeTime } from 'prosebook';");
    expect(says).toContain('  relative: relativeTime,');
    expect(index({ 'copy/catalog/a.yaml': 'a.b: Opened\n' }, { formats })).toContain('  relative: relativeTime,');
    expect(index({ 'copy/catalog/a.yaml': 'a.b: "Opened {at, date}"\n' })).not.toContain('relativeTime');
  });

  test('a catalog saying none refuses copy.relative with the fix', () => {
    const copy = createCopy(defineCatalog({ source: 'en', locales: ['en'], messages: { en: {} }, loaders: {} }));
    expect(() => copy.relative(NOW)).toThrow('no message or format says a relative time: name one under formats.relative');
    expect(copy.nextChange()).toBeUndefined();
  });
});

describe('now, and keeping a time fresh', () => {
  const catalog = defineCatalog({
    source: 'en',
    locales: ['en'],
    messages: { en: compiled([['a.opened', readMessage(1, 'Opened {at, relative}', 'en')]]) },
    loaders: {},
    relative: relativeTime,
  });

  test('a number is the time the server rendered at, read until the copy is subscribed to', () => {
    const rendered = Date.now() - 10 * MIN;
    const copy = createCopy(catalog, { now: rendered });
    const at = rendered - 5 * MIN;
    expect(copy.now()).toBe(rendered);
    expect(copy.t('a.opened', { at })).toBe('Opened 5 minutes ago');
    const stop = copy.subscribe(() => {});
    expect(copy.t('a.opened', { at })).toBe('Opened 15 minutes ago');
    stop();
  });

  test('nextChange says when the last read next reads differently, and nothing for one with no time', () => {
    const copy = createCopy(catalog, { now: () => NOW });
    copy.t('a.opened', { at: NOW - 3 * H });
    expect(copy.nextChange()).toBe(NOW + 30 * MIN);
    expect(copy.relative(NOW - 10 * S)).toBe('now');
    expect(copy.nextChange()).toBe(NOW + 50 * S);
    copy.t('a.opened', { at: NOW - 400 * D });
    copy.has('a.opened');
    expect(copy.nextChange()).toBe(NOW + 147.5 * D);
  });

  test('a live copy changes its version once a time it read next reads differently, unless that read was claimed', async () => {
    const start = Date.now();
    // A clock 59.95 seconds past the time read, so it turns from now to a minute ago in 50ms.
    const at = NOW - 59_950;
    const copy = createCopy(catalog, { now: () => NOW + Date.now() - start, live: true });
    let changes = 0;
    const stop = copy.subscribe(() => changes++);
    expect(copy.t('a.opened', { at })).toBe('Opened now');
    await Bun.sleep(150);
    expect(changes).toBe(1);
    expect(copy.t('a.opened', { at })).toBe('Opened 1 minute ago');
    // A claimed read is the claimer's to keep fresh.
    copy.t('a.opened', { at: NOW + Date.now() - start - 59_950 });
    copy.nextChange();
    await Bun.sleep(150);
    expect(changes).toBe(1);
    stop();
  });

  test('at runs once the copy’s clock reaches a time, and can be cancelled', async () => {
    const copy = createCopy(catalog, { now: () => NOW });
    const ran: string[] = [];
    copy.at(NOW + 20, () => ran.push('soon'));
    const cancel = copy.at(NOW + 20, () => ran.push('cancelled'));
    cancel();
    await Bun.sleep(80);
    expect(ran).toEqual(['soon']);
  });
});

describe('formatted in code', () => {
  test('Intl.RelativeTimeFormat and a unit picked in code are reported, naming the copy’s method and formats', () => {
    const code = [
      "const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });",
      "export const ago = (days) => rtf.format(-days, 'day');",
      "export const sum = (a, b) => format(a, b) + fmt.format(a, 'en');",
      '',
    ].join('\n');
    expect(formattedInCode('ago.ts', code, formats).map((f) => `${f.line} ${f.code}: ${f.fix}`)).toEqual([
      "1 new Intl.RelativeTimeFormat('en', { numeric: 'auto' }): copy.relative(at, 'recent') or copy.relative(at, 'terse'), given the time itself, or {at, relative} in the message",
      "2 rtf.format(-days, 'day'): copy.relative(at, 'recent') or copy.relative(at, 'terse'), given the time itself, or {at, relative} in the message",
    ]);
  });

  test('a relative formatter of the app’s own shows a time, and says when it next changes', async () => {
    const module = [
      "import { defineFormatters } from 'prosebook';",
      'export default defineFormatters({',
      '  relative: {',
      '    hours: (at, { now }) => {',
      '      const hours = Math.floor((now - at.getTime()) / 3_600_000);',
      '      return { text: `${hours}h`, next: at.getTime() + (hours + 1) * 3_600_000 };',
      '    },',
      '  },',
      '});',
      '',
    ].join('\n');
    const { loadConfig } = await import('prosebook/tools');
    const root = fixture(
      {
        'src/formatters.ts': module,
        'copy/catalog/a.yaml': 'a.seen: "Seen {at, relative, hours}"\n',
        'prosebook.config.json': JSON.stringify({ require: [], formatters: 'src/formatters.ts' }),
      },
      {},
    ).root;
    const config = await loadConfig(root);
    expect(config.formats.relative).toEqual({ hours: { formatter: 'hours' } });
    const own = (await import(join(root, 'src/formatters.ts'))) as { default: never };
    const ast = loadCatalog(config).messages[0]!.ast;
    const copy = createCopy(
      defineCatalog({
        source: 'en',
        locales: ['en'],
        messages: { en: compiled([['a.seen', ast]]) },
        loaders: {},
        formatters: own.default,
        relative: relativeTime,
      }),
      { now: () => NOW },
    );
    expect(copy.t('a.seen', { at: NOW - 150 * MIN })).toBe('Seen 2h');
    expect(copy.nextChange()).toBe(NOW + 30 * MIN);
  });
});
