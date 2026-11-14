import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { rspack } from '@rspack/core';

import { ProsebookPlugin, type ProsebookWebpackOptions } from '#src/webpack.ts';
import { fixture, generated } from './fixture.ts';

const files = {
  'copy/catalog/app.yaml': 'app.used: Used message\napp.unused: Unused message\n',
  'copy/locales/de.yaml': 'app.used: Benutzte Nachricht\napp.unused: Unbenutzte Nachricht\n',
  'src/main.js': [
    "import { createCopy } from 'prosebook';",
    "import { catalog } from './copy/index.js';",
    'const copy = createCopy(catalog);',
    "copy.setLocale('de').then(() => console.log(copy.t('app.used')));",
  ].join('\n'),
};

type Stats = { hasErrors(): boolean; toJson(o: object): { errors?: { message: string }[] } };
type Watching = { close(done: () => void): void };
type Bundler = (config: object) => {
  run(done: (error: Error | null, stats?: Stats) => void): void;
  watch(options: object, done: (error: Error | null, stats?: Stats) => void): Watching;
  close(done: () => void): void;
};

// Required, not imported: an import reads every export, and webpack warns of each deprecated one it reads.
const webpack = createRequire(import.meta.url)('webpack') as Bundler;

const BUNDLERS: [string, Bundler][] = [
  ['webpack', webpack],
  ['rspack', rspack],
];

function options(root: string, mode: string, plugin: ProsebookWebpackOptions) {
  return {
    mode,
    context: root,
    entry: './src/main.js',
    output: { path: join(root, 'dist') },
    devtool: false,
    optimization: { minimize: false },
    // The runtime is the app's dependency; only what the plugin hands over is under test.
    externals: { prosebook: 'commonjs prosebook' },
    plugins: [new ProsebookPlugin({ root, ...plugin, config: { require: [], language: 'js', ...plugin.config } })],
  };
}

/** What a build wrote, joined, or the error it failed with. */
async function build(bundler: Bundler, mode: string, extra: Record<string, string> = {}, plugin: ProsebookWebpackOptions = {}) {
  const config = await generated({ ...files, ...extra }, { require: [], language: 'js', ...plugin.config });
  const compiler = bundler(options(config.root, mode, plugin));
  const stats = await new Promise<{ error?: string; stats?: Stats }>((done) =>
    compiler.run((error, stats) => compiler.close(() => done({ error: error?.message, stats }))),
  );
  const error =
    stats.error ??
    stats.stats
      ?.toJson({ all: false, errors: true })
      .errors?.map((e) => e.message)
      .join('\n');
  if (error !== undefined && error !== '') return { config, error };
  const dist = join(config.root, 'dist');
  return {
    config,
    js: readdirSync(dist)
      .map((f) => readFileSync(join(dist, f), 'utf8'))
      .join('\n'),
  };
}

describe.each(BUNDLERS)('%s', (_name, bundler) => {
  test('a production build ships only the messages the code names', async () => {
    const { js, error } = await build(bundler, 'production');
    expect(error).toBeUndefined();
    expect(js).toContain('Used message');
    expect(js).toContain('Benutzte Nachricht');
    expect(js).not.toContain('Unused message');
    expect(js).not.toContain('Unbenutzte Nachricht');
  });

  test('a production build leaves the pseudo-locale out, which the generated files keep', async () => {
    const { config, js } = await build(bundler, 'production', {}, { config: { pseudo: 'en-XA' } });
    expect(readFileSync(join(config.root, 'src/copy/index.js'), 'utf8')).toContain('locales: ["en", "de", "en-XA"]');
    expect(js).toContain('Benutzte Nachricht');
    expect(js).not.toContain('en-XA');
  });

  test('a strict build fails on a read whose key it cannot see', async () => {
    const unseen = { 'src/menu.js': "import { createCopy } from 'prosebook';\nexport const label = (key) => createCopy({}).t(key);\n" };
    expect((await build(bundler, 'production', unseen)).error).toMatch(/1 read\(s\) whose key the build can't see[^]*src\/menu\.js:2:/);
    expect((await build(bundler, 'production', unseen, { prune: 'loose' })).js).toContain('Used message');
  });

  test('a development build ships every message, and each locale updates the copies holding it', async () => {
    const { js, error } = await build(bundler, 'development', {}, { config: { pseudo: 'en-XA' } });
    expect(error).toBeUndefined();
    expect(js).toContain('Unused message');
    expect(js).toContain('globalThis.__PROSEBOOK_HOT__ ??= new Set()');
    expect(js).toContain('update("de", messages)');
    expect(js).toContain('en-XA');
  });
});

test('a TypeScript catalog importing `./en.js` needs webpack told to resolve it', async () => {
  const config = fixture(files);
  const compiler = webpack({
    ...options(config.root, 'production', {}),
    plugins: [new ProsebookPlugin({ root: config.root, config: { require: [] } })],
  });
  const error = await new Promise<string | undefined>((done) => compiler.run((e) => compiler.close(() => done(e?.message))));
  expect(error).toContain("set `importExtension: ''`");
});

test('watching, an edit to the catalog is built again', async () => {
  const config = fixture(files);
  const compiler = webpack(options(config.root, 'development', {}));
  const out = join(config.root, 'dist', 'main.js');
  const builds: string[] = [];
  const watching = await new Promise<Watching>((started) => {
    const w = compiler.watch({ aggregateTimeout: 50 }, () => {
      builds.push(readFileSync(out, 'utf8'));
      if (builds.length === 1) {
        started(w);
        writeFileSync(join(config.root, 'copy/catalog/app.yaml'), 'app.used: Edited message\napp.unused: Unused message\n');
      }
    });
  });
  // Not the second build: on Windows webpack builds again first for the folder `generate` wrote as the watch began.
  for (let i = 0; i < 100 && builds.at(-1)?.includes('Edited message') !== true; i++) await Bun.sleep(50);
  await new Promise<void>((done) => watching.close(done));
  expect(builds[0]).toContain('Used message');
  expect(builds.at(-1)).toContain('Edited message');
  // Longer than the 5 seconds it waits for the edit's build, which Bun's default timeout would cut short under load.
}, 20_000);
