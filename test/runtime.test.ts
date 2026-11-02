import { describe, expect, test } from 'bun:test';

import {
  acceptedLocales,
  addArea,
  chainOf,
  createCopy,
  defineCatalog,
  negotiate,
  type CompiledMessages,
  type DevHooks,
  type HotHook,
} from 'prosebook';

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

  test('Accept-Language is read by weight, ties in the order asked', () => {
    expect(acceptedLocales('de;q=0.1, en;q=0.9')).toEqual(['en', 'de']);
    expect(negotiate(acceptedLocales('de;q=0.1, en;q=0.9'), available, 'pt')).toBe('en');
    expect(acceptedLocales('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5')).toEqual(['fr-CH', 'fr', 'en', 'de']);
    expect(acceptedLocales('pt-BR,de;q=0.5,pt;q=0.5')).toEqual(['pt-BR', 'de', 'pt']);
    expect(acceptedLocales('de ; Q = 0.5 , en')).toEqual(['en', 'de']);
  });

  test('Accept-Language leaves out what no one asked for', () => {
    expect(acceptedLocales('de;q=0, en')).toEqual(['en']);
    expect(acceptedLocales('de;q=high, , *, en')).toEqual(['en']);
    expect(acceptedLocales('')).toEqual([]);
    expect(acceptedLocales(null)).toEqual([]);
    expect(acceptedLocales(undefined)).toEqual([]);
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

  test('in dev, an edited locale swaps in place, and the copy notifies', async () => {
    const hot = new Set<HotHook>();
    (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
    try {
      const copy = copyOf({ en: { 'a.b': 'Cart', 'a.c': 'Add' }, de: { 'a.b': 'Warenkorb' } });
      await copy.setLocale('de');
      const seen: string[] = [];
      copy.subscribe(() => seen.push(copy.t('a.b' as never)));
      const before = copy.version;
      for (const update of hot) {
        update('de', { 'a.b': 'Dein Warenkorb' });
        update('en', { 'a.b': 'Cart', 'a.c': 'Add one' });
        update('tr', { 'a.b': 'Sepet' });
      }
      expect(seen).toEqual(['Dein Warenkorb', 'Dein Warenkorb']);
      expect([copy.locale, copy.version - before, copy.t('a.c' as never)]).toEqual(['de', 2, 'Add one']);
    } finally {
      delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
    }
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

  test('a split catalog takes each area in as it loads, in the locale shown, and an edit only to the areas it holds', async () => {
    const message = (key: string, text: string) => compiled([[key, parseMessage(text)]]);
    const catalog = defineCatalog({
      source: 'en',
      locales: ['en', 'de'],
      messages: {},
      loaders: {},
      split: { id: 'split-test', areas: ['a', 'b'] },
    });
    const copy = createCopy(catalog, { locale: 'de', onError: () => {} });
    await copy.ready;
    expect(copy.t('a.x' as never)).toBe('a.x');
    const hot = new Set<HotHook>();
    (globalThis as DevHooks).__PROSEBOOK_HOT__ = hot;
    try {
      const unloaded: string[] = [];
      const watched = createCopy(catalog, { onError: (_e, key) => unloaded.push(key) });
      await addArea('split-test', 'a', { en: message('a.x', 'A') }, { de: async () => ({ default: message('a.x', 'A de') }) });
      // Settled once the copy holds the area in German, so the code reading it renders in German first.
      expect([copy.t('a.x' as never), watched.t('a.x' as never)]).toEqual(['A de', 'A']);
      for (const update of hot) update('en', { 'a.x': 'A edited', 'b.y': 'B' });
      expect([watched.t('a.x' as never), watched.t('b.y' as never), ...unloaded]).toEqual(['A edited', 'b.y', 'b.y']);
    } finally {
      delete (globalThis as DevHooks).__PROSEBOOK_HOT__;
    }
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
