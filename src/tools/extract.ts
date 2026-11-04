/**
 * `prosebook extract`: moves hardcoded JSX text into the catalog and rewrites the code to read it.
 *
 * It works on runs, not fragments. The children of an element that together make one sentence, text,
 * simple expressions and inline elements holding only text, become one message: `Hi {user.name}, <a
 * href="/x">go</a>!` is `Hi {name}, <a>go</a>!`, so a translator can reorder the whole sentence. A run
 * becomes `<Text id=… />`, which needs no hook; a readable attribute becomes `t('…')`, with `useCopy()`
 * added to its component. Keys, kinds, surfaces and contexts are suggestions, marked for review.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';

import { parseSync } from 'oxc-parser';
import { stringify } from 'yaml';

import { CatalogError, KEY_PATTERN, loadCatalog, SCHEMA_LINE } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { parseMessage, TYPE, type MessageFormatElement } from './icu.ts';
import { singularOf } from './lint.ts';
import { isNonProse, looksLikeCode, shownLiterals } from './scan.ts';
import { writeMessage } from './syntax.ts';
import { syntaxKind, typescriptOracle, type Span, type ValueKind } from './types.ts';

// oxlint-disable-next-line typescript/no-explicit-any -- a loose ESTree node: the walk reads whichever fields each node type has
type Node = { type: string; start: number; end: number; [field: string]: any };

export interface Extraction {
  file: string;
  line: number;
  column: number;
  key: string;
  /** The ICU message. */
  message: string;
  /** Whether an entry with this key and message already exists, so none is added. */
  reused: boolean;
  where: string;
  /** The code that replaces the hardcoded text. */
  replacement: string;
}

export interface NewEntry {
  key: string;
  area: string;
  message: string;
  kind?: string;
  surface?: string;
  context: string;
  args: Record<string, string>;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface FilePlan {
  path: string;
  file: string;
  code: string;
  edits: Edit[];
  extractions: Extraction[];
  warnings: string[];
}

export interface ExtractPlan {
  files: FilePlan[];
  entries: NewEntry[];
  /** About the plan as a whole: the same text made an entry in several areas. */
  warnings: string[];
  /** What said which placeholders are numbers and dates: `TypeScript`, or `syntax` alone. */
  types: string;
}

const MODULE = 'prosebook/react';
const LETTER = /\p{L}/u;

/** Elements that sit inside a sentence, and so become a tag in its message rather than ending it. */
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'cite',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
]);
const isInline = (name: string) => INLINE.has(name) || /^[A-Z]\w*Link$|^Link$/.test(name);

/** Elements whose text has an obvious kind and surface. */
const ROLES: Record<string, [kind: string, surface: string]> = {
  button: ['action', 'action'],
  h1: ['name', 'heading'],
  h2: ['name', 'heading'],
  h3: ['name', 'heading'],
  h4: ['name', 'heading'],
  h5: ['name', 'heading'],
  h6: ['name', 'heading'],
  th: ['name', 'heading'],
  legend: ['name', 'heading'],
  caption: ['name', 'heading'],
  label: ['name', 'label'],
  option: ['name', 'choice'],
  title: ['name', 'title'],
};

/** Readable attributes: the kind and surface their value has, and the key suffix that says which it is. */
const ATTRIBUTE_ROLES: Record<string, [kind: string | undefined, surface: string, suffix: string]> = {
  placeholder: [undefined, 'placeholder', 'placeholder'],
  title: ['name', 'tooltip', 'tooltip'],
  'aria-label': ['name', 'aria', 'aria'],
  'aria-description': ['description', 'aria', 'aria-description'],
  'aria-placeholder': [undefined, 'aria', 'aria-placeholder'],
  alt: [undefined, 'aria', 'alt'],
  label: ['name', 'label', 'label'],
};

/** A component's `title` is its heading, which it shows, where an element's is a tooltip. */
const COMPONENT_TITLE: [kind: string, surface: string, suffix: string] = ['name', 'heading', 'title'];

/** Words past a name's budget, or a stop at the end: a sentence, which describes rather than names. */
const isSentence = (text: string) => /[.!?…]$/.test(text.trim()) || text.trim().split(/\s+/).length > 4;

/** Names whose capitals sit inside one word, which kebab case would split: `GitHub` is not `git-hub`. */
const ONE_WORD = ['GitHub', 'GitLab', 'JavaScript', 'TypeScript', 'OAuth', 'PagerDuty', 'YouTube', 'LinkedIn', 'WordPress', 'iOS', 'macOS'];

/**
 * The area a file's strings go in: its name in kebab case, or its folder's for an `index`. A name in
 * `nouns` (the config's `properNouns`) or one of a few such brands stays one word.
 */
export function areaOf(file: string, nouns: readonly string[] = []): string {
  const name = basename(file, extname(file));
  return kebabOf(['index', 'page', 'layout', 'route', 'main'].includes(name) ? basename(dirname(file)) : name, nouns);
}

function kebabOf(name: string, nouns: readonly string[]): string {
  for (const noun of [...ONE_WORD, ...nouns].filter((n) => /^[A-Za-z]+$/.test(n) && /.[A-Z]/.test(n)))
    name = name.replaceAll(noun, `-${noun.toLowerCase()}-`);
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return kebab === '' ? 'app' : kebab;
}

/** A key segment from the words of a message: its first four, plain ASCII, lowercase, whole. */
export function slugOf(message: string): string {
  const words = wordsOf(message)
    // `couldn't` is one word, `couldnt`, not `couldn` and a stray `t`.
    .replace(/(?<=\p{L})['’](?=\p{L})/gu, '')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4);
  return words.length === 0 ? 'text' : words.join('-');
}

/** A message's words, as its `other` arms read, without placeholders or tags: `{n, plural, …}` is its words, not `other`. */
function wordsOf(message: string): string {
  let ast: MessageFormatElement[];
  try {
    ast = parseMessage(message);
  } catch {
    // MF2, which keeps its structure out of the words a slug starts from.
    return message.replace(/<\/?[\w-]+>|\{[^{}]*\}/g, ' ');
  }
  const read = (elements: MessageFormatElement[]): string =>
    elements
      .map((el) => {
        if (el.type === TYPE.literal) return el.value;
        if (el.type === TYPE.tag) return read(el.children);
        if (el.type === TYPE.plural || el.type === TYPE.select) return read(el.options.other?.value ?? []);
        return ' ';
      })
      .join('');
  return read(ast);
}

/**
 * A count followed by a plural noun, `{n, number} files`, as the plural it needs: `{n, plural, one {#
 * file} other {# files}}`. English only, and a draft: the TODO above the entry asks for a look.
 */
export function draftPlurals(message: string): string {
  return message.replace(/\{(\w+), number\} (\p{L}+)(?![\p{L}'])/gu, (whole, name: string, word: string) => {
    const one = singularOf(word);
    return one === undefined ? whole : `{${name}, plural, one {# ${one}} other {# ${word}}}`;
  });
}

/** A message built as MF1, as the catalog writes messages: an MF2 catalog gets it in MF2. */
function inSyntax(config: ResolvedConfig, mf1: string): string {
  return config.messageFormat === 2 ? writeMessage(2, parseMessage(mf1), config.source) : mf1;
}

/** Text written literally inside an ICU message. */
function escapeIcu(text: string): string {
  return text.replace(/[{}<]/g, (c) => `'${c}'`);
}

/** JSX text as React renders it: lines trimmed where they meet a line break, blank lines dropped. */
function jsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  // As Babel does: a value with no visible characters still keeps its one line, so a lone space renders.
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let out = '';
  lines.forEach((line, i) => {
    let trimmed = line.replace(/\t/g, ' ');
    if (i !== 0) trimmed = trimmed.replace(/^ +/, '');
    if (i !== lines.length - 1) trimmed = trimmed.replace(/ +$/, '');
    if (trimmed === '') return;
    out += i === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return out;
}

const SIMPLE_EXPRESSIONS = new Set([
  'Identifier',
  'MemberExpression',
  'CallExpression',
  'TemplateLiteral',
  'Literal',
  'BinaryExpression',
  'TSNonNullExpression',
  'ChainExpression',
]);

/** A value that reads as a placeholder: no JSX and no functions inside it, which would be markup or logic. */
function simple(expr: Node): boolean {
  if (!SIMPLE_EXPRESSIONS.has(expr.type)) return false;
  let found = false;
  const walk = (node: Node) => {
    if (found) return;
    if (/^JSX|FunctionExpression$/.test(node.type)) found = true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((v) => isNode(v) && walk(v));
      else if (isNode(value)) walk(value);
    }
  };
  walk(expr);
  return !found;
}

/** Every name bound inside a node: declarations, parameters, catch clauses, imports. With `deep` false, only its own scope's. */
function bindingsIn(root: Node, deep = true): Set<string> {
  const names = new Set<string>();
  const pattern = (p: Node | null | undefined) => {
    if (!p) return;
    if (p.type === 'Identifier') names.add(p.name as string);
    else if (p.type === 'ObjectPattern')
      for (const prop of p.properties as Node[]) pattern(prop.type === 'RestElement' ? prop : prop.value);
    else if (p.type === 'ArrayPattern') for (const el of p.elements as (Node | null)[]) pattern(el);
    else if (p.type === 'AssignmentPattern') pattern(p.left);
    else if (p.type === 'RestElement') pattern(p.argument);
  };
  const walk = (node: Node, top: boolean) => {
    if (node.type === 'VariableDeclarator') pattern(node.id);
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier')
      pattern(node.local);
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) pattern(node.id);
    if (node.type === 'CatchClause') pattern(node.param);
    const isFunction = /Function(?:Declaration|Expression)$|^ArrowFunctionExpression$/.test(node.type);
    if (isFunction && (deep || top)) for (const param of node.params as Node[]) pattern(param);
    if (isFunction && !deep && !top) return;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) walk(child, false);
      } else if (isNode(value)) {
        walk(value, false);
      }
    }
  };
  walk(root, true);
  return names;
}

/**
 * `n.toLocaleString()` and `n.toFixed(2)`: a number made text in code, which the message can format
 * itself, as `{n, number}` and `{n, number, ::.00}`, so a plural can count it. The number, and its style.
 */
function formattedNumber(expr: Node): { value: Node; style: string } | undefined {
  if (expr.type !== 'CallExpression' || expr.callee?.type !== 'MemberExpression' || expr.callee.computed) return undefined;
  const method = expr.callee.property?.name as string | undefined;
  const value = expr.callee.object as Node;
  if (method === 'toLocaleString' && expr.arguments.length === 0) return { value, style: '' };
  const digits = expr.arguments[0] as Node | undefined;
  if (method !== 'toFixed' || digits?.type !== 'Literal' || typeof digits.value !== 'number') return undefined;
  return { value, style: digits.value === 0 ? ', integer' : `, ::.${'0'.repeat(digits.value)}` };
}

/**
 * `n === 1 ? 'file' : 'files'`: a plural written in code, which the message can hold as a plural. Its
 * count, and what it says for one and for the rest.
 */
function pluralTernary(expr: Node): { count: Node; one: string; other: string } | undefined {
  if (expr.type !== 'ConditionalExpression' || expr.test?.type !== 'BinaryExpression') return undefined;
  const { operator, left, right } = expr.test as Node;
  const isOne = (n: Node) => n.type === 'Literal' && n.value === 1;
  const count = isOne(right) ? left : isOne(left) ? right : undefined;
  if (count === undefined || !['===', '==', '!==', '!='].includes(operator as string)) return undefined;
  const yes = literalText(expr.consequent as Node);
  const no = literalText(expr.alternate as Node);
  if (yes === undefined || no === undefined) return undefined;
  return operator.startsWith('!') ? { count, one: no, other: yes } : { count, one: yes, other: no };
}

const CASE_CHANGES = new Set(['toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase']);

/**
 * Why a placeholder can't hold this value, where its text is words the catalog should hold: another
 * message, a word looked up in a map, a list joined in English, or words whose case code changes.
 */
function splicedText(expr: Node): string | undefined {
  let inner = expr;
  while (inner.type === 'TSNonNullExpression' || inner.type === 'ChainExpression') inner = inner.expression as Node;
  if (inner.type === 'CallExpression') {
    const callee = inner.callee as Node;
    const name =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' && !callee.computed
          ? callee.property?.name
          : undefined;
    if (name === 't' || name === 'rich')
      return 'is a message read into another, which a translator sees in pieces: make the sentence one entry';
    if (name === 'join') return 'joins a list in code, which reads as English only: give it to copy.list(), or make the sentence a plural';
    if (CASE_CHANGES.has(name as string))
      return "changes the case of words in code, which other languages don't share: write them as the sentence needs";
  }
  if (
    inner.type === 'MemberExpression' &&
    inner.computed &&
    !(inner.property?.type === 'Literal' && typeof inner.property.value === 'number')
  )
    return 'looks words up in a map, which a translator never sees: make the sentence a select over the key, or an entry per case';
  return undefined;
}

/** The text of a string literal, or of a template with no placeholders. */
function literalText(expr: Node): string | undefined {
  if (expr.type === 'Literal' && typeof expr.value === 'string') return expr.value;
  if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) return expr.quasis[0].value.cooked as string;
  return undefined;
}

/** A placeholder's name from its expression: the variable, or the property it reads. */
function nameOf(expr: Node): string {
  let inner = expr;
  while (inner.type === 'TSNonNullExpression' || inner.type === 'ChainExpression') inner = inner.expression as Node;
  if (inner.type === 'Identifier') return inner.name as string;
  if (inner.type === 'MemberExpression' && !inner.computed && inner.property?.type === 'Identifier') return inner.property.name as string;
  return 'value';
}

function elementName(el: Node): string | undefined {
  const name = el.openingElement?.name as Node | undefined;
  return name?.type === 'JSXIdentifier' ? (name.name as string) : undefined;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

/** An entry extract can reuse: the same words in the same role. */
interface Known {
  text: string;
  kind?: string;
  surface?: string;
}

interface Context {
  config: ResolvedConfig;
  area: string;
  /** Every key's source message and role, the catalog's and those added in this run. */
  known: Map<string, Known>;
  entries: NewEntry[];
  /** The kind of value each JSX expression holds, by `start:end`. */
  kinds: Map<string, ValueKind>;
}

/** Plans the extraction from one file: the edits and the entries, without writing anything. */
function planFile(path: string, ctx: Context): FilePlan {
  const code = readFileSync(path, 'utf8');
  const file = relative(ctx.config.root, path).replaceAll('\\', '/');
  const plan: FilePlan = { path, file, code, edits: [], extractions: [], warnings: [] };
  const { program } = parseSync(file, code);
  const topLevel = bindingsIn(program, false);
  const lines = code.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const position = (at: number) => {
    let line = lineStarts.findIndex((s) => s > at);
    line = line === -1 ? lineStarts.length : line;
    return { line, column: at - lineStarts[line - 1]! + 1 };
  };
  const ignored = (at: number) => {
    const { line } = position(at);
    return (lines[line - 1] ?? '').includes('prosebook-ignore') || (lines[line - 2] ?? '').includes('prosebook-ignore');
  };

  let needText = false;
  let needUseCopy = false;
  /** Per component, by where it starts: the call that reads the catalog there. */
  const hooked = new Map<number, string>();
  /** Children now inside a `<Text>`, which the walk does not enter. */
  const consumed = new Set<Node>();
  /** Enclosing functions, innermost last: the component each belongs to, and whether it is one. */
  const components: { fn: Node; name: string | undefined; isComponent: boolean }[] = [];

  const componentName = (fn: Node, parent: Node | undefined): string | undefined => {
    if (fn.id?.name) return fn.id.name as string;
    if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name as string;
    return undefined;
  };

  const entryFor = (
    message: string,
    args: Record<string, string>,
    role: [string | undefined, string | undefined],
    context: string,
    suffix?: string,
  ) => {
    const named = role[0] === 'name' && isSentence(message) ? 'description' : role[0];
    const kind = named !== undefined && named in ctx.config.kinds ? named : undefined;
    const surface = role[1] !== undefined && role[1] in ctx.config.surfaces ? role[1] : undefined;
    // The same words in another role are another string: an aria-label, a placeholder and a button
    // that say "Search" each translate on their own. An entry that names no role claims none.
    const unclassified = (k: Known) => k.kind === undefined && k.surface === undefined;
    const same = (k: Known) => k.text === message && ((k.kind === kind && k.surface === surface) || unclassified(k));
    const shared = ctx.config.extract.shared;
    const sameIn = (area: string) => [...ctx.known].find(([key, k]) => same(k) && key.startsWith(`${area}.`))?.[0];
    const found = sameIn(ctx.area) ?? (shared === undefined ? undefined : sameIn(shared));
    if (found !== undefined) return { key: found, reused: true };
    // Words another area says already are shared ones, which go in the shared area, once.
    const elsewhere = shared !== undefined && [...ctx.known].some(([, k]) => same(k));
    const area = elsewhere ? shared : ctx.area;

    const base = `${area}.${slugOf(message)}${suffix ? `-${suffix}` : ''}`;
    let key = base;
    for (let n = 2; ctx.known.has(key); n++) key = `${base}-${n}`;
    ctx.known.set(key, { text: message, kind, surface });
    ctx.entries.push({ key, area, message, ...(kind ? { kind } : {}), ...(surface ? { surface } : {}), context, args });
    return { key, reused: false };
  };

  const where = (element: string | undefined) => {
    const component = components.at(-1)?.name;
    return `${component ? `In ${component}` : `In ${file}`}${element ? `, the text of a <${element}>` : ''}.`;
  };

  /** The children of one element, split into runs at anything that cannot sit inside a sentence. */
  const extractChildren = (parent: Node, children: Node[]) => {
    const parentName = parent.type === 'JSXElement' ? elementName(parent) : undefined;
    let run: Node[] = [];
    const flush = () => {
      if (run.length > 0) extractRun(run, parentName);
      run = [];
    };
    // Words code picks, `{ok ? 'fine' : 'broken'}`: beside other words they would leave fragments, so
    // the sentence stays as it is; standing alone, each word it can pick is an entry.
    const pickers = children.filter(picksWords);
    if (pickers.length > 0 && children.some((c) => !pickers.includes(c) && inlineable(c) && hasWords(c))) {
      for (const p of pickers) {
        const at = position(p.start);
        plan.warnings.push(
          `${file}:${at.line}:${at.column} ${code.slice(p.start, p.end)} picks words in code, which a translator can't see: make the sentence a select, or an entry per case; left as it is`,
        );
      }
      for (const c of children) if (inlineable(c)) consumed.add(c);
      return;
    }
    for (const p of pickers) extractPicked(p.expression as Node, parentName);
    for (const child of children) {
      if (!inlineable(child)) {
        flush();
        continue;
      }
      if (startsBlock(child, run.at(-1))) flush();
      run.push(child);
    }
    flush();
  };

  const picksWords = (child: Node) =>
    child.type === 'JSXExpressionContainer' &&
    !inlineable(child) &&
    shownLiterals(child.expression as Node).some((l) => LETTER.test(literalText(l) ?? ''));

  const hasWords = (node: Node): boolean =>
    node.type === 'JSXText'
      ? LETTER.test(node.value as string)
      : node.type === 'JSXElement'
        ? (node.children as Node[]).some(hasWords)
        : node.type === 'JSXExpressionContainer' && LETTER.test(literalText(node.expression as Node) ?? '');

  /** Each word an expression standing alone can pick, `pending ? 'Saving…' : 'Save'`, as an entry of its own. */
  const extractPicked = (expr: Node, parentName: string | undefined) => {
    const role = (parentName !== undefined ? ROLES[parentName] : undefined) ?? [undefined, undefined];
    for (const literal of shownLiterals(expr)) {
      const text = literalText(literal);
      if (text === undefined || !LETTER.test(text) || looksLikeCode(text) || ignored(literal.start)) continue;
      const message = inSyntax(ctx.config, escapeIcu(text.trim()));
      const { key, reused } = entryFor(message, {}, role, where(parentName));
      const replacement = `<Text id=${JSON.stringify(key)} />`;
      plan.edits.push({ start: literal.start, end: literal.end, text: replacement });
      plan.extractions.push({ file, ...position(literal.start), key, message, reused, where: 'text', replacement });
      needText = true;
    }
  };

  /**
   * An inline element glued to the word before it that opens with a capital, as a label's hint is
   * written, `Init commands` and a line break before `<span>A bash script…</span>`: JSX renders no
   * space there, which no sentence would be written with, so it is a block of its own.
   */
  const startsBlock = (child: Node, before: Node | undefined) => {
    if (child.type !== 'JSXElement' || before?.type !== 'JSXText') return false;
    const first = (child.children as Node[]).find((c) => c.type === 'JSXText' && jsxText(c.value as string).trim() !== '');
    return /[\p{L}\d]$/u.test(jsxText(before.value as string)) && first !== undefined && /^\s*\p{Lu}/u.test(jsxText(first.value as string));
  };

  const inlineable = (child: Node): boolean => {
    if (child.type === 'JSXText') return true;
    if (child.type === 'JSXExpressionContainer')
      return simple(child.expression as Node) || pluralTernary(child.expression as Node) !== undefined;
    if (child.type === 'JSXElement') {
      const name = elementName(child);
      if (name === undefined || child.openingElement.selfClosing || !isInline(name)) return false;
      return (child.children as Node[]).every(inlineable);
    }
    return false;
  };

  const extractRun = (run: Node[], parentName: string | undefined) => {
    // Whitespace at either end stays where it is, so the layout around the run is unchanged: text,
    // and `{' '}`, which is how a space is written before a line break.
    const blank = (n: Node) =>
      (n.type === 'JSXText' && jsxText(n.value as string).trim() === '') ||
      (n.type === 'JSXExpressionContainer' && literalText(n.expression as Node)?.trim() === '');
    const from = run.findIndex((n) => !blank(n));
    if (from === -1) return;
    const nodes = run.slice(from, run.findLastIndex((n) => !blank(n)) + 1);
    // Elements with nothing but whitespace between them are layout, not a sentence: each one's text is
    // its own, as `<li><a href>Home</a></li>` is "Home".
    if (nodes.every((n) => n.type === 'JSXElement' || blank(n))) return;
    const first = nodes[0]!;
    const last = nodes.at(-1)!;
    const values = new Map<string, string>();
    const argDocs: Record<string, string> = {};
    const names = new Map<string, string>();
    const tags = new Set<string>();

    const argName = (expr: Node): string => {
      const source = code.slice(expr.start, expr.end);
      const known = names.get(source);
      if (known !== undefined) return known;
      let inner = expr;
      while (inner.type === 'TSNonNullExpression' || inner.type === 'ChainExpression') inner = inner.expression;
      let name =
        inner.type === 'Identifier'
          ? (inner.name as string)
          : inner.type === 'MemberExpression' && !inner.computed && inner.property?.type === 'Identifier'
            ? (inner.property.name as string)
            : 'value';
      const base = name;
      for (let n = 2; values.has(name) || tags.has(name); n++) name = `${base}${n}`;
      names.set(source, name);
      values.set(name, source);
      argDocs[name] = `TODO: what \`${source}\` holds`;
      return name;
    };

    const piece = (node: Node): string => {
      if (node.type === 'JSXText') return escapeIcu(jsxText(node.value as string));
      if (node.type === 'JSXElement') {
        let tag = elementName(node)!.toLowerCase();
        const base = tag;
        for (let n = 2; tags.has(tag) || values.has(tag); n++) tag = `${base}${n}`;
        tags.add(tag);
        const open = code.slice(node.openingElement.start, node.openingElement.end);
        const close = code.slice(node.closingElement.start, node.closingElement.end);
        values.set(tag, `(chunks) => ${open}{chunks}${close}`);
        return `<${tag}>${(node.children as Node[]).map(piece).join('')}</${tag}>`;
      }
      const expr = node.expression as Node;
      const literal = literalText(expr);
      if (literal !== undefined) return escapeIcu(literal);
      const plural = pluralTernary(expr);
      if (plural !== undefined) {
        const arm = (s: string) => escapeIcu(s).replaceAll('#', "'#'");
        return `{${argName(plural.count)}, plural, one {${arm(plural.one)}} other {${arm(plural.other)}}}`;
      }
      const spliced = splicedText(expr);
      if (spliced !== undefined) refused.push(`{${code.slice(expr.start, expr.end)}} ${spliced}`);
      // A number formatted into a string by hand is the number, formatted by the message instead.
      const counted = formattedNumber(expr);
      if (counted !== undefined) {
        const kind = ctx.kinds.get(`${counted.value.start}:${counted.value.end}`) ?? syntaxKind(counted.value);
        if (kind === undefined || kind === 'number' || kind === 'unknown') return `{${argName(counted.value)}, number${counted.style}}`;
      }
      // What a plural in the sentence counts is a number wherever the sentence shows it.
      const kind = counts.has(code.slice(expr.start, expr.end))
        ? 'number'
        : (ctx.kinds.get(`${expr.start}:${expr.end}`) ?? syntaxKind(expr));
      if (kind === 'node') markup.push(code.slice(expr.start, expr.end));
      return `{${argName(expr)}${kind === 'number' ? ', number' : kind === 'date' ? ', date, medium' : ''}}`;
    };

    const markup: string[] = [];
    const refused: string[] = [];
    const counts = new Set<string>();
    const countsIn = (n: Node) => {
      const plural = n.type === 'JSXExpressionContainer' ? pluralTernary(n.expression as Node) : undefined;
      if (plural !== undefined) counts.add(code.slice(plural.count.start, plural.count.end));
      if (n.type === 'JSXElement') (n.children as Node[]).forEach(countsIn);
    };
    nodes.forEach(countsIn);
    const joined = nodes
      .map(piece)
      .join('')
      // `{n} {n === 1 ? 'file' : 'files'}` counts in one plural: `# file`, `# files`.
      .replace(/\{(\w+), number\} \{\1, plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g, '{$1, plural, one {# $2} other {# $3}}');
    // JSX text's own spaces at the ends stay in the code (below); a literal's go beside the <Text>.
    const lead = first.type === 'JSXText' ? '' : /^\s*/.exec(joined)![0];
    const trail = last.type === 'JSXText' ? '' : /\s*$/.exec(joined)![0];
    let message = joined.trim();
    // A run of spaces, placeholders and punctuation is layout, not words: `{children}` beside an icon.
    const words = message.replace(/\{[^}]*\}|<\/?[\w-]+>|'[{}<]'/g, '');
    if (!LETTER.test(words)) return;
    if (refused.length > 0) {
      const at = position(first.start);
      plan.warnings.push(`${file}:${at.line}:${at.column} ${refused.join('; ')}; this sentence was left as it is`);
      return;
    }
    if (markup.length > 0) {
      const at = position(first.start);
      plan.warnings.push(
        `${file}:${at.line}:${at.column} {${markup.join('}, {')}} holds markup, not text, so this sentence was left as it is: make it a tag, or give the text around it entries of its own`,
      );
      return;
    }
    if (/^en\b/.test(ctx.config.source)) message = draftPlurals(message);
    if (values.size === 0 && looksLikeCode(message)) return;
    // The whitespace at either end stays in the code as it was: a space still renders as one, and a
    // line break still renders as nothing.
    const start = first.type === 'JSXText' ? first.start + (/^\s*/.exec(first.value as string)?.[0].length ?? 0) : first.start;
    const end = last.type === 'JSXText' ? last.end - (/\s*$/.exec(last.value as string)?.[0].length ?? 0) : last.end;
    if (ignored(start)) return;

    message = inSyntax(ctx.config, message);
    const role = parentName !== undefined ? ROLES[parentName] : undefined;
    const { key, reused } = entryFor(message, argDocs, role ?? [undefined, undefined], where(parentName));
    const props = [...values].map(([name, source]) => `${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: ${source}`);
    const space = (s: string) => (s === '' ? '' : `{${JSON.stringify(s)}}`);
    const replacement = `${space(lead)}<Text id=${JSON.stringify(key)}${props.length > 0 ? ` values={{ ${props.join(', ')} }}` : ''} />${space(trail)}`;
    plan.edits.push({ start, end, text: replacement });
    for (const n of nodes) consumed.add(n);
    plan.extractions.push({ file, ...position(start), key, message, reused, where: 'text', replacement });
    needText = true;
  };

  const extractAttribute = (attr: Node, element: Node) => {
    const name = attr.name?.type === 'JSXIdentifier' ? (attr.name.name as string) : '';
    if (!ctx.config.scan.attributes.includes(name) || attr.value === null) return;
    const value = attr.value as Node;
    const expr = value.type === 'JSXExpressionContainer' ? (value.expression as Node) : value;
    // What the attribute says: its text, a template's words around its placeholders, or each text a
    // ternary or a fallback picks. Each is the node it replaces, and the message with its values.
    const said: { node: Node; text: string; message: string; values: [string, string][]; args: Record<string, string> }[] = [];
    const whole = literalText(expr);
    if (whole !== undefined) {
      said.push({ node: value, text: whole, message: escapeIcu(whole), values: [], args: {} });
    } else if (expr.type === 'TemplateLiteral') {
      const template = templateMessage(expr);
      if (template !== undefined) said.push({ node: expr, ...template });
    } else {
      for (const literal of shownLiterals(expr)) {
        const text = literalText(literal);
        if (text !== undefined) said.push({ node: literal, text, message: escapeIcu(text), values: [], args: {} });
      }
    }
    for (const one of said) {
      if (!LETTER.test(one.text) || looksLikeCode(one.text) || ignored(one.node.start)) continue;
      extractSaid(attr, element, name, one);
    }
  };

  /** A template's words with a placeholder for each value, as `t()` takes them; nothing where a value isn't simple. */
  const templateMessage = (template: Node) => {
    const quasis = template.quasis as { value: { cooked: string } }[];
    const exprs = template.expressions as Node[];
    if (!exprs.every(simple)) return undefined;
    const values: [string, string][] = [];
    const args: Record<string, string> = {};
    let message = escapeIcu(quasis[0]!.value.cooked);
    exprs.forEach((e, i) => {
      const source = code.slice(e.start, e.end);
      let name = nameOf(e);
      for (let n = 2; values.some(([v]) => v === name); n++) name = `${nameOf(e)}${n}`;
      values.push([name, source]);
      args[name] = `TODO: what \`${source}\` holds`;
      const kind = ctx.kinds.get(`${e.start}:${e.end}`) ?? syntaxKind(e);
      message += `{${name}${kind === 'number' ? ', number' : kind === 'date' ? ', date, medium' : ''}}${escapeIcu(quasis[i + 1]!.value.cooked)}`;
    });
    return { text: code.slice(template.start + 1, template.end - 1), message, values, args };
  };

  const extractSaid = (
    attr: Node,
    element: Node,
    name: string,
    {
      node,
      text,
      message: said,
      values,
      args,
    }: { node: Node; text: string; message: string; values: [string, string][]; args: Record<string, string> },
  ) => {
    const value = attr.value as Node;
    const at = position(node.start);
    const fn = components.findLast((c) => c.isComponent)?.fn;
    if (fn === undefined || fn.body?.type !== 'BlockStatement') {
      plan.warnings.push(
        `${file}:${at.line}:${at.column} ${name}="${text}" is not inside a component with a body, so it has no t() to read; left as it is`,
      );
      return;
    }
    const call = hookFor(fn);
    if (call === undefined) {
      plan.warnings.push(
        `${file}:${at.line}:${at.column} ${name}="${text}": its component binds both \`t\` and \`copy\` already; left as it is`,
      );
      return;
    }
    const tag = elementName(element) ?? 'element';
    const isComponent = !/^[a-z]/.test(tag);
    const [kind, surface, suffix] = (name === 'title' && isComponent ? COMPONENT_TITLE : ATTRIBUTE_ROLES[name]) ?? [
      undefined,
      undefined,
      name,
    ];
    const component = components.at(-1)?.name;
    const context = `${component ? `In ${component}` : `In ${file}`}, the ${name} of a <${tag}>.`;
    const message = inSyntax(ctx.config, said);
    const { key, reused } = entryFor(message, args, [kind, surface], context, suffix);
    const props = values.map(([n, source]) => `${n}: ${source}`);
    const read = `${call}(${JSON.stringify(key)}${props.length > 0 ? `, { ${props.join(', ')} }` : ''})`;
    // The attribute's whole value is `{t(…)}`; a part of its expression is the call alone.
    const replacement = node === value ? `{${read}}` : read;
    plan.edits.push({ start: node.start, end: node.end, text: replacement });
    plan.extractions.push({ file, ...at, key, message, reused, where: name, replacement });
  };

  /**
   * Makes sure the component can read the catalog, and returns the call that does: `t` from
   * `useCopy()`, or `copy.t` where the component or the module already binds a `t` of its own.
   */
  const hookFor = (fn: Node): string | undefined => {
    const chosen = hooked.get(fn.start);
    if (chosen !== undefined) return chosen;
    const taken = new Set([...topLevel, ...bindingsIn(fn)]);
    const body = code.slice(fn.body.start, fn.body.end);
    const insert = (text: string) => plan.edits.push({ start: fn.body.start + 1, end: fn.body.start + 1, text });
    const firstStatement = fn.body.body[0] as Node | undefined;
    const indent = firstStatement ? ' '.repeat(position(firstStatement.start).column - 1) : '  ';
    let call: string | undefined;
    const destructured = /\{([^{}]*)\}\s*=\s*useCopy\(\)/.exec(body);
    const whole = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useCopy\(\)/.exec(body);
    if (destructured !== null && /(^|[\s,])t(\s*[,}]|\s*$)/.test(destructured[1]!)) {
      call = 't';
    } else if (whole !== null) {
      call = `${whole[1]}.t`;
    } else if (destructured !== null && !taken.has('t')) {
      const at = fn.body.start + destructured.index + 1;
      plan.edits.push({ start: at, end: at, text: ' t,' });
      call = 't';
    } else if (!taken.has('t')) {
      insert(`
${indent}const { t } = useCopy();`);
      call = 't';
    } else if (!taken.has('copy')) {
      insert(`
${indent}const copy = useCopy();`);
      call = 'copy.t';
    }
    if (call !== undefined && destructured === null && whole === null) needUseCopy = true;
    if (call !== undefined) hooked.set(fn.start, call);
    return call;
  };

  const visit = (node: Node, parent: Node | undefined) => {
    const isFunction = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
    if (isFunction) {
      const own = componentName(node, parent);
      const isComponent = own !== undefined && /^(?:[A-Z]|use[A-Z])/.test(own);
      components.push({ fn: node, name: isComponent ? own : components.at(-1)?.name, isComponent });
    }
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      const name = node.type === 'JSXElement' ? elementName(node) : undefined;
      if (node.type === 'JSXElement') {
        for (const attr of node.openingElement.attributes as Node[]) {
          if (attr.type !== 'JSXAttribute') continue;
          extractAttribute(attr, node);
          // `render={() => <p>Hi</p>}` holds JSX of its own.
          if (attr.value?.type === 'JSXExpressionContainer') visit(attr.value as Node, attr);
        }
      }
      if (name === undefined || (name !== 'Text' && !isNonProse(name))) {
        extractChildren(node, node.children as Node[]);
        for (const child of node.children as Node[]) if (!consumed.has(child)) visit(child, node);
      }
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, node);
      } else if (isNode(value)) {
        visit(value, node);
      }
    }
    if (isFunction) components.pop();
  };

  visit(program, undefined);
  plan.extractions.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.column - b.column));
  if (needText || needUseCopy) importEdit(program, code, plan, [...(needText ? ['Text'] : []), ...(needUseCopy ? ['useCopy'] : [])]);
  return plan;
}

/** Adds the names to an existing `prosebook/react` import, or a new import after the last one. */
function importEdit(program: Node, code: string, plan: FilePlan, wanted: string[]) {
  const imports = (program.body as Node[]).filter((s) => s.type === 'ImportDeclaration');
  const existing = imports.find((s) => s.source.value === MODULE && s.importKind !== 'type');
  if (existing) {
    const named = (existing.specifiers as Node[]).filter((s) => s.type === 'ImportSpecifier');
    const have = new Set(named.map((s) => s.local.name as string));
    const missing = wanted.filter((w) => !have.has(w));
    if (missing.length === 0) return;
    if (named.length > 0) {
      plan.edits.push({ start: named.at(-1)!.end, end: named.at(-1)!.end, text: `, ${missing.join(', ')}` });
      return;
    }
  }
  const line = `import { ${wanted.join(', ')} } from '${MODULE}';`;
  const last = imports.at(-1);
  if (last) {
    plan.edits.push({ start: last.end, end: last.end, text: `\n${line}` });
  } else {
    const directive = /^(?:\s*(['"])use \w+\1;?\s*\n)*/.exec(code)?.[0] ?? '';
    plan.edits.push({ start: directive.length, end: directive.length, text: `${line}\n${directive === '' ? '\n' : ''}` });
  }
}

/** The spans of every expression inside JSX, which are the ones that may become placeholders. */
function jsxExpressions(file: string, code: string): Span[] {
  const spans: Span[] = [];
  const walk = (node: Node) => {
    if (node.type === 'JSXExpressionContainer' && node.expression.type !== 'JSXEmptyExpression') {
      spans.push({ start: node.expression.start as number, end: node.expression.end as number });
      // `n.toLocaleString()` is a string; whether `n` is a number decides what it becomes.
      const counted = formattedNumber(node.expression as Node);
      if (counted !== undefined) spans.push({ start: counted.value.start, end: counted.value.end });
    }
    // A template's values, which an attribute's message takes as placeholders.
    if (node.type === 'TemplateLiteral') for (const e of node.expressions as Node[]) spans.push({ start: e.start, end: e.end });

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) walk(child);
      } else if (isNode(value)) {
        walk(value);
      }
    }
  };
  walk(parseSync(file, code).program);
  return spans;
}

/**
 * Plans an extraction over the files in `paths` against the current catalog. With `types` (the
 * default), the project's TypeScript says which placeholders are numbers and dates.
 */
export async function planExtract(
  config: ResolvedConfig,
  paths: string[],
  options: { area?: string; types?: boolean } = {},
): Promise<ExtractPlan> {
  if (options.area !== undefined && !KEY_PATTERN.test(`${options.area}.x`))
    throw new Error(`prosebook: "${options.area}" is not an area: lowercase words joined by -`);
  const known = new Map<string, Known>();
  if (existsSync(config.catalog)) {
    try {
      for (const m of loadCatalog(config).messages) known.set(m.key, { text: m.text, kind: m.kind, surface: m.surface });
    } catch (e) {
      if (!(e instanceof CatalogError)) throw e;
      throw new Error(`prosebook: fix the catalog before extracting into it:\n${e.message}`, { cause: e });
    }
  }
  const shared = config.extract.shared;
  if (shared !== undefined && !KEY_PATTERN.test(`${shared}.x`))
    throw new Error(`prosebook: extract.shared is "${shared}", which is not an area: lowercase words joined by -`);
  const entries: NewEntry[] = [];
  const { areas, warnings } = areasFor(config, paths, options.area);
  const oracle = options.types === false ? undefined : await typescriptOracle(config.root, paths);
  try {
    // One file at a time: each plan sees the entries the ones before it added.
    const files: FilePlan[] = [];
    for (const path of paths) {
      const kinds = new Map<string, ValueKind>();
      if (oracle) {
        const spans = jsxExpressions(path, readFileSync(path, 'utf8'));
        (await oracle.kinds(path, spans)).forEach((kind, i) => {
          if (kind !== undefined && kind !== 'unknown') kinds.set(`${spans[i]!.start}:${spans[i]!.end}`, kind);
        });
      }
      const plan = planFile(path, { config, area: areas.get(path)!, known, entries, kinds });
      plan.warnings.unshift(...(warnings.get(path) ?? []));
      files.push(plan);
    }
    return { files, entries, warnings: repeated(known, entries, shared), types: oracle?.source ?? 'syntax' };
  } finally {
    await oracle?.close();
  }
}

/**
 * Each file's area: `--area`'s, or its own. Two files that would share one, `routes/notifications.tsx`
 * and `components/Notifications.tsx`, would mix two features' keys in one file, so each takes its
 * folder's name too, and says so.
 */
function areasFor(config: ResolvedConfig, paths: string[], given: string | undefined) {
  const nouns = config.lint.properNouns;
  const areas = new Map(paths.map((p) => [p, given ?? areaOf(p, nouns)]));
  const warnings = new Map<string, string[]>();
  if (given !== undefined) return { areas, warnings };
  const byArea = new Map<string, string[]>();
  for (const [path, area] of areas) byArea.set(area, [...(byArea.get(area) ?? []), path]);
  const rel = (p: string) => relative(config.root, p).replaceAll('\\', '/');
  for (const [area, shared] of byArea) {
    if (shared.length < 2) continue;
    const named = shared.map((p) => `${kebabOf(basename(dirname(p)), nouns)}-${area}`);
    if (new Set(named).size < named.length) continue;
    shared.forEach((p, i) => areas.set(p, named[i]!));
    const list = shared.map((p, i) => `${rel(p)} → ${named[i]}`).join(', ');
    for (const p of shared) {
      warnings.set(p, [
        `${shared.map(rel).join(' and ')} would share the area ${area}, so each takes its folder's name: ${list}. Pass --area to choose`,
      ]);
    }
  }
  return { areas, warnings };
}

/** The new entries whose words, in the same role, are entries in other areas too: shared words, kept in several places. */
function repeated(known: Map<string, Known>, entries: NewEntry[], shared: string | undefined): string[] {
  if (shared !== undefined) return [];
  const keysOf = new Map<string, string[]>();
  for (const [key, k] of known) {
    const id = `${k.text}\u0000${k.kind}\u0000${k.surface}`;
    keysOf.set(id, [...(keysOf.get(id) ?? []), key]);
  }
  const said = new Set<string>();
  return entries.flatMap((e) => {
    const keys = keysOf.get(`${e.message}\u0000${e.kind}\u0000${e.surface}`) ?? [];
    const areas = new Set(keys.map((k) => k.slice(0, k.indexOf('.'))));
    if (areas.size < 2 || said.has(e.message)) return [];
    said.add(e.message);
    return [
      `"${e.message}" is an entry in ${areas.size} areas (${keys.join(', ')}): set extract.shared in the config to keep words like it in one`,
    ];
  });
}

/** Applies a plan: rewrites the files and appends the new entries to their area's catalog file. */
export function applyExtract(config: ResolvedConfig, plan: ExtractPlan): string[] {
  const written: string[] = [];
  for (const file of plan.files) {
    if (file.edits.length === 0) continue;
    let code = file.code;
    for (const edit of [...file.edits].sort((a, b) => (a.start !== b.start ? b.start - a.start : b.end - a.end)))
      code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);

    writeFileSync(file.path, code);
    written.push(file.path);
  }
  const byArea = new Map<string, NewEntry[]>();
  for (const entry of plan.entries) byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), entry]);
  for (const [area, entries] of byArea) {
    const path = join(config.catalog, `${area}.yaml`);
    // Written as YAML 1.1, which quotes `n`, `yes` and `on`: they then read the same under 1.1 and 1.2,
    // as the catalog requires.
    const blocks = entries.map((e) => {
      const body: Record<string, unknown> = {};
      if (e.kind) body.kind = e.kind;
      if (e.surface) body.surface = e.surface;
      body.context = e.context;
      if (Object.keys(e.args).length > 0) body.args = e.args;
      body[config.source] = e.message;
      return `# TODO(prosebook extract): check the key, kind and context.\n${stringify({ [e.key]: body }, { lineWidth: 0, version: '1.1' })}`;
    });
    mkdirSync(config.catalog, { recursive: true });
    const current = existsSync(path) ? readFileSync(path, 'utf8') : `${SCHEMA_LINE}\n`;
    writeFileSync(path, `${current.replace(/\n*$/, '\n')}\n${blocks.join('\n')}`);
    written.push(path);
  }
  return written;
}
