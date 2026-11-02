import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { createCopy, defineCatalog } from 'prosebook';
import type { NativeTarget } from 'prosebook/config';
import { CatalogError, generate, render } from 'prosebook/tools';

import { qualifierOf } from '#src/tools/native/android.ts';
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
        const call = Object.keys(args).length === 0 ? member : `${member}(${callArgs(args, str, (n) => camel(wordsOf(n))).join(', ')})`;
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

const ANDROID = `
android.title:
  context: Heads the window -- the shop's name.
  en: Corner Shop
android.hello:
  context: Greets the person signed in.
  args:
    firstName: the person's first name.
    count: how many messages wait
  en: Hello, {firstName}! {count} new.
android.items:
  context: Counts the cart.
  args:
    count: how many items the cart holds
  en: '{count, plural, one {# item in the cart.} other {# items in the cart.}}'
android.literal:
  context: Shows every character Android escapes.
  args:
    name: a name
  en: |-
    It''s "{name}" & '<b>', a back\\slash, 100%
    and\ta tab.
android.handle:
  context: Starts with what would make it a reference, and keeps its spaces.
  en: '@corner  shop '
android.sale:
  context: Has a percent sign and nothing to format.
  en: 50% off, 20% more
`;

const ANDROID_LOCALES = {
  'copy/locales/de.yaml': `android.title: Eckladen
android.hello: '{count} neu für {firstName}.'
android.items: '{count, plural, one {# Artikel im Warenkorb.} other {# Artikel im Warenkorb.}}'
`,
  'copy/locales/de-AT.yaml': 'android.sale: 50 % Rabatt\n',
  'copy/locales/pt-BR.yaml': 'android.title: Loja da esquina\n',
  'copy/locales/sr-Latn.yaml': 'android.title: Prodavnica\n',
};

function androidProject() {
  return fixture(
    { 'copy/catalog/android.yaml': ANDROID, ...ANDROID_LOCALES },
    { pseudo: 'en-XA', native: [{ language: 'android', out: 'res', keys: ['android'] }] },
  );
}

/** The SDK's aapt2 and newest android.jar, from the PATH or `ANDROID_HOME`. */
function androidSdk(): { aapt2: string; jar: string } | undefined {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk === undefined) return undefined;
  const newest = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort((a, b) => b.localeCompare(a, 'en', { numeric: true })) : []);
  const exe = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const aapt2 =
    Bun.which('aapt2') ??
    newest(join(sdk, 'build-tools'))
      .map((v) => join(sdk, 'build-tools', v, exe))
      .find((p) => existsSync(p));
  const jar = newest(join(sdk, 'platforms'))
    .map((p) => join(sdk, 'platforms', p, 'android.jar'))
    .find((p) => existsSync(p));
  return aapt2 === undefined || jar === undefined ? undefined : { aapt2, jar };
}

describe('Android resources', () => {
  test('a folder per locale, with Android qualifiers', () => {
    expect(['en', 'de', 'pt-BR', 'sr-Latn', 'sr-Latn-RS', 'es-419', 'fil', 'zh-hant-tw'].map(qualifierOf)).toEqual([
      'en',
      'de',
      'pt-rBR',
      'b+sr+Latn',
      'b+sr+Latn+RS',
      'b+es+419',
      'fil',
      'b+zh+Hant+TW',
    ]);
    const config = androidProject();
    const res = join(config.root, 'res');
    const files = [...render(config).files.keys()].filter((p) => p.startsWith(res)).map((p) => relative(res, p).replaceAll('\\', '/'));
    expect(files).toEqual([
      'values/strings.xml',
      'values-de-rAT/strings.xml',
      'values-de/strings.xml',
      'values-pt-rBR/strings.xml',
      'values-b+sr+Latn/strings.xml',
      'values-en-rXA/strings.xml',
    ]);
  });

  test('escapes, positional arguments and plurals', () => {
    const config = androidProject();
    const files = render(config).files;
    const at = (folder: string) => files.get(join(config.root, 'res', folder, 'strings.xml'))!;
    expect(at('values')).toBe(`<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by prosebook from copy/catalog. Do not edit: change the catalog and run \`prosebook generate\`. -->
<resources>
    <!-- Starts with what would make it a reference, and keeps its spaces. -->
    <string name="handle">"\\@corner  shop "</string>
    <!-- Greets the person signed in. firstName: the person's first name. count: how many messages wait. -->
    <string name="hello">Hello, %1$s! %2$s new.</string>
    <!-- Counts the cart. count: how many items the cart holds. -->
    <plurals name="items">
        <item quantity="one">%1$d item in the cart.</item>
        <item quantity="other">%1$d items in the cart.</item>
    </plurals>
    <!-- Shows every character Android escapes. name: a name. -->
    <string name="literal">It\\'s \\"%1$s\\" &amp; &lt;b&gt;, a back\\\\slash, 100%%\\nand\\ta tab.</string>
    <!-- Has a percent sign and nothing to format. -->
    <string name="sale" formatted="false">50% off, 20% more</string>
    <!-- Heads the window - the shop's name. -->
    <string name="title">Corner Shop</string>
</resources>
`);
    // A translation puts the arguments where its language wants them.
    expect(at('values-de')).toContain('<string name="hello">%2$s neu für %1$s.</string>');
    expect(at('values-de')).toContain('<item quantity="one">%1$d Artikel im Warenkorb.</item>');
    // de-AT falls back to de, then to the source, resolved in the file.
    expect(at('values-de-rAT')).toContain('<string name="title">Eckladen</string>');
    expect(at('values-de-rAT')).toContain('<string name="sale" formatted="false">50 % Rabatt</string>');
    expect(at('values-pt-rBR')).toContain('<string name="hello">Hello, %1$s! %2$s new.</string>');
    // The text around a plural goes into each arm: here, the pseudo-locale's brackets.
    expect(at('values-en-rXA')).toContain('<item quantity="one">⟦%1$d ííţééɱ ííñ ţĥéé çááŕţ.⟧</item>');
  });

  test("what Android can't hold fails the build with the fix", () => {
    const config = fixture(
      {
        'copy/catalog/android.yaml': [
          'android.when:\n  context: When.\n  args:\n    when: the time\n  en: Printed {when, date, long}.',
          'android.total:\n  context: A sum.\n  args:\n    amount: the sum\n  en: "Total: {amount, number, ::currency/EUR}"',
          'android.who:\n  context: Who.\n  args:\n    who: me or not\n  en: "{who, select, me {Me} other {Them}}"',
          'android.rank:\n  context: A place.\n  args:\n    place: the place\n  en: "{place, selectordinal, one {#st} other {#th}}"',
          'android.likes:\n  context: Likes.\n  args:\n    count: how many\n  en: "{count, plural, offset:1 one {You and # other} other {You and # others}}"',
          'android.empty:\n  context: The cart.\n  args:\n    count: how many\n  en: "{count, plural, =0 {Nothing} one {# item} other {# items}}"',
          'android.both:\n  context: Two counts.\n  args:\n    files: how many files\n    dirs: how many folders\n  en: "{files, plural, one {# file} other {# files}} in {dirs, plural, one {# folder} other {# folders}}"',
          'android.link:\n  context: Points to help.\n  en: Read <a>the guide</a>.',
          'android.new:\n  context: A badge.\n  en: New',
        ].join('\n'),
      },
      { native: [{ language: 'android', out: 'res', keys: ['android'] }] },
    );
    let error: unknown;
    try {
      render(config);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CatalogError);
    const leave = "or leave the key out of this target's `keys`";
    expect((error as CatalogError).problems.map((p) => `${p.key}: ${p.message}`)).toEqual([
      'android.new: android: android.new is named new, which Java keeps for itself: rename it',
      `android.both: android: {dirs} is a second plural in the message, and Android's <plurals> picks on one count: split it into a key per count, ${leave}`,
      `android.empty: android: {count} has the arm =0, and Android's <plurals> have none for one number (its zero is a category, which most languages never pick): say it in a category's arm, or write a key for it and pick that in code, ${leave}`,
      `android.likes: android: {count} has an offset, which Android's <plurals> don't: count without it, and say the rest in each arm, ${leave}`,
      `android.link: android: <a> is a tag, and Android resources here hold plain text: say it without the tag, ${leave}`,
      `android.rank: android: {place} is an ordinal, and Android's <plurals> are cardinal only: write a key per case and pick one in code, ${leave}`,
      `android.total: android: {amount} is a formatted number, and Android fills values in with String.format, not Intl: pass it formatted, as a plain {amount}, ${leave}`,
      `android.when: android: {when} is a date, which Android resources don't format: pass it formatted, as a plain {when}, ${leave}`,
      `android.who: android: {who} is a select, which Android resources can't hold: write a key per case and pick one in code, ${leave}`,
    ]);
  });

  test('a plural that selects as formatted fails, and :integer selects as Android does', () => {
    const files = '.input {$count :integer}\n    .match $count\n    one {{{$count} file}}\n    * {{{$count} files}}';
    const done = '.input {$share :percent}\n    .match $share\n    one {{{$share} done}}\n    * {{{$share} done}}';
    const project = (messages: string[]) =>
      fixture(
        { 'copy/catalog/android.yaml': messages.map((m, i) => `android.m${i}:\n  en: |-\n    ${m}`).join('\n') },
        { messageFormat: 2, require: [], native: [{ language: 'android', out: 'res' }] },
      );
    expect(() => render(project([done]))).toThrow(
      'android.m0: android: {share} selects with :percent and its options, and Android selects on the count as an integer: select with a bare :number or :integer',
    );
    const config = project([files]);
    expect(render(config).files.get(join(config.root, 'res', 'values', 'strings.xml'))).toContain('<item quantity="one">%1$d file</item>');
  });

  test('generate --check finds a resource file out of date', () => {
    const config = androidProject();
    generate(config);
    expect(generate(config, { check: true }).changed).toEqual([]);
    const de = join(config.root, 'res', 'values-de', 'strings.xml');
    writeFileSync(de, readFileSync(de, 'utf8').replace('Eckladen', 'Laden'));
    expect(generate(config, { check: true }).changed).toEqual([de]);
  });

  test('names that meet fail the build', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.a-b:\n  context: One.\n  en: One\napp.a.b:\n  context: Two.\n  en: Two\n' },
      { native: [{ language: 'android', out: 'res' }] },
    );
    expect(() => render(config)).toThrow('android: app.a.b is named app_a_b, as app.a-b is: rename one');
  });

  const sdk = androidSdk();
  test.skipIf(sdk === undefined)(
    'Android reads what the runtime says',
    async () => {
      const { aapt2, jar } = sdk!;
      const config = androidProject();
      const dir = join(config.root, 'android');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'AndroidManifest.xml'),
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="shop.copy"/>\n',
      );
      const { files, entries } = render(config);
      for (const [path, content] of files) {
        if (!path.endsWith('.xml')) continue;
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      run(aapt2, ['compile', '--dir', join(config.root, 'res'), '-o', 'res.zip'], dir);
      run(aapt2, ['link', '-I', jar, '--manifest', 'AndroidManifest.xml', '-o', 'out.apk', 'res.zip'], dir);

      // The values as aapt2 read them, by name and qualifier: a string, or a plural's arms. A value
      // runs on to the line that ends its quote; aapt2 indents each line a newline in it starts.
      const read = new Map<string, string | Record<string, string>>();
      let name = '';
      let plural: Record<string, string> = {};
      let value: { set: (text: string) => void; text: string } | undefined;
      for (const line of linesOf(run(aapt2, ['dump', 'resources', 'out.apk'], dir))) {
        if (value !== undefined) {
          value.text += `\n${line.trimStart()}`;
        } else {
          const resource = /^\s+resource \S+ \w+\/(\w+)$/.exec(line);
          const plurals = /^\s+\(([^)]*)\) \(plurals\)/.exec(line);
          const string = /^\s+\(([^)]*)\) "(.*)$/.exec(line);
          const item = /^\s+(\w+)="(.*)$/.exec(line);
          if (resource) name = resource[1]!;
          else if (plurals) read.set(`${name} ${plurals[1]}`, (plural = {}));
          const at = `${name} ${string?.[1]}`;
          if (string) value = { set: (text) => read.set(at, text), text: string[2]! };
          else if (item) value = { set: (text) => (plural[item[1]!] = text), text: item[2]! };
          else continue;
        }
        if (!value.text.endsWith('"')) continue;
        value.set(value.text.slice(0, -1));
        value = undefined;
      }

      const messages = Object.fromEntries([...entries].map(([locale, list]) => [locale, compiled(list)]));
      const locales = [...entries.keys()];
      const catalog = defineCatalog({ source: 'en', locales, messages, loaders: {} });
      const cases: [string, Record<string, string | number>][] = [
        ['title', {}],
        ['handle', {}],
        ['sale', {}],
        ['literal', { name: 'Ada' }],
        ['hello', { firstName: 'Ada', count: 3 }],
        ...[0, 1, 2, 5, 21].map((count): [string, Record<string, string | number>] => ['items', { count }]),
      ];
      for (const locale of locales) {
        const copy = createCopy(catalog, { locale });
        await copy.ready;
        const qualifier = locale === 'en' ? '' : qualifierOf(locale);
        for (const [key, args] of cases) {
          // Android picks a plural's arm by the device's rules, so the source's arms in a language
          // that doesn't translate them can pick another: in Portuguese, 0 is `one`.
          if (key === 'items' && (locale === 'pt-BR' || locale === 'sr-Latn')) continue;
          const found = read.get(`${key} ${qualifier}`)!;
          // Android picks the arm by its own CLDR rules, then fills it in as `String.format` does.
          const arm =
            typeof found === 'string' ? found : (found[new Intl.PluralRules(locale).select(args.count as number)] ?? found.other!);
          const values = Object.values(args);
          const said =
            values.length === 0
              ? arm
              : arm.replace(/%(?:(\d+)\$[sd]|%)/g, (_, n: string | undefined) => (n === undefined ? '%' : String(values[Number(n) - 1])));
          expect([locale, key, said]).toEqual([locale, key, copy.t(`android.${key}`, args)]);
        }
      }
    },
    120_000,
  );
});
