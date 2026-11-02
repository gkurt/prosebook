/**
 * `prosebook migrate`: a catalog and its translations rewritten from one syntax to the other. Each
 * message is written in the target syntax, read back, and rendered both ways over sample values, so
 * one that can't be written, or would come out different, is reported before anything changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMap, parseDocument, Scalar } from 'yaml';

import { createHelpers, flatten } from '#src/runtime/helpers.ts';
import type { CompiledMessages } from '#src/runtime/types.ts';

import { loadCatalog } from './catalog.ts';
import { compileLocale, localeExpression } from './compile.ts';
import type { ResolvedConfig } from './config.ts';
import { argsOf, tagsOf, type MessageFormatElement } from './icu.ts';
import { readMessage, writeMessage, type MessageFormatVersion } from './syntax.ts';

interface Located {
  key: string;
  locale: string;
  /** The file, relative to the project root. */
  file: string;
}

export interface MigratePlan {
  to: MessageFormatVersion;
  rewrites: (Located & { before: string; after: string })[];
  /** Messages the target syntax can't say, and why. Nothing is written while there are any. */
  blocked: (Located & { reason: string })[];
  /** Messages that would render differently, with the first values that show it. */
  changed: (Located & { values: string; before: string; after: string })[];
}

export function planMigrate(config: ResolvedConfig, to: MessageFormatVersion): MigratePlan {
  // Both syntaxes read without isolation marks, which MF1 never has, so their renders compare.
  const catalog = loadCatalog({ ...config, isolate: false });
  const plan: MigratePlan = { to, rewrites: [], blocked: [], changed: [] };
  for (const m of catalog.messages) {
    const versions = [
      { locale: config.source, text: m.text, ast: m.ast, file: m.file },
      ...[...m.translations].map(([locale, t]) => ({ locale, text: t.text, ast: t.ast, file: t.file })),
    ];
    for (const { locale, text, ast, file } of versions) {
      const at = { key: m.key, locale, file };
      let after: string;
      let back: MessageFormatElement[];
      try {
        after = writeMessage(to, ast, locale);
        back = readMessage(to, after, locale, false);
      } catch (e) {
        plan.blocked.push({ ...at, reason: (e as Error).message });
        continue;
      }
      const difference = firstDifference(ast, back, locale);
      if (difference !== undefined) plan.changed.push({ ...at, ...difference });
      if (after !== text) plan.rewrites.push({ ...at, before: text, after });
    }
  }
  return plan;
}

/** Writes the plan's rewrites into the YAML files, keeping their comments and layout. Returns the files written. */
export function applyMigrate(config: ResolvedConfig, plan: MigratePlan): string[] {
  if (plan.blocked.length > 0) throw new Error('prosebook: some messages have no equivalent in the target syntax; nothing was written');
  const byFile = Map.groupBy(plan.rewrites, (r) => r.file);
  for (const [file, rewrites] of byFile) {
    const path = join(config.root, file);
    // As YAML 1.1, so a new value that 1.1 would read differently, like `n`, is quoted.
    const doc = parseDocument(readFileSync(path, 'utf8'), { version: '1.1' });
    for (const r of rewrites) {
      const value = doc.createNode(r.after);
      if (r.after.includes('\n')) value.type = Scalar.BLOCK_LITERAL;
      const entry = doc.get(r.key, true);
      if (isMap(entry)) entry.set(config.source, value);
      else doc.set(r.key, value);
    }
    writeFileSync(path, doc.toString({ lineWidth: 0 }));
  }
  return [...byFile.keys()];
}

const NUMBERS = [0, 1, 2, 3, 5, 11, 21, 101, 1.5, 1234.5];
const DATE = new Date(Date.UTC(2026, 0, 5, 14, 30, 15));

function samplesOf(type: string): unknown[] {
  if (type === 'number') return NUMBERS;
  if (type === 'Date | number') return [DATE];
  const named = [...type.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
  return named.length > 0 ? [...named, 'zzz'] : ['Ada'];
}

/** Every combination of sample values, or each argument varied alone where there are too many. */
function* samples(a: MessageFormatElement[], b: MessageFormatElement[]): Generator<Record<string, unknown>> {
  const types = new Map<string, Set<unknown>>();
  for (const [name, type] of [...argsOf(a), ...argsOf(b)]) {
    const set = types.get(name) ?? new Set();
    for (const value of samplesOf(type)) set.add(value);
    types.set(name, set);
  }
  const tags = Object.fromEntries(
    [...new Set([...tagsOf(a), ...tagsOf(b)])].map((t) => [t, (c: unknown[]) => `<${t}>${c.join('')}</${t}>`]),
  );
  const names = [...types.keys()];
  const lists = names.map((n) => [...types.get(n)!]);
  if (lists.reduce((n, l) => n * l.length, 1) <= 1000) {
    let combos: unknown[][] = [[]];
    for (const list of lists) combos = combos.flatMap((c) => list.map((v) => [...c, v]));
    for (const combo of combos) yield { ...tags, ...Object.fromEntries(names.map((n, i) => [n, combo[i]])) };
    return;
  }
  const base = Object.fromEntries(names.map((n, i) => [n, lists[i]![0]]));
  for (const [i, n] of names.entries()) for (const value of lists[i]!) yield { ...tags, ...base, [n]: value };
}

function renderer(ast: MessageFormatElement[], locale: string): (values: Record<string, unknown>) => string {
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- evaluating our own compiled message, as the bundle would
  const messages = new Function(`return ${localeExpression(compileLocale([['m', ast]]))};`)() as CompiledMessages;
  const message = messages.m!;
  const h = createHelpers(locale);
  return (values) => (typeof message === 'string' ? message : flatten(message(values, h)).join(''));
}

function firstDifference(a: MessageFormatElement[], b: MessageFormatElement[], locale: string) {
  const before = renderer(a, locale);
  const after = renderer(b, locale);
  for (const values of samples(a, b)) {
    const x = before(values);
    const y = after(values);
    if (x !== y) {
      const shown = Object.entries(values)
        .filter(([, v]) => typeof v !== 'function')
        .map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString() : JSON.stringify(v)}`);
      return { values: `{ ${shown.join(', ')} }`, before: x, after: y };
    }
  }
  return undefined;
}
