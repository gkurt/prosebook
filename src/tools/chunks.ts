/**
 * Which areas of a split catalog a bundler puts in one chunk, so a lazy locale's messages for them
 * can be one file: a route reading three areas loads German in one request, not three.
 *
 * Read from the source's imports ahead of the build, as Bun and Next give a plugin no say in chunks
 * and Vite loads an area before it has seen every module naming it. Bundlers place a module by the
 * entries that load it: the app's own, and each dynamic import, less those that only ever load once
 * it is already in memory, as a route its shell imports. This reads the same from the files under
 * `scan.dirs`, with relative imports resolved. It is a guess, and only a request rides on it: an
 * import it can't resolve (an alias, a package) leaves apart areas that may share a chunk, and two
 * areas grouped in different chunks load each other's messages, which the copy leaves unread.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { parseSync } from 'oxc-parser';

import { areasNamed, areasOf, eagerAreas, type Groups } from './bundle.ts';
import type { ResolvedConfig } from './config.ts';
import type { Generated } from './generate.ts';
import { scriptBlocks, SFC, sourceFiles } from './scan.ts';

/** Tests and stories import components but load in no page, and as entries of their own they would part the areas they reach. */
const NOT_IN_APP = /\.(?:test|spec|stories)\.[^./\\]+$|[\\/]__tests__[\\/]/;

interface Imports {
  static: string[];
  dynamic: string[];
}

/** A module's imports that load code: `import type` and `export type … from` load none. */
function importsOf(file: string, code: string): Imports {
  const pieces = SFC.test(file) ? scriptBlocks(code) : [{ code, at: 0 }];
  const found: Imports = { static: [], dynamic: [] };
  for (const piece of pieces) {
    const { module } = parseSync(SFC.test(file) ? 'component.ts' : file, piece.code);
    for (const i of module.staticImports)
      if (i.entries.length === 0 || i.entries.some((e) => !e.isType)) found.static.push(i.moduleRequest.value);
    for (const e of module.staticExports.flatMap((s) => s.entries))
      if (e.moduleRequest !== null && !e.isType) found.static.push(e.moduleRequest.value);
    for (const d of module.dynamicImports) {
      // Only a literal names a module; `import(\`./pages/${name}.tsx\`)` could be any.
      const literal = /^(['"`])([^'"`$]*)\1$/.exec(piece.code.slice(d.moduleRequest.start, d.moduleRequest.end).trim());
      if (literal !== null) found.dynamic.push(literal[2]!);
    }
  }
  return found;
}

/** The file a relative specifier names, as a bundler finds it: as written, with an extension, as `./x.js` for `x.ts`, or as a folder's index. */
function resolver(files: ReadonlySet<string>, extensions: string[]): (from: string, specifier: string) => string | undefined {
  return (from, specifier) => {
    if (!specifier.startsWith('.')) return undefined;
    const base = resolve(dirname(from), specifier);
    const stem = base.replace(/\.[cm]?jsx?$/, '');
    const candidates = [
      base,
      ...extensions.map((e) => base + e),
      ...extensions.map((e) => stem + e),
      ...extensions.map((e) => join(base, `index${e}`)),
    ];
    return candidates.find((c) => files.has(c));
  };
}

/**
 * The groups of a split catalog's areas. Areas `keep` names load with the index, together; one no
 * file under `scan.dirs` names is a group of its own.
 */
export function areaGroups(config: ResolvedConfig, generated: Generated, keep?: string[]): Groups {
  const eager = eagerAreas(generated, keep);
  const lazy = new Set([...areasOf(generated)].filter((a) => !eager.has(a)));
  const files = sourceFiles(config.scan.dirs, config.scan.extensions, [config.out])
    .filter((f) => !NOT_IN_APP.test(f))
    .map((f) => resolve(f));
  const find = resolver(new Set(files), config.scan.extensions);

  // The module graph, an area a node of its own that each file naming its keys imports.
  const node = (area: string) => `\0${area}`;
  const statics = new Map<string, string[]>();
  const dynamics = new Map<string, Set<string>>();
  const imported = new Set<string>();
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    const { static: s, dynamic: d } = importsOf(file, code);
    const to = (specifiers: string[]) => specifiers.map((spec) => find(file, spec)).filter((f) => f !== undefined);
    statics.set(file, [...to(s), ...areasNamed(code, lazy).map(node)]);
    for (const target of to(d)) {
      if (!dynamics.has(target)) dynamics.set(target, new Set());
      dynamics.get(target)!.add(file);
    }
    for (const f of [...to(s), ...to(d)]) imported.add(f);
  }

  // Entries: each dynamic import, and each file nothing imports, as a page or the app's own entry.
  const entries = [...new Set([...files.filter((f) => !imported.has(f)), ...dynamics.keys()])];
  const closure = new Map<string, Set<string>>();
  const loadedBy = new Map<string, Set<string>>();
  for (const entry of entries) {
    const seen = new Set<string>();
    const visit = (n: string) => {
      if (seen.has(n)) return;
      seen.add(n);
      if (!loadedBy.has(n)) loadedBy.set(n, new Set());
      loadedBy.get(n)!.add(entry);
      for (const next of statics.get(n) ?? []) visit(next);
    };
    visit(entry);
    closure.set(entry, seen);
  }

  // What is in memory whenever a dynamic entry loads: what every module importing it brought, by
  // every entry that loads that module. It only grows, so it settles.
  const inMemory = new Map<string, Set<string>>([...dynamics.keys()].map((d) => [d, new Set()]));
  const nodes = [...loadedBy.keys()];
  for (let changed = true; changed;) {
    changed = false;
    for (const [entry, importers] of dynamics) {
      const by = [...importers].map((i) => [...(loadedBy.get(i) ?? [])]);
      if (by.some((e) => e.length === 0)) continue;
      const held = (n: string) => by.every((e) => e.every((root) => closure.get(root)!.has(n) || inMemory.get(root)?.has(n) === true));
      const next = new Set(nodes.filter(held));
      if (next.size > inMemory.get(entry)!.size) {
        inMemory.set(entry, next);
        changed = true;
      }
    }
  }

  const groups = new Map<string, string>();
  const byChunk = new Map<string, string[]>();
  const sorted = [...lazy].toSorted();
  for (const area of sorted) {
    const loading = [...(loadedBy.get(node(area)) ?? [])].filter((e) => inMemory.get(e)?.has(node(area)) !== true).toSorted();
    // Named by no file read here, so where it lands is unknown: a group of its own.
    const chunk = loading.length === 0 ? node(area) : loading.join('\n');
    if (!byChunk.has(chunk)) byChunk.set(chunk, []);
    byChunk.get(chunk)!.push(area);
  }
  for (const members of [...byChunk.values(), [...eager].toSorted()]) for (const area of members) groups.set(area, members[0]!);
  return groups;
}
