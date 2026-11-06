/**
 * `prosebook/metro`: the catalog in a React Native or Expo app, bundled by Metro.
 *
 * Generates when Metro reads its config, and again on every edit while the process lives, so the dev
 * server picks up the new modules. Metro has no loaders and decides dev or production per bundle, so
 * this goes through its resolver, which knows (`context.dev`): each generated module is resolved to a
 * file of prosebook's own under `node_modules/.prosebook/metro`, written before Metro reads the files.
 * In dev, a wrapper that re-exports the generated module and accepts its update (`module.hot.accept()`),
 * which Metro's runtime stops at, so a catalog edit hands the locale's new messages to the copies and
 * the app keeps its state. In production, the locale pruned to the keys the source names, and the
 * index without the pseudo-locale. A generated index importing `./en.js` gets `en.ts`, as Metro would
 * not find it.
 */
import { join, relative, resolve } from 'node:path';

import {
  brokenIn,
  buildIndex,
  HOT_SET,
  keeper,
  type Prune,
  prunedModule,
  relativeImport,
  scanSources,
  unseenMessage,
  watchCatalog,
  withoutPseudo,
} from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { generate, writeFiles, type Generated } from './tools/generate.ts';

export interface ProsebookMetroOptions {
  /** The config, inline. Without it, `prosebook.config.*` at `root` is read. */
  config?: ProsebookConfig;
  /** The folder the config's paths resolve from, and where its file is found: Metro's `projectRoot` when unset. */
  root?: string;
  /**
   * In a production bundle, ship only the messages the code names. `strict`, the default, also fails
   * the bundle on a read whose key it can't see, such as `t(item.key)`. `loose` prunes without that
   * check; `false` ships every message.
   */
  prune?: Prune;
  /** Keys a production bundle always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
}

/** What Metro hands a resolver, of what this reads. */
interface ResolutionContext {
  readonly dev: boolean;
  readonly originModulePath: string;
  readonly resolveRequest: ResolveRequest;
}

type Resolution = { type: 'sourceFile'; filePath: string } | { type: string };
type ResolveRequest = (context: ResolutionContext, moduleName: string, platform: string | null) => Resolution;

/** What this reads and sets of a Metro config: its resolver's `resolveRequest`, typed below as far as this reads it. */
interface MetroConfig {
  projectRoot?: string;
  resolver?: object;
}

type ConfigOf<C> = C | Promise<C> | (() => C | Promise<C>);

const describe = (e: unknown) => (e instanceof CatalogError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));

/** Paths as the resolver compares them: forward slashes, and on Windows any case. */
const same = (path: string) => {
  const slashed = path.replaceAll('\\', '/');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
};

/**
 * Wraps the Metro config: `module.exports = withProsebook(getDefaultConfig(__dirname))`. Takes the
 * config, a promise of it, or a function making it, and returns a promise, which Metro waits for.
 */
export async function withProsebook<C extends MetroConfig>(metro: ConfigOf<C>, options: ProsebookMetroOptions = {}): Promise<C> {
  const resolved = await (typeof metro === 'function' ? metro() : metro);
  let config = await loadConfig(resolve(options.root ?? resolved.projectRoot ?? process.cwd()), options.config);
  const dir = join(config.root, 'node_modules', '.prosebook', 'metro');
  const ext = config.language === 'ts' ? 'ts' : 'js';
  const outOf = (c: ResolvedConfig) => ({ index: same(join(c.out, `index.${ext}`)), dir: same(c.out) });

  // In dev a broken entry is left out and said, so the rest of the catalog is still served; a
  // production bundle refuses it as it resolves the catalog.
  let generated = generate(config, { partial: true });
  let broken = brokenIn(generated);
  if (broken !== undefined) console.error(broken);
  let locales = new Set(generated.entries.keys());
  writeFiles(devWrappers(config, generated, dir));
  const build = buildModules(config, withoutPseudo(config, generated), dir, options);
  writeFiles(build.files);

  watchCatalog(
    config,
    options.config,
    (next) => {
      try {
        config = next;
        generated = generate(next, { partial: true });
        locales = new Set(generated.entries.keys());
        writeFiles(devWrappers(next, generated, dir));
        broken = brokenIn(generated);
        if (broken !== undefined) return console.error(broken);
        console.info(`prosebook: regenerated ${relative(next.root, next.out).replaceAll('\\', '/')}`);
      } catch (e) {
        console.error(describe(e));
      }
    },
    (e) => console.error(describe(e)),
    false,
  );

  const theirs = resolved.resolver !== undefined && 'resolveRequest' in resolved.resolver ? resolved.resolver.resolveRequest : undefined;
  const resolveRequest: ResolveRequest = (context, moduleName, platform) => {
    // The app's own resolver where it has one, else Metro's.
    const upstream = typeof theirs === 'function' ? (theirs as ResolveRequest) : context.resolveRequest;
    const origin = same(context.originModulePath);
    // Ours import the generated modules themselves.
    if (origin.startsWith(`${same(dir)}/`)) return upstream(context, moduleName, platform);
    const out = outOf(config);
    const mode = context.dev ? 'dev' : 'build';
    const ours = (name: string) => {
      if (!context.dev && broken !== undefined) throw new Error(broken.replace(/\n.*$/, ''));
      if (!context.dev && build.error !== undefined) throw new Error(build.error);
      return { type: 'sourceFile', filePath: join(dir, mode, `${name}.js`) };
    };
    // The generated index's own `./en.js`, which may be `en.ts` on disk.
    if (origin === out.index && moduleName.startsWith('./')) {
      const name = moduleName.slice(2).replace(/\.(?:[cm]?[jt]s)$/, '');
      if (locales.has(name)) return ours(name);
    }
    const found = upstream(context, moduleName, platform);
    if (found.type !== 'sourceFile' || !('filePath' in found)) return found;
    const path = same(found.filePath);
    if (path === out.index) return ours('index');
    if (!path.startsWith(`${out.dir}/`)) return found;
    const name = path.slice(out.dir.length + 1).replace(/\.[jt]s$/, '');
    return locales.has(name) ? ours(name) : found;
  };
  return { ...resolved, resolver: { ...resolved.resolver, resolveRequest } };
}

const importOf = (from: string, path: string) => JSON.stringify(relativeImport(from, path));

/**
 * The dev wrappers: the index's makes the set every copy adds itself to, and each locale's hands its
 * messages to the copies holding it whenever it runs again. Both accept their updates, which a
 * generated module's edit reaches first.
 */
function devWrappers(config: ResolvedConfig, generated: Generated, dir: string): Map<string, string> {
  const at = join(dir, 'dev');
  const ext = config.language === 'ts' ? 'ts' : 'js';
  const generatedAt = (name: string) => importOf(at, join(config.out, `${name}.${ext}`));
  const files = new Map([
    [join(at, 'index.js'), `${HOT_SET}export * from ${generatedAt('index')};\nif (module.hot) module.hot.accept();\n`],
  ]);
  for (const locale of generated.entries.keys()) {
    files.set(
      join(at, `${locale}.js`),
      [
        `import messages from ${generatedAt(locale)};`,
        'export default messages;',
        `globalThis.__PROSEBOOK_HOT__?.forEach((update) => update(${JSON.stringify(locale)}, messages));`,
        'if (module.hot) module.hot.accept();',
        '',
      ].join('\n'),
    );
  }
  return files;
}

/**
 * A production bundle's modules: each locale pruned to the keys the source names, and the index
 * without the pseudo-locale, which `generated` no longer holds. A read the build can't see is kept as
 * the error a production bundle fails with, so the dev server still starts.
 */
function buildModules(config: ResolvedConfig, generated: Generated, dir: string, options: ProsebookMetroOptions) {
  const at = join(dir, 'build');
  const prune = options.prune ?? 'strict';
  let kept: (key: string) => boolean = () => true;
  let error: string | undefined;
  if (prune !== false) {
    const { refs, unseen } = scanSources(config, prune === 'strict');
    if (unseen.length > 0) error = unseenMessage(unseen, config.root);
    kept = keeper(refs, options.keep, config.formats);
  }
  const files = new Map([[join(at, 'index.js'), buildIndex({ ...config, importExtension: '.js' }, generated)]]);
  for (const [locale, entries] of generated.entries) files.set(join(at, `${locale}.js`), prunedModule(entries, kept));
  return { files, error };
}

export default withProsebook;
