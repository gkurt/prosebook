import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { exportOf, generate, importTranslations, render } from 'prosebook/tools';

import { cli, fixture } from './fixture.ts';

const CATALOG = `cart.title:
  kind: name
  surface: heading
  context: Heads the cart page.
  en: Your cart

cart.items:
  kind: state
  surface: status
  context: Counts what is in the cart.
  args:
    count: how many items
  en: '{count, plural, one {# item} other {# items}}'

cart.add:
  kind: action
  surface: action
  context: The button on a product.
  en: Add one to cart

cart.terms:
  context: Under the checkout button.
  en: By checking out you agree to our <link>terms & conditions</link>.
`;

// German translates cart.add, made from an earlier source, so stale, and cart.terms, current.
const project = () => {
  const config = fixture({
    'copy/catalog/cart.yaml': CATALOG.replace('Add one to cart', 'Add to cart'),
    'copy/locales/de/cart.yaml': 'cart.add: In den Warenkorb\ncart.terms: Mit der Bestellung stimmst du unseren <link>AGB</link> zu.\n',
  });
  generate(config);
  writeFileSync(join(config.root, 'copy/catalog/cart.yaml'), CATALOG);
  return config;
};

const exported = (config: ReturnType<typeof project>, locale: string, format: 'xliff' | 'json', all = false) => {
  const { catalog, stale } = render(config);
  return exportOf(config, catalog, stale.get(locale) ?? new Map(), locale, format, all);
};

const read = (config: { root: string }, file: string) => readFileSync(join(config.root, file), 'utf8');

/** A tool's XLIFF for German, its units given as they come back. */
const xliff = (units: string, attrs = 'srcLang="en" trgLang="de"') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" ${attrs}>\n<file id="cart">\n${units}\n</file>\n</xliff>\n`;

describe('prosebook export', () => {
  test("as XLIFF, holds what todo lists, each with its context, placeholders and what's stale", () => {
    const config = project();
    const { count, text } = exported(config, 'de', 'xliff');
    expect(count).toBe(3);
    expect(text).toStartWith(
      '<?xml version="1.0" encoding="UTF-8"?>\n<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="de">\n  <file id="cart" original="copy/catalog/cart.yaml" xml:space="preserve">',
    );
    expect(text).toContain(
      [
        '    <unit id="cart.items">',
        '      <notes>',
        '        <note category="context">Counts what is in the cart.</note>',
        '        <note category="kind">state</note>',
        '        <note category="surface">status</note>',
        '        <note category="placeholder">{count}: how many items</note>',
        '      </notes>',
        '      <segment state="initial">',
        '        <source>{count, plural, one {# item} other {# items}}</source>',
        '      </segment>',
        '    </unit>',
      ].join('\n'),
    );
    expect(text).toContain(
      [
        '        <note category="stale">the source changed: Add {+one +}to cart</note>',
        '      </notes>',
        '      <segment state="initial">',
        '        <source>Add one to cart</source>',
        '        <target>In den Warenkorb</target>',
      ].join('\n'),
    );
    expect(text).not.toContain('cart.terms');
  });

  test('with all, every entry, a current translation as translated, and markup escaped', () => {
    const config = project();
    const { count, text } = exported(config, 'de', 'xliff', true);
    expect(count).toBe(4);
    expect(text).toContain(
      [
        '      <segment state="translated">',
        '        <source>By checking out you agree to our &lt;link&gt;terms &amp; conditions&lt;/link&gt;.</source>',
        '        <target>Mit der Bestellung stimmst du unseren &lt;link&gt;AGB&lt;/link&gt; zu.</target>',
      ].join('\n'),
    );
  });

  test('the source exports every entry, with no target language and no targets', () => {
    const config = project();
    const { count, text } = exported(config, 'en', 'xliff');
    expect(count).toBe(4);
    expect(text).toContain('srcLang="en">');
    expect(text).not.toContain('trgLang');
    expect(text).not.toContain('<target>');
    expect(text).not.toContain('state=');
  });

  test("as JSON, each key's text in the locale, empty where it has none", () => {
    const config = project();
    expect(exported(config, 'de', 'json').text).toBe('{\n  "cart.add": "In den Warenkorb",\n  "cart.items": "",\n  "cart.title": ""\n}\n');
    expect(Object.keys(JSON.parse(exported(config, 'en', 'json').text))).toEqual(['cart.add', 'cart.items', 'cart.terms', 'cart.title']);
  });

  test('a complete locale exports nothing', () => {
    const config = fixture({ 'copy/catalog/app.yaml': 'app.title: Shop\n', 'copy/locales/de.yaml': 'app.title: Laden\n' }, { require: [] });
    expect(exported(config, 'de', 'xliff').count).toBe(0);
  });
});

describe('prosebook import from a translation tool', () => {
  test('XLIFF exported, translated and given back lands in each file, the markup unescaped', () => {
    const config = project();
    const back = exported(config, 'de', 'xliff')
      .text.replace('<source>Your cart</source>', '<source>Your cart</source>\n        <target>Dein Warenkorb</target>')
      .replace(
        '<source>{count, plural, one {# item} other {# items}}</source>',
        '<source>{count, plural, one {# item} other {# items}}</source>\n        <target><![CDATA[{count, plural, one {# Artikel} other {# Artikel}}]]></target>',
      )
      .replace('<target>In den Warenkorb</target>', '<target>Einen in den Warenkorb</target>');
    expect(importTranslations(config, 'de', back)).toEqual({
      written: ['cart.add', 'cart.items', 'cart.title'],
      unchanged: [],
      problems: [],
    });
    expect(read(config, 'copy/locales/de/cart.yaml')).toContain('cart.title: Dein Warenkorb\n');
    expect(
      importTranslations(
        config,
        'de',
        xliff(
          '<unit id="cart.terms"><segment state="final"><source>By checking out you agree to our &lt;link>terms &amp; conditions&lt;/link>.</source><target>Mit der Bestellung akzeptierst du die &lt;link>AGB&lt;/link>.</target></segment></unit>',
        ),
      ).written,
    ).toEqual(['cart.terms']);
    expect(read(config, 'copy/locales/de/cart.yaml')).toContain('cart.terms: Mit der Bestellung akzeptierst du die <link>AGB</link>.\n');
  });

  test('a unit split into segments is read whole, what lies between them included', () => {
    const config = project();
    const units = `<unit id="cart.title"><segment state="translated"><source>Your</source><target>Dein</target></segment><ignorable><source> </source></ignorable><segment state="translated"><source>cart</source><target>Warenkorb</target></segment></unit>`;
    expect(importTranslations(config, 'de', xliff(units)).written).toEqual(['cart.title']);
    expect(read(config, 'copy/locales/de/cart.yaml')).toContain('cart.title: Dein Warenkorb\n');
  });

  test('a stale translation given back unchanged is accepted only once someone has looked at it', () => {
    const config = project();
    const unit = (state: string) =>
      xliff(
        `<unit id="cart.add"><segment state="${state}"><source>Add one to cart</source><target>In den Warenkorb</target></segment></unit>`,
      );
    expect(importTranslations(config, 'de', unit('initial'))).toEqual({ written: [], unchanged: [], problems: [] });
    expect(importTranslations(config, 'de', unit('reviewed'))).toEqual({ written: [], unchanged: ['cart.add'], problems: [] });
  });

  test('a unit whose source has changed since, or that holds inline codes or half its segments, is left out', () => {
    const config = project();
    const units = [
      '<unit id="cart.add"><segment state="translated"><source>Add to cart</source><target>In den Korb</target></segment></unit>',
      '<unit id="cart.items"><segment state="translated"><source>{count, plural, one {# item} other {# items}}</source><target><ph id="1"/> Artikel</target></segment></unit>',
      '<unit id="cart.title"><segment><source>Your</source><target>Dein</target></segment><segment><source> cart</source></segment></unit>',
    ].join('\n');
    const { written, problems } = importTranslations(config, 'de', xliff(units));
    expect(written).toEqual([]);
    expect(problems.map((p) => [p.key, p.message])).toEqual([
      ['cart.add', 'the source has changed since it was exported, to "Add one to cart": export it again'],
      ['cart.items', 'the target holds an inline <ph>: have the tool keep placeholders as the text they were exported as'],
      ['cart.title', '1 of its 2 segments are translated: translate the rest'],
    ]);
  });

  test('a file for another locale, in XLIFF 1.2, or broken, is refused whole', () => {
    const config = project();
    const problem = (text: string) => importTranslations(config, 'de', text).problems[0]!.message;
    expect(problem(xliff('', 'srcLang="en" trgLang="fr"'))).toBe('the file translates into fr, not de: import it as fr');
    expect(problem(xliff('', 'srcLang="en"'))).toBe('the file names no trgLang: give it the de translations, or set trgLang="de"');
    expect(problem('<xliff version="1.2"><file source-language="en"/></xliff>')).toBe(
      'the file is XLIFF 1.2: export it from the tool as XLIFF 2.0',
    );
    expect(problem(xliff('<unit id="cart.title">'))).toStartWith("the file isn't XML (</file> at offset");
  });

  test('JSON, flat or nested by key, reads as a reply does', () => {
    const config = project();
    expect(importTranslations(config, 'de', '{ "cart.title": "Dein Warenkorb", "cart.items": "" }').written).toEqual(['cart.title']);
    expect(importTranslations(config, 'de', '{ "cart": { "title": "Warenkorb" } }').written).toEqual(['cart.title']);
    expect(read(config, 'copy/locales/de/cart.yaml')).toContain('cart.title: Warenkorb\n');
  });

  test('the CLI exports to a file by its extension, and imports it back', () => {
    const config = project();
    const run = cli(config.root, 'export', 'de', join(config.root, 'de.xlf'));
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('prosebook: exported 3 entries for de to');
    const file = join(config.root, 'de.xlf');
    writeFileSync(file, read(config, 'de.xlf').replace('<target>In den Warenkorb</target>', '<target>Einen in den Warenkorb</target>'));
    expect(cli(config.root, 'import', 'de', file).stdout).toContain('prosebook: imported 1 translation(s) into de');
    expect(cli(config.root, 'export', 'de', '--format', 'json').stdout).toBe('{\n  "cart.items": "",\n  "cart.title": ""\n}\n');
    expect(cli(config.root, 'export', 'de', 'de.po').stderr).toContain('name the format with --format xliff or --format json');
    expect(cli(config.root, 'export', 'de', '--format', 'po').stderr).toContain('export writes xliff or json, not "po"');
  });
});
