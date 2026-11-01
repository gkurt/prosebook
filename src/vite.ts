/**
 * `prosebook/vite`: the catalog as part of the build.
 *
 * Generates on start and again whenever a catalog or translation file changes, so dev never runs on
 * stale modules and a broken entry shows in the error overlay. A build ships only the messages the
 * code names: each locale module is swapped for its messages less the keys no module references
 * (see `tools/scan.ts` for how a reference is found, and why it errs towards keeping).
 *
 * In dev an edit doesn't reload the page: each generated locale module accepts its own update and
 * hands the new messages to every copy (`HotHook`), which re-renders in the locale and state it was in.
 * The index accepts its own too, since its doc comments change with the source text, and reloads the
 * page only when a locale was added or removed. In the browser the index imports the dev module first,
 * which sets up the hooks and the inspector (`inspector.ts`) before any copy exists, so frameworks that
 * render their own HTML (TanStack Start, React Router) get them too. The server opens the entry the
 * inspector asks for through Vite's own `/__open-in-editor`, so the editor is whichever Vite already
 * launches.
 */
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

import { beside, HOT_INDEX, HOT_SET, hotLocale, installInspector, keeper, unseenMessage, unseenOf, type Prune } from './tools/bundle.ts';
import { CatalogError, type EntryLocation } from './tools/catalog.ts';
import { compileLocale, localeExpression } from './tools/compile.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { inspectorEndpoints, nodeMiddleware, redirect } from './tools/endpoints.ts';
import { generate, type Generated } from './tools/generate.ts';
import { keyRefs, unseenReads, type KeyRefs, type Reads } from './tools/scan.ts';

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
  /** Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
  /** In dev, Alt-click a string on the page to open its entry in the editor. On by default. */
  inspect?: boolean;
}

const PLACEHOLDER = /__PROSEBOOK_LOCALE_(\d+)__/g;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const DEV = 'virtual:prosebook/dev';
const DEV_ID = '\0prosebook/dev';

const normalize = (path: string) => resolve(path).replaceAll('\\', '/');

const inspectorPath = beside(import.meta.url, 'inspector');
// prosebook's own modules, which read keys handed to them: `<Text>` calls `rich(props.id)`.
const ownDir = normalize(fileURLToPath(new URL('.', import.meta.url)));

export function prosebook(options: ProsebookPluginOptions = {}): Plugin {
  let config: ResolvedConfig;
  let generated: Generated | undefined;
  let building = false;
  let base = '/';
  let viteRoot = '';
  let kept: (key: string) => boolean = () => true;
  let refs: KeyRefs = { exact: new Set(), prefixes: new Set() };
  const reads = new Map<string, Reads>();
  const prune = options.prune ?? 'strict';
  const placeholders: string[] = [];
  const shipped = { total: 0, kept: 0 };

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

  return {
    name: 'prosebook',

    async configResolved(resolved) {
      building = resolved.command === 'build';
      base = resolved.base;
      viteRoot = resolved.root;
      config = await loadConfig(options.root === undefined ? resolved.root : resolve(resolved.root, options.root), options.config);
    },

    resolveId(id) {
      return id === DEV ? DEV_ID : null;
    },

    buildStart() {
      try {
        generated = generate(config);
      } catch (e) {
        this.error(describe(e));
      }
      refs = { exact: new Set(), prefixes: new Set() };
      kept = keeper(refs, options.keep);
      reads.clear();
      placeholders.length = 0;
      shipped.total = shipped.kept = 0;
    },

    configureServer(server) {
      const dirs = [normalize(config.catalog), normalize(config.locales)];
      server.watcher.add(dirs);
      const onChange = (file: string) => {
        const path = normalize(file);
        if (!path.endsWith('.yaml') || !dirs.some((d) => path.startsWith(`${d}/`))) return;
        try {
          generated = generate(config);
          server.config.logger.info(`prosebook: regenerated from ${relative(config.root, path).replaceAll('\\', '/')}`, {
            timestamp: true,
          });
        } catch (e) {
          server.config.logger.error(describe(e), { timestamp: true });
          server.ws.send({ type: 'error', err: { message: describe(e), stack: '', plugin: 'prosebook' } });
        }
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
      if (options.inspect === false) return;

      // Each entry opens through Vite's own `/__open-in-editor`, so the editor is whichever Vite launches.
      const editor = ({ file, line, column }: EntryLocation) =>
        redirect(`${base}__open-in-editor?file=${encodeURIComponent(`${file}:${line}:${column}`)}`);
      server.middlewares.use(nodeMiddleware(inspectorEndpoints(config, { base, open: editor })));
    },

    load(id) {
      if (id === DEV_ID) {
        if (options.inspect === false) return HOT_SET;
        return HOT_SET + installInspector(inspectorPath, base);
      }
      if (!building || prune === false || generated === undefined) return null;
      const locale = localeOf(id);
      if (locale === undefined) return null;
      placeholders.push(locale);
      return `export default __PROSEBOOK_LOCALE_${placeholders.length - 1}__;\n`;
    },

    // Before other plugins, so a read is found in the source as written: `<Text id>` still JSX, and
    // the line it is reported at, and its `prosebook-ignore`, where the author wrote them.
    transform: {
      order: 'pre',
      handler(code, id, transformOptions) {
        if (!building) {
          const locale = localeOf(id);
          if (locale !== undefined) return { code: code + hotLocale(locale), map: null };
          if (!isIndex(id)) return null;
          // A server render has no page to inspect, and its copies are made per request.
          const dev = transformOptions?.ssr === true ? '' : `import ${JSON.stringify(DEV)};\n`;
          return { code: dev + code + HOT_INDEX, map: null };
        }
        if (prune === false || id.includes('/node_modules/') || id.startsWith('\0')) return null;
        // The index's `Messages` type names every key, and is read here before its types are stripped.
        if (localeOf(id) !== undefined || isIndex(id)) return null;
        keyRefs(code, refs);
        const path = id.split('?', 1)[0]!;
        if (prune === 'strict' && SCRIPT.test(path) && !normalize(path).startsWith(`${ownDir}/`)) reads.set(id, unseenReads(path, code));
        return null;
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
        const locale = placeholders[Number(index)]!;
        const list = entries.get(locale) ?? [];
        const compiled = compileLocale(list, kept);
        shipped.total += list.length;
        shipped.kept += compiled.rows.length;
        return localeExpression(compiled);
      });
      return { code: replaced, map: null };
    },

    generateBundle() {
      if (shipped.total === 0) return;
      this.info(
        `shipped ${shipped.kept} of ${shipped.total} messages across ${placeholders.length} locale(s); pruned ${shipped.total - shipped.kept} no code names`,
      );
    },
  };
}

export default prosebook;
