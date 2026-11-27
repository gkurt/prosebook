import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import type { DevHooks } from 'prosebook';
import { entryLocation, loadCatalog } from 'prosebook/tools';

import { prosebook, type EntryEdit } from '#src/deictic/index.ts';
import { keyAt, rangeOf } from '#src/deictic/locate.ts';
import { listen, record, type Reads } from '#src/deictic/reads.ts';
import { readEntry } from '#src/tools/entry.ts';
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

test("the page's record of reads starts once, and every copy reports to it", () => {
  const hooks = globalThis as DevHooks;
  try {
    const reads = listen();
    expect(listen()).toBe(reads);
    copyOf({ en: { 'a.title': 'Cart' } }).t('a.title');
    expect(reads.get('Cart')).toEqual([{ key: 'a.title', locale: 'en' }]);
  } finally {
    delete hooks.__PROSEBOOK_READ__;
    delete hooks.__PROSEBOOK_READS__;
  }
});

describe('the deictic plugin', () => {
  const set = async () => {
    const config = fixture(
      {
        'copy/catalog/cart.yaml': 'cart.title: Cart\n',
        'copy/locales/fr/app.yaml': 'app.title: Boutique\n',
        'copy/catalog/app.yaml': 'app.title: Shop\n',
      },
      { require: [] },
    );
    const plugin = prosebook({ config: { require: [] } });
    const closing: (() => unknown)[] = [];
    await plugin.setup!({ root: config.root, use: () => undefined, report: () => {}, onClose: (run) => void closing.push(run) });
    return { config, plugin, close: () => closing.forEach((run) => run()) };
  };
  const target = { loc: { file: 'src/App.tsx', line: 1, column: 1 }, tag: 'h1' };

  test('records what the server reads until the last dev server using it closes', async () => {
    // The process's record, which other files' dev servers may hold: set aside for this test's own.
    const hooks = globalThis as DevHooks & { __PROSEBOOK_SERVED__?: unknown };
    const before = { read: hooks.__PROSEBOOK_READ__, served: hooks.__PROSEBOOK_SERVED__ };
    delete hooks.__PROSEBOOK_READ__;
    delete hooks.__PROSEBOOK_SERVED__;
    try {
      await recordsUntilClosed(hooks);
    } finally {
      hooks.__PROSEBOOK_READ__ = before.read;
      hooks.__PROSEBOOK_SERVED__ = before.served;
    }
  });

  const recordsUntilClosed = async (hooks: DevHooks) => {
    const first = await set();
    const second = await set();
    copyOf({ en: { 'a.title': 'Cart' } }).t('a.title');
    const read = async () =>
      (await (await first.plugin.routes!.reads!(new Request('http://x/'), {} as never)).json()) as [string, unknown][];
    expect((await read()).map(([text]) => text)).toContain('Cart');
    first.close();
    expect(hooks.__PROSEBOOK_READ__).toBeDefined();
    second.close();
    second.close();
    expect(hooks.__PROSEBOOK_READ__).toBeUndefined();
  };

  test("hands deictic each file an edit changes, whole, and a locale's new file from its start", async () => {
    const { config, plugin } = await set();
    const fields = { ...readEntry(config, 'cart.title').fields, message: 'Basket', translations: { fr: 'Panier' } };
    const edits = (await plugin.apply!(new Error(), target, { key: 'cart.title', fields } satisfies EntryEdit)) as {
      file: string;
      start: number;
      end: number;
      text: string;
    }[];
    expect(edits).toEqual([
      { file: 'copy/catalog/cart.yaml', start: 0, end: 'cart.title: Cart\n'.length, text: 'cart.title: Basket\n' },
      { file: 'copy/locales/fr/cart.yaml', start: 0, end: 0, text: 'cart.title: Panier\n' },
    ]);
  });

  test('refuses an edit that would break the catalog, or changes nothing', async () => {
    const { config, plugin } = await set();
    const fields = readEntry(config, 'cart.title').fields;
    // Why deictic is refused the edit: the message its panel shows.
    const refused = async (edit: EntryEdit) => {
      try {
        await plugin.apply!(new Error(), target, edit);
        return '';
      } catch (e) {
        return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    };
    expect(await refused({ key: 'cart.title', fields })).toContain('Refusal: nothing to change');
    expect(await refused({ key: 'cart.title', fields: { ...fields, message: '{oops' } })).toMatch(/^Refusal: .*cart\.yaml/);
  });

  test('answers the entry, a check as it is typed, and where it is written', async () => {
    const { plugin } = await set();
    const { entry, place } = plugin.routes!;
    const read = (await (await entry!(new Request('http://x/?key=cart.title'), {} as never)).json()) as { key: string };
    expect(read.key).toBe('cart.title');
    const fields = { ...readEntry((await set()).config, 'cart.title').fields, message: 'Your  cart' };
    const checked = await entry!(
      new Request('http://x/', { method: 'POST', body: JSON.stringify({ key: 'cart.title', fields }) }),
      {} as never,
    );
    expect(((await checked.json()) as { view: { findings: { rule: string }[] } }).view.findings.map((f) => f.rule)).toContain('whitespace');
    const at = await place!(new Request('http://x/?key=cart.title&locale=fr'), {} as never);
    expect(await at.json()).toEqual({ file: 'copy/catalog/cart.yaml', line: 1, column: 1 });
  });
});
