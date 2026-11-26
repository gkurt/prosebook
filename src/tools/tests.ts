/**
 * The copy a test says itself: string literals in test files that a catalog message renders, which
 * break the test once the catalog changes. `test-text` reports each with the read that finds it by
 * key, `copy.t` or `copy.match` from `prosebook/test`, and `scan --fix` writes it. `prosebook diff`
 * reads the same literals for the old text of each entry a change rewrote.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { parseSync } from 'oxc-parser';

import type { Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { inlined, TYPE, type MessageFormatElement } from './icu.ts';
import { messageRegExp } from './matcher.ts';
import { CAMEL, CONSTANT, IDENTIFIER, isUnder, looksLikeCode, sourceFiles, unscanned, type Node } from './scan.ts';

/** A unit or component test beside the app's code: `cart.test.ts`, `Cart.spec.tsx`. Stories are no test. */
const TEST_FILE = /\.(?:test|spec)(?:\.[\w-]+)*\.[cm]?[jt]sx?$/;
const FROM = 'prosebook/test';
/** The copy's reads, whose arguments are a key or a locale, values and options: `copy.t('cart.checkout')`, `copy.in('de')`. */
const READS = new Set(['t', 'match', 'in', 'has', 'rich']);
/** What finds an element by its text, Playwright's, Testing Library's and Cypress's: `getByText`, `findAllByRole`, `contains`. */
const LOCATORS =
  /^(?:(?:get|query|find)(?:All)?By(?:Text|Role|Label|LabelText|Placeholder|PlaceholderText|Title|AltText)|contains|should)$/;
/** A locator's options naming the text it holds: `filter({ hasText })`, `locator('li', { hasText })`. */
const HAS_TEXT = new Set(['hasText', 'hasNotText']);
/** What names a test or a group of them, whose title is a sentence about the app and no text on it. */
const TITLES = new Set(['describe', 'it', 'test', 'suite', 'context', 'bench', 'step', 'fixme', 'skip', 'only', 'todo', 'fail', 'slow']);

/** The test files `test-text` reads: every source file under `scan.tests`, and the test files under `scan.dirs`. */
export function testFiles(config: ResolvedConfig): string[] {
  const { scan } = config;
  const skip = unscanned(config);
  const named = sourceFiles(scan.tests, scan.extensions, skip);
  const beside = sourceFiles(scan.dirs, scan.extensions, skip).filter((f) => TEST_FILE.test(f));
  return [...new Set([...named, ...beside])]
    .filter((f) => !/\.(?:vue|svelte|astro)$/.test(f))
    .filter((f) => !isUnder(relative(config.root, f).replaceAll('\\', '/'), scan.ignore['test-text']))
    .sort();
}

export interface TestLiteral {
  text: string;
  start: number;
  end: number;
  line: number;
  column: number;
  /** In a JSX attribute, `label="Save"`, which takes an expression only in braces. */
  attribute: boolean;
  /** What the test expects of the page, a matcher's argument or a locator's text, not what it puts in. */
  asserted: boolean;
}

/** Whether a call is an assertion's matcher, `expect(x).toBe(…)`, `expect.soft(x).not.toHaveText(…)`. */
function isMatcher(callee: Node): boolean {
  if (callee.type !== 'MemberExpression') return false;
  let object = callee.object as Node;
  while (object.type === 'MemberExpression') object = object.object as Node;
  if (object.type !== 'CallExpression') return false;
  const root = object.callee as Node;
  const named = root.type === 'MemberExpression' ? (root.object as Node) : root;
  return named.type === 'Identifier' && named.name === 'expect';
}

/** Whether a call finds an element by its text, its arguments the text a test expects. */
function isLocator(callee: Node): boolean {
  const name = callee.type === 'MemberExpression' ? (callee.property as Node) : callee;
  return name.type === 'Identifier' && LOCATORS.test(name.name as string);
}

/** The root name of a callee: `test` for `test.describe.only`. */
function calleeName(node: Node): string | undefined {
  if (node.type === 'Identifier') return node.name as string;
  if (node.type === 'MemberExpression') {
    const property = node.property as Node;
    return property.type === 'Identifier' && TITLES.has(property.name as string) ? calleeName(node.object as Node) : undefined;
  }
  return undefined;
}

/** The string literals a file holds that may be text on a page: not an import, a key, a type or a test's title. */
export function testLiterals(file: string, code: string): TestLiteral[] {
  const { program } = parseSync(file, code);
  const lines = code.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const position = (at: number) => {
    let line = starts.findLastIndex((s) => s <= at);
    if (line < 0) line = 0;
    return { line: line + 1, column: at - starts[line]! + 1 };
  };
  const ignored = (line: number) => `${lines[line - 2] ?? ''}\n${lines[line - 1] ?? ''}`.includes('prosebook-ignore');
  const found: TestLiteral[] = [];
  const skipped = new Set<Node>();
  const add = (node: Node, text: string, attribute: boolean, asserted: boolean) => {
    if (skipped.has(node)) return;
    const at = position(node.start);
    if (!ignored(at.line)) found.push({ text, start: node.start, end: node.end, ...at, attribute, asserted });
  };
  const visit = (node: Node, parent: Node | undefined, asserted: boolean) => {
    const imported = node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration';
    if (imported && isNode(node.source)) skipped.add(node.source);
    if (
      node.type.startsWith('TS') &&
      node.type !== 'TSAsExpression' &&
      node.type !== 'TSSatisfiesExpression' &&
      node.type !== 'TSNonNullExpression'
    )
      return;
    if (node.type === 'Property' && node.computed !== true) skipped.add(node.key as Node);
    const key = node.type === 'Property' ? (node.key as Node) : undefined;
    const hasText = key?.type === 'Identifier' && HAS_TEXT.has(key.name as string);
    let expects = false;
    if (node.type === 'CallExpression') {
      expects = isMatcher(node.callee as Node) || isLocator(node.callee as Node);
      const name = calleeName(node.callee as Node);
      const first = (node.arguments as Node[])[0];
      if (first !== undefined && name !== undefined && TITLES.has(name)) skipped.add(first);
      const callee = node.callee as Node;
      const method = callee.type === 'MemberExpression' ? (callee.property as Node) : undefined;
      // A read's key, the values it fills placeholders with (`source: 'GitHub'`) and its options are the test's, not the copy's.
      if (method?.type === 'Identifier' && READS.has(method.name as string)) return;
      if (node.callee !== undefined && (node.callee as Node).type === 'Identifier' && (node.callee as Node).name === 'require' && first)
        skipped.add(first);
    }
    if (node.type === 'Literal' && typeof node.value === 'string') add(node, node.value, parent?.type === 'JSXAttribute', asserted);
    if (node.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0) {
      const quasi = (node.quasis as Node[])[0]!;
      add(node, String((quasi.value as { cooked?: string }).cooked ?? ''), false, asserted);
    }
    for (const [field, value] of Object.entries(node)) {
      const inner = asserted || (expects && field === 'arguments') || (hasText && field === 'value');
      if (Array.isArray(value)) for (const v of value) if (isNode(v)) visit(v, node, inner);
      if (isNode(value)) visit(value, node, inner);
    }
  };
  visit(program as unknown as Node, undefined, false);
  return found;
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';
}

/**
 * The literals a test expects of the page, which may be copy: those in a matcher or a locator, less any the file also
 * puts in, typed into a field, seeded or scripted, since a test finding its own data again says no copy.
 */
export function expectedLiterals(file: string, code: string): TestLiteral[] {
  const literals = testLiterals(file, code);
  const input = new Set(literals.filter((l) => !l.asserted).map((l) => l.text.trim()));
  return literals.filter((l) => l.asserted && !input.has(l.text.trim()));
}

/** A text a message can come to, as a test reads it: its key, the locale it is in and the pattern matching it. */
export interface TestPattern {
  key: string;
  locale: string;
  regex: RegExp;
  /** It takes no values, so `copy.t` reads it whole. */
  plain: boolean;
  /** The letters its own words hold, past its placeholders, which a literal must be made of at least half. */
  letters: number;
  /** Its own words, in the text with the fewest. */
  words: number;
  /** It holds a placeholder that may take words, not only a number: `On {branch}`. */
  filled: boolean;
}

const lettersIn = (text: string) => text.match(/\p{L}/gu)?.length ?? 0;
/** Past this many texts a message comes to, it is read whole, by the fewest letters any of them holds. */
const MOST_TEXTS = 32;

/** The texts a message comes to, each arm of a plural or select apart and a tag its words; none past `MOST_TEXTS`. */
function textsOf(elements: MessageFormatElement[]): MessageFormatElement[][] | undefined {
  let rows: MessageFormatElement[][] = [[]];
  for (const el of elements) {
    let options: MessageFormatElement[][] | undefined = [[el]];
    if (el.type === TYPE.select || el.type === TYPE.plural) {
      const arms = Object.values(el.options).map((o) => textsOf(o.value));
      options = arms.every((a) => a !== undefined) ? arms.flat() : undefined;
    } else if (el.type === TYPE.tag) {
      options = textsOf(el.children);
    }
    if (options === undefined) return undefined;
    rows = rows.flatMap((row) => options.map((o) => [...row, ...o]));
    if (rows.length > MOST_TEXTS) return undefined;
  }
  return rows;
}

const wordsIn = (text: string) => text.match(/\p{L}[\p{L}\p{M}'’-]*/gu)?.length ?? 0;

/** What a message's own words count in the text that has the fewest: letters, or words. */
function fewest(elements: MessageFormatElement[], count: (text: string) => number): number {
  let sum = 0;
  for (const el of elements) {
    if (el.type === TYPE.literal) sum += count(el.value);
    if (el.type === TYPE.tag) sum += fewest(el.children, count);
    if (el.type === TYPE.select || el.type === TYPE.plural)
      sum += Math.min(...Object.values(el.options).map((o) => fewest(o.value, count)));
  }
  return sum;
}

/** Whether a placeholder in the message may take words: any but a number's, a `#` or `{n, number}`. */
function takesWords(elements: MessageFormatElement[]): boolean {
  return elements.some((el) => {
    if (el.type === TYPE.literal || el.type === TYPE.pound || el.type === TYPE.number) return false;
    if (el.type === TYPE.tag) return takesWords(el.children);
    if (el.type === TYPE.select || el.type === TYPE.plural) return Object.values(el.options).some((o) => takesWords(o.value));
    return true;
  });
}

/** Past this many words of its own around them, a message's placeholders can't make a literal it by chance. */
const PHRASE_WORDS = 4;

/**
 * Each message, in the source and every translation, as a test would find it: each text it comes to apart, so an
 * arm that is only a placeholder, `other {{role}}`, doesn't make the whole message match any literal. A number it
 * shows matches only text with no letters. A text whose own words hold no letter, `{name}` or `{a}: {b}`, matches too
 * much to say a literal is it.
 */
export function testPatterns(messages: Message[], source: string, locales: readonly string[] = []): TestPattern[] {
  return messages.flatMap((m) =>
    [
      [source, m.ast] as const,
      ...locales.flatMap((l) => {
        const t = m.translations.get(l);
        return t === undefined ? [] : [[l, t.ast] as const];
      }),
    ].flatMap(([locale, ast]) => {
      const whole = inlined(ast);
      const texts = textsOf(whole) ?? [whole];
      return texts.flatMap((text) => {
        const letters = fewest(text, lettersIn);
        if (letters === 0) return [];
        const regex = messageRegExp(text, locale, {}, { numbers: true });
        return [{ key: m.key, locale, regex, plain: m.args.size === 0, letters, words: fewest(text, wordsIn), filled: takesWords(text) }];
      });
    }),
  );
}

/** A literal that reads as code, an ID or a constant: `assistant`, `POST`, `q1`, `sendNow`. */
const codeLike = (text: string) => IDENTIFIER.test(text) || CAMEL.test(text) || CONSTANT.test(text) || looksLikeCode(text);

/**
 * Whether a literal says a message: text the catalog returns, its whole, made at least half of the message's own
 * letters. Through a placeholder that takes words, only where the message's own words make a phrase around it, so
 * `On it.` isn't `On {branch}` but `localhost isn't a public address.` is `{host} isn't a public address.`. A literal
 * reading as code says only a message that is that text alone, word for word.
 */
export function says(text: string, pattern: TestPattern): boolean {
  const letters = lettersIn(text);
  if (letters === 0 || pattern.letters * 2 < letters) return false;
  if (pattern.filled && pattern.words < PHRASE_WORDS) return false;
  if (codeLike(text) && !(pattern.plain && pattern.letters === letters)) return false;
  return pattern.regex.test(text);
}

export interface TestText {
  file: string;
  line: number;
  column: number;
  text: string;
  /** The messages it says, each `key` or `key in locale`: one where the read is sure. */
  says: { key: string; locale: string; plain: boolean }[];
  /** The read to write in its place, where one message says it: `copy.t('cart.checkout')`. */
  read?: string;
  start: number;
  end: number;
  attribute: boolean;
}

/** How a file reads `prosebook/test`'s copy: the name it imports it as, or a `copy` of its own, whose `match` is no test copy's. */
function copyBinding(code: string): { name: string; imported: boolean; own: boolean } {
  const fromTest = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${FROM}['"]`).exec(code);
  const named = fromTest?.[1]?.split(',').map((s) => s.trim().split(/\s+as\s+/));
  const local = named?.find(([name]) => name === 'copy');
  if (local !== undefined) return { name: local[1] ?? local[0]!, imported: true, own: false };
  return { name: 'copy', imported: false, own: /\b(?:const|let|var|function|import)\b[^;\n]*\bcopy\b/.test(code) };
}

/** The read a found literal becomes, `copy.t('k')` or `copy.match('k')`, or none where a `copy` of the file's own has no `match`. */
function readOf(
  binding: { name: string; own: boolean },
  hit: { key: string; locale: string; plain: boolean },
  source: string,
): string | undefined {
  if (binding.own && !hit.plain) return undefined;
  const copy = hit.locale === source ? binding.name : `${binding.name}.in('${hit.locale}')`;
  return `${copy}.${hit.plain ? 't' : 'match'}('${hit.key}')`;
}

/** The literals in a test file that say a message, each with the read to write in its place where one message says it. */
export function testText(file: string, code: string, patterns: TestPattern[], source: string): TestText[] {
  const binding = copyBinding(code);
  return expectedLiterals(file, code).flatMap((literal): TestText[] => {
    const text = literal.text.trim();
    const hits = [
      ...new Map(
        patterns.filter((p) => says(text, p)).map(({ key, locale, plain }) => [`${key} ${locale}`, { key, locale, plain }]),
      ).values(),
    ];
    if (hits.length === 0) return [];
    // A message saying it word for word decides between those that say it through a placeholder.
    const exact = hits.filter((h) => h.plain);
    const sure = exact.length === 1 ? exact : hits.length === 1 ? hits : [];
    const read = sure.length === 1 ? readOf(binding, sure[0]!, source) : undefined;
    return [{ file, says: hits, ...(read !== undefined && { read }), ...literal }];
  });
}

/** The file with each found literal that has a read rewritten to it, and `prosebook/test`'s copy imported where it reads one now. */
export function fixTestText(code: string, found: TestText[]): string {
  const fixed = found.filter((f) => f.read !== undefined).sort((a, b) => b.start - a.start);
  if (fixed.length === 0) return code;
  let next = code;
  for (const f of fixed) next = `${next.slice(0, f.start)}${f.attribute ? `{${f.read}}` : f.read}${next.slice(f.end)}`;
  const binding = copyBinding(code);
  if (binding.imported || binding.own) return next;
  // After the imports there are, so the file's own order holds; at the top where there are none.
  const imports = [...next.matchAll(/^import[\s\S]*?from\s*['"][^'"]+['"];?[^\n]*\n/gm)];
  const last = imports.at(-1);
  const at = last === undefined ? 0 : last.index + last[0].length;
  return `${next.slice(0, at)}import { copy } from '${FROM}';\n${next.slice(at)}`;
}

/** Every test file's literals that say a message of the catalog. */
export function testTextIn(config: ResolvedConfig, messages: Message[], locales: readonly string[]): { found: TestText[]; files: number } {
  const patterns = testPatterns(messages, config.source, locales);
  const files = testFiles(config);
  const found = files.flatMap((path) => {
    const file = relative(config.root, path).replaceAll('\\', '/');
    try {
      return testText(file, readFileSync(path, 'utf8'), patterns, config.source);
    } catch {
      // A file oxc can't parse is no test this check can read; the test runner says why.
      return [];
    }
  });
  return { found, files: files.length };
}
