import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { build, dev } from 'astro';

import { prosebook } from '#src/astro.ts';
import { fixture } from './fixture.ts';

const ALIAS = [{ find: /^prosebook$/, replacement: join(import.meta.dir, '..', 'src', 'index.ts') }];

/** A site whose page reads the catalog on the server, and whose script reads it in the browser. */
const site = (page: string[]) => ({
  // Astro bundles a page's scripts only in a project with a package.json.
  'package.json': '{ "type": "module" }',
  'copy/catalog/app.yaml': [
    'app.title: Server title',
    'app.terms: Read the <link>terms</link>.',
    'app.status: Browser status',
    'app.unused: Unused message',
  ].join('\n'),
  'src/copy.ts':
    "import { createCopy } from 'prosebook';\nimport { catalog } from './copy/index.ts';\nexport const { t, rich } = createCopy(catalog);\n",
  'src/status.ts': "import { t } from './copy.ts';\ndocument.title = t('app.status');\n",
  'src/pages/index.astro': [
    '---',
    "import { rich, t } from '../copy.ts';",
    ...page,
    '---',
    "<html><head></head><body><h1>{t('app.title')}</h1>",
    '<p>{rich(\'app.terms\', { link: (chunks) => <a href="/terms">{chunks}</a> })}</p>',
    '<script src="../status.ts"></script></body></html>',
  ].join('\n'),
});

const config = (root: string, extra: object = {}) => ({
  root,
  logLevel: 'silent' as const,
  integrations: [prosebook({ config: { require: [] } })],
  vite: { resolve: { alias: ALIAS } },
  ...extra,
});

test('a build renders the messages the pages read, and ships the browser only those its scripts read', async () => {
  const { root } = fixture(site([]));
  await build(config(root, { outDir: join(root, 'dist') }));
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  expect(html).toContain('<h1>Server title</h1>');
  expect(html).toContain('<p>Read the <a href="/terms">terms</a>.</p>');
  // Astro inlines a small script into the page, and writes a larger one beside it.
  const assets = join(root, 'dist', '_astro');
  const js = [
    ...[...html.matchAll(/<script\b[^>]*>([^]*?)<\/script>/g)].map((m) => m[1]),
    ...(existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')) : []).map((f) => readFileSync(join(assets, f), 'utf8')),
  ].join('\n');
  expect(js).toContain('Browser status');
  expect(js).not.toContain('Server title');
  expect(js).not.toContain('Unused message');
});

test("a strict build fails on a read in a component's frontmatter or markup whose key it cannot see", async () => {
  const { root } = fixture(site(["const key = Astro.url.searchParams.get('k') ?? 'app.title';", 'const shown = t(key as never);']));
  const error = await build(config(root, { outDir: join(root, 'dist') })).then(
    () => '',
    (e: unknown) => String(e),
  );
  expect(error).toMatch(/1 read\(s\) whose key the build can't see[^]*src\/pages\/index\.astro:4:15 {2}t\(key as never\)/);
});

test('in dev, every page gets the inspector, what the server read reaches it, and an edit reloads the page', async () => {
  const { root } = fixture(site([]));
  const server = await dev(config(root, { server: { port: 0 } }));
  try {
    const origin = `http://localhost:${server.address.port}/`;
    const html = await (await fetch(origin)).text();
    // Dev marks each element with where it is written.
    expect(html).toMatch(/<h1[^>]*>Server title<\/h1>/);
    const page = await (await fetch(new URL(/src="([^"]*astro:scripts\/page\.js)"/.exec(html)![1]!, origin))).text();
    expect(page).toContain('prosebook/dev');
    const reads = (await (await fetch(`${origin}__prosebook/reads`)).json()) as [string, { key: string }[]][];
    expect(reads.map(([text, [read]]) => [text, read!.key])).toEqual([
      ['Server title', 'app.title'],
      ['Read the terms.', 'app.terms'],
    ]);
    writeFileSync(join(root, 'copy/catalog/app.yaml'), 'app.title: Edited title\napp.terms: Terms.\napp.status: Browser status\n');
    let edited = '';
    for (let i = 0; i < 50 && !edited.includes('>Edited title<'); i++) {
      await Bun.sleep(100);
      edited = await (await fetch(origin)).text();
    }
    expect(edited).toMatch(/<h1[^>]*>Edited title<\/h1>/);
  } finally {
    await server.stop();
  }
  // Once the server is gone, nothing in the process records reads any more.
  expect((globalThis as { __PROSEBOOK_READ__?: unknown }).__PROSEBOOK_READ__).toBeUndefined();
});

test('in dev, an edit to the config file restarts the server with it', async () => {
  const { root } = fixture({ ...site([]), 'prosebook.config.mjs': 'export default { require: [] };\n' });
  const index = join(root, 'src/copy/index.ts');
  const server = await dev({ ...config(root, { server: { port: 0 } }), integrations: [prosebook()] });
  try {
    expect(readFileSync(index, 'utf8')).not.toContain('price');
    const file = join(root, 'prosebook.config.mjs');
    writeFileSync(file, "export default { require: [], formats: { number: { price: { style: 'currency', currency: 'EUR' } } } };\n");
    // A file changed within the clock's resolution would read as the module already imported.
    utimesSync(file, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    for (let i = 0; i < 100 && !readFileSync(index, 'utf8').includes('price'); i++) await Bun.sleep(50);
    expect(readFileSync(index, 'utf8')).toContain('price');
  } finally {
    await server.stop();
  }
}, 20_000);
