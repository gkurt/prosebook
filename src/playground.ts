/**
 * `prosebook/playground`: the tools in a browser, over files held in memory. What `generate`, `lint`
 * and `lint --fix` make of a catalog, without a disk or a config file: the homepage's demo runs
 * on it, and so can an editor of your own. It ships built for the browser, `node:` modules replaced by
 * those in `browser/`, `node:fs` by an in-memory volume (`browser/fs.ts`) that every call fills anew.
 */
import { volume } from './browser/fs.ts';
import { RUNTIME, type Catalog as RuntimeCatalog } from './runtime/copy.ts';
import type { Formats } from './runtime/formats.ts';
import { numberLadder } from './runtime/ladder.ts';
import { relativeTime } from './runtime/relative.ts';
import type { CompiledMessages } from './runtime/types.ts';
import { CatalogError, loadCatalog, type EntryLocation, type Message, type Problem } from './tools/catalog.ts';
import { compileLocale, localeExpression, type Entry } from './tools/compile.ts';
import { resolveConfig, type ProsebookConfig } from './tools/config.ts';
import { inspectorEndpoints } from './tools/endpoints.ts';
import { applyFixes } from './tools/entry.ts';
import { formatsCode, render, runtimeParts } from './tools/generate.ts';
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
/** The runtime's parts a catalog holds where it uses them, as the generated index imports them. */
const PARTS = { relativeTime, numberLadder };

function load(files: Files, config: ProsebookConfig) {
  volume.clear();
  for (const [path, content] of Object.entries(files)) volume.set(`${ROOT}/${path}`, content);
  return resolveConfig(ROOT, config);
}

const fromRoot = (path: string) => path.slice(ROOT.length + 1);

/** A locale's messages as the generated module holds them, run. */
function evaluate(entries: Entry[]): CompiledMessages {
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- running the compiler's own output is the point
  return new Function(`return ${localeExpression(compileLocale(entries))};`)() as CompiledMessages;
}

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
  const locales = [...generated.entries.keys()];
  const formats = formatsCode(resolved);
  const catalog: RuntimeCatalog = {
    runtime: RUNTIME,
    source: resolved.source,
    locales,
    messages: Object.fromEntries([...generated.entries].map(([locale, entries]) => [locale, evaluate(entries)])),
    loaders: {},
    // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- the formats as the generated index ships them, each text compiled
    ...(formats !== undefined && { formats: new Function(`return ${formats};`)() as Formats }),
    ...Object.fromEntries(runtimeParts(resolved, generated.catalog).map((p) => [p.field, PARTS[p.name]])),
  };
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

export interface EndpointsOptions {
  /** The path the endpoints sit under, ending in `/`, as the inspector's `base`. `/` unset. */
  base?: string;
  /** Asked to open an entry, its `file` a path from the project's folder: a link to its source, say. */
  open?: (at: EntryLocation) => void;
  /** Told the files after each edit written, for the page to show: `play` them and read again. */
  saved?: (files: Files) => void;
}

/**
 * The inspector's endpoints over `files`, for a page with no dev server: what `prosebook/inspector`'s
 * `install` takes as `fetch`, once each request is a `Request`. An edit is kept for the requests after it.
 */
export function endpoints(
  files: Files,
  config: ProsebookConfig = {},
  { base, open, saved }: EndpointsOptions = {},
): (request: Request) => Promise<Response | undefined> {
  let current = files;
  return inspectorEndpoints(() => load(current, config), {
    ...(base !== undefined && { base }),
    open: (at) => {
      open?.({ ...at, file: fromRoot(at.file) });
      return new Response(null, { status: 204 });
    },
    written: () => {
      const prefix = `${ROOT}/`;
      current = Object.fromEntries([...volume].flatMap(([path, content]) => (path.startsWith(prefix) ? [[fromRoot(path), content]] : [])));
      saved?.(current);
    },
  });
}
