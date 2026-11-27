/**
 * The Copy tab's routes, over `Request` and `Response`: what the plugin's server half serves under deictic's
 * endpoints (`index.ts`), and the playground's standalone answers in a page with no dev server. Nothing of
 * deictic's is imported, so the playground's browser build carries none of it.
 */
import { CatalogError, entryLocation, loadCatalog, type Problem } from '#src/tools/catalog.ts';
import type { ResolvedConfig } from '#src/tools/config.ts';
import { editEntry, readEntry, type EntryFields } from '#src/tools/entry.ts';

import type { Reads } from './reads.ts';

/** An edit to an entry, as the Copy tab sends it. */
export interface EntryEdit {
  key: string;
  fields: EntryFields;
}

/** Where an entry is written, from deictic's root, for its `open` endpoint. */
export interface Place {
  file: string;
  line: number;
  column: number;
}

/**
 * The config, at once where it is at hand: the playground's files are in memory only until its next call, so
 * nothing may run between loading them and reading them.
 */
export type ConfigOf = () => ResolvedConfig | Promise<ResolvedConfig>;

/** `then` with the config, in the same turn where it is at hand. */
const withConfig = <T>(configOf: ConfigOf, then: (config: ResolvedConfig) => T): T | Promise<T> => {
  const config = configOf();
  return config instanceof Promise ? config.then(then) : then(config);
};

export interface CopyRoutes {
  /** GET `?key=`: the entry in every locale. POST an `EntryEdit`: the view with it, or why it can't be saved. */
  entry: (req: Request) => Promise<Response>;
  /** GET `?key=&locale=`: where the entry is written in that locale, a `Place`. */
  place: (req: Request) => Promise<Response>;
  /** GET: what the server's renders read. */
  reads: () => Response;
}

/** The routes, over the config `configOf` gives; `fromRoot` writes a file's path as deictic's root has it. */
export function copyRoutes(configOf: ConfigOf, fromRoot: (path: string) => string, reads: () => Reads): CopyRoutes {
  return {
    async entry(req) {
      try {
        if (req.method === 'GET') {
          const key = new URL(req.url).searchParams.get('key') ?? '';
          return Response.json(await withConfig(configOf, (config) => readEntry(config, key)));
        }
        // Read before the config is asked for, so the check is made in the same turn as the files are loaded.
        const { key, fields } = (await req.json()) as EntryEdit;
        const { view, problems } = await withConfig(configOf, (config) => editEntry(config, key, fields));
        return Response.json(view === undefined ? { problems } : { view, problems }, { status: problems.length > 0 ? 422 : 200 });
      } catch (e) {
        return failed(e);
      }
    },
    async place(req) {
      const query = new URL(req.url).searchParams;
      const key = query.get('key') ?? '';
      try {
        return await withConfig(configOf, (config) => {
          const message = loadCatalog(config, undefined, { partial: true }).messages.find((m) => m.key === key);
          if (message === undefined)
            return new Response(`no entry for "${key}" in the catalog: has it been renamed since the page loaded?`, { status: 404 });
          const { file, line, column } = entryLocation(config, message, query.get('locale') ?? undefined);
          return Response.json({ file: fromRoot(file), line, column } satisfies Place);
        });
      } catch (e) {
        return failed(e);
      }
    },
    reads: () => Response.json([...reads()]),
  };
}

/** An edit's files as their new text, by absolute path, or why it can't be made, said as one message. */
export function editsOf(config: ResolvedConfig, { key, fields }: EntryEdit): Map<string, string> | string {
  const { problems, files } = editEntry(config, key, fields);
  if (problems.length > 0) return problems.map((p) => (p.file === undefined ? p.message : `${p.file}: ${p.message}`)).join('\n');
  if (files.size === 0) return 'nothing to change: the catalog already says that';
  return files;
}

function failed(e: unknown): Response {
  const problems: Problem[] =
    e instanceof CatalogError ? e.problems : [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }];
  return Response.json({ problems }, { status: e instanceof CatalogError ? 409 : 400 });
}
