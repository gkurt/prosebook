import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { build, createServer } from 'vite';

import type { EntryView } from 'prosebook/tools';

import { prosebook } from '#src/vite.ts';
import { fixture } from './fixture.ts';

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

test('in dev, the page gets the hot hooks and the inspector, the generated modules accept their updates, and entries edit from the page only', async () => {
  const config = fixture({ 'copy/catalog/app.yaml': 'app.used: Used message\n', 'index.html': '<html><head></head><body></body></html>' });
  const server = await createServer({
    root: config.root,
    logLevel: 'silent',
    configFile: false,
    server: { port: 0 },
    plugins: [prosebook({ config: { require: [] } })],
  });
  try {
    await server.listen();
    const html = await server.transformIndexHtml('/index.html', '<html><head></head><body></body></html>');
    expect(html).toContain('<script type="module" src="/@id/__x00__prosebook/dev"></script>');
    const origin = server.resolvedUrls!.local[0]!;
    const inspector = await fetch(`${origin}@id/__x00__prosebook/dev`);
    expect(inspector.status).toBe(200);
    const entry = await inspector.text();
    expect(entry).toContain('globalThis.__PROSEBOOK_HOT__ ??= new Set()');
    expect(entry).toContain('install({"base":"/"})');
    expect(await (await fetch(`${origin}src/copy/en.ts`)).text()).toContain('update("en", next.default)');
    expect(await (await fetch(`${origin}src/copy/index.ts`)).text()).toContain('next.catalog.locales.join() !== catalog.locales.join()');
    const client = await fetch(new URL(/from "([^"]+)"/.exec(entry)![1]!, origin));
    expect(await client.text()).toContain('export function keyAt');
    const missing = await fetch(`${origin}__prosebook/open?key=app.gone&locale=en`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('no entry for "app.gone"');

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
    expect(readFileSync(join(config.root, 'copy/catalog/app.yaml'), 'utf8')).toBe('app.used: Used message\n');
    const edit = { key: 'app.used', edit: { yaml: { catalog: 'app.used: Still used' } }, write: true };
    expect((await post(edit, { Origin: 'https://elsewhere.example' })).status).toBe(403);
    expect((await post({ ...edit, edit: { yaml: { catalog: 'app.used: Broken {' } } })).status).toBe(422);
    expect((await post(edit)).status).toBe(200);
    expect(readFileSync(join(config.root, 'copy/catalog/app.yaml'), 'utf8')).toBe('app.used: Still used\n');
  } finally {
    await server.close();
  }
});
