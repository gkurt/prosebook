import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import type { DevHooks } from 'prosebook';
import { entryLocation, loadCatalog } from 'prosebook/tools';

import { keyAt, rangeOf } from '#src/inspector/locate.ts';
import { record, type Reads } from '#src/inspector/reads.ts';
import { checkShortcut, gestureOf, type Modifier } from '#src/inspector/shortcut.ts';
import { installInspector } from '#src/tools/bundle.ts';
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

  test('a text beside others in one element is found where it stands, across its elements', () => {
    document.body.innerHTML = '<p>Ready. <span>Read <a href="#">the terms</a>.</span> Cart</p>';
    const p = document.querySelector('p')!;
    const hit = keyAt(p, { node: p.lastChild!, offset: 2 }, reads);
    expect(hit?.read.key).toBe('cart.title');
    expect(hit?.at).toEqual({ start: 23, end: 27 });
    expect(rangeOf(p, hit!.at!).toString()).toBe('Cart');
    const terms = keyAt(document.querySelector('a')!, { node: textIn('a'), offset: 2 }, reads);
    expect(terms?.element.tagName).toBe('SPAN');
    expect(rangeOf(p, { start: 7, end: 22 }).toString()).toBe('Read the terms.');
    expect(rangeOf(terms!.element, terms!.at!).toString()).toBe('Read the terms.');
  });

  test('without a caret, the space around a whole text is left out', () => {
    document.body.innerHTML = '<h1>  Cart \n</h1>';
    const h1 = document.querySelector('h1')!;
    expect(rangeOf(h1, keyAt(h1, undefined, reads)!.at!).toString()).toBe('Cart');
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

describe('the gesture', () => {
  const keys = (flags: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>>) =>
    new MouseEvent('click', { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...flags });

  test('is Alt and the left button unset', () => {
    const gesture = gestureOf(checkShortcut());
    expect(gesture.button).toBe(0);
    expect(gesture.held(keys({ altKey: true }))).toBe(true);
    expect(gesture.isModifier('Alt')).toBe(true);
  });

  test('holds exactly its keys, so AltGr, Control and Alt, is not Alt', () => {
    const alt = gestureOf(checkShortcut());
    expect(alt.held(keys({ altKey: true, ctrlKey: true }))).toBe(false);
    const both = gestureOf(checkShortcut({ modifiers: ['Control', 'Shift'], button: 'right' }));
    expect(both.button).toBe(2);
    expect(both.held(keys({ ctrlKey: true }))).toBe(false);
    expect(both.held(keys({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(both.isModifier('Shift')).toBe(true);
    expect(both.isModifier('Alt')).toBe(false);
  });

  test('refuses no keys, a key it does not know and a button it does not know', () => {
    expect(() => checkShortcut({ modifiers: [] })).toThrow('hold at least one');
    expect(() => checkShortcut({ modifiers: ['Ctrl' as Modifier] })).toThrow("has 'Ctrl': name one of 'Alt', 'Control', 'Meta', 'Shift'");
    expect(() => checkShortcut({ button: 'back' as 'left' })).toThrow("is 'back': name one of 'left', 'middle', 'right'");
  });

  test('travels to the page in the code that starts the inspector, checked as it is written', () => {
    expect(installInspector('/i.js', '/', undefined)).toContain('"shortcut":{"modifiers":["Alt"],"button":"left"}');
    expect(installInspector('/i.js', '/', { button: 'middle' })).toContain('"shortcut":{"modifiers":["Alt"],"button":"middle"}');
    expect(() => installInspector('/i.js', '/', { modifiers: [] })).toThrow('hold at least one');
  });
});
