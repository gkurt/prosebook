/**
 * `prosebook export`: a locale's entries as XLIFF 2.0 or JSON, for translation tools, and the reader
 * `prosebook import` takes every format back through, todo's YAML and a model's reply included.
 *
 * Messages travel as their ICU or MF2 text, not as XLIFF's inline codes: a plural or a select has no
 * inline form, and the tools that take these files read ICU. A unit carries its source as exported, so
 * a translation of a source that has changed since is refused rather than written as current.
 */
import { isMap, isScalar, parseDocument, type YAMLMap } from 'yaml';

import type { Catalog, Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { changeOf, type StaleTranslation } from './lock.ts';
import { todoMessages } from './todo.ts';

export type ExchangeFormat = 'xliff' | 'json';

export interface Exported {
  /** How many entries the file holds. */
  count: number;
  text: string;
}

/**
 * The entries `todo` would list for `locale`, or every one with `all`, as a file a translation tool
 * reads. The source locale exports every entry, untranslated, for a tool to take as its source.
 */
export function exportOf(
  config: ResolvedConfig,
  catalog: Catalog,
  stale: ReadonlyMap<string, StaleTranslation>,
  locale: string,
  format: ExchangeFormat,
  all = false,
): Exported {
  const isSource = locale === config.source;
  const messages = all || isSource ? catalog.messages : todoMessages(catalog, stale, locale);
  if (messages.length === 0) return { count: 0, text: '' };
  const textOf = (m: Message) => (isSource ? m.text : m.translations.get(locale)?.text);
  if (format === 'json') {
    const json = JSON.stringify(Object.fromEntries(messages.map((m) => [m.key, textOf(m) ?? ''])), null, 2);
    return { count: messages.length, text: `${json}\n` };
  }

  const byArea = new Map<string, Message[]>();
  for (const m of messages) byArea.set(m.area, [...(byArea.get(m.area) ?? []), m]);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${escape(config.source)}"${isSource ? '' : ` trgLang="${escape(locale)}"`}>`,
  ];
  for (const [area, list] of byArea) {
    // Newlines and runs of spaces in a message are its own, which a tool may not normalize away.
    lines.push(`  <file id="${escape(area)}" original="${escape(list[0]!.file)}" xml:space="preserve">`);
    for (const m of list) {
      lines.push(`    <unit id="${m.key}">`);
      const notes = [
        ['context', m.context],
        ['kind', m.kind],
        ['surface', m.surface],
        ...[...m.argDocs].map(([arg, said]) => ['placeholder', `{${arg}}: ${said}`]),
        ['stale', isSource || !stale.has(m.key) ? undefined : `the source changed: ${changeOf(stale.get(m.key)!)}`],
      ].filter((n): n is [string, string] => n[1] !== undefined);
      if (notes.length > 0) {
        lines.push('      <notes>');
        for (const [category, text] of notes) lines.push(`        <note category="${category}">${escape(text)}</note>`);
        lines.push('      </notes>');
      }
      const target = textOf(m);
      // A stale translation goes out as `initial`: given back as `translated`, someone looked at it.
      const state = isSource ? '' : ` state="${target === undefined || stale.has(m.key) ? 'initial' : 'translated'}"`;
      lines.push(`      <segment${state}>`, `        <source>${escape(m.text)}</source>`);
      if (!isSource && target !== undefined) lines.push(`        <target>${escape(target)}</target>`);
      lines.push('      </segment>', '    </unit>');
    }
    lines.push('  </file>');
  }
  lines.push('</xliff>');
  return { count: messages.length, text: `${lines.join('\n')}\n` };
}

/** A translation as a file gives it back, before it is checked against the catalog. */
export interface Returned {
  key: string;
  /** Null or empty is left for later. Anything but text or a number is refused. */
  value: unknown;
  /** Someone looked at it, so one given back unchanged still holds. A YAML or JSON reply always has. */
  checked: boolean;
  /** The source it was made from, where the file says. */
  source?: string;
  /** Why the file's entry can't be read, which leaves it out. */
  problem?: string;
}

/**
 * The translations in a file `import` was given: XLIFF 2.0 when it starts as XML, otherwise YAML,
 * which reads JSON too. Text around fenced blocks is left aside, as a model's reply has it. A nested
 * mapping, as some tools write JSON, joins its keys with dots.
 */
export function readReturned(text: string, locale: string, source: string): { returned: Returned[] } | { problem: string } {
  if (text.trimStart().startsWith('<')) return readXliff(text, locale, source);
  const fenced = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  const doc = parseDocument(fenced.length > 0 ? fenced.join('\n') : text);
  if (doc.errors.length > 0 || !(isMap(doc.contents) || doc.contents === null)) {
    const why = doc.errors[0]?.message.split('\n', 1)[0] ?? 'it is not a mapping';
    return { problem: `the reply isn't YAML or JSON of \`key: translation\` (${why}): fix it, or ask for one YAML block` };
  }
  const returned: Returned[] = [];
  const flatten = (map: YAMLMap, prefix: string) => {
    for (const pair of map.items) {
      const key = prefix + (isScalar(pair.key) ? String(pair.key.value) : String(pair.key));
      if (isMap(pair.value)) flatten(pair.value, `${key}.`);
      else returned.push({ key, value: isScalar(pair.value) ? pair.value.value : pair.value, checked: true });
    }
  };
  if (isMap(doc.contents)) flatten(doc.contents, '');
  return { returned };
}

function readXliff(text: string, locale: string, source: string): { returned: Returned[] } | { problem: string } {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (e) {
    return { problem: `the file isn't XML (${messageOf(e)}): give it back as the tool exported it` };
  }
  if (root.name !== 'xliff') return { problem: `the file is <${root.name}>, not XLIFF: export it from the tool as XLIFF 2.0` };
  if (!root.attrs.version?.startsWith('2.'))
    return { problem: `the file is XLIFF ${root.attrs.version ?? 'of no version'}: export it from the tool as XLIFF 2.0` };
  const { srcLang, trgLang } = root.attrs;
  if (srcLang !== undefined && srcLang.toLowerCase() !== source.toLowerCase())
    return { problem: `the file translates from ${srcLang}, and the source is ${source}: export it again from prosebook` };
  if (trgLang === undefined)
    return { problem: `the file names no trgLang: give it the ${locale} translations, or set trgLang="${locale}"` };
  if (trgLang.toLowerCase() !== locale.toLowerCase())
    return { problem: `the file translates into ${trgLang}, not ${locale}: import it as ${trgLang}` };

  const returned: Returned[] = [];
  const units = (el: XmlElement): XmlElement[] =>
    elements(el).flatMap((child) =>
      child.name === 'unit' ? [child] : child.name === 'file' || child.name === 'group' ? units(child) : [],
    );
  for (const unit of units(root)) {
    const key = unit.attrs.id ?? '';
    // A tool may split a unit into sentences: its text is every part's in order, what lies between them included.
    const parts = elements(unit).filter((el) => el.name === 'segment' || el.name === 'ignorable');
    const segments = parts.filter((el) => el.name === 'segment');
    const sourceOf = (el: XmlElement) => elements(el).find((c) => c.name === 'source');
    const targetOf = (el: XmlElement) => elements(el).find((c) => c.name === 'target');
    try {
      const unitSource = parts.map((p) => textOf(sourceOf(p))).join('');
      const translated = segments.filter((s) => targetOf(s) !== undefined).length;
      if (translated === 0) {
        returned.push({ key, value: null, checked: false, source: unitSource });
        continue;
      }
      if (translated < segments.length)
        throw new Error(`${translated} of its ${segments.length} segments are translated: translate the rest`);
      const value = parts.map((p) => textOf(targetOf(p) ?? sourceOf(p))).join('');
      // XLIFF's default state is `initial`: nobody has looked at it yet.
      const checked = segments.every((s) => (s.attrs.state ?? 'initial') !== 'initial');
      returned.push({ key, value, checked, source: unitSource });
    } catch (e) {
      returned.push({ key, value: null, checked: false, problem: messageOf(e) });
    }
  }
  return { returned };
}

/** The text of a <source> or <target>, refusing XLIFF's inline codes, which prosebook never writes. */
function textOf(el: XmlElement | undefined): string {
  if (el === undefined) return '';
  return el.children
    .map((child) => {
      if (typeof child === 'string') return child;
      // <cp> holds a character XML can't.
      if (child.name === 'cp' && child.attrs.hex !== undefined) return String.fromCodePoint(Number.parseInt(child.attrs.hex, 16));
      throw new Error(`the ${el.name} holds an inline <${child.name}>: have the tool keep placeholders as the text they were exported as`);
    })
    .join('');
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface XmlElement {
  /** Without its namespace prefix. */
  name: string;
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

const elements = (el: XmlElement) => el.children.filter((c): c is XmlElement => typeof c !== 'string');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string, at: number): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    const char = ENTITIES[ref];
    if (char === undefined) throw new Error(`&${ref}; near offset ${at} is no XML entity`);
    return char;
  });
}

/**
 * Just enough XML for XLIFF: elements, attributes, text, CDATA and character references. Comments,
 * processing instructions and a doctype are skipped; no DTD is read, so no entity of one is known.
 */
function parseXml(text: string): XmlElement {
  const document: XmlElement = { name: '', attrs: {}, children: [] };
  const open: XmlElement[] = [document];
  let i = 0;
  const skip = (from: string, to: string) => {
    const end = text.indexOf(to, i + from.length);
    if (end === -1) throw new Error(`${from} at offset ${i} never ends`);
    const body = text.slice(i + from.length, end);
    i = end + to.length;
    return body;
  };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const parent = open.at(-1)!;
    if (lt !== i) {
      const end = lt === -1 ? text.length : lt;
      if (open.length > 1) parent.children.push(decode(text.slice(i, end), i));
      else if (text.slice(i, end).trim() !== '') throw new Error(`text at offset ${i} is outside the root element`);
      i = end;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      skip('<!--', '-->');
      continue;
    }
    if (text.startsWith('<?', i)) {
      skip('<?', '?>');
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      parent.children.push(skip('<![CDATA[', ']]>'));
      continue;
    }
    if (text.startsWith('<!', i)) {
      skip('<!', '>');
      continue;
    }
    if (text.startsWith('</', i)) {
      const at = i;
      const name = localName(skip('</', '>').trim());
      if (open.length === 1 || parent.name !== name) throw new Error(`</${name}> at offset ${at} closes nothing open`);
      open.pop();
      continue;
    }
    TAG.lastIndex = i;
    const tag = TAG.exec(text);
    if (tag === null) throw new Error(`the tag at offset ${i} is malformed`);
    const attrs: Record<string, string> = {};
    for (const [, name, double, single] of tag[2]!.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[localName(name!)] = decode(double ?? single ?? '', i);
    const el: XmlElement = { name: localName(tag[1]!), attrs, children: [] };
    if (open.length === 1 && document.children.length > 0) throw new Error(`a second root element at offset ${i}`);
    parent.children.push(el);
    if (tag[3] !== '/') open.push(el);
    i += tag[0].length;
  }
  if (open.length > 1) throw new Error(`<${open.at(-1)!.name}> is never closed`);
  const root = elements(document)[0];
  if (root === undefined) throw new Error('there is no element');
  return root;
}

const TAG = /<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;

const localName = (name: string) => name.slice(name.indexOf(':') + 1);
