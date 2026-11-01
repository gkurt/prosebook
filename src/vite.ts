/**
 * `copydeck/vite`: the catalog as part of the build.
 *
 * Generates on start and again whenever a catalog or translation file changes, so dev never runs on
 * stale modules and a broken entry shows in the error overlay. A build ships only the messages the
 * code names: each locale module is swapped for its messages less the keys no module references
 * (see `tools/scan.ts` for how a reference is found, and why it errs towards keeping).
 */
import { resolve } from 'node:path';

import type { Plugin } from 'vite';

import { CatalogError } from './tools/catalog.ts';
import { compileLocale, localeExpression } from './tools/compile.ts';
import { loadConfig, type CopydeckConfig, type ResolvedConfig } from './tools/config.ts';
import { generate, type Generated } from './tools/generate.ts';
import { isReferenced, keyRefs, type KeyRefs } from './tools/scan.ts';

export interface CopydeckPluginOptions {
  /** The config, inline. Without it, `copydeck.config.*` at the Vite root is read. */
  config?: CopydeckConfig;
  /** Ship only the messages the code names. On by default. */
  prune?: boolean;
  /** Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
}

const PLACEHOLDER = /__COPYDECK_LOCALE_(\d+)__/g;

const normalize = (path: string) => resolve(path).replaceAll('\\', '/');

export function copydeck(options: CopydeckPluginOptions = {}): Plugin {
  let config: ResolvedConfig;
  let generated: Generated | undefined;
  let building = false;
  let refs: KeyRefs = { exact: new Set(), prefixes: new Set() };
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

  const kept = (key: string) =>
    isReferenced(key, refs) || (options.keep ?? []).some((k) => (k.endsWith('.*') ? key.startsWith(k.slice(0, -1)) : k === key));

  return {
    name: 'copydeck',

    async configResolved(resolved) {
      building = resolved.command === 'build';
      config = await loadConfig(resolved.root, options.config);
    },

    buildStart() {
      try {
        generated = generate(config);
      } catch (e) {
        this.error(describe(e));
      }
      refs = { exact: new Set(), prefixes: new Set() };
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
          server.config.logger.info(`copydeck: regenerated from ${path.slice(normalize(config.root).length + 1)}`, { timestamp: true });
        } catch (e) {
          server.config.logger.error(describe(e), { timestamp: true });
          server.ws.send({ type: 'error', err: { message: describe(e), stack: '', plugin: 'copydeck' } });
        }
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },

    load(id) {
      if (!building || options.prune === false || generated === undefined) return null;
      const locale = localeOf(id);
      if (locale === undefined) return null;
      placeholders.push(locale);
      return `export default __COPYDECK_LOCALE_${placeholders.length - 1}__;\n`;
    },

    transform(code, id) {
      if (!building || options.prune === false || id.includes('/node_modules/') || id.startsWith('\0')) return null;
      if (localeOf(id) !== undefined) return null;
      keyRefs(code, refs);
      return null;
    },

    renderChunk(code) {
      if (!code.includes('__COPYDECK_LOCALE_') || generated === undefined) return null;
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

export default copydeck;
