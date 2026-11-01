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
 * page only when a locale was added or removed. The page also gets the inspector (`inspector.ts`), and
 * the server opens the entry it asks for through Vite's own `/__open-in-editor`, so the editor is
 * whichever Vite already launches.
 */
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin } from 'vite';

import { CatalogError, entryLocation } from './tools/catalog.ts';
import { compileLocale, localeExpression } from './tools/compile.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from './tools/config.ts';
import { editEntry, readEntry, type EntryEdit } from './tools/entry.ts';
import { generate, type Generated } from './tools/generate.ts';
import { isReferenced, keyRefs, READERS, unseenReads, type KeyRefs, type Reads } from './tools/scan.ts';

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
  prune?: 'strict' | 'loose' | false;
  /** Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
  /** In dev, Alt-click a string on the page to open its entry in the editor. On by default. */
  inspect?: boolean;
}

const PLACEHOLDER = /__PROSEBOOK_LOCALE_(\d+)__/g;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const DEV_ID = '\0prosebook/dev';

const hotLocale = (locale: string) => `
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    const hot = globalThis.__PROSEBOOK_HOT__;
    if (next === undefined || hot === undefined) return import.meta.hot.invalidate();
    for (const update of hot) update(${JSON.stringify(locale)}, next.default);
  });
}
`;

const HOT_INDEX = `
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    if (next === undefined || next.catalog.locales.join() !== catalog.locales.join()) import.meta.hot.invalidate();
  });
}
`;

const normalize = (path: string) => resolve(path).replaceAll('\\', '/');

// Beside this module: the source when run from source, the built file in dist.
const inspectorPath = normalize(fileURLToPath(new URL(`./inspector${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url)));
// prosebook's own modules, which read keys handed to them: `<Text>` calls `rich(props.id)`.
const ownDir = normalize(fileURLToPath(new URL('.', import.meta.url)));

export function prosebook(options: ProsebookPluginOptions = {}): Plugin {
  let config: ResolvedConfig;
  let generated: Generated | undefined;
  let building = false;
  let base = '/';
  let viteRoot = '';
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

  const kept = (key: string) =>
    isReferenced(key, refs) || (options.keep ?? []).some((k) => (k.endsWith('.*') ? key.startsWith(k.slice(0, -1)) : k === key));

  return {
    name: 'prosebook',

    async configResolved(resolved) {
      building = resolved.command === 'build';
      base = resolved.base;
      viteRoot = resolved.root;
      config = await loadConfig(options.root === undefined ? resolved.root : resolve(resolved.root, options.root), options.config);
    },

    // First in <head>, so the hot hooks are there before any copy is created.
    transformIndexHtml() {
      if (building) return [];
      return [{ tag: 'script', attrs: { type: 'module', src: `${base}@id/__x00__prosebook/dev` }, injectTo: 'head-prepend' }];
    },

    resolveId(id) {
      return id === DEV_ID ? id : null;
    },

    buildStart() {
      try {
        generated = generate(config);
      } catch (e) {
        this.error(describe(e));
      }
      refs = { exact: new Set(), prefixes: new Set() };
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

      // `?key=cart.items&locale=de`: the translation's entry, or the catalog's with `catalog` or when
      // the locale has none. Handed on to Vite's `/__open-in-editor`, which comes later in the stack.
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== `${base}__prosebook/open`) return next();
        const key = url.searchParams.get('key') ?? '';
        const message = generated?.catalog.messages.find((m) => m.key === key);
        if (message === undefined) {
          res.statusCode = 404;
          res.end(`no entry for "${key}" in the catalog: has it been renamed since the page loaded?`);
          return;
        }
        const locale = url.searchParams.has('catalog') ? undefined : (url.searchParams.get('locale') ?? undefined);
        const { file, line, column } = entryLocation(config, message, locale);
        req.url = `${base}__open-in-editor?file=${encodeURIComponent(`${file}:${line}:${column}`)}`;
        next();
      });

      // The inspector's dialog: GET `?key=…` reads an entry in every locale, POST `{ key, edit, write }`
      // applies an edit (`tools/entry.ts`). A POST writes files, so only the page itself may send one:
      // same origin, and JSON, which a form on another site can't send without asking first.
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== `${base}__prosebook/entry`) return next();
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const fail = (e: unknown) =>
          reply(e instanceof CatalogError ? 409 : 400, {
            problems: e instanceof CatalogError ? e.problems : [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }],
          });
        if (req.method === 'GET') {
          try {
            reply(200, readEntry(config, url.searchParams.get('key') ?? ''));
          } catch (e) {
            fail(e);
          }
          return;
        }
        const origin = req.headers.origin;
        const sameOrigin = origin === undefined || new URL(origin).host === req.headers.host;
        if (req.method !== 'POST' || !sameOrigin || req.headers['content-type']?.startsWith('application/json') !== true) {
          reply(403, { problems: [{ severity: 'error', message: 'edits come from the page, as JSON' }] });
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', () => {
          try {
            const { key, edit, write } = JSON.parse(body) as { key: string; edit: EntryEdit; write?: boolean };
            const result = editEntry(config, key, edit, write === true);
            reply(result.problems.length > 0 ? 422 : 200, result);
          } catch (e) {
            fail(e);
          }
        });
      });
    },

    load(id) {
      if (id === DEV_ID) {
        const hot = 'globalThis.__PROSEBOOK_HOT__ ??= new Set();\n';
        if (options.inspect === false) return hot;
        return `import { install } from ${JSON.stringify(inspectorPath)};\n${hot}install(${JSON.stringify({ base })});\n`;
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
      handler(code, id) {
        if (!building) {
          const locale = localeOf(id);
          if (locale !== undefined) return { code: code + hotLocale(locale), map: null };
          return isIndex(id) ? { code: code + HOT_INDEX, map: null } : null;
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
      const all = [...reads].filter(([id]) => live.has(id)).map(([, r]) => r);
      const readers = new Set([...READERS, ...all.flatMap((r) => [...r.aliases])]);
      const unseen = all.flatMap((r) => r.unseen).filter((u) => u.name === 'Text' || readers.has(u.name));
      if (unseen.length === 0) return;
      const at = (file: string) => relative(viteRoot, file).replaceAll('\\', '/');
      this.error(
        [
          `${unseen.length} read(s) whose key the build can't see, so their messages would be pruned and the key shown instead:`,
          ...unseen.map((u) => `  ${at(u.file)}:${u.line}:${u.column}  ${u.code}`),
          'Write each key at the read, as a literal or `area.${id}`; or, where every key it reads is written elsewhere or listed in `keep`, mark the line `prosebook-ignore`. `prune: "loose"` turns this check off.',
        ].join('\n'),
      );
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
