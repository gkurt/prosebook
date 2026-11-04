import { expect, spyOn, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { OnLoadCallback, PluginBuilder } from 'bun';

import type { EntryView } from 'prosebook/tools';

import { inspector, prosebook } from '#src/bun.ts';
import { fixture, route, type RouteApp } from './fixture.ts';

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

const shop = {
  'copy/catalog/app.yaml': 'app.title: Shop front\napp.unused: Unused message\n',
  'copy/catalog/cart.yaml': 'cart.title: Cart page\n',
  'copy/catalog/promo.yaml': 'promo.banner: Promo banner\n',
  'copy/locales/de/app.yaml': 'app.title: Ladenfront\n',
  'copy/locales/de/cart.yaml': 'cart.title: Warenkorbseite\n',
  'src/cart.ts': "export const title = (copy: { t(key: string): string }) => copy.t('cart.title');",
};

/** Every file a build wrote, by name. */
const written = (dir: string) => new Map(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

test('a split build loads each area with the code that reads it, and each lazy locale by area', async () => {
  const config = fixture({
    ...shop,
    'src/main.ts': [
      "import { createCopy } from 'prosebook';",
      "import { catalog } from './copy/index.ts';",
      'export async function first(locale: string) {',
      '  const errors: string[] = [];',
      '  const copy = createCopy(catalog, { locale, onError: (e) => errors.push(e.message) });',
      '  await copy.ready;',
      '  // prosebook-ignore: cart.ts names the key, as an ignored read relies on',
      "  const before = copy.t(['cart', 'title'].join('.') as never);",
      "  const { title } = await import('./cart.ts');",
      "  return [copy.t('app.title'), before, title(copy), copy.t('promo.banner'), ...errors];",
      '}',
    ].join('\n'),
  });
  const outdir = join(config.root, 'dist');
  const options = { root: config.root, config: { require: [] }, split: true, keep: ['promo.*'] };
  const run = (splitting: boolean) =>
    Bun.build({
      entrypoints: [join(config.root, 'src/main.ts')],
      outdir,
      splitting,
      format: 'esm',
      conditions: ['prosebook@dev'],
      plugins: [prosebook(options)],
    });
  // Bun throws a plugin's setup error at the call, not through the promise.
  expect(await (async () => run(false))().catch(String)).toContain('`split` needs `splitting: true` in Bun.build');
  await run(true);
  const files = written(outdir);
  const holding = (text: string) => [...files].filter(([, js]) => js.includes(text)).map(([f]) => f);
  expect(holding('Shop front')).toEqual(['main.js']);
  expect(holding('Promo banner')).toEqual(['main.js']);
  expect(holding('Cart page')).toHaveLength(1);
  expect(holding('Cart page')).not.toContain('main.js');
  expect(holding('Unused message')).toEqual([]);
  const [cartDe] = holding('Warenkorbseite');
  expect(holding('Warenkorbseite')).toHaveLength(1);
  expect(files.get(cartDe!)).not.toContain('Ladenfront');

  const main = (await import(join(outdir, 'main.js'))) as { first: (locale: string) => Promise<string[]> };
  expect(await main.first('de')).toEqual([
    'Ladenfront',
    'cart.title',
    'Warenkorbseite',
    'Promo banner',
    "the cart area has not loaded: name one of its keys in the module that reads it, or keep it: `keep: ['cart.*']`",
  ]);
});

test("a split build loads a lazy locale's areas in one file per chunk", async () => {
  const config = fixture(route);
  const outdir = join(config.root, 'dist');
  await Bun.build({
    entrypoints: [join(config.root, 'src/main.ts')],
    outdir,
    splitting: true,
    format: 'esm',
    conditions: ['prosebook@dev'],
    plugins: [prosebook({ root: config.root, config: { require: [] }, split: true })],
  });
  const files = written(outdir);
  const holding = (text: string) => [...files].filter(([, js]) => js.includes(text)).map(([f]) => f);
  expect(holding('Warenkorbseite')).toHaveLength(1);
  expect(holding('Jetzt zahlen')).toEqual(holding('Warenkorbseite'));
  expect(holding('Lieferung')).toEqual(holding('Warenkorbseite'));
  expect(holding('Startseite')).toEqual(holding('Ladenfront'));
  expect(holding('Kontoseite')).not.toEqual(holding('Warenkorbseite'));

  const main = (await import(join(outdir, 'main.js'))) as RouteApp;
  expect(await main.cart('en', 'de')).toEqual(['Ladenfront', 'Startseite', 'Warenkorbseite', 'Jetzt zahlen', 'Lieferung', 'Ladenfront']);
  expect(await main.account('de')).toBe('Kontoseite');
});

test('a full-stack split build splits the page and leaves the server its whole locales', async () => {
  const config = fixture({
    ...shop,
    'src/index.html': '<!doctype html><html><body><script type="module" src="./page.ts"></script></body></html>',
    'src/page.ts': [
      "import { createCopy } from 'prosebook';",
      "import { catalog } from './copy/index.ts';",
      'const copy = createCopy(catalog);',
      "document.title = copy.t('app.title');",
      "document.onclick = () => void import('./cart.ts').then((m) => (document.title = m.title(copy)));",
    ].join('\n'),
    'src/server.ts': [
      "import { createCopy } from 'prosebook';",
      "import { catalog } from './copy/index.ts';",
      "import page from './index.html';",
      "export const answer = () => [page, createCopy(catalog).t('cart.title'), createCopy(catalog).t('promo.banner' as never)];",
    ].join('\n'),
  });
  const outdir = join(config.root, 'dist');
  await Bun.build({
    entrypoints: [join(config.root, 'src/server.ts')],
    outdir,
    target: 'bun',
    splitting: true,
    conditions: ['prosebook@dev'],
    plugins: [prosebook({ root: config.root, config: { require: [] }, split: true, keep: ['promo.*'] })],
  });
  const server = written(outdir).get('server.js')!;
  expect(server).not.toContain('addArea(');
  expect(server).toContain('Cart page');
  const page = [...written(outdir)].filter(([f]) => f !== 'server.js' && f.endsWith('.js'));
  const holding = (text: string) => page.filter(([, js]) => js.includes(text)).map(([f]) => f);
  expect(holding('addArea("src/copy", "cart"')).toHaveLength(1);
  expect(holding('Cart page')).toEqual(holding('addArea("src/copy", "cart"'));
  expect(holding('Shop front')).not.toEqual(holding('Cart page'));
});

/** A server rendering keys it is handed, which collects the files its copy hands `preload`. */
const rendering = [
  "import { createCopy } from 'prosebook';",
  "import { catalog } from './copy/index.ts';",
  'export async function render(locale: string, keys: string[]) {',
  '  const files: string[] = [];',
  '  const copy = createCopy(catalog, { locale, preload: (href) => files.push(href) });',
  '  await copy.ready;',
  '  for (const key of keys) copy.t(key as never);',
  '  return files;',
  '}',
].join('\n');

type Render = (locale: string, keys: string[]) => Promise<string[]>;

test('the server build after a split browser build lists its area files, which a copy hands on as it reads', async () => {
  const config = fixture({ ...route, 'src/server.ts': rendering });
  // The server reads keys it is handed, which a pruned build would refuse.
  const plugins = [prosebook({ root: config.root, config: { require: [] }, split: true, prune: false })];
  const client = join(config.root, 'dist', 'client');
  await Bun.build({
    entrypoints: [join(config.root, 'src/main.ts')],
    outdir: client,
    splitting: true,
    conditions: ['prosebook@dev'],
    plugins,
  });
  const server = join(config.root, 'dist', 'server');
  await Bun.build({
    entrypoints: [join(config.root, 'src/server.ts')],
    outdir: server,
    target: 'bun',
    splitting: true,
    conditions: ['prosebook@dev'],
    plugins,
  });

  const { render } = (await import(join(server, 'server.js'))) as { render: Render };
  // The route's areas share a file, which the copy hands on once; the shell's is another.
  const files = await render('de', ['cart.title', 'checkout.pay', 'app.title', 'shipping.title']);
  expect(files).toHaveLength(2);
  expect(files.every((href) => href.startsWith('/chunk-'))).toBe(true);
  const text = (href: string) => readFileSync(join(client, href), 'utf8');
  expect(['Warenkorbseite', 'Jetzt zahlen', 'Lieferung'].every((s) => text(files[0]!).includes(s))).toBe(true);
  expect(text(files[1]!)).toContain('Ladenfront');
  expect(await render('en', ['cart.title', 'app.title'])).toEqual([]);
});

test("a full-stack split build fills in the server's area files once the page's are written, minified", async () => {
  const config = fixture({
    ...route,
    'src/index.html': '<!doctype html><html><body><script type="module" src="./page.ts"></script></body></html>',
    'src/page.ts': "import { cart } from './main.ts';\ndocument.onclick = () => void cart('en', 'de');\n",
    'src/server.ts': `import page from './index.html';\nexport { page };\n${rendering}`,
  });
  const outdir = join(config.root, 'dist');
  await Bun.build({
    entrypoints: [join(config.root, 'src/server.ts')],
    outdir,
    target: 'bun',
    splitting: true,
    minify: true,
    conditions: ['prosebook@dev'],
    plugins: [prosebook({ root: config.root, config: { require: [] }, split: true, prune: false })],
  });
  expect([...written(outdir).values()].some((js) => js.includes('__PROSEBOOK_AREA_FILES__'))).toBe(false);

  const { render } = (await import(join(outdir, 'server.js'))) as { render: Render };
  const files = await render('de', ['cart.title', 'app.title']);
  expect(files).toHaveLength(2);
  const text = (href: string) => readFileSync(join(outdir, href.slice(1)), 'utf8');
  expect(text(files[0]!)).toContain('Warenkorbseite');
  expect(text(files[1]!)).toContain('Ladenfront');
});

test("under Bun's dev server, a split catalog serves each area its generated locales whole, imported by the files that name its keys", async () => {
  const config = fixture({ ...shop, 'src/page.ts': "document.title = t('cart.title');\n" });
  const loads: [{ filter: RegExp; namespace?: string }, OnLoadCallback][] = [];
  const builder = {
    config: { target: 'browser' },
    onLoad: (o: { filter: RegExp; namespace?: string }, cb: OnLoadCallback) => loads.push([o, cb]),
    onResolve: () => {},
  };
  await prosebook({ root: config.root, config: { require: [] }, split: true, inspect: false }).setup(builder as unknown as PluginBuilder);
  const load = async (path: string, namespace = 'file') => {
    const [, onLoad] = loads.find(([o]) => (o.namespace ?? 'file') === namespace && o.filter.test(path))!;
    return ((await onLoad({ path, namespace, loader: 'ts', defer: () => Promise.resolve() })) as { contents: string } | undefined)
      ?.contents;
  };
  const out = join(config.root, 'src', 'copy').replaceAll('\\', '/');
  const index = (await load(join(config.root, 'src', 'copy', 'index.ts')))!;
  expect(index).toStartWith('globalThis.__PROSEBOOK_HOT__ ??= new Set();');
  expect(index).toContain('"split":{"id":"src/copy","areas":["app","cart","promo"]}');
  expect(await load('cart', 'prosebook-area')).toContain(
    `await addArea("src/copy", "cart", { "en": m0 }, { "de": () => import("${out}/de.ts") });`,
  );
  expect(await load(join(config.root, 'src', 'page.ts'))).toBe(
    'document.title = t(\'cart.title\');\n\nimport "virtual:prosebook/area/cart";\n',
  );
  expect(await load(join(config.root, 'src', 'copy', 'de.ts'))).toContain('update("de", next.default)');
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
