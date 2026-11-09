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

import type { Said } from '#src/runtime/formats.ts';
import { chainOf } from '#src/runtime/locale.ts';

import type { ResolvedConfig } from './config.ts';
import {
  argsOf,
  armsOf,
  closedType,
  DURATION,
  entryOf,
  extensionOf,
  LIST,
  openType,
  formatProblems,
  formatsOf,
  staticLiteral,
  tagsOf,
  takesText,
  TYPE,
  walk,
  type MessageFormatElement,
} from './icu.ts';
import type { Hardcoded } from './scan.ts';
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
  /** The least each plural's count can be, by argument: `sites` is 2 or more. */
  min: Map<string, number>;
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
  /**
   * Where the text stands in code, for an entry read from there rather than the catalog (`scanned.ts`):
   * its key is its words, and `file` the first place's.
   */
  places?: Hardcoded[];
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

const FIELDS = new Set(['kind', 'surface', 'context', 'args', 'closed', 'min', 'fragment', 'allow', 'comment', 'remove']);

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

  if (config.inCode) {
    error(
      'catalog is false in the config, so there is none to read: set catalog to a folder, or lint the text in code with prosebook lint',
    );
    throw new CatalogError(problems);
  }
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
  resolveEntries(config, byKey, locales, problems);
  attachMore(config, byKey, locales, problems);
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
  const min = leastCounts(entry.min, ast, fail);
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
    min,
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

/** A message in each locale it is written in, with the file it is written in. */
function readingsOf(config: ResolvedConfig, message: Message): { locale: string; ast: MessageFormatElement[]; file: string }[] {
  return [
    { locale: config.source, ast: message.ast, file: message.file },
    ...[...message.translations].map(([locale, t]) => ({ locale, ast: t.ast, file: t.file })),
  ];
}

/**
 * `{app.title, entry}`: a name said in another message. Each reference is given the name's text in
 * the locale the message is read in, or the nearest one translating it, its selects at the arm the
 * reference's form names (`other` without one), so the compiler and every target write it as text.
 * Only a name may be said, and it is text alone: a placeholder would have to come from a call site
 * that can't see it. One that can't be resolved shows as `{app.title}`, beside its error.
 */
function resolveEntries(config: ResolvedConfig, byKey: Map<string, Message>, locales: string[], problems: Problem[]): void {
  const error = (key: string, file: string, message: string) => problems.push({ severity: 'error', file, key, message });
  const all = [config.source, ...locales];
  const said = new Set<string>();

  const textOf = (key: string, locale: string, form: string | null, from: string[]): string | Error => {
    const name = byKey.get(key);
    if (name === undefined)
      return new Error(`{${key}, entry} names no entry: say a name the catalog has (prosebook find finds one by its words)`);
    if (name.kind !== 'name') {
      const kind = name.kind ?? 'unset';
      return new Error(
        `{${key}, entry} says an entry of kind ${kind}: only a name can be said in another message, so write its words here`,
      );
    }
    if (from.includes(key))
      return new Error(`{${key}, entry} says itself, through ${[...from, key].join(' → ')}: write the words in one of them`);
    said.add(key);
    const found = chainOf(locale, all, config.source).find((l) => l === config.source || name.translations.has(l)) ?? config.source;
    const ast = found === config.source ? name.ast : name.translations.get(found)!.ast;
    let text = '';
    let picked = false;
    const forms = new Set<string>();
    const visit = (elements: MessageFormatElement[]): Error | undefined => {
      for (const el of elements) {
        const inner = entryOf(el);
        if (inner !== undefined) {
          const got = textOf(inner.value, locale, inner.form, [...from, key]);
          if (got instanceof Error) return got;
          text += got;
        } else if (el.type === TYPE.literal) {
          text += el.value;
        } else if (el.type === TYPE.select) {
          for (const arm of Object.keys(el.options)) if (arm !== 'other') forms.add(arm);
          const arm = form === null ? undefined : el.options[form];
          if (arm !== undefined) picked = true;
          const failed = visit((arm ?? el.options.other!).value);
          if (failed !== undefined) return failed;
        }
        // Anything else is reported on the name itself, below.
      }
      return undefined;
    };
    const failed = visit(ast);
    if (failed !== undefined) return failed;
    if (form !== null && !picked) {
      const has = forms.size > 0 ? `: ${[...forms].join(', ')}` : ', only its one text';
      return new Error(`{${key}, entry, ${form}} asks for a form ${key} doesn't have in ${found}${has}`);
    }
    return text;
  };

  for (const message of byKey.values()) {
    for (const { locale, ast, file } of readingsOf(config, message)) {
      walk(ast, (el) => {
        const ref = entryOf(el);
        if (ref === undefined) return;
        const text = textOf(ref.value, locale, ref.form, [message.key]);
        if (text instanceof Error) error(message.key, file, text.message);
        ref.text = text instanceof Error ? `{${ref.value}}` : text;
      });
    }
  }

  for (const key of said) {
    const name = byKey.get(key)!;
    for (const { ast, file } of readingsOf(config, name)) {
      walk(ast, (el) => {
        const what = el.type === TYPE.tag ? `<${el.value}>` : el.type === TYPE.pound ? '#' : 'value' in el ? `{${el.value}}` : undefined;
        if (what === undefined || el.type === TYPE.select || el.type === TYPE.literal || entryOf(el) !== undefined) return;
        error(key, file, `is said in other messages ({${key}, entry}), so it is text, with selects for its forms: leave out ${what}`);
      });
    }
  }
}

/** What each option a format says itself is given, by kind and option: `more` the rest's `{count}`, a number. */
const SAID: Record<string, Record<string, { given?: string; what: string; add: string; fix: string }>> = {
  list: {
    more: { given: 'count', what: 'says the rest of a list', add: 'saying the rest with {count}', fix: 'say it with {count, plural, …}' },
    separator: {
      what: "goes between a list's items",
      add: "saying what goes between two items, as ' · '",
      fix: "say it as text, as ' · ', with a tag around it if it is an element",
    },
  },
  relative: {
    now: {
      given: 'tense',
      what: 'says now for a relative time',
      add: 'saying now, as "just now", with {tense} if it tells past from future',
      fix: '{tense, select, future {in a moment} other {just now}}',
    },
  },
};

/**
 * What a format says itself (`Said`): a list's `more` and `separator`, given `{count}` and nothing, and a relative time's
 * `now`, given `{tense}`. Each is read in the locale the placeholder is: text in the catalog's syntax, as that locale's
 * options have it, or the entry it names, in that locale or the nearest one translating it. It is set on the placeholder
 * for the compiler, so every locale module holds what it says. Its tags are the message's, so its rich reads render them.
 */
function attachMore(config: ResolvedConfig, byKey: Map<string, Message>, locales: string[], problems: Problem[]): void {
  const error = (message: Pick<Message, 'file' | 'key'> | undefined, text: string) =>
    problems.push({ severity: 'error', ...(message && { file: message.file, key: message.key }), message: text });
  const checked = new Set<string>();
  const read = new Map<string, MessageFormatElement[] | undefined>();
  /** Text a format says, read once per locale; nothing, and its error, where it can't be read or takes what it isn't given. */
  const textIn = (text: string, locale: string, at: string, given: string | undefined, fix: string) => {
    const id = `${at}\u0000${locale}\u0000${text}`;
    if (read.has(id)) return read.get(id);
    let ast: MessageFormatElement[] | undefined;
    try {
      ast = readMessage(config.messageFormat, text, locale, config);
      const others = [...argsOf(ast).keys()].filter((a) => a !== given);
      if (others.length > 0) {
        error(
          undefined,
          `${at} takes {${others.join('}, {')}}, and is given ${given === undefined ? 'nothing' : `{${given}} alone`}: ${fix}`,
        );
        ast = undefined;
      }
    } catch (e) {
      error(undefined, `${at} is not a message: ${(e as Error).message}`);
    }
    read.set(id, ast);
    return ast;
  };
  for (const message of byKey.values()) {
    for (const { locale, ast } of readingsOf(config, message)) {
      walk(ast, (el) => {
        const own = extensionOf(el);
        if (own === undefined || own.type === DURATION) return;
        const kind = own.type === LIST ? 'list' : 'relative';
        for (const [option, { given, what, add, fix }] of Object.entries(SAID[kind]!)) {
          const said = (own.options as Record<string, Said | undefined> | undefined)?.[option];
          if (said === undefined) continue;
          const at = `formats.${kind}.${own.named}.${option}`;
          let text: MessageFormatElement[] | undefined;
          if (typeof said === 'string') {
            // A key, as `more` and `now` took before they took text: said as text, it would show the key.
            if (KEY_PATTERN.test(said) && byKey.has(said)) {
              if (checked.has(at)) continue;
              checked.add(at);
              error(
                undefined,
                `${at} is text, and ${said} is an entry's key: write ${option}: { entry: '${said}' } to say it with the entry`,
              );
              continue;
            }
            text = textIn(said, locale, at, given, fix);
          } else {
            const entry = byKey.get(said.entry);
            if (entry === undefined) {
              if (locale === config.source)
                error(message, `{${own.value}} is shown as ${at} says, and the catalog has no ${said.entry}: add it, ${add}`);
              continue;
            }
            if (!checked.has(said.entry)) {
              checked.add(said.entry);
              const others = [...entry.args.keys()].filter((a) => a !== given);
              const retyped = given === 'count' && entry.args.has('count') && entry.args.get('count') !== 'number';
              if (others.length > 0 || retyped) {
                const kind = given === 'count' ? ', a number' : given === 'tense' ? ', past or future' : '';
                const takes = given === undefined ? 'nothing' : `{${given}} alone${kind}`;
                error(entry, `${what} (${at}), which gives it ${takes}: ${fix}`);
              }
            }
            const chain = chainOf(locale, [config.source, ...locales], config.source);
            text = chain.map((l) => (l === config.source ? entry.ast : entry.translations.get(l)?.ast)).find((a) => a !== undefined);
          }
          if (text === undefined) continue;
          (own as unknown as Record<string, MessageFormatElement[]>)[option] = text;
          // What it says renders among the message's own parts, through the same renderers.
          if (locale === config.source) for (const tag of tagsOf(text)) if (!message.tags.includes(tag)) message.tags.push(tag);
        }
      });
    }
  }
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

/**
 * `min: { sites: 2 }`: the least a plural's count can be, so `plural-forms` asks only for the forms
 * counts from there reach. English's one is 1 alone, so it isn't asked for; Russian's is 21 too.
 */
function leastCounts(value: unknown, ast: MessageFormatElement[], fail: (m: string) => void): Map<string, number> {
  const min = new Map<string, number>();
  if (value === undefined) return min;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('min is the least each plural count can be: min: { count: 2 }');
    return min;
  }
  const counted = new Set<string>();
  walk(ast, (el) => {
    if (el.type === TYPE.plural) counted.add(el.value);
  });
  for (const [name, least] of Object.entries(value)) {
    if (!counted.has(name)) fail(`min.${name} is not the count of a plural in this message`);
    else if (typeof least !== 'number' || !Number.isInteger(least) || least < 0) fail(`min.${name} is a whole number: min: { ${name}: 2 }`);
    else min.set(name, least);
  }
  return min;
}

/** How a translation's placeholders or tags differ from the source, or nothing. */
function driftFrom(message: Message, ast: MessageFormatElement[]): string | undefined {
  const args = argsOf(ast);
  const missing = [...message.args.keys()].filter((a) => !args.has(a));
  // A name's translation may select among forms its language has and the source's doesn't: a case.
  const forms = (a: string) => message.kind === 'name' && armsOf(args.get(a)!).length > 0;
  const extra = [...args.keys()].filter((a) => !message.args.has(a) && !forms(a));
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
function heldAs(message: Message, name: string): string {
  return message.args.has(name) ? `{${name}}` : `<${name}>`;
}

/**
 * What a translator is told of each placeholder and tag: `args`, and a count's `min`, which decides
 * the forms their plural needs as much as the words do.
 */
export function argNotes(message: Message): [string, string][] {
  const names = [...new Set([...message.argDocs.keys(), ...message.min.keys()])];
  return names.map((name) => {
    const least = message.min.get(name);
    const said = [message.argDocs.get(name), least === undefined ? undefined : `always ${least} or more`];
    return [heldAs(message, name), said.filter((s) => s !== undefined).join('; ')];
  });
}

/** The source message as a reader sees it with no placeholders filled: for docs and reports. */
export function previewOf(message: Message): string {
  return staticLiteral(message.ast) ?? message.text;
}
