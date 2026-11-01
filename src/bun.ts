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
 * locale module accepts its own update and hands the new messages to every copy, as under Vite.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { BunPlugin } from 'bun';

import {
  HOT_INDEX,
  HOT_SET,
  hotLocale,
  keeper,
  prunedModule,
  scanSources,
  unseenMessage,
  watchCatalog,
  type Prune,
} from './tools/bundle.ts';
import { CatalogError } from './tools/catalog.ts';
import { loadConfig, type ProsebookConfig } from './tools/config.ts';
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
  /** Keys a build always keeps, exactly or as `prefix.*`: for keys built at runtime from data. */
  keep?: string[];
}

const describe = (e: unknown) => (e instanceof CatalogError ? e.message : e instanceof Error ? (e.stack ?? e.message) : String(e));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function prosebook(options: ProsebookBunOptions = {}): BunPlugin {
  return {
    name: 'prosebook',
    async setup(build) {
      const config = await loadConfig(resolve(options.root ?? process.cwd()), options.config);
      let generated = generate(config);
      // The generated modules, by path as Bun gives it: either separator on Windows.
      const folder = config.out.split(/[\\/]/).map(escape).join('[\\\\/]');
      const filter = new RegExp(`^${folder}[\\\\/][^\\\\/]+\\.[jt]s$`);
      const nameOf = (path: string) => basename(path).replace(/\.[jt]s$/, '');

      if ('entrypoints' in build.config) {
        const prune = options.prune ?? 'strict';
        if (prune === false) return;
        const { refs, unseen } = scanSources(config, prune === 'strict');
        if (unseen.length > 0) throw new Error(unseenMessage(unseen, config.root));
        const kept = keeper(refs, options.keep);
        build.onLoad({ filter }, ({ path }) => {
          const entries = generated.entries.get(nameOf(path));
          return entries === undefined ? undefined : { contents: prunedModule(entries, kept), loader: 'js' };
        });
        return;
      }

      if (process.env.NODE_ENV !== 'production') {
        watchCatalog(config, () => {
          try {
            generated = generate(config);
          } catch (e) {
            console.error(describe(e));
          }
        });
      }
      build.onLoad({ filter }, ({ path }) => {
        const name = nameOf(path);
        const loader = path.endsWith('.ts') ? 'ts' : 'js';
        if (generated.entries.has(name)) return { contents: readFileSync(path, 'utf8') + hotLocale(name), loader };
        return name === 'index' ? { contents: HOT_SET + readFileSync(path, 'utf8') + HOT_INDEX, loader } : undefined;
      });
    },
  };
}

// bunfig.toml names the module, and Bun takes its default export as the plugin.
export default prosebook();
