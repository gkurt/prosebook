/**
 * The prose of the config's `docs`, Markdown files, as entries the lint reads as it does text in code
 * (`scanned.ts`): each heading, paragraph, list item, table cell and quote one place, keyed by its
 * words. Code blocks, HTML blocks and front matter aren't prose, so they're passed by; in the prose,
 * code spans and bare URLs are placeholders (`docMessageOf`), and links, emphasis and tags leave their
 * words. Not a full CommonMark reader: enough of its blocks to find where each piece of prose starts.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';

import type { Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { ALLOW_COMMENT, decodeEntities, isUnder, looksLikeCode, sourceFiles, type Hardcoded } from './scan.ts';
import { scannedMessages, wordsOfDoc } from './scanned.ts';

const EXTENSIONS = ['.md', '.mdx'];

/** Paths a command or the config named that aren't there, each with why. */
export class PathsError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

/** The Markdown files `docs` names, from the root with `/`. */
export function docFiles(config: Pick<ResolvedConfig, 'root' | 'docs'>): string[] {
  const { root, docs } = config;
  const files = new Set<string>();
  const problems: string[] = [];
  const add = (path: string) => files.add(relative(root, path).replaceAll('\\', '/'));
  for (const pattern of docs.include) {
    if (/[*?[{]/.test(pattern)) {
      // A glob is matched against the files under the folders before its first wildcard.
      const base = pattern.slice(0, pattern.search(/[*?[{]/)).replace(/[^/]*$/, '');
      for (const path of sourceFiles([join(root, base)], EXTENSIONS)) {
        const file = relative(root, path).replaceAll('\\', '/');
        if (matchesGlob(file, pattern)) files.add(file);
      }
      continue;
    }
    const path = join(root, pattern);
    let isDir: boolean;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      problems.push(`${pattern} isn't there: name a Markdown file or a folder from the config's folder`);
      continue;
    }
    if (isDir) sourceFiles([path], EXTENSIONS).forEach(add);
    else add(path);
  }
  if (problems.length > 0) throw new PathsError(problems);
  return [...files].filter((file) => !isUnder(file, docs.exclude)).sort();
}

/** The docs' prose as entries, each piece at every place its words stand. */
export function docsOf(config: ResolvedConfig): Message[] {
  const places = docFiles(config).flatMap((file) => proseIn(file, readFileSync(join(config.root, file), 'utf8')));
  return scannedMessages(config, places);
}

/** A line of a block, where its text starts in the file. */
interface Line {
  text: string;
  line: number;
  column: number;
}

/** What comments just above a block ask of it. */
interface Asked {
  ignore: boolean;
  allow: Record<string, string>;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
/**
 * The start of an HTML block, which isn't prose: a block-level element, a component (MDX), a comment
 * or a declaration, or a line of tags alone. An inline tag starting a line of prose, `<kbd>`, is prose.
 */
const HTML_BLOCK =
  /^ {0,3}(?:<\/?(?:address|article|aside|blockquote|center|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|iframe|img|li|main|nav|ol|p|picture|pre|script|section|source|style|summary|table|tbody|td|tfoot|th|thead|tr|ul|video)(?:[\s>/]|$)|<\/?[A-Z]|<!|<\?|(?:<[^>]+>\s*)+$)/i;
/** An MDX file's imports and exports, which are code. */
const MDX_CODE = /^(?:import|export)\s/;
const REFERENCE = /^ {0,3}\[[^\]^][^\]]*\]:/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const blank = (text: string) => text.trim() === '';
const indentOf = (text: string) => /^[ \t]*/.exec(text)![0].replaceAll('\t', '    ').length;

/** The prose of one Markdown file. */
export function proseIn(file: string, source: string): Hardcoded[] {
  const lines = source.split(/\r\n|\n|\r/).map((text, i) => ({ text, line: i + 1, column: 1 }));
  // Front matter is data, not prose.
  if (lines[0]?.text === '---') {
    const end = lines.findIndex((l, i) => i > 0 && (l.text === '---' || l.text === '...'));
    if (end > 0) lines.splice(0, end + 1);
  }
  const found: Hardcoded[] = [];
  blocks(lines, 'paragraph', file, found);
  return found;
}

/**
 * The prose in `lines`, each piece pushed to `found`: a paragraph is said as `where`, so a list item's
 * paragraphs are items. A list item or a quote is read again as lines of its own.
 */
function blocks(lines: Line[], where: string, file: string, found: Hardcoded[]): void {
  let asked: Asked = { ignore: false, allow: {} };
  const say = (first: Line, raw: string, as: string, skip = asked) => {
    if (skip.ignore) return;
    const text = proseOf(raw);
    if (text === undefined) return;
    const column = first.column + indentOf(first.text);
    const allow = Object.keys(skip.allow).length > 0 ? { allow: { ...skip.allow } } : {};
    found.push({ file, line: first.line, column, text, where: as, via: 'doc', ...allow });
  };
  let i = 0;
  while (i < lines.length) {
    const first = lines[i]!;
    const { text } = first;
    if (blank(text)) {
      asked = { ignore: false, allow: {} };
      i++;
      continue;
    }
    const fence = FENCE.exec(text);
    if (fence !== null) {
      const mark = fence[1]!;
      const close = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}[ \\t]*$`);
      i++;
      while (i < lines.length && !close.test(lines[i]!.text)) i++;
      i++;
      asked = { ignore: false, allow: {} };
      continue;
    }
    if (/^ {0,3}<!--/.test(text)) {
      // A comment asks of the block below it: `prosebook-ignore` passes it by, `prosebook-allow` exempts it.
      let comment = text;
      while (!comment.includes('-->') && i + 1 < lines.length) comment += `\n${lines[++i]!.text}`;
      i++;
      if (/prosebook-ignore\b/.test(comment)) asked = { ...asked, ignore: true };
      for (const [, rule, why] of comment.matchAll(ALLOW_COMMENT)) asked = { ...asked, allow: { ...asked.allow, [rule!]: why!.trim() } };
      continue;
    }
    if (indentOf(text) >= 4 || HTML_BLOCK.test(text) || (file.endsWith('.mdx') && MDX_CODE.test(text))) {
      // Indented code, an HTML block or MDX's code, which runs to the next blank line.
      while (i < lines.length && !blank(lines[i]!.text)) i++;
      asked = { ignore: false, allow: {} };
      continue;
    }
    const heading = HEADING.exec(text);
    if (heading !== null) {
      const words = text
        .slice(heading[0].length)
        .replace(/(?:^|[ \t]+)#+[ \t]*$/, '')
        .replace(/[ \t]*\{#[\w-]+\}[ \t]*$/, '');
      say({ ...first, column: first.column + heading[0].length - indentOf(text) }, words, 'heading');
      asked = { ignore: false, allow: {} };
      i++;
      continue;
    }
    if (BREAK.test(text) || REFERENCE.test(text)) {
      i++;
      continue;
    }
    if (QUOTE.test(text)) {
      const inner: Line[] = [];
      for (; i < lines.length && !blank(lines[i]!.text); i++) {
        const l = lines[i]!;
        const marker = QUOTE.exec(l.text)?.[0] ?? '';
        // A callout's marker, `[!NOTE]`, is no prose.
        const rest = l.text.slice(marker.length).replace(/^\[![A-Za-z]+\][ \t]*$/, '');
        inner.push({ text: rest, line: l.line, column: l.column + marker.length });
      }
      if (!asked.ignore) nested(inner, 'quote', file, found, asked);
      asked = { ignore: false, allow: {} };
      continue;
    }
    if (ITEM.test(text)) {
      i = list(lines, i, file, found, asked);
      asked = { ignore: false, allow: {} };
      continue;
    }
    if (text.includes('|') && DELIMITER_ROW.test(lines[i + 1]?.text ?? '') && lines[i + 1]!.text.includes('-')) {
      const rows = [first];
      for (i += 2; i < lines.length && !blank(lines[i]!.text) && lines[i]!.text.includes('|'); i++) rows.push(lines[i]!);
      rows.forEach((row, r) => {
        for (const cell of cellsOf(row)) say(cell, cell.text, r === 0 ? 'header' : 'cell');
      });
      asked = { ignore: false, allow: {} };
      continue;
    }
    // A paragraph: its lines to a blank one or a block that interrupts it.
    const para = [first];
    for (i++; i < lines.length; i++) {
      const next = lines[i]!.text;
      if (SETEXT.test(next)) {
        say(first, para.map((l) => l.text).join('\n'), 'heading');
        i++;
        para.length = 0;
        break;
      }
      if (blank(next) || interrupts(next)) break;
      para.push(lines[i]!);
    }
    if (para.length > 0) say(first, para.map((l) => l.text).join('\n'), where);
    asked = { ignore: false, allow: {} };
  }
}

/** Lines read as blocks of their own, the comments above them asking of every piece. */
function nested(lines: Line[], where: string, file: string, found: Hardcoded[], asked: Asked): void {
  const from = found.length;
  blocks(lines, where, file, found);
  if (Object.keys(asked.allow).length === 0) return;
  for (const place of found.slice(from)) place.allow = { ...asked.allow, ...place.allow };
}

/** Whether a line starts a block, which ends a paragraph above it. */
function interrupts(text: string): boolean {
  if (FENCE.test(text) || HEADING.test(text) || BREAK.test(text) || QUOTE.test(text) || HTML_BLOCK.test(text)) return true;
  // An ordered list interrupts a paragraph only from 1, and an empty item none.
  const item = ITEM.exec(text);
  return item !== null && !blank(text.slice(item[0].length)) && (/^[-*+]$/.test(item[2]!) || /^1[.)]$/.test(item[2]!));
}

/**
 * A list from line `i`: each item's lines, its marker taken off and its continuation lines' indent,
 * read as blocks of their own. Gives back the line after it.
 */
function list(lines: Line[], i: number, file: string, found: Hardcoded[], asked: Asked): number {
  while (i < lines.length) {
    const first = lines[i]!;
    const item = ITEM.exec(first.text);
    if (item === null) break;
    const content = item[0].length;
    const task = /^\[[ xX]\][ \t]+/.exec(first.text.slice(content))?.[0].length ?? 0;
    const inner: Line[] = [{ text: first.text.slice(content + task), line: first.line, column: first.column + content + task }];
    let lazy = !blank(inner[0]!.text);
    for (i++; i < lines.length; i++) {
      const l = lines[i]!;
      if (blank(l.text)) {
        inner.push({ ...l, text: '' });
        lazy = false;
        continue;
      }
      if (indentOf(l.text) >= content) {
        const cut = Math.min(content, /^ */.exec(l.text)![0].length);
        inner.push({ text: l.text.slice(cut), line: l.line, column: l.column + cut });
        lazy = true;
        continue;
      }
      // A paragraph's line may run on unindented, until a block starts.
      if (lazy && !interrupts(l.text) && !ITEM.test(l.text)) {
        inner.push(l);
        continue;
      }
      break;
    }
    while (inner.length > 0 && blank(inner.at(-1)!.text)) inner.pop();
    if (!asked.ignore) nested(inner, 'item', file, found, asked);
    // A blank line ends the list unless the next item follows it.
    if (i < lines.length && !ITEM.test(lines[i]!.text)) break;
  }
  return i;
}

/** A table row's cells, each where its text starts. A `|` escaped, or in a code span, is the cell's. */
function cellsOf(row: Line): Line[] {
  const cells: Line[] = [];
  let start = 0;
  let ticks = 0;
  const text = row.text;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = /^\s*/.exec(raw)![0].length;
    cells.push({ text: raw.trim(), line: row.line, column: row.column + start + lead });
  };
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (c === '\\') {
      at++;
    } else if (c === '`') {
      ticks ^= 1;
    } else if (c === '|' && ticks === 0) {
      if (text.slice(0, at).trim() !== '') push(at);
      start = at + 1;
    }
  }
  if (text.slice(start).trim() !== '') push(text.length);
  return cells.filter((c) => c.text !== '');
}

/**
 * A block's Markdown as the words it shows: code spans and URLs kept as written, for `docMessageOf`;
 * links, emphasis and HTML tags leaving their words, images and footnote marks nothing. Nothing where
 * no word is left, or what is left reads as code.
 */
export function proseOf(markdown: string): string | undefined {
  const kept: string[] = [];
  const keep = (text: string) => `${kept.push(text) - 1}`;
  let text = markdown
    // Code first: nothing in a span is Markdown.
    .replace(/(`+)([\s\S]+?)\1(?!`)/g, (_, ticks: string, code: string) => keep(`${ticks}${code.replace(/\s+/g, ' ')}${ticks}`))
    .replace(/<kbd>([\s\S]*?)<\/kbd>/gi, (_, key: string) => keep(`\`${key}\``))
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c: string) => keep(c))
    .replace(/<((?:https?|mailto):[^\s>]+)>/g, (_, url: string) => keep(url))
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])?/g, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[([^\]]+)\](?:\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)|\[[^\]]*\])/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/g, '');
  for (const mark of ['\\*\\*', '__', '~~', '\\*']) text = text.replace(new RegExp(`${mark}(?=\\S)([\\s\\S]*?\\S)${mark}`, 'g'), '$1');
  text = text.replace(/(?<![\p{L}\p{N}])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}])/gu, '$1');
  text = decodeEntities(text)
    .replace(/[ \t]*\\?\n[ \t]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d+)/g, (_, n: string) => kept[Number(n)]!);
  return /\p{L}/u.test(wordsOfDoc(text)) && !looksLikeCode(text) ? text : undefined;
}
