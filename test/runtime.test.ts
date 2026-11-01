import { describe, expect, test } from 'bun:test';

import { chainOf, createCopy, defineCatalog, negotiate, type CompiledMessages } from 'prosebook';

import { parseMessage } from '#src/tools/icu.ts';
import { compiled, copyOf } from './fixture.ts';

describe('locale negotiation', () => {
  const available = ['en', 'de', 'pt-BR', 'pt', 'zh-Hant'] as const;

  test('exact, then parents, then a sibling of the same language', () => {
    expect(negotiate('de-AT', available, 'en')).toBe('de');
    expect(negotiate(['fr-CA', 'pt-br'], available, 'en')).toBe('pt-BR');
    expect(negotiate('pt-PT', available, 'en')).toBe('pt');
    expect(negotiate('zh-Hant-TW', available, 'en')).toBe('zh-Hant');
    expect(negotiate(['ja', 'fr'], available, 'en')).toBe('en');
  });

  test('the lookup chain runs through available parents to the source', () => {
    expect(chainOf('pt-BR', available, 'en')).toEqual(['pt-BR', 'pt', 'en']);
    expect(chainOf('en', available, 'en')).toEqual(['en']);
  });
});

describe('copy', () => {
  test('falls back key by key, formatting each message in its own locale', async () => {
    const copy = copyOf({ en: { 'a.n': '{n, number}', 'a.only': 'English only {n, number}' }, de: { 'a.n': '{n, number}' } });
    await copy.setLocale('de');
    expect(copy.t('a.n', { n: 1234.5 })).toBe('1.234,5');
    expect(copy.t('a.only', { n: 1234.5 })).toBe('English only 1,234.5');
  });

  test('a missing key reads as itself, or as onMissing says', () => {
    expect(copyOf({ en: {} }).t('a.b' as never)).toBe('a.b');
    expect(copyOf({ en: {} }, { onMissing: (k) => `⚠ ${k}` }).t('a.b' as never)).toBe('⚠ a.b');
  });

  test('lazy locales load once, switch after loading, and notify', async () => {
    let loads = 0;
    const de: CompiledMessages = compiled([['a.b', parseMessage('Hallo')]]);
    const catalog = defineCatalog({
      source: 'en',
      locales: ['en', 'de'],
      messages: { en: compiled([['a.b', parseMessage('Hello')]]) },
      loaders: { de: async () => (loads++, { default: de }) },
    });
    const copy = createCopy(catalog);
    const seen: string[] = [];
    copy.subscribe(() => seen.push(copy.t('a.b' as never)));
    const switching = copy.setLocale('de-CH');
    expect(copy.locale).toBe('en');
    await switching;
    await copy.setLocale('de');
    expect([copy.locale, loads, seen]).toEqual(['de', 1, ['Hallo']]);
  });

  test('a slow load does not undo a later switch', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const catalog = defineCatalog({
      source: 'en',
      locales: ['en', 'de', 'fr'],
      messages: { en: {} },
      loaders: {
        de: async () => (await slow, { default: {} }),
        fr: async () => ({ default: {} }),
      },
    });
    const copy = createCopy(catalog);
    const de = copy.setLocale('de');
    await copy.setLocale('fr');
    release();
    await de;
    expect(copy.locale).toBe('fr');
  });

  test('the starting locale is negotiated from what the reader prefers', async () => {
    const copy = copyOf({ en: { 'a.b': 'Hi' }, 'fr-CA': { 'a.b': 'Allo' } }, { locale: ['es', 'fr'] });
    await copy.ready;
    expect([copy.locale, copy.t('a.b' as never)]).toEqual(['fr-CA', 'Allo']);
  });

  test('default tags apply to rich reads unless a call supplies its own', () => {
    const copy = copyOf({ en: { 'a.b': 'See <b>this</b>' } }, { tags: { b: (c: string[]) => `**${c.join('')}**` } });
    expect(copy.rich('a.b' as never)).toEqual(['See **this**']);
    expect(copy.rich('a.b' as never, { b: (c: string[]) => `_${c.join('')}_` } as never)).toEqual(['See _this_']);
  });

  test('formatters follow the current locale', async () => {
    const copy = copyOf({ en: {}, de: {} });
    expect(copy.list(['a', 'b', 'c'])).toBe('a, b, and c');
    await copy.setLocale('de');
    expect(copy.list(['a', 'b', 'c'])).toBe('a, b und c');
    expect(copy.relative(-1, 'day', { numeric: 'auto' })).toBe('gestern');
  });
});
