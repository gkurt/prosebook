import { describe, expect, test } from 'bun:test';

import { createCopy, createHelpers, defineCatalog, flatten } from 'prosebook';
import { generate, loadCatalog, readMessage, writeMessage, type ProsebookConfig } from 'prosebook/tools';

import { durationParts } from '#src/runtime/formats.ts';
import type { Entry } from '#src/tools/compile.ts';
import { writingGuide } from '#src/tools/guide.ts';
import { argsOf, formatProblems } from '#src/tools/icu.ts';
import { cli, compiled, fixture } from './fixture.ts';

const formats = {
  list: { tools: { type: 'unit', max: 2 } },
  duration: {
    compact: { style: 'narrow' },
    clock: { style: 'digital' },
    tenths: { style: 'narrow', fractionalDigits: 1 },
    stopwatch: { style: 'digital', fractionalDigits: 2 },
  },
} as const;

/** A message read in a locale with the formats above, rendered with `values`. */
function render(version: 1 | 2, text: string, locale: string, values: Record<string, unknown>) {
  const ast = readMessage(version, text, locale, { formats, isolate: false });
  const { m } = compiled([['m', ast]]);
  return typeof m === 'string' ? m : flatten(m!(values, createHelpers(locale))).join('');
}

describe('lists', () => {
  test('a list joins as its locale joins one, in either syntax', () => {
    const names = ['Ann', 'Bob', 'Cy'];
    expect(render(1, 'With {names, list}.', 'en', { names })).toBe('With Ann, Bob, and Cy.');
    expect(render(1, 'With {names, list}.', 'de', { names })).toBe('With Ann, Bob und Cy.');
    expect(render(1, '{names, list, disjunction}', 'en', { names })).toBe('Ann, Bob, or Cy');
    expect(render(2, 'With {$names :list}.', 'en', { names })).toBe('With Ann, Bob, and Cy.');
    expect(render(2, '{$names :list type=disjunction}', 'en', { names })).toBe('Ann, Bob, or Cy');
    // A quoted brace is text, and a list inside a plural's arm is still a list.
    expect(render(1, "'{names, list}' {n, plural, other {# by {names, list, unit}}}", 'en', { names, n: 2 })).toBe(
      '{names, list} 2 by Ann, Bob, Cy',
    );
  });

  test('a list is typed as strings, and a style no one knows is refused with the fix', () => {
    expect(argsOf(readMessage(1, '{names, list} for {took, duration}', 'en'))).toEqual(
      new Map([
        ['names', 'readonly string[]'],
        ['took', 'number'],
      ]),
    );
    expect(formatProblems(readMessage(1, '{names, list, oxford}', 'en'))).toEqual([
      '{names} asks for list style "oxford": conjunction, disjunction, unit, long, short, narrow, or a format formats.list names',
    ]);
  });
});

const SHOP = {
  require: [],
  formats: { list: { tools: { max: 2, more: 'app.more' } }, duration: { compact: { style: 'narrow' } } },
} satisfies ProsebookConfig;

describe('a list format with max', () => {
  const shop = (more = '"{count, plural, one {# more} other {# more}}"') =>
    fixture(
      {
        'copy/catalog/app.yaml': [
          'app.used: "Used {tools, list, tools}."',
          `app.more: ${more}`,
          'app.took: "Took {ms, duration, compact}"',
          '',
        ].join('\n'),
        'copy/locales/de.yaml':
          'app.used: "Benutzt: {tools, list, tools}."\napp.more: "{count, plural, one {# weiteres} other {# weitere}}"\n',
        'copy/locales/de-AT.yaml': 'app.used: "Verwendet: {tools, list, tools}."\n',
        'src/App.tsx': "export const App = ({ t }) => [t('app.used'), t('app.took')];\n",
        'prosebook.config.json': JSON.stringify(SHOP),
      },
      SHOP,
    );

  test('shows its first items, and the rest as the entry its more names says it in each locale', async () => {
    const config = shop();
    const catalog = loadCatalog(config);
    const entries = (locale: string): Entry[] =>
      catalog.messages.flatMap((m): Entry[] => {
        const ast = locale === 'en' ? m.ast : m.translations.get(locale)?.ast;
        return ast === undefined ? [] : [[m.key, ast]];
      });
    const messages = { en: compiled(entries('en')), de: compiled(entries('de')), 'de-AT': compiled(entries('de-AT')) };
    const copy = createCopy(
      defineCatalog({ source: 'en', locales: ['en', 'de', 'de-AT'], messages, loaders: {}, formats: config.formats }),
    );
    const tools = ['grep', 'sed', 'awk', 'jq'];
    expect(copy.t('app.used', { tools })).toBe('Used grep, sed, and 2 more.');
    expect(copy.t('app.used', { tools: tools.slice(0, 2) })).toBe('Used grep and sed.');
    expect(copy.list(tools, 'tools' as never)).toBe('grep, sed, and 2 more');
    expect(copy.duration(185_400, 'compact' as never)).toBe('3m 5s');
    expect(copy.t('app.took', { ms: 850 })).toBe('Took 850ms');
    await copy.setLocale('de');
    expect(copy.t('app.used', { tools })).toBe('Benutzt: grep, sed und 2 weitere.');
    // Austrian German doesn't translate the rest, so it takes German's.
    await copy.setLocale('de-AT');
    expect(copy.t('app.used', { tools })).toBe('Verwendet: grep, sed und 2 weitere.');

    // The entry is read by the format, so no scan calls it unused.
    generate(config);
    expect(cli(config.root, 'scan').stderr).not.toContain('app.more');
  });

  test('its more entry is there, and takes {count} alone', () => {
    const problems = (more: string) => loadCatalog(shop(more), undefined, { partial: true }).problems.map((p) => `${p.key}: ${p.message}`);
    expect(problems('"{count, plural, other {# more by {who}}}"')).toContain(
      'app.more: says the rest of a list (formats.list.tools.more), which gives it {count} alone, a number: say it with {count, plural, …}',
    );
    const missing = fixture(
      { 'copy/catalog/app.yaml': 'app.used: "Used {tools, list, tools}."\n' },
      { require: [], formats: { list: { tools: { max: 2, more: 'app.more' } } } },
    );
    expect(loadCatalog(missing, undefined, { partial: true }).problems.map((p) => p.message)).toEqual([
      '{tools} is shown as formats.list.tools.more says, and the catalog has no app.more: add it, saying the rest with {count}',
    ]);
  });

  test('migrates between the syntaxes, and native targets refuse it with the fix', () => {
    const one = '{tools, list, tools} {kinds, list, disjunction short} {ms, duration, long}';
    const two = '{$tools :list format=tools} {$kinds :list type=disjunction style=short} {$ms :duration style=long}';
    const options = { formats: shop().formats, isolate: false } as const;
    expect(writeMessage(2, readMessage(1, one, 'en', options), 'en')).toBe(two);
    expect(writeMessage(1, readMessage(2, two, 'en', options), 'en')).toBe(one);
    const native = fixture(
      { 'copy/catalog/app.yaml': 'app.a: "{ms, duration}"\n' },
      { require: [], native: [{ language: 'android', out: 'android/res' }] },
    );
    expect(() => generate(native)).toThrow("android: {ms} is a duration, which Android resources don't format: pass it formatted");
  });
});

describe('durations', () => {
  test('milliseconds are split into the units the format shows, the last rounded', () => {
    expect(durationParts(185_400)).toEqual({ parts: { minutes: 3, seconds: 5 } });
    expect(durationParts(850)).toEqual({ parts: { milliseconds: 850 } });
    expect(durationParts(3_725_000)).toEqual({ parts: { hours: 1, minutes: 2 } });
    // 59.6 seconds to the second is a minute.
    expect(durationParts(59_600, { smallest: 'seconds' })).toEqual({ parts: { minutes: 1 } });
    expect(durationParts(90_000_000, { largest: 'hours' })).toEqual({ parts: { hours: 25 } });
    expect(durationParts(0, { smallest: 'seconds' })).toEqual({ parts: { seconds: 0 }, display: { secondsDisplay: 'always' } });
    expect(durationParts(-65_000)).toEqual({ parts: { minutes: -1, seconds: -5 } });
  });

  test('with fractionalDigits, the seconds’ fraction is a unit, rounded to its last digit', () => {
    const tenths = { fractionalDigits: 1 };
    const folded = { milliseconds: 'numeric' };
    expect(durationParts(4_237, tenths)).toEqual({ parts: { seconds: 4, milliseconds: 200 }, display: folded });
    expect(durationParts(200, tenths)).toEqual({ parts: { milliseconds: 200 }, display: folded });
    // Minutes and seconds are two units already, so the fraction is left out.
    expect(durationParts(180_250, tenths)).toEqual({ parts: { minutes: 3 }, display: folded });
    expect(durationParts(185_250, { ...tenths, units: 3 })).toEqual({
      parts: { minutes: 3, seconds: 5, milliseconds: 300 },
      display: folded,
    });
    // 59.96 seconds to the tenth is a minute.
    expect(durationParts(59_960, tenths)).toEqual({ parts: { minutes: 1 }, display: folded });
    expect(durationParts(-1_250, { fractionalDigits: 2 })).toEqual({ parts: { seconds: -1, milliseconds: -250 }, display: folded });
    expect(durationParts(0, tenths)).toEqual({ parts: { seconds: 0 }, display: { ...folded, secondsDisplay: 'always' } });
    // Digital writes milliseconds as a fraction already, and shows every unit.
    expect(durationParts(185_437, { style: 'digital', fractionalDigits: 2 })).toEqual({
      parts: { minutes: 3, seconds: 5, milliseconds: 440 },
    });
  });

  test('a duration formats as its locale writes one, in either syntax', () => {
    expect(render(1, 'Took {took, duration}', 'en', { took: 185_400 })).toBe('Took 3 min, 5 sec');
    expect(render(1, 'Took {took, duration, compact}', 'en', { took: 185_400 })).toBe('Took 3m 5s');
    expect(render(1, '{took, duration, narrow}', 'en', { took: 850 })).toBe('850ms');
    expect(render(1, '{took, duration, clock}', 'en', { took: 185_400 })).toBe('0:03:05');
    expect(render(1, '{took, duration}', 'en', { took: 0 })).toBe('0 ms');
    expect(render(1, '{took, duration, long}', 'de', { took: 3_725_000 })).toBe('1 Stunde, 2 Minuten');
    expect(render(2, 'Took {$took :duration format=compact}', 'en', { took: 185_400 })).toBe('Took 3m 5s');
    expect(render(2, '{$took :duration style=long}', 'en', { took: 185_400 })).toBe('3 minutes, 5 seconds');
  });

  test('a format with fractionalDigits shows tenths of a second, in messages and in code', () => {
    const tenths = (took: number, locale = 'en') => render(1, '{took, duration, tenths}', locale, { took });
    expect(render(1, 'Took {took, duration, tenths}', 'en', { took: 4_237 })).toBe('Took 4.2s');
    expect([12_000, 12_040, 200, 0, 185_250, 3_725_400].map((took) => tenths(took))).toEqual([
      '12s',
      '12s',
      '0.2s',
      '0s',
      '3m 5s',
      '1h 2m',
    ]);
    expect(tenths(4_237, 'de')).toBe('4,2 Sek.');
    // A clock keeps its width.
    expect(render(1, '{took, duration, stopwatch}', 'en', { took: 185_437 })).toBe('0:03:05.44');
    expect(render(1, '{took, duration, stopwatch}', 'en', { took: 185_000 })).toBe('0:03:05.00');
    expect(render(2, '{$took :duration format=tenths}', 'en', { took: 4_237 })).toBe('4.2s');
    const copy = createCopy(defineCatalog({ source: 'en', locales: ['en'], messages: {}, loaders: {}, formats }));
    expect(copy.duration(4_237, 'tenths' as never)).toBe('4.2s');
  });

  test('the writing guide shows each duration format from under a second to over an hour, so they differ', () => {
    const config = fixture(
      {},
      {
        formats: {
          duration: {
            seconds: { style: 'narrow', smallest: 'seconds' },
            tenths: { style: 'narrow', fractionalDigits: 1 },
            precise: { style: 'narrow' },
          },
        },
      },
    );
    expect(
      writingGuide(config)
        .split('\n')
        .filter((l) => l.includes('(duration)')),
    ).toEqual([
      '- `seconds` (duration): 1s · 4s · 3m 5s · 1h 2m',
      '- `tenths` (duration): 0.9s · 4.2s · 3m 5s · 1h 2m',
      '- `precise` (duration): 850ms · 4s 237ms · 3m 5s · 1h 2m',
    ]);
  });

  test('fractionalDigits is checked with the units around it', () => {
    const refused = (duration: Record<string, unknown>) => () => fixture({}, { formats: { duration: { took: duration } } });
    expect(refused({ fractionalDigits: 4 })).toThrow('fractionalDigits is the most digits of a second shown, 1 to 3');
    expect(refused({ fractionalDigits: 0 })).toThrow("for none, set smallest: 'seconds'");
    expect(refused({ fractionalDigits: 1, smallest: 'milliseconds' })).toThrow('remove smallest');
    expect(refused({ fractionalDigits: 1, largest: 'milliseconds' })).toThrow('largest is seconds or larger');
  });
});
