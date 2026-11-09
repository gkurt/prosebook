import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createCopy, defineCatalog, relativeTime, type CompiledMessages, type CopyOptions } from 'prosebook';
import {
  compileLocale,
  generate,
  loadConfig,
  localeExpression,
  resolveConfig,
  type ProsebookConfig,
  type Entry,
  type ResolvedConfig,
} from 'prosebook/tools';

import { parseMessage } from '#src/tools/icu.ts';
import { parseMf2 } from '#src/tools/mf2.ts';

const TMP = join(import.meta.dir, '.tmp');
const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

/** Runs the `prosebook` command from source on the project at `root`. */
export function cli(root: string, ...args: string[]) {
  const proc = Bun.spawnSync(['bun', '--conditions=prosebook@dev', CLI, ...args, '--root', root]);
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}
let counter = 0;

/** A project on disk holding `files`, and its resolved config. */
export function fixture(files: Record<string, string>, config: ProsebookConfig = {}): ResolvedConfig {
  const root = join(TMP, `${process.pid}-${counter++}`);
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  mkdirSync(join(root, 'copy', 'catalog'), { recursive: true });
  return resolveConfig(root, config);
}

/**
 * `fixture`, generated as `prosebook generate` would before a build, which writes nothing: with `inline`, the config a
 * plugin is handed, else its config file's.
 */
export async function generated(files: Record<string, string>, inline?: ProsebookConfig): Promise<ResolvedConfig> {
  const resolved = fixture(files);
  generate(await loadConfig(resolved.root, inline));
  return resolved;
}

/** Compiles entries and evaluates them, as a bundler would the generated module. */
export function compiled(entries: Iterable<Entry>): CompiledMessages {
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- evaluating our own generated code is the point of the test
  return new Function(`return ${localeExpression(compileLocale(entries))};`)() as CompiledMessages;
}

/** A copy over messages written inline, per locale, `en` first, in MF1 or MF2. */
export function copyOf(locales: Record<string, Record<string, string>>, options: CopyOptions<string> = {}, version: 1 | 2 = 1) {
  const messages = Object.fromEntries(
    Object.entries(locales).map(([locale, msgs]) => [
      locale,
      compiled(Object.entries(msgs).map(([k, v]): Entry => [k, version === 2 ? parseMf2(v, locale) : parseMessage(v)])),
    ]),
  );
  const [source] = Object.keys(locales);
  return createCopy(
    defineCatalog({ source: source!, locales: Object.keys(locales), messages, loaders: {}, relative: relativeTime }),
    options,
  );
}

/**
 * A shell reading two areas and two lazy routes: the cart, reading three areas across two modules
 * and the shell's own, and the account, reading one.
 */
export const route: Record<string, string> = {
  'copy/catalog/app.yaml': 'app.title: Shop front\n',
  'copy/catalog/nav.yaml': 'nav.home: Home link\n',
  'copy/catalog/cart.yaml': 'cart.title: Cart page\n',
  'copy/catalog/checkout.yaml': 'checkout.pay: Pay now\n',
  'copy/catalog/shipping.yaml': 'shipping.title: Delivery\n',
  'copy/catalog/account.yaml': 'account.title: Account page\n',
  'copy/locales/de/app.yaml': 'app.title: Ladenfront\n',
  'copy/locales/de/nav.yaml': 'nav.home: Startseite\n',
  'copy/locales/de/cart.yaml': 'cart.title: Warenkorbseite\n',
  'copy/locales/de/checkout.yaml': 'checkout.pay: Jetzt zahlen\n',
  'copy/locales/de/shipping.yaml': 'shipping.title: Lieferung\n',
  'copy/locales/de/account.yaml': 'account.title: Kontoseite\n',
  'src/main.ts': [
    "import { createCopy } from 'prosebook';",
    "import { catalog } from './copy/index.ts';",
    'export async function cart(start: string, next: string) {',
    '  const copy = createCopy(catalog, { locale: start });',
    '  await copy.ready;',
    "  const { title } = await import('./cart.ts');",
    '  await copy.setLocale(next);',
    "  return [copy.t('app.title'), copy.t('nav.home'), ...title(copy)];",
    '}',
    'export async function account(locale: string) {',
    '  const copy = createCopy(catalog, { locale });',
    "  const { title } = await import('./account.ts');",
    '  return title(copy);',
    '}',
  ].join('\n'),
  'src/cart.ts': [
    "import { pay } from './pay.ts';",
    'export const title = (copy: { t(key: string): string }) =>',
    "  [copy.t('cart.title'), pay(copy), copy.t('shipping.title'), copy.t('app.title')];",
  ].join('\n'),
  'src/pay.ts': "export const pay = (copy: { t(key: string): string }) => copy.t('checkout.pay');\n",
  'src/account.ts': "export const title = (copy: { t(key: string): string }) => copy.t('account.title');\n",
};

/** What `route`'s entry exports, once built. */
export interface RouteApp {
  cart: (start: string, next: string) => Promise<string[]>;
  account: (locale: string) => Promise<string>;
}

/**
 * A copy whose clock reads `at` as now for another 50ms, then as a minute ago, over `a.opened`:
 * `Opened {at, relative}`. What a `<Text>` keeping itself fresh is tested with.
 */
export function turning() {
  const start = Date.now();
  const now = Date.UTC(2026, 10, 9, 12);
  const copy = copyOf({ en: { 'a.opened': 'Opened {at, relative}' } }, { now: () => now + Date.now() - start });
  return { copy, at: now - 59_950 };
}
