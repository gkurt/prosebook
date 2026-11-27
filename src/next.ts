/**
 * `prosebook/next`: the catalog as part of a Next.js app.
 *
 * Generates when `next dev` or `next build` loads the config, and in dev again whenever a catalog or
 * translation file changes, so Fast Refresh picks up the new modules and a broken entry shows in the
 * terminal. Server components read the new text on their next render; in the browser, each locale
 * module hands its new messages to the copies holding it, which re-render in the locale and state
 * they were in. `next build` ships only the messages the code names: each locale module is handed to a
 * Turbopack loader (`loader.ts`) that returns it pruned. Turbopack loads a module before it has
 * seen the code that reads it, so the keys come from the source under `scan.dirs` (`tools/bundle.ts`),
 * read here once, and each pruned module travels to the loader as its options. The index travels too,
 * without the pseudo-locale, which is for dev.
 *
 * In dev the browser's index also starts the record of reads (`deictic/reads.ts`), and where deictic is
 * installed the config is wrapped in deictic's `withDeictic` too, with the copy inspector, which an app's own
 * `withDeictic` around it merges into its own.
 *
 * With `split`, client components get the catalog split by area, as under Vite (`tools/bundle.ts`).
 * Turbopack has no virtual modules, so the areas are files, written under `node_modules/.prosebook`,
 * where they are a dependency's code to Turbopack and not the app's; and it has no transform hook, so
 * a loader rule over the app's own source in the browser appends the imports of the areas each file
 * names. Server components and the server render read whole locales.
 *
 * Turbopack only: Next 16 fails a Turbopack build whose config has a `webpack` key, so none is added.
 */
import { join, relative, resolve } from 'node:path';

import { added, copyInspector, NO_DEICTIC, recordReads, type Inspect } from './deictic/register.ts';
import type { LoaderOptions } from './loader.ts';
import {
  areaFile,
  areaModule,
  areasOf,
  beside,
  brokenIn,
  buildIndex,
  fileSpecifiers,
  HOT_SET,
  inAreas,
  keeper,
  lazyAreas,
  membersOf,
  type Prune,
  prunedModule,
  scanSources,
  buildGenerated,
  generatedModule,
  splitIndex,
  unseenMessage,
  watchCatalog,
} from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { areaGroups } from './tools/chunks.ts';
import { compileLocale, localeExpression } from './tools/compile.ts';
import type { Entry } from './tools/compile.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { generate, writeFiles, type Generated } from './tools/generate.ts';

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
  /**
   * Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. With
   * `split`, their areas load with the catalog.
   */
  keep?: string[];
  /**
   * Split each locale by area in client components, as the Vite plugin's `split` does, so a route's
   * client code brings only the messages it reads. Server components read whole locales.
   */
  split?: boolean;
  /**
   * In dev, the copy inspector: deictic's shortcut on a string edits its entry, where deictic is installed. On
   * by default; `{ shortcut }` is deictic's shortcut that opens the Copy tab directly.
   */
  inspect?: Inspect;
}

type Rules = { [glob: string]: unknown };
type ConfigFunction<C> = (phase: string, context: { defaultConfig: C }) => C | Promise<C>;

const DEV = 'phase-development-server';
const BUILD = 'phase-production-build';

const loaderPath = beside(import.meta.url, 'loader');
const readsPath = beside(import.meta.url, 'deictic/reads');

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
    if (phase === BUILD) return withRules(resolved, buildRules(config, buildGenerated(config), options.prune ?? 'strict', options));
    // In dev a broken entry is left out and said, so the rest of the catalog is still served.
    const generated = generate(config, { partial: true });
    if (brokenIn(generated) !== undefined) console.error(brokenIn(generated));
    watch(config, options);
    // A relative import, which Turbopack resolves as it would the app's own.
    const path = relative(config.out, readsPath).replaceAll('\\', '/');
    const prepend = HOT_SET + recordReads(path.startsWith('.') ? path : `./${path}`);
    const ruled = withRules(resolved, hotRules(config, generated, prepend, options));
    const inspector = await copyInspector(options.inspect, { root: options.root, config: options.config });
    if (inspector === undefined) {
      if (options.inspect === undefined) console.info(NO_DEICTIC);
      return ruled;
    }
    // deictic's own wrapper, with the prosebook plugin: an app's `withDeictic` around this one merges it in.
    const { withDeictic } = await import('deictic/next');
    return withDeictic(ruled, { ...added(inspector), ...(options.root === undefined ? {} : { root: options.root }) })(phase, context);
  };
}

/** Rules by glob: where several share one, each in a list, in order. */
function rulesOf(entries: [string, unknown][]): Rules {
  const all: Rules = {};
  for (const [glob, rule] of entries) all[glob] = glob in all ? [all[glob], rule].flat() : rule;
  return all;
}

/** The app's rules and ours: where both have one for a glob, theirs first, then ours, in a list. */
function withRules<C extends object>(resolved: C, rules: Rules): C {
  const turbopack = (resolved as { turbopack?: { rules?: Rules } }).turbopack;
  return {
    ...resolved,
    turbopack: { ...turbopack, rules: rulesOf([...Object.entries(turbopack?.rules ?? {}), ...Object.entries(rules)]) },
  };
}

/** Regenerates on each edit, with the config as it then reads; the rules keep the paths it named at start. */
function watch(config: ResolvedConfig, options: ProsebookNextOptions): void {
  const key = config.catalog;
  if (watching.has(key)) return;
  watching.add(key);
  const fail = (e: unknown) => console.error(describe(e));
  watchCatalog(
    config,
    options.config,
    (next) => {
      try {
        const generated = generate(next, { partial: true });
        if (options.split === true) writeAreas(next, generated);
        const broken = brokenIn(generated);
        if (broken !== undefined) return console.error(broken);
        console.info(`prosebook: regenerated ${relative(next.root, next.out).replaceAll('\\', '/')}`);
      } catch (e) {
        fail(e);
      }
    },
    fail,
  );
}

/**
 * A rule per generated module: matched by its file name, then by its path, which Turbopack gives from
 * its own root, so only the end is known.
 */
function rule(config: ResolvedConfig, name: string, options: LoaderOptions, side?: 'browser' | 'server'): [string, unknown] {
  const file = `${name}.${config.language === 'ts' ? 'ts' : 'js'}`;
  const path = { path: new RegExp(`(?:^|/)${escape(join(relative(config.root, config.out), file).replaceAll('\\', '/'))}$`) };
  const condition = side === undefined ? path : { all: [side === 'browser' ? 'browser' : { not: 'browser' }, path] };
  return [file, { condition, loaders: [{ loader: loaderPath, options }] }];
}

/**
 * In the browser: the index starts with `prepend`, the hot hooks and the record of reads, there before any
 * copy exists, and each locale updates the copies.
 */
function hotRules(config: ResolvedConfig, generated: Generated, prepend: string, options: ProsebookNextOptions): Rules {
  const locales = [...generated.entries.keys()].map((locale) => rule(config, locale, { locale }, 'browser'));
  if (options.split === true) return Object.fromEntries([...locales, ...splitRules(config, generated, options, prepend)]);
  return Object.fromEntries([rule(config, 'index', { prepend }, 'browser'), ...locales]);
}

/**
 * Each locale pruned, and the index without the pseudo-locale, which `generated` no longer holds: with
 * `split`, the browser's index is split and the server's whole.
 */
function buildRules(config: ResolvedConfig, generated: Generated, prune: Prune, options: ProsebookNextOptions): Rules {
  let kept: (key: string) => boolean = () => true;
  if (prune !== false) {
    const { refs, unseen } = scanSources(config, prune === 'strict');
    if (unseen.length > 0) throw new Error(unseenMessage(unseen, config.root));
    kept = keeper(refs, options.keep, config.formats);
  }
  const locales = [...generated.entries].map(([locale, entries]) =>
    rule(config, locale, { code: prune === false ? (generatedModule(config, generated, locale) ?? '') : prunedModule(entries, kept) }),
  );
  const index = { code: buildIndex(config, generated) };
  if (options.split !== true) return rulesOf([...locales, rule(config, 'index', index)]);
  return rulesOf([...locales, rule(config, 'index', index, 'server'), ...splitRules(config, generated, options, '', kept)]);
}

/** Where a split catalog's area files go: out of the app's source, where Turbopack takes them for a dependency's. */
const areasDir = (config: ResolvedConfig) => join(config.root, 'node_modules', '.prosebook', 'areas');

/**
 * Writes each area's file, and in a build, with `kept`, each lazy locale's part of each group of
 * areas that share a chunk (`tools/chunks.ts`), pruned; in dev an area holds its locales' generated
 * modules whole, so their own updates reach the copies.
 */
function writeAreas(config: ResolvedConfig, generated: Generated, kept?: (key: string) => boolean, keep?: string[]): void {
  const dir = areasDir(config);
  const where = fileSpecifiers(dir, dir);
  const inline = kept === undefined ? undefined : (_locale: string, entries: Entry[]) => localeExpression(compileLocale(entries, kept));
  const groups = kept === undefined ? new Map<string, string>() : areaGroups(config, generated, keep);
  const files = new Map<string, string>();
  for (const area of areasOf(generated)) files.set(join(dir, areaFile(area)), areaModule(config, generated, area, inline, where, groups));
  if (kept === undefined) {
    writeFiles(files);
    return;
  }
  for (const lead of new Set(groups.values())) {
    for (const [locale, entries] of generated.entries) {
      const parts = inAreas(entries, membersOf(groups, lead));
      if (parts.length > 0 && locale !== config.source && !config.bundled.includes(locale))
        files.set(join(dir, areaFile(lead, locale)), prunedModule(parts, kept));
    }
  }
  writeFiles(files);
}

/**
 * In the browser: the index of a split catalog after `prepend`, and a rule per kind of source file
 * under `scan.dirs` that names an area's keys, which appends its imports of those areas.
 */
function splitRules(
  config: ResolvedConfig,
  generated: Generated,
  options: ProsebookNextOptions,
  prepend: string,
  kept?: (key: string) => boolean,
) {
  writeAreas(config, generated, kept, options.keep);
  const index = rule(
    config,
    'index',
    { code: prepend + splitIndex(config, generated, options.keep, fileSpecifiers(config.out, areasDir(config))) },
    'browser',
  );
  const areas = [...lazyAreas(generated, options.keep)];
  if (areas.length === 0) return [index];
  const under = (dir: string) => escape(relative(config.root, dir).replaceAll('\\', '/'));
  const dirs = config.scan.dirs.map(under).filter((d) => d !== '');
  const condition = {
    all: [
      'browser',
      { not: 'foreign' },
      ...(dirs.length > 0 && dirs.length === config.scan.dirs.length ? [{ path: new RegExp(`(?:^|/)(?:${dirs.join('|')})(?:/|$)`) }] : []),
      { not: { path: new RegExp(`(?:^|/)${under(config.out)}/`) } },
      // As `keyRefs` reads a key: a quote, then the area.
      { content: new RegExp(`['"\`](?:${areas.map(escape).join('|')})\\.`) },
    ],
  };
  const loaderOptions: LoaderOptions = { areas, dir: areasDir(config) };
  const sources = ['*.ts', '*.tsx', '*.js', '*.jsx'].map((glob): [string, unknown] => [
    glob,
    { condition, loaders: [{ loader: loaderPath, options: loaderOptions }], as: glob },
  ]);
  return [index, ...sources];
}

export default withProsebook;
