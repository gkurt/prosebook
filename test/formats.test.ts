import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createCopy, createHelpers, defineCatalog, flatten, type Formats } from 'prosebook';
import { generate, lint, loadCatalog, planMigrate, readMessage, resolveConfig, type ProsebookConfig } from 'prosebook/tools';

import { writingGuide } from '#src/tools/guide.ts';
import { formatsOf } from '#src/tools/icu.ts';
import { compiled, fixture } from './fixture.ts';

const formats: Formats = {
  number: { price: { style: 'currency', currency: 'EUR' }, compact: { notation: 'compact', maximumSignificantDigits: 3 } },
  date: { receipt: { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' } },
  locales: { de: { date: { receipt: { dateStyle: 'long', timeZone: 'UTC' } } } },
};

const WHEN = new Date(Date.UTC(2026, 9, 28, 14, 5));

/** No-break spaces as plain ones: which one `Intl` puts before "PM" and "€" differs between ICU versions. */
const spaced = (text: string) => text.replace(/[  ]/g, ' ');

/** A message read in a locale with the formats above, rendered with `values`. */
function render(version: 1 | 2, text: string, locale: string, values: Record<string, unknown>) {
  const ast = readMessage(version, text, locale, { formats, isolate: false });
  const { m } = compiled([['m', ast]]);
  return spaced(typeof m === 'string' ? m : flatten(m!(values, createHelpers(locale))).join(''));
}

describe('named formats', () => {
  test('a message names a format in either syntax, and each locale shows it its own way', () => {
    const mf1 = 'Paid {total, number, price} for {count, number, compact} points on {when, date, receipt}';
    const mf2 = 'Paid {$total :number format=price} for {$count :number format=compact} points on {$when :datetime format=receipt}';
    const values = { total: 9, count: 5_670_000, when: WHEN };
    for (const text of [mf1, mf2]) {
      expect(render(text === mf1 ? 1 : 2, text, 'en', values)).toBe('Paid €9.00 for 5.67M points on Oct 28, 2026, 2:05 PM');
      // German shows the receipt date as `locales.de` says, and so does Austrian German, after it.
      expect(render(text === mf1 ? 1 : 2, text, 'de-AT', values)).toBe('Paid € 9,00 for 5,67 Mio. points on 28. Oktober 2026');
    }
  });

  test('a time names a date format too, and the doc comment says the name', () => {
    expect(render(1, '{when, time, receipt}', 'en', { when: WHEN })).toBe('Oct 28, 2026, 2:05 PM');
    const ast = readMessage(1, '{total, number, price} {when, time, receipt}', 'en', { formats });
    expect([...formatsOf(ast)]).toEqual([
      ['total', 'number `price`'],
      ['when', 'time `receipt`'],
    ]);
  });

  test('a name no format has is refused, with the names there are', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.a: "{total, number, pricy}"\napp.b: "{when, date, recipt}"\n' },
      { require: [], formats },
    );
    expect(loadCatalog(config, undefined, { partial: true }).problems.map((p) => `${p.key}: ${p.message}`)).toEqual([
      'app.a: {total} asks for number style "pricy": integer, percent, a ::skeleton, or a format formats.number names',
      'app.b: {when} asks for date style "recipt": short, medium, long, full, a ::skeleton, or a format formats.date names',
    ]);
    const refused = (message: string) => () => readMessage(2, message, 'en', { formats });
    expect(refused('{$t :number format=pricy}')).toThrow(
      ":number format=pricy names no format of the config's (formats.number): price, compact",
    );
    expect(() => readMessage(2, '{$t :number format=price}', 'en')).toThrow(
      ":number format=price names no format of the config's (formats.number), and it names none: add price under formats.number",
    );
    expect(refused('{$t :number format=$f}')).toThrow(':number format=$f: a format is named in the message, as format=price');
  });

  test('in MF2 a named format is whole: no option beside it, inherited or not, but .match still selects on it', () => {
    const refused = (message: string) => () => readMessage(2, message, 'en', { formats });
    expect(refused('{$t :number format=price signDisplay=always}')).toThrow(
      ':number format=price has signDisplay beside it: a named format is whole, so name another format in the config for this one',
    );
    expect(refused('.input {$t :number format=price}\n{{{$t :integer}}}')).toThrow(
      ':integer adds to a named format (format=price), which is whole: format it with :number',
    );
    expect(refused('{$t :currency format=price}')).toThrow(':currency has no option "format"');
    const files = '.input {$n :number format=compact}\n.match $n\none {{{$n} point}}\n* {{{$n} points}}';
    expect(render(2, files, 'en', { n: 1 })).toBe('1 point');
    expect(render(2, files, 'en', { n: 1234 })).toBe('1.23K points');
  });

  test('migrate keeps the name, both ways', () => {
    const config = (messageFormat: 1 | 2, en: string) =>
      fixture({ 'copy/catalog/app.yaml': `app.a: "${en}"\n` }, { require: [], formats, messageFormat });
    const toTwo = planMigrate(config(1, '{total, number, price} on {when, time, receipt}'), 2);
    expect(toTwo.blocked).toEqual([]);
    expect(toTwo.changed).toEqual([]);
    expect(toTwo.rewrites.map((r) => r.after)).toEqual(['{$total :number format=price} on {$when :datetime format=receipt}']);
    const toOne = planMigrate(config(2, '{$total :number format=price} on {$when :date format=receipt}'), 1);
    expect(toOne.rewrites.map((r) => r.after)).toEqual(['{total, number, price} on {when, date, receipt}']);
  });

  test('the generated index ships the formats, and the types name them', () => {
    const config = fixture({ 'copy/catalog/app.yaml': 'app.a: "{total, number, price}"\n' }, { require: [], formats });
    const { files } = generate(config, { check: true });
    const index = files.get(join(config.out, 'index.ts'))!;
    expect(index).toContain(`  formats: ${JSON.stringify(formats)},`);
    expect(index).toContain('formats: { number: "price" | "compact"; date: "receipt"; list: never; duration: never };');
    expect(files.get(config.guide as string)).toContain('- `compact` (number): 1.23K · 12 · -0.25');
    // Two prices alike at 1,234.50 differ on a whole amount and a negative one.
    const usd = { style: 'currency', currency: 'USD' } as const;
    const prices = fixture(
      {},
      {
        formats: { number: { dollars: { ...usd, trailingZeroDisplay: 'stripIfInteger' }, cents: { ...usd, currencySign: 'accounting' } } },
      },
    );
    expect(
      writingGuide(prices)
        .split('\n')
        .filter((l) => l.includes('(number)')),
    ).toEqual(['- `dollars` (number): $1,234.50 · $12 · -$0.25', '- `cents` (number): $1,234.50 · $12.00 · ($0.25)']);
    // Without formats, nothing of them is written.
    const plain = fixture({ 'copy/catalog/app.yaml': 'app.a: Hi\n' }, { require: [] });
    expect(generate(plain, { check: true }).files.get(join(plain.out, 'index.ts'))).not.toContain('formats');
  });

  test('code formats by name in the current locale, as messages do', async () => {
    const copy = createCopy(
      defineCatalog({ source: 'en', locales: ['en', 'de-AT'], messages: { en: {}, 'de-AT': {} }, loaders: {}, formats }),
    );
    const date = (name: string) => spaced(copy.date(WHEN, name as never));
    const price = (value: number) => spaced(copy.number(value, 'price'));
    expect(price(1234.5)).toBe('€1,234.50');
    expect(date('receipt')).toBe('Oct 28, 2026, 2:05 PM');
    await copy.setLocale('de-AT');
    expect(price(1234.5)).toBe('€ 1.234,50');
    expect(date('receipt')).toBe('28. Oktober 2026');
    expect(() => date('recipt')).toThrow('prosebook: no date format is named "recipt": name it under formats.date in the config');
  });

  test('the lint names the format an inline one shows as', () => {
    const config = (messageFormat: 1 | 2, en: string) =>
      fixture({ 'copy/catalog/app.yaml': `app.a: "${en}"\n` }, { require: [], formats, messageFormat });
    const findings = (c: ReturnType<typeof config>) => lint(loadCatalog(c).messages, c).filter((f) => f.rule === 'named-format');
    expect(
      findings(config(1, '{t, number, ::currency/EUR} {n, number, ::compact-short} {t, number, price}')).map((f) => f.message),
    ).toEqual(['t is formatted as formats.number.price is: name it, {t, number, price}, so it changes when the format does']);
    expect(findings(config(2, '{$t :currency currency=EUR}')).map((f) => f.message)).toEqual([
      't is formatted as formats.number.price is: name it, {$t :number format=price}, so it changes when the format does',
    ]);
    // Two formats that show alike here: one finding, naming both.
    const twins = { ...formats, number: { ...formats.number, cost: { style: 'currency', currency: 'EUR' } } } as const;
    const both = fixture({ 'copy/catalog/app.yaml': 'app.a: "{t, number, ::currency/EUR}"\n' }, { require: [], formats: twins });
    expect(findings(both).map((f) => f.message)).toEqual([
      't is formatted as formats.number.price or formats.number.cost is: name it, {t, number, price} or {t, number, cost}, so it changes when the format does',
    ]);
  });
});

describe('the formats in the config', () => {
  const refused = (formats: ProsebookConfig['formats']) => () => resolveConfig('.', { formats });

  test('are checked as the config loads', () => {
    expect(refused({ number: { price: { style: 'currency' } } })).toThrow('formats.number.price is refused by Intl.NumberFormat:');
    expect(refused({ number: { price: { maximumFractionDigit: 2 } as never } })).toThrow(
      'formats.number.price.maximumFractionDigit is not an option of Intl.NumberFormat, which would ignore it:',
    );
    expect(refused({ date: { short: { dateStyle: 'short' } } })).toThrow(
      'formats.date.short: "short" is a style every message knows already, so name the format for what it shows: short-date',
    );
    expect(refused({ date: { '2fa': {} } })).toThrow("formats.date.2fa: a format's name is a letter, then letters, digits, _ and -");
    expect(refused({ time: {} } as never)).toThrow('formats.time is not a kind of format: number, date, list, duration');
    expect(refused({ list: { tools: { max: 3 } } })).toThrow(
      'formats.list.tools.max and more go together: the first max items, and the entry more names for the rest, given {count}',
    );
    expect(refused({ list: { tools: { max: 0, more: 'app.more' } } })).toThrow(
      'formats.list.tools.max is a whole number of items, 1 or more',
    );
    expect(refused({ list: { tools: { type: 'and' as never } } })).toThrow('formats.list.tools is refused by Intl.ListFormat:');
    expect(refused({ duration: { took: { largest: 'seconds', smallest: 'hours' } } })).toThrow(
      'formats.duration.took.largest is seconds, which is smaller than smallest',
    );
    expect(refused({ duration: { took: { smallest: 'weeks' as never } } })).toThrow(
      'formats.duration.took.smallest is a unit: days, hours, minutes, seconds, milliseconds',
    );
    expect(refused({ duration: { narrow: {} } })).toThrow('formats.duration.narrow: "narrow" is a style every message knows already');
    expect(refused({ number: { price: { style: 'currency', currency: 'EUR' } }, locales: { de: { number: { cost: {} } } } })).toThrow(
      'formats.locales.de.number.cost shows a format no one named: name it under formats.number first',
    );
  });
});
