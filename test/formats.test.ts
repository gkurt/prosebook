import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createCopy, createHelpers, defineCatalog, flatten, type Formats } from 'prosebook';
import { generate, lint, loadCatalog, planMigrate, readMessage, resolveConfig, type ProsebookConfig } from 'prosebook/tools';

import { splitIndex } from '#src/tools/bundle.ts';
import { withFormatters } from '#src/tools/config.ts';

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

describe('number formats with steps', () => {
  const steps: Formats = {
    number: {
      price: {
        style: 'currency',
        currency: 'USD',
        steps: [
          { from: 10, maximumFractionDigits: 0 },
          { from: 1_000_000, notation: 'compact' },
        ],
      },
    },
  };
  const shown = (version: 1 | 2, text: string, total: number) => {
    const ast = readMessage(version, text, 'en', { formats: steps, isolate: false });
    const { m } = compiled([['m', ast]]);
    return typeof m === 'string' ? m : flatten(m!({ total }, createHelpers('en'))).join('');
  };

  test('a number is shown by the last step its size reaches, as shown, either side of 0', () => {
    for (const [version, text] of [
      [1, '{total, number, price}'],
      [2, '{$total :number format=price}'],
    ] as const) {
      const at = (total: number) => shown(version, text, total);
      expect([9.99, 10, 12.5, -12.5, 1234.5, 2_500_000].map(at)).toEqual(['$9.99', '$10', '$13', '-$13', '$1,235', '$2.5M']);
      // Rounded, 9.996 is 10.00, so the step from 10 shows it; and 999,999.6 is a million.
      expect(at(9.996)).toBe('$10');
      expect(at(999_999.6)).toBe('$1M');
    }
  });

  test('code shows them as messages do, and the writing guide too', () => {
    const copy = createCopy(defineCatalog({ source: 'en', locales: ['en'], messages: { en: {} }, loaders: {}, formats: steps }));
    expect([9.99, 12.5, 9.996].map((n) => copy.number(n, 'price'))).toEqual(['$9.99', '$13', '$10']);
    expect(copy.number(12n, 'price')).toBe('$12');
    expect(writingGuide(fixture({}, { formats: steps }))).toContain('- `price` (number): $1,235 · $12 · -$0.25');
  });

  test('a message that spells out the first step is not its twin, and .match refuses them', () => {
    const config = fixture({ 'copy/catalog/app.yaml': 'app.a: "{t, number, ::currency/USD}"\n' }, { require: [], formats: steps });
    expect(lint(loadCatalog(config).messages, config).filter((f) => f.rule === 'named-format')).toEqual([]);
    const match = '.input {$n :number format=price}\n.match $n\none {{One}}\n* {{More}}';
    expect(() => readMessage(2, match, 'en', { formats: steps })).toThrow(
      '.match on :number format=price, whose steps show a number by its size: match on a :number of the same value declared apart',
    );
  });
});

describe("the app's own formatters", () => {
  const MODULE = [
    'export default {',
    '  number: { money: (value, { locale }) => (value < 10 ? `${value} cents` : `${Math.round(value)} in ${locale}`) },',
    "  date: { stamp: (value, { timeZone }) => `${new Date(value).toISOString().slice(0, 10)} ${timeZone ?? 'local'}` },",
    '};',
  ].join('\n');
  const own = (files: Record<string, string> = {}, config: ProsebookConfig = {}) =>
    withFormatters(fixture({ 'src/formatters.ts': MODULE, ...files }, { require: [], formatters: 'src/formatters.ts', ...config }));

  test('a message names one as it names a format, in either syntax, and is shown by it', async () => {
    const config = await own();
    const { formatters } = config;
    for (const [version, text] of [
      [1, '{total, number, money} on {when, date, stamp}'],
      [2, '{$total :number format=money} on {$when :datetime format=stamp}'],
    ] as const) {
      const ast = readMessage(version, text, 'en', { formats: config.formats, isolate: false });
      const { m } = compiled([['m', ast]]);
      const h = createHelpers('de', { formatters: formatters?.table, timeZone: 'UTC' });
      expect(typeof m === 'string' ? m : flatten(m!({ total: 12.4, when: WHEN }, h)).join('')).toBe('12 in de on 2026-10-28 UTC');
    }
  });

  test('a formatter that throws shows the fallback and says why', async () => {
    const config = await own({ 'src/formatters.ts': 'export default { number: { money: () => { throw new Error("no rate"); } } };' });
    const { m } = compiled([['m', readMessage(1, 'Total: {total, number, money}', 'en', { formats: config.formats })]]);
    const errors: string[] = [];
    const h = createHelpers('en', { formatters: config.formatters?.table, report: (e) => errors.push(e.message) });
    expect(typeof m === 'string' ? m : flatten(m!({ total: 3 }, h)).join('')).toBe('Total: {total}');
    expect(errors).toEqual(['{total} could not be formatted: no rate']);
  });

  test('the index imports the module, the types name its formats, and code formats by them', async () => {
    const config = await own({ 'copy/catalog/app.yaml': 'app.a: "{total, number, money}"\n' });
    const { files } = generate(config, { check: true });
    const index = files.get(join(config.out, 'index.ts'))!;
    expect(index).toContain("import formatters from '../formatters.js';");
    // A quote in a folder's name stays in the string.
    const quoted = await own({ "src/o'neil/formatters.ts": MODULE }, { formatters: "src/o'neil/formatters.ts" });
    expect(generate(quoted, { check: true }).files.get(join(quoted.out, 'index.ts'))).toContain(
      "import formatters from '../o\\'neil/formatters.js';",
    );
    expect(index).toContain('  formatters,\n');
    expect(index).toContain('formats: { number: "money"; date: "stamp"; list: never; duration: never };');
    expect(files.get(config.guide as string)).toContain('- `money` (number): 1235 in en · 12 in en · -0.25 cents');
    const table = config.formatters?.table;
    const copy = createCopy(
      defineCatalog({ source: 'en', locales: ['en'], messages: { en: {} }, loaders: {}, formats: config.formats, formatters: table }),
      { timeZone: 'UTC' },
    );
    expect(copy.number(4, 'money' as never)).toBe('4 cents');
    expect(copy.date(WHEN, 'stamp' as never)).toBe('2026-10-28 UTC');
    // A split index, a virtual module, imports it by its path.
    const split = splitIndex(config, generate(config));
    expect(split).toContain(`import formatters from ${JSON.stringify(config.formatters!.file)};`);
    expect(split).toContain('formatters });');
  });

  test('.match, native targets and the lint leave them alone', async () => {
    const config = await own({ 'copy/catalog/app.yaml': 'app.a: "{t, number, ::currency/USD}"\n' });
    const match = '.input {$n :number format=money}\n.match $n\none {{One}}\n* {{More}}';
    expect(() => readMessage(2, match, 'en', { formats: config.formats })).toThrow(
      ".match on :number format=money, which the app's own formatter shows: match on a :number of the same value declared apart",
    );
    expect(lint(loadCatalog(config).messages, config).filter((f) => f.rule === 'named-format')).toEqual([]);
  });

  test('the module is checked as it loads', async () => {
    const refused = (module: string, config: ProsebookConfig = {}) => own({ 'src/formatters.ts': module }, config);
    expect(own({}, { formatters: 'src/missing.ts' })).rejects.toThrow(
      "formatters names src/missing.ts, which isn't there: write it, or remove formatters",
    );
    expect(refused('export const x = 1;')).rejects.toThrow('src/formatters.ts exports no formatters:');
    expect(refused('export default { time: {} };')).rejects.toThrow('src/formatters.ts: time is not a kind of formatter: number, date');
    expect(refused('export default { number: { money: "$" } };')).rejects.toThrow(
      'src/formatters.ts: number.money is a function of the value and its context, giving the text',
    );
    expect(refused('export default { number: { price: () => "" } };', { formats })).rejects.toThrow(
      'src/formatters.ts: number.price is named in formats.number too: rename one',
    );
    expect(refused('export default { date: { short: () => "" } };')).rejects.toThrow(
      'src/formatters.ts: date.short: "short" is a style every message knows already',
    );
  });
});

describe('the formats in the config', () => {
  const refused = (formats: ProsebookConfig['formats']) => () => resolveConfig('.', { formats });

  test('are checked as the config loads', () => {
    expect(refused({ number: { price: { style: 'currency' } } })).toThrow('formats.number.price is refused by Intl.NumberFormat:');
    const price = (steps: unknown) => ({ number: { price: { style: 'currency', currency: 'USD', steps } as never } });
    expect(refused(price([]))).toThrow(
      'formats.number.price.steps is a list of options, each from a size up: steps: [{ from: 10, maximumFractionDigits: 0 }]',
    );
    expect(refused(price([{ maximumFractionDigits: 0 }]))).toThrow(
      'formats.number.price.steps[0].from is the size, above 0, from which the step shows a number',
    );
    expect(
      refused(
        price([
          { from: 100, notation: 'compact' },
          { from: 10, maximumFractionDigits: 0 },
        ]),
      ),
    ).toThrow('formats.number.price.steps[1].from is 10, not above the step before it: list the steps from the smallest size up');
    expect(refused(price([{ from: 10, maxFractionDigits: 0 }]))).toThrow(
      'formats.number.price.steps[0].maxFractionDigits is not an option of Intl.NumberFormat, which would ignore it',
    );
    expect(refused(price([{ from: 10 }]))).toThrow(
      'formats.number.price.steps[0] changes nothing from 10 up: give it the options it shows a number with',
    );
    expect(refused(price([{ from: 10, maximumFractionDigits: 0, minimumFractionDigits: 2 }]))).toThrow(
      'formats.number.price is refused by Intl.NumberFormat:',
    );
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
