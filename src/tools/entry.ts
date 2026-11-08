/**
 * One entry as the dev inspector's dialog edits it, as fields, in every locale.
 *
 * An edit is checked as the whole catalog, with the edited files read from memory, before anything is
 * written: a save that would break the build comes back as problems instead, and the dev server never
 * sees it. Fields are written into the parsed document, so comments, order and quoting elsewhere in the
 * file stay as they were. A translation left empty is no translation: one that was there is removed,
 * and the locale falls back.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { isMap, isScalar, parseDocument, Scalar, type Document, type YAMLMap } from 'yaml';

import { loadCatalog, type Catalog, type Message, type Problem } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { readReturned } from './exchange.ts';
import { applyEdits, lint, type Edit, type Finding } from './lint.ts';

export interface EntryFields {
  /** The source message. */
  message: string;
  /** By locale. Empty or missing is no translation, so the locale falls back. */
  translations: Record<string, string>;
  context: string;
  kind: string;
  surface: string;
  fragment: boolean;
  /** What each placeholder holds, by name. */
  args: Record<string, string>;
  /** A change asked of whoever edits next; empty is none. */
  comment: string;
  /** Asks for the entry to go, with the code that reads it. */
  remove: boolean;
}

export interface EntryView {
  key: string;
  /** The source locale. */
  source: string;
  /** Every translated locale, the source aside. */
  locales: string[];
  /** With every locale in `translations`, empty where it has none. */
  fields: EntryFields;
  /** The source message's placeholders. */
  argNames: string[];
  kinds: string[];
  surfaces: string[];
  /** What lint says of the entry as it stands, in every locale. */
  findings: EntryFinding[];
}

export interface EntryFinding extends Finding {
  /** The locale's text with this finding fixed, so the page can make the fix without lint's code. */
  fixed?: string;
}

/** The entry for `key`, with its translation in every locale. */
export function readEntry(config: ResolvedConfig, key: string): EntryView {
  return viewOf(config, loadCatalog(config, undefined, { partial: true }), key);
}

/**
 * The catalog with `unsaved` in place of what is on disk, and the errors the edit brings: those the
 * catalog on disk has already, a broken entry someone else is editing, are no reason to refuse it.
 */
export function checkEdit(config: ResolvedConfig, unsaved: ReadonlyMap<string, string>): { catalog: Catalog; problems: Problem[] } {
  const id = (p: Problem) => `${p.file}\u0000${p.key}\u0000${p.message}`;
  const errors = (catalog: Catalog) => catalog.problems.filter((p) => p.severity === 'error');
  const before = new Set(errors(loadCatalog(config, undefined, { partial: true })).map(id));
  const catalog = loadCatalog(config, unsaved, { partial: true });
  return { catalog, problems: errors(catalog).filter((p) => !before.has(id(p))) };
}

/**
 * Applies an edit and checks the catalog with it. With `write`, a clean edit is written; without, it
 * only comes back as the view, with what lint says of it, which is how the dialog checks as you type.
 */
export function editEntry(
  config: ResolvedConfig,
  key: string,
  fields: EntryFields,
  write: boolean,
): { view?: EntryView; problems: Problem[] } {
  const loaded = loadCatalog(config, undefined, { partial: true });
  const current = viewOf(config, loaded, key);
  const message = loaded.messages.find((m) => m.key === key)!;
  const unsaved = new Map<string, string>();
  const text = (file: string) => contentOf(config, file, unsaved);
  unsaved.set(resolve(config.root, message.file), withFields(text(message.file), key, fields, config.source));
  for (const locale of current.locales) {
    const next = fields.translations[locale] ?? '';
    if (next === current.fields.translations[locale]) continue;
    const file = translationFile(config, message, locale);
    unsaved.set(resolve(config.root, file), withTranslation(text(file), key, next));
  }

  const { catalog, problems } = checkEdit(config, unsaved);
  if (problems.length > 0) return { problems };

  if (write) {
    for (const [path, content] of unsaved) {
      if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return { view: viewOf(config, catalog, key), problems: [] };
}

/**
 * Makes the edits that lint's findings carry, each message in its own file, and writes them only if
 * the catalog they make loads clean: the problems come back instead, and nothing is written.
 */
export function applyFixes(config: ResolvedConfig, catalog: Catalog, findings: Finding[]): { fixed: number; problems: Problem[] } {
  const unsaved = new Map<string, string>();
  const entries = new Map<string, { file: string; key: string; locale: string; edits: Edit[]; count: number }>();
  for (const f of findings) {
    if (f.fix === undefined) continue;
    const id = `${f.locale}\u0000${f.key}`;
    const entry = entries.get(id) ?? { file: f.file, key: f.key, locale: f.locale, edits: [], count: 0 };
    entry.edits.push(...f.fix);
    entry.count += 1;
    entries.set(id, entry);
  }
  let fixed = 0;
  for (const { file, key, locale, edits, count } of entries.values()) {
    const message = catalog.messages.find((m) => m.key === key);
    const written = locale === config.source ? message?.text : message?.translations.get(locale)?.text;
    if (written === undefined) continue;
    const next = applyEdits(written, edits);
    if (next === written) continue;
    const content = contentOf(config, file, unsaved);
    unsaved.set(
      resolve(config.root, file),
      locale === config.source ? withMessage(content, key, next, config.source) : withTranslation(content, key, next),
    );
    fixed += count;
  }
  const { problems } = checkEdit(config, unsaved);
  if (problems.length > 0) return { fixed: 0, problems };
  for (const [path, content] of unsaved) writeFileSync(path, content);
  return { fixed, problems: [] };
}

export interface Imported {
  /** Keys whose translation was written. */
  written: string[];
  /** Keys given back as they were: each still holds, so a stale one can be accepted. */
  unchanged: string[];
  /** What was left out, and why. The rest was written regardless. */
  problems: Problem[];
}

/**
 * Translations into `locale` from `prosebook todo`'s YAML filled in, by a person or a model, or from
 * a translation tool's XLIFF or JSON (`readReturned`), each written to the file its locale and area
 * put it in. An empty value is one left for later. An entry that would break the catalog is left out
 * with its problem, so a reply with one bad entry still lands the others.
 */
export function importTranslations(config: ResolvedConfig, locale: string, reply: string): Imported {
  const failed = (message: string, key?: string): Problem => ({ severity: 'error', key, message });
  if (locale === config.source)
    return { written: [], unchanged: [], problems: [failed(`${locale} is the source: import takes translations`)] };
  const read = readReturned(reply, locale, config.source);
  if ('problem' in read) return { written: [], unchanged: [], problems: [failed(read.problem)] };

  const catalog = loadCatalog(config, undefined, { partial: true });
  const problems: Problem[] = [];
  const unchanged: string[] = [];
  const pending = new Map<string, { file: string; text: string }>();
  for (const { key, value, checked, source, problem } of read.returned) {
    const message = catalog.messages.find((m) => m.key === key);
    if (message === undefined) {
      problems.push(failed('no entry has this key: translate only the keys `prosebook todo` or `export` gave out', key));
      continue;
    }
    if (problem !== undefined) {
      problems.push(failed(problem, key));
      continue;
    }
    if (value === null || value === '') continue;
    if (typeof value !== 'string' && typeof value !== 'number') {
      problems.push(failed('the translation is not text: give the message as one string', key));
      continue;
    }
    if (source !== undefined && source !== message.text) {
      problems.push(failed(`the source has changed since it was exported, to "${message.text}": export it again`, key));
      continue;
    }
    const text = String(value);
    if (text !== message.translations.get(locale)?.text) pending.set(key, { file: translationFile(config, message, locale), text });
    else if (checked) unchanged.push(key);
  }

  // An entry whose own file reports it is left out, until what is left loads clean. Any other new
  // problem means the reply broke the catalog somewhere it can't say, so nothing is written.
  for (;;) {
    const unsaved = new Map<string, string>();
    for (const [key, { file, text }] of pending)
      unsaved.set(resolve(config.root, file), withTranslation(contentOf(config, file, unsaved), key, text));
    const errors = checkEdit(config, unsaved).problems;
    if (errors.length > 0) {
      const own = errors.filter((p) => p.key !== undefined && pending.get(p.key)?.file === p.file);
      if (own.length === 0) return { written: [], unchanged: [], problems: [...problems, ...errors] };
      for (const p of own) if (p.key !== undefined) pending.delete(p.key);
      problems.push(...own);
      continue;
    }
    for (const [path, content] of unsaved) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return { written: [...pending.keys()], unchanged, problems };
  }
}

/** A file as the edit has it, as it is on disk, or empty when it is still to be made. */
export function contentOf(config: ResolvedConfig, file: string, unsaved: Map<string, string>): string {
  const path = resolve(config.root, file);
  return unsaved.get(path) ?? (existsSync(path) ? readFileSync(path, 'utf8') : '');
}

/** The file a translation goes in: beside the locale's others, in its folder or its one file. */
export function translationFile(config: ResolvedConfig, message: Message, locale: string): string {
  const existing = message.translations.get(locale)?.file;
  if (existing !== undefined) return existing;
  const folder = join(config.locales, locale);
  const path = existsSync(folder) && statSync(folder).isDirectory() ? join(folder, `${message.area}.yaml`) : `${folder}.yaml`;
  return relative(config.root, path).replaceAll('\\', '/');
}

function viewOf(config: ResolvedConfig, catalog: Catalog, key: string): EntryView {
  const message = catalog.messages.find((m) => m.key === key);
  if (message === undefined) throw new Error(`no entry for "${key}" in the catalog: has it been renamed since the page loaded?`);
  return {
    key,
    source: config.source,
    locales: catalog.locales,
    fields: {
      message: message.text,
      translations: Object.fromEntries(catalog.locales.map((l) => [l, message.translations.get(l)?.text ?? ''])),
      context: message.context ?? '',
      kind: message.kind ?? '',
      surface: message.surface ?? '',
      fragment: message.fragment,
      args: Object.fromEntries(message.argDocs),
      comment: message.comment ?? '',
      remove: message.remove,
    },
    argNames: [...message.args.keys()],
    kinds: Object.keys(config.kinds),
    surfaces: Object.keys(config.surfaces),
    findings: lint([message], config, catalog.messages).map((f) => {
      const written = f.locale === config.source ? message.text : message.translations.get(f.locale)?.text;
      return f.fix === undefined || written === undefined ? f : { ...f, fixed: applyEdits(written, f.fix) };
    }),
  };
}

/** Where an entry is written: from the start of its key's line to the end of its value. */
export function snippetOf(file: string, key: string): { start: number; end: number; text: string } | undefined {
  const doc = parseDocument(file);
  if (!isMap(doc.contents)) return undefined;
  const pair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key);
  const keyStart = isScalar(pair?.key) ? pair.key.range?.[0] : undefined;
  const valueEnd = (pair?.value as { range?: [number, number, number] } | null | undefined)?.range?.[1];
  if (keyStart === undefined || valueEnd === undefined) return undefined;
  const start = file.lastIndexOf('\n', keyStart - 1) + 1;
  // The last value in a file runs to its final newline; the snippet stops at the text.
  const end = start + file.slice(start, valueEnd).trimEnd().length;
  return { start, end, text: file.slice(start, end) };
}

// As YAML 1.1, so a new value that 1.1 would read differently, like `n`, is quoted (as in migrate.ts).
// An empty file starts as a plain mapping: under 1.1 a key set on nothing makes an `!!omap`.
function parse(file: string): Document {
  const doc: Document = parseDocument(file, { version: '1.1' });
  if (doc.contents === null) doc.contents = doc.createNode({});
  return doc;
}
// New values quoted the way catalogs are; values already there keep how they were quoted.
const print = (doc: Document) => doc.toString({ lineWidth: 0, singleQuote: true });

/** A value written where one was, keeping how it was quoted; text over several lines as a block. */
function setValue(doc: Document, map: YAMLMap, name: string, value: unknown): void {
  const node = map.get(name, true);
  if (isScalar(node) && typeof value === 'string') {
    node.value = value;
    if (value.includes('\n')) node.type = Scalar.BLOCK_LITERAL;
    return;
  }
  map.set(name, doc.createNode(value));
}

function withFields(file: string, key: string, fields: EntryFields, source: string): string {
  const doc = parse(file);
  let entry = doc.get(key, true);
  const args = Object.fromEntries(Object.entries(fields.args).filter(([, v]) => v.trim() !== ''));
  const wanted: [string, unknown][] = [
    ['kind', fields.kind.trim() || undefined],
    ['surface', fields.surface.trim() || undefined],
    ['context', fields.context.trim() || undefined],
    ['args', Object.keys(args).length > 0 ? args : undefined],
    ['fragment', fields.fragment || undefined],
    ['comment', fields.comment.trim() || undefined],
    ['remove', fields.remove || undefined],
  ];
  // `key: message` stays one until it has something to say about itself, then gains a mapping.
  if (!isMap(entry)) {
    // An empty message is kept as one, for the check to refuse, rather than taking the entry away.
    if (fields.message.trim() !== '' && wanted.every(([, value]) => value === undefined)) return withTranslation(file, key, fields.message);
    entry = doc.createNode({ [source]: fields.message });
    doc.set(key, entry);
  }
  const map = entry as YAMLMap;
  for (const [name, value] of wanted) {
    if (value === undefined) {
      map.delete(name);
      continue;
    }
    if (map.has(name)) {
      setValue(doc, map, name, value);
      continue;
    }
    // A field the entry didn't have goes before the message, where the others are.
    const at = map.items.findIndex((p) => isScalar(p.key) && p.key.value === source);
    map.items.splice(at === -1 ? map.items.length : at, 0, doc.createPair(name, value));
  }
  setValue(doc, map, source, fields.message);
  return print(doc);
}

/** The source message replaced, and nothing else: a `key: message` entry stays one. */
function withMessage(file: string, key: string, message: string, source: string): string {
  const doc = parse(file);
  const entry = doc.get(key, true);
  if (!isMap(entry)) return withTranslation(file, key, message);
  setValue(doc, entry, source, message);
  return print(doc);
}

function withTranslation(file: string, key: string, translation: string): string {
  const doc = parse(file);
  const node = doc.get(key, true);
  if (translation.trim() === '') {
    doc.delete(key);
  } else if (isScalar(node)) {
    node.value = translation;
    if (translation.includes('\n')) node.type = Scalar.BLOCK_LITERAL;
  } else {
    doc.set(key, translation);
  }
  // A file left with nothing in it reads as no translations, not as `{}`.
  return isMap(doc.contents) && doc.contents.items.length === 0 ? '' : print(doc);
}
