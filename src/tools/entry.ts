/**
 * One entry as the dev inspector's dialog edits it: as fields, or as the YAML written in its files.
 *
 * An edit is checked as the whole catalog, with the edited files read from memory, before anything is
 * written: a save that would break the build comes back as problems instead, and the dev server never
 * sees it. Fields are written into the parsed document, so comments, order and quoting elsewhere in the
 * file stay as they were; YAML replaces the entry's text as typed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isMap, isScalar, parseDocument, Scalar, type Document, type YAMLMap } from 'yaml';

import { CatalogError, loadCatalog, type Catalog, type Message, type Problem } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';

export interface EntryFields {
  /** The source message. */
  message: string;
  /** The message in the translation's locale, when the entry is open there. */
  translation?: string;
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
  /** The entry in the translation's file, when the entry is open there. */
  translation?: string;
}

export interface EntryView {
  key: string;
  /** The source locale. */
  source: string;
  /** The translation's locale, or nothing when only the catalog entry is open. */
  locale?: string;
  /** Relative to the project root. */
  files: { catalog: string; translation?: string };
  fields: EntryFields;
  yaml: EntryYaml;
  /** The source message's placeholders. */
  argNames: string[];
  kinds: string[];
  surfaces: string[];
}

export type EntryEdit = { fields: EntryFields } | { yaml: EntryYaml };

/** The entry for `key`, with its translation in `locale` when it has one there. */
export function readEntry(config: ResolvedConfig, key: string, locale?: string): EntryView {
  return viewOf(config, loadCatalog(config), key, locale, new Map());
}

/**
 * Applies an edit and checks the catalog with it. With `write`, a clean edit is written; without, it
 * only comes back as the view, which is how the dialog turns fields into YAML and back.
 */
export function editEntry(
  config: ResolvedConfig,
  key: string,
  locale: string | undefined,
  edit: EntryEdit,
  write: boolean,
): { view?: EntryView; problems: Problem[] } {
  const current = viewOf(config, loadCatalog(config), key, locale, new Map());
  const paths = { catalog: join(config.root, current.files.catalog), translation: fileOf(config, current.files.translation) };
  const unsaved = new Map<string, string>();

  if ('yaml' in edit) {
    unsaved.set(resolve(paths.catalog), splice(paths.catalog, key, edit.yaml.catalog));
    if (paths.translation !== undefined && edit.yaml.translation !== undefined)
      unsaved.set(resolve(paths.translation), splice(paths.translation, key, edit.yaml.translation));
  } else {
    unsaved.set(resolve(paths.catalog), withFields(readFileSync(paths.catalog, 'utf8'), key, edit.fields, config.source));
    if (paths.translation !== undefined && edit.fields.translation !== undefined)
      unsaved.set(resolve(paths.translation), withTranslation(readFileSync(paths.translation, 'utf8'), key, edit.fields.translation));
  }

  let catalog: Catalog;
  try {
    catalog = loadCatalog(config, unsaved);
  } catch (e) {
    if (!(e instanceof CatalogError)) throw e;
    return { problems: e.problems.filter((p) => p.severity === 'error') };
  }
  if (!catalog.messages.some((m) => m.key === key)) {
    return {
      problems: [
        { severity: 'error', where: key, message: `the entry is still ${key}: rename a key in the code and the catalog together` },
      ],
    };
  }

  if (write) for (const [path, text] of unsaved) if (readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  return { view: viewOf(config, catalog, key, locale, unsaved), problems: [] };
}

const fileOf = (config: ResolvedConfig, file: string | undefined) => (file === undefined ? undefined : join(config.root, file));

function viewOf(
  config: ResolvedConfig,
  catalog: Catalog,
  key: string,
  locale: string | undefined,
  unsaved: Map<string, string>,
): EntryView {
  const message: Message | undefined = catalog.messages.find((m) => m.key === key);
  if (message === undefined) throw new Error(`no entry for "${key}" in the catalog: has it been renamed since the page loaded?`);
  const translation = locale === undefined || locale === config.source ? undefined : message.translations.get(locale);
  const text = (file: string) => unsaved.get(resolve(join(config.root, file))) ?? readFileSync(join(config.root, file), 'utf8');
  return {
    key,
    source: config.source,
    locale: translation === undefined ? undefined : locale,
    files: { catalog: message.file, translation: translation?.file },
    fields: {
      message: message.text,
      translation: translation?.text,
      context: message.context ?? '',
      kind: message.kind ?? '',
      surface: message.surface ?? '',
      fragment: message.fragment,
      args: Object.fromEntries(message.argDocs),
    },
    yaml: {
      catalog: snippetOf(text(message.file), key)?.text ?? '',
      translation: translation === undefined ? undefined : snippetOf(text(translation.file), key)?.text,
    },
    argNames: [...message.args.keys()],
    kinds: Object.keys(config.kinds),
    surfaces: Object.keys(config.surfaces),
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

function splice(path: string, key: string, yaml: string): string {
  const file = readFileSync(path, 'utf8');
  const at = snippetOf(file, key);
  if (at === undefined) throw new Error(`no entry for "${key}" in ${path}`);
  return file.slice(0, at.start) + yaml.replace(/\n+$/, '') + file.slice(at.end);
}

// As YAML 1.1, so a new value that 1.1 would read differently, like `n`, is quoted (as in migrate.ts).
const parse = (file: string) => parseDocument(file, { version: '1.1' });
const print = (doc: Document) => doc.toString({ lineWidth: 0 });

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

function withTranslation(file: string, key: string, translation: string): string {
  const doc = parse(file);
  const node = doc.get(key, true);
  if (isScalar(node)) {
    node.value = translation;
    if (translation.includes('\n')) node.type = Scalar.BLOCK_LITERAL;
  } else {
    doc.set(key, translation);
  }
  return print(doc);
}
