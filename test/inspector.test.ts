import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import type { DevHooks } from 'prosebook';
import { entryLocation, loadCatalog } from 'prosebook/tools';

import { keyAt, record, type Reads } from '#src/inspector.ts';
import { copyOf, fixture } from './fixture.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

test('the runtime reports each read as the text it shows and the locale it was found in', () => {
  const seen: string[] = [];
  (globalThis as DevHooks).__PROSEBOOK_READ__ = (key, text, locale) => seen.push(`${key} ${locale}: ${text}`);
  try {
    const copy = copyOf({
      en: { 'a.title': 'Cart', 'a.items': '{n, plural, one {# item} other {# items}}', 'a.terms': 'Read <link>the terms</link>.' },
      de: { 'a.title': 'Warenkorb' },
    });
    copy.t('a.items', { n: 3 });
    copy.rich('a.terms', { link: (chunks: unknown[]) => ({ element: chunks }) });
    copy.t('a.nope');
    expect(seen).toEqual(['a.items en: 3 items', 'a.terms en: Read the terms.']);
  } finally {
    delete (globalThis as DevHooks).__PROSEBOOK_READ__;
  }
});

describe('finding the key under the pointer', () => {
  const reads: Reads = new Map();
  record(reads, 'cart.title', 'Cart', 'en');
  record(reads, 'cart.terms', 'Read the terms.', 'de');
  record(reads, 'legal.terms', 'terms', 'en');
  record(reads, 'cart.add', 'Add', 'en');
  record(reads, 'cart.search', 'Search items', 'en');
  record(reads, 'cart.total', 'Total: €9.00', 'en');
  record(reads, 'menu.add', 'Add', 'en');

  const page = () => {
    document.body.innerHTML =
      '<h1>Cart</h1><p>Read <a href="#">the terms</a>.</p><div><span>3 items</span> · <button>Add</button></div><input placeholder="Search items">' +
      '<div><strong>Total: €9.00</strong><button id="pay">Pay</button></div>';
    return document.body;
  };
  const textIn = (selector: string) => document.querySelector(selector)!.firstChild!;

  test('a rich message wins over a shorter text inside one of its elements', () => {
    const body = page();
    const hit = keyAt(body.querySelector('a')!, { node: textIn('a'), offset: 6 }, reads);
    expect(hit?.read).toEqual({ key: 'cart.terms', locale: 'de' });
    expect(hit?.element.tagName).toBe('P');
  });

  test('a text ending where the hovered one begins does not take its place', () => {
    const body = page();
    record(reads, 'cart.pay', 'Pay', 'en');
    const hit = keyAt(body.querySelector('#pay')!, { node: textIn('#pay'), offset: 0 }, reads);
    expect(hit?.read.key).toBe('cart.pay');
    expect(hit?.element.id).toBe('pay');
  });

  test('text shared by two keys names the one read last, and counts the other', () => {
    const body = page();
    const hit = keyAt(body.querySelector('button')!, { node: textIn('button'), offset: 1 }, reads);
    expect(hit?.read.key).toBe('menu.add');
    expect(hit?.others).toBe(1);
    expect(hit?.element.tagName).toBe('BUTTON');
  });

  test('without a caret, the whole text or a readable attribute must match', () => {
    const body = page();
    expect(keyAt(body.querySelector('h1')!, undefined, reads)?.read.key).toBe('cart.title');
    expect(keyAt(body.querySelector('input')!, undefined, reads)?.read.key).toBe('cart.search');
    expect(keyAt(body.querySelector('span')!, undefined, reads)).toBeUndefined();
  });

  test('the oldest texts are forgotten first', () => {
    const many: Reads = new Map();
    for (let i = 0; i <= 2000; i++) record(many, `a.k${i}`, `text ${i}`, 'en');
    expect(many.has('text 0')).toBe(false);
    expect(many.has('text 2000')).toBe(true);
  });
});

test("an entry is found in the translation's file, or the catalog's", () => {
  const config = fixture({
    'copy/catalog/cart.yaml': "# Cart\ncart.title: Cart\n'cart.add':\n  context: Adds one.\n  en: Add\n",
    'copy/locales/de/cart.yaml': 'cart.add: Hinzufügen\n',
  });
  const { messages } = loadCatalog({ ...config, require: [] });
  const add = messages.find((m) => m.key === 'cart.add')!;
  const where = (locale?: string) => {
    const { file, line, column } = entryLocation(config, add, locale);
    return `${file.slice(config.root.length + 1).replaceAll('\\', '/')}:${line}:${column}`;
  };
  expect(where()).toBe('copy/catalog/cart.yaml:3:1');
  expect(where('de')).toBe('copy/locales/de/cart.yaml:1:1');
  expect(where('tr')).toBe('copy/catalog/cart.yaml:3:1');
});
