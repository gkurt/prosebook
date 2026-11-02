/**
 * The catalog as Apple `.strings` tables: `<locale>.lproj/<name>.strings` per locale, each holding
 * what that locale shows, every fallback resolved. Plain `.strings` and not a String Catalog, which
 * only Xcode compiles: an app bundled by other tools copies these into its `Resources` as they are.
 *
 * The Swift target covers what code shows; these are for what the system reads from a bundle. With
 * `plist`, the table is `InfoPlist`: the permission prompts and names in that Info.plist, an entry
 * per key it has, which its own text must match in the source locale.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Catalog, Message, Problem } from '#src/tools/catalog.ts';
import type { Entry } from '#src/tools/compile.ts';
import type { NativeTarget } from '#src/tools/config.ts';
import { staticLiteral } from '#src/tools/icu.ts';
import { checkNames } from './emit.ts';
import { fileOf, foundIn, LEAVE_OUT, restOf, wordsFor } from './model.ts';
import { formatString, noteOf, type Printf } from './printf.ts';

/** Text inside a `.strings` file's quotes; `%` doubled where the string has arguments. */
function escape(text: string, formatted: boolean): string {
  const out = text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
  return formatted ? out.replaceAll('%', '%%') : out;
}

const PRINTF: Printf = {
  platform: 'Apple',
  formatter: 'String(format:)',
  holder: '.strings files',
  string: '@',
  escape,
  plural: (name) =>
    `{${name}} is a plural, which a .strings file can't hold (it takes a .stringsdict, which this target doesn't write): show it from the Swift target, ${LEAVE_OUT}`,
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** An XML plist's string values by key, read as its text is: every `<key>` followed by a `<string>`. */
function plistStrings(xml: string): Map<string, string> {
  const strings = new Map<string, string>();
  for (const [, key, value] of xml.matchAll(/<key>([^<]*)<\/key>\s*(?:<string>([^<]*)<\/string>|<string\/>)/g)) {
    strings.set(
      key!,
      (value ?? '').replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-f]+);/gi, (_, e: string) =>
        e.startsWith('#')
          ? String.fromCodePoint(Number.parseInt(e.slice(/x/i.test(e[1]!) ? 2 : 1), /x/i.test(e[1]!) ? 16 : 10))
          : ENTITIES[e.toLowerCase()]!,
      ),
    );
  }
  return strings;
}

/** The files `target` writes, by path, or a problem for every message it can't hold. */
export function appleStrings(
  target: NativeTarget & { name: string },
  root: string,
  catalog: Catalog,
  locales: string[],
  entries: Map<string, Entry[]>,
  banner: string,
): { files: Map<string, string>; problems: Problem[] } {
  const source = locales[0]!;
  const asts = new Map([...entries].map(([locale, list]) => [locale, new Map(list)]));
  const problems: Problem[] = [];
  const error = (m: Message, message: string, file = m.file) =>
    problems.push({ severity: 'error', file, key: m.key, message: `apple: ${message}` });

  const plist = target.plist;
  const shown = plist === undefined ? '' : relative(root, plist).replaceAll('\\', '/');
  if (plist !== undefined && !existsSync(plist)) throw new Error(`apple: ${shown} is missing: name the Info.plist the table translates`);
  const strings = plist === undefined ? undefined : plistStrings(readFileSync(plist, 'utf8'));
  const byLower = new Map([...(strings?.keys() ?? [])].map((k) => [k.toLowerCase(), k]));

  // Under `plist`, a key's words spell the plist key, which catalog keys can't hold as written.
  const taken = catalog.messages.flatMap((m) => {
    const rest = restOf(target, m.key);
    if (rest === undefined) return [];
    if (strings === undefined) return [{ m, name: rest }];
    const name = byLower.get(wordsFor(target, m.key)!.join('').toLowerCase());
    if (name === undefined) {
      error(
        m,
        `${m.key} names no string in ${shown}: spell one of its keys, as ns-camera-usage-description is NSCameraUsageDescription, or add it there`,
      );
      return [];
    }
    return [{ m, name }];
  });
  checkNames(
    'apple',
    taken.map(({ m, name }) => [m.key, name]),
    [],
  );

  for (const { m, name } of taken) {
    if (strings === undefined) continue;
    if (m.args.size > 0) {
      error(m, `${name} is shown as it is written, with nothing filled in: say it without {${[...m.args.keys()].join('}, {')}}`);
      continue;
    }
    // The plist's own text shows where no .lproj matches, so it can't be left to say something else.
    const text = staticLiteral(asts.get(source)?.get(m.key) ?? []);
    if (text !== undefined && text !== strings.get(name))
      error(m, `${shown} says ${JSON.stringify(strings.get(name))} for ${name}: make it ${JSON.stringify(text)}, as the catalog says`);
  }

  const lines = new Map<string, string[]>(locales.map((l) => [l, []]));
  const failed = new Set(problems.map((p) => p.key));
  for (const { m, name } of taken) {
    if (failed.has(m.key)) continue;
    const args = [...m.args.keys()];
    const note = noteOf(m);
    const head = note === '' ? '' : `/* ${note.replaceAll('*/', '* /')} */\n`;
    const written = new Map<string, string>();
    for (const locale of locales) {
      const found = foundIn(m.key, locale, locales, asts);
      if (found === undefined) continue;
      let entry = written.get(found);
      if (entry === undefined) {
        try {
          entry = `${head}"${escape(name, false)}" = "${formatString(asts.get(found)!.get(m.key)!, args, PRINTF)}";\n`;
        } catch (e) {
          error(m, (e as Error).message, fileOf(m, found, source));
          break;
        }
        written.set(found, entry);
      }
      lines.get(locale)!.push(entry);
    }
  }

  const top = `/* ${banner.replace(/^\/\/ /, '')} */\n`;
  const files = new Map(
    locales.map((locale) => [join(target.out, `${locale}.lproj`, `${target.name}.strings`), [top, ...lines.get(locale)!].join('\n')]),
  );
  return { files, problems };
}
