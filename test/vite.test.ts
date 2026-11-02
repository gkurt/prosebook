import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build, createServer } from 'vite';

import type { EntryView } from 'prosebook/tools';

import { SCHEMA_LINE } from '#src/tools/catalog.ts';
import { prosebook } from '#src/vite.ts';
import { fixture, route, type RouteApp } from './fixture.ts';

test('a build ships only the messages the code names', async () => {
  const config = fixture({
    'copy/catalog/app.yaml': [
      'app.used: Used message',
      'app.unused: Unused message',
      'app.status.ok: Status ok',
      'app.status.down: Status down',
    ].join('\n'),
    'copy/locales/de/app.yaml': 'app.used: Benutzte Nachricht\napp.unused: Unbenutzte Nachricht\n',
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'src/main.ts': [
      "import { createCopy } from 'prosebook';",
      "import { catalog } from './copy/index.ts';",
      'const copy = createCopy(catalog);',
      "const state = location.hash ? 'ok' : 'down';",
      "document.body.textContent = copy.t('app.used') + copy.t(`app.status.${state}`);",
    ].join('\n'),
  });
  const outDir = join(config.root, 'dist');
  await build({
    root: config.root,
    logLevel: 'silent',
    configFile: false,
    plugins: [prosebook({ config: { require: [] } })],
    resolve: { alias: [{ find: /^prosebook$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') }] },
    build: { outDir, minify: false },
  });
  const js = readdirSync(join(outDir, 'assets'))
    .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
    .join('\n');
  expect(js).toContain('Used message');
  expect(js).toContain('Benutzte Nachricht');
  expect(js).toContain('Status ok');
  expect(js).toContain('Status down');
  expect(js).not.toContain('Unused message');
  expect(js).not.toContain('Unbenutzte Nachricht');
});

test('a split build loads each area with the code that reads it, and each lazy locale by area', async () => {
  const config = fixture({
    'copy/catalog/app.yaml': 'app.title: Shop front\napp.unused: Unused message\n',
    'copy/catalog/cart.yaml': 'cart.title: Cart page\n',
    'copy/catalog/promo.yaml': 'promo.banner: Promo banner\n',
    'copy/locales/de/app.yaml': 'app.title: Ladenfront\n',
    'copy/locales/de/cart.yaml': 'cart.title: Warenkorbseite\n',
    'src/cart.ts': "export const title = (copy: { t(key: string): string }) => copy.t('cart.title');",
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
      'export async function later(start: string, next: string) {',
      '  const copy = createCopy(catalog, { locale: start });',
      "  const { title } = await import('./cart.ts');",
      '  await copy.setLocale(next);',
      '  return title(copy);',
      '}',
    ].join('\n'),
  });
  const outDir = join(config.root, 'dist');
  await build({
    root: config.root,
    logLevel: 'silent',
    configFile: false,
    plugins: [prosebook({ config: { require: [] }, split: true, keep: ['promo.*'] })],
    resolve: { alias: [{ find: /^prosebook$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') }] },
    build: { outDir, minify: false, lib: { entry: join(config.root, 'src', 'main.ts'), formats: ['es'], fileName: 'main' } },
  });
  const files = new Map(readdirSync(outDir).map((f) => [f, readFileSync(join(outDir, f), 'utf8')]));
  const holding = (text: string) => [...files].filter(([, js]) => js.includes(text)).map(([f]) => f);
  // The shell and the areas `keep` names ship in the entry; the cart ships beside the code reading it.
  expect(holding('Shop front')).toEqual(['main.js']);
  expect(holding('Promo banner')).toEqual(['main.js']);
  expect(holding('Cart page')).toHaveLength(1);
  expect(holding('Cart page')).not.toContain('main.js');
  expect(holding('Unused message')).toEqual([]);
  // A lazy locale loads area by area: German for the cart is a file of its own.
  const [cartDe] = holding('Warenkorbseite');
  expect(holding('Warenkorbseite')).toHaveLength(1);
  expect(files.get(cartDe!)).not.toContain('Ladenfront');

  const main = (await import(join(outDir, 'main.js'))) as {
    first: (locale: string) => Promise<string[]>;
    later: (start: string, next: string) => Promise<string>;
  };
  // In German from the first render of the code that reads the cart; before it loads, a read is reported.
  expect(await main.first('de')).toEqual([
    'Ladenfront',
    'cart.title',
    'Warenkorbseite',
    'Promo banner',
    "the cart area has not loaded: name one of its keys in the module that reads it, or keep it: `keep: ['cart.*']`",
  ]);
  expect(await main.later('en', 'de')).toBe('Warenkorbseite');
});

test("a split build loads a lazy locale's areas in one file per chunk", async () => {
  const config = fixture(route);
  const outDir = join(config.root, 'dist');
  await build({
    root: config.root,
    logLevel: 'silent',
    configFile: false,
    plugins: [prosebook({ config: { require: [] }, split: true })],
    resolve: { alias: [{ find: /^prosebook$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') }] },
    build: { outDir, minify: false, lib: { entry: join(config.root, 'src', 'main.ts'), formats: ['es'], fileName: 'main' } },
  });
  const files = new Map(readdirSync(outDir).map((f) => [f, readFileSync(join(outDir, f), 'utf8')]));
  const holding = (text: string) => [...files].filter(([, js]) => js.includes(text)).map(([f]) => f);
  // The route's three areas, read in two of its modules, are one file in German; the shell's two another.
  expect(holding('Warenkorbseite')).toHaveLength(1);
  expect(holding('Jetzt zahlen')).toEqual(holding('Warenkorbseite'));
  expect(holding('Lieferung')).toEqual(holding('Warenkorbseite'));
  expect(holding('Ladenfront')).toHaveLength(1);
  expect(holding('Startseite')).toEqual(holding('Ladenfront'));
  expect(holding('Kontoseite')).toHaveLength(1);
  expect(holding('Kontoseite')).not.toEqual(holding('Warenkorbseite'));

  const main = (await import(join(outDir, 'main.js'))) as RouteApp;
  expect(await main.cart('en', 'de')).toEqual(['Ladenfront', 'Startseite', 'Warenkorbseite', 'Jetzt zahlen', 'Lieferung', 'Ladenfront']);
  expect(await main.account('de')).toBe('Kontoseite');
});

test('the server build after a split client lists its area files, which a copy hands on as it reads', async () => {
  const config = fixture({
    ...route,
    'src/server.ts': [
      "import { createCopy } from 'prosebook';",
      "import { catalog } from './copy/index.ts';",
      'export async function render(locale: string, keys: string[]) {',
      '  const files: string[] = [];',
      '  const copy = createCopy(catalog, { locale, preload: (href) => files.push(href) });',
      '  await copy.ready;',
      '  for (const key of keys) copy.t(key as never);',
      '  return files;',
      '}',
    ].join('\n'),
  });
  const shared = {
    root: config.root,
    logLevel: 'silent' as const,
    configFile: false as const,
    // The server reads keys it is handed, which a pruned build would refuse.
    plugins: [prosebook({ config: { require: [] }, split: true, prune: false })],
    resolve: { alias: [{ find: /^prosebook$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') }] },
  };
  const client = join(config.root, 'dist', 'client');
  await build({
    ...shared,
    build: { outDir: client, minify: false, lib: { entry: join(config.root, 'src', 'main.ts'), formats: ['es'], fileName: 'main' } },
  });
  const server = join(config.root, 'dist', 'server');
  await build({ ...shared, build: { outDir: server, minify: false, ssr: join(config.root, 'src', 'server.ts') } });

  const { render } = (await import(join(server, 'server.js'))) as { render: (locale: string, keys: string[]) => Promise<string[]> };
  // The route's areas share a file, which the copy hands on once; the shell's is another.
  const files = await render('de', ['cart.title', 'checkout.pay', 'app.title', 'shipping.title']);
  expect(files).toHaveLength(2);
  const text = (href: string) => readFileSync(join(client, href), 'utf8');
  expect(['Warenkorbseite', 'Jetzt zahlen', 'Lieferung'].every((s) => text(files[0]!).includes(s))).toBe(true);
  expect(text(files[1]!)).toContain('Ladenfront');
  expect(await render('en', ['cart.title', 'app.title'])).toEqual([]);
});

test('in dev, a split catalog serves each area its generated locales whole, imported by the modules that name its keys', async () => {
  const config = fixture({
    'copy/catalog/app.yaml': 'app.title: Shop\n',
    'copy/catalog/cart.yaml': 'cart.title: Cart\n',
    'copy/locales/de/cart.yaml': 'cart.title: Warenkorb\n',
  });
  const plugin = prosebook({ config: { require: [] }, split: true });
  type Hook = (...args: unknown[]) => unknown;
  await (plugin.configResolved as Hook)({ command: 'serve', base: '/', root: config.root });
  (plugin.buildStart as Hook).call({});
  const transform = (code: string, id: string, ssr = false) =>
    ((plugin.transform as { handler: Hook }).handler(code, join(config.root, id).replaceAll('\\', '/'), { ssr }) as { code: string } | null)
      ?.code;
  const load = (id: string, ssr = false) => (plugin.load as Hook)(id, { ssr }) as string | null;

  const out = join(config.root, 'src', 'copy').replaceAll('\\', '/');
  expect(load(join(out, 'index.ts'))).toContain('"split":{"id":"src/copy","areas":["app","cart"]}');
  expect(load(join(out, 'index.ts'), true)).toBeNull();
  const area = load('\0prosebook/area/cart')!;
  expect(area).toContain(`import m0 from "${out}/en.ts";`);
  expect(area).toContain(`await addArea("src/copy", "cart", { "en": m0 }, { "de": () => import("${out}/de.ts") });`);

  const code = "const a = t('cart.title');\nconst b = t(`app.${id}`);";
  expect(transform(code, 'src/page.ts')).toBe(`${code}\nimport "virtual:prosebook/area/app";import "virtual:prosebook/area/cart";\n`);
  expect(transform(code, 'src/page.ts', true)).toBeUndefined();
  expect(transform("<script setup>\nt('cart.title')\n</script>\n<p />", 'src/Page.vue')).toBe(
    `<script setup>\nt('cart.title')\n;import "virtual:prosebook/area/cart";</script>\n<p />`,
  );
});

const ALIASES = [
  { find: /^prosebook$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') },
  { find: /^prosebook\/react$/, replacement: join(import.meta.dir, '..', 'src', 'react', 'index.tsx') },
];

test('a strict build fails on a read whose key it cannot see, unless the line is marked', async () => {
  const files = (marked: boolean) => ({
    'copy/catalog/app.yaml': 'app.a: A\napp.b: B\n',
    'index.html': '<script type="module" src="/src/main.tsx"></script>',
    'src/main.tsx': [
      "import { createCopy } from 'prosebook';",
      "import { Text } from 'prosebook/react';",
      "import { catalog } from './copy/index.ts';",
      'const copy = createCopy(catalog);',
      "const keys = ['app.a', 'app.b'] as const;",
      'const key: (typeof keys)[number] = keys[location.hash.length % 2]!;',
      ...(marked ? ['// prosebook-ignore: every key is in the array above'] : []),
      'document.title = copy.t(key);',
      'export const el = <Text id={key} />;',
    ].join('\n'),
  });
  /** The build's error, or nothing when it succeeds. */
  const run = async (marked: boolean, prune?: 'loose') => {
    const config = fixture(files(marked));
    try {
      await build({
        root: config.root,
        logLevel: 'silent',
        configFile: false,
        plugins: [prosebook({ config: { require: [] }, prune })],
        resolve: { alias: ALIASES },
        build: { outDir: join(config.root, 'dist'), minify: false },
      });
      return '';
    } catch (e) {
      return String(e);
    }
  };
  // Lines and JSX as written: the reads are found before TypeScript and JSX are compiled away.
  expect(await run(false)).toMatch(
    /2 read\(s\) whose key the build can't see[^]*src\/main.tsx:7:18 {2}copy\.t\(key\)\n {2}src\/main.tsx:8:19 {2}<Text id=\{key\} \/>\n/,
  );
  expect(await run(true)).toMatch(/1 read\(s\)[^]*:\n {2}src\/main.tsx:9:19 {2}<Text id=\{key\} \/>\n/);
  expect(await run(false, 'loose')).toBe('');
});

test('with root, an app beside the catalog reads its config and generates the same files', async () => {
  const shared = fixture({
    'prosebook.config.json': JSON.stringify({ require: [] }),
    'copy/catalog/app.yaml': 'app.a: A\n',
    'app/index.html': '<script type="module" src="/main.ts"></script>',
    'app/main.ts':
      "import { createCopy } from 'prosebook';\nimport { catalog } from '../src/copy/index.ts';\ndocument.title = createCopy(catalog).t('app.a');",
  });
  await build({
    root: join(shared.root, 'app'),
    logLevel: 'silent',
    configFile: false,
    plugins: [prosebook({ root: '..' })],
    resolve: { alias: ALIASES },
    build: { outDir: join(shared.root, 'dist'), minify: false },
  });
  expect(readFileSync(join(shared.root, 'src', 'copy', 'index.ts'), 'utf8')).toStartWith('// Generated by prosebook from copy/catalog.');
});

test('in dev, the index brings the hot hooks and the inspector to the page, the generated modules accept their updates, and entries edit from the page only', async () => {
  const config = fixture({
    'copy/catalog/app.yaml': `${SCHEMA_LINE}\napp.used: Used message\n`,
    'index.html': '<html><head></head><body></body></html>',
  });
  const server = await createServer({
    root: config.root,
    logLevel: 'silent',
    configFile: false,
    server: { port: 0 },
    plugins: [prosebook({ config: { require: [] } })],
  });
  try {
    await server.listen();
    // In the browser only: a server render's copies are made per request, and it has no page.
    expect((await server.transformRequest('/src/copy/index.ts'))?.code).toContain('import "/@id/__x00__prosebook/dev"');
    expect((await server.transformRequest('/src/copy/index.ts', { ssr: true }))?.code).not.toContain('prosebook/dev');
    const origin = server.resolvedUrls!.local[0]!;
    const inspector = await fetch(`${origin}@id/__x00__prosebook/dev`);
    expect(inspector.status).toBe(200);
    const entry = await inspector.text();
    expect(entry).toContain('globalThis.__PROSEBOOK_HOT__ ??= new Set()');
    expect(entry).toContain('installInspector({"base":"/"})');
    expect(await (await fetch(`${origin}src/copy/en.ts`)).text()).toContain('update("en", next.default)');
    expect(await (await fetch(`${origin}src/copy/index.ts`)).text()).toContain('next.catalog.locales.join() !== catalog.locales.join()');
    const client = await fetch(new URL(/from "([^"]+)"/.exec(entry)![1]!, origin));
    expect(await client.text()).toContain('export function keyAt');
    const missing = await fetch(`${origin}__prosebook/open?key=app.gone&locale=en`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('no entry for "app.gone"');
    // Handed on to Vite's own launcher, which the browser follows to.
    const open = await fetch(`${origin}__prosebook/open?key=app.used&locale=en`, { redirect: 'manual' });
    expect(open.status).toBe(307);
    expect(decodeURIComponent(open.headers.get('location')!)).toMatch(/^\/__open-in-editor\?file=.*copy[\\/]catalog[\\/]app\.yaml:2:1$/);

    const read = (await (await fetch(`${origin}__prosebook/entry?key=app.used`)).json()) as EntryView;
    expect(read.yaml.catalog).toBe('app.used: Used message');
    const post = (body: object, headers: Record<string, string> = {}) =>
      fetch(`${origin}__prosebook/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    expect(read.findings).toEqual([]);
    // Checked unsaved, as the dialog does while typing: lint's findings come back, with each fix made.
    const typed = await post({ key: 'app.used', edit: { yaml: { catalog: 'app.used: Used  message' } } });
    const { view } = (await typed.json()) as { view: EntryView };
    expect(view.findings.map((f) => [f.rule, f.at, f.fixed])).toEqual([['whitespace', { start: 4, end: 6 }, 'Used message']]);
    expect(readFileSync(join(config.root, 'copy/catalog/app.yaml'), 'utf8')).toBe(`${SCHEMA_LINE}\napp.used: Used message\n`);
    const edit = { key: 'app.used', edit: { yaml: { catalog: 'app.used: Still used' } }, write: true };
    expect((await post(edit, { Origin: 'https://elsewhere.example' })).status).toBe(403);
    expect((await post({ ...edit, edit: { yaml: { catalog: 'app.used: Broken {' } } })).status).toBe(422);
    expect((await post(edit)).status).toBe(200);
    expect(readFileSync(join(config.root, 'copy/catalog/app.yaml'), 'utf8')).toBe(`${SCHEMA_LINE}\napp.used: Still used\n`);
  } finally {
    await server.close();
  }
});
