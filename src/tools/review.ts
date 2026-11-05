/**
 * `prosebook diff`: the copy a change makes, against a git revision, for whoever reviews the words
 * rather than the YAML. Each entry added, removed, renamed or changed, its source as a word diff, the
 * translations it changed and the ones it left stale, and what the lint says of the words it touched.
 * As text for a terminal, or as Markdown for a pull request's comment.
 *
 * The base's catalog, translations and lock are read out of git into a folder of their own and loaded
 * with this project's config, so the two sides differ only in their files.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { loadCatalog, type Catalog, type Message } from './catalog.ts';
import type { ResolvedConfig } from './config.ts';
import { wordDiff, type DiffPart } from './diff.ts';
import { lint, type Finding } from './lint.ts';
import { readLock, reconcile } from './lock.ts';

export interface TranslationChange {
  locale: string;
  /** None where the change adds it. */
  before?: string;
  /** None where the change removes it. */
  after?: string;
}

export interface CopyChange {
  key: string;
  change: 'added' | 'removed' | 'renamed' | 'changed';
  /** The key it had, for one renamed. */
  from?: string;
  /** The source message before and after: one only, where it was added or removed. */
  before?: string;
  after?: string;
  /** The entry's other fields that changed: `context`, `kind`, `args`, ... */
  fields: string[];
  translations: TranslationChange[];
  /** Locales whose translation was made from the source as it was before. */
  stale: string[];
  /** Locales with no translation of an entry this change adds. */
  untranslated: string[];
  /** What the lint says of the words this change wrote, in any locale. */
  findings: Finding[];
}

export interface Review {
  base: string;
  changes: CopyChange[];
}

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

/** The copy changed since `base`, a branch, tag or commit; or why it can't be read. */
export function reviewOf(config: ResolvedConfig, base: string): Review | { problem: string } {
  let top: string;
  try {
    top = git(config.root, ['rev-parse', '--show-toplevel']).toString().trim();
  } catch {
    return { problem: `${config.root} is not in a git repository: diff compares against a git revision` };
  }
  try {
    git(top, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    return { problem: `"${base}" is no commit here: name a branch or a commit, such as origin/main (a shallow clone may not have it)` };
  }
  const before = catalogAt(config, top, base);
  const after = loadCatalog(config, undefined, { partial: true });
  return { base, changes: compare(config, before, after) };
}

/** The catalog as `base` had it, read with this project's config. */
function catalogAt(config: ResolvedConfig, top: string, base: string): Catalog {
  const folder = mkdtempSync(join(tmpdir(), 'prosebook-diff-'));
  try {
    const at = (path: string) => join(folder, relative(top, path));
    const paths = [config.catalog, config.locales, config.lock].map((p) => relative(top, p).replaceAll('\\', '/'));
    const files = git(top, ['ls-tree', '-r', '--name-only', base, '--', ...paths])
      .toString()
      .split('\n')
      .filter((f) => f !== '');
    for (const file of files) {
      const path = join(folder, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, git(top, ['show', `${base}:${file}`]));
    }
    // A base with no catalog yet has no entries, not a missing folder.
    mkdirSync(at(config.catalog), { recursive: true });
    const then = { ...config, root: at(config.root), catalog: at(config.catalog), locales: at(config.locales), lock: at(config.lock) };
    return loadCatalog(then, undefined, { partial: true });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const FIELDS = ['context', 'kind', 'surface', 'fragment', 'args', 'closed', 'allow', 'comment', 'remove'] as const;

function fieldsOf(m: Message): Record<(typeof FIELDS)[number], string> {
  const map = (entries: Map<string, string>) => JSON.stringify([...entries].sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    context: m.context ?? '',
    kind: m.kind ?? '',
    surface: m.surface ?? '',
    fragment: String(m.fragment),
    args: map(m.argDocs),
    closed: JSON.stringify(m.closed),
    allow: map(m.allow),
    comment: m.comment ?? '',
    remove: String(m.remove),
  };
}

function compare(config: ResolvedConfig, before: Catalog, after: Catalog): CopyChange[] {
  const was = new Map(before.messages.map((m) => [m.key, m]));
  const now = new Map(after.messages.map((m) => [m.key, m]));
  const removed = before.messages.filter((m) => !now.has(m.key));
  const added = after.messages.filter((m) => !was.has(m.key));
  // A key gone and one come with the same words is a rename.
  const renamedFrom = new Map<string, Message>();
  for (const m of added) {
    const i = removed.findIndex((r) => r.text === m.text);
    if (i === -1) continue;
    renamedFrom.set(m.key, removed[i]!);
    removed.splice(i, 1);
  }

  const { stale } = reconcile(after, readLock(config.lock));
  const findings = lint(after.messages, config);
  const changes: CopyChange[] = [];
  for (const m of after.messages) {
    const old = was.get(m.key) ?? renamedFrom.get(m.key);
    const translations = translationChanges(old, m);
    const fields =
      old === undefined
        ? []
        : FIELDS.filter((f) => {
            const [a, b] = [fieldsOf(old), fieldsOf(m)];
            return a[f] !== b[f];
          });
    const sourceChanged = old !== undefined && old.text !== m.text;
    if (old !== undefined && !sourceChanged && fields.length === 0 && translations.length === 0 && old.key === m.key) continue;
    const touched = new Set([
      ...(old === undefined || sourceChanged || fields.length > 0 ? [config.source] : []),
      ...translations.flatMap((t) => (t.after === undefined ? [] : [t.locale])),
    ]);
    changes.push({
      key: m.key,
      change: old === undefined ? 'added' : old.key !== m.key ? 'renamed' : 'changed',
      ...(old !== undefined && old.key !== m.key && { from: old.key }),
      ...(old !== undefined && { before: old.text }),
      after: m.text,
      fields,
      translations,
      stale: [...stale].filter(([, keys]) => sourceChanged && keys.has(m.key)).map(([locale]) => locale),
      untranslated: old === undefined ? after.locales.filter((l) => !m.translations.has(l)) : [],
      findings: findings.filter((f) => f.key === m.key && touched.has(f.locale)),
    });
  }
  const gone = (m: Message): CopyChange => ({
    key: m.key,
    change: 'removed',
    before: m.text,
    fields: [],
    translations: [],
    stale: [],
    untranslated: [],
    findings: [],
  });
  changes.push(...removed.map(gone));
  return changes.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** The translations a change wrote, other than those a rename only carried along. */
function translationChanges(old: Message | undefined, m: Message): TranslationChange[] {
  if (old === undefined) return [];
  const locales = new Set([...old.translations.keys(), ...m.translations.keys()]);
  return [...locales].sort().flatMap((locale) => {
    const before = old.translations.get(locale)?.text;
    const after = m.translations.get(locale)?.text;
    if (before === after) return [];
    return [{ locale, ...(before !== undefined && { before }), ...(after !== undefined && { after }) }];
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summaryOf(review: Review): string {
  const count = (change: CopyChange['change']) => review.changes.filter((c) => c.change === change).length;
  const parts = (['changed', 'added', 'removed', 'renamed'] as const).flatMap((c) => (count(c) > 0 ? [`${count(c)} ${c}`] : []));
  const stale = review.changes.reduce((n, c) => n + c.stale.length, 0);
  const findings = review.changes.reduce((n, c) => n + c.findings.length, 0);
  return [
    `${plural(review.changes.length, 'entry', 'entries')} changed since ${review.base}: ${parts.join(', ')}`,
    ...(stale > 0 ? [`${plural(stale, 'translation')} now stale`] : []),
    ...(findings > 0 ? [plural(findings, 'lint finding')] : []),
  ].join('. ');
}

/** The review for a terminal: each entry's change on its line, in `git diff --word-diff`'s notation. */
export function reviewText(review: Review): string {
  if (review.changes.length === 0) return `prosebook: no copy changes since ${review.base}`;
  const notation: Notation = { del: (t) => `[-${t}-]`, add: (t) => `{+${t}+}`, same: (t) => t };
  const lines = [`prosebook: ${summaryOf(review)}.`, ''];
  for (const c of review.changes) {
    const head = c.change === 'renamed' ? `${c.from} → ${c.key}` : c.key;
    lines.push(`${c.change.padEnd(8)} ${head}: ${changeIn(c, notation).replaceAll('\n', ' ')}`);
    for (const note of notesOf(c)) lines.push(`         ${note}`);
    for (const t of c.translations) lines.push(`  ${t.locale.padEnd(6)} ${translationIn(t, notation).replaceAll('\n', ' ')}`);
    for (const f of c.findings) lines.push(`  ${f.severity === 'error' ? 'error' : 'warn '} ${f.locale} [${f.rule}] ${f.message}`);
  }
  return lines.join('\n');
}

/** The comment a pull request's workflow posts, which starts with a marker it can find again to update. */
export const REVIEW_MARKER = '<!-- prosebook diff -->';

/** The review as Markdown: a table of entries, for a pull request's comment. */
export function reviewMarkdown(review: Review): string {
  const lines = [REVIEW_MARKER, '### Copy changes', ''];
  if (review.changes.length === 0) return [...lines, `No copy changes since \`${review.base}\`.`, ''].join('\n');
  const notation: Notation = { del: (t) => `<del>${cell(t)}</del>`, add: (t) => `<ins>${cell(t)}</ins>`, same: cell };
  lines.push(
    `${summaryOf(review).replace(` since ${review.base}`, ` since \`${review.base}\``)}.`,
    '',
    '| Entry | Change |',
    '| --- | --- |',
  );
  for (const c of review.changes) {
    const entry = c.change === 'renamed' ? `\`${c.key}\`<br>renamed from \`${c.from}\`` : `\`${c.key}\`<br>${c.change}`;
    const rows = [
      changeIn(c, notation),
      ...notesOf(c).map((n) => `<sub>${cell(n)}</sub>`),
      ...c.translations.map((t) => `**${t.locale}** ${translationIn(t, notation)}`),
      ...c.findings.map((f) => `**${f.severity === 'error' ? 'error' : 'warn'}** ${f.locale} \`${f.rule}\`: ${cell(f.message)}`),
    ];
    lines.push(`| ${entry} | ${rows.join('<br>')} |`);
  }
  return [...lines, ''].join('\n');
}

interface Notation {
  del(text: string): string;
  add(text: string): string;
  same(text: string): string;
}

const written = (parts: DiffPart[], n: Notation) => parts.map((p) => n[p.op](p.text)).join('');

function changeIn(c: CopyChange, n: Notation): string {
  if (c.change === 'added') return n.add(c.after!);
  if (c.change === 'removed') return n.del(c.before!);
  if (c.before === c.after) return n.same(c.after!);
  return written(wordDiff(c.before!, c.after!), n);
}

function translationIn(t: TranslationChange, n: Notation): string {
  if (t.before === undefined) return n.add(t.after!);
  if (t.after === undefined) return n.del(t.before);
  return written(wordDiff(t.before, t.after), n);
}

function notesOf(c: CopyChange): string[] {
  return [
    ...(c.fields.length > 0 ? [`${c.fields.join(', ')} changed`] : []),
    ...(c.stale.length > 0 ? [`stale in ${c.stale.join(', ')}: their translations were made from the text before`] : []),
    ...(c.untranslated.length > 0 ? [`not yet translated in ${c.untranslated.join(', ')}`] : []),
  ];
}

/** Text in a Markdown table's cell: its pipes, markup and line breaks escaped, so the message reads as written. */
function cell(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_~|[\]])/g, '\\$1')
    .replaceAll('\n', '<br>');
}
