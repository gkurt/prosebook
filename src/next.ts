/**
 * `prosebook/next`: the catalog as part of a Next.js app.
 *
 * Generates when `next dev` or `next build` loads the config, and in dev again whenever a catalog or
 * translation file changes, so Fast Refresh picks up the new modules and a broken entry shows in the
 * terminal. Server components read the new text on their next render; in the browser, each locale
 * module hands its new messages to the copies holding it, which re-render in the locale and state
 * they were in. `next build` ships only the messages the code names: each locale module is handed to a
 * Turbopack loader (`next-loader.ts`) that returns it pruned. Turbopack loads a module before it has
 * seen the code that reads it, so the keys come from the source under `scan.dirs` (`tools/bundle.ts`),
 * read here once, and each pruned module travels to the loader as its options.
 *
 * Turbopack only: Next 16 fails a Turbopack build whose config has a `webpack` key, so none is added.
 */
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LoaderOptions } from './next-loader.ts';
import { keeper, prunedModule, scanSources, unseenMessage, watchCatalog, type Prune } from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { generate, type Generated } from './tools/generate.ts';

export interface ProsebookNextOptions {
  /** The config, inline. Without it, `prosebook.config.*` at `root` is read. */
  config?: ProsebookConfig;
  /** The folder the config's paths resolve from, and where its file is found: the Next app's when unset. */
  root?: string;
  /**
   * Ship only the messages the code names. `strict`, the default, also fails the build on a read
   * whose key it can't see, such as `t(item.key)`. `loose` prunes without that check; `false` ships
   * every message.
   */
  prune?: Prune;
  /** Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
}

type Rules = { [glob: string]: unknown };
type ConfigFunction<C> = (phase: string, context: { defaultConfig: C }) => C | Promise<C>;

const DEV = 'phase-development-server';
const BUILD = 'phase-production-build';

// Beside this module: the source when run from source, the built file in dist.
const loaderPath = fileURLToPath(new URL(`./next-loader${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url));

// Next loads its config more than once in a process; one watcher per catalog is enough.
const watching = new Set<string>();

const describe = (e: unknown) => (e instanceof CatalogError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wraps the Next config: `export default withProsebook({ ... })`. Takes the config as an object or as
 * the function Next calls with the phase, and returns the function.
 */
export function withProsebook<C extends object>(
  next: C | ConfigFunction<C> = {} as C,
  options: ProsebookNextOptions = {},
): (phase: string, context: { defaultConfig: C }) => Promise<C> {
  return async (phase, context) => {
    const resolved = typeof next === 'function' ? await next(phase, context) : next;
    if (phase !== DEV && phase !== BUILD) return resolved;
    const config = await loadConfig(resolve(options.root ?? process.cwd()), options.config);
    if (config.language === 'ts' && config.importExtension === '.js')
      throw new Error("prosebook: Turbopack doesn't resolve `./en.js` to `en.ts`: set `importExtension: ''` in the prosebook config");
    const generated = generate(config);
    if (phase === DEV) {
      watch(config);
      return withRules(resolved, hotRules(config, generated));
    }
    const prune = options.prune ?? 'strict';
    if (prune === false) return resolved;
    return withRules(resolved, prunedRules(config, generated, prune, options.keep));
  };
}

function withRules<C extends object>(resolved: C, rules: Rules): C {
  const turbopack = (resolved as { turbopack?: { rules?: Rules } }).turbopack;
  return { ...resolved, turbopack: { ...turbopack, rules: { ...turbopack?.rules, ...rules } } };
}

function watch(config: ResolvedConfig): void {
  if (watching.has(config.catalog)) return;
  watching.add(config.catalog);
  watchCatalog(config, () => {
    try {
      generate(config);
      console.info(`prosebook: regenerated ${relative(config.root, config.out).replaceAll('\\', '/')}`);
    } catch (e) {
      console.error(describe(e));
    }
  });
}

/**
 * A rule per generated module: matched by its file name, then by its path, which Turbopack gives from
 * its own root, so only the end is known.
 */
function rule(config: ResolvedConfig, name: string, options: LoaderOptions, browser = false): [string, unknown] {
  const file = `${name}.${config.language === 'ts' ? 'ts' : 'js'}`;
  const path = { path: new RegExp(`(?:^|/)${escape(join(relative(config.root, config.out), file).replaceAll('\\', '/'))}$`) };
  return [file, { condition: browser ? { all: ['browser', path] } : path, loaders: [{ loader: loaderPath, options }] }];
}

/** In the browser: the index sets up the hot hooks before any copy exists, and each locale updates them. */
function hotRules(config: ResolvedConfig, generated: Generated): Rules {
  const locales = [...generated.entries.keys()].map((locale) => rule(config, locale, { locale }, true));
  return Object.fromEntries([rule(config, 'index', { index: true }, true), ...locales]);
}

function prunedRules(config: ResolvedConfig, generated: Generated, prune: 'strict' | 'loose', keep?: string[]): Rules {
  const { refs, unseen } = scanSources(config, prune === 'strict');
  if (unseen.length > 0) throw new Error(unseenMessage(unseen, config.root));
  const kept = keeper(refs, keep);
  return Object.fromEntries([...generated.entries].map(([locale, entries]) => rule(config, locale, { code: prunedModule(entries, kept) })));
}

export default withProsebook;
