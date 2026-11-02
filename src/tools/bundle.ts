/**
 * What the bundler integrations share: which messages a build ships, the reads that would show a key
 * once their message is pruned, and the code a dev server appends so an edit swaps messages in place.
 *
 * Vite sees every module before it writes a chunk, so it prunes after the fact (`vite.ts`). Next's
 * loaders and Bun's `onLoad` hand over a locale module before the code that reads it has been seen,
 * so they read the source under `scan.dirs` first (`scanSources`) and load the locale already pruned.
 */
import { existsSync, readFileSync, watch } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileLocale, localeModule, type Entry } from './compile.ts';
import type { ResolvedConfig } from './config.ts';
import type { Generated } from './generate.ts';
import { isReferenced, keyRefs, READERS, SFC, sourceFiles, unseenReads, type KeyRefs, type Reads, type UnseenRead } from './scan.ts';

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

/** `virtual:prosebook/area/cart`, and in a build `…/cart/de`, a lazy locale's part of the group `cart` leads. */
export const AREA = 'virtual:prosebook/area/';

/**
 * How a split catalog's modules are imported: an area (`cart`), a lazy locale's part of a group of
 * them, by the group's first area (`cart`, `de`), and a generated module, from its path. Vite's and Bun's are virtual modules (`VIRTUAL`);
 * Turbopack has none, so Next's are files.
 */
export interface Specifiers {
  area: (area: string, locale?: string) => string;
  generated: (path: string) => string;
}

export const VIRTUAL: Specifiers = {
  area: (area, locale) => AREA + area + (locale === undefined ? '' : `/${locale}`),
  generated: (path) => path,
};

/** `path` imported from a module in the folder `from`, as a relative specifier. */
export function relativeImport(from: string, path: string): string {
  const to = relative(from, path).replaceAll('\\', '/');
  return to.startsWith('.') ? to : `./${to}`;
}

/** An area's file, or a lazy locale's part of a group, where a bundler without virtual modules finds them. */
export const areaFile = (area: string, locale?: string) => (locale === undefined ? `${area}.js` : `${area}.${locale}.js`);

/** The specifiers of area files in `dir`, from a module in the folder `from`. */
export const fileSpecifiers = (from: string, dir: string): Specifiers => ({
  area: (area, locale) => relativeImport(from, join(dir, areaFile(area, locale))),
  generated: (path) => relativeImport(from, path),
});

export const areaOf = (key: string) => key.slice(0, key.indexOf('.'));

/** The entries of some areas: their keys start with an area's name. */
export const inAreas = (entries: Entry[], areas: readonly string[]) => entries.filter(([key]) => areas.includes(areaOf(key)));

/**
 * Each area to the group whose file its lazy locales load from, named by the group's first area: the
 * areas a bundler puts in one chunk (`areaGroups` in `chunks.ts`), so they load in one request.
 */
export type Groups = ReadonlyMap<string, string>;

/** The areas whose lazy locales load from the group `lead` names. */
export const membersOf = (groups: Groups, lead: string) => [...groups].filter(([, g]) => g === lead).map(([area]) => area);

export const areasOf = (generated: Generated) => new Set(generated.catalog.messages.map((m) => m.area));

/** Areas `keep` names, which load with the index of a split catalog, as no module may name their keys. */
export const eagerAreas = (generated: Generated, keep: string[] = []) => {
  const known = areasOf(generated);
  return new Set(keep.map(areaOf).filter((a) => known.has(a)));
};

/** The areas that load with the code naming their keys: all but those `keep` loads with the index. */
export const lazyAreas = (generated: Generated, keep?: string[]) => {
  const eager = eagerAreas(generated, keep);
  return new Set([...areasOf(generated)].filter((a) => !eager.has(a)));
};

/** Which of `areas` the keys `code` names are in. */
export function areasNamed(code: string, areas: ReadonlySet<string>): string[] {
  const named = keyRefs(code);
  return [...new Set([...named.exact, ...named.prefixes].map(areaOf))].filter((a) => areas.has(a)).toSorted();
}

/**
 * `code` importing each of `areas`. At the end, as imports run first wherever they are, so no line
 * moves; in a component file, at the end of its first script.
 */
export function importingAreas(code: string, path: string, areas: string[], specifier = VIRTUAL.area): string {
  const imports = areas.map((a) => `import ${JSON.stringify(specifier(a))};`).join('');
  if (!SFC.test(path)) return `${code}\n${imports}\n`;
  const close = code.indexOf('</script>');
  return close === -1 ? `${code}\n<script>${imports}</script>\n` : `${code.slice(0, close)};${imports}${code.slice(close)}`;
}

/** What a split catalog's areas register under: the generated folder, from the config's. */
const splitId = (config: ResolvedConfig) => relative(config.root, config.out).replaceAll('\\', '/');

/** A generated module's path, with forward slashes. */
const generatedPath = (config: ResolvedConfig, name: string) =>
  join(config.out, `${name}.${config.language === 'ts' ? 'ts' : 'js'}`).replaceAll('\\', '/');

/** The index of a split catalog, in the browser: no messages of its own, only the areas `keep` names. */
export function splitIndex(config: ResolvedConfig, generated: Generated, keep?: string[], where = VIRTUAL): string {
  const locales = [...generated.entries.keys()];
  const split = { id: splitId(config), areas: [...areasOf(generated)] };
  return [
    "import { defineCatalog } from 'prosebook';",
    ...[...eagerAreas(generated, keep)].map((a) => `import ${JSON.stringify(where.area(a))};`),
    `export const catalog = defineCatalog(${JSON.stringify({ source: config.source, locales, messages: {}, loaders: {}, split })});`,
    '',
  ].join('\n');
}

/** How an area's module holds a locale that ships with it in a build: as an expression, from its entries. */
export type Inline = (locale: string, entries: Entry[]) => string;

/**
 * An area's module: registers its messages in the locales that ship with it, and loaders for the
 * rest, and waits until every copy holds it. In a build, `inline` writes the first, and each of the
 * rest loads its part of the area's group, shared with the areas `groups` puts beside it, which the
 * copy takes only this area's keys from; in dev, without it, each locale is its generated module
 * whole, so an edit updates it as it would without splitting.
 */
export function areaModule(
  config: ResolvedConfig,
  generated: Generated,
  area: string,
  inline?: Inline,
  where = VIRTUAL,
  groups: Groups = new Map(),
): string {
  const lines = ["import { addArea } from 'prosebook';"];
  const messages: string[] = [];
  const loaders: string[] = [];
  for (const [locale, entries] of generated.entries) {
    const name = JSON.stringify(locale);
    const own = inAreas(entries, [area]);
    const whole = JSON.stringify(where.generated(generatedPath(config, locale)));
    if (locale === config.source || config.bundled.includes(locale)) {
      if (inline !== undefined) {
        messages.push(`${name}: ${inline(locale, own)}`);
      } else {
        lines.push(`import m${messages.length} from ${whole};`);
        messages.push(`${name}: m${messages.length}`);
      }
    } else if (inline === undefined) {
      loaders.push(`${name}: () => import(${whole})`);
    } else if (own.length > 0) {
      loaders.push(`${name}: () => import(${JSON.stringify(where.area(groups.get(area) ?? area, locale))})`);
    }
  }
  const args = [JSON.stringify(splitId(config)), JSON.stringify(area), `{ ${messages.join(', ')} }`, `{ ${loaders.join(', ')} }`];
  lines.push(`await addArea(${args.join(', ')});`, '');
  return lines.join('\n');
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
