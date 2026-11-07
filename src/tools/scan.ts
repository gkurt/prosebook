/**
 * What the code says: text a person reads that is still written in a component, and which catalog
 * keys the code names.
 *
 * Key references are found by reading string literals, not by tracing calls, so a key kept in an
 * array or a map still counts, and `nav.${id}` or `'nav.' + id` keeps every key under `nav.`. That
 * errs towards keeping a key, which is the safe direction both for `unused` and for pruning a bundle.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, matchesGlob, relative } from 'node:path';

import { parseSync } from 'oxc-parser';

import { formatIn, type Formats, type FormatTable } from '#src/runtime/formats.ts';
import { beyondOptions } from '#src/tools/icu.ts';

import type { ScanOptions } from './config.ts';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git']);

export function sourceFiles(dirs: string[], extensions: string[], skip: string[] = []): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      if (skip.some((s) => path === s || path.startsWith(`${s}/`) || path.startsWith(`${s}\\`))) continue;
      if (statSync(path).isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) visit(path);
      } else if (extensions.includes(extname(name)) && !name.endsWith('.d.ts')) {
        files.push(path);
      }
    }
  };
  for (const dir of dirs) visit(dir);
  return files.sort();
}

/** Whether a file, named from the root with `/`, is one `patterns` names, or in a folder one names: `src/server`, `**\/*.server.ts`. */
function isIgnored(file: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesGlob(file, p) || matchesGlob(file, `${p}/**`));
}

export interface KeyRefs {
  exact: Set<string>;
  /** `nav.` from `nav.${id}` or `'nav.' + id`: every key under it may be read. */
  prefixes: Set<string>;
}

const LITERAL_KEY = /(['"`])([a-z0-9][\w-]*(?:\.[\w-]+)+)\1/g;
const KEY_PREFIX = /(['"`])([a-z0-9][\w-]*(?:\.[\w-]+)*\.)(?:\1|\$\{)/g;

export function keyRefs(code: string, into: KeyRefs = { exact: new Set(), prefixes: new Set() }): KeyRefs {
  for (const m of code.matchAll(LITERAL_KEY)) into.exact.add(m[2]!);
  for (const m of code.matchAll(KEY_PREFIX)) into.prefixes.add(m[2]!);
  return into;
}

export function isReferenced(key: string, refs: KeyRefs): boolean {
  if (refs.exact.has(key)) return true;
  for (const prefix of refs.prefixes) if (key.startsWith(prefix)) return true;
  return false;
}

export interface Hardcoded {
  file: string;
  line: number;
  column: number;
  text: string;
  /** Where it sits: `text`, the attribute or property it is the value of, or the function it is passed to. */
  where: string;
  /** How `where` holds it: as JSX's text or an attribute, a call's argument or a property's value. */
  via: 'jsx' | 'call' | 'property';
}

/** `where` as the code says it: `title=`, `toast.error(…)`, `label:`, or nothing for text. */
export function whereOf(h: Hardcoded): string {
  if (h.where === 'text') return '';
  return h.via === 'call' ? `${h.where}(…) ` : h.via === 'property' ? `${h.where}: ` : `${h.where}=`;
}

type Node = { type: string; start: number; end: number; [field: string]: unknown };

/** A token of code: a path, a call, an identifier with an underscore, a dotted name or a glob, or an ID such as `us-west-2`. */
const codeToken = (token: string) => /[/()_=<>{}[\].*]|::/.test(token) || (/^[\w-]+$/.test(token) && /\d/.test(token) && /-/.test(token));

/**
 * Text that reads as code rather than prose, as in `form.json()`, `src/index.ts`, `us-west-2` or a
 * list of hosts: tokens that are each code, or a shell command, which runs one after another (`&&`)
 * or takes a flag (`-y`). Trailing punctuation doesn't count, so `Done.` is still prose.
 */
export function looksLikeCode(text: string): boolean {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[.!?:,…]+$/, ''))
    .filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.every(codeToken)) return true;
  return /(?:^|\s)(?:&&|\|\|)(?=\s)/.test(text) || /(?:^|\s)--?[a-z][\w-]*(?=\s|$)/.test(text) || /^\s*(?:sudo|\$)\s/.test(text);
}

/** Elements whose text is code, keys or markup, not prose: `<kbd>`, and components named for them, `<Kbd>`. */
const NON_PROSE_ELEMENTS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'path']);
export const isNonProse = (name: string) => NON_PROSE_ELEMENTS.has(name.toLowerCase());
/** Tests and stories hold text a person never reads in the app: fixtures, expectations. */
const NOT_APP = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;

/**
 * The literals an expression can come to, which the screen shows where it is rendered: both arms of
 * `pending ? 'Saving…' : 'Save'`, the fallback of `x ?? 'None'`, `` `Open ${name}` ``. Not what
 * it passes to calls, which may be keys or code.
 */
export function shownLiterals(node: Node | undefined): Node[] {
  if (node === undefined) return [];
  if (WRAPPERS.has(node.type)) return shownLiterals(node.expression as Node);
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' ? [node] : [];
    case 'TemplateLiteral':
      return [node];
    case 'ConditionalExpression':
      return [...shownLiterals(node.consequent as Node), ...shownLiterals(node.alternate as Node)];
    case 'LogicalExpression':
      return node.operator === '&&'
        ? shownLiterals(node.right as Node)
        : [...shownLiterals(node.left as Node), ...shownLiterals(node.right as Node)];
    default:
      return [];
  }
}

/** A call's name as written, `toast.error` or `alert`, and its first part, which `calls` names. */
function calleeOf(node: Node): { name: string; root: string } | undefined {
  if (node.type === 'Identifier') return { name: node.name as string, root: node.name as string };
  if (node.type !== 'MemberExpression' || node.computed === true) return undefined;
  const object = calleeOf(node.object as Node);
  const property = node.property as Node;
  return object === undefined || property.type !== 'Identifier'
    ? undefined
    : { name: `${object.name}.${property.name as string}`, root: object.root };
}

function propertyName(node: Node): string | undefined {
  const key = node.key as Node;
  if (node.computed === true) return undefined;
  return key.type === 'Identifier' ? (key.name as string) : key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}
const LETTER = /\p{L}/u;

/** Offsets in `code` as lines and columns, and whether a line is marked `prosebook-ignore`, on it or the line above. */
function lineIndex(code: string) {
  const lines = code.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const position = (at: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: at - lineStarts[lo]! + 1 };
  };
  const ignored = (line: number) =>
    (lines[line - 1] ?? '').includes('prosebook-ignore') || (lines[line - 2] ?? '').includes('prosebook-ignore');
  return { position, ignored };
}

/**
 * Literal text a person reads, where it should be a catalog entry: JSX's text and readable attributes,
 * what their expressions render (`{pending ? 'Saving…' : 'Save'}`), what the `calls` it names are
 * given (`toast.error('…')`), and in a component the `properties` it names (`label: '…'`), outside
 * tests and stories.
 */
export function hardcodedText(file: string, code: string, options: Pick<ScanOptions, 'attributes'> & Partial<ScanOptions>): Hardcoded[] {
  const { attributes, calls = [], properties = [] } = options;
  const app = !NOT_APP.test(file);
  // A label map sits in a component; elsewhere, a `title` or `description` is as often a model's or an API's.
  const component = /\.[jt]sx$/.test(file);
  const { program } = parseSync(file, code);
  const found: Hardcoded[] = [];
  const { position, ignored } = lineIndex(code);
  const report = (node: Node, text: string, where: string, via: Hardcoded['via'] = 'jsx') => {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!LETTER.test(trimmed) || looksLikeCode(trimmed)) return;
    const at = position(node.start + Math.max(0, code.slice(node.start, node.end).search(/\S/)));
    if (ignored(at.line)) return;
    found.push({ file, ...at, text: trimmed, where, via });
  };
  // A template's text is its words, so `${a} ${b}` is none; it is shown as written, placeholders and all.
  const reportShown = (expr: Node | undefined, where: string, via?: Hardcoded['via']) => {
    for (const node of shownLiterals(expr)) {
      if (node.type === 'Literal') {
        report(node, node.value as string, where, via);
        continue;
      }
      const words = (node.quasis as { value: { cooked: string } }[]).map((q) => q.value.cooked).join('');
      if (LETTER.test(words)) report(node, code.slice(node.start + 1, node.end - 1), where, via);
    }
  };

  const visit = (node: Node, inProse: boolean) => {
    let prose = inProse;
    if (node.type === 'JSXElement') {
      const opening = node.openingElement as Node & { name: Node & { name?: string } };
      if (opening.name.type === 'JSXIdentifier' && isNonProse(opening.name.name ?? '')) prose = false;
    }
    if (node.type === 'JSXText' && prose) report(node, node.value as string, 'text');
    if (node.type === 'JSXExpressionContainer' && prose) reportShown(node.expression as Node, 'text');
    if (node.type === 'JSXAttribute') {
      const name = node.name as Node & { name?: string };
      const value = node.value as Node | null;
      const attr = name.type === 'JSXIdentifier' ? (name.name ?? '') : '';
      if (attributes.includes(attr) && value !== null) {
        if (value.type === 'Literal' && typeof value.value === 'string') report(value, value.value, attr);
        if (value.type === 'JSXExpressionContainer') reportShown(value.expression as Node, attr);
      }
      // Its expression is no child of the element, but may hold JSX of its own, or call `toast`.
      if (value?.type === 'JSXExpressionContainer') visit(value.expression as Node, prose);
      return;
    }
    if (app && node.type === 'CallExpression') {
      const callee = calleeOf(node.callee as Node);
      if (callee !== undefined && calls.includes(callee.root)) {
        for (const arg of node.arguments as Node[]) {
          if (arg.type !== 'ObjectExpression') reportShown(arg, callee.name, 'call');
          else for (const p of arg.properties as Node[]) if (p.type === 'Property') reportShown(p.value as Node, callee.name, 'call');
        }
      }
    }
    if (app && component && node.type === 'Property' && node.kind === 'init') {
      const name = propertyName(node);
      if (name !== undefined && properties.includes(name)) reportShown(node.value as Node, name, 'property');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, prose);
      } else if (isNode(value)) {
        visit(value, prose);
      }
    }
  };
  visit(program as unknown as Node, true);
  return found;
}

export interface Formatted {
  file: string;
  line: number;
  column: number;
  /** The call as written, on one line. */
  code: string;
  /** What reads in its place: the copy's method, and the format the config names where its options are one. */
  fix: string;
}

/** `Intl`'s formatters, and the copy's method that formats in the copy's locale as each does. */
const INTL_METHODS: Record<string, string> = {
  NumberFormat: 'number',
  DateTimeFormat: 'date',
  ListFormat: 'list',
  RelativeTimeFormat: 'relative',
  DurationFormat: 'duration',
};
const TO_LOCALE: Record<string, 'date' | undefined> = { toLocaleString: undefined, toLocaleDateString: 'date', toLocaleTimeString: 'date' };
/** The options only a date formats with, which tell `toLocaleString`'s value apart from a number. */
const DATE_OPTIONS =
  /^(?:dateStyle|timeStyle|year|month|day|weekday|hour|minute|second|era|timeZone|timeZoneName|hour12|hourCycle|dayPeriod)$/;

/** An object literal of plain values, as the options it is: nothing where it holds anything else. */
function literalObject(node: Node | undefined): Record<string, unknown> | undefined {
  if (node === undefined) return {};
  if (node.type !== 'ObjectExpression') return undefined;
  const out: Record<string, unknown> = {};
  for (const p of node.properties as Node[]) {
    const name = p.type === 'Property' ? propertyName(p) : undefined;
    const value = p.value as Node | undefined;
    if (name === undefined || value?.type !== 'Literal') return undefined;
    out[name] = value.value;
  }
  return out;
}

/** What a format's options show in a locale, to tell which named format they are. */
function resolved(kind: keyof FormatTable, locale: string, options: object): string | undefined {
  try {
    const intl = kind === 'number' ? new Intl.NumberFormat(locale, options) : new Intl.DateTimeFormat(locale, options);
    return JSON.stringify(intl.resolvedOptions());
  } catch {
    return undefined;
  }
}

/**
 * Numbers, dates and lists formatted in code rather than by the copy: `toLocaleString()` and
 * `new Intl.NumberFormat()` show the browser's locale, or one written in, where the copy shows its
 * own, and options written out drift from the format the config names. In components, `.join(', ')`
 * is a list only English joins so. Outside tests and stories; lines marked `prosebook-ignore` are left.
 */
export function formattedInCode(file: string, code: string, formats: Formats = {}, locale = 'en'): Formatted[] {
  if (NOT_APP.test(file)) return [];
  const component = /\.[jt]sx$/.test(file);
  const { program } = parseSync(file, code);
  const { position, ignored } = lineIndex(code);
  const found: Formatted[] = [];
  const say = (node: Node, kind: string, value: string, options: Node | undefined) => {
    const at = position(node.start);
    if (ignored(at.line)) return;
    const given = literalObject(options);
    const kinds = kind === 'either' ? (Object.keys(given ?? {}).some((k) => DATE_OPTIONS.test(k)) ? ['date'] : ['number', 'date']) : [kind];
    const named = kinds.flatMap((k) => {
      if (given === undefined || (k !== 'number' && k !== 'date') || Object.keys(given).length === 0) return [];
      const shown = resolved(k, locale, given);
      return Object.keys(formats[k] ?? {})
        .filter((name) => {
          const options = formatIn(formats, k, name, locale)!;
          // A format with steps, or the app's own formatter, shows values as no options written in code do.
          return shown !== undefined && !beyondOptions(options) && resolved(k, locale, options) === shown;
        })
        .map((name) => `copy.${k}(${value}, '${name}')`);
    });
    const plain = kinds.map((k) => `copy.${k}(${value})`);
    const fix =
      named.length > 0
        ? `${named.join(' or ')}, which shows it as the format the config names`
        : given !== undefined && Object.keys(given).length > 0 && kinds.every((k) => k === 'number' || k === 'date')
          ? `${plain.join(' or ')} with these options, or name them under formats.${kinds.join(' or formats.')} and pass the name`
          : `${plain.join(' or ')}, in the copy's locale`;
    const text = code.slice(node.start, node.end).replace(/\s+/g, ' ');
    found.push({ file, ...at, code: text.length > 80 ? `${text.slice(0, 77)}...` : text, fix });
  };
  // Formatters only asked their options, as `Intl.DateTimeFormat().resolvedOptions().timeZone` reads the
  // device's time zone: they format nothing a person reads.
  const asked = new Set<Node>();
  const visit = (node: Node) => {
    if (node.type === 'NewExpression' || node.type === 'CallExpression') {
      const callee = calleeOf(node.callee as Node);
      const args = node.arguments as Node[];
      const intl = callee?.root === 'Intl' ? INTL_METHODS[callee.name.slice('Intl.'.length)] : undefined;
      if (intl !== undefined && !asked.has(node)) say(node, intl, '…', args[1]);
      const member = node.callee as Node;
      if (node.type === 'CallExpression' && member.type === 'MemberExpression' && member.computed !== true) {
        const method = nameOf(member.property as Node) ?? '';
        if (method === 'resolvedOptions') asked.add(unwrapped(member.object as Node));
        const value = code.slice((member.object as Node).start, (member.object as Node).end);
        if (Object.hasOwn(TO_LOCALE, method)) say(node, TO_LOCALE[method] ?? 'either', value, args[1]);
        const joiner = args[0];
        if (component && method === 'join' && joiner?.type === 'Literal' && joiner.value === ', ') say(node, 'list', value, undefined);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };
  visit(program as unknown as Node);
  return found;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

export interface ScanResult {
  hardcoded: Hardcoded[];
  formatted: Formatted[];
  refs: KeyRefs;
  files: number;
}

export function scan(options: ScanOptions, root: string, skip: string[] = [], formats?: Formats, locale?: string): ScanResult {
  const refs: KeyRefs = { exact: new Set(), prefixes: new Set() };
  const hardcoded: Hardcoded[] = [];
  const formatted: Formatted[] = [];
  const files = sourceFiles(options.dirs, options.extensions, skip);
  for (const path of files) {
    const code = readFileSync(path, 'utf8');
    keyRefs(code, refs);
    if (SFC.test(path)) continue;
    const file = relative(root, path).replaceAll('\\', '/');
    // JSX in .tsx and .jsx; calls and properties in any script.
    if (!isIgnored(file, options.ignore['hardcoded-text'])) hardcoded.push(...hardcodedText(file, code, options));
    if (!isIgnored(file, options.ignore['formatted-in-code'])) formatted.push(...formattedInCode(file, code, formats, locale));
  }
  return { hardcoded, formatted, refs, files: files.length };
}

/** A copy's methods that take a key first. */
export const READERS = new Set(['t', 'rich']);

export interface UnseenRead {
  file: string;
  line: number;
  column: number;
  /** The read as written, on one line. */
  code: string;
  /** What it calls: a reader, the name it was imported by, or `Text`. */
  name: string;
}

export interface Reads {
  /** Reads whose key a build can't see, in calls that may be to a copy's `t` or `rich`. */
  unseen: UnseenRead[];
  /** Names a copy's readers are bound to here, as in `const { rich: tRich } = copy`. */
  aliases: Set<string>;
}

const PREFIX = /^[a-z0-9][\w-]*(?:\.[\w-]+)*\.$/;
const WRAPPERS = new Set(['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion']);

/** Whether `keyRefs` finds every key an expression can be: a literal, or a template or sum after a key prefix. */
function keySeen(node: Node | undefined, maps: KeyMaps = new Map()): boolean {
  if (node === undefined) return false;
  if (WRAPPERS.has(node.type)) return keySeen(node.expression as Node, maps);
  switch (node.type) {
    case 'MemberExpression': {
      // `STATUS[s]` over a map of keys, and `STATUS[s].label` over a map of objects holding one.
      const object = unwrapped(node.object as Node);
      if (node.computed === true) return object.type === 'Identifier' && maps.get(object.name as string)?.direct === true;
      const inner = object.type === 'MemberExpression' && object.computed === true ? unwrapped(object.object as Node) : undefined;
      return inner?.type === 'Identifier' && maps.get(inner.name as string)?.props.has(nameOf(node.property as Node) ?? '') === true;
    }
    case 'Literal':
      return typeof node.value === 'string';
    case 'TemplateLiteral': {
      const [head] = node.quasis as { value: { cooked: string | null } }[];
      return (node.expressions as Node[]).length === 0 || PREFIX.test(head?.value.cooked ?? '');
    }
    case 'BinaryExpression': {
      const left = node.left as Node;
      return node.operator === '+' && left.type === 'Literal' && typeof left.value === 'string' && PREFIX.test(left.value);
    }
    case 'ConditionalExpression':
      return keySeen(node.consequent as Node, maps) && keySeen(node.alternate as Node, maps);
    case 'LogicalExpression':
      return keySeen(node.left as Node, maps) && keySeen(node.right as Node, maps);
    default:
      return false;
  }
}

const unwrapped = (node: Node): Node => (WRAPPERS.has(node.type) ? unwrapped(node.expression as Node) : node);

/**
 * A module's `const` maps of keys, by name: `direct` where every value is a key (`{ done: 'run.done' }`,
 * `['a.b', 'a.c']`), and `props` the properties every value holds a key under (`{ done: { label:
 * 'run.done' } }`). A read through one is seen: every key it can read is written in the map, which
 * pruning keeps.
 */
type KeyMaps = Map<string, { direct: boolean; props: Set<string> }>;

const isKey = (node: Node) => node.type === 'Literal' && typeof node.value === 'string' && /^[a-z0-9][\w-]*(?:\.[\w-]+)+$/.test(node.value);

function keyMapsIn(program: Node): KeyMaps {
  const maps: KeyMaps = new Map();
  for (const top of program.body as Node[]) {
    const statement = top.type === 'ExportNamedDeclaration' && top.declaration ? (top.declaration as Node) : top;
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue;
    for (const d of statement.declarations as Node[]) {
      const id = d.id as Node;
      const init = d.init === null || d.init === undefined ? undefined : unwrapped(d.init as Node);
      if (id.type !== 'Identifier' || init === undefined) continue;
      const values =
        init.type === 'ArrayExpression'
          ? (init.elements as (Node | null)[])
          : init.type === 'ObjectExpression'
            ? (init.properties as Node[]).map((p) => (p.type === 'Property' ? (p.value as Node) : null))
            : undefined;
      if (values === undefined || values.length === 0 || values.includes(null)) continue;
      const shown = (values as Node[]).map(unwrapped);
      const direct = shown.every(isKey);
      const props = new Set<string>();
      if (shown.every((v) => v.type === 'ObjectExpression')) {
        const keyed = shown.map(
          (v) =>
            new Set(
              (v.properties as Node[])
                .filter((p) => p.type === 'Property' && isKey(unwrapped(p.value as Node)))
                .map((p) => nameOf(p.key as Node)),
            ),
        );
        for (const name of keyed[0] ?? []) if (name !== undefined && keyed.every((k) => k.has(name))) props.add(name);
      }
      if (direct || props.size > 0) maps.set(id.name as string, { direct, props });
    }
  }
  return maps;
}

const nameOf = (node: Node | undefined): string | undefined =>
  node?.type === 'Identifier' || node?.type === 'JSXIdentifier'
    ? (node.name as string)
    : node?.type === 'Literal'
      ? String(node.value)
      : undefined;

/** Where `<Text>` comes from: each framework binding's. */
const TEXT_SOURCES = new Set(['prosebook/react', 'prosebook/preact', 'prosebook/solid', 'prosebook/vue', 'prosebook/svelte']);

/** Single-file components, whose reads are in their scripts and their markup, and in Astro's frontmatter. */
export const SFC = /\.(?:vue|svelte|astro)$/;

/** Code inside a file, parsed apart: a script block, or an expression in markup, at its offset. */
interface Piece {
  code: string;
  at: number;
}

/** A single-file component's script blocks, each at its offset. */
export const scriptBlocks = (code: string): Piece[] =>
  [...code.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/g)].map((m) => ({ code: m[2]!, at: m.index + m[1]!.length }));

/**
 * The reads in a module whose key a pruned build can't see, as in `t(item.key)` or `<Text id={id} />`:
 * the build would leave the message out, and the key would show in its place. A build has no types,
 * so readers are known by name: `t` and `rich` called alone or as methods, and any name imported here,
 * which may be bound to one elsewhere (`aliases`); the caller keeps those whose name turns out to be a
 * reader. `<Text>` counts where it is imported from a prosebook binding. In a `.vue`, `.svelte` or
 * `.astro` file, its scripts, Astro's frontmatter and the expressions in its markup are read. Lines
 * marked `prosebook-ignore` are skipped.
 */
export function unseenReads(file: string, code: string): Reads {
  if (!SFC.test(file)) return readsIn(file, code, file, [{ code, at: 0 }]);
  if (file.endsWith('.astro')) return astroReads(file, code);
  const vue = file.endsWith('.vue');
  const markup = blank(code, /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/g);
  const scripts = scriptBlocks(code);
  const expressions = vue ? vueExpressions(markup) : svelteExpressions(markup);
  // Scripts and markup alike may be TypeScript.
  return readsIn(file, code, 'component.ts', [...scripts, ...expressions], (names, report) => {
    for (const tag of markupTexts(markup, names, vue)) report(tag.at, tag.end, 'Text');
  });
}

/**
 * An Astro component: its frontmatter, its `<script>`s and each `{...}` in its markup, read as TSX, since
 * an expression there may hold markup (`rich('k', { link: (c) => <a>{c}</a> })`). An apostrophe in that
 * markup's text reads as a quote to `closing`; the catalog holds the prose, so little is written there.
 */
function astroReads(file: string, code: string): Reads {
  const pieces: Piece[] = [];
  const open = /^\s*---\r?\n/.exec(code);
  const close = open === null ? -1 : code.indexOf('\n---', open[0].length);
  if (close !== -1) pieces.push({ code: code.slice(open![0].length, close), at: open![0].length });
  const fenced = close === -1 ? 0 : close + 4;
  const markup = blank(
    code.slice(0, fenced).replace(/[^\n]/g, ' ') + code.slice(fenced),
    /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/g,
  );
  for (let start = markup.indexOf('{'); start !== -1;) {
    const end = closing(markup, start);
    if (end === -1) break;
    // A spread, `{...props}`, reads as the object it spreads.
    pieces.push({ code: markup.slice(start + 1, end).replace(/^(\s*)\.\.\./, '$1   '), at: start + 1 });
    start = markup.indexOf('{', end + 1);
  }
  return readsIn(file, code, 'component.tsx', [...pieces, ...scriptBlocks(code)]);
}

type Report = (start: number, end: number, name: string) => void;

function readsIn(file: string, code: string, as: string, pieces: Piece[], markup?: (texts: Set<string>, report: Report) => void): Reads {
  const programs = pieces.map((piece) => ({ at: piece.at, program: parseSync(as, piece.code).program as unknown as Node }));
  const { position, ignored } = lineIndex(code);
  const unseen: UnseenRead[] = [];
  const aliases = new Set<string>();
  /** Local name to the name it was imported by. */
  const imported = new Map<string, string>();
  const texts = new Set<string>();
  const maps: KeyMaps = new Map();
  for (const { program } of programs) {
    for (const [name, map] of keyMapsIn(program)) maps.set(name, map);
    for (const statement of program.body as Node[]) {
      if (statement.type !== 'ImportDeclaration') continue;
      for (const s of statement.specifiers as Node[]) {
        const name = s.type === 'ImportSpecifier' ? nameOf(s.imported as Node) : undefined;
        const local = nameOf(s.local as Node);
        if (name === undefined || local === undefined) continue;
        if (name === 'Text' && TEXT_SOURCES.has(String((statement.source as Node).value))) texts.add(local);
        else imported.set(local, name);
      }
    }
  }
  const report: Report = (start, end, name) => {
    const at = position(start);
    if (ignored(at.line)) return;
    const text = code.slice(start, end).replace(/\s+/g, ' ');
    unseen.push({ file, ...at, name, code: text.length > 80 ? `${text.slice(0, 77)}...` : text });
  };
  // Calls by a plain name, kept until every alias in the module is known.
  const calls: [start: number, end: number, name: string][] = [];
  const visit = (node: Node, at: number) => {
    if (node.type === 'ObjectPattern') {
      for (const p of node.properties as Node[]) {
        if (p.type === 'Property' && READERS.has(nameOf(p.key as Node) ?? '') && (p.value as Node).type === 'Identifier')
          aliases.add(nameOf(p.value as Node)!);
      }
    }
    if (node.type === 'CallExpression' && !keySeen((node.arguments as Node[])[0], maps)) {
      const callee = node.callee as Node;
      if (callee.type === 'Identifier') calls.push([at + node.start, at + node.end, callee.name as string]);
      else if (callee.type === 'MemberExpression' && !callee.computed && READERS.has(nameOf(callee.property as Node) ?? ''))
        report(at + node.start, at + node.end, nameOf(callee.property as Node)!);
    }
    if (node.type === 'JSXOpeningElement' && texts.has(nameOf(node.name as Node) ?? '')) {
      const id = (node.attributes as Node[]).find((a) => a.type === 'JSXAttribute' && nameOf(a.name as Node) === 'id');
      const value = id?.value as Node | null | undefined;
      if (
        value !== null &&
        value !== undefined &&
        !keySeen(value.type === 'JSXExpressionContainer' ? (value.expression as Node) : value, maps)
      )
        report(at + node.start, at + node.end, 'Text');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, at);
      } else if (isNode(value)) {
        visit(value, at);
      }
    }
  };
  for (const { program, at } of programs) visit(program, at);
  markup?.(texts, report);
  for (const [start, end, local] of calls) {
    if (READERS.has(local) || aliases.has(local)) report(start, end, local);
    else if (imported.has(local)) report(start, end, imported.get(local)!);
  }
  unseen.sort((a, b) => (a.line === b.line ? a.column - b.column : a.line - b.line));
  return { unseen, aliases };
}

/** `code` with each match of `pattern` blanked to spaces, its lines kept, so offsets still point into the file. */
const blank = (code: string, pattern: RegExp) => code.replace(pattern, (m) => m.replace(/[^\n]/g, ' '));

/** A Vue template's expressions: `{{ ... }}`, and the values of bound attributes and directives. */
function vueExpressions(markup: string): Piece[] {
  const pieces: Piece[] = [];
  for (const m of markup.matchAll(/\{\{([\s\S]*?)\}\}/g)) pieces.push({ code: m[1]!, at: m.index + 2 });
  for (const m of markup.matchAll(/\s((?::|@|v-)[^\s=>/"']*)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    // A loop's and a slot's values bind names; they read nothing.
    if (/^v-(?:for|slot)\b/.test(m[1]!)) continue;
    pieces.push({ code: m[3]!, at: m.index + m[0].length - m[3]!.length - 1 });
  }
  return pieces;
}

/** Where the `}` closing the `{` at `start` is, past strings and nested braces; -1 if none does. */
function closing(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === '`') {
      const end = text.indexOf(c, i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** A Svelte template's expressions: each `{...}`, a block's or tag's past its keyword. */
function svelteExpressions(markup: string): Piece[] {
  const pieces: Piece[] = [];
  for (let start = markup.indexOf('{'); start !== -1;) {
    const end = closing(markup, start);
    if (end === -1) break;
    const at = start + 1;
    const inner = markup.slice(at, end);
    const tag = /^\s*([#:@/])(\w*)(\s+if\b)?/.exec(inner);
    if (tag === null) {
      // A spread, `{...props}`, reads as the object it spreads.
      pieces.push({ code: inner.replace('...', '   '), at });
    } else {
      const [head, sigil, word, elseIf] = tag;
      // `{/if}`, `{:else}` and `{:then x}` hold no expression, and `{#snippet}` names parameters.
      const reads = sigil !== '/' && word !== 'snippet' && word !== 'then' && word !== 'catch' && (word !== 'else' || elseIf !== undefined);
      // `{@const x = ...}` declares; `{#each xs as x}` and `{#await p then x}` bind names after the expression.
      if (reads && word === 'const') pieces.push({ code: `var${inner.slice(head.length)}`, at: at + head.length - 3 });
      else if (reads) pieces.push({ code: inner.slice(head.length).split(/\s+(?:as|then)\s/)[0]!, at: at + head.length });
    }
    start = markup.indexOf('{', end + 1);
  }
  return pieces;
}

/**
 * Each `<Text>` in markup whose key the build can't see: Vue's `:id="..."`, Svelte's `id={...}`,
 * `{id}` or `id="text {with} a placeholder"`. An `id` written as plain text is a key `keyRefs` reads.
 */
function markupTexts(markup: string, names: Set<string>, vue: boolean): { at: number; end: number }[] {
  if (names.size === 0) return [];
  const found: { at: number; end: number }[] = [];
  const tags = new RegExp(`<(?:${[...names].join('|')})(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g');
  for (const m of markup.matchAll(tags)) {
    const attributes = m[1]!;
    let id: string | undefined;
    if (vue) {
      id = /(?:^|\s)(?::|v-bind:)id\s*=\s*(["'])([\s\S]*?)\1/.exec(attributes)?.[2];
    } else {
      const bound = /(?:^|\s)id\s*=\s*\{/.exec(attributes);
      if (bound !== null) {
        const open = bound.index + bound[0].length - 1;
        id = attributes.slice(open + 1, closing(attributes, open));
      } else if (/(?:^|\s)\{\s*id\s*\}/.test(attributes) || /(?:^|\s)id\s*=\s*(["'])[^"']*\{/.test(attributes)) {
        id = 'id';
      }
    }
    if (id === undefined) continue;
    const [statement] = parseSync('id.ts', `(${id})`).program.body as unknown as Node[];
    if (!keySeen(statement?.type === 'ExpressionStatement' ? (statement.expression as Node) : undefined))
      found.push({ at: m.index, end: m.index + m[0].length });
  }
  return found;
}
