import { beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createCopy } from 'prosebook';

import type * as Playground from '#src/playground.ts';

const ROOT = join(import.meta.dir, '..');

let playground: typeof Playground;

// Built as tsdown builds it for the browser, Node's built-ins replaced by `src/browser/`, then run:
// from source, the tools would read the real disk.
beforeAll(async () => {
  const outdir = join(import.meta.dir, '.tmp', `playground-${process.pid}`);
  const built = await Bun.build({
    entrypoints: [join(ROOT, 'src/playground.ts')],
    outdir,
    target: 'browser',
    packages: 'external',
    plugins: [
      {
        name: 'browser-shims',
        setup(build) {
          build.onResolve({ filter: /^node:(fs|path|crypto|module|url)$/ }, ({ path }) => ({
            path: join(ROOT, 'src', 'browser', `${path.slice('node:'.length)}.ts`),
          }));
        },
      },
    ],
  });
  if (!built.success) throw new AggregateError(built.logs, 'the playground did not build');
  playground = (await import(join(outdir, 'playground.js'))) as typeof Playground;
});

const files = {
  'copy/catalog/order.yaml': [
    'order.items:',
    '  kind: state',
    '  surface: status',
    '  context: On an order, counts what is in it.',
    '  fragment: true',
    '  args:',
    '    count: how many items the order holds',
    "  en: '{count, plural, one {# item} other {# items}}'",
    '',
    'order.track:',
    '  kind: action',
    '  surface: action',
    '  context: The button that opens the parcel tracking page.',
    '  en: Track parcel...',
    '',
  ].join('\n'),
  'copy/locales/de/order.yaml': "order.items: '{count, plural, one {# Artikel} other {# Artikel}}'\norder.track: Sendung verfolgen…\n",
};

const config = { pseudo: 'en-XA', lint: { extends: 'strict' as const }, native: [{ language: 'swift' as const, out: 'ios/Copy.swift' }] };

test('generates and lints files held in memory, and the catalog it compiles reads in every locale', async () => {
  const played = playground.play(files, config);
  expect(played.problems).toEqual([]);
  expect(played.findings.map((f) => `${f.key} ${f.rule}`)).toEqual(['order.track ellipsis']);
  expect(played.generated['src/copy/index.ts']).toContain('readonly count: number;');
  expect(played.generated['src/copy/en.ts']).toContain('"order.track": "Track parcel..."');
  expect(played.generated['ios/Copy.swift']).toContain('func orderItems(');
  expect(played.messages.map((m) => m.key)).toEqual(['order.items', 'order.track']);

  const copy = createCopy(played.catalog);
  expect(copy.t('order.items' as never, { count: 1 })).toBe('1 item');
  await copy.setLocale('de');
  expect(copy.t('order.items' as never, { count: 3 })).toBe('3 Artikel');
  await copy.setLocale('en-XA');
  expect(copy.t('order.track' as never)).not.toBe('Track parcel...');
});

test('a broken translation is left out and said; the rest still compiles', () => {
  const broken = { ...files, 'copy/locales/de/order.yaml': "order.items: '{anzahl, plural, other {# Artikel}}'\n" };
  const played = playground.play(broken, config);
  expect(played.problems.map((p) => `${p.severity} ${p.key}`)).toEqual(['error order.items']);
  expect(played.generated['src/copy/en.ts']).toContain('order.items');
});

test('a finding with a fix is made in the file, as lint --fix makes it', () => {
  const { findings } = playground.play(files, config);
  const fixed = playground.fix(files, findings, config);
  expect(fixed.problems).toEqual([]);
  expect(fixed.files['copy/catalog/order.yaml']).toContain('  en: Track parcel…\n');
  expect(fixed.files['copy/locales/de/order.yaml']).toBe(files['copy/locales/de/order.yaml']);
});
