import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import Metro from 'metro';
import { getDefaultConfig, mergeConfig } from 'metro-config';

import { withProsebook, type ProsebookMetroOptions } from '#src/metro.ts';
import { fixture } from './fixture.ts';

// Metro names its runtime's modules by package, which a Bun install keeps beside Metro, not at the root.
const fromMetro = createRequire(createRequire(import.meta.url).resolve('metro'));

const files = {
  'copy/catalog/app.yaml': 'app.used: Used message\napp.unused: Unused message\n',
  'copy/locales/de.yaml': 'app.used: Benutzte Nachricht\napp.unused: Unbenutzte Nachricht\n',
  'src/main.js': "import { catalog } from './copy/index.js';\nexport const read = (copy) => [catalog, copy.t('app.used')];\n",
  // The runtime is the app's dependency; only what the integration hands Metro is under test.
  'node_modules/prosebook/package.json': '{ "name": "prosebook", "main": "index.js" }',
  'node_modules/prosebook/index.js': 'export const defineCatalog = (catalog) => catalog;\n',
};

/** The bundle Metro writes in dev or production, or the error it fails with. */
async function bundle(dev: boolean, extra: Record<string, string> = {}, options: ProsebookMetroOptions = {}) {
  const config = fixture({ ...files, ...extra });
  const metro = mergeConfig(await getDefaultConfig(config.root), {
    projectRoot: config.root,
    watchFolders: [config.root],
    reporter: { update: () => {} },
    transformer: { asyncRequireModulePath: fromMetro.resolve('metro-runtime/src/modules/asyncRequire') },
  });
  const wrapped = await withProsebook(metro, { ...options, config: { require: [], language: 'js', pseudo: 'en-XA', ...options.config } });
  const out = join(config.root, 'bundle.js');
  try {
    await Metro.runBuild(wrapped, { entry: './src/main.js', dev, minify: false, out, platform: 'ios' });
    return { config, js: readFileSync(out, 'utf8') };
  } catch (e) {
    return { config, error: e instanceof Error ? e.message : String(e) };
  }
}

test('a production bundle ships only the messages the code names, without the pseudo-locale', async () => {
  const { js, error } = await bundle(false);
  expect(error).toBeUndefined();
  expect(js).toContain('Used message');
  expect(js).toContain('Benutzte Nachricht');
  expect(js).not.toContain('Unused message');
  expect(js).not.toContain('Unbenutzte Nachricht');
  expect(js).not.toContain('en-XA');
});

test('a dev bundle ships every message, and each locale accepts its update and hands it to the copies', async () => {
  const { config, js, error } = await bundle(true);
  expect(error).toBeUndefined();
  expect(js).toContain('Unused message');
  expect(js).toContain('en-XA');
  expect(js).toContain('globalThis.__PROSEBOOK_HOT__ ??= new Set()');
  expect(js).toContain('update("de", messages)');
  const wrapper = readFileSync(join(config.root, 'node_modules/.prosebook/metro/dev/de.js'), 'utf8');
  expect(wrapper).toContain('import messages from "../../../../src/copy/de.js";');
  expect(wrapper).toContain('if (module.hot) module.hot.accept();');
});

test('a strict production bundle fails on a read whose key it cannot see; dev still bundles', async () => {
  const unseen = { 'src/menu.js': 'export const label = (copy, key) => copy.t(key);\n' };
  expect((await bundle(false, unseen)).error).toMatch(/1 read\(s\) whose key the build can't see[^]*src\/menu\.js:1:/);
  expect((await bundle(true, unseen)).js).toContain('Unused message');
  expect((await bundle(false, unseen, { prune: 'loose' })).js).toContain('Used message');
});

test("a TypeScript catalog's `./en.js` resolves to the locale", async () => {
  const { js, error } = await bundle(
    false,
    { 'src/main.js': "import { catalog } from './copy/index.ts';\nexport const read = (copy) => [catalog, copy.t('app.used')];\n" },
    { config: { language: 'ts' } },
  );
  expect(error).toBeUndefined();
  expect(js).toContain('Benutzte Nachricht');
});
