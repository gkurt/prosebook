import { expect, spyOn, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { OnLoadCallback, PluginBuilder } from 'bun';

import type { EntryView } from 'prosebook/tools';

import { inspector, prosebook } from '#src/bun.ts';
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

/** The plugin's `onLoad` as Bun's dev server sets it up, which names no entry points, under `NODE_ENV`. */
async function devServer(env: string) {
  const config = fixture(files);
  const loads: [RegExp, OnLoadCallback][] = [];
  const builder = { config: { target: 'browser' }, onLoad: (o: { filter: RegExp }, cb: OnLoadCallback) => loads.push([o.filter, cb]) };
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    await prosebook({ root: config.root, config: { require: [] } }).setup(builder as unknown as PluginBuilder);
  } finally {
    process.env.NODE_ENV = was;
  }
  const [filter, onLoad] = loads[0]!;
  const load = async (file: string) => {
    const path = join(config.root, 'src', 'copy', file);
    expect(filter.test(path)).toBe(true);
    return (await onLoad({ path, namespace: 'file', loader: 'ts', defer: () => Promise.resolve() })) as { contents: string } | undefined;
  };
  return { config, filter, load };
}

test("under Bun's dev server, the index sets up the hot hooks and the inspector, and each locale accepts its own update", async () => {
  const { config, filter, load } = await devServer('development');
  const index = (await load('index.ts'))!.contents;
  expect(index).toStartWith('globalThis.__PROSEBOOK_HOT__ ??= new Set();');
  expect(index).toContain('installInspector({"base":"/"})');
  expect(readFileSync(/from "([^"]+)"/.exec(index)![1]!, 'utf8')).toContain('export function keyAt');
  expect((await load('de.ts'))?.contents).toContain('update("de", next.default)');
  expect(filter.test(join(config.root, 'src', 'main.ts'))).toBe(false);
  // Served in production, the page has no inspector.
  expect((await (await devServer('production')).load('index.ts'))!.contents).not.toContain('installInspector');
});

test("the inspector's routes read and edit entries from the page only, and open them with Bun.openInEditor", async () => {
  const config = fixture(files);
  const routes = inspector({ root: config.root, config: { require: [] } });
  const opened = spyOn(Bun, 'openInEditor').mockImplementation(() => {});
  try {
    const open = await routes['/__prosebook/open']!(new Request('http://localhost:3000/__prosebook/open?key=app.used&locale=de'));
    expect(open.status).toBe(204);
    expect(opened).toHaveBeenCalledWith(join(config.root, 'copy/locales/de.yaml'), { line: 1, column: 1 });
  } finally {
    opened.mockRestore();
  }
  const entry = routes['/__prosebook/entry']!;
  const read = (await (await entry(new Request('http://localhost:3000/__prosebook/entry?key=app.used'))).json()) as EntryView;
  expect(read.yaml.catalog).toBe('app.used: Used message');
  const post = (origin: string) =>
    entry(
      new Request('http://localhost:3000/__prosebook/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ key: 'app.used', edit: { yaml: { catalog: 'app.used: Still used' } }, write: true }),
      }),
    );
  expect((await post('https://elsewhere.example')).status).toBe(403);
  expect((await post('http://localhost:3000')).status).toBe(200);
  expect(readFileSync(join(config.root, 'copy/catalog/app.yaml'), 'utf8')).toBe('app.used: Still used\napp.unused: Unused message\n');
});
