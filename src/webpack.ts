/**
 * `prosebook/webpack`: the catalog in a webpack or Rspack build.
 *
 * Generates before each build, and when watching, again whenever a catalog or translation file
 * changes, so the dev server picks up the new modules and a broken entry shows in the terminal. In
 * production mode the build ships only the messages the code names: a loader (`loader.ts`) hands each
 * locale module over pruned and the index without the pseudo-locale. webpack loads a module before it
 * has seen the code reading it, so the keys come from the source under `scan.dirs`, read once, as
 * under Next. In other modes each locale module accepts its own hot update and hands its messages to
 * the copies holding it, which re-render in the locale and state they were in.
 *
 * The rule is added as the plugin is applied, before the config is read, so it names the plugin and
 * the loader finds each module's options in a registry the plugin fills (`pluginModules`): Rspack
 * fixes a rule's options when it reads the config.
 */
import { join, relative, resolve } from 'node:path';

import { modulePath, pluginModules, type LoaderOptions } from './loader.ts';
import {
  beside,
  brokenIn,
  buildIndex,
  HOT_SET,
  keeper,
  type Prune,
  prunedModule,
  scanSources,
  unseenMessage,
  watchCatalog,
  withoutPseudo,
} from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { generate, type Generated } from './tools/generate.ts';

export interface ProsebookWebpackOptions {
  /** The config, inline. Without it, `prosebook.config.*` at `root` is read. */
  config?: ProsebookConfig;
  /** The folder the config's paths resolve from, and where its file is found: webpack's `context` when unset. */
  root?: string;
  /**
   * In production mode, ship only the messages the code names. `strict`, the default, also fails the
   * build on a read whose key it can't see, such as `t(item.key)`. `loose` prunes without that check;
   * `false` ships every message.
   */
  prune?: Prune;
  /** Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
}

/** What the plugin reads of a webpack or Rspack compiler. */
interface Compiler {
  context: string;
  options: {
    mode?: string;
    module: { rules: unknown[] };
    resolve: { extensionAlias?: { [ext: string]: string | string[] } };
  };
  hooks: {
    beforeRun: { tapPromise(name: string, run: (compiler: Compiler) => Promise<void>): void };
    watchRun: { tapPromise(name: string, run: (compiler: Compiler) => Promise<void>): void };
    watchClose: { tap(name: string, run: () => void): void };
  };
}

const NAME = 'prosebook';
const loaderPath = beside(import.meta.url, 'loader');
let plugins = 0;

/**
 * Appended to the index in dev: it accepts its own update, as only its comments change with an edit,
 * unless the locales did, which the page reloads for.
 */
const HOT_INDEX = `
if (import.meta.webpackHot) {
  const hot = import.meta.webpackHot;
  if (hot.data !== undefined && hot.data.locales !== catalog.locales.join()) hot.invalidate();
  else hot.accept();
  hot.dispose((data) => {
    data.locales = catalog.locales.join();
  });
}
`;

/** Appended to a locale module in dev, which hands its messages to the copies each time it runs. */
const HOT_LOCALE = '\nimport.meta.webpackHot?.accept();\n';

const describe = (e: unknown) => (e instanceof CatalogError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));

/** `plugins: [new ProsebookPlugin()]`, in `webpack.config.js` or `rspack.config.js`. */
export class ProsebookPlugin {
  readonly #options: ProsebookWebpackOptions;
  readonly #id = `webpack-${plugins++}`;

  constructor(options: ProsebookWebpackOptions = {}) {
    this.#options = options;
  }

  apply(compiler: Compiler): void {
    const modules = new Map<string, LoaderOptions>();
    pluginModules.set(this.#id, modules);
    compiler.options.module.rules.unshift({
      enforce: 'pre',
      test: (path: string) => modules.has(modulePath(path)),
      use: [{ loader: loaderPath, options: { plugin: this.#id } }],
    });

    let stop: (() => void) | undefined;
    // webpack builds for production where no mode is set.
    const production = () => (compiler.options.mode ?? 'production') === 'production';
    const prepare = async (watching: boolean) => {
      const config = await loadConfig(resolve(this.#options.root ?? compiler.context), this.#options.config);
      if (config.language === 'ts' && config.importExtension === '.js' && compiler.options.resolve.extensionAlias?.['.js'] === undefined) {
        throw new Error(
          "prosebook: webpack doesn't resolve `./en.js` to `en.ts`: set `importExtension: ''` in the prosebook config, or `resolve.extensionAlias: { '.js': ['.ts', '.js'] }`",
        );
      }
      const generated = generate(config, { partial: !production() });
      if (production()) return fill(modules, buildModules(config, withoutPseudo(config, generated), this.#options));
      const broken = brokenIn(generated);
      if (broken !== undefined) console.error(broken);
      fill(modules, devModules(config, generated));
      if (watching) stop ??= watch(config, this.#options, modules);
    };

    compiler.hooks.beforeRun.tapPromise(NAME, () => prepare(false));
    // Once: the catalog's own watcher regenerates after that, and webpack sees the modules change.
    let ready: Promise<void> | undefined;
    compiler.hooks.watchRun.tapPromise(NAME, () => (ready ??= prepare(true)));
    compiler.hooks.watchClose.tap(NAME, () => {
      stop?.();
      stop = undefined;
      ready = undefined;
    });
  }
}

/** `modules` holding `next` alone. */
function fill(modules: Map<string, LoaderOptions>, next: Map<string, LoaderOptions>): void {
  modules.clear();
  for (const [path, options] of next) modules.set(path, options);
}

const generatedPath = (config: ResolvedConfig, name: string) =>
  modulePath(join(config.out, `${name}.${config.language === 'ts' ? 'ts' : 'js'}`));

/** The index first creates the set every copy adds itself to, and each locale updates the copies holding it. */
function devModules(config: ResolvedConfig, generated: Generated): Map<string, LoaderOptions> {
  const modules = new Map<string, LoaderOptions>([[generatedPath(config, 'index'), { prepend: HOT_SET, append: HOT_INDEX }]]);
  for (const locale of generated.entries.keys()) modules.set(generatedPath(config, locale), { locale, append: HOT_LOCALE });
  return modules;
}

/** Each locale pruned to the keys the source names, and the index without the pseudo-locale, which `generated` no longer holds. */
function buildModules(config: ResolvedConfig, generated: Generated, options: ProsebookWebpackOptions): Map<string, LoaderOptions> {
  const prune = options.prune ?? 'strict';
  const modules = new Map<string, LoaderOptions>([[generatedPath(config, 'index'), { code: buildIndex(config, generated) }]]);
  if (prune === false) return modules;
  const { refs, unseen } = scanSources(config, prune === 'strict');
  if (unseen.length > 0) throw new Error(unseenMessage(unseen, config.root));
  const kept = keeper(refs, options.keep, config.formats);
  for (const [locale, entries] of generated.entries) modules.set(generatedPath(config, locale), { code: prunedModule(entries, kept) });
  return modules;
}

/** Regenerates on each edit, with the config as it then reads, and names a locale the edit added. */
function watch(config: ResolvedConfig, options: ProsebookWebpackOptions, modules: Map<string, LoaderOptions>): () => void {
  const fail = (e: unknown) => console.error(describe(e));
  return watchCatalog(
    config,
    options.config,
    (next) => {
      try {
        const generated = generate(next, { partial: true });
        fill(modules, devModules(next, generated));
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

export default ProsebookPlugin;
