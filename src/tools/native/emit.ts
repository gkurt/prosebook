/**
 * What every native writer shares: words to identifiers, numbers and strings to literals, and the
 * names a file can't give two things.
 */
import type { Condition, Operand } from './plurals.ts';

/** Words from an identifier written any way: `userName`, `user-name` and `user_name` are user, name. */
export function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export const snake = (words: string[]) => words.join('_');
export const pascal = (words: string[]) => words.map(capital).join('');
export const camel = (words: string[]) => words.map((w, i) => (i === 0 ? w : capital(w))).join('');
export const upper = (words: string[]) => words.join('_').toUpperCase();

/** An identifier can't start with a digit, so `404.title` is `_404Title`. */
export function leading(name: string): string {
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

/** A double literal every target reads as one: `0.0`, `1.5`, `1e21`. */
export function float(value: number): string {
  const s = String(value).replace('e+', 'e');
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Characters that print nothing, or look like a space, written as escapes so the code shows them. */
const INVISIBLE = /[\u{a0}\u{61c}\u{180e}\u{2000}-\u{200f}\u{2028}-\u{202f}\u{205f}-\u{206f}\u{feff}]/gu;

/** Text for a doc comment, with what prints nothing written as `\u{…}`: Rust refuses direction marks there. */
export function docText(line: string): string {
  return line.replace(INVISIBLE, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`);
}

/** A string literal: JSON's escapes, `\u{…}` where the target writes them so (Rust, Swift), and `$` escaped in Kotlin. */
export function stringLiteral(value: string, language: 'rust' | 'swift' | 'kotlin'): string {
  const json = JSON.stringify(value).replace(INVISIBLE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (language === 'kotlin') return json.replaceAll('$', '\\$');
  return json.replace(/\\u([0-9a-f]{4})/g, (_, hex: string) => `\\u{${hex.replace(/^0+/, '')}}`);
}

/**
 * A plural condition as an expression over operands `o`: `field(op)` reads one, `mod` takes a
 * remainder, `within` tests a range as CLDR does (integers only). `&&`, `||` and `!` are every
 * target's.
 */
export function conditionCode(
  condition: Condition,
  code: {
    field: (op: Operand) => string;
    mod: (value: string, by: string) => string;
    within: (value: string, from: string, to: string) => string;
  },
): string {
  const ors = condition.map((and) =>
    and
      .map((r) => {
        const value = r.mod === undefined ? code.field(r.operand) : code.mod(code.field(r.operand), float(r.mod));
        if (r.ranges.length === 1 && r.ranges[0]![0] === r.ranges[0]![1])
          return `${value} ${r.negated ? '!=' : '=='} ${float(r.ranges[0]![0])}`;
        const any = r.ranges
          .map(([from, to]) => (from === to ? `${value} == ${float(from)}` : code.within(value, float(from), float(to))))
          .join(' || ');
        return r.negated ? `!(${any})` : r.ranges.length > 1 ? `(${any})` : any;
      })
      .join(' && '),
  );
  return ors.length > 1 ? ors.map((o) => (o.includes(' && ') ? `(${o})` : o)).join(' || ') : ors[0]!;
}

/** Fails with the keys whose names meet, or meet a name the file already has. */
export function checkNames(language: string, named: [key: string, name: string][], taken: string[]): void {
  const seen = new Map<string, string>(taken.map((t) => [t, 'a name the file already has']));
  for (const [key, name] of named) {
    const other = seen.get(name);
    if (other !== undefined)
      throw new Error(`${language}: ${key} is named ${name}, as ${other} is: rename one, or change the target's keys`);
    seen.set(name, key);
  }
}
