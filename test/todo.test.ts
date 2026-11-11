import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { definePlugin, generate, importTranslations, render, todoOf, type ProsebookConfig } from 'prosebook/tools';

import { fixture } from './fixture.ts';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

const CATALOG = `cart.title:
  kind: name
  surface: heading
  context: Heads the cart page.
  en: Your cart

cart.items:
  kind: state
  surface: status
  context: Counts what is in the cart.
  args:
    count: how many items
  en: '{count, plural, one {# item} other {# items}}'

cart.add:
  kind: action
  surface: action
  context: The button on a product.
  en: Add one to cart
`;

// German in a folder of area files, with cart.add made from an earlier source, so stale.
const project = (options: ProsebookConfig = {}) => {
  const config = fixture(
    {
      'copy/catalog/cart.yaml': CATALOG.replace('Add one to cart', 'Add to cart'),
      'copy/locales/de/cart.yaml': 'cart.add: In den Warenkorb\n',
    },
    options,
  );
  generate(config);
  writeFileSync(join(config.root, 'copy/catalog/cart.yaml'), CATALOG);
  return config;
};

function cli(root: string, ...args: string[]) {
  const proc = Bun.spawnSync(['bun', '--conditions=prosebook@dev', CLI, ...args, '--root', root]);
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const read = (config: { root: string }, file: string) => readFileSync(join(config.root, file), 'utf8');

describe('prosebook todo', () => {
  test("lists what a locale is missing and what went stale, with each entry's kind and surface", () => {
    const config = project();
    const { catalog, stale } = render(config);
    const { count, text } = todoOf(config, catalog, stale.get('de')!, 'de');
    expect(count).toBe(3);
    expect(text).toContain('`prosebook import de <this file>`');
    expect(text).toContain(['# Heads the cart page.', '# kind: name, surface: heading', '# en: Your cart', 'cart.title: ""'].join('\n'));
    expect(text).toContain(['# stale, the source changed: Add {+one +}to cart', 'cart.add: In den Warenkorb'].join('\n'));
  });

  test('as a prompt, says how to reply, the forms a plural takes in the locale, and what each kind is', () => {
    const config = project();
    const { catalog } = render(config);
    const { text } = todoOf(config, catalog, new Map(), 'pl', true);
    expect(text).toStartWith('Translate the entries below from English (en) into Polish (pl).');
    expect(text).toContain('Reply with one YAML code block');
    expect(text).toContain('A plural in Polish takes the forms one, few, many, and other');
    expect(text).not.toContain('ordinal');
    expect(text).not.toContain('stale');
    expect(text).toContain('- action: Names what pressing the control does.');
    expect(text).toContain('- heading: ');
    expect(text).toEndWith('cart.title: ""\n```');
  });

  test('a prompt says the guidelines that read its locale and some entry in it', () => {
    const house = definePlugin({
      name: 'house',
      rules: {
        du: { type: 'guideline', description: 'Address the reader as du.', on: { locale: ['de'] } },
        everywhere: { type: 'guideline', description: 'Keep a button as short as its source.', on: { surface: ['action'], locale: 'all' } },
        errors: { type: 'guideline', description: 'Say what to do next.', on: { surface: ['error'], locale: 'all' } },
        english: { type: 'guideline', description: 'Talk plainly.' },
        offInCart: { type: 'guideline', description: 'Turned off in the cart.', on: { locale: 'all' } },
        checked: {
          type: 'occurrence',
          description: 'Half again as long as the source at most.',
          on: { locale: 'all' },
          count: 'characters',
          max: 1.5,
          relative: true,
          recommended: 'warn',
          guide: true,
        },
      },
    });
    const config = project({ lint: { plugins: [house], areas: { cart: { 'house/offInCart': 'off' } } } });
    const { catalog } = render(config);
    const prompt = (locale: string) => todoOf(config, catalog, new Map(), locale, true).text;
    expect(prompt('de-CH')).toContain(
      [
        'Guidelines:',
        '- Address the reader as du.',
        '- Keep a button as short as its source.',
        '- Half again as long as the source at most.',
      ].join('\n'),
    );
    expect(prompt('fr')).not.toContain('du.');
    for (const unsaid of ['Say what to do next.', 'Talk plainly.', 'Turned off in the cart.']) expect(prompt('de')).not.toContain(unsaid);
  });

  test('a stale entry in a prompt comes with how to treat it', () => {
    const config = project();
    const { catalog, stale } = render(config);
    expect(todoOf(config, catalog, stale.get('de')!, 'de', true).text).toContain('give it back unchanged if it still holds');
  });

  test('a complete locale says so', () => {
    const config = fixture({ 'copy/catalog/app.yaml': 'app.title: Shop\n', 'copy/locales/de.yaml': 'app.title: Laden\n' }, { require: [] });
    const { catalog } = render(config);
    expect(todoOf(config, catalog, new Map(), 'de', true)).toEqual({ count: 0, text: '# de is complete' });
  });
});

describe('prosebook import', () => {
  test("a model's reply lands in each entry's file", () => {
    const config = project();
    const reply = [
      'Here are the translations:',
      '',
      '```yaml',
      'cart.title: Dein Warenkorb',
      "cart.items: '{count, plural, one {# Artikel} other {# Artikel}}'",
      'cart.add: Einen in den Warenkorb',
      '```',
    ].join('\n');
    expect(importTranslations(config, 'de', reply)).toEqual({
      written: ['cart.title', 'cart.items', 'cart.add'],
      unchanged: [],
      problems: [],
    });
    expect(read(config, 'copy/locales/de/cart.yaml')).toBe(
      "cart.add: Einen in den Warenkorb\ncart.title: Dein Warenkorb\ncart.items: '{count, plural, one {# Artikel} other {# Artikel}}'\n",
    );
  });

  test('an entry that would break the catalog is left out with its problem, and the rest is written', () => {
    const config = project();
    const result = importTranslations(config, 'de', "cart.title: Warenkorb\ncart.items: '{n} Artikel'\ncart.gone: Weg\ncart.add: ''\n");
    expect(result.written).toEqual(['cart.title']);
    expect(result.problems.map((p) => [p.file, p.key])).toEqual([
      [undefined, 'cart.gone'],
      ['copy/locales/de/cart.yaml', 'cart.items'],
    ]);
    expect(result.problems[0]!.message).toBe('no entry has this key: translate only the keys `prosebook todo` or `export` gave out');
    expect(read(config, 'copy/locales/de/cart.yaml')).toBe('cart.add: In den Warenkorb\ncart.title: Warenkorb\n');
  });

  test('a locale with no files yet gets one', () => {
    const config = project();
    expect(importTranslations(config, 'fr', 'cart.title: Votre panier\n').written).toEqual(['cart.title']);
    expect(read(config, 'copy/locales/fr.yaml')).toBe('cart.title: Votre panier\n');
  });

  test("what isn't YAML, or is for the source, is refused whole", () => {
    const config = project();
    expect(importTranslations(config, 'de', 'cart.title: [Warenkorb').problems[0]!.message).toStartWith("the reply isn't YAML");
    expect(importTranslations(config, 'en', 'cart.title: Cart\n').problems[0]!.message).toBe('en is the source: import takes translations');
  });

  test('the CLI accepts a stale translation given back unchanged, so the locale is complete', () => {
    const config = project();
    const reply = join(config.root, 'reply.yaml');
    writeFileSync(
      reply,
      "cart.add: In den Warenkorb\ncart.title: Ihr Warenkorb\ncart.items: '{count, plural, one {# Artikel} other {# Artikel}}'\n",
    );
    const run = cli(config.root, 'import', 'de', reply);
    expect(run.stdout).toContain('prosebook: imported 2 translation(s) into de, and accepted 1 stale one(s) as still right');
    expect(run.code).toBe(0);
    expect(cli(config.root, 'status', '--strict').code).toBe(0);
  });
});
