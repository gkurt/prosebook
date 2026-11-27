/**
 * `prosebook/deictic`: the copy inspector, as a deictic plugin (https://github.com/gkurt/deictic). Point at
 * an element with deictic's shortcut and its Copy tab edits the catalog entries its text comes from; hold the
 * keys and the string under the pointer shows its key. prosebook's integrations add it with deictic themselves
 * (`inspect`, `register.ts`), and an app that lists deictic itself may list it there, with options of its own.
 *
 * The server half reads source and writes nothing itself: `apply` turns an edit into each catalog file's new
 * text, which deictic writes, so it lands in deictic's history beside every other plugin's and undoes the
 * same way. The entry, a check of an edit as it's typed, where an entry is and what the server's renders
 * read are routes the page half asks (`routes.ts`, `client.ts`).
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { Refusal, type ServerPlugin, type Shortcut, type TextEdit } from 'deictic';

import type { DevHooks, ReadHook } from '#src/runtime/types.ts';
import { loadConfig, type ProsebookConfig, type ResolvedConfig } from '#src/tools/config.ts';

import { record, type Reads } from './reads.ts';
import { copyRoutes, editsOf, type EntryEdit } from './routes.ts';

export type { Read } from './reads.ts';
export type { EntryEdit, Place } from './routes.ts';

export interface ProsebookPluginOptions {
  /** The folder the prosebook config is in, from deictic's root or absolute: deictic's root unset. */
  root?: string;
  /** The config itself, in place of the folder's config file. */
  config?: ProsebookConfig;
  /** What opens the Copy tab directly, as a deictic shortcut: none unset, so deictic's own opens it at the tab used last. */
  shortcut?: Shortcut;
}

export function prosebook(options: ProsebookPluginOptions = {}): ServerPlugin<null, EntryEdit> {
  let root = '';
  let configOf: () => Promise<ResolvedConfig> = () => Promise.reject(new Error('prosebook: the plugin is not set up yet'));
  let reads: Reads = new Map();
  const routes = copyRoutes(
    () => configOf(),
    (path) => fromRoot(root, path),
    () => reads,
  );

  return {
    name: 'prosebook',
    client: 'prosebook/deictic/client',
    ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
    setup(context) {
      root = context.root;
      const folder = resolve(context.root, options.root ?? '.');
      // Loaded at each request: anew once the config file changed, as it is everywhere else.
      configOf = () => loadConfig(folder, options.config);
      reads = serverReads();
    },
    routes: { entry: routes.entry, place: routes.place, reads: routes.reads },
    async apply(_source, _target, edit) {
      const files = editsOf(await configOf(), edit);
      if (typeof files === 'string') throw new Refusal(files);
      // Each file whole: deictic writes it, and undo puts it back as it was, or takes away a file the edit made.
      return [...files].map(([path, text]): TextEdit => ({ file: fromRoot(root, path), start: 0, end: existing(path)?.length ?? 0, text }));
    },
    describe: ({ key }) => key,
  };
}

/** A file as it is now, or nothing where it isn't there yet. */
function existing(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** A path from deictic's root, which writes and opens nothing outside it. */
function fromRoot(root: string, path: string): string {
  const file = relative(root, path).replaceAll('\\', '/');
  if (file.startsWith('..') || isAbsolute(file))
    throw new Refusal(`${path} is outside deictic's root, ${root}: give deictic a root that holds the catalog`);
  return file;
}

/**
 * Starts recording what every copy in this process reads, as the page does: a dev server rendering pages in
 * its own process (Vite's, Astro's) hands these to the page half, so text only the server read can be traced
 * too. The process's one record, however many plugins ask, kept for as long as it runs.
 */
export function serverReads(): Reads {
  const hooks = globalThis as DevHooks & { __PROSEBOOK_SERVED__?: { reads: Reads; hook: ReadHook } };
  let served = hooks.__PROSEBOOK_SERVED__;
  if (served === undefined) {
    const reads: Reads = new Map();
    served = hooks.__PROSEBOOK_SERVED__ = { reads, hook: (key, text, locale) => record(reads, key, text, locale) };
  }
  hooks.__PROSEBOOK_READ__ ??= served.hook;
  return served.reads;
}

export default prosebook;
