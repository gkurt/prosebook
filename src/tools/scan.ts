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

const NON_PROSE_ELEMENTS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'path']);
const LETTER = /\p{L}/u;

/** Literal text in JSX that a person reads, where it should be a catalog entry. */
export function hardcodedText(file: string, code: string, attributes: string[]): Hardcoded[] {
  const { program } = parseSync(file, code);
  const found: Hardcoded[] = [];
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
    (lines[line - 1] ?? '').includes('copydeck-ignore') || (lines[line - 2] ?? '').includes('copydeck-ignore');
  const report = (node: Node, text: string, where: string) => {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!LETTER.test(trimmed)) return;
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
