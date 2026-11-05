/**
 * `prosebook rename`: a key, and the keys under it, renamed everywhere it is written. Its catalog
 * entry moves, with the comments above it, into its new area's file when its first segment changes;
 * each translation follows it, as does its anchor in the lock, so a stale translation stays stale;
 * and every string literal in the code that names it is rewritten. The whole is checked as the
 * catalog it makes before anything is written, as an edit is.
 *
 * The code is read as `scan` reads it, for literals, not calls: a key held in a map is renamed too. A
 * read through a prefix (`cart.${id}`) can't be followed unless the whole prefix moves, so it is named.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { isMap, isScalar, parseDocument } from 'yaml';

import { KEY_PATTERN, loadCatalog, withSchemaLine, type Problem } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { checkEdit, contentOf, snippetOf } from './entry.ts';
import { readLock, serializeLock } from './lock.ts';
import { sourceFiles } from './scan.ts';

export interface RenamePlan {
  /** Old key to new, in the order they are written. */
  keys: Map<string, string>;
  /** Each file the rename writes, by absolute path, with its new content, or `null` for one it empties and removes. */
  files: Map<string, string | null>;
  /** Code files whose literals name a renamed key, relative to the root, with how many they name. */
  code: { file: string; count: number }[];
  /** Reads through a key prefix that may reach a renamed key, and that no rename can follow. */
  prefixed: { file: string; line: number; prefix: string }[];
  /** Why nothing can be written. */
  problems: Problem[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rename of `from`, and of every key under `from.`, to the same under `to`, without writing anything. */
export function planRename(config: ResolvedConfig, from: string, to: string): RenamePlan {
  const plan: RenamePlan = { keys: new Map(), files: new Map(), code: [], prefixed: [], problems: [] };
  const fail = (message: string, key?: string) => {
    plan.problems.push({ severity: 'error', key, message });
    return plan;
  };
  if (from === to) return fail(`${from} is already its name: give the new one`);
  if (to.startsWith(`${from}.`)) return fail(`${to} is under ${from}, which moves with it: rename it in two steps`);
  const catalog = loadCatalog(config, undefined, { partial: true });
  const moving = catalog.messages.filter((m) => m.key === from || m.key.startsWith(`${from}.`));
  // In the order they are written, so entries moved together keep it.
  const order = writtenOrder(config, new Set(moving.map((m) => m.file)));
  const place = (key: string) => order.get(key) ?? 0;
  moving.sort((a, b) => (a.file === b.file ? place(a.key) - place(b.key) : a.file.localeCompare(b.file)));
  if (moving.length === 0) return fail(`no key is ${from} or starts with ${from}.: name one the catalog has`);
  const staying = new Set(catalog.messages.map((m) => m.key));
  for (const m of moving) staying.delete(m.key);
  for (const m of moving) {
    const key = to + m.key.slice(from.length);
    if (!KEY_PATTERN.test(key)) return fail(`${key} is not a key: dotted lowercase, with two segments at least`, m.key);
    if (staying.has(key)) return fail(`${key} is an entry already: rename or remove it first`, m.key);
    plan.keys.set(m.key, key);
  }

  const unsaved = new Map<string, string>();
  const rel = (path: string) => relative(config.root, path).replaceAll('\\', '/');
  for (const m of moving) {
    const key = plan.keys.get(m.key)!;
    const area = key.slice(0, key.indexOf('.'));
    moveEntry(config, unsaved, m.file, rel(join(config.catalog, `${area}.yaml`)), m.key, key, true);
    for (const t of m.translations.values()) {
      // A locale written as a folder of area files takes the new area's; one written as one file keeps it.
      const folder = resolve(config.root, t.file, '..');
      const target = folder === resolve(config.locales) ? t.file : rel(join(folder, `${area}.yaml`));
      moveEntry(config, unsaved, t.file, target, m.key, key, false);
    }
  }
  const { problems } = checkEdit(config, unsaved);
  if (problems.length > 0) {
    plan.problems.push(...problems);
    return plan;
  }
  for (const [path, content] of unsaved) plan.files.set(path, emptied(config, path, content) ? null : content);

  const lock = readLock(config.lock);
  let relocked = false;
  for (const anchors of Object.values(lock.translations)) {
    for (const [old, key] of plan.keys) {
      if (anchors[old] === undefined) continue;
      anchors[key] = anchors[old];
      delete anchors[old];
      relocked = true;
    }
  }
  if (relocked) plan.files.set(config.lock, serializeLock(lock));

  renameInCode(config, from, to, plan);
  return plan;
}

/** Each key's place in its file, each file parsed once. */
function writtenOrder(config: ResolvedConfig, files: Set<string>): Map<string, number> {
  const order = new Map<string, number>();
  for (const file of files) {
    const doc = parseDocument(contentOf(config, file, new Map()));
    if (!isMap(doc.contents)) continue;
    doc.contents.items.forEach((pair, i) => {
      if (isScalar(pair.key)) order.set(String(pair.key.value), i);
    });
  }
  return order;
}

/** Makes the planned changes. */
export function applyRename(plan: RenamePlan): void {
  for (const [path, content] of plan.files) {
    if (content === null) {
      rmSync(path, { force: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

/**
 * A file the move leaves with no entries goes, where it is an area's: a catalog file, or a locale's
 * area file. A locale written as one file stays, empty, so the locale does.
 */
function emptied(config: ResolvedConfig, path: string, content: string): boolean {
  if (content.replace(/^#.*$/gm, '').trim() !== '') return false;
  return resolve(path, '..') === resolve(config.catalog) || resolve(path, '..', '..') === resolve(config.locales);
}

/** The entry for `key` and the comment lines straight above it, which say something of it. */
function blockOf(file: string, key: string): { start: number; end: number; text: string } | undefined {
  const entry = snippetOf(file, key);
  if (entry === undefined) return undefined;
  let start = entry.start;
  while (start > 0) {
    const above = file.lastIndexOf('\n', start - 2) + 1;
    const line = file.slice(above, start - 1).replace(/\r$/, '');
    // The schema line belongs to the file, not to the entry under it.
    if (!/^\s*#/.test(line) || line.startsWith('# yaml-language-server:')) break;
    start = above;
  }
  return { start, end: entry.end, text: file.slice(start, entry.end) };
}

/** Moves an entry from one file to another, or renames it where it stands when the file is the same. */
function moveEntry(
  config: ResolvedConfig,
  unsaved: Map<string, string>,
  from: string,
  to: string,
  old: string,
  key: string,
  isCatalog: boolean,
): void {
  const source = contentOf(config, from, unsaved);
  const block = blockOf(source, old);
  if (block === undefined) return;
  const renamed = block.text.replace(new RegExp(`^(\\s*['"]?)${escape(old)}(?=['"]?\\s*:)`, 'm'), `$1${key}`);
  if (from === to) {
    unsaved.set(resolve(config.root, from), source.slice(0, block.start) + renamed + source.slice(block.end));
    return;
  }
  unsaved.set(resolve(config.root, from), source.slice(0, block.start) + source.slice(block.end).replace(/^\r?\n/, ''));
  const target = contentOf(config, to, unsaved);
  const added = target.trim() === '' ? `${renamed}\n` : `${target.replace(/\n*$/, '\n')}${renamed}\n`;
  unsaved.set(resolve(config.root, to), isCatalog ? withSchemaLine(added) : added);
}

/**
 * Every literal naming a renamed key, rewritten. A prefix under `from.` moves with it, so `cart.${id}`
 * becomes `basket.${id}` when `cart` is renamed; one that only may reach a renamed key is named.
 */
function renameInCode(config: ResolvedConfig, from: string, to: string, plan: RenamePlan): void {
  const keys = [...plan.keys.keys()].sort((a, b) => b.length - a.length).map(escape);
  const literal = new RegExp(`(['"\`])(${keys.join('|')})\\1`, 'g');
  const under = new RegExp(`(['"\`])${escape(from)}\\.((?:[\\w-]+\\.)*)(?=\\1|\\$\\{)`, 'g');
  const prefix = /(['"`])([a-z0-9][\w-]*(?:\.[\w-]+)*\.)(?:\1|\$\{)/g;
  for (const path of sourceFiles(config.scan.dirs, config.scan.extensions, [config.out])) {
    const code = readFileSync(path, 'utf8');
    const file = relative(config.root, path).replaceAll('\\', '/');
    let count = 0;
    const next = code
      .replace(literal, (_, quote: string, key: string) => {
        count += 1;
        return `${quote}${plan.keys.get(key)}${quote}`;
      })
      .replace(under, (_, quote: string, rest: string) => {
        count += 1;
        return `${quote}${to}.${rest}`;
      });
    if (count > 0) {
      plan.files.set(path, next);
      plan.code.push({ file, count });
    }
    for (const m of next.matchAll(prefix)) {
      const p = m[2]!;
      if (!`${from}.`.startsWith(p)) continue;
      plan.prefixed.push({ file, line: next.slice(0, m.index).split('\n').length, prefix: p });
    }
  }
}
