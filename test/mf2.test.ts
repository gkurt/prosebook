import { describe, expect, test } from 'bun:test';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createHelpers, flatten } from 'prosebook';
import {
  applyExtract,
  applyMigrate,
  compileLocale,
  generate,
  loadCatalog,
  parseMf2,
  planExtract,
  planMigrate,
  readMessage,
  resolveConfig,
  toMf1,
  toMf2,
  whereOf,
} from 'prosebook/tools';
import type { CatalogError, Isolate, Problem } from 'prosebook/tools';

import { argsOf, formatsOf, parseMessage } from '#src/tools/icu.ts';

import { compiled as evaluated, copyOf, fixture } from './fixture.ts';

const t = (message: string, values: Record<string, unknown> = {}, locale = 'en') =>
  copyOf({ [locale]: { m: message } }, { locale }, 2).t('m' as never, values);

const rich = (message: string, values: Record<string, unknown>) =>
  copyOf({ en: { m: message } }, {}, 2)
    .rich('m' as never, values as never)
    .join('');

/** The message's compiled row, as the generator writes it. */
const compiled = (message: string) => compileLocale([['m', parseMf2(message, 'en')]]).rows[0]!.replace(/^ {2}"m": |,$/g, '');

describe('reading MessageFormat 2', () => {
  test('text, placeholders and escapes', () => {
    expect(t('Hello {$name}!', { name: 'Ada' })).toBe('Hello Ada!');
    expect(t(String.raw`Braces \{like this\} and a backslash \\`)).toBe('Braces {like this} and a backslash \\');
    expect(t('{|a literal|} and {|1000| :number}')).toBe('a literal and 1,000');
  });

  test('numbers format with their function and options', () => {
    expect(t('{$n :number minimumFractionDigits=2}', { n: 1234.5 })).toBe('1,234.50');
    expect(t('{$n :integer}', { n: 2.7 })).toBe('3');
    expect(t('{$n :percent}', { n: 0.256 })).toBe('26%');
    expect(t('{$n :currency currency=EUR}', { n: 5 })).toBe('€5.00');
    expect(t('{$n :unit unit=kilometer unitDisplay=long}', { n: 3 })).toBe('3 kilometers');
    expect(t('{$n :number useGrouping=never}', { n: 12345 })).toBe('12345');
    expect(
      t('.input {$n :number maximumFractionDigits=0}\n{{About {$n}, or exactly {$n :number maximumFractionDigits=2}}}', { n: 7.25471 }),
    ).toBe('About 7, or exactly 7.25');
  });

  test('dates and times follow the draft spec, as the messageformat package does', () => {
    const d = new Date(Date.UTC(2026, 0, 5, 14, 30, 15));
    const intl = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en', o).format(d);
    expect(t('{$d :date}', { d })).toBe(intl({ year: 'numeric', month: 'short', day: 'numeric' }));
    expect(t('{$d :date fields=month-day-weekday length=long}', { d })).toBe(intl({ month: 'long', day: 'numeric', weekday: 'long' }));
    expect(t('{$d :time precision=second}', { d })).toBe(intl({ hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    expect(t('{$d :datetime dateLength=short timeZone=UTC}', { d })).toBe(
      intl({ timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }),
    );
  });

  test('markup becomes tags, standalone or wrapping', () => {
    const link = (chunks: unknown[]) => `<a>${chunks.join('')}</a>`;
    expect(rich('Read {#link}the {$what}{/link}.{#br/}', { link, br: () => '|', what: 'terms' })).toBe('Read <a>the terms</a>.|');
  });

  test('.match on a number: exact keys, then plural categories, then *', () => {
    const items = '.input {$count :number}\n.match $count\n0 {{Your cart is empty}}\none {{{$count} item}}\n* {{{$count} items}}';
    expect([0, 1, 2, 1000].map((count) => t(items, { count }))).toEqual(['Your cart is empty', '1 item', '2 items', '1,000 items']);
    const place = '.input {$n :number select=ordinal}\n.match $n\none {{{$n}st}}\ntwo {{{$n}nd}}\nfew {{{$n}rd}}\n* {{{$n}th}}';
    expect([1, 2, 3, 4, 11, 21].map((n) => t(place, { n }))).toEqual(['1st', '2nd', '3rd', '4th', '11th', '21st']);
  });

  test('.match on a string, and the types it gives', () => {
    const pronoun = '.input {$who :string}\n.match $who\nshe {{She}}\nhe {{He}}\n* {{They}}';
    expect(['she', 'he', 'xe'].map((who) => t(pronoun, { who }))).toEqual(['She', 'He', 'They']);
    const config = fixture(
      { 'copy/catalog/app.yaml': `app.who: |-\n  ${pronoun.replaceAll('\n', '\n  ')}\n` },
      { messageFormat: 2, require: [] },
    );
    expect(loadCatalog(config).messages[0]!.args.get('who')).toBe('"she" | "he" | (string & {})');
  });

  test('two selectors pick the variant MF2 ranks best, the first selector deciding first', () => {
    const message =
      '.input {$a :number}\n.input {$b :number}\n.match $a $b\n1 * {{A is 1}}\none 2 {{A is one, B is 2}}\n* 2 {{B is 2}}\n* * {{neither}}';
    // In Russian, 21 is in the category `one` without being 1.
    const ru = (a: number, b: number) => t(message, { a, b }, 'ru');
    expect(ru(1, 2)).toBe('A is 1');
    expect(ru(21, 2)).toBe('A is one, B is 2');
    expect(ru(5, 2)).toBe('B is 2');
    expect(ru(5, 3)).toBe('neither');
  });

  test('a key named `other` is the category, not the catch-all', () => {
    const message = '.input {$n :number}\n.match $n\nother {{other}}\n* {{star}}';
    expect([1, 2].map((n) => t(message, { n }))).toEqual(['star', 'other']);
  });

  test(':offset, in selection and in a placeholder', () => {
    const likes =
      '.input {$n :number}\n.local $others = {$n :offset subtract=1}\n.match $others\n-1 {{Nobody}}\n0 {{Just you}}\none {{You and {$others} other}}\n* {{You and {$others} others}}';
    expect([0, 1, 2, 3].map((n) => t(likes, { n }))).toEqual(['Nobody', 'Just you', 'You and 1 other', 'You and 2 others']);
    expect(t('{$n :offset subtract=1} left', { n: 5 })).toBe('4 left');
  });

  test('problems say what to write instead', () => {
    const problem = (message: string) => {
      try {
        parseMf2(message, 'en');
        return 'no problem';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(problem('Hello {$name')).toStartWith('is not valid MessageFormat 2 at line 1, column 13');
    expect(problem('.input {$n :number}\n.match $n\none {{a}}')).toBe(
      'is not valid MessageFormat 2: a .match needs a variant whose keys are all *',
    );
    expect(problem('.match $n\n* {{a}}')).toContain('a .match variable needs a function that selects');
    expect(problem('{$x :fancy}')).toStartWith(':fancy is not a function prosebook knows');
    expect(problem('{$x :number style=percent}')).toStartWith(':number has no option "style"');
    expect(problem('{$x :currency}')).toBe(
      ':currency needs its currency named: {$price :currency currency=EUR}, or currency=$code to take it from an argument',
    );
    expect(problem('{#b}bold')).toBe('{#b} is never closed: end it with {/b}');
    expect(problem('.input {$n :number}\n.match $n\nmany-things {{a}}\n* {{b}}')).toContain('a number key is a number or one of');
    expect(problem('.input {$n :number}\n.match $n\n1.0 {{a}}\n* {{b}}')).toContain('write it as 1');
  });

  test('a catalog in MF2: types, translation checks and generated files', () => {
    const config = fixture(
      {
        'copy/catalog/cart.yaml': [
          'cart.items:',
          '  en: |-',
          '    .input {$count :number}',
          '    .match $count',
          '    0 {{Your cart is empty.}}',
          '    one {{{$count} item in your cart.}}',
          '    * {{{$count} items in your cart.}}',
          "cart.terms: 'You agree to our {#link}terms{/link}.'",
          '',
        ].join('\n'),
        'copy/locales/de.yaml': "cart.terms: 'Sie stimmen unseren {#link}AGB{/link} zu.'\ncart.items: 'Artikel: {$n :number}'\n",
      },
      { messageFormat: 2, require: [] },
    );
    let problems: Problem[] = [];
    try {
      loadCatalog(config);
    } catch (e) {
      problems = (e as CatalogError).problems;
    }
    expect(problems.map((p) => `${whereOf(p)}: ${p.message}`)).toEqual([
      'copy/locales/de.yaml cart.items: differs from the source: missing {count}; unknown {n}',
    ]);

    writeFileSync(join(config.locales, 'de.yaml'), "cart.terms: 'Sie stimmen unseren {#link}AGB{/link} zu.'\n");
    const catalog = loadCatalog(config);
    expect(catalog.messages.find((m) => m.key === 'cart.items')!.args.get('count')).toBe('number');
    expect(catalog.messages.find((m) => m.key === 'cart.terms')!.tags).toEqual(['link']);
    const index = generate(config).files.get(join(config.out, 'index.ts'))!;
    expect(index).toContain(' * .match $count');
  });
});

describe('options from arguments', () => {
  test('an option an argument gives formats with its value, a formatter kept per value', () => {
    const total = 'Total: {$price :currency currency=$code}';
    expect(t(total, { price: 1234.5, code: 'USD' })).toBe('Total: $1,234.50');
    expect(t(total, { price: 1234.5, code: 'EUR' })).toBe('Total: €1,234.50');
    // `Intl` puts no-break spaces before a symbol or a day period.
    const spaced = (s: string) => s.replace(/[  ]/g, ' ');
    expect(spaced(t(total, { price: 1234.5, code: 'JPY' }, 'de'))).toBe('Total: 1.235 ¥');
    const due = 'Due {$when :time timeZone=$tz}';
    const when = new Date(Date.UTC(2026, 0, 5, 14, 30));
    expect([t(due, { when, tz: 'UTC' }), t(due, { when, tz: 'Asia/Tokyo' })].map(spaced)).toEqual(['Due 2:30 PM', 'Due 11:30 PM']);
    expect(t('{$n :currency currency=EUR fractionDigits=$d}', { n: 3.14159, d: 0 })).toBe('€3');
    expect(t('{$n :currency currency=EUR fractionDigits=$d}', { n: 3.14159, d: 3 })).toBe('€3.142');
  });

  test('options carry over from .input, and a .local literal is a literal option', () => {
    const signed = '.input {$n :number minimumFractionDigits=$d}\n{{{$n :number signDisplay=always} or {$n}}}';
    expect(t(signed, { n: 3, d: 2 })).toBe('+3.00 or 3.00');
    expect(compiled(signed)).toBe(
      '(a, h) => [h.n(a.n, o0, { minimumFractionDigits: a.d }) ?? h.e("{$n}"), " or ", h.n(a.n, undefined, { minimumFractionDigits: a.d }) ?? h.e("{$n}")]',
    );
    expect(compiled('.local $c = {|JPY|}\n{{{$price :currency currency=$c}}}')).toBe('(a, h) => h.n(a.price, o0) ?? h.e("{$price}")');
  });

  test('a currency or unit declared once carries over to each use, from a literal or an argument', () => {
    const inEuros = '.input {$price :currency currency=EUR}\n{{{$price :currency fractionDigits=0} or {$price}}}';
    expect(t(inEuros, { price: 9.5 })).toBe('€10 or €9.50');
    const inAny = '.input {$price :currency currency=$code}\n{{{$price :currency fractionDigits=0} or {$price}}}';
    expect(t(inAny, { price: 9.5, code: 'USD' })).toBe('$10 or $9.50');
    expect(t('.input {$d :unit unit=kilometer}\n{{{$d :unit unitDisplay=long}}}', { d: 3 })).toBe('3 kilometers');
    expect(() => parseMf2('.input {$price :number}\n{{{$price :currency fractionDigits=0}}}', 'en')).toThrow(
      ':currency needs its currency named',
    );
  });

  test('the argument is typed, documented at the call site, and written back as it was', () => {
    const ast = parseMf2('{$price :currency currency=$code currencyDisplay=$display}', 'en');
    expect([...argsOf(ast)]).toEqual([
      ['code', 'string'],
      ['display', '"narrowSymbol" | "symbol" | "name" | "code"'],
      ['price', 'number'],
    ]);
    expect(formatsOf(ast).get('price')).toBe('`:currency currency=$code currencyDisplay=$display`');
    expect(toMf2(ast, 'en')).toBe('{$price :currency currency=$code currencyDisplay=$display}');
  });

  test('what an argument can not give is refused, saying why', () => {
    const problem = (message: string) => {
      try {
        parseMf2(message, 'en');
        return 'no problem';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(problem('{$n :number select=$s}')).toBe(
      ":number select=$s: select is settled as the message compiles, so write its value in the message: of :number's, only signDisplay, minimumIntegerDigits, minimumFractionDigits, maximumFractionDigits, minimumSignificantDigits, maximumSignificantDigits can",
    );
    expect(problem('{$d :date fields=$f}')).toEndWith("of :date's, only timeZone, calendar can");
    expect(problem('.input {$c :number}\n{{{$p :currency currency=$c}}}')).toBe(
      ":currency currency=$c: $c is formatted, so it can't give an option: name the argument itself",
    );
    expect(problem('{|5| :currency currency=$c}')).toStartWith('|5| :currency currency=$c: a literal is formatted as the message compiles');
  });

  test("MF1 can't say it, so migrate refuses", () => {
    expect(() => toMf1(parseMf2('{$price :currency currency=$code}', 'en'))).toThrow(
      "{price :currency currency=$code} takes an option from an argument, which MF1 can't: write the option's value in the message",
    );
    expect(() =>
      toMf1(parseMf2('.input {$n :number minimumFractionDigits=$d}\n.match $n\none {{{$n} item}}\n* {{{$n} items}}', 'en')),
    ).toThrow("{n} is selected with minimumFractionDigits from an argument, which MF1 can't say");
  });

  test('a catalog checks the argument against its translations, and the build types it', () => {
    const config = fixture(
      {
        'copy/catalog/cart.yaml': "cart.total: 'Total: {$price :currency currency=$code}'\n",
        'copy/locales/de.yaml': "cart.total: 'Summe: {$price :currency currency=EUR}'\n",
      },
      { messageFormat: 2, require: [] },
    );
    let problems: Problem[] = [];
    try {
      loadCatalog(config);
    } catch (e) {
      problems = (e as CatalogError).problems;
    }
    expect(problems.map((p) => `${whereOf(p)}: ${p.message}`)).toEqual([
      'copy/locales/de.yaml cart.total: differs from the source: missing {code}',
    ]);

    writeFileSync(join(config.locales, 'de.yaml'), "cart.total: 'Summe: {$price :currency currency=$code}'\n");
    const { files } = generate(config);
    expect(files.get(join(config.out, 'index.ts'))).toContain('code: string');
    expect(files.get(join(config.out, 'de.ts'))).toContain('h.n(a.price, o0, { currency: a.code })');
  });
});

describe('as the spec renders', () => {
  /** A message read with `isolate`, its direction marks shown as <…> so a failure reads. */
  const shown = (message: string, values: Record<string, unknown>, locale = 'en', isolate: Isolate = 'rtl') => {
    const ast = parseMf2(message, locale, { isolate });
    const m = evaluated([['m', ast]]).m!;
    const out = typeof m === 'string' ? m : m(values, createHelpers(locale));
    return flatten(out).join('').replace(/[⁦-⁨]/g, '<').replace(/⁩/g, '>');
  };

  test('a plural selects on the number as formatted: 1.0 is other in English', () => {
    const miles = '.input {$n :number minimumFractionDigits=1}\n.match $n\none {{{$n} mile}}\n* {{{$n} miles}}';
    expect([shown(miles, { n: 1 }), shown(miles, { n: 2 })]).toEqual(['1.0 miles', '2.0 miles']);
    const digits = '.input {$n :number minimumFractionDigits=$d}\n.match $n\none {{{$n} mile}}\n* {{{$n} miles}}';
    expect([shown(digits, { n: 1, d: 0 }), shown(digits, { n: 1, d: 1 })]).toEqual(['1 mile', '1.0 miles']);
    expect([...argsOf(parseMf2(digits, 'en'))]).toEqual([
      ['d', 'number'],
      ['n', 'number'],
    ]);
  });

  test(':percent selects on the value times 100, :integer on it rounded', () => {
    const percent = '.input {$p :percent}\n.match $p\n0 {{none}}\none {{{$p}, one}}\n* {{{$p}, other}}';
    expect([shown(percent, { p: 0 }), shown(percent, { p: 0.01 }), shown(percent, { p: 0.5 })]).toEqual(['none', '1%, one', '50%, other']);
    const integer = '.input {$n :integer}\n.match $n\n1 {{exactly one}}\n* {{{$n}}}';
    expect([shown(integer, { n: 1.4 }), shown(integer, { n: 1.6 })]).toEqual(['exactly one', '2']);
  });

  test('a selector is written back with its function', () => {
    const back = (message: string) => toMf2(parseMf2(message, 'en'), 'en');
    expect(back('.input {$n :number minimumFractionDigits=1}\n.match $n\none {{{$n} mile}}\n* {{{$n} miles}}')).toBe(
      '.input {$n :number minimumFractionDigits=1}\n.match $n\none {{{$n :number minimumFractionDigits=1} mile}}\n* {{{$n :number minimumFractionDigits=1} miles}}',
    );
    expect(back('.input {$n :number select=exact}\n.match $n\n1 {{one}}\n* {{other}}')).toBe(
      '.input {$n :number select=exact}\n.match $n\n1 {{one}}\n* {{other}}',
    );
  });

  test('placeholders are isolated in a right-to-left locale, where u:dir asks, or always if asked', () => {
    expect(shown('שלום {$name}, יש {$n :number}!', { name: 'Ada', n: 3 }, 'he')).toBe('שלום <Ada>, יש <3>!');
    expect(shown('Hi {$name}, {$n :number}', { name: 'Ada', n: 3 })).toBe('Hi Ada, 3');
    expect(shown('Hi {$name :string u:dir=rtl}', { name: 'שלום' })).toBe('Hi <שלום>');
    expect(shown('Hi {$name}, {$n :number}', { name: 'Ada', n: 3 }, 'en', 'always')).toBe('Hi <Ada>, 3');
    expect(shown('שלום {$name}', { name: 'Ada' }, 'he', false)).toBe('שלום Ada');
    expect(toMf2(parseMf2('Hi {$name :string u:dir=rtl}', 'en'), 'en')).toBe('Hi {$name :string u:dir=rtl}');
    expect(() => parseMf2('{$x :string u:dir=$d}', 'en')).toThrow(
      ':string u:dir is one of ltr, rtl, auto, inherit, written in the message',
    );
  });

  test('a placeholder with no value shows as MF2 writes it, isolated where it would be', () => {
    expect(shown('Hi {$name}', {})).toBe('Hi {$name}');
    expect(shown('שלום {$name}', {}, 'he')).toBe('שלום <{$name}>');
    expect(shown('{$p :currency currency=$c}', { p: 1, c: 'euro' })).toBe('{$p}');
  });

  test('isolate is a config option, and migrate compares without it', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': "app.hi: 'Hi {$name}'\n", 'copy/locales/he.yaml': "app.hi: 'שלום {$name}'\n" },
      { messageFormat: 2, require: [], isolate: false },
    );
    expect(generate(config).files.get(join(config.out, 'he.ts'))).not.toContain('\\u2068');
    const isolated = resolveConfig(config.root, { messageFormat: 2, require: [] });
    expect(generate(isolated).files.get(join(config.out, 'he.ts'))).toContain('["\\u2068", a.name ?? h.e("{$name}"), "\\u2069"]');
    expect(planMigrate(isolated, 1).changed).toEqual([]);
  });
});

describe('writing MessageFormat 2', () => {
  const mf2 = (mf1: string, locale = 'en') => toMf2(parseMessage(mf1), locale);

  test('a plural inside a sentence becomes variants holding the whole sentence', () => {
    expect(mf2('You have {n, plural, one {# item} other {# items}} in your cart')).toBe(
      '.input {$n :number}\n.match $n\none {{You have {$n} item in your cart}}\n* {{You have {$n} items in your cart}}',
    );
  });

  test('formats, tags and escapes', () => {
    expect(mf2("Total: {amount, number, ::currency/EUR}. Read the <b>terms</b>. Use '{'braces'}'.")).toBe(
      String.raw`Total: {$amount :currency currency=EUR}. Read the {#b}terms{/b}. Use \{braces\}.`,
    );
    expect(mf2('{n, number, integer} {p, number, percent} {d, date, long} {t, time, short}')).toBe(
      '{$n :integer} {$p :percent} {$d :date length=long} {$t :time}',
    );
  });

  test('an offset becomes an :offset local, its exact keys moved by it', () => {
    expect(mf2('{n, plural, offset:1 =0 {Nobody} =1 {Just you} one {You and # other} other {You and # others}}')).toBe(
      [
        '.input {$n :number}',
        '.local $n_minus_1 = {$n :offset subtract=1}',
        '.match $n_minus_1',
        '-1 {{Nobody}}',
        '0 {{Just you}}',
        'one {{You and {$n_minus_1} other}}',
        '* {{You and {$n_minus_1} others}}',
      ].join('\n'),
    );
  });

  test('two selectors keep only the variants a reader needs', () => {
    expect(mf2('{days, plural, one {# day} other {# days}}. {speed, select, express {Fast.} other {Slow.}}')).toBe(
      [
        '.input {$days :number}',
        '.input {$speed :string}',
        '.match $days $speed',
        'one express {{{$days} day. Fast.}}',
        'one * {{{$days} day. Slow.}}',
        '* express {{{$days} days. Fast.}}',
        '* * {{{$days} days. Slow.}}',
      ].join('\n'),
    );
    // The inner select only matters in one arm, so the other arm needs no variant per speed.
    expect(mf2('{n, plural, =0 {None} other {{speed, select, express {{n, number} fast} other {{n, number} slow}}}}')).toBe(
      [
        '.input {$n :number}',
        '.input {$speed :string}',
        '.match $n $speed',
        '0 * {{None}}',
        '* express {{{$n} fast}}',
        '* * {{{$n} slow}}',
      ].join('\n'),
    );
  });

  test('what MF2 has no word for is refused, saying what', () => {
    expect(() => mf2('{n, number, ::compact-short}')).toThrow("{n}'s notation: compact has no MessageFormat 2 equivalent");
    expect(() => mf2('{0} items')).toThrow(`"0" can't be a MessageFormat 2 name`);
  });

  test('back to MF1: plural values as #, functions as skeletons or named styles', () => {
    const mf1 = (text: string) => toMf1(parseMf2(text, 'en'));
    expect(mf1('.input {$count :number}\n.match $count\n0 {{None}}\none {{{$count} item}}\n* {{{$count} items}}')).toBe(
      '{count, plural, =0 {None} one {# item} other {# items}}',
    );
    expect(
      mf1('{$n :number minimumFractionDigits=2 maximumFractionDigits=2} {$p :percent} {$d :date length=long} {$m :date fields=month-day}'),
    ).toBe('{n, number, ::.00} {p, number, percent} {d, date, long} {m, date, ::MMMd}');
    expect(() => mf1('{$n :number useGrouping=min2}')).toThrow('formats in a way no MF1 skeleton says');
  });
});

describe('prosebook migrate', () => {
  const example = join(import.meta.dir, '..', 'examples', 'vite');

  test('the example catalog goes to MF2 and back, rendering the same throughout', () => {
    const root = fixture({}).root;
    cpSync(join(example, 'copy'), join(root, 'copy'), { recursive: true });
    const one = resolveConfig(root, { source: 'en', require: [] });
    const before = loadCatalog(one);

    const toTwo = planMigrate(one, 2);
    expect(toTwo.blocked).toEqual([]);
    // German's medium date is numeric (05.01.2026); MF2's nearest spells the month out.
    expect(toTwo.changed.map((c) => [c.key, c.locale, c.before, c.after])).toEqual([
      ['app.last-visit', 'de', 'Dein letzter Besuch war am 05.01.2026 um 14:30.', 'Dein letzter Besuch war am 5. Jan. 2026 um 14:30.'],
    ]);
    expect(toTwo.rewrites.find((r) => r.key === 'cart.terms' && r.locale === 'en')?.after).toBe(
      'By checking out you agree to our {#link}terms of sale{/link}.',
    );
    applyMigrate(one, toTwo);
    expect(readFileSync(join(root, 'copy', 'catalog', 'cart.yaml'), 'utf8')).toContain('  context: Heads the shopping cart panel.');

    const two = resolveConfig(root, { source: 'en', require: [], messageFormat: 2 });
    const migrated = loadCatalog(two);
    expect(migrated.messages.map((m) => [m.key, [...m.args]])).toEqual(before.messages.map((m) => [m.key, [...m.args]]));
    expect(generate(two).catalog.messages.length).toBe(before.messages.length);

    const back = planMigrate(two, 1);
    expect(back.blocked).toEqual([]);
    expect(back.changed.map((c) => [c.key, c.locale])).toEqual([['app.last-visit', 'de']]);
  });

  test('quoting survives the trip both ways', () => {
    const messages = [
      "app.a: \"Don't stop, it's {name}'s turn\"",
      "app.b: \"Use '{'braces'}' and a '<'tag'>' literally\"",
      'app.c: "{n, plural, one {# item, number \'#\'1} other {# items}}"',
      "app.d: \"It''s <b>{name}</b>''s\"",
      'app.e: "{g, select, she {{n, plural, one {She has # cat} other {She has # cats}}} other {They have {n, number} cats}}"',
    ];
    const config = fixture({ 'copy/catalog/app.yaml': `${messages.join('\n')}\n` }, { require: [] });
    const toTwo = planMigrate(config, 2);
    expect([toTwo.blocked, toTwo.changed]).toEqual([[], []]);
    applyMigrate(config, toTwo);
    const two = resolveConfig(config.root, { require: [], messageFormat: 2 });
    const back = planMigrate(two, 1);
    expect([back.blocked, back.changed]).toEqual([[], []]);
    expect(back.rewrites.find((r) => r.key === 'app.a')?.after).toBe("Don't stop, it's {name}'s turn");
  });

  test('extract writes MF2 into an MF2 catalog', async () => {
    const config = fixture(
      { 'src/Inbox.jsx': 'export function Inbox({ user, files }) {\n  return <p>Hi {user.name}, you have {files.length} files.</p>;\n}\n' },
      { messageFormat: 2 },
    );
    const plan = await planExtract(config, [join(config.root, 'src', 'Inbox.jsx')], { types: false });
    expect(plan.files[0]!.extractions.map((x) => x.message)).toEqual([
      '.input {$filesCount :number}\n.match $filesCount\none {{Hi {$name}, you have {$filesCount} file.}}\n* {{Hi {$name}, you have {$filesCount} files.}}',
    ]);
    applyExtract(config, plan);
    expect(loadCatalog(config).messages[0]!.args).toEqual(
      new Map([
        ['name', 'string'],
        ['filesCount', 'number'],
      ]),
    );
  });

  test('a message whose output would change is reported, and one with no equivalent stops the write', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': "app.when: 'On {d, date, short}'\napp.big: '{n, number, ::compact-short} views'\n" },
      { require: [] },
    );
    const plan = planMigrate(config, 2);
    expect(plan.changed.map((c) => c.key)).toEqual(['app.when']);
    expect(plan.blocked.map((b) => [b.key, b.reason])).toEqual([['app.big', "{n}'s notation: compact has no MessageFormat 2 equivalent"]]);
    expect(() => applyMigrate(config, plan)).toThrow('nothing was written');
    writeFileSync(join(config.catalog, 'app.yaml'), "app.when: 'On {d, date, short}'\n");
    expect(readMessage(1, 'On {d, date, short}', 'en')).toHaveLength(2);
  });
});
