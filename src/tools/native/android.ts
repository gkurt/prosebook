/**
 * The catalog as Android string resources: `values/<name>.xml` for the source and
 * `values-<qualifier>/<name>.xml` for every other locale, each holding what that locale shows, every
 * fallback resolved. An app with the Kotlin target still needs these: its manifest, shortcuts and
 * other XML resources name strings as `@string/…`, which only a resource answers.
 *
 * Android fills values in with `String.format` and picks a plural's arm itself, from its own CLDR
 * rules, so this takes a narrower subset than the other targets, written straight from the ICU tree:
 * text, plain `{name}` placeholders, and one cardinal plural, with the text around it in each arm.
 */
import { join } from 'node:path';

import { isDateElement, isNumberElement, isTimeElement } from '@formatjs/icu-messageformat-parser';

import type { Catalog, Message, Problem } from '#src/tools/catalog.ts';
import type { Entry } from '#src/tools/compile.ts';
import type { NativeTarget } from '#src/tools/config.ts';
import { numberOptions, placeholderOf, selectionOf, TYPE, type MessageFormatElement } from '#src/tools/icu.ts';
import { checkNames, docText, leading, snake } from './emit.ts';
import { fileOf, foundIn, LEAVE_OUT, wordsFor } from './model.ts';

const KEYWORDS = new Set(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends false final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while'.split(
    ' ',
  ),
);

/**
 * A locale as Android's resource qualifier: `de`, `pt-rBR`, and BCP 47's own form, `b+sr+Latn`,
 * past what the old form holds (a script, a numeric region, a variant).
 */
export function qualifierOf(locale: string): string {
  const [language = '', ...rest] = locale.split(/[-_]/);
  const subtags = [
    language.toLowerCase(),
    ...rest.map((s) =>
      s.length === 4 && /^[a-z]+$/i.test(s)
        ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
        : s.length === 2
          ? s.toUpperCase()
          : s.toLowerCase(),
    ),
  ];
  const old = /^[a-z]{2,3}$/.test(subtags[0]!) && (rest.length === 0 || (rest.length === 1 && /^[A-Z]{2}$/.test(subtags[1]!)));
  if (!old) return `b+${subtags.join('+')}`;
  return rest.length === 0 ? subtags[0]! : `${subtags[0]}-r${subtags[1]}`;
}

/** Whitespace as aapt2 reads it: collapsed to one space, and trimmed at the ends, outside double quotes. */
const LOOSE = /^[ \t\n\v\f\r]|[ \t\n\v\f\r]$|[ \t\n\v\f\r]{2}/;

/**
 * Text as a resource holds it: XML's escapes, then Android's (`\`, `'`, `"`, a newline or a tab).
 * In a string that is formatted, `%` is doubled, so `String.format` writes one.
 */
function escape(text: string, formatted: boolean): string {
  const out = text
    .replaceAll('\\', '\\\\')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t');
  return formatted ? out.replaceAll('%', '%%') : out;
}

/**
 * A whole value: a leading `@` or `?` escaped, since either would make it a reference, and the value
 * quoted where its spaces would otherwise be collapsed or trimmed.
 */
function value(written: string): string {
  const out = /^[@?]/.test(written) ? `\\${written}` : written;
  return LOOSE.test(out) ? `"${out}"` : out;
}

/** What a plural's arms may hold as its count: `#`, or the count as a plain `:number` or `:integer`. */
function isCount(el: MessageFormatElement, count: string): boolean {
  if (el.type === TYPE.pound) return true;
  if (!isNumberElement(el) || el.value !== count) return false;
  const options = Object.entries(numberOptions(el) ?? {});
  return options.length === 0 || (options.length === 1 && options[0]![0] === 'maximumFractionDigits' && options[0]![1] === 0);
}

/**
 * Text and plain placeholders, as `%N$s` with N the argument's place in the message's arguments, so a
 * translation can put them in another order. Inside a plural, its count is `%N$d`.
 */
function text(elements: MessageFormatElement[], args: string[], count?: string): string {
  const formatted = args.length > 0;
  const place = (el: MessageFormatElement, name: string, conversion: 's' | 'd') => {
    const at = args.indexOf(name);
    if (at < 0) throw new Error(`{${name}} is not an argument of this message: say it in the source text too`);
    const { isolate } = placeholderOf(el, name);
    const spec = `%${at + 1}$${conversion}`;
    return isolate === undefined ? spec : `${escape(isolate[0], formatted)}${spec}${escape(isolate[1], formatted)}`;
  };
  let out = '';
  for (const el of elements) {
    if (count !== undefined && isCount(el, count)) {
      out += place(el, count, 'd');
      continue;
    }
    if (isDateElement(el) || isTimeElement(el)) {
      throw new Error(
        `{${el.value}} is a date, which Android resources don't format: pass it formatted, as a plain {${el.value}}, ${LEAVE_OUT}`,
      );
    }
    if (isNumberElement(el)) {
      throw new Error(
        `{${el.value}} is a formatted number, and Android fills values in with String.format, not Intl: pass it formatted, as a plain {${el.value}}, ${LEAVE_OUT}`,
      );
    }
    switch (el.type) {
      case TYPE.literal:
        out += escape(el.value, formatted);
        break;
      case TYPE.argument:
        out += place(el, el.value, 's');
        break;
      case TYPE.pound:
        // Outside a plural, `#` is text.
        out += '#';
        break;
      case TYPE.select:
        throw new Error(
          `{${el.value}} is a select, which Android resources can't hold: write a key per case and pick one in code, ${LEAVE_OUT}`,
        );
      case TYPE.plural:
        throw new Error(
          `{${el.value}} is a second plural in the message, and Android's <plurals> picks on one count: split it into a key per count, ${LEAVE_OUT}`,
        );
      case TYPE.tag:
        throw new Error(`<${el.value}> is a tag, and Android resources here hold plain text: say it without the tag, ${LEAVE_OUT}`);
      default:
        throw new Error(`prosebook: no Android writer for ICU element type ${(el as MessageFormatElement).type}`);
    }
  }
  return out;
}

/**
 * A message as `<string>`, or `<plurals>` when it holds a plural. Android's picks between whole
 * messages, so the text around the plural goes into each arm: the pseudo-locale's brackets, or a
 * sentence the plural ends.
 */
function resource(name: string, ast: MessageFormatElement[], args: string[]): string {
  const at = ast.findIndex((el) => el.type === TYPE.plural);
  const plural = ast[at];
  if (plural?.type !== TYPE.plural) {
    const written = text(ast, args);
    // Unformatted, `%` is written as it is, which aapt2 refuses where it reads as two placeholders.
    const raw = args.length === 0 && written.includes('%') ? ' formatted="false"' : '';
    return `    <string name="${name}"${raw}>${value(written)}</string>`;
  }
  const [before, after] = [ast.slice(0, at), ast.slice(at + 1)];
  const named = `{${plural.value}}`;
  if (plural.pluralType === 'ordinal') {
    throw new Error(
      `${named} is an ordinal, and Android's <plurals> are cardinal only: write a key per case and pick one in code, ${LEAVE_OUT}`,
    );
  }
  if (plural.offset !== 0) {
    throw new Error(
      `${named} has an offset, which Android's <plurals> don't: count without it, and say the rest in each arm, ${LEAVE_OUT}`,
    );
  }
  const selection = selectionOf(plural);
  if (selection !== undefined && (selection.fn.name !== 'integer' || Object.keys(selection.fn.options).length > 0)) {
    throw new Error(
      `${named} selects with :${selection.fn.name} and its options, and Android selects on the count as an integer: select with a bare :number or :integer, ${LEAVE_OUT}`,
    );
  }
  const exact = Object.keys(plural.options).filter((k) => k.startsWith('='));
  if (exact.length > 0) {
    throw new Error(
      `${named} has the arm ${exact.join(', ')}, and Android's <plurals> have none for one number (its zero is a category, which most languages never pick): say it in a category's arm, or write a key for it and pick that in code, ${LEAVE_OUT}`,
    );
  }
  const items = Object.entries(plural.options).map(
    ([category, option]) =>
      `        <item quantity="${category}">${value(text([...before, ...option.value, ...after], args, plural.value))}</item>`,
  );
  return `    <plurals name="${name}">\n${items.join('\n')}\n    </plurals>`;
}

/** The context and what each argument holds, as the comment above an entry. */
function comment(m: Message): string {
  const lines = [
    m.context,
    ...[...m.args.keys()].map((a) => (m.argDocs.has(a) ? `${a}: ${m.argDocs.get(a)!.replace(/\.$/, '')}.` : undefined)),
  ];
  const said = lines.filter((l) => l !== undefined && l !== '').join(' ');
  // `--` ends a comment early, so XML refuses it inside one.
  return said === '' ? '' : `    <!-- ${docText(said).replace(/-{2,}/g, '-')} -->\n`;
}

/** The files `target` writes, by path, or a problem for every message it can't hold. */
export function androidResources(
  target: NativeTarget & { name: string },
  catalog: Catalog,
  locales: string[],
  entries: Map<string, Entry[]>,
  banner: string,
): { files: Map<string, string>; problems: Problem[] } {
  const source = locales[0]!;
  const asts = new Map([...entries].map(([locale, list]) => [locale, new Map(list)]));
  const taken = catalog.messages.flatMap((m) => {
    const words = wordsFor(target, m.key);
    return words === undefined ? [] : [{ m, name: leading(snake(words)) }];
  });
  checkNames(
    'android',
    taken.map(({ m, name }) => [m.key, name]),
    [],
  );
  const problems = taken
    .filter((t) => KEYWORDS.has(t.name))
    .map(({ m, name }): Problem => ({
      severity: 'error',
      file: m.file,
      key: m.key,
      message: `android: ${m.key} is named ${name}, which Java keeps for itself: rename it`,
    }));

  const bodies = new Map<string, string[]>(locales.map((l) => [l, []]));
  const failed = new Set<string>();
  for (const { m, name } of taken) {
    const args = [...m.args.keys()];
    const written = new Map<string, string>();
    for (const locale of locales) {
      const found = foundIn(m.key, locale, locales, asts);
      if (failed.has(m.key)) break;
      if (found === undefined) continue;
      let entry = written.get(found);
      if (entry === undefined) {
        try {
          entry = `${comment(m)}${resource(name, asts.get(found)!.get(m.key)!, args)}`;
        } catch (e) {
          failed.add(m.key);
          problems.push({ severity: 'error', file: fileOf(m, found, source), key: m.key, message: `android: ${(e as Error).message}` });
          continue;
        }
        written.set(found, entry);
      }
      bodies.get(locale)!.push(entry);
    }
  }

  const head = `<!-- ${banner.replace(/^\/\/ /, '')} -->`;
  const files = new Map(
    locales.map((locale) => {
      const folder = locale === source ? 'values' : `values-${qualifierOf(locale)}`;
      const body = bodies.get(locale)!.join('\n');
      const xml = `<?xml version="1.0" encoding="utf-8"?>\n${head}\n<resources>\n${body}${body === '' ? '' : '\n'}</resources>\n`;
      return [join(target.out, folder, `${target.name}.xml`), xml];
    }),
  );
  return { files, problems };
}
