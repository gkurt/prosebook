/**
 * `prosebook/bun`: the catalog as part of a Bun build, or of Bun's dev server.
 *
 * Generates when the plugin is set up. Given to `Bun.build`, it ships only the messages the code
 * names: Bun loads a locale module before it has seen the code that reads it, so the keys come from
 * the source under `scan.dirs` (`tools/bundle.ts`) and each locale loads already pruned. The `bun
 * build` command reads no plugins, so a build that prunes is a script that calls `Bun.build`.
 *
 * Named in bunfig.toml's `[serve.static] plugins`, it serves `Bun.serve`'s bundler instead, which
 * names no entry points: it regenerates whenever a catalog or translation file changes, and each
 * locale module accepts its own update and hands the new messages to every copy, as under Vite. The
 * index starts the inspector on the page too, whose endpoints are `inspector()`'s routes, spread into
 * `Bun.serve`'s; an entry opens in the editor `Bun.openInEditor` finds.
 *
 * With `split`, the page's catalog is split by area as the Vite plugin's is (`tools/bundle.ts`): each
 * source file under `scan.dirs` naming an area's keys imports the area, a module of the plugin's own
 * namespace. Bun has no transform hook, so those files are read here and handed back. A build knows
 * the keys it keeps before it loads anything, so each area loads already pruned.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { BunPlugin } from 'bun';

import {
  AREA,
  areaModule,
  areasNamed,
  beside,
  HOT_INDEX,
  HOT_SET,
  hotLocale,
  importingAreas,
  inArea,
  installInspector,
  keeper,
  prunedModule,
  scanSources,
  splitIndex,
  unseenMessage,
  watchCatalog,
  type Prune,
} from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { compileLocale, localeExpression, type Entry } from './tools/compile.ts';
import { loadConfig, type ProsebookConfig } from './tools/config.ts';
import { inspectorEndpoints } from './tools/endpoints.ts';
import { generate } from './tools/generate.ts';

export interface ProsebookBunOptions {
  /** The config, inline. Without it, `prosebook.config.*` at `root` is read. */
  config?: ProsebookConfig;
  /** The folder the config's paths resolve from, and where its file is found: the working directory when unset. */
  root?: string;
  /**
   * In `Bun.build`, ship only the messages the code names. `strict`, the default, also fails the
   * build on a read whose key it can't see, such as `t(item.key)`. `loose` prunes without that
   * check; `false` ships every message.
   */
  prune?: Prune;
  /**
   * Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. With
   * `split`, their areas load with the catalog.
   */
  keep?: string[];
  /**
   * Split each locale by area in the page, as the Vite plugin's `split` does, so a lazy route loads
   * only the messages it reads. `Bun.build` needs `splitting: true`. A server's own code loads whole
   * locales.
   */
  split?: boolean;
  /** Under the dev server, Alt-click a string on the page to open its entry in the editor. On by default. */
  inspect?: boolean;
}

const inspectorPath = beside(import.meta.url, 'inspector');
const NAMESPACE = 'prosebook-area';

const describe = (e: unknown) => (e instanceof CatalogError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A folder's path as a pattern, by either separator: Bun gives paths with either on Windows. */
const folderPattern = (path: string) => path.split(/[\\/]/).map(escape).join('[\\\\/]');

export function prosebook(options: ProsebookBunOptions = {}): BunPlugin {
  return {
    name: 'prosebook',
    async setup(build) {
      const config = await loadConfig(resolve(options.root ?? process.cwd()), options.config);
      let generated = generate(config);
      // The generated modules, by path as Bun gives it.
      const filter = new RegExp(`^${folderPattern(config.out)}[\\\\/][^\\\\/]+\\.[jt]s$`);
      const nameOf = (path: string) => basename(path).replace(/\.[jt]s$/, '');
      const building = 'entrypoints' in build.config;
      const split = options.split === true;
      if (building && split && build.config.splitting !== true)
        throw new Error('prosebook: `split` needs `splitting: true` in Bun.build, or every area ships in the entry chunk');
      // A full-stack build, one `Bun.build` of a server and the pages it imports, names the side it
      // loads for (undocumented, and not in Bun's types); any other build is for its target.
      const client = (args: object) => ('side' in args ? args.side === 'client' : (build.config.target ?? 'browser') === 'browser');

      const prune = options.prune ?? 'strict';
      let kept: (key: string) => boolean = () => true;
      if (building && prune !== false) {
        const { refs, unseen } = scanSources(config, prune === 'strict');
        if (unseen.length > 0) throw new Error(unseenMessage(unseen, config.root));
        kept = keeper(refs, options.keep);
      }
      const dev = !building && process.env.NODE_ENV !== 'production';
      const inspector = dev && options.inspect !== false ? installInspector(inspectorPath, '/') : '';
      if (dev) {
        watchCatalog(config, () => {
          try {
            generated = generate(config);
          } catch (e) {
            console.error(describe(e));
          }
        });
      }

      build.onLoad({ filter }, (args) => {
        const name = nameOf(args.path);
        if (name === 'index' && split && client(args)) {
          const index = splitIndex(config, generated, options.keep);
          return { contents: building ? index : HOT_SET + inspector + index + HOT_INDEX, loader: 'js' };
        }
        const entries = generated.entries.get(name);
        if (building) return entries === undefined || prune === false ? undefined : { contents: prunedModule(entries, kept), loader: 'js' };
        const loader = args.path.endsWith('.ts') ? 'ts' : 'js';
        if (entries !== undefined) return { contents: readFileSync(args.path, 'utf8') + hotLocale(name), loader };
        return name === 'index' ? { contents: HOT_SET + inspector + readFileSync(args.path, 'utf8') + HOT_INDEX, loader } : undefined;
      });
      if (!split) return;

      // `cart`, or in a build `cart/de`, a lazy locale's part of the area.
      build.onResolve({ filter: new RegExp(`^${escape(AREA)}`) }, ({ path }) => ({ path: path.slice(AREA.length), namespace: NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, ({ path }) => {
        const [area = '', locale] = path.split('/');
        if (locale !== undefined) return { contents: prunedModule(inArea(generated.entries.get(locale) ?? [], area), kept), loader: 'js' };
        const parts = building
          ? { inline: (_locale: string, entries: Entry[]) => localeExpression(compileLocale(entries, kept)) }
          : undefined;
        return { contents: areaModule(config, generated, area, parts), loader: 'js' };
      });
      const dirs = config.scan.dirs.map((dir) => folderPattern(resolve(config.root, dir))).join('|');
      const out = new RegExp(`^${folderPattern(config.out)}[\\\\/]`);
      build.onLoad({ filter: new RegExp(`^(?:${dirs})[\\\\/].*\\.[cm]?[jt]sx?$`) }, (args) => {
        if (!client(args) || out.test(args.path) || /[\\/]node_modules[\\/]/.test(args.path)) return undefined;
        const code = readFileSync(args.path, 'utf8');
        const areas = areasNamed(code, generated, options.keep);
        return areas.length === 0 ? undefined : { contents: importingAreas(code, args.path, areas), loader: args.loader };
      });
    },
  };
}

export interface InspectorRoutesOptions {
  /** The config, inline. Without it, `prosebook.config.*` at `root` is read. */
  config?: ProsebookConfig;
  /** The folder the config's paths resolve from, and where its file is found: the working directory when unset. */
  root?: string;
}

/**
 * The inspector's endpoints as `Bun.serve` routes: `routes: { ...inspector(), '/': index }`. For dev
 * only: they read and write the catalog.
 */
export function inspector(options: InspectorRoutesOptions = {}): Record<string, (req: Request) => Promise<Response>> {
  const handle = inspectorEndpoints(loadConfig(resolve(options.root ?? process.cwd()), options.config), {
    open: ({ file, line, column }) => {
      try {
        Bun.openInEditor(file, { line, column });
        return new Response(null, { status: 204 });
      } catch (e) {
        return new Response(`${e instanceof Error ? e.message : String(e)}: set VISUAL or EDITOR to the editor's command`, { status: 500 });
      }
    },
  });
  const route = async (req: Request) => (await handle(req)) ?? new Response(null, { status: 404 });
  return { '/__prosebook/open': route, '/__prosebook/entry': route };
}

// bunfig.toml names the module, and Bun takes its default export as the plugin.
export default prosebook();
