import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generate, loadCatalog } from 'prosebook/tools';

import { SCHEMA_LINE } from '#src/tools/catalog.ts';
import { readLock } from '#src/tools/lock.ts';
import { applyRename, planRename } from '#src/tools/rename.ts';
import { cli, fixture } from './fixture.ts';

const shop = () => {
  const config = fixture(
    {
      'copy/catalog/cart.yaml': [
        SCHEMA_LINE,
        'cart.items: Items in the cart',
        '# The button that ends the visit.',
        'cart.checkout:',
        '  context: A button.',
        '  en: Check out',
        'cart.checkout.hint: Pays securely.',
        '',
      ].join('\n'),
      'prosebook.config.json': '{ "require": [] }',
      'copy/locales/de.yaml': 'cart.items: Artikel im Warenkorb\ncart.checkout: Zur Kasse\n',
      'copy/locales/fr/cart.yaml': 'cart.checkout: Payer\n',
      'src/Cart.tsx': [
        "export const Cart = ({ t, x }) => <p title={t('cart.checkout.hint')}>{t(\"cart.checkout\")}{t('cart.items')}</p>;",
        'export const label = (t, x) => t(`cart.${x}`);',
        "export const hint = (t, x) => t('cart.checkout.' + x);",
        '',
      ].join('\n'),
    },
    { require: [] },
  );
  generate(config);
  return config;
};

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');

describe('rename', () => {
  test('a key and the keys under it move to their new area, with translations, lock and code', () => {
    const config = shop();
    const anchors = readLock(config.lock).translations;
    const plan = planRename(config, 'cart.checkout', 'pay.button');
    expect(plan.problems).toEqual([]);
    expect([...plan.keys]).toEqual([
      ['cart.checkout', 'pay.button'],
      ['cart.checkout.hint', 'pay.button.hint'],
    ]);
    // Only the prefix that may reach a renamed key without moving with it is named.
    expect(plan.prefixed).toEqual([{ file: 'src/Cart.tsx', line: 2, prefix: 'cart.' }]);
    applyRename(plan);

    expect(read(config.root, 'copy/catalog/cart.yaml')).toBe(`${SCHEMA_LINE}\ncart.items: Items in the cart\n`);
    expect(read(config.root, 'copy/catalog/pay.yaml')).toBe(
      [
        SCHEMA_LINE,
        '# The button that ends the visit.',
        'pay.button:',
        '  context: A button.',
        '  en: Check out',
        'pay.button.hint: Pays securely.',
        '',
      ].join('\n'),
    );
    expect(read(config.root, 'copy/locales/de.yaml')).toBe('cart.items: Artikel im Warenkorb\npay.button: Zur Kasse\n');
    // A locale's area file the move empties goes, and the new area's takes the translation.
    expect(existsSync(join(config.root, 'copy/locales/fr/cart.yaml'))).toBe(false);
    expect(read(config.root, 'copy/locales/fr/pay.yaml')).toBe('pay.button: Payer\n');
    expect(read(config.root, 'src/Cart.tsx')).toContain(
      "t('pay.button.hint')}>{t(\"pay.button\")}{t('cart.items')}</p>;\nexport const label = (t, x) => t(`cart.${x}`);\nexport const hint = (t, x) => t('pay.button.' + x);",
    );
    const after = readLock(config.lock).translations;
    expect(after['de']?.['pay.button']).toBe(anchors['de']?.['cart.checkout']);
    expect(after['de']?.['cart.checkout']).toBeUndefined();
    expect(after['fr']?.['pay.button']).toBe(anchors['fr']?.['cart.checkout']);

    const catalog = loadCatalog(config);
    expect(catalog.messages.map((m) => m.key)).toEqual(['cart.items', 'pay.button', 'pay.button.hint']);
    expect(catalog.messages[1]!.translations.get('fr')?.text).toBe('Payer');
  });

  test('an area renamed whole takes its prefixes in the code with it', () => {
    const config = shop();
    const plan = planRename(config, 'cart', 'basket');
    expect(plan.prefixed).toEqual([]);
    applyRename(plan);
    expect(existsSync(join(config.root, 'copy/catalog/cart.yaml'))).toBe(false);
    expect(read(config.root, 'copy/catalog/basket.yaml')).toStartWith(`${SCHEMA_LINE}\nbasket.items: Items in the cart\n`);
    expect(read(config.root, 'copy/locales/de.yaml')).toBe('basket.items: Artikel im Warenkorb\nbasket.checkout: Zur Kasse\n');
    expect(read(config.root, 'src/Cart.tsx')).toContain('t(`basket.${x}`)');
    expect(read(config.root, 'src/Cart.tsx')).toContain("t('basket.checkout.' + x)");
  });

  test('a rename that would break the catalog or lose a key writes nothing', () => {
    const config = shop();
    const problems = (from: string, to: string) => planRename(config, from, to).problems.map((p) => p.message);
    expect(problems('cart.total', 'cart.sum')).toEqual(['no key is cart.total or starts with cart.total.: name one the catalog has']);
    expect(problems('cart.checkout', 'cart.items')).toEqual(['cart.items is an entry already: rename or remove it first']);
    expect(problems('cart.items', 'Cart.Items')).toEqual(['Cart.Items is not a key: dotted lowercase, with two segments at least']);
    expect(problems('cart.items', 'items')).toEqual(['items is not a key: dotted lowercase, with two segments at least']);
    expect(problems('cart', 'cart.old')).toEqual(['cart.old is under cart, which moves with it: rename it in two steps']);
  });

  test('the command is a dry run until --write, then regenerates', () => {
    const config = shop();
    const dry = cli(config.root, 'rename', 'cart.items', 'cart.count');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('would rename 1 key(s):\n  cart.items → cart.count');
    expect(dry.stdout).toContain('1 reference(s) in 1 code file(s):\n  src/Cart.tsx (1)');
    expect(read(config.root, 'copy/catalog/cart.yaml')).toContain('cart.items:');

    const done = cli(config.root, 'rename', 'cart.items', 'cart.count', '--write');
    expect(done.code).toBe(0);
    expect(read(config.root, 'copy/catalog/cart.yaml')).toContain('cart.count: Items in the cart');
    expect(read(config.root, 'src/copy/en.ts')).toContain('cart.count');
  });
});
