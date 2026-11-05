/**
 * `prosebook/astro`: the Vite plugin (`vite.ts`) in an Astro app, and the inspector on every page.
 *
 * Astro renders a page on the server and may send it with no script at all, so nothing in the browser
 * imports the generated index, which is what loads the dev module (the hooks and the inspector) under
 * Vite. The integration injects that module into every page in dev instead. The page's text was read
 * on the server, in the dev server's own process, and reaches the inspector from there
 * (`serverReads` in `tools/endpoints.ts`).
 *
 * An edit regenerates the modules. Astro reloads the page for a module only the server imports, but
 * leaves one the browser imports too to the browser's hot update, which re-renders the copies there and
 * not the HTML the server wrote. So a generated module's update on the server reloads the page,
 * once the server has dropped what it ran, as Astro does for its own.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';
import type { EnvironmentModuleNode, Plugin } from 'vite';

import { ASTRO_PLUGIN, DEV } from './tools/bundle.ts';
import { CONFIG_FILES, loadConfig } from './tools/config.ts';
import { prosebook as vitePlugin, type ProsebookPluginOptions } from './vite.ts';

export type { ProsebookPluginOptions as ProsebookIntegrationOptions };

export function prosebook(options: ProsebookPluginOptions = {}): AstroIntegration {
  return {
    name: 'prosebook',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, injectScript, addWatchFile }) => {
        updateConfig({ vite: { plugins: [vitePlugin(options), reloadOnEdit(options)] } });
        // Astro restarts for these as for its own config: the dev server whole, with the edit.
        const root = resolve(fileURLToPath(config.root), options.root ?? '.');
        if (options.config === undefined) for (const name of CONFIG_FILES) addWatchFile(join(root, name));
        if (command === 'dev' && options.inspect !== false) injectScript('page', `import ${JSON.stringify(DEV)};`);
      },
    },
  };
}

export default prosebook;

const normalize = (path: string) => resolve(path).replaceAll('\\', '/');

/** A module runner's cache of what it ran, which Vite's types name only on a runnable environment. */
interface Runner {
  evaluatedModules: { getModuleById(id: string): unknown; invalidateModule(mod: never): void };
}

function reloadOnEdit(options: ProsebookPluginOptions): Plugin {
  let out = '';
  return {
    name: ASTRO_PLUGIN,
    apply: 'serve',
    async configResolved(resolved) {
      const config = await loadConfig(options.root === undefined ? resolved.root : resolve(resolved.root, options.root), options.config);
      out = `${normalize(config.out)}/`;
    },
    hotUpdate({ file, modules, server, timestamp }) {
      if (this.environment.config.consumer !== 'server' || !normalize(file).startsWith(out)) return;
      const invalidated = new Set<EnvironmentModuleNode>();
      for (const mod of modules) this.environment.moduleGraph.invalidateModule(mod, invalidated, timestamp, true);
      // The importers too, or the page module still holds the copy that read the old messages.
      const runner = (this.environment as { runner?: Runner }).runner;
      for (const mod of invalidated) {
        const ran = mod.id === null ? undefined : runner?.evaluatedModules.getModuleById(mod.id);
        if (ran !== undefined) runner!.evaluatedModules.invalidateModule(ran as never);
      }
      // A runner elsewhere (Cloudflare's workerd) drops what it ran when told to reload.
      if (runner === undefined) this.environment.hot.send({ type: 'full-reload', path: '*' });
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
