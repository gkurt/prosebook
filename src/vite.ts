/**
 * `prosebook/vite`: the catalog as part of the build.
 *
 * Generates on start and again whenever a catalog or translation file changes, so dev never runs on
 * stale modules and a broken entry shows in the error overlay. A build ships only the messages the
 * code names: each locale module is swapped for its messages less the keys no module references
 * (see `tools/scan.ts` for how a reference is found, and why it errs towards keeping). It loads the
 * index without the pseudo-locale, which is for dev, so production neither lists nor ships it.
 *
 * With `split`, a client's catalog has no messages of its own: each module naming an area's keys
 * imports a module for that area, which the bundler places beside it, and which registers the area
 * (`addArea`) and waits until every copy holds it in its locale. Areas are found by the same
 * references pruning reads, so a read pruning can't see is one splitting can't place either. A lazy
 * locale's part is a file per group of areas the bundler will put in one chunk (`tools/chunks.ts`),
 * read from the source when the build starts, as an area loads before every module naming it has.
 * The client build writes down the file each area loads from per lazy locale, and the server build
 * after it gives its catalog that list (`areaFiles`), so a server render can link what it read.
 *
 * In dev an edit doesn't reload the page: each generated locale module accepts its own update and
 * hands the new messages to every copy (`HotHook`), which re-renders in the locale and state it was in.
 * The index accepts its own too, since its doc comments change with the source text, and reloads the
 * page only when a locale was added or removed. In the browser the index imports the dev module first,
 * which sets up the hooks and the inspector (`inspector/index.ts`) before any copy exists, so frameworks that
 * render their own HTML (TanStack Start, React Router) get them too. The server opens the entry the
 * inspector asks for through Vite's own `/__open-in-editor`, so the editor is whichever Vite already
 * launches.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

import {
  AREA,
  ASTRO_PLUGIN,
  areaFilesOf,
  areaFilesPath,
  areaModule,
  areasNamed,
  beside,
  brokenIn,
  DEV,
  buildIndex,
  type Groups,
  HOT_INDEX,
  HOT_SET,
  hotLocale,
  importingAreas,
  inAreas,
  installInspector,
  type Inspect,
  keeper,
  lazyAreas,
  membersOf,
  type Prune,
  withoutPseudo,
  splitIndex,
  unseenMessage,
  unseenOf,
  withAreaFiles,
} from './tools/bundle.ts';
import { CatalogError, type EntryLocation } from './tools/catalog.ts';
import { areaGroups } from './tools/chunks.ts';
import { compileLocale, localeExpression } from './tools/compile.ts';
import { CONFIG_FILES, loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { inspectorEndpoints, nodeMiddleware, redirect, serverReads } from './tools/endpoints.ts';
import { generate, writeFiles, type Generated } from './tools/generate.ts';
import { keyRefs, SFC, unseenReads, type KeyRefs, type Reads } from './tools/scan.ts';

export interface ProsebookPluginOptions {
  /** The config, inline. Without it, `prosebook.config.*` at `root` is read. */
  config?: ProsebookConfig;
  /**
   * The folder the config's paths resolve from, and where its file is found: the Vite root when
   * unset. Apps that share one catalog name its folder, so each build generates the same files.
   */
  root?: string;
  /**
   * Ship only the messages the code names. `strict`, the default, also fails the build on a read
   * whose key it can't see, such as `t(item.key)`, which would show the key where its message was
   * pruned. `loose` prunes without that check; `false` ships every message.
   */
  prune?: Prune;
  /**
   * Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. With
   * `split`, their areas load with the catalog.
   */
  keep?: string[];
  /**
   * Split each locale by area, so a lazy route loads only the messages it reads: a module that names
   * an area's keys imports that area, which the bundler places beside it, and a lazy locale loads
   * each area as it is needed. In the browser only: a server render loads whole locales, and its
   * catalog lists each area's files, which a copy's `preload` hands on as the render reads them.
   */
  split?: boolean;
  /**
   * In dev, Alt-click a string on the page to edit its entry. On by default; `{ modifiers, button }`
   * changes the keys held and the button pressed.
   */
  inspect?: Inspect;
}

const PLACEHOLDER = /__PROSEBOOK_LOCALE_(\d+)__/g;
const SCRIPT = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;
const DEV_ID = '\0prosebook/dev';
const AREA_ID = '\0prosebook/area/';

const normalize = (path: string) => resolve(path).replaceAll('\\', '/');

const inspectorPath = beside(import.meta.url, 'inspector/index');
// prosebook's own modules, which read keys handed to them: `<Text>` calls `rich(props.id)`.
const ownDir = normalize(fileURLToPath(new URL('.', import.meta.url)));

export function prosebook(options: ProsebookPluginOptions = {}): Plugin {
  let config: ResolvedConfig;
  let generated: Generated | undefined;
  let building = false;
  let base = '/';
  let viteRoot = '';
  let configRoot = '';
  let restarts = true;
  let kept: (key: string) => boolean = () => true;
  let refs: KeyRefs = { exact: new Set(), prefixes: new Set() };
  const reads = new Map<string, Reads>();
  const prune = options.prune ?? 'strict';
  // What each placeholder stands for: a locale's messages, or with `split`, some areas' of them.
  const placeholders: { locale: string; areas?: string[] }[] = [];
  let groups: Groups = new Map();
  const shipped = { total: 0, kept: 0 };
  // One per server: on a restart Vite makes the new server before closing the old, both through this
  // plugin when Vite was handed it inline rather than reading it from a config file, so a close stops the oldest.
  const stopReads: (() => void)[] = [];

  const describe = (e: unknown) => (e instanceof CatalogError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));

  const localeOf = (id: string): string | undefined => {
    const path = normalize(id.split('?', 1)[0]!);
    const out = normalize(config.out);
    if (!path.startsWith(`${out}/`)) return undefined;
    const name = path.slice(out.length + 1).replace(/\.[jt]s$/, '');
    return generated?.entries.has(name) === true ? name : undefined;
  };

  const isIndex = (id: string) => {
    const path = normalize(id.split('?', 1)[0]!);
    const out = normalize(config.out);
    return path === `${out}/index.ts` || path === `${out}/index.js`;
  };

  // Split in the browser only: a server render's copies, one per request, load whole locales.
  const splitting = (ssr: boolean | undefined) => options.split === true && ssr !== true && generated !== undefined;
  const placeholder = (locale: string, areas?: string[]) => `__PROSEBOOK_LOCALE_${placeholders.push({ locale, areas }) - 1}__`;

  return {
    name: 'prosebook',

    async configResolved(resolved) {
      building = resolved.command === 'build';
      base = resolved.base;
      viteRoot = resolved.root;
      configRoot = options.root === undefined ? resolved.root : resolve(resolved.root, options.root);
      restarts = !resolved.plugins.some((p) => p.name === ASTRO_PLUGIN);
      config = await loadConfig(configRoot, options.config);
    },

    resolveId(id) {
      if (id === DEV) return DEV_ID;
      if (id.startsWith(AREA)) return AREA_ID + id.slice(AREA.length);
      return null;
    },

    buildStart() {
      try {
        // In dev a broken entry is left out and said, so the rest of the catalog is still served.
        const all = generate(config, { partial: !building });
        generated = building ? withoutPseudo(config, all) : all;
      } catch (e) {
        this.error(describe(e));
      }
      const broken = building ? undefined : brokenIn(generated);
      if (broken !== undefined) this.warn(broken);
      refs = { exact: new Set(), prefixes: new Set() };
      kept = prune === false ? () => true : keeper(refs, options.keep, config.formats);
      reads.clear();
      groups = building && options.split === true && generated !== undefined ? areaGroups(config, generated, options.keep) : new Map();
      placeholders.length = 0;
      shipped.total = shipped.kept = 0;
    },

    configureServer(server) {
      const dirs = [normalize(config.catalog), normalize(config.locales)];
      // The config is loaded by this plugin, not imported by Vite's, so Vite doesn't restart for it itself.
      const configFiles = options.config === undefined && restarts ? CONFIG_FILES.map((name) => normalize(join(configRoot, name))) : [];
      // Vite watches the formatters module, which the index imports, but the names in it are read with the config.
      const formatters = () => (config.formatters === undefined ? undefined : normalize(config.formatters.file));
      server.watcher.add([...dirs, ...configFiles]);
      const onChange = (file: string) => {
        const path = normalize(file);
        if (path === formatters()) {
          loadConfig(configRoot, options.config)
            .then((loaded) => {
              config = loaded;
              regenerate(path);
            })
            .catch((e: unknown) => failed(e));
          return;
        }
        if (configFiles.includes(path)) {
          const logger = server.config.logger;
          logger.info(`prosebook: ${relative(viteRoot, path).replaceAll('\\', '/')} changed, restarting the server`, { timestamp: true });
          // Vite says itself why a restart failed, and keeps the server it had.
          server.restart().catch((e: unknown) => logger.error(describe(e), { timestamp: true }));
          return;
        }
        if (!path.endsWith('.yaml') || !dirs.some((d) => path.startsWith(`${d}/`))) return;
        regenerate(path);
      };
      const failed = (e: unknown) => {
        server.config.logger.error(describe(e), { timestamp: true });
        server.ws.send({ type: 'error', err: { message: describe(e), stack: '', plugin: 'prosebook' } });
      };
      const regenerate = (path: string) => {
        try {
          generated = generate(config, { partial: true });
          // An area's module names the locales, which an edit may have added to.
          for (const [id, mod] of server.moduleGraph.idToModuleMap) if (id.startsWith(AREA_ID)) server.moduleGraph.invalidateModule(mod);
          const broken = brokenIn(generated);
          if (broken !== undefined) throw new Error(broken);
          server.config.logger.info(`prosebook: regenerated from ${relative(config.root, path).replaceAll('\\', '/')}`, {
            timestamp: true,
          });
        } catch (e) {
          failed(e);
        }
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
      if (options.inspect === false) return;

      // Each entry opens through Vite's own `/__open-in-editor`, so the editor is whichever Vite launches.
      const editor = ({ file, line, column }: EntryLocation) =>
        redirect(`${base}__open-in-editor?file=${encodeURIComponent(`${file}:${line}:${column}`)}`);
      // A server render (Astro's, a framework's first frame) runs here, in this process.
      const served = serverReads();
      stopReads.push(served.stop);
      server.middlewares.use(nodeMiddleware(inspectorEndpoints(() => config, { base, open: editor, reads: served.reads })));
    },

    // In dev, once the server closes.
    closeBundle() {
      stopReads.shift()?.();
    },

    load(id, loadOptions) {
      if (id === DEV_ID) {
        if (options.inspect === false) return HOT_SET;
        return HOT_SET + installInspector(inspectorPath, base, options.inspect);
      }
      if (id.startsWith(AREA_ID) && generated !== undefined) {
        const [area = '', locale] = id.slice(AREA_ID.length).split('/');
        if (locale !== undefined) return `export default ${placeholder(locale, membersOf(groups, area))};\n`;
        return areaModule(config, generated, area, building ? (l) => placeholder(l, [area]) : undefined, undefined, groups);
      }
      if (splitting(loadOptions?.ssr) && isIndex(id)) return splitIndex(config, generated!, options.keep);
      if (building && generated !== undefined && isIndex(id)) {
        const index = buildIndex(config, generated);
        if (options.split !== true) return index;
        const path = areaFilesPath(viteRoot);
        if (existsSync(path)) return withAreaFiles(index, readFileSync(path, 'utf8').trim());
        this.warn('no split client build to link area files from: build the client before the server, or `preload` is handed nothing');
        return index;
      }
      if (!building || prune === false || generated === undefined) return null;
      const locale = localeOf(id);
      if (locale === undefined) return null;
      return `export default ${placeholder(locale)};\n`;
    },

    // Before other plugins, so a read is found in the source as written: `<Text id>` still JSX, and
    // the line it is reported at, and its `prosebook-ignore`, where the author wrote them.
    transform: {
      order: 'pre',
      handler(code, id, transformOptions) {
        const ssr = transformOptions?.ssr;
        if (!building) {
          const locale = localeOf(id);
          if (locale !== undefined) return { code: code + hotLocale(locale), map: null };
          if (isIndex(id)) {
            // A server render has no page to inspect, and its copies are made per request.
            const dev = ssr === true ? '' : `import ${JSON.stringify(DEV)};\n`;
            return { code: dev + code + HOT_INDEX, map: null };
          }
          // The index's `Messages` type names every key, and is read here before its types are stripped.
        } else if (localeOf(id) !== undefined || isIndex(id)) {
          return null;
        }
        if (id.includes('/node_modules/') || id.startsWith('\0')) return null;
        const path = id.split('?', 1)[0]!;
        // A component file is read whole, as written; the parts its compiler splits off (`?vue&type=script`) are not again.
        const part = SFC.test(path) && path !== id;
        const own = normalize(path).startsWith(`${ownDir}/`);
        if (building && prune !== false) {
          keyRefs(code, refs);
          if (prune === 'strict' && SCRIPT.test(path) && !part && !own) reads.set(id, unseenReads(path, code));
        }
        // An Astro component runs on the server alone; its `<script>` is a module the browser loads by itself.
        const astro = path.endsWith('.astro');
        const script = astro ? part && /[?&]type=script\b/.test(id) : SCRIPT.test(path) && !part;
        if (!splitting(ssr) || !script || own) return null;
        const areas = areasNamed(code, lazyAreas(generated!, options.keep));
        return areas.length === 0 ? null : { code: importingAreas(code, path, areas), map: null };
      },
    },

    buildEnd(error) {
      if (error !== undefined || prune !== 'strict') return;
      const live = new Set(this.getModuleIds());
      const unseen = unseenOf([...reads].filter(([id]) => live.has(id)).map(([, r]) => r));
      if (unseen.length > 0) this.error(unseenMessage(unseen, viteRoot));
    },

    renderChunk(code) {
      if (!code.includes('__PROSEBOOK_LOCALE_') || generated === undefined) return null;
      const entries = generated.entries;
      const replaced = code.replace(PLACEHOLDER, (_match, index: string) => {
        const { locale, areas } = placeholders[Number(index)]!;
        const all = entries.get(locale) ?? [];
        const list = areas === undefined ? all : inAreas(all, areas);
        const compiled = compileLocale(list, kept);
        shipped.total += list.length;
        shipped.kept += compiled.rows.length;
        return localeExpression(compiled);
      });
      return { code: replaced, map: null };
    },

    generateBundle(_output, bundle) {
      if (building && options.split === true && this.environment.config.consumer === 'client') {
        // Each lazy locale's part of a group, for the areas in it that locale translates.
        const parts: [string, string, string][] = [];
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk' || chunk.facadeModuleId?.startsWith(AREA_ID) !== true) continue;
          const [lead = '', locale] = chunk.facadeModuleId.slice(AREA_ID.length).split('/');
          if (locale !== undefined) parts.push([lead, locale, base + chunk.fileName]);
        }
        const files = areaFilesOf(generated!, groups, parts);
        writeFiles(new Map([[areaFilesPath(viteRoot), `${JSON.stringify(files, null, 2)}\n`]]));
      }
      if (shipped.total === 0) return;
      const locales = new Set(placeholders.map((p) => p.locale)).size;
      const pruned = prune === false ? '' : `; pruned ${shipped.total - shipped.kept} no code names`;
      this.info(`shipped ${shipped.kept} of ${shipped.total} messages across ${locales} locale(s)${pruned}`);
    },
  };
}

export default prosebook;
