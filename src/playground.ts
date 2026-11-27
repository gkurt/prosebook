/**
 * `prosebook/playground`: the tools in a browser, over files held in memory. What `generate`, `lint`
 * and `lint --fix` make of a catalog, without a disk or a config file: the homepage's demo runs
 * on it, and so can an editor of your own. It ships built for the browser, `node:` modules replaced by
 * those in `browser/`, `node:fs` by an in-memory volume (`browser/fs.ts`) that every call fills anew.
 */
import { volume } from './browser/fs.ts';
import { copyRoutes, editsOf, type EntryEdit } from './deictic/routes.ts';
import type { Catalog as RuntimeCatalog } from './runtime/copy.ts';
import { CatalogError, loadCatalog, type EntryLocation, type Message, type Problem } from './tools/catalog.ts';
import { resolveConfig, type ProsebookConfig } from './tools/config.ts';
import { applyFixes } from './tools/entry.ts';
import { evaluatedCatalog } from './tools/evaluated.ts';
import { render } from './tools/generate.ts';
import { lint, type Finding } from './tools/lint.ts';

export type { EntryLocation, Finding, Message, Problem, ProsebookConfig };

/** A project's files, by path from its folder: `copy/catalog/cart.yaml`, `copy/locales/de/cart.yaml`. */
export type Files = Record<string, string>;

export interface Played {
  /** What `generate` writes, by path from the project's folder: `src/copy/en.ts`, `src/copy/index.ts`, native targets. */
  generated: Files;
  /** The catalog's problems. An entry or translation with an error is left out of the rest, as in a dev server. */
  problems: Problem[];
  /** The lint's findings, each with its `fix` where it has one, for `fix` to make. */
  findings: Finding[];
  /** Each entry as read: its key, text, arguments and their types. */
  messages: Message[];
  /** The catalog compiled and evaluated, for `createCopy`. */
  catalog: RuntimeCatalog;
}

const ROOT = '/play';

function load(files: Files, config: ProsebookConfig) {
  volume.clear();
  for (const [path, content] of Object.entries(files)) volume.set(`${ROOT}/${path}`, content);
  return resolveConfig(ROOT, config);
}

const fromRoot = (path: string) => path.slice(ROOT.length + 1);

/** A thrown problem, such as a native target refusing a message, as the problems it names. */
const problemsOf = (e: unknown): Problem[] =>
  e instanceof CatalogError ? e.problems : [{ severity: 'error', message: e instanceof Error ? e.message : String(e) }];

/** Generates and lints `files` with `config`, as `prosebook generate` and `prosebook lint` would on disk. */
export function play(files: Files, config: ProsebookConfig = {}): Played {
  const resolved = load(files, config);
  let generated: ReturnType<typeof render>;
  try {
    generated = render(resolved, undefined, { partial: true });
  } catch (e) {
    // What the catalog makes without its native targets, and why they failed.
    const problems = problemsOf(e);
    generated = render({ ...resolved, native: [] }, undefined, { partial: true });
    generated.catalog.problems.push(...problems);
  }
  const catalog = evaluatedCatalog(resolved, generated);
  return {
    generated: Object.fromEntries([...generated.files].map(([path, content]) => [fromRoot(path), content])),
    problems: generated.catalog.problems,
    findings: lint(generated.catalog.messages, resolved),
    messages: generated.catalog.messages,
    catalog,
  };
}

/**
 * `files` with the edits `findings` carry made, as `lint --fix` makes them: only if the catalog they
 * make loads clean, else `files` as they were and the problems.
 */
export function fix(files: Files, findings: Finding[], config: ProsebookConfig = {}): { files: Files; problems: Problem[] } {
  const resolved = load(files, config);
  const { problems } = applyFixes(resolved, loadCatalog(resolved, undefined, { partial: true }), findings);
  if (problems.length > 0) return { files, problems };
  return { files: Object.fromEntries(Object.keys(files).map((path) => [path, volume.get(`${ROOT}/${path}`)!])), problems: [] };
}

export interface StandaloneOptions {
  /** The path deictic's endpoints sit under, ending in `/`, as the page's `base`. `/` unset. */
  base?: string;
  /** Asked to open a place, its `file` a path from the project's folder: a link to its source, say. */
  open?: (at: EntryLocation) => void;
  /** Told the files after each edit, undo or redo, for the page to show: `play` them and read again. */
  saved?: (files: Files) => void;
  /** What the page's build read, for the Copy tab to match text to where the page read none itself. */
  reads?: () => [string, { key: string; locale: string }[]][];
}

interface Change {
  id: number;
  at: string;
  label: string;
  before: Files;
  after: Files;
}

/**
 * deictic's endpoints for the prosebook plugin alone, over `files`, for a page with no dev server: the default
 * export of deictic's `standalone` module (`deictic/vite`'s `standalone` option), a `Standalone`. An edit is
 * kept for the requests after it, and undone and redone from a history of its own, in memory.
 */
export function standalone(files: Files, config: ProsebookConfig = {}, { base = '/', open, saved, reads }: StandaloneOptions = {}) {
  let current = files;
  let done: Change[] = [];
  let undone: Change[] = [];
  const summary = ({ id, at, label, after }: Change) => ({ id, at, label, files: Object.keys(after) });
  const routes = copyRoutes(
    () => load(current, config),
    fromRoot,
    () => new Map(reads?.() ?? []),
  );
  const refused = (problem: string) => Response.json({ problem }, { status: 422 });
  const swap = (from: Change[], to: Change[], side: 'before' | 'after') => {
    const change = from.pop();
    if (change === undefined) return refused(`nothing to ${side === 'before' ? 'undo' : 'redo'}`);
    to.push(change);
    current = { ...current, ...change[side] };
    for (const [path, content] of Object.entries(change[side])) if (content === '') delete current[path];
    saved?.(current);
    return Response.json({ change: summary(change) });
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const prefix = `${base}__deictic/`;
    if (!url.pathname.startsWith(prefix)) return new Response(null, { status: 404 });
    const route = url.pathname.slice(prefix.length);
    if (route === 'plugins/prosebook/entry') return routes.entry(request);
    if (route === 'plugins/prosebook/place') return routes.place(request);
    if (route === 'plugins/prosebook/reads') return routes.reads();
    if (route === 'history') return Response.json({ done: done.map(summary), undone: undone.map(summary) });
    if (route === 'open') {
      open?.({
        file: url.searchParams.get('file') ?? '',
        line: Number(url.searchParams.get('line')),
        column: Number(url.searchParams.get('column')),
      });
      return new Response(null, { status: 204 });
    }
    if (route === 'undo') return swap(done, undone, 'before');
    if (route === 'redo') return swap(undone, done, 'after');
    if (route === 'read') return Response.json({ model: null });
    if (route !== 'apply') return route === 'problem' ? Response.json({}) : new Response(null, { status: 404 });
    // Read before the files are loaded, so the edit is made in the same turn.
    const { op } = (await request.json()) as { op: EntryEdit };
    const edits = editsOf(load(current, config), op);
    if (typeof edits === 'string') return refused(edits);
    const after = Object.fromEntries([...edits].map(([path, content]) => [fromRoot(path), content]));
    // An empty file stands for one the edit made, which undo takes away.
    const before = Object.fromEntries(Object.keys(after).map((path) => [path, current[path] ?? '']));
    const change = { id: done.length + undone.length + 1, at: new Date().toISOString(), label: `prosebook ${op.key}`, before, after };
    done.push(change);
    undone = [];
    current = { ...current, ...after };
    saved?.(current);
    return Response.json({ model: null, change: summary(change) });
  };
}
