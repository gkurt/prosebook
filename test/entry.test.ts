import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { editEntry, readEntry } from 'prosebook/tools';

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

const project = () =>
  fixture(
    {
      'copy/catalog/cart.yaml': CATALOG,
      'copy/locales/de/cart.yaml': "cart.title: Warenkorb\ncart.items: '{count, plural, other {# Artikel}}'\n",
    },
    { require: [] },
  );

describe('editing an entry in place', () => {
  test('an entry reads as fields and as the YAML written for it', () => {
    const view = readEntry(project(), 'cart.items', 'de');
    expect(view.files).toEqual({ catalog: 'copy/catalog/cart.yaml', translation: 'copy/locales/de/cart.yaml' });
    expect(view.fields).toMatchObject({ kind: 'state', context: 'Counts what is in the cart.', args: { count: 'how many items' } });
    expect(view.fields.translation).toBe('{count, plural, other {# Artikel}}');
    expect(view.yaml.catalog).toBe(CATALOG.slice(CATALOG.indexOf('cart.items:')).trimEnd());
    expect(view.yaml.translation).toBe("cart.items: '{count, plural, other {# Artikel}}'");
    expect(view.argNames).toEqual(['count']);
    expect(readEntry(project(), 'cart.items', 'en').locale).toBeUndefined();
  });

  test('fields are written into the file, which keeps its comments and other entries', () => {
    const config = project();
    const view = readEntry(config, 'cart.title', 'de');
    const result = editEntry(
      config,
      'cart.title',
      'de',
      { fields: { ...view.fields, message: 'Your cart', translation: 'Dein Warenkorb', kind: 'name', context: 'Heads the cart.' } },
      true,
    );
    expect(result.problems).toEqual([]);
    expect(readFileSync(join(config.root, 'copy/catalog/cart.yaml'), 'utf8')).toBe(
      CATALOG.replace('cart.title: Cart', 'cart.title:\n  kind: name\n  context: Heads the cart.\n  en: Your cart'),
    );
    expect(readFileSync(join(config.root, 'copy/locales/de/cart.yaml'), 'utf8')).toStartWith('cart.title: Dein Warenkorb\n');
  });

  test('an edit that would break the catalog comes back as problems, and nothing is written', () => {
    const config = project();
    const view = readEntry(config, 'cart.items');
    const result = editEntry(
      config,
      'cart.items',
      undefined,
      { fields: { ...view.fields, message: '{n, plural, one {# item} other {# items}}' } },
      true,
    );
    expect(result.problems.map((p) => p.message).join('\n')).toContain('args.count is not an argument of this message');
    expect(readFileSync(join(config.root, 'copy/catalog/cart.yaml'), 'utf8')).toBe(CATALOG);
  });

  test('YAML replaces the entry as typed, must keep its key, and without write only comes back as the view', () => {
    const config = project();
    const yaml =
      "cart.items:\n  kind: state\n  context: Counts the cart.\n  args:\n    count: how many items\n  en: '{count, plural, one {# thing} other {# things}}'";
    const preview = editEntry(config, 'cart.items', undefined, { yaml: { catalog: yaml } }, false);
    expect(preview.view?.fields).toMatchObject({ context: 'Counts the cart.', message: '{count, plural, one {# thing} other {# things}}' });
    expect(readFileSync(join(config.root, 'copy/catalog/cart.yaml'), 'utf8')).toBe(CATALOG);

    const renamed = editEntry(config, 'cart.items', undefined, { yaml: { catalog: yaml.replace('cart.items:', 'cart.count:') } }, true);
    expect(renamed.problems[0]?.message).toContain('rename a key in the code and the catalog together');

    expect(editEntry(config, 'cart.items', undefined, { yaml: { catalog: yaml } }, true).problems).toEqual([]);
    expect(readFileSync(join(config.root, 'copy/catalog/cart.yaml'), 'utf8')).toContain('Counts the cart.');
  });
});
