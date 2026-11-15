/**
 * `prosebook rename`: a key, and the keys under it, renamed everywhere it is written. Its catalog
 * entry moves, with the comments above it, into its new area's file when its first segment changes;
 * each translation follows it, as does its anchor in the lock, so a stale translation stays stale;
 * and every string literal in the code that names it is rewritten. The whole is checked as the
 * catalog it makes before anything is written, as an edit is.
 *
 * The code is read as `scan` reads it, for literals, not calls: a key held in a map is renamed too. All
 * of the project's is, not `scan.dirs` alone, since a test outside the app names keys as the app does. A
 * read through a prefix (`cart.${id}`) can't be followed unless the whole prefix moves, so it is named.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { isMap, isScalar, parseDocument } from 'yaml';

import { KEY_PATTERN, loadCatalog, withSchemaLine, type Message, type Problem } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { duplicateGroups } from './duplicates.ts';
import { checkEdit, contentOf, snippetOf, withContext } from './entry.ts';
import { slugOf } from './extract.ts';
import { readLock, serializeLock } from './lock.ts';
import { READERS, sourceFiles } from './scan.ts';

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
  rewriteReferences(config, unsaved, catalog.messages, plan.keys);
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

  rewriteCode(config, plan, { from, to });
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

export interface MergePlan extends RenamePlan {
  /** Each group merged: the key read in their places, and the keys that go. */
  merged: { into: string; removed: string[] }[];
  /** Groups left as they are, and why. */
  skipped: { keys: string[]; why: string }[];
}

/**
 * `prosebook lint --fix --unsafe`: each `duplicate` group made one entry. The first stays, or, where
 * the group spans areas, the one `extract.shared` holds already, else the first moved there under a
 * key from its words (`sharedKey`); the others go, with their translations, and the code naming them
 * reads the one kept, whose context is every context the group had, since it now stands in each of
 * their places. Unsafe, since words alike may still be translated apart: a group whose translations
 * already differ in some locale is left, and a translation only another entry has is kept. A read
 * through a key prefix can't be followed, so it is named, as a rename names it.
 */
export function planMerge(config: ResolvedConfig): MergePlan {
  const plan: MergePlan = { keys: new Map(), files: new Map(), code: [], prefixed: [], problems: [], merged: [], skipped: [] };
  const catalog = loadCatalog(config, undefined, { partial: true });
  const taken = new Set(catalog.messages.map((m) => m.key));
  const shared = config.extract.shared;
  const unsaved = new Map<string, string>();
  const rel = (path: string) => relative(config.root, path).replaceAll('\\', '/');
  // Per locale, the key whose translation the kept entry takes, for its anchor in the lock.
  const anchored: { into: string; keys: string[]; from: Map<string, string> }[] = [];
  for (const group of duplicateGroups(catalog.messages)) {
    const keys = group.map((m) => m.key);
    const across = shared !== undefined && group.some((m) => m.area !== group[0]!.area);
    const kept = (across ? group.find((m) => m.area === shared) : undefined) ?? group[0]!;
    const rest = group.filter((m) => m !== kept);
    const locales = [...new Set(group.flatMap((m) => [...m.translations.keys()]))];
    const differ = locales.filter((l) => new Set(group.flatMap((m) => m.translations.get(l)?.text ?? [])).size > 1);
    if (differ.length > 0) {
      plan.skipped.push({ keys, why: `their ${differ.join(', ')} translations differ: merge them by hand, or exempt one` });
      continue;
    }
    const into = !across || kept.area === shared ? kept.key : sharedKey(taken, shared, kept);
    taken.add(into);
    const area = into.slice(0, into.indexOf('.'));
    const file = rel(join(config.catalog, `${area}.yaml`));
    moveEntry(config, unsaved, kept.file, file, kept.key, into, true);
    const contexts = [...new Set([kept, ...rest].flatMap((m) => m.context?.trim() || []))];
    if (contexts.length > 1 || contexts[0] !== kept.context?.trim())
      unsaved.set(resolve(config.root, file), withContext(contentOf(config, file, unsaved), into, contexts.join(' '), config.source));
    const from = new Map<string, string>();
    for (const l of locales) {
      const owner = group.find((m) => m.translations.has(l))!;
      const t = owner.translations.get(l)!;
      from.set(l, owner.key);
      const folder = resolve(config.root, t.file, '..');
      const target = folder === resolve(config.locales) ? t.file : rel(join(folder, `${area}.yaml`));
      moveEntry(config, unsaved, t.file, target, owner.key, into, false);
      for (const m of rest) if (m !== owner && m.translations.has(l)) removeEntry(config, unsaved, m.translations.get(l)!.file, m.key);
    }
    for (const m of rest) removeEntry(config, unsaved, m.file, m.key);
    for (const key of keys) if (key !== into) plan.keys.set(key, into);
    plan.merged.push({ into, removed: rest.map((m) => m.key) });
    anchored.push({ into, keys, from });
  }
  if (plan.merged.length === 0) return plan;
  rewriteReferences(config, unsaved, catalog.messages, plan.keys);
  const { problems } = checkEdit(config, unsaved);
  if (problems.length > 0) {
    plan.problems.push(...problems);
    return plan;
  }
  for (const [path, content] of unsaved) plan.files.set(path, emptied(config, path, content) ? null : content);

  const lock = readLock(config.lock);
  for (const [locale, anchors] of Object.entries(lock.translations)) {
    for (const { into, keys, from } of anchored) {
      const anchor = anchors[from.get(locale) ?? into];
      for (const key of keys) delete anchors[key];
      if (anchor !== undefined) anchors[into] = anchor;
    }
  }
  plan.files.set(config.lock, serializeLock(lock));
  rewriteCode(config, plan);
  return plan;
}

/**
 * The key a group's entry takes in the shared area: its words, as `extract` names one there, since the
 * key it had says where it stood (`password.saving`). Where another entry has that key, the same
 * words in another role, its kind sets it apart, then a number.
 */
function sharedKey(taken: Set<string>, shared: string, kept: Message): string {
  const base = `${shared}.${slugOf(kept.text)}`;
  const named = [base, ...(kept.kind === undefined ? [] : [`${base}-${kept.kind}`])].find(
    (key) => KEY_PATTERN.test(key) && !taken.has(key),
  );
  if (named !== undefined) return named;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** An entry, with the comments above it, cut from its file. */
function removeEntry(config: ResolvedConfig, unsaved: Map<string, string>, file: string, key: string): void {
  const source = contentOf(config, file, unsaved);
  const block = blockOf(source, key);
  if (block === undefined) return;
  unsaved.set(resolve(config.root, file), cut(source, block));
}

/** A file without a block, and without the blank line that set it apart from the entry above. */
function cut(source: string, block: { start: number; end: number }): string {
  const before = source.slice(0, block.start);
  const after = source.slice(block.end).replace(/^\r?\n/, '');
  if (after.trim() === '') return before.replace(/\s*$/, before.trim() === '' ? '' : '\n');
  return before + (/(?:^|\n)[ \t]*\r?\n$/.test(before) ? after.replace(/^[ \t]*\r?\n/, '') : after);
}

/**
 * Whether a file sets its entries apart with blank lines: one stands after its first entry. A file
 * with fewer than two entries says neither.
 */
function spaced(file: string): boolean | undefined {
  const first = file.search(/^[^\s#]/m);
  const entries = first === -1 ? '' : file.slice(first).trimEnd();
  return /\n[^\s#]/.test(entries) ? /\n[ \t]*\r?\n/.test(entries) : undefined;
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
  unsaved.set(resolve(config.root, from), cut(source, block));
  const target = contentOf(config, to, unsaved);
  // Set apart as the file's entries are, or, where it has too few to tell, as they were where this one stood.
  const apart = (spaced(target) ?? spaced(source)) === true ? '\n' : '';
  const added = target.trim() === '' ? `${renamed}\n` : `${target.replace(/\n*$/, '\n')}${apart}${renamed}\n`;
  unsaved.set(resolve(config.root, to), isCatalog ? withSchemaLine(added) : added);
}

/**
 * Every message saying a renamed entry, `{app.title, entry}` or MF2's `{|app.title| :pb:entry}`, made to
 * say it by its new key, in the catalog and every translation, those the move already wrote included.
 */
function rewriteReferences(config: ResolvedConfig, unsaved: Map<string, string>, messages: Message[], keys: Map<string, string>): void {
  const names = [...keys.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  const said = new RegExp(String.raw`(\{\s*)(${names})(\s*,\s*entry\b)|(\{\s*\|?)(${names})(\|?\s+:pb:entry\b)`, 'g');
  const files = new Set([
    ...messages.flatMap((m) => [m.file, ...[...m.translations.values()].map((t) => t.file)]).map((f) => resolve(config.root, f)),
    ...unsaved.keys(),
  ]);
  for (const file of files) {
    const source = contentOf(config, file, unsaved);
    const next = source.replace(said, (_, a?: string, one?: string, b?: string, c?: string, two?: string, d?: string) =>
      one !== undefined ? `${a}${keys.get(one)}${b}` : `${c}${keys.get(two!)}${d}`,
    );
    if (next !== source) unsaved.set(file, next);
  }
}

/** A name a module binds a copy's reader to: `{ t: translate }`, `import { t as translate }`. */
const ALIAS = /\b(?:t|rich)\s*(?::|\bas\b)\s*([A-Za-z_$][\w$]*)/g;
/** What is called with the text after it as its first argument: a name, or none where no name is called. */
const CALLED = /(?:([\w$]+)|[)\]])\s*\(\s*$/;

/**
 * Every literal naming a renamed key, rewritten, in the project's source: the config's folder and
 * `scan.dirs`. A prefix under `from.` moves with it, so `cart.${id}` becomes `basket.${id}` when `cart`
 * is renamed; one that only may reach a renamed key is named, unless it is what something other than
 * a copy's reader is called with, as a test's name is: `` test(`admin.users.${procedure}`) ``.
 */
function rewriteCode(config: ResolvedConfig, plan: RenamePlan, moved?: { from: string; to: string }): void {
  const keys = [...plan.keys.keys()].sort((a, b) => b.length - a.length).map(escape);
  const literal = new RegExp(`(['"\`])(${keys.join('|')})\\1`, 'g');
  const under = moved && new RegExp(`(['"\`])${escape(moved.from)}\\.((?:[\\w-]+\\.)*)(?=\\1|\\$\\{)`, 'g');
  const prefix = /(['"`])([a-z0-9][\w-]*(?:\.[\w-]+)*\.)(?:\1|\$\{)/g;
  const reaches = (p: string) => (moved ? `${moved.from}.`.startsWith(p) : [...plan.keys.keys()].some((key) => key.startsWith(p)));
  const readers = new Set(READERS);
  const called: ((typeof plan.prefixed)[number] & { by: string })[] = [];
  for (const path of sourceFiles([config.root, ...config.scan.dirs], config.scan.extensions, [config.out])) {
    const code = readFileSync(path, 'utf8');
    const file = relative(config.root, path).replaceAll('\\', '/');
    let count = 0;
    let next = code.replace(literal, (_, quote: string, key: string) => {
      count += 1;
      return `${quote}${plan.keys.get(key)}${quote}`;
    });
    if (under !== undefined) {
      next = next.replace(under, (_, quote: string, rest: string) => {
        count += 1;
        return `${quote}${moved!.to}.${rest}`;
      });
    }
    if (count > 0) {
      plan.files.set(path, next);
      plan.code.push({ file, count });
    }
    for (const m of next.matchAll(ALIAS)) readers.add(m[1]!);
    for (const m of next.matchAll(prefix)) {
      const p = m[2]!;
      if (!reaches(p)) continue;
      const found = { file, line: next.slice(0, m.index).split('\n').length, prefix: p };
      const call = CALLED.exec(next.slice(Math.max(0, m.index - 200), m.index));
      if (call === null) plan.prefixed.push(found);
      else called.push({ ...found, by: call[1] ?? '' });
    }
  }
  // Once every module is read, so a reader bound in one and called in another is known.
  for (const { by, ...found } of called) if (readers.has(by)) plan.prefixed.push(found);
  plan.prefixed.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
}
