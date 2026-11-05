/**
 * The dev server's half of the inspector (`inspector.ts`, `inspector-dialog.ts`): `__prosebook/open`,
 * which opens an entry in the editor, `__prosebook/entry`, which reads and edits one, and, where the
 * server renders in this process, `__prosebook/reads`, what those renders read. Written over
 * `Request` and `Response`, so each integration mounts them its own way: Vite as middleware, Bun as
 * `Bun.serve` routes, Next behind a rewrite to a server of their own. Each opens the editor its dev
 * server already launches.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { DevHooks, ReadHook } from '#src/runtime/types.ts';

import { record, type Reads } from '#src/reads.ts';

import { CatalogError, entryLocation, loadCatalog, type EntryLocation } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { editEntry, readEntry, type EntryEdit } from './entry.ts';

export interface EndpointOptions {
  /** The path the endpoints sit under, ending in `/`: `/` by default. */
  base?: string;
  /** Opens an entry in the editor: a redirect to the dev server's own launcher, or a reply once it has. */
  open: (at: EntryLocation) => Response | Promise<Response>;
  /** What server renders in this process read (`serverReads`), for text the browser never read. */
  reads?: Reads;
}

/** Answers the inspector's requests, and nothing for any other path, under the config `config` gives then. */
export function inspectorEndpoints(
  config: () => ResolvedConfig | Promise<ResolvedConfig>,
  { base = '/', open, reads }: EndpointOptions,
): (req: Request) => Promise<Response | undefined> {
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === `${base}__prosebook/reads`) return Response.json(reads === undefined ? [] : [...reads]);
    if (url.pathname === `${base}__prosebook/open`) return openEntry(await config(), url, open);
    if (url.pathname === `${base}__prosebook/entry`) return entry(await config(), req, url);
    return undefined;
  };
}

/**
 * `?key=cart.items&locale=de`: the translation's entry, or the catalog's with `catalog` or when the
 * locale has none. Read from disk, so a key added since the page loaded is found.
 */
async function openEntry(config: ResolvedConfig, url: URL, open: EndpointOptions['open']): Promise<Response> {
  const key = url.searchParams.get('key') ?? '';
  let message;
  try {
    message = loadCatalog(config, undefined, { partial: true }).messages.find((m) => m.key === key);
  } catch (e) {
    return failed(e);
  }
  if (message === undefined)
    return new Response(`no entry for "${key}" in the catalog: has it been renamed since the page loaded?`, { status: 404 });
  const locale = url.searchParams.has('catalog') ? undefined : (url.searchParams.get('locale') ?? undefined);
  return open(entryLocation(config, message, locale));
}

/**
 * The inspector's dialog: GET `?key=…` reads an entry in every locale, POST `{ key, edit, write }`
 * applies an edit (`entry.ts`). A POST writes files, so only the page itself may send one: same origin,
 * and JSON, which a form on another site can't send without asking first.
 */
async function entry(config: ResolvedConfig, req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') {
    try {
      return Response.json(readEntry(config, url.searchParams.get('key') ?? ''));
    } catch (e) {
      return failed(e);
    }
  }
  const origin = req.headers.get('origin');
  const sameOrigin = origin === null || new URL(origin).host === url.host;
  if (req.method !== 'POST' || !sameOrigin || req.headers.get('content-type')?.startsWith('application/json') !== true)
    return Response.json({ problems: [{ severity: 'error', message: 'edits come from the page, as JSON' }] }, { status: 403 });
  try {
    const { key, edit, write } = (await req.json()) as { key: string; edit: EntryEdit; write?: boolean };
    const result = editEntry(config, key, edit, write === true);
    return Response.json(result, { status: result.problems.length > 0 ? 422 : 200 });
  } catch (e) {
    return failed(e);
  }
}

/**
 * Starts recording what every copy in this process reads, as the browser's inspector does on the page:
 * a dev server rendering pages in its own process (Vite's, Astro's) hands these to the inspector, so
 * text only the server read can be traced too. The process's one record, however many servers ask,
 * which stops once the last of them has.
 */
export function serverReads(): { reads: Reads; stop: () => void } {
  const hooks = globalThis as DevHooks & { __PROSEBOOK_SERVED__?: Served };
  let served = hooks.__PROSEBOOK_SERVED__;
  if (served === undefined) {
    const reads: Reads = new Map();
    served = hooks.__PROSEBOOK_SERVED__ = { reads, servers: 0, hook: (key, text, locale) => record(reads, key, text, locale) };
  }
  served.servers += 1;
  hooks.__PROSEBOOK_READ__ ??= served.hook;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if ((served.servers -= 1) > 0) return;
    delete hooks.__PROSEBOOK_SERVED__;
    if (hooks.__PROSEBOOK_READ__ === served.hook) delete hooks.__PROSEBOOK_READ__;
  };
  return { reads: served.reads, stop };
}

interface Served {
  reads: Reads;
  servers: number;
  hook: ReadHook;
}

/** A redirect within the page's origin, to a launcher the dev server answers itself. */
export const redirect = (path: string) => new Response(null, { status: 307, headers: { Location: path } });

function failed(e: unknown): Response {
  return Response.json(
    { problems: e instanceof CatalogError ? e.problems : [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }] },
    { status: e instanceof CatalogError ? 409 : 400 },
  );
}

/**
 * The endpoints as Node middleware, for Vite's server and Next's. The request's host is the one the
 * page was served from: a proxy's `x-forwarded-host`, as Next's rewrite sets, before its own.
 */
export function nodeMiddleware(
  handle: (req: Request) => Promise<Response | undefined>,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    // Before reading the body, which a request for anything else leaves to whoever answers it.
    if (req.url?.includes('/__prosebook/') !== true) return next();
    const forwarded = req.headers['x-forwarded-host'];
    const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host ?? 'localhost';
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, v);

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
      handle(new Request(`http://${host}${req.url}`, { method: req.method, headers, body }))
        .then(async (response) => {
          if (response === undefined) return next();
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch((e: unknown) => {
          res.statusCode = 500;
          res.end(e instanceof Error ? e.message : String(e));
        });
    });
  };
}
