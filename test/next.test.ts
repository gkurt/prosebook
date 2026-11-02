import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CompiledMessages, DevHooks, HotHook } from 'prosebook';
import type { EntryView } from 'prosebook/tools';

import loader, { type LoaderOptions } from '#src/next-loader.ts';
import { withProsebook, type ProsebookNextOptions } from '#src/next.ts';
import { SCHEMA_LINE } from '#src/tools/catalog.ts';
import { fixture } from './fixture.ts';

type Rule = { condition: unknown; loaders: { loader: string; options: LoaderOptions }[] };
type Config = { reactStrictMode?: boolean; turbopack?: { rules?: Record<string, Rule> }; rewrites?: () => Promise<unknown> };

const files = {
  'copy/catalog/app.yaml': `${SCHEMA_LINE}\napp.used: Used message\napp.unused: Unused message\n`,
  'copy/locales/de.yaml': 'app.used: Benutzte Nachricht\napp.unused: Unbenutzte Nachricht\n',
  'src/page.tsx':
    "import { createCopy } from 'prosebook';\nimport { catalog } from './copy';\nexport const title = createCopy(catalog).t('app.used');\n",
};

/** The config Next gets in a phase, for a project on disk. */
async function load(phase: string, extra: Record<string, string> = {}, options: ProsebookNextOptions = {}) {
  const config = fixture({ ...files, ...extra });
  const next = withProsebook<Config>(
    { reactStrictMode: true },
    { config: { require: [], importExtension: '' }, root: config.root, ...options },
  );
  return { config, next: await next(phase, { defaultConfig: {} }) };
}

const run = (rule: Rule, source = '') => loader.call({ getOptions: () => rule.loaders[0]!.options }, source);

test('a build hands Turbopack each locale pruned to the messages the code names, matched by its path from any root', async () => {
  const { config, next } = await load('phase-production-build');
  expect(next.reactStrictMode).toBe(true);
  expect(readFileSync(join(config.root, 'src/copy/index.ts'), 'utf8')).toContain("import m_en from './en';");
  const rules = next.turbopack!.rules!;
  expect(Object.keys(rules)).toEqual(['en.ts', 'de.ts']);
  const { path } = rules['de.ts']!.condition as { path: RegExp };
  expect(path.test('apps/web/src/copy/de.ts')).toBe(true);
  expect(path.test('src/copy/de.ts')).toBe(true);
  expect(path.test('src/other/de.ts')).toBe(false);
  const de = run(rules['de.ts']!);
  expect(de).toContain('Benutzte Nachricht');
  expect(de).not.toContain('Unbenutzte Nachricht');
});

test('a strict build fails on a read whose key it cannot see', async () => {
  const unseen = {
    'src/menu.ts':
      "import { createCopy } from 'prosebook';\nexport const label = (key: string) => createCopy({} as never).t(key as never);\n",
  };
  const error = await load('phase-production-build', unseen).catch((e: unknown) => String(e));
  expect(error).toMatch(/1 read\(s\) whose key the build can't see[^]*src\/menu\.ts:2:/);
  expect((await load('phase-production-build', unseen, { prune: 'loose' })).next.turbopack?.rules).toHaveProperty(['en.ts']);
});

test('in dev, the index sets up the hot hooks in the browser, and each locale run again updates the copies holding it', async () => {
  const { config, next } = await load('phase-development-server');
  const rules = next.turbopack!.rules!;
  expect(rules['index.ts']!.condition).toEqual({ all: ['browser', { path: expect.any(RegExp) }] });
  const index = run(rules['index.ts']!, '// index\n');
  expect(index).toStartWith('globalThis.__PROSEBOOK_HOT__ ??= new Set();\n');
  expect(index).toEndWith('installInspector({"base":"/"});\n// index\n');
  // Imported from beside the index, as Turbopack resolves the app's own imports.
  const inspector = /from "(\.[^"]+)"/.exec(index)![1]!;
  expect(readFileSync(join(config.root, 'src/copy', inspector), 'utf8')).toContain('export function keyAt');

  const path = join(config.root, 'src/copy/de.ts');
  writeFileSync(path, run(rules['de.ts']!, readFileSync(path, 'utf8')));
  const updates: [string, CompiledMessages][] = [];
  const hooks = globalThis as DevHooks;
  hooks.__PROSEBOOK_HOT__ = new Set<HotHook>([(locale, messages) => updates.push([locale, messages])]);
  try {
    const mod = (await import(pathToFileURL(path).href)) as { default: CompiledMessages };
    expect(mod.default['app.used']).toBe('Benutzte Nachricht');
    expect(updates).toEqual([['de', mod.default]]);
  } finally {
    delete hooks.__PROSEBOOK_HOT__;
  }
});

test("in dev, a rewrite sends the inspector's requests to a server that edits from the page only and opens through Next's launcher", async () => {
  const { config, next } = await load('phase-development-server');
  const { beforeFiles } = (await next.rewrites!()) as { beforeFiles: { source: string; destination: string }[] };
  expect(beforeFiles[0]!.source).toBe('/__prosebook/:path*');
  const target = beforeFiles[0]!.destination.replace(':path*', '');
  // As Next's rewrite sends it: the page's host forwarded.
  const page = { 'X-Forwarded-Host': 'localhost:3000' };

  const open = await fetch(`${target}open?key=app.used&locale=de`, { headers: page, redirect: 'manual' });
  expect(open.status).toBe(307);
  const launch = new URL(open.headers.get('location')!, 'http://localhost:3000');
  expect(launch.pathname).toBe('/__nextjs_launch-editor');
  expect(launch.searchParams.get('file')).toBe(join(config.root, 'copy/locales/de.yaml'));
  expect(launch.searchParams.get('line1')).toBe('1');

  const read = (await (await fetch(`${target}entry?key=app.used`, { headers: page })).json()) as EntryView;
  expect(read.yaml.catalog).toBe('app.used: Used message');
  const post = (origin: string) =>
    fetch(`${target}entry`, {
      method: 'POST',
      headers: { ...page, 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ key: 'app.used', edit: { yaml: { catalog: 'app.used: Still used' } }, write: true }),
    });
  expect((await post('https://elsewhere.example')).status).toBe(403);
  expect((await post('http://localhost:3000')).status).toBe(200);
  expect(readFileSync(join(config.root, 'copy/catalog/app.yaml'), 'utf8')).toStartWith(`${SCHEMA_LINE}\napp.used: Still used\n`);
  expect((await fetch(`${target}nothing`)).status).toBe(404);
});

test('the app keeps its own rewrites, after the inspector', async () => {
  const theirs = [{ source: '/old', destination: '/new' }];
  const config = fixture(files);
  const next = await withProsebook<Config>(
    { rewrites: () => Promise.resolve(theirs) },
    { config: { require: [], importExtension: '' }, root: config.root },
  )('phase-development-server', { defaultConfig: {} });
  expect(await next.rewrites!()).toEqual({ beforeFiles: [expect.objectContaining({ source: '/__prosebook/:path*' })], afterFiles: theirs });
  const off = await withProsebook<Config>({}, { config: { require: [], importExtension: '' }, root: config.root, inspect: false })(
    'phase-development-server',
    { defaultConfig: {} },
  );
  expect(off.rewrites).toBeUndefined();
});

test('other phases get the config as it was, and a generated `./en.js`, which Turbopack cannot resolve, is refused', async () => {
  expect((await load('phase-production-server')).next).toEqual({ reactStrictMode: true });
  const config = fixture(files);
  const next = withProsebook({}, { config: { require: [] }, root: config.root });
  const error = await next('phase-production-build', { defaultConfig: {} }).catch((e: unknown) => String(e));
  expect(error).toContain("set `importExtension: ''`");
});
