import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CatalogError,
  definePlugin,
  generate,
  lint,
  loadCatalog,
  loadConfig,
  phrase,
  resolveConfig,
  whereOf,
  words,
  type Plugin,
} from 'prosebook/tools';

import { fixture } from './fixture.ts';

const problemsOf = (files: Record<string, string>, config = {}) => {
  try {
    return loadCatalog(fixture(files, config)).problems.map((p) => `${whereOf(p)}: ${p.message}`);
  } catch (e) {
    if (e instanceof CatalogError) return e.problems.map((p) => `${whereOf(p)}: ${p.message}`);
    throw e;
  }
};

const entry = (en: string, extra = '') => `  context: Somewhere.\n${extra}  en: "${en}"\n`;

describe('catalog checks', () => {
  test('a clean catalog loads, with shorthand entries when context is not required', () => {
    const config = fixture({ 'copy/catalog/app.yaml': 'app.title: My app\napp.hello: Hello, {name}.\n' }, { require: [] });
    const catalog = loadCatalog(config);
    expect(catalog.messages.map((m) => m.key)).toEqual(['app.hello', 'app.title']);
    expect(catalog.messages[0]!.args).toEqual(new Map([['name', 'string']]));
  });

  test('keys, areas and fields', () => {
    const problems = problemsOf({
      'copy/catalog/app.yaml': `app:\n${entry('x')}App.Title:\n${entry('x')}other.thing:\n${entry('x')}app.typo:\n  contxt: Somewhere.\n  en: x\n`,
    });
    expect(problems).toEqual([
      'copy/catalog/app.yaml app: a key is dotted lowercase with two segments at least: `area.thing`',
      'copy/catalog/app.yaml App.Title: a key is dotted lowercase with two segments at least: `area.thing`',
      'copy/catalog/app.yaml other.thing: a key in app.yaml starts with "app."',
      'copy/catalog/app.yaml app.typo: "contxt" is not a field: kind, surface, context, args, fragment, allow, en',
      'copy/catalog/app.yaml app.typo: context is required (`require` in the config)',
    ]);
  });

  test('placeholders are documented exactly when context is required', () => {
    const problems = problemsOf({
      'copy/catalog/app.yaml': `app.a:\n${entry('{n, plural, one {# x} other {# xs}}')}app.b:\n${entry('Hi', '  args:\n    who: a name\n')}`,
    });
    expect(problems).toEqual([
      'copy/catalog/app.yaml app.a: args.n is missing: say what the placeholder holds',
      'copy/catalog/app.yaml app.b: args.who is not an argument of this message',
    ]);
  });

  test('ICU and format errors are explained', () => {
    const problems = problemsOf(
      {
        'copy/catalog/app.yaml': [
          'app.a: "{k, select, dark-mode {x} other {y}}"',
          'app.b: "{n, number, ::compact-shortt}"',
          'app.c: "{n, number, currency}"',
          'app.d: "{n, plural, one {x}}"',
        ].join('\n'),
      },
      { require: [] },
    );
    expect(problems[0]).toContain('names a select arm "dark-mode"');
    expect(problems[1]).toContain('skeleton stems the formatter drops without a word: compact-shortt');
    expect(problems[2]).toContain('needs its currency named');
    expect(problems[3]).toContain('not valid ICU');
  });

  test('a value YAML 1.1 reads differently must be quoted', () => {
    const problems = problemsOf({ 'copy/catalog/app.yaml': 'app.a: yes\n' }, { require: [] });
    expect(problems.join()).toContain('quote it');
  });

  test('translations must keep the placeholders and tags of the source', () => {
    const problems = problemsOf(
      {
        'copy/catalog/app.yaml': 'app.a: "Hi {name}, read <b>this</b>"\napp.b: Fine\n',
        'copy/locales/de/app.yaml': 'app.a: "Hallo {nme}, lies <i>das</i>"\napp.gone: Weg\n',
      },
      { require: [] },
    );
    expect(problems).toEqual([
      'copy/locales/de/app.yaml app.a: differs from the source: missing {name}; unknown {nme}; tags are <i>, the source has <b>',
      'copy/locales/de/app.yaml app.gone: no such key in the catalog, so this translation is unused',
    ]);
  });

  test('a locale may be one file or a folder of area files', () => {
    const config = fixture(
      {
        'copy/catalog/app.yaml': 'app.a: A\napp.b: B\n',
        'copy/locales/de.yaml': 'app.a: A-de\n',
        'copy/locales/fr/app.yaml': 'app.b: B-fr\n',
      },
      { require: [] },
    );
    const catalog = loadCatalog(config);
    expect(catalog.locales).toEqual(['de', 'fr']);
    expect(catalog.messages[0]!.translations.get('de')?.text).toBe('A-de');
  });
});

describe('stale translations', () => {
  test('a source edit marks its translations stale until they are edited or accepted', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.a: Save\napp.b: Open\n', 'copy/locales/de/app.yaml': 'app.a: Speichern\napp.b: Öffnen\n' },
      { require: [] },
    );
    expect(generate(config).stale.size).toBe(0);

    writeFileSync(join(config.catalog, 'app.yaml'), 'app.a: Save draft\napp.b: Open\n');
    expect([...(generate(config).stale.get('de')?.keys() ?? [])]).toEqual(['app.a']);
    // Still stale on the next run: nothing re-anchored it.
    expect([...(generate(config).stale.get('de')?.keys() ?? [])]).toEqual(['app.a']);

    writeFileSync(join(config.locales, 'de', 'app.yaml'), 'app.a: Entwurf speichern\napp.b: Öffnen\n');
    expect(generate(config).stale.size).toBe(0);

    writeFileSync(join(config.catalog, 'app.yaml'), 'app.a: Save draft\napp.b: Open file\n');
    expect([...(generate(config).stale.get('de')?.keys() ?? [])]).toEqual(['app.b']);
    generate(config, { accept: new Map([['de', new Set(['app.b'])]]) });
    expect(generate(config).stale.size).toBe(0);
  });

  test('with stale: fallback, a stale translation is left out of its locale', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.a: Save\n', 'copy/locales/de/app.yaml': 'app.a: Speichern\n' },
      { require: [], stale: 'fallback' },
    );
    generate(config);
    writeFileSync(join(config.catalog, 'app.yaml'), 'app.a: Save draft\n');
    expect(generate(config).entries.get('de')).toEqual([]);
  });
});

describe('lint', () => {
  const findings = (yaml: string, lintConfig = {}) => {
    const config = fixture({ 'copy/catalog/app.yaml': yaml }, { lint: lintConfig });
    return lint(loadCatalog(config).messages, config).map((f) => `${f.key} [${f.rule}] ${f.message}`);
  };

  test('budgets, periods and bare names follow the kind', () => {
    const yaml = [
      'app.a:\n  kind: action\n  context: A button.\n  en: Save the current draft now',
      'app.b:\n  kind: name\n  context: A heading.\n  en: "Quick capture: choose an area"',
      'app.c:\n  kind: description\n  context: A hint.\n  en: Opens the file',
      'app.d:\n  kind: description\n  context: A hint.\n  fragment: true\n  en: opens the file',
      'app.e:\n  kind: name\n  context: A heading.\n  en: Settings.',
    ].join('\n');
    expect(findings(yaml)).toEqual([
      'app.a [word-budget] an action is 3 words at most, and this is 4',
      'app.b [bare-name] a name carries no explanation after a dash or a colon',
      'app.c [period] a description ends with a period, or is marked fragment: true',
      'app.e [no-period] a name ends without a period',
    ]);
  });

  test('the strict preset adds word lists, case and contractions', () => {
    const yaml = [
      'app.a:\n  kind: action\n  context: A button.\n  en: Simply Save',
      'app.b:\n  kind: description\n  context: A hint.\n  en: Could not change the colour.',
    ].join('\n');
    expect(findings(yaml, { extends: 'strict' })).toEqual([
      'app.a [sentence-case] "Save" is capitalized in a sentence-case action: add it to lint.properNouns if it is a name',
      'app.a [banned-word] "simply" says it is easy, which helps nobody it is not easy for',
      'app.b [spelling] "colour" is spelled "color"',
      'app.b [contractions] "Could not" is written as a contraction (n\'t)',
    ]);
  });

  test('an exemption needs a reason, and must still be needed', () => {
    const yaml = [
      'app.a:\n  kind: name\n  context: A title.\n  allow:\n    word-budget: The legal name of the plan, which is fixed.\n  en: Pro Plus Team Annual Plan',
      'app.b:\n  kind: name\n  context: A title.\n  allow:\n    word-budget: Intentional.\n  en: Pro Plus Team Annual Plan',
      'app.c:\n  kind: name\n  context: A title.\n  allow:\n    word-budget: The legal name of the plan, which is fixed.\n  en: Pro',
    ].join('\n');
    expect(findings(yaml)).toEqual([
      'app.b [allow] allow.word-budget is four words at least: say why the rule is wrong here',
      'app.c [allow] allow.word-budget exempts the entry from a rule it passes: remove it',
    ]);
  });

  const house = definePlugin({
    name: 'house',
    rules: {
      'no-we': {
        description: 'The product speaks to the reader, not for itself.',
        recommended: 'warn',
        check: ({ text }) => (text.variants.some((v) => phrase('we').test(v)) ? ['"we": say what happens, not who does it'] : []),
      },
      'error-says-what-to-do': {
        description: 'An error says what to do next.',
        on: { surface: ['error'] },
        check: ({ text }) => (words(text.primary).length < 4 ? ['an error says what to do next'] : []),
      },
    },
  });

  test('a plugin adds rules, named after it, scoped by kind and surface', () => {
    const yaml = [
      'app.a:\n  kind: state\n  surface: error\n  context: A failed save.\n  en: We failed.',
      'app.b:\n  kind: state\n  surface: status\n  context: A badge.\n  en: Saved.',
      'app.c:\n  kind: state\n  context: A badge.\n  allow:\n    house/no-we: Quotes the team signature, which is fixed.\n  en: Made by we.',
    ].join('\n');
    expect(findings(yaml, { plugins: [house] })).toEqual(['app.a [house/no-we] "we": say what happens, not who does it']);
    expect(findings(yaml, { plugins: [house], extends: 'strict' })).toEqual([
      'app.a [house/no-we] "we": say what happens, not who does it',
      'app.a [house/error-says-what-to-do] an error says what to do next',
    ]);
    expect(findings(yaml, { plugins: [house], rules: { 'house/no-we': 'off' } })).toEqual([]);
  });

  test('a rule or plugin the config cannot place is an error', () => {
    expect(() => fixture({}, { lint: { rules: { 'house/no-we': 'warn' } } })).toThrow('lint.rules.house/no-we is not a rule');
    expect(() => fixture({}, { lint: { plugins: [house, house] } })).toThrow('"house" is added twice');
    expect(() => fixture({}, { lint: { plugins: [{ name: 'my/house', rules: {} }] } })).toThrow('is not a plugin name');
  });

  // As a JSON config would carry it: no code, so nothing type-checked.
  const style = {
    name: 'style',
    rules: {
      'no-click-here': {
        type: 'existence',
        description: 'A link says where it goes.',
        words: ['click here'],
        patterns: ['\\b[Hh]ere\\b(?=\\.?$)'],
        message: '"{match}" hides where the link goes: name the destination',
        strict: 'off',
        recommended: 'warn',
      },
      'sign-in': { type: 'substitution', description: 'One verb for signing in.', swap: { 'log in': 'sign in' }, recommended: 'warn' },
      'toast-budget': {
        type: 'occurrence',
        description: 'A toast is read in passing.',
        on: { surface: ['toast'] },
        count: 'characters',
        max: 20,
        recommended: 'warn',
      },
      'title-case': {
        type: 'capitalization',
        description: 'A title is in title case.',
        on: { surface: ['title'] },
        case: 'title',
        recommended: 'warn',
      },
      'undo-on-delete': {
        type: 'conditional',
        description: 'A delete says whether it can be undone.',
        when: '\\bdelete\\b',
        require: 'undo|can.t be undone',
        ignoreCase: true,
        message: '"{match}" says whether it can be undone',
        recommended: 'warn',
      },
    },
  } as const satisfies Plugin;

  test('rules written as data match words and patterns, count, read case and require', () => {
    const yaml = [
      'app.a:\n  kind: description\n  context: A link.\n  en: To read more, click here.',
      'app.b:\n  kind: description\n  context: A link.\n  en: The policy is here.',
      'app.c:\n  kind: action\n  context: A button.\n  en: Log in',
      'app.d:\n  kind: state\n  surface: toast\n  context: After a save.\n  en: Your changes are saved.',
      'app.e:\n  kind: name\n  surface: title\n  context: A page.\n  allow:\n    sentence-case: Titles here take title case, as the page head does.\n  en: Plans for the Team',
      'app.f:\n  kind: name\n  surface: title\n  context: A page.\n  en: Plans for the team',
      'app.g:\n  kind: description\n  context: A dialog.\n  args:\n    count: The files picked.\n  en: "{count, plural, one {Delete # file?} other {Delete # files? You can undo this.}}"',
    ].join('\n');
    expect(findings(yaml, { plugins: [style], rules: { 'sentence-case': 'warn' } })).toEqual([
      'app.a [style/no-click-here] "click here" hides where the link goes: name the destination',
      'app.a [style/no-click-here] "here" hides where the link goes: name the destination',
      'app.b [style/no-click-here] "here" hides where the link goes: name the destination',
      'app.c [style/sign-in] "log in" is written "sign in"',
      'app.d [style/toast-budget] 20 characters at most, and this is 23',
      'app.f [style/title-case] "team" is out of title case: change it, or add it to exceptions if it is a name',
      'app.g [style/undo-on-delete] "Delete" says whether it can be undone',
    ]);
  });

  test('a rule written as data is checked when the config loads', async () => {
    const problem = (rule: object) => {
      const plugin = { name: 'p', rules: { r: { description: 'A rule.', ...rule } } };
      return loadConfig(fixture({ 'prosebook.config.json': JSON.stringify({ lint: { plugins: [plugin] } }) }).root).then(
        () => 'loaded',
        (e: unknown) => (e instanceof Error ? e.message : String(e)),
      );
    };
    expect(await problem({ type: 'existence', message: 'm' })).toContain('lint rule p/r has no words or patterns');
    expect(await problem({ type: 'existence', patterns: ['('], message: 'm' })).toContain('patterns[0] is not a regular expression');
    expect(await problem({ type: 'existence', words: ['x'] })).toContain('lint rule p/r has no message');
    expect(await problem({ type: 'occurrence', count: 'lines', max: 1 })).toContain('counts lines: count words, sentences or characters');
    expect(await problem({ type: 'occurrence', count: 'words' })).toContain('has no max or min');
    expect(await problem({ type: 'capitalization', case: 'camel' })).toContain('has case camel');
    expect(await problem({ type: 'grammar' })).toContain('has type grammar: use existence');
    expect(await problem({ type: 'existence', words: ['x'], message: 'm', description: '' })).toContain('has no description');
  });
});

test('generate --check reports what is out of date without writing', () => {
  const config = fixture({ 'copy/catalog/app.yaml': 'app.a: A\n' }, { require: [] });
  expect(generate(config, { check: true }).changed.length).toBeGreaterThan(0);
  generate(config);
  expect(generate(resolveConfig(config.root, { require: [] }), { check: true }).changed).toEqual([]);
});
