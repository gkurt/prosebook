import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCopy, defineCatalog } from 'prosebook';
import type { NativeTarget } from 'prosebook/config';
import { CatalogError, render } from 'prosebook/tools';

import { camel, leading, pascal, snake, upper, wordsOf } from '#src/tools/native/emit.ts';
import { formatNumber, numberSpec, roundingOf, roundDigits, shortestDigits } from '#src/tools/native/number.ts';
import { categoryOf, operandsOf, pluralRules } from '#src/tools/native/plurals.ts';
import { compiled, fixture } from './fixture.ts';

const CATALOG = `
app.title:
  context: Heads the window.
  en: Corner Shop
app.hello:
  context: Greets the person signed in.
  args:
    firstName: the person's first name
  en: Hello, {firstName}!
app.items:
  context: Counts the cart.
  args:
    count: how many items the cart holds
  en: '{count, plural, =0 {Nothing in the cart.} one {# item in the cart.} other {# items in the cart.}}'
app.rank:
  context: Says where a runner finished.
  args:
    place: the place the runner finished in
  en: 'You came {place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}.'
app.who:
  context: Says who has how many cats.
  args:
    who: me, or anyone else
    count: how many cats
  en: '{who, select, me {I have {count, plural, one {# cat} other {# cats}}} other {They have {count, plural, one {# cat} other {# cats}}}}'
app.total:
  context: The sum, on the last line.
  args:
    amount: the sum, in euros
  en: 'Total: {amount, number, ::currency/EUR}'
app.share:
  context: How much of the upload is done.
  args:
    done: the share uploaded, from 0 to 1
  en: '{done, number, percent} uploaded'
app.offset:
  context: Who else liked a post.
  args:
    count: how many people liked it, you among them
  en: '{count, plural, offset:1 =0 {Nobody} =1 {You} one {You and # other} other {You and # others}}'
app.literal:
  context: Shows every character a target escapes.
  en: "It''s '{'braces'}', \\"quotes\\", $dollar, a back\\\\slash and \\u2068isolated\\u2069."
`;

const LOCALES = {
  'copy/locales/de.yaml': `app.title: Eckladen
app.items: '{count, plural, =0 {Nichts im Warenkorb.} one {# Artikel im Warenkorb.} other {# Artikel im Warenkorb.}}'
app.total: 'Summe: {amount, number, ::currency/EUR}'
app.share: '{done, number, percent} hochgeladen'
`,
  'copy/locales/de-AT.yaml': `app.title: Eckgeschäft
`,
  'copy/locales/pl.yaml': `app.items: '{count, plural, one {# produkt} few {# produkty} many {# produktów} other {# produktu}}'
`,
  'copy/locales/ar-EG.yaml': `app.items: '{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}'
app.total: 'المجموع: {amount, number, ::currency/EUR}'
`,
};

const COUNTS = [0, 1, 2, 3, 5, 11, 21, 22, 103, 1.5, 0.25, 1234.5, 1e6, -1];

/** Every call the native code is checked on: the locale, the key, and its arguments. */
const CASES: [string, string, Record<string, string | number>][] = ['en', 'de', 'de-AT', 'pl', 'ar-EG', 'en-XA'].flatMap((locale) => [
  [locale, 'app.title', {}],
  [locale, 'app.literal', {}],
  [locale, 'app.hello', { firstName: 'Ada' }],
  ...COUNTS.flatMap((n): [string, string, Record<string, string | number>][] => [
    [locale, 'app.items', { count: n }],
    [locale, 'app.rank', { place: n }],
    [locale, 'app.who', { who: 'me', count: n }],
    [locale, 'app.who', { who: 'Bo', count: n }],
    [locale, 'app.total', { amount: n }],
    [locale, 'app.share', { done: n / 100 }],
    [locale, 'app.offset', { count: n }],
  ]),
]);

function project(native: NativeTarget[]) {
  return fixture({ 'copy/catalog/app.yaml': CATALOG, ...LOCALES }, { pseudo: 'en-XA', native });
}

/** What the TypeScript runtime says for every case: what the native code must say too. */
async function expected(config: ReturnType<typeof project>): Promise<string[]> {
  const { entries } = render(config);
  const messages = Object.fromEntries([...entries].map(([locale, list]) => [locale, compiled(list)]));
  const copies = new Map(
    [...entries.keys()].map((locale) => [
      locale,
      createCopy(defineCatalog({ source: 'en', locales: [...entries.keys()], messages, loaders: {} }), { locale }),
    ]),
  );
  await Promise.all([...copies.values()].map((c) => c.ready));
  return CASES.map(([locale, key, args]) => copies.get(locale)!.t(key, args));
}

function run(cmd: string, args: string[], cwd: string): string {
  // kotlinc is a .bat on Windows, which only a shell runs.
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 26,
    shell: process.platform === 'win32',
  });
}

/** A program's output, a line per case; Windows ends lines with CRLF. */
const linesOf = (output: string) => output.split(/\r?\n/).slice(0, -1);

/** The argument values in a target's syntax, in the message's order, which each case keeps. */
function callArgs(args: Record<string, string | number>, literal: (v: string | number) => string, label?: (name: string) => string) {
  return Object.entries(args).map(([name, value]) => (label ? `${label(name)}: ` : '') + literal(value));
}

const EXE = process.platform === 'win32' ? 'main.exe' : 'main';
const str = (v: string | number) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const dbl = (v: string | number) => (typeof v === 'string' ? JSON.stringify(v) : Number.isInteger(v) ? `${v}.0` : String(v));

describe('native targets', () => {
  test('number formats match Intl, or say why they cannot', () => {
    const styles: Intl.NumberFormatOptions[] = [
      {},
      { style: 'percent' },
      { style: 'currency', currency: 'JPY' },
      { signDisplay: 'exceptZero' },
      { minimumIntegerDigits: 3 },
    ];
    for (const locale of ['en', 'de', 'fr', 'ar-EG', 'hi', 'en-IN', 'fa', 'de-CH', 'es', 'pl']) {
      for (const options of styles) {
        const spec = numberSpec(locale, options);
        for (const n of [0, -0, 7, -1234567.891, 0.005, 2.5, 1e21])
          expect(formatNumber(spec, n)).toBe(new Intl.NumberFormat(locale, options).format(n));
      }
    }
    expect(() => numberSpec('en', { notation: 'compact' })).toThrow('compact notation reads the size of the number at runtime');
    expect(() => numberSpec('en', { style: 'unit', unit: 'kilometer', unitDisplay: 'long' })).toThrow(
      'which native code would write as "2 kilometer"',
    );
  });

  test('digits round as Intl rounds: the shortest decimal, half away from zero', () => {
    const at = (n: number, max: number) => roundDigits(shortestDigits(n).int, shortestDigits(n).frac, 0, 0, max);
    expect(at(1.005, 2)).toEqual({ int: '1', frac: '01' });
    expect(at(2.5, 0)).toEqual({ int: '3', frac: '' });
    expect(at(9.999, 2)).toEqual({ int: '10', frac: '' });
    expect(at(1e-7, 3)).toEqual({ int: '', frac: '' });
    expect(shortestDigits(1e21)).toEqual({ int: '1000000000000000000000', frac: '' });
  });

  test('plural rules agree with Intl.PluralRules', () => {
    for (const locale of ['en', 'fr', 'pl', 'ru', 'ar', 'cy', 'ga', 'sl', 'lt', 'he', 'pt-PT', 'ja', 'it', 'es']) {
      for (const type of ['cardinal', 'ordinal'] as const) {
        const rules = pluralRules(locale, type);
        const { minFrac, maxFrac } = roundingOf(locale, { type });
        const intl = new Intl.PluralRules(locale, { type });
        for (const n of [...Array.from({ length: 300 }, (_, i) => i), 0.5, 1.5, 2.25, 10.1, 1e6, 1000000.5]) {
          const { int, frac } = roundDigits(shortestDigits(n).int, shortestDigits(n).frac, 0, minFrac, maxFrac);
          expect([locale, type, n, categoryOf(rules, operandsOf(int || '0', frac))]).toEqual([locale, type, n, intl.select(n)]);
        }
      }
    }
  });

  test('a target takes the keys under its prefixes, named without them', () => {
    const config = fixture(
      {
        'copy/catalog/native.yaml': 'native.tray.quit-app:\n  context: Quits from the tray.\n  en: Quit\n',
        'copy/catalog/web.yaml': 'web.title:\n  context: A page title.\n  en: Shop\n',
      },
      { native: [{ language: 'rust', out: 'text.rs', keys: ['native'] }] },
    );
    const rust = render(config).files.get(join(config.root, 'text.rs'))!;
    expect(rust).toContain("pub fn tray_quit_app(self) -> &'static str {");
    expect(rust).toContain('Locale::En => "Quit",');
    expect(rust).not.toContain('web');
  });

  test("a message a target can't render fails the build with the fix", () => {
    const config = fixture(
      {
        'copy/catalog/app.yaml': [
          'app.when:\n  context: When it was printed.\n  args:\n    when: the time printed\n  en: Printed {when, date, long}.',
          'app.link:\n  context: Points to help.\n  en: Read <a>the guide</a>.',
          'app.big:\n  context: A count.\n  args:\n    count: a count\n  en: "{count, number, ::compact-short}"',
        ].join('\n'),
      },
      { native: [{ language: 'swift', out: 'Copy.swift' }] },
    );
    let error: unknown;
    try {
      render(config);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CatalogError);
    expect((error as CatalogError).problems.map((p) => `${p.key}: ${p.message}`)).toEqual([
      "app.big: swift: native code can't format this number in en: compact notation reads the size of the number at runtime. Format it another way, or leave the key out of this target's `keys`",
      "app.link: swift: <a> is a tag, and native code writes plain text: say it without the tag, or leave the key out of this target's `keys`",
      "app.when: swift: {when} is a date, which native code doesn't format: pass it formatted, as a plain {when}, or leave the key out of this target's `keys`",
    ]);
  });

  test('names that meet fail the build', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.a-b:\n  context: One.\n  en: One\napp.a.b:\n  context: Two.\n  en: Two\n' },
      { native: [{ language: 'kotlin', out: 'Copy.kt' }] },
    );
    expect(() => render(config)).toThrow('kotlin: app.a.b is named appAB, as app.a-b is: rename one');
  });

  test.skipIf(Bun.which('rustc') === null)(
    'Rust says what the runtime says',
    async () => {
      const config = project([{ language: 'rust', out: 'native/copy.rs' }]);
      const dir = join(config.root, 'native');
      mkdirSync(dir, { recursive: true });
      const lines = CASES.map(([locale, key, args]) => {
        const call = `${pascal(wordsOf(locale))}.${leading(snake(wordsOf(key)))}(${callArgs(args, str).join(', ')})`;
        return `    println!("{}", copy::Locale::${call});`;
      });
      writeFileSync(join(dir, 'main.rs'), `mod copy;\n\nfn main() {\n${lines.join('\n')}\n}\n`);
      for (const [path, content] of render(config).files) if (path.endsWith('.rs')) writeFileSync(path, content);
      run('rustc', ['--edition', '2021', '-D', 'warnings', 'main.rs', '-o', EXE], dir);
      expect(linesOf(run(join(dir, EXE), [], dir))).toEqual(await expected(config));
    },
    120_000,
  );

  test.skipIf(Bun.which('swiftc') === null)(
    'Swift says what the runtime says',
    async () => {
      const config = project([{ language: 'swift', out: 'native/Copy.swift' }]);
      const dir = join(config.root, 'native');
      mkdirSync(dir, { recursive: true });
      const lines = CASES.map(([locale, key, args]) => {
        const member = leading(camel(wordsOf(key)));
        const call = Object.keys(args).length === 0 ? member : `${member}(${callArgs(args, dbl, (n) => camel(wordsOf(n))).join(', ')})`;
        return `print(Copy.${leading(camel(wordsOf(locale)))}.${call})`;
      });
      writeFileSync(join(dir, 'main.swift'), `${lines.join('\n')}\n`);
      for (const [path, content] of render(config).files) if (path.endsWith('.swift')) writeFileSync(path, content);
      run('swiftc', ['-warnings-as-errors', 'Copy.swift', 'main.swift', '-o', EXE], dir);
      expect(linesOf(run(join(dir, EXE), [], dir))).toEqual(await expected(config));
    },
    300_000,
  );

  test.skipIf(Bun.which('kotlinc') === null)(
    'Kotlin says what the runtime says',
    async () => {
      const config = project([{ language: 'kotlin', out: 'native/Copy.kt', package: 'shop.copy' }]);
      const dir = join(config.root, 'native');
      mkdirSync(dir, { recursive: true });
      const lines = CASES.map(([locale, key, args]) => {
        const member = leading(camel(wordsOf(key)));
        const call = Object.keys(args).length === 0 ? member : `${member}(${callArgs(args, str).join(', ')})`;
        return `    println(Copy.${upper(wordsOf(locale))}.${call})`;
      });
      writeFileSync(join(dir, 'Main.kt'), `import shop.copy.Copy\n\nfun main() {\n${lines.join('\n')}\n}\n`);
      for (const [path, content] of render(config).files) if (path.endsWith('.kt')) writeFileSync(path, content);
      run('kotlinc', ['-Werror', 'Copy.kt', 'Main.kt', '-include-runtime', '-d', 'main.jar'], dir);
      // Java writes the console's encoding unless told otherwise, which on Windows isn't UTF-8.
      expect(linesOf(run('java', ['-Dstdout.encoding=UTF-8', '-jar', 'main.jar'], dir))).toEqual(await expected(config));
    },
    600_000,
  );
});
