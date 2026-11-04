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
 * the keys it keeps before it loads anything, so each area loads already pruned, and which areas
 * share a chunk (`tools/chunks.ts`), so a lazy locale's part is a file per group of them. Bun's
 * metafile names the file each part went to, which the server's catalog lists (`areaFiles`), so a
 * server render can link what it read.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { BunPlugin, PluginBuilder } from 'bun';

import {
  AREA,
  areaFilesOf,
  areaFilesPath,
  areaModule,
  areasNamed,
  lazyAreas,
  beside,
  HOT_INDEX,
  HOT_SET,
  hotLocale,
  importingAreas,
  inAreas,
  installInspector,
  keeper,
  membersOf,
  prunedModule,
  scanSources,
  splitIndex,
  unseenMessage,
  watchCatalog,
  withAreaFiles,
  type Groups,
  type Prune,
} from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { areaGroups } from './tools/chunks.ts';
import { compileLocale, localeExpression, type Entry } from './tools/compile.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { inspectorEndpoints } from './tools/endpoints.ts';
import { generate, writeFiles, type Generated } from './tools/generate.ts';

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
   * locales, and its catalog lists each area's files, which a copy's `preload` hands on as the render
   * reads them.
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
      // Bun names the side it loads a module for (undocumented, and not in Bun's types): both, in a
      // full-stack build, one `Bun.build` of a server and the pages it imports; else its target's.
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

      const groups = building ? areaGroups(config, generated, options.keep) : new Map<string, string>();
      if (building) linkAreaFiles(build, config, () => generated, groups, client);
      // `cart`, or in a build `cart/de`, a lazy locale's part of the group `cart` leads.
      build.onResolve({ filter: new RegExp(`^${escape(AREA)}`) }, ({ path }) => ({ path: path.slice(AREA.length), namespace: NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, ({ path }) => {
        const [area = '', locale] = path.split('/');
        if (locale !== undefined) {
          const entries = inAreas(generated.entries.get(locale) ?? [], membersOf(groups, area));
          return { contents: prunedModule(entries, kept), loader: 'js' };
        }
        const inline = building ? (_locale: string, entries: Entry[]) => localeExpression(compileLocale(entries, kept)) : undefined;
        return { contents: areaModule(config, generated, area, inline, undefined, groups), loader: 'js' };
      });
      const dirs = config.scan.dirs.map((dir) => folderPattern(resolve(config.root, dir))).join('|');
      const out = new RegExp(`^${folderPattern(config.out)}[\\\\/]`);
      build.onLoad({ filter: new RegExp(`^(?:${dirs})[\\\\/].*\\.[cm]?[jt]sx?$`) }, (args) => {
        if (!client(args) || out.test(args.path) || /[\\/]node_modules[\\/]/.test(args.path)) return undefined;
        const code = readFileSync(args.path, 'utf8');
        const areas = areasNamed(code, lazyAreas(generated, options.keep));
        return areas.length === 0 ? undefined : { contents: importingAreas(code, args.path, areas), loader: args.loader };
      });
    },
  };
}

/** Stands for `areaFiles` in a server's index, until the page's files are written. */
const PLACEHOLDER = '"__PROSEBOOK_AREA_FILES__"';
/** The placeholder as the minifier may have quoted it. */
const AREA_FILES = /(["'`])__PROSEBOOK_AREA_FILES__\1/g;
const NO_PAGE = 'prosebook: no split page build to link area files from: build the page before the server, or `preload` is handed nothing';

/**
 * A split build's lazy locales, each area's file, for a server render to link (`Catalog.areaFiles`).
 * Bun's metafile names the modules in each file it writes, known only once the build ends. A server's
 * index holds a placeholder, filled in the written file: in a full-stack build, from the page built
 * beside it; in a server's own build, from the page's build before it, which wrote its files down.
 */
function linkAreaFiles(
  build: PluginBuilder,
  config: ResolvedConfig,
  generated: () => Generated,
  groups: Groups,
  client: (args: object) => boolean,
): void {
  build.config.metafile = true;
  let server = false;
  build.onLoad({ filter: new RegExp(`^${folderPattern(config.out)}[\\\\/]index\\.[jt]s$`) }, (args) => {
    if (client(args)) return undefined;
    server = true;
    return { contents: withAreaFiles(readFileSync(args.path, 'utf8'), PLACEHOLDER), loader: args.path.endsWith('.ts') ? 'ts' : 'js' };
  });
  build.onEnd((result) => {
    if (!result.success || result.metafile === undefined) return;
    // Bun serves a page's files, and imports them, from `publicPath`, or beside the page.
    const base = build.config.publicPath ?? '/';
    const parts: [string, string, string][] = [];
    for (const [file, output] of Object.entries(result.metafile.outputs)) {
      const href = base + file.replaceAll('\\', '/').replace(/^\.\//, '');
      for (const input of Object.keys(output.inputs)) {
        if (!input.startsWith(`${NAMESPACE}:`)) continue;
        const [lead = '', locale] = input.slice(NAMESPACE.length + 1).split('/');
        if (locale !== undefined) parts.push([lead, locale, href]);
      }
    }
    const path = areaFilesPath(config.root);
    let files = JSON.stringify(areaFilesOf(generated(), groups, parts));
    if (parts.length > 0) writeFiles(new Map([[path, `${files}\n`]]));
    if (!server) return;
    if (parts.length === 0 && existsSync(path)) files = readFileSync(path, 'utf8').trim();
    else if (parts.length === 0) console.warn(NO_PAGE);
    // Written only with an `outdir`; without one, the server is handed no files.
    if (build.config.outdir === undefined) return;
    for (const output of result.outputs) {
      if (output.kind !== 'entry-point' && output.kind !== 'chunk') continue;
      const code = readFileSync(output.path, 'utf8');
      const filled = code.replace(AREA_FILES, () => files);
      if (filled !== code) writeFileSync(output.path, filled);
    }
  });
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
