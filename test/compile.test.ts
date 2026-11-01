import { describe, expect, test } from 'bun:test';

import { compileLocale } from 'copydeck/tools';

import { parseMessage } from '#src/tools/icu.ts';
import { copyOf } from './fixture.ts';

const say = (message: string, args?: Record<string, unknown>, locale = 'en') => {
  const copy = copyOf({ [locale]: { 'x.y': message } }, {});
  return copy.t('x.y', args);
};

describe('compiled messages', () => {
  test('a message with no placeholders compiles to its string', () => {
    const { rows } = compileLocale([['a.b', parseMessage("It's '{'literal'}'")]]);
    expect(rows).toEqual(['  "a.b": "It\'s {literal}",']);
  });

  test('arguments and literals', () => {
    expect(say('Hello, {name}!', { name: 'Ada' })).toBe('Hello, Ada!');
    expect(say('{a}{b}', { a: 1, b: 'x' })).toBe('1x');
  });

  test('plural: exact matches, categories, # and offset', () => {
    const m = '{n, plural, =0 {none} one {# item} other {# items}}';
    expect(say(m, { n: 0 })).toBe('none');
    expect(say(m, { n: 1 })).toBe('1 item');
    expect(say(m, { n: 1234 })).toBe('1,234 items');
    const offset = '{n, plural, offset:1 =0 {nobody} =1 {you} one {you and # other} other {you and # others}}';
    expect(say(offset, { n: 1 })).toBe('you');
    expect(say(offset, { n: 2 })).toBe('you and 1 other');
    expect(say(offset, { n: 5 })).toBe('you and 4 others');
  });

  test('plural rules come from the locale the words are in', () => {
    const m = '{n, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}';
    expect(say(m, { n: 1 }, 'pl')).toBe('1 plik');
    expect(say(m, { n: 3 }, 'pl')).toBe('3 pliki');
    expect(say(m, { n: 5 }, 'pl')).toBe('5 plików');
  });

  test('selectordinal', () => {
    const m = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
    expect([1, 2, 3, 4, 11, 22].map((n) => say(m, { n }))).toEqual(['1st', '2nd', '3rd', '4th', '11th', '22nd']);
  });

  test('select falls through to other, and nests a plural', () => {
    const m =
      '{who, select, me {I have {n, plural, one {# cat} other {# cats}}} other {{who} has {n, plural, one {# cat} other {# cats}}}}';
    expect(say(m, { n: 1, who: 'me' })).toBe('I have 1 cat');
    expect(say(m, { n: 3, who: 'Bo' })).toBe('Bo has 3 cats');
  });

  test('number styles and skeletons', () => {
    expect(say('{x, number}', { x: 1234.5 })).toBe('1,234.5');
    expect(say('{x, number, integer}', { x: 1234.5 })).toBe('1,235');
    expect(say('{x, number, percent}', { x: 0.25 })).toBe('25%');
    expect(say('{x, number, ::currency/EUR}', { x: 9 })).toBe('€9.00');
    expect(say('{x, number, ::compact-short}', { x: 12000 })).toBe('12K');
    expect(say('{x, number, ::currency/EUR}', { x: 9 }, 'de')).toBe('9,00 €');
  });

  test('date and time styles', () => {
    const when = new Date(2026, 9, 28, 14, 5);
    expect(say('{d, date, medium}', { d: when })).toBe('Oct 28, 2026');
    expect(say('{d, time, short}', { d: when })).toBe('2:05 PM');
    expect(say('{d, date, ::yMMMMd}', { d: when })).toBe('October 28, 2026');
  });

  test('tags render as their text in a plain read and through functions in a rich one', () => {
    const copy = copyOf({ en: { 'a.b': 'Read the <link>terms of <b>sale</b></link>.' } });
    expect(copy.t('a.b')).toBe('Read the terms of sale.');
    const out = copy.rich('a.b', {
      link: (chunks: unknown[]) => ({ link: chunks }),
      b: (chunks: unknown[]) => ({ b: chunks }),
    });
    expect(out).toEqual(['Read the ', { link: ['terms of ', { b: ['sale'] }] }, '.']);
  });

  test('formatting options are hoisted and shared', () => {
    const { declarations, rows } = compileLocale([
      ['a.a', parseMessage('{x, number, ::currency/EUR}')],
      ['a.b', parseMessage('{y, number, ::currency/EUR}')],
    ]);
    expect(declarations).toEqual(['const o0 = {"style":"currency","currency":"EUR"};']);
    expect(rows.every((r) => r.includes(', o0)'))).toBe(true);
  });
});
