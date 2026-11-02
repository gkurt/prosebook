/**
 * What the code says: text a person reads that is still written in a component, and which catalog
 * keys the code names.
 *
 * Key references are found by reading string literals, not by tracing calls, so a key kept in an
 * array or a map still counts, and `nav.${id}` or `'nav.' + id` keeps every key under `nav.`. That
 * errs towards keeping a key, which is the safe direction both for `unused` and for pruning a bundle.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { parseSync } from 'oxc-parser';

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
  /** Where it sits: `text`, or the attribute it is the value of. */
  where: string;
}

type Node = { type: string; start: number; end: number; [field: string]: unknown };

/**
 * Text that reads as code rather than prose: one token holding a path, a call, an identifier with an
 * underscore or a dotted name, as in `form.json()` or `src/index.ts`. Trailing punctuation doesn't
 * count, so `Done.` is still prose.
 */
export function looksLikeCode(text: string): boolean {
  const token = text.trim().replace(/[.!?:,…]+$/, '');
  return token !== '' && !/\s/.test(token) && /[/()_=<>{}[\].]|::/.test(token);
}

const NON_PROSE_ELEMENTS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'path']);
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

/** Literal text in JSX that a person reads, where it should be a catalog entry. */
export function hardcodedText(file: string, code: string, attributes: string[]): Hardcoded[] {
  const { program } = parseSync(file, code);
  const found: Hardcoded[] = [];
  const { position, ignored } = lineIndex(code);
  const report = (node: Node, text: string, where: string) => {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!LETTER.test(trimmed) || looksLikeCode(trimmed)) return;
    const at = position(node.start + Math.max(0, code.slice(node.start, node.end).search(/\S/)));
    if (ignored(at.line)) return;
    found.push({ file, ...at, text: trimmed, where });
  };

  const visit = (node: Node, inProse: boolean) => {
    let prose = inProse;
    if (node.type === 'JSXElement') {
      const opening = node.openingElement as Node & { name: Node & { name?: string } };
      if (opening.name.type === 'JSXIdentifier' && NON_PROSE_ELEMENTS.has(opening.name.name ?? '')) prose = false;
    }
    if (node.type === 'JSXText' && prose) report(node, node.value as string, 'text');
    if (node.type === 'JSXExpressionContainer' && prose) {
      const expr = node.expression as Node;
      if (expr.type === 'Literal' && typeof expr.value === 'string') report(expr, expr.value, 'text');
      if (expr.type === 'TemplateLiteral' && (expr.expressions as Node[]).length === 0)
        report(expr, String((expr.quasis as { value: { cooked: string } }[])[0]?.value.cooked), 'text');
    }
    if (node.type === 'JSXAttribute') {
      const name = node.name as Node & { name?: string };
      const value = node.value as Node | null;
      const attr = name.type === 'JSXIdentifier' ? (name.name ?? '') : '';
      if (attributes.includes(attr) && value !== null) {
        if (value.type === 'Literal' && typeof value.value === 'string') report(value, value.value, attr);
        if (value.type === 'JSXExpressionContainer') {
          const expr = value.expression as Node;
          if (expr.type === 'Literal' && typeof expr.value === 'string') report(expr, expr.value, attr);
        }
      }
      return;
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

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

export interface ScanResult {
  hardcoded: Hardcoded[];
  refs: KeyRefs;
  files: number;
}

export function scan(dirs: string[], extensions: string[], attributes: string[], root: string, skip: string[] = []): ScanResult {
  const refs: KeyRefs = { exact: new Set(), prefixes: new Set() };
  const hardcoded: Hardcoded[] = [];
  const files = sourceFiles(dirs, extensions, skip);
  for (const path of files) {
    const code = readFileSync(path, 'utf8');
    keyRefs(code, refs);
    if (/\.[jt]sx$/.test(path)) hardcoded.push(...hardcodedText(relative(root, path).replaceAll('\\', '/'), code, attributes));
  }
  return { hardcoded, refs, files: files.length };
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
function keySeen(node: Node | undefined): boolean {
  if (node === undefined) return false;
  if (WRAPPERS.has(node.type)) return keySeen(node.expression as Node);
  switch (node.type) {
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
      return keySeen(node.consequent as Node) && keySeen(node.alternate as Node);
    case 'LogicalExpression':
      return keySeen(node.left as Node) && keySeen(node.right as Node);
    default:
      return false;
  }
}

const nameOf = (node: Node | undefined): string | undefined =>
  node?.type === 'Identifier' || node?.type === 'JSXIdentifier'
    ? (node.name as string)
    : node?.type === 'Literal'
      ? String(node.value)
      : undefined;

/** Where `<Text>` comes from: each framework binding's. */
const TEXT_SOURCES = new Set(['prosebook/react', 'prosebook/preact', 'prosebook/solid', 'prosebook/vue', 'prosebook/svelte']);

/** Single-file components, whose reads are in their scripts and their markup. */
export const SFC = /\.(?:vue|svelte)$/;

/** Code inside a file, parsed apart: a script block, or an expression in markup, at its offset. */
interface Piece {
  code: string;
  at: number;
}

/**
 * The reads in a module whose key a pruned build can't see, as in `t(item.key)` or `<Text id={id} />`:
 * the build would leave the message out, and the key would show in its place. A build has no types,
 * so readers are known by name: `t` and `rich` called alone or as methods, and any name imported here,
 * which may be bound to one elsewhere (`aliases`); the caller keeps those whose name turns out to be a
 * reader. `<Text>` counts where it is imported from a prosebook binding. In a `.vue` or `.svelte` file,
 * its scripts and the expressions in its markup are read. Lines marked `prosebook-ignore` are skipped.
 */
export function unseenReads(file: string, code: string): Reads {
  if (!SFC.test(file)) return readsIn(file, code, file, [{ code, at: 0 }]);
  const vue = file.endsWith('.vue');
  const markup = blank(code, /<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/g);
  const scripts = [...code.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/g)].map((m) => ({ code: m[2]!, at: m.index + m[1]!.length }));
  const expressions = vue ? vueExpressions(markup) : svelteExpressions(markup);
  // Scripts and markup alike may be TypeScript.
  return readsIn(file, code, 'component.ts', [...scripts, ...expressions], (names, report) => {
    for (const tag of markupTexts(markup, names, vue)) report(tag.at, tag.end, 'Text');
  });
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
  for (const { program } of programs) {
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
    if (node.type === 'CallExpression' && !keySeen((node.arguments as Node[])[0])) {
      const callee = node.callee as Node;
      if (callee.type === 'Identifier') calls.push([at + node.start, at + node.end, callee.name as string]);
      else if (callee.type === 'MemberExpression' && !callee.computed && READERS.has(nameOf(callee.property as Node) ?? ''))
        report(at + node.start, at + node.end, nameOf(callee.property as Node)!);
    }
    if (node.type === 'JSXOpeningElement' && texts.has(nameOf(node.name as Node) ?? '')) {
      const id = (node.attributes as Node[]).find((a) => a.type === 'JSXAttribute' && nameOf(a.name as Node) === 'id');
      const value = id?.value as Node | null | undefined;
      if (value !== null && value !== undefined && !keySeen(value.type === 'JSXExpressionContainer' ? (value.expression as Node) : value))
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
