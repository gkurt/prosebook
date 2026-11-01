import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { OnLoadCallback, PluginBuilder } from 'bun';

import { prosebook } from '#src/bun.ts';
import { fixture } from './fixture.ts';

const files = {
  'copy/catalog/app.yaml': 'app.used: Used message\napp.unused: Unused message\n',
  'copy/locales/de.yaml': 'app.used: Benutzte Nachricht\napp.unused: Unbenutzte Nachricht\n',
  'src/main.ts': [
    "import { createCopy } from 'prosebook';",
    "import { catalog } from './copy/index.ts';",
    'const copy = createCopy(catalog);',
    "await copy.setLocale('de');",
    "console.log(copy.t('app.used'));",
  ].join('\n'),
};

/** What `Bun.build` writes, joined, or the error it fails with. */
async function build(extra: Record<string, string> = {}, prune?: 'loose') {
  const config = fixture({ ...files, ...extra });
  try {
    const result = await Bun.build({
      entrypoints: [join(config.root, 'src/main.ts')],
      outdir: join(config.root, 'dist'),
      target: 'bun',
      conditions: ['prosebook@dev'],
      plugins: [prosebook({ root: config.root, config: { require: [] }, prune })],
    });
    return { config, js: result.outputs.map((o) => readFileSync(o.path, 'utf8')).join('\n') };
  } catch (e) {
    return { config, error: e instanceof AggregateError ? e.errors.map(String).join('\n') : String(e) };
  }
}

test('a build generates first and ships only the messages the code names', async () => {
  const { config, js } = await build();
  expect(readdirSync(join(config.root, 'src/copy')).sort()).toEqual(['de.ts', 'en.ts', 'index.ts']);
  expect(js).toContain('Used message');
  expect(js).toContain('Benutzte Nachricht');
  expect(js).not.toContain('Unused message');
  expect(js).not.toContain('Unbenutzte Nachricht');
});

test('a strict build fails on a read whose key it cannot see', async () => {
  const unseen = {
    'src/menu.ts':
      "import { createCopy } from 'prosebook';\nexport const label = (key: string) => createCopy({} as never).t(key as never);\n",
  };
  expect((await build(unseen)).error).toMatch(/1 read\(s\) whose key the build can't see[^]*src\/menu\.ts:2:/);
  expect((await build(unseen, 'loose')).js).toContain('Used message');
});

test("under Bun's dev server, the index sets up the hot hooks and each locale accepts its own update", async () => {
  const config = fixture(files);
  const loads: [RegExp, OnLoadCallback][] = [];
  // The dev server's bundler names no entry points.
  const builder = { config: { target: 'browser' }, onLoad: (o: { filter: RegExp }, cb: OnLoadCallback) => loads.push([o.filter, cb]) };
  const env = process.env.NODE_ENV;
  // As in production, so no catalog watcher outlives the test.
  process.env.NODE_ENV = 'production';
  try {
    await prosebook({ root: config.root, config: { require: [] } }).setup(builder as unknown as PluginBuilder);
  } finally {
    process.env.NODE_ENV = env;
  }
  const [filter, onLoad] = loads[0]!;
  const load = async (file: string) => {
    const path = join(config.root, 'src', 'copy', file);
    expect(filter.test(path)).toBe(true);
    return (await onLoad({ path, namespace: 'file', loader: 'ts', defer: () => Promise.resolve() })) as { contents: string } | undefined;
  };
  expect((await load('index.ts'))?.contents).toStartWith('globalThis.__PROSEBOOK_HOT__ ??= new Set();');
  expect((await load('de.ts'))?.contents).toContain('update("de", next.default)');
  expect(filter.test(join(config.root, 'src', 'main.ts'))).toBe(false);
});
