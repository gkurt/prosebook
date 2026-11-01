import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CompiledMessages, DevHooks, HotHook } from 'prosebook';

import loader, { type LoaderOptions } from '#src/next-loader.ts';
import { withProsebook, type ProsebookNextOptions } from '#src/next.ts';
import { fixture } from './fixture.ts';

type Rule = { condition: unknown; loaders: { loader: string; options: LoaderOptions }[] };
type Config = { reactStrictMode?: boolean; turbopack?: { rules?: Record<string, Rule> } };

const files = {
  'copy/catalog/app.yaml': 'app.used: Used message\napp.unused: Unused message\n',
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
  expect(run(rules['index.ts']!, '// index\n')).toBe('globalThis.__PROSEBOOK_HOT__ ??= new Set();\n// index\n');

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

test('other phases get the config as it was, and a generated `./en.js`, which Turbopack cannot resolve, is refused', async () => {
  expect((await load('phase-production-server')).next).toEqual({ reactStrictMode: true });
  const config = fixture(files);
  const next = withProsebook({}, { config: { require: [] }, root: config.root });
  const error = await next('phase-production-build', { defaultConfig: {} }).catch((e: unknown) => String(e));
  expect(error).toContain("set `importExtension: ''`");
});
