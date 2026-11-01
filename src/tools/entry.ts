/**
 * One entry as the dev inspector's dialog edits it, in every locale: as fields, or as the YAML written
 * in its files.
 *
 * An edit is checked as the whole catalog, with the edited files read from memory, before anything is
 * written: a save that would break the build comes back as problems instead, and the dev server never
 * sees it. Fields are written into the parsed document, so comments, order and quoting elsewhere in the
 * file stay as they were; YAML replaces the entry's text as typed. A translation left empty is no
 * translation: one that was there is removed, and the locale falls back.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { isMap, isScalar, parseDocument, Scalar, type Document, type YAMLMap } from 'yaml';

import { CatalogError, loadCatalog, type Catalog, type Message, type Problem } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
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
}

export interface EntryYaml {
  /** The entry in the catalog, from its key to the end of its value. */
  catalog: string;
  /** By locale, the entry in that locale's file. Empty is no translation. */
  translations?: Record<string, string>;
}

export interface EntryView {
  key: string;
  /** The source locale. */
  source: string;
  /** Every translated locale, the source aside. */
  locales: string[];
  /** Relative to the project root. A locale without the entry names the file it would go in. */
  files: { catalog: string; translations: Record<string, string> };
  /** With every locale in `translations`, empty where it has none. */
  fields: EntryFields;
  yaml: Required<EntryYaml>;
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

export type EntryEdit = { fields: EntryFields } | { yaml: EntryYaml };

/** The entry for `key`, with its translation in every locale. */
export function readEntry(config: ResolvedConfig, key: string): EntryView {
  return viewOf(config, loadCatalog(config), key, new Map());
}

/**
 * Applies an edit and checks the catalog with it. With `write`, a clean edit is written; without, it
 * only comes back as the view, which is how the dialog turns fields into YAML and back.
 */
export function editEntry(config: ResolvedConfig, key: string, edit: EntryEdit, write: boolean): { view?: EntryView; problems: Problem[] } {
  const current = viewOf(config, loadCatalog(config), key, new Map());
  const unsaved = new Map<string, string>();
  const text = (file: string) => contentOf(config, file, unsaved);
  const put = (file: string, content: string) => unsaved.set(resolve(config.root, file), content);
  // Locales the edit gives a translation, which the checked catalog must then have.
  const translated: string[] = [];

  if ('yaml' in edit) {
    put(current.files.catalog, withSnippet(text(current.files.catalog), key, edit.yaml.catalog));
    for (const locale of current.locales) {
      const yaml = edit.yaml.translations?.[locale]?.trim() ?? current.yaml.translations[locale]!;
      if (yaml !== '') translated.push(locale);
      if (yaml === current.yaml.translations[locale]) continue;
      put(current.files.translations[locale]!, withSnippet(text(current.files.translations[locale]!), key, yaml));
    }
  } else {
    put(current.files.catalog, withFields(text(current.files.catalog), key, edit.fields, config.source));
    for (const locale of current.locales) {
      const next = edit.fields.translations[locale] ?? '';
      if (next.trim() !== '') translated.push(locale);
      if (next === current.fields.translations[locale]) continue;
      put(current.files.translations[locale]!, withTranslation(text(current.files.translations[locale]!), key, next));
    }
  }

  let catalog: Catalog;
  try {
    catalog = loadCatalog(config, unsaved);
  } catch (e) {
    if (!(e instanceof CatalogError)) throw e;
    return { problems: e.problems.filter((p) => p.severity === 'error') };
  }
  const message = catalog.messages.find((m) => m.key === key);
  const renamed = [
    ...(message === undefined ? [current.files.catalog] : []),
    ...translated.filter((l) => message?.translations.has(l) !== true).map((l) => current.files.translations[l]!),
  ];
  if (renamed.length > 0) {
    const problem = `the entry is still ${key}: rename a key in the code and the catalog together`;
    return { problems: renamed.map((file) => ({ severity: 'error', file, key, message: problem })) };
  }

  if (write) {
    for (const [path, content] of unsaved) {
      if (existsSync(path) && readFileSync(path, 'utf8') === content) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return { view: viewOf(config, catalog, key, unsaved), problems: [] };
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
  try {
    loadCatalog(config, unsaved);
  } catch (e) {
    if (!(e instanceof CatalogError)) throw e;
    return { fixed: 0, problems: e.problems.filter((p) => p.severity === 'error') };
  }
  for (const [path, content] of unsaved) writeFileSync(path, content);
  return { fixed, problems: [] };
}

/** A file as the edit has it, as it is on disk, or empty when it is still to be made. */
function contentOf(config: ResolvedConfig, file: string, unsaved: Map<string, string>): string {
  const path = resolve(config.root, file);
  return unsaved.get(path) ?? (existsSync(path) ? readFileSync(path, 'utf8') : '');
}

/** The file a translation goes in: beside the locale's others, in its folder or its one file. */
function translationFile(config: ResolvedConfig, message: Message, locale: string): string {
  const existing = message.translations.get(locale)?.file;
  if (existing !== undefined) return existing;
  const folder = join(config.locales, locale);
  const path = existsSync(folder) && statSync(folder).isDirectory() ? join(folder, `${message.area}.yaml`) : `${folder}.yaml`;
  return relative(config.root, path).replaceAll('\\', '/');
}

function viewOf(config: ResolvedConfig, catalog: Catalog, key: string, unsaved: Map<string, string>): EntryView {
  const message = catalog.messages.find((m) => m.key === key);
  if (message === undefined) throw new Error(`no entry for "${key}" in the catalog: has it been renamed since the page loaded?`);
  const files = Object.fromEntries(catalog.locales.map((l) => [l, translationFile(config, message, l)]));
  return {
    key,
    source: config.source,
    locales: catalog.locales,
    files: { catalog: message.file, translations: files },
    fields: {
      message: message.text,
      translations: Object.fromEntries(catalog.locales.map((l) => [l, message.translations.get(l)?.text ?? ''])),
      context: message.context ?? '',
      kind: message.kind ?? '',
      surface: message.surface ?? '',
      fragment: message.fragment,
      args: Object.fromEntries(message.argDocs),
    },
    yaml: {
      catalog: snippetOf(contentOf(config, message.file, unsaved), key)?.text ?? '',
      translations: Object.fromEntries(catalog.locales.map((l) => [l, snippetOf(contentOf(config, files[l]!, unsaved), key)?.text ?? ''])),
    },
    argNames: [...message.args.keys()],
    kinds: Object.keys(config.kinds),
    surfaces: Object.keys(config.surfaces),
    findings: lint([message], config).map((f) => {
      const written = f.locale === config.source ? message.text : message.translations.get(f.locale)?.text;
      return f.fix === undefined || written === undefined ? f : { ...f, fixed: applyEdits(written, f.fix) };
    }),
  };
}

/** Where an entry is written: from the start of its key's line to the end of its value. */
function snippetOf(file: string, key: string): { start: number; end: number; text: string } | undefined {
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

/** The file with the entry's text replaced, removed when `yaml` is empty, or added at the end. */
function withSnippet(file: string, key: string, yaml: string): string {
  const text = yaml.replace(/\n+$/, '');
  const at = snippetOf(file, key);
  if (at !== undefined) {
    if (text.trim() === '') return file.slice(0, at.start) + file.slice(at.end).replace(/^\n/, '');
    return file.slice(0, at.start) + text + file.slice(at.end);
  }
  if (text.trim() === '') return file;
  return file.trim() === '' ? `${text}\n` : `${file.replace(/\n*$/, '\n')}${text}\n`;
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
  // `key: message` gains a mapping once it has anything to say about itself.
  if (!isMap(entry)) {
    entry = doc.createNode({ [source]: fields.message });
    doc.set(key, entry);
  }
  const map = entry as YAMLMap;
  const args = Object.fromEntries(Object.entries(fields.args).filter(([, v]) => v.trim() !== ''));
  const wanted: [string, unknown][] = [
    ['kind', fields.kind.trim() || undefined],
    ['surface', fields.surface.trim() || undefined],
    ['context', fields.context.trim() || undefined],
    ['args', Object.keys(args).length > 0 ? args : undefined],
    ['fragment', fields.fragment || undefined],
  ];
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
