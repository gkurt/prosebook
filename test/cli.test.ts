import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { editEntry, importTranslations } from 'prosebook/tools';

import { cli, fixture } from './fixture.ts';

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');

describe('a broken entry', () => {
  const files = {
    'copy/catalog/app.yaml': 'app.title:\n  context: The header.\n  en: My app\n',
    'copy/catalog/cart.yaml': [
      'cart.title:\n  context: The heading of the cart.\n  en: Your cart\n',
      'cart.items:\n  context: Counts the cart.\n  en: "{count, plural, one {# item} other {# items}"\n',
    ].join(''),
    'copy/locales/de.yaml': 'app.title: Meine App\ncart.items: "{count, plural, one {# Artikel} other {# Artikel}}"\n',
    'copy/lock.json': JSON.stringify({ version: 2, sources: {}, translations: { de: { 'cart.items': 'aaaaaaaaaa:bbbbbbbbbb' } } }),
  };

  test('is reported, and generate writes the rest of the catalog and fails', () => {
    const { root } = fixture(files);
    const run = cli(root, 'generate');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('error copy/catalog/cart.yaml cart.items: is not valid ICU MessageFormat');
    expect(run.stderr).toContain("1 error(s) in the catalog: those entries are left out until they're fixed.");
    // Its translation is left out with it, not reported as unused.
    expect(run.stderr).not.toContain('no such key in the catalog');
    const index = read(root, 'src/copy/index.ts');
    expect(index).toContain('"app.title"');
    expect(index).toContain('"cart.title"');
    expect(index).not.toContain('"cart.items"');
    // The lock keeps what it knew of the translations it couldn't read.
    expect(JSON.parse(read(root, 'copy/lock.json')).translations.de['cart.items']).toBe('aaaaaaaaaa:bbbbbbbbbb');
  });

  test('lint, scan, status and check run over the rest, and fail', () => {
    const { root } = fixture(files);
    cli(root, 'generate');
    for (const command of ['lint', 'scan', 'status', 'check']) {
      const run = cli(root, command);
      expect(run.code).toBe(1);
      // Said once, even by check, which renders the catalog for each of its parts.
      expect(run.stderr.split('cart.items: is not valid ICU').length).toBe(2);
    }
    expect(cli(root, 'lint').stdout).toContain('2 messages pass the writing rules, and 1 broken entry was left out');
  });

  test("doesn't stop an edit to another entry, or an import", () => {
    const config = fixture(files);
    const fields = {
      message: 'Your basket',
      translations: {},
      context: 'The heading of the cart.',
      kind: '',
      surface: '',
      fragment: false,
      args: {},
      comment: '',
      remove: false,
    };
    const edited = editEntry(config, 'cart.title', { fields }, true);
    expect(edited.problems).toEqual([]);
    expect(read(config.root, 'copy/catalog/cart.yaml')).toContain('en: Your basket');
    const imported = importTranslations(config, 'de', 'cart.title: Dein Warenkorb\n');
    expect(imported).toEqual({ written: ['cart.title'], unchanged: [], problems: [] });
  });

  test('an edit that breaks an entry is still refused', () => {
    const config = fixture(files);
    const imported = importTranslations(config, 'de', 'cart.title: "{oops"\n');
    expect(imported.written).toEqual([]);
    expect(imported.problems.map((p) => p.key)).toEqual(['cart.title']);
    expect(read(config.root, 'copy/locales/de.yaml')).toBe(files['copy/locales/de.yaml']);
  });
});

test('init writes a catalog that generates, with nothing for scan to report', () => {
  const root = join(fixture({}).root, 'fresh');
  mkdirSync(root);
  expect(cli(root, 'init').code).toBe(0);
  expect(read(root, 'copy/catalog/app.yaml')).toContain('# app.title:');
  expect(cli(root, 'generate').code).toBe(0);
  expect(cli(root, 'scan').stdout).toContain('0 hardcoded string(s), 0 formatted in code, 0 unused key(s)');
});

test("scan and check report a read whose key a pruned build can't see", () => {
  const { root } = fixture({
    'copy/catalog/app.yaml': 'app.title:\n  context: The header.\n  en: My app\n',
    'src/App.tsx': "export const App = ({ t, id }) => <h1>{t('app.title')}{t(id)}</h1>;\n",
  });
  cli(root, 'generate');
  const scan = cli(root, 'scan');
  expect(scan.code).toBe(0);
  expect(scan.stderr).toContain("warn  src/App.tsx:1:56 a pruned build can't see the key t(id) reads: write the key at the read");
  expect(scan.stdout).toContain('1 unseen read(s)');
  expect(cli(root, 'scan', '--strict').code).toBe(1);
  const check = cli(root, 'check');
  expect(check.code).toBe(0);
  expect(check.stderr).toContain("src/App.tsx:1:56 a pruned build can't see the key t(id) reads");
});

test('generate run again, as after a dev server wrote the files, says they are current', () => {
  const { root } = fixture({ 'copy/catalog/app.yaml': 'app.title:\n  context: The header.\n  en: My app\n' });
  expect(cli(root, 'generate').stdout).toContain('wrote');
  expect(cli(root, 'generate').stdout).toContain('prosebook: the generated files are current (1 messages, 1 locale(s))');
});
