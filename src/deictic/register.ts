/**
 * How prosebook's integrations add the copy inspector: each hands deictic, through deictic's integration for its
 * bundler, the prosebook plugin with `defaults: true`, so an app that has deictic itself merges it into its own
 * (its shortcut, and its own `prosebook()` with options, win). deictic is an optional peer: without it there is
 * no inspector, and the dev server says how to have one.
 *
 * Imports nothing of deictic's or the plugin's until it's asked, as the integrations load where deictic isn't.
 */
import type { ServerPlugin, Shortcut } from 'deictic';

import type { ProsebookPluginOptions } from './index.ts';

/** An integration's `inspect`: off, on, or on with the shortcut that opens the Copy tab directly. */
export type Inspect = boolean | { shortcut?: Shortcut };

export const NO_DEICTIC =
  'prosebook: install deictic to edit copy on the page (npm install -D deictic), or set `inspect: false` to say nothing';

/**
 * The prosebook plugin, for the integration's config (its folder from deictic's root, or the config inline), or
 * nothing: `inspect` is off, or deictic isn't installed.
 */
export async function copyInspector(
  inspect: Inspect | undefined,
  from: Omit<ProsebookPluginOptions, 'shortcut'>,
): Promise<ServerPlugin | undefined> {
  if (inspect === false || !(await installed())) return undefined;
  const { prosebook } = await import('./index.ts');
  const defined = Object.fromEntries(Object.entries(from).filter(([, v]) => v !== undefined));
  return prosebook({ ...defined, ...(typeof inspect === 'object' ? inspect : {}) });
}

/** deictic's options for the plugin, as an integration adds it beside the app's own. */
export const added = (plugin: ServerPlugin) => ({ defaults: true, plugins: [plugin] });

async function installed(): Promise<boolean> {
  try {
    await import('deictic');
    return true;
  } catch {
    return false;
  }
}

/**
 * The code each integration's dev module starts with in the browser: the record of reads (`reads.ts`, imported
 * from `path`), there before any copy reads.
 */
export const recordReads = (path: string) => `import { listen as listenForReads } from ${JSON.stringify(path)};\nlistenForReads();\n`;
