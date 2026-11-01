import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createCopy, defineCatalog, type CompiledMessages, type CopyOptions } from 'copydeck';
import { compileLocale, localeExpression, resolveConfig, type CopydeckConfig, type Entry, type ResolvedConfig } from 'copydeck/tools';

import { parseMessage } from '#src/tools/icu.ts';

const TMP = join(import.meta.dir, '.tmp');
let counter = 0;

/** A project on disk holding `files`, and its resolved config. */
export function fixture(files: Record<string, string>, config: CopydeckConfig = {}): ResolvedConfig {
  const root = join(TMP, `${process.pid}-${counter++}`);
  rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  mkdirSync(join(root, 'copy', 'catalog'), { recursive: true });
  return resolveConfig(root, config);
}

/** Compiles entries and evaluates them, as a bundler would the generated module. */
export function compiled(entries: Iterable<Entry>): CompiledMessages {
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- evaluating our own generated code is the point of the test
  return new Function(`return ${localeExpression(compileLocale(entries))};`)() as CompiledMessages;
}

/** A copy over messages written inline, per locale, `en` first. */
export function copyOf(locales: Record<string, Record<string, string>>, options: CopyOptions<string> = {}) {
  const messages = Object.fromEntries(
    Object.entries(locales).map(([locale, msgs]) => [locale, compiled(Object.entries(msgs).map(([k, v]): Entry => [k, parseMessage(v)]))]),
  );
  const [source] = Object.keys(locales);
  return createCopy(defineCatalog({ source: source!, locales: Object.keys(locales), messages, loaders: {} }), options);
}
