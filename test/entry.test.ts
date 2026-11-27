import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { editEntry, readEntry, type EntryFields, type ResolvedConfig } from 'prosebook/tools';

import { fixture } from './fixture.ts';

const CATALOG = `# The cart.
cart.title: Cart

cart.items:
  kind: state
  context: Counts what is in the cart.
  args:
    count: how many items
  en: '{count, plural, one {# item} other {# items}}'
`;

/** An edit written as deictic writes the files it hands back. */
function save(config: ResolvedConfig, key: string, fields: EntryFields) {
  const edited = editEntry(config, key, fields);
  for (const [path, content] of edited.files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return edited;
}

// German in a folder of area files, Turkish in one file, French in a folder without a cart file yet.
const project = () =>
  fixture(
    {
      'copy/catalog/cart.yaml': CATALOG,
      'copy/catalog/app.yaml': 'app.title: Shop\n',
      'copy/locales/de/cart.yaml': "cart.title: Warenkorb\ncart.items: '{count, plural, other {# Artikel}}'\n",
      'copy/locales/tr.yaml': 'app.title: Dükkan\n',
      'copy/locales/fr/app.yaml': 'app.title: Boutique\n',
    },
    { require: [] },
  );

const read = (config: { root: string }, file: string) => readFileSync(join(config.root, file), 'utf8');

describe('editing an entry in place', () => {
  test('an entry reads in every locale, as fields', () => {
    const view = readEntry(project(), 'cart.items');
    expect(view.locales).toEqual(['de', 'fr', 'tr']);
    expect(view.fields).toMatchObject({ kind: 'state', context: 'Counts what is in the cart.', args: { count: 'how many items' } });
    expect(view.fields.translations).toEqual({ de: '{count, plural, other {# Artikel}}', fr: '', tr: '' });
    expect(view.argNames).toEqual(['count']);
  });

  test('fields are written into each file, which keeps its comments and other entries', () => {
    const config = project();
    const view = readEntry(config, 'cart.title');
    const fields = {
      ...view.fields,
      message: 'Your cart',
      kind: 'name',
      context: 'Heads the cart.',
      translations: { de: 'Dein Warenkorb', fr: 'Panier', tr: 'Sepet: hepsi' },
    };
    expect(save(config, 'cart.title', fields).problems).toEqual([]);
    expect(read(config, 'copy/catalog/cart.yaml')).toBe(
      CATALOG.replace('cart.title: Cart', 'cart.title:\n  kind: name\n  context: Heads the cart.\n  en: Your cart'),
    );
    expect(read(config, 'copy/locales/de/cart.yaml')).toStartWith('cart.title: Dein Warenkorb\n');
    // A locale in one file gains the key there; one in a folder gains the area's file.
    // New values are quoted as catalogs are.
    expect(read(config, 'copy/locales/tr.yaml')).toBe("app.title: Dükkan\ncart.title: 'Sepet: hepsi'\n");
    expect(read(config, 'copy/locales/fr/cart.yaml')).toBe('cart.title: Panier\n');
  });

  test('a comment and a mark for removal are written in the catalog, and cleared', () => {
    const config = project();
    const view = readEntry(config, 'cart.items');
    expect(view.fields).toMatchObject({ comment: '', remove: false });
    const marked = { ...view.fields, comment: 'Say "in your cart".', remove: true };
    expect(save(config, 'cart.items', marked).problems).toEqual([]);
    expect(read(config, 'copy/catalog/cart.yaml')).toContain(
      `    count: how many items\n  comment: Say "in your cart".\n  remove: true\n  en: '{count`,
    );
    expect(readEntry(config, 'cart.items').fields).toMatchObject({ comment: 'Say "in your cart".', remove: true });

    expect(save(config, 'cart.items', view.fields).problems).toEqual([]);
    expect(read(config, 'copy/catalog/cart.yaml')).toBe(CATALOG);
  });

  test('a translation left empty is removed, and the locale falls back', () => {
    const config = project();
    const view = readEntry(config, 'cart.title');
    expect(save(config, 'cart.title', { ...view.fields, translations: { de: '' } }).problems).toEqual([]);
    expect(read(config, 'copy/locales/de/cart.yaml')).toBe("cart.items: '{count, plural, other {# Artikel}}'\n");
    expect(existsSync(join(config.root, 'copy/locales/fr/cart.yaml'))).toBe(false);
  });

  test('an edit that would break the catalog comes back as problems, and nothing is written', () => {
    const config = project();
    const view = readEntry(config, 'cart.items');
    const fields = { ...view.fields, message: '{n, plural, one {# item} other {# items}}', translations: { tr: 'Sepet {' } };
    const problems = save(config, 'cart.items', fields)
      .problems.map((p) => p.message)
      .join('\n');
    expect(problems).toContain('args.count is neither a placeholder nor a tag of this message');
    expect(read(config, 'copy/catalog/cart.yaml')).toBe(CATALOG);
    expect(read(config, 'copy/locales/tr.yaml')).toBe('app.title: Dükkan\n');
  });

  test('an edit checked without writing comes back with what lint says of it', () => {
    const config = project();
    const view = readEntry(config, 'cart.title');
    const preview = editEntry(config, 'cart.title', { ...view.fields, message: 'Your  cart' });
    expect(preview.problems).toEqual([]);
    expect(preview.view?.fields.message).toBe('Your  cart');
    expect(preview.view?.findings.find((f) => f.rule === 'whitespace')?.fixed).toBe('Your cart');
    expect(read(config, 'copy/catalog/cart.yaml')).toBe(CATALOG);
  });
});
