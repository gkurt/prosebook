import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCopy, defineCatalog } from 'prosebook';
import { generate, loadCatalog, readMessage, writeMessage, type ProsebookConfig } from 'prosebook/tools';

import type { Entry } from '#src/tools/compile.ts';
import { argsOf } from '#src/tools/icu.ts';
import { readings } from '#src/tools/lint.ts';
import { applyRename, planRename } from '#src/tools/rename.ts';
import { compiled, fixture } from './fixture.ts';

const CONFIG = { require: [] } satisfies ProsebookConfig;

const SHOP = {
  'copy/catalog/app.yaml': [
    'app.title:',
    '  kind: name',
    '  en: Corner Shop',
    'app.pro:',
    '  kind: name',
    '  en: "{app.title, entry} Pro"',
    'app.welcome: "Welcome to {app.title, entry}, {name}."',
    'app.reviews: "Reviews of {app.title, entry}"',
    'app.upgrade: "Try {app.pro, entry}"',
    '',
  ].join('\n'),
  'copy/locales/de.yaml': [
    'app.title: "{case, select, genitive {des Eckladens} other {Eckladen}}"',
    'app.welcome: "Willkommen im {app.title, entry}, {name}."',
    'app.reviews: "Bewertungen {app.title, entry, genitive}"',
    'app.upgrade: "Probier {app.pro, entry}"',
    '',
  ].join('\n'),
  'copy/locales/de-AT.yaml': 'app.reviews: "Rezensionen {app.title, entry, genitive}"\n',
};

function copyOf(config: ReturnType<typeof fixture>) {
  const catalog = loadCatalog(config);
  const entries = (locale: string): Entry[] =>
    catalog.messages.flatMap((m): Entry[] => {
      const ast = locale === 'en' ? m.ast : m.translations.get(locale)?.ast;
      return ast === undefined ? [] : [[m.key, ast]];
    });
  const locales = ['en', 'de', 'de-AT'];
  const messages = Object.fromEntries(locales.map((l) => [l, compiled(entries(l))]));
  return { catalog, messages, copy: createCopy(defineCatalog({ source: 'en', locales, messages, loaders: {} })) };
}

describe('an entry said in another message', () => {
  test("says the name's text in each locale, at the form it asks for", async () => {
    const { copy, messages } = copyOf(fixture(SHOP, CONFIG));
    expect(copy.t('app.welcome', { name: 'Ada' })).toBe('Welcome to Corner Shop, Ada.');
    expect(copy.t('app.upgrade')).toBe('Try Corner Shop Pro');
    // Text alone, it compiles to a string, as a message with no placeholder does.
    expect(messages.en!['app.reviews']).toBe('Reviews of Corner Shop');
    await copy.setLocale('de');
    expect(copy.t('app.welcome', { name: 'Ada' })).toBe('Willkommen im Eckladen, Ada.');
    expect(copy.t('app.reviews')).toBe('Bewertungen des Eckladens');
    // German doesn't translate app.pro, so it says the source's, and the name in it in German.
    expect(copy.t('app.upgrade')).toBe('Probier Eckladen Pro');
    // Austrian German doesn't translate the name, so it takes German's forms.
    await copy.setLocale('de-AT');
    expect(copy.t('app.reviews')).toBe('Rezensionen des Eckladens');
  });

  test('is no argument, and lint reads the name as its text', () => {
    const { catalog } = copyOf(fixture(SHOP, CONFIG));
    const welcome = catalog.messages.find((m) => m.key === 'app.welcome')!;
    expect([...welcome.args.keys()]).toEqual(['name']);
    expect(readings(welcome.ast).primary).toBe('Welcome to Corner Shop, \u2063.');
  });

  test('migrates between the syntaxes', () => {
    const one = 'Reviews of {app.title, entry, genitive} and {app.pro, entry}';
    const two = 'Reviews of {app.title :pb:entry form=genitive} and {app.pro :pb:entry}';
    expect(writeMessage(2, readMessage(1, one, 'en'), 'en')).toBe(two);
    expect(writeMessage(1, readMessage(2, two, 'en'), 'en')).toBe(one);
    // A key quoted is the same literal.
    expect(writeMessage(1, readMessage(2, '{|app.title| :pb:entry}', 'en'), 'en')).toBe('{app.title, entry}');
    expect(argsOf(readMessage(2, two, 'en')).size).toBe(0);
    expect(() => readMessage(2, '{$key :pb:entry}', 'en')).toThrow('names an entry by a variable: write its key in the message');
    expect(() => readMessage(1, '{app.title, entry, two words}', 'en')).toThrow('names a form, which is one arm');
  });

  test('says a name the catalog has, at a form it has, and never itself', () => {
    const problems = (catalog: string, de = '') =>
      loadCatalog(fixture({ 'copy/catalog/app.yaml': catalog, 'copy/locales/de.yaml': de }, CONFIG), undefined, {
        partial: true,
      }).problems.map((p) => `${p.key}: ${p.message}`);
    const title = 'app.title:\n  kind: name\n  en: Corner Shop\n';
    expect(problems(`${title}app.a: "At {app.titel, entry}"\n`)).toEqual([
      'app.a: {app.titel, entry} names no entry: say a name the catalog has (prosebook find finds one by its words)',
    ]);
    expect(problems('app.b: Save\napp.a: "{app.b, entry} now"\n')).toEqual([
      'app.a: {app.b, entry} says an entry of kind unset: only a name can be said in another message, so write its words here',
    ]);
    expect(problems(`${title}app.a: "Of {app.title, entry, genitive}"\n`, 'app.a: "Von {app.title, entry, dative}"\n')).toEqual([
      "app.a: {app.title, entry, genitive} asks for a form app.title doesn't have in en, only its one text",
      "app.a: {app.title, entry, dative} asks for a form app.title doesn't have in en, only its one text",
    ]);
    expect(problems('app.x:\n  kind: name\n  en: "{app.y, entry}"\napp.y:\n  kind: name\n  en: "{app.x, entry} Pro"\n')).toEqual([
      'app.x: {app.x, entry} says itself, through app.x → app.y → app.x: write the words in one of them',
      'app.y: {app.y, entry} says itself, through app.y → app.x → app.y: write the words in one of them',
    ]);
    expect(problems('app.title:\n  kind: name\n  en: "Shop of {owner}"\napp.a: "At {app.title, entry}"\n')).toEqual([
      'app.title: is said in other messages ({app.title, entry}), so it is text, with selects for its forms: leave out {owner}',
    ]);
  });

  test('is renamed with the entry it says', () => {
    const config = fixture(SHOP, CONFIG);
    applyRename(planRename(config, 'app.title', 'brand.name'));
    expect(readFileSync(join(config.catalog, 'app.yaml'), 'utf8')).toContain('"Welcome to {brand.name, entry}, {name}."');
    expect(readFileSync(join(config.locales, 'de.yaml'), 'utf8')).toContain('"Bewertungen {brand.name, entry, genitive}"');
    expect(readFileSync(join(config.locales, 'de-AT.yaml'), 'utf8')).toContain('{brand.name, entry, genitive}');
    expect(copyOf(config).copy.t('app.reviews')).toBe('Reviews of Corner Shop');
  });

  test('is text to native targets', () => {
    const config = fixture(
      {
        'copy/catalog/app.yaml': 'app.title:\n  kind: name\n  en: Corner Shop\napp.welcome: "Welcome to {app.title, entry}, {name}."\n',
        'copy/locales/de.yaml': 'app.title: Eckladen\napp.welcome: "Willkommen im {app.title, entry}, {name}."\n',
      },
      { ...CONFIG, native: [{ language: 'android', out: 'android/res' }] },
    );
    generate(config);
    const strings = readFileSync(join(config.root, 'android/res/values-de/strings.xml'), 'utf8');
    expect(strings).toContain('Willkommen im Eckladen, %1$s.');
  });
});
