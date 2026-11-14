import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generate, render, translateLocale, type ProsebookConfig, type Translator } from 'prosebook/tools';

import { cli, fixture } from './fixture.ts';

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

const GERMAN: Record<string, string> = {
  'cart.title': 'Dein Warenkorb',
  'cart.items': '{count, plural, one {# Artikel} other {# Artikel}}',
  'cart.add': 'Einen in den Warenkorb',
};

/** A model answering each key its prompt asks for from `answers`, in a YAML block, and keeping the prompts. */
function model(answers: (prompt: string, request: number) => Record<string, string>) {
  const prompts: string[] = [];
  const translator: Translator = {
    id: 'test/model',
    translate: ({ prompt }) => {
      prompts.push(prompt);
      const asked = Object.entries(answers(prompt, prompts.length)).filter(([key]) => prompt.includes(`\n${key}:`));
      const lines = asked.map(([key, text]) => `${key}: '${text.replaceAll("'", "''")}'`);
      return Promise.resolve({
        text: `Here they are:\n\n\`\`\`yaml\n${lines.join('\n')}\n\`\`\`\n`,
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    },
  };
  return { translator, prompts };
}

// German with cart.add made from an earlier source, so stale, and the rest missing.
function project(translator: Translator, options: Partial<NonNullable<ProsebookConfig['translate']>> = {}) {
  const config = fixture(
    {
      'copy/catalog/cart.yaml': CATALOG.replace('Add one to cart', 'Add to cart'),
      'copy/locales/de/cart.yaml': 'cart.add: In den Warenkorb\n',
    },
    { translate: { model: translator, ...options } },
  );
  generate(config);
  writeFileSync(join(config.root, 'copy/catalog/cart.yaml'), CATALOG);
  return config;
}

const german = (config: { root: string }) => readFileSync(join(config.root, 'copy/locales/de/cart.yaml'), 'utf8');

describe('prosebook translate', () => {
  test('asks the model what todo --prompt says and writes its reply, the stale entry too', async () => {
    const { translator, prompts } = model(() => GERMAN);
    const config = project(translator);
    const done = await translateLocale(config, config.translate!, 'de');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toStartWith('Translate the entries below from English (en) into German (de).');
    expect(prompts[0]).toContain('# stale, the source changed: Add {+one +}to cart');
    expect(done.written.toSorted()).toEqual(['cart.add', 'cart.items', 'cart.title']);
    expect(done).toMatchObject({ left: [], problems: [], requests: 1, inputTokens: 10, outputTokens: 5, unpriced: 1 });
    expect(german(config)).toContain('cart.title: Dein Warenkorb');
    expect(german(config)).toContain('cart.add: Einen in den Warenkorb');
    expect(render(config).stale.get('de')?.size ?? 0).toBe(0);
  });

  test('a stale translation given back as it was is accepted as still right', async () => {
    const { translator } = model(() => ({ ...GERMAN, 'cart.add': 'In den Warenkorb' }));
    const config = project(translator);
    const done = await translateLocale(config, config.translate!, 'de');
    expect(done.accepted).toEqual(['cart.add']);
    expect(done.left).toEqual([]);
    expect(render(config).stale.get('de')?.size ?? 0).toBe(0);
  });

  test('a reply that breaks an entry is said back to the model, which gives that entry again', async () => {
    const { translator, prompts } = model((_prompt, request) => (request === 1 ? { ...GERMAN, 'cart.items': '{n} Artikel' } : GERMAN));
    const config = project(translator);
    const done = await translateLocale(config, config.translate!, 'de');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('An earlier reply to these entries was left out');
    expect(prompts[1]).toContain('- cart.items: ');
    expect(prompts[1]).not.toContain('\ncart.title:');
    expect(done.written.toSorted()).toEqual(['cart.add', 'cart.items', 'cart.title']);
    expect(done.problems).toEqual([]);
    expect(german(config)).toContain('{count, plural, one {# Artikel} other {# Artikel}}');
  });

  test('an entry the model never gets right is left, with what was wrong, and the rest written', async () => {
    const { translator, prompts } = model(() => ({ ...GERMAN, 'cart.items': '{n} Artikel' }));
    const config = project(translator);
    const done = await translateLocale(config, config.translate!, 'de');
    expect(prompts).toHaveLength(2);
    expect(done.left).toEqual(['cart.items']);
    expect(done.problems.map((p) => p.key)).toEqual(['cart.items']);
    expect(german(config)).not.toContain('cart.items');
  });

  test('a batch holds as many entries as translate.batch, each asked on its own', async () => {
    const { translator, prompts } = model(() => GERMAN);
    const config = project(translator, { batch: 2 });
    const settled: number[] = [];
    const done = await translateLocale(config, config.translate!, 'de', { progress: (n) => settled.push(n) });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain('\ncart.add:');
    expect(settled).toEqual([2, 3]);
    expect(done.written).toHaveLength(3);
  });

  test('the command is off without a model, and says how to turn it on', () => {
    const off = fixture({ 'copy/catalog/cart.yaml': CATALOG, 'copy/locales/de/cart.yaml': '' });
    const refused = cli(off.root, 'translate');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('translate is off: set translate.model in the config');
  });

  test('the command translates every locale the catalog has, and says what it took', () => {
    const reply = `\`\`\`yaml\n${Object.entries(GERMAN)
      .map(([key, text]) => `${key}: '${text}'`)
      .join('\n')}\n\`\`\``;
    const config = fixture({
      'copy/catalog/cart.yaml': CATALOG,
      'copy/locales/de/cart.yaml': '',
      'prosebook.config.ts': `export default { translate: { model: { id: 'test/model', translate: async () => ({ text: ${JSON.stringify(reply)}, cost: 0.002 }) } } };\n`,
    });
    const ran = cli(config.root, 'translate');
    expect(ran.stderr).toContain('prosebook: de 3 of 3 entries');
    expect(ran.stdout).toContain('prosebook: translated 3 entries into de');
    expect(ran.stdout).toContain('1 request(s) to test/model; 0 input tokens, 0 output; $0.002000');
    expect(ran.code).toBe(0);
    expect(german(config)).toContain('cart.title: Dein Warenkorb');
    expect(cli(config.root, 'translate', 'de').stdout).toContain('prosebook: de is complete');
    expect(cli(config.root, 'translate', 'en').stderr).toContain('en is the source');
  });
});
