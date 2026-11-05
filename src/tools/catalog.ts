/**
 * Reads the catalog and its translations into one checked model.
 *
 * Every message is parsed as ICU here rather than at runtime, which is what lets the generator hand
 * TypeScript exact argument types, compile messages to plain functions, and fail the build where a
 * translation's placeholders drifted from the source instead of dropping a value off the screen.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { isMap, isScalar, LineCounter, parseDocument, parse as parseYaml, Scalar } from 'yaml';

import type { ResolvedConfig } from './config.ts';
import {
  argsOf,
  armsOf,
  closedType,
  openType,
  formatProblems,
  formatsOf,
  staticLiteral,
  tagsOf,
  takesText,
  type MessageFormatElement,
} from './icu.ts';
import { readMessage } from './syntax.ts';

export interface Translation {
  text: string;
  ast: MessageFormatElement[];
  file: string;
}

export interface Message {
  key: string;
  /** The first segment of the key, which names its file. */
  area: string;
  file: string;
  kind?: string;
  surface?: string;
  /** One sentence telling a translator where the string appears. */
  context?: string;
  /** What each placeholder holds, keyed by argument name, and what each tag wraps, by tag. */
  argDocs: Map<string, string>;
  /** Completes something beside it rather than standing as a sentence, so sentence rules do not apply. */
  fragment: boolean;
  /** Lint rules the entry is exempt from, each with the reason. */
  allow: Map<string, string>;
  /** A change someone asked for, left for whoever edits the entry next, and deleted once it is made. */
  comment?: string;
  /** Select arguments that take only the arms they name, which their type says. */
  closed: string[];
  /** Asked to go: the entry, its translations and the code that reads it. */
  remove: boolean;
  /** The source message, in ICU MessageFormat. */
  text: string;
  ast: MessageFormatElement[];
  /** Argument name to TypeScript type. */
  args: Map<string, string>;
  /** How each formatted argument is styled, for the doc comment at the call site. */
  argFormats: Map<string, string>;
  tags: string[];
  /** Translations by locale. */
  translations: Map<string, Translation>;
}

export interface Problem {
  severity: 'error' | 'warn';
  /** Relative to the project root; none for a problem that isn't in a file. */
  file?: string;
  /** The entry it is about, in `file`; none for the file as a whole. */
  key?: string;
  message: string;
}

/** `file key`, as the CLI names where a problem is. */
export function whereOf(problem: Problem): string {
  return [problem.file, problem.key].filter((s) => s !== undefined).join(' ');
}

export interface Catalog {
  messages: Message[];
  /** The translated locales found under `locales`, without the source. */
  locales: string[];
  /** Errors among them only when loaded `partial`: each broken entry or translation is left out. */
  problems: Problem[];
}

export interface LoadOptions {
  /**
   * Leave out each broken entry and translation, and an unreadable file's, rather than throw: the
   * errors ride along in `problems`, so the rest of the catalog can still be generated and checked.
   */
  partial?: boolean;
}

export class CatalogError extends Error {
  readonly problems: Problem[];

  constructor(problems: Problem[]) {
    super(`the catalog has ${problems.length} problem(s):\n  ${problems.map((p) => `${whereOf(p)}: ${p.message}`).join('\n  ')}`);
    this.problems = problems;
  }
}

/**
 * A key is dotted lowercase, two segments at least, and its first segment names the file it lives
 * in. Keys are read at every call site, so they say what the string is for: `cart.checkout.title`.
 */
export const KEY_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)+$/;

const FIELDS = new Set(['kind', 'surface', 'context', 'args', 'closed', 'fragment', 'allow', 'comment', 'remove']);

/**
 * Loads and checks the catalog. Throws a `CatalogError` when anything is an error, unless `partial`;
 * warnings ride along. `unsaved` holds file contents by absolute path to read in place of what is on
 * disk, so an edit can be checked before it is written; a translation file in it that isn't on disk
 * yet is read too.
 */
export function loadCatalog(config: ResolvedConfig, unsaved?: ReadonlyMap<string, string>, options: LoadOptions = {}): Catalog {
  const read = (path: string) => unsaved?.get(resolve(path)) ?? readFileSync(path, 'utf8');
  const problems: Problem[] = [];
  const error = (message: string, file?: string, key?: string) => problems.push({ severity: 'error', file, key, message });
  const byKey = new Map<string, Message>();
  // Keys whose entry is broken: their translations are left out with them, not reported as unused.
  const broken = new Set<string>();
  const rel = (path: string) => relative(config.root, path).replaceAll('\\', '/');

  if (!existsSync(config.catalog)) {
    error('no catalog folder here: run `prosebook init`, or set `catalog` in the config', rel(config.catalog));
    throw new CatalogError(problems);
  }

  const created = [...(unsaved?.keys() ?? [])].filter((path) => !existsSync(path));
  // A catalog file an edit would create, a rename into a new area, read as if it were there already.
  const newAreas = created.filter((path) => resolve(path, '..') === resolve(config.catalog) && path.endsWith('.yaml'));
  for (const file of [...yamlFiles(config.catalog), ...newAreas.map((path) => relative(config.catalog, path))].sort()) {
    const area = file.slice(0, -'.yaml'.length);
    const path = join(config.catalog, file);
    const at = rel(path);
    for (const [key, value] of Object.entries(readEntries(read(path), (m) => error(m, at)))) {
      if (!KEY_PATTERN.test(key)) {
        error('a key is dotted lowercase with two segments at least: `area.thing`', at, key);
        continue;
      }
      if (key.slice(0, key.indexOf('.')) !== area) {
        error(`a key in ${file} starts with "${area}."`, at, key);
        continue;
      }
      if (byKey.has(key)) {
        error('duplicate key', at, key);
        continue;
      }
      const message = readEntry(key, area, at, value, config, (m) => error(m, at, key));
      if (!message) {
        broken.add(key);
        continue;
      }
      byKey.set(key, message);
      // Asked of whoever edits next, often an agent, which finds them among the warnings of every run.
      const warn = (m: string) => problems.push({ severity: 'warn', file: at, key, message: m });
      if (message.remove) warn('marked for removal: delete the entry, its translations and the code that reads it');
      if (message.comment !== undefined) warn(`a comment to act on, then delete: ${message.comment}`);
      // `prosebook extract`'s drafts, which only a person or an agent reading the code can finish.
      if (message.context?.startsWith('TODO') === true) warn('context is a draft: say where the string appears and what it does');
      for (const [name, said] of message.argDocs) if (said.startsWith('TODO')) warn(`args.${name} is a draft: say what it holds`);
    }
  }

  const locales = readLocales(config, byKey, broken, problems, rel, read, created);
  if (options.partial !== true && problems.some((p) => p.severity === 'error')) throw new CatalogError(problems);
  return { messages: [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), locales, problems };
}

function readEntry(
  key: string,
  area: string,
  file: string,
  value: unknown,
  config: ResolvedConfig,
  error: (message: string) => void,
): Message | undefined {
  // `key: message` is the shorthand for an entry with nothing to say about itself.
  const entry = (typeof value === 'string' ? { [config.source]: value } : value) as Record<string, unknown> | null;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    error(`an entry is a message, or a mapping holding \`${config.source}\` and what the string is`);
    return undefined;
  }
  let ok = true;
  const fail = (message: string) => {
    error(message);
    ok = false;
  };
  for (const field of Object.keys(entry))
    if (!FIELDS.has(field) && field !== config.source) fail(`"${field}" is not a field: ${[...FIELDS, config.source].join(', ')}`);

  const text = entry[config.source];
  if (typeof text !== 'string' || text === '') {
    fail(`${config.source} is the message, and it is missing`);
    return undefined;
  }
  for (const field of config.require) if (entry[field] === undefined) fail(`${field} is required (\`require\` in the config)`);

  const kind = optionalString(entry, 'kind', fail);
  if (kind !== undefined && !(kind in config.kinds)) fail(`kind is one of ${Object.keys(config.kinds).join(', ')}`);
  const surface = optionalString(entry, 'surface', fail);
  if (surface !== undefined && !(surface in config.surfaces)) fail(`surface is one of ${Object.keys(config.surfaces).join(', ')}`);
  const context = optionalString(entry, 'context', fail);
  if (entry.fragment !== undefined && typeof entry.fragment !== 'boolean') fail('fragment is true or false');
  const comment = optionalString(entry, 'comment', fail);
  if (entry.remove !== undefined && typeof entry.remove !== 'boolean') fail('remove is true or false');

  let ast: MessageFormatElement[];
  try {
    ast = readMessage(config.messageFormat, text, config.source, config);
  } catch (e) {
    fail(syntaxError(config, text, e));
    return undefined;
  }
  for (const problem of formatProblems(ast)) fail(problem);
  const args = argsOf(ast, (name) => fail(`"${name}" is used as two different types`));
  const argDocs = stringMap(entry, 'args', fail);
  // An undocumented placeholder is fine unless context is required; a doc for an argument that no
  // longer exists is always stale.
  if (config.require.includes('context'))
    for (const name of args.keys()) if (!argDocs.has(name)) fail(`args.${name} is missing: say what the placeholder holds`);

  const closed = closedArgs(entry.closed, args, fail);
  const tags = tagsOf(ast);
  for (const name of argDocs.keys())
    if (!args.has(name) && !tags.includes(name)) fail(`args.${name} is neither a placeholder nor a tag of this message`);

  if (!ok) return undefined;
  return {
    key,
    area,
    file,
    kind,
    surface,
    context,
    argDocs,
    fragment: entry.fragment === true,
    allow: stringMap(entry, 'allow', fail),
    closed,
    comment,
    remove: entry.remove === true,
    text,
    ast,
    args,
    argFormats: formatsOf(ast),
    tags,
    translations: new Map(),
  };
}

function readLocales(
  config: ResolvedConfig,
  byKey: Map<string, Message>,
  broken: Set<string>,
  problems: Problem[],
  rel: (p: string) => string,
  read: (path: string) => string,
  created: string[],
): string[] {
  if (!existsSync(config.locales)) return [];
  const files = new Map<string, string[]>();
  for (const name of readdirSync(config.locales).sort()) {
    const path = join(config.locales, name);
    const isDir = statSync(path).isDirectory();
    if (!isDir && !name.endsWith('.yaml')) continue;
    const locale = isDir ? name : name.slice(0, -'.yaml'.length);
    const found = isDir ? yamlFiles(path).map((f) => join(path, f)) : [path];
    files.set(locale, [...(files.get(locale) ?? []), ...found]);
  }
  // A translation file an edit would create, read as if it were there already.
  for (const path of created) {
    const inside = relative(config.locales, path).replaceAll('\\', '/');
    if (inside.startsWith('..') || !inside.endsWith('.yaml')) continue;
    const [first = '', second] = inside.split('/');
    const locale = second === undefined ? first.slice(0, -'.yaml'.length) : first;
    files.set(locale, [...(files.get(locale) ?? []), path]);
  }
  files.delete(config.source);

  for (const [locale, paths] of files) {
    for (const path of paths) {
      const file = rel(path);
      const error = (message: string, key?: string) => problems.push({ severity: 'error', file, key, message });
      for (const [key, value] of Object.entries(readEntries(read(path), error))) {
        const message = byKey.get(key);
        if (message === undefined && broken.has(key)) continue;
        if (message === undefined) {
          problems.push({ severity: 'warn', file, key, message: 'no such key in the catalog, so this translation is unused' });
          continue;
        }
        if (typeof value !== 'string' || value === '') {
          error('a translation is the message, as a string', key);
          continue;
        }
        let ast: MessageFormatElement[];
        try {
          ast = readMessage(config.messageFormat, value, locale, config);
        } catch (e) {
          error(syntaxError(config, value, e), key);
          continue;
        }
        const drift = driftFrom(message, ast);
        if (drift !== undefined) {
          error(drift, key);
          continue;
        }
        for (const problem of formatProblems(ast)) error(problem, key);
        message.translations.set(locale, { text: value, ast, file });
      }
    }
  }
  return [...files.keys()];
}

/**
 * `closed: [mode]`: each a select's argument, whose type becomes the arms it names, so a call site
 * can't pass a value no arm was written for. `args` is given the closed types in place.
 */
function closedArgs(value: unknown, args: Map<string, string>, fail: (m: string) => void): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    fail('closed is a list of select arguments: closed: [mode]');
    return [];
  }
  for (const name of value) {
    const type = args.get(name);
    if (type === undefined || armsOf(type).length === 0) fail(`closed.${name} is not a select with arms of its own in this message`);
    else args.set(name, closedType(type));
  }
  return value;
}

/** How a translation's placeholders or tags differ from the source, or nothing. */
function driftFrom(message: Message, ast: MessageFormatElement[]): string | undefined {
  const args = argsOf(ast);
  const missing = [...message.args.keys()].filter((a) => !args.has(a));
  const extra = [...args.keys()].filter((a) => !message.args.has(a));
  // A closed argument's translation selects among the source's arms, and on no other.
  const source = (a: string) => (message.closed.includes(a) ? openType(message.args.get(a)!) : message.args.get(a)!);
  const retyped = [...args]
    .filter(([a, type]) => message.args.has(a) && source(a) !== type && !(takesText(type) && takesText(source(a))))
    .map(([a]) => a);
  const unnamed = message.closed.flatMap((a) => {
    const arms = new Set(armsOf(source(a)));
    return armsOf(args.get(a) ?? '')
      .filter((arm) => !arms.has(arm))
      .map((arm) => `{${a}} selects on "${arm}", which no closed arm of the source names`);
  });
  const tags = tagsOf(ast);
  const parts = [
    missing.length > 0 ? `missing {${missing.join('}, {')}}` : '',
    extra.length > 0 ? `unknown {${extra.join('}, {')}}` : '',
    retyped.length > 0 ? `{${retyped.join('}, {')}} used as another type` : '',
    ...unnamed,
    tags.join() === message.tags.join()
      ? ''
      : `tags are <${tags.join('>, <') || 'none'}>, the source has <${message.tags.join('>, <') || 'none'}>`,
  ].filter(Boolean);
  return parts.length > 0 ? `differs from the source: ${parts.join('; ')}` : undefined;
}

function syntaxError(config: ResolvedConfig, text: string, e: unknown): string {
  // MF2's reader words its own problems; see mf2.ts.
  if (config.messageFormat === 2) return (e as Error).message;
  return icuError(text, e);
}

function icuError(text: string, e: unknown): string {
  // The parser says only EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT for an arm it can't name.
  const arm = /select\s*,/.test(text) ? /[,}]\s*(?!=)([^\s{},]*[^\w\s{},][^\s{},]*)\s*\{/u.exec(text)?.[1] : undefined;
  if (arm !== undefined)
    return `names a select arm "${arm}": an arm's name is letters, digits and _, so write it ${arm.replace(/\W+/gu, '_')} and map the value to it in code, or write the catalog in MF2, which quotes it: |${arm}|`;
  const reason = (e as Error).message;
  if (/TAG/.test(reason)) return `is not valid ICU (${reason}): a literal < is written '<'`;
  return `is not valid ICU MessageFormat: ${reason}`;
}

/** The first line of a catalog file: the YAML language server finds the schema `generate` writes only through it. */
export const SCHEMA_LINE = '# yaml-language-server: $schema=./catalog.schema.json';

/** `text` opening with the schema line, unless it opens with a schema line of its own already. */
export function withSchemaLine(text: string): string {
  if (text.startsWith('# yaml-language-server:')) return text;
  return `${SCHEMA_LINE}${text.includes('\r\n') ? '\r\n' : '\n'}${text}`;
}

export function yamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();
}

/**
 * The file's entries. YAML 1.1 and 1.2 disagree about bare scalars: 1.1 reads `n`, `on` and `yes` as
 * booleans and `12:30` as a number. Translation tools are often 1.1, so a file that reads differently
 * under each fails here, naming the value to quote, rather than corrupting quietly in the next tool.
 */
function readEntries(text: string, error: (message: string) => void): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    error(`is not valid YAML: ${(e as Error).message}`);
    return {};
  }
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    error('a catalog file is a mapping of key to entry');
    return {};
  }
  try {
    const found = divergence(raw, parseYaml(text, { version: '1.1' }), '');
    if (found !== undefined) error(found);
  } catch (e) {
    error(`does not parse as YAML 1.1, which another tool may well be: ${(e as Error).message}`);
  }
  return raw as Record<string, unknown>;
}

function divergence(a: unknown, b: unknown, path: string): string | undefined {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (Object.is(a, b)) return undefined;
    return `${path} reads as ${JSON.stringify(a)} under YAML 1.2 and ${JSON.stringify(b)} under YAML 1.1: quote it`;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const here = path === '' ? key : `${path}.${key}`;
    if (key in left !== key in right) return `${here} is a key under YAML ${key in left ? '1.2' : '1.1'} only: quote it`;
    const found = divergence(left[key], right[key], here);
    if (found !== undefined) return found;
  }
  return undefined;
}

function optionalString(entry: Record<string, unknown>, field: string, fail: (m: string) => void): string | undefined {
  const value = entry[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${field} is a non-empty string`);
    return undefined;
  }
  return value.trim();
}

function stringMap(entry: Record<string, unknown>, field: string, fail: (m: string) => void): Map<string, string> {
  const out = new Map<string, string>();
  const value = entry[field];
  if (value === undefined) return out;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} is a mapping of name to sentence`);
    return out;
  }
  for (const [name, said] of Object.entries(value)) {
    if (typeof said !== 'string' || said.trim() === '') fail(`${field}.${name} is a sentence`);
    else out.set(name, said.trim());
  }
  return out;
}

export interface EntryLocation {
  /** Absolute. */
  file: string;
  /** From 1. */
  line: number;
  /** From 1. */
  column: number;
}

/**
 * Where a message's entry is written: its translation in `locale` when there is one, else the catalog.
 * Read from the file as it is now, so an entry moved since the catalog was loaded is still found.
 */
export function entryLocation(config: ResolvedConfig, message: Message, locale?: string): EntryLocation {
  const file = (locale === undefined ? undefined : message.translations.get(locale)?.file) ?? message.file;
  return { file: join(config.root, file), ...entryLocator(config.root)(file, message.key) };
}

/**
 * Finds a key's line and column in a catalog or translation file, given relative to `root`. Each file
 * is read once, so a report that places many entries parses each file once. A key it can't find, or no
 * key, is the top of the file.
 *
 * Given an `offset` into the message (under `field`, in an entry that is a mapping), it is that
 * character, when the value is written in the file as it reads up to there: plain, or quoted on one
 * line with nothing escaped before it. Otherwise it is the key.
 */
export function entryLocator(root: string): (file: string, key?: string, offset?: number, field?: string) => Omit<EntryLocation, 'file'> {
  const read = new Map<string, { doc: ReturnType<typeof parseDocument>; lines: LineCounter; source: string }>();
  return (file, key, offset, field) => {
    let parsed = read.get(file);
    if (parsed === undefined) {
      const path = join(root, file);
      const lines = new LineCounter();
      const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
      parsed = { doc: parseDocument(source, { lineCounter: lines }), lines, source };
      read.set(file, parsed);
    }
    const { doc, lines, source } = parsed;
    const pair =
      key !== undefined && isMap(doc.contents) ? doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key) : undefined;
    const value = isMap(pair?.value) && field !== undefined ? pair.value.get(field, true) : pair?.value;
    if (offset !== undefined && isScalar(value) && typeof value.value === 'string' && value.range) {
      const quoted = value.type === Scalar.QUOTE_DOUBLE || value.type === Scalar.QUOTE_SINGLE;
      const content = value.range[0] + (quoted ? 1 : 0);
      if (source.slice(content, content + offset) === value.value.slice(0, offset)) {
        const { line, col } = lines.linePos(content + offset);
        return { line, column: col };
      }
    }
    const start = isScalar(pair?.key) ? pair.key.range?.[0] : undefined;
    if (start === undefined) return { line: 1, column: 1 };
    const { line, col } = lines.linePos(start);
    return { line, column: col };
  };
}

/** What `args` describes by `name`, as the message writes it: `{count}`, or a tag's `<link>`. */
export function heldAs(message: Message, name: string): string {
  return message.args.has(name) ? `{${name}}` : `<${name}>`;
}

/** The source message as a reader sees it with no placeholders filled: for docs and reports. */
export function previewOf(message: Message): string {
  return staticLiteral(message.ast) ?? message.text;
}
