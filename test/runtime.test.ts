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

describe('defineCatalog', () => {
  test('refuses generated code it does not read, saying what to run', () => {
    const catalog = { source: 'en', locales: ['en'], messages: { en: {} }, loaders: {} };
    expect(defineCatalog(catalog).source).toBe('en');
    expect(defineCatalog({ ...catalog, runtime: 1 }).runtime).toBe(1);
    expect(() => defineCatalog({ ...catalog, runtime: 99 })).toThrow('generated for a newer runtime (99)');
    expect(() => defineCatalog({ ...catalog, runtime: 0 })).toThrow('run `prosebook generate`');
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

  test('on a server, a copy hands on the file of each area it reads in a lazy locale, once', async () => {
    const message = (key: string, text: string) => compiled([[key, parseMessage(text)]]);
    const catalog = defineCatalog({
      source: 'en',
      locales: ['en', 'de', 'de-AT'],
      messages: { en: { ...message('a.x', 'A'), ...message('b.y', 'B'), ...message('c.z', 'C') } },
      loaders: { de: async () => ({ default: {} }), 'de-AT': async () => ({ default: {} }) },
      // `a` and `b` share a chunk, so a file; `c` has nothing in German.
      areaFiles: { a: { de: '/ab.de.js', 'de-AT': '/ab.de-AT.js' }, b: { de: '/ab.de.js' } },
    });
    const files: string[] = [];
    const copy = createCopy(catalog, { locale: 'de-AT', preload: (href) => files.push(href) });
    await copy.ready;
    for (const key of ['a.x', 'b.y', 'c.z', 'a.x']) copy.t(key as never);
    // Each locale the copy falls back through, its own first.
    expect(files).toEqual(['/ab.de-AT.js', '/ab.de.js']);
    const source: string[] = [];
    createCopy(catalog, { preload: (href) => source.push(href) }).t('a.x' as never);
    expect(source).toEqual([]);
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

  test('dates show in the copy’s time zone, unless a message names its own', () => {
    // 23:30 UTC on 31 December: already 1 January in Tokyo.
    const when = Date.UTC(2025, 11, 31, 23, 30);
    const en = { 'a.when': '{when, date, ::yMMMd} {when, time, ::Hm}' };
    expect(copyOf({ en }, { timeZone: 'UTC' }).t('a.when', { when })).toBe('Dec 31, 2025 23:30');
    const tokyo = copyOf({ en }, { timeZone: 'Asia/Tokyo' });
    expect(tokyo.timeZone).toBe('Asia/Tokyo');
    expect(tokyo.t('a.when', { when })).toBe('Jan 1, 2026 08:30');
    expect(tokyo.date(when, { dateStyle: 'medium' })).toBe('Jan 1, 2026');
    expect(tokyo.date(when, { dateStyle: 'medium', timeZone: 'UTC' })).toBe('Dec 31, 2025');
    const own = copyOf({ en: { 'a.when': '{$when :datetime dateLength=medium timeZone=UTC}' } }, { timeZone: 'Asia/Tokyo' }, 2);
    expect(own.t('a.when', { when })).toContain('Dec 31, 2025');
  });

  test('a time zone Intl refuses shows the date as its placeholder, and says why', () => {
    const errors: string[] = [];
    const copy = copyOf(
      { en: { 'a.when': 'On {when, date, medium}' } },
      { timeZone: 'Mars/Olympus', onError: (e) => errors.push(e.message) },
    );
    expect(copy.t('a.when', { when: 0 })).toBe('On {when}');
    expect(errors[0]).toContain('{when} could not be formatted');
  });
});
