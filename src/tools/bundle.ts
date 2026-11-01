/**
 * What the bundler integrations share: which messages a build ships, the reads that would show a key
 * once their message is pruned, and the code a dev server appends so an edit swaps messages in place.
 *
 * Vite sees every module before it writes a chunk, so it prunes after the fact (`vite.ts`). Next's
 * loaders and Bun's `onLoad` hand over a locale module before the code that reads it has been seen,
 * so they read the source under `scan.dirs` first (`scanSources`) and load the locale already pruned.
 */
import { existsSync, readFileSync, watch } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileLocale, localeModule, type Entry } from './compile.ts';
import type { ResolvedConfig } from './config.ts';
import { isReferenced, keyRefs, READERS, sourceFiles, unseenReads, type KeyRefs, type Reads, type UnseenRead } from './scan.ts';

/** How a build prunes: `strict` also fails on a read whose key it can't see. */
export type Prune = 'strict' | 'loose' | false;

/** Whether a build keeps a key: some module names it, or `keep` lists it, exactly or as `prefix.*`. */
export function keeper(refs: KeyRefs, keep: string[] = []): (key: string) => boolean {
  return (key) => isReferenced(key, refs) || keep.some((k) => (k.endsWith('.*') ? key.startsWith(k.slice(0, -1)) : k === key));
}

/** The unseen reads that are a copy's: a name only counts once some module binds a reader to it. */
export function unseenOf(reads: Iterable<Reads>): UnseenRead[] {
  const all = [...reads];
  const readers = new Set([...READERS, ...all.flatMap((r) => [...r.aliases])]);
  return all.flatMap((r) => r.unseen).filter((u) => u.name === 'Text' || readers.has(u.name));
}

/** The error a strict build fails with, each read at its path from `root`. */
export function unseenMessage(unseen: UnseenRead[], root: string): string {
  const at = (file: string) => relative(root, file).replaceAll('\\', '/');
  return [
    `${unseen.length} read(s) whose key the build can't see, so their messages would be pruned and the key shown instead:`,
    ...unseen.map((u) => `  ${at(u.file)}:${u.line}:${u.column}  ${u.code}`),
    'Write each key at the read, as a literal or `area.${id}`; or, where every key it reads is written elsewhere or listed in `keep`, mark the line `prosebook-ignore`. `prune: "loose"` turns this check off.',
  ].join('\n');
}

export interface SourceScan {
  refs: KeyRefs;
  unseen: UnseenRead[];
}

/**
 * Every key the app's source names and, with `strict`, its unseen reads. The generated modules are
 * left out, since they name every key.
 */
export function scanSources(config: ResolvedConfig, strict: boolean): SourceScan {
  const refs: KeyRefs = { exact: new Set(), prefixes: new Set() };
  const reads: Reads[] = [];
  for (const file of sourceFiles(config.scan.dirs, config.scan.extensions, [config.out])) {
    const code = readFileSync(file, 'utf8');
    keyRefs(code, refs);
    if (strict) reads.push(unseenReads(file, code));
  }
  return { refs, unseen: unseenOf(reads) };
}

/** Calls `change` once a burst of edits to the catalog or its translations settles. Returns the stop. */
export function watchCatalog(config: ResolvedConfig, change: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers = [config.catalog, config.locales]
    .filter((dir) => existsSync(dir))
    .map((dir) =>
      watch(dir, { recursive: true }, (_event, file) => {
        if (file === null || !file.endsWith('.yaml')) return;
        clearTimeout(timer);
        timer = setTimeout(change, 50);
      }),
    );
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

/** A locale's module holding only the keys `kept`, as JavaScript, for a bundler to load in its place. */
export function prunedModule(entries: Entry[], kept: (key: string) => boolean): string {
  return localeModule(compileLocale(entries, kept), '// Pruned by prosebook: only the messages the code names.', false);
}

/**
 * Appended to a locale module in dev. Accepts its own update and hands the new messages to every
 * copy (`HotHook`); a page loaded before the hooks existed reloads instead.
 */
export const hotLocale = (locale: string) => `
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    const hot = globalThis.__PROSEBOOK_HOT__;
    if (next === undefined || hot === undefined) return import.meta.hot.invalidate();
    for (const update of hot) update(${JSON.stringify(locale)}, next.default);
  });
}
`;

/** Appended to the index in dev: its doc comments change with every edit; only a new locale reloads. */
export const HOT_INDEX = `
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    if (next === undefined || next.catalog.locales.join() !== catalog.locales.join()) import.meta.hot.invalidate();
  });
}
`;

/**
 * A locale module in dev under a bundler that runs it again when it changes, as Turbopack's Fast
 * Refresh does, but has no `import.meta.hot`: each run hands its messages to every copy. The first
 * run finds no copy holding the locale yet, so it changes nothing.
 */
export const notifyingLocale = (code: string, locale: string) =>
  `${code.replace(/^export default /m, 'const messages = ')}
export default messages;
globalThis.__PROSEBOOK_HOT__?.forEach((update) => update(${JSON.stringify(locale)}, messages));
`;

/** Prepended to the index in dev, so the set every copy adds itself to exists before any copy does. */
export const HOT_SET = 'globalThis.__PROSEBOOK_HOT__ ??= new Set();\n';

/**
 * A module of prosebook's own beside the one at `url`, which passes its `import.meta.url`: the source
 * when run from source, the built file in dist.
 */
export const beside = (url: string, name: string) =>
  fileURLToPath(new URL(`./${name}${url.endsWith('.ts') ? '.ts' : '.js'}`, url)).replaceAll('\\', '/');

/** Code that starts the inspector (`inspector.ts`, imported from `path`) on the page, its endpoints under `base`. */
export const installInspector = (path: string, base: string) =>
  `import { install as installInspector } from ${JSON.stringify(path)};\ninstallInspector(${JSON.stringify({ base })});\n`;
