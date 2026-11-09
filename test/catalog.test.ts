import { describe, expect, test } from 'bun:test';
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  applyFixes,
  CatalogError,
  catalogSchema,
  definePlugin,
  generate,
  HOLE,
  lint,
  loadCatalog,
  loadConfig,
  phrase,
  resolveConfig,
  whereOf,
  words,
  type Plugin,
} from 'prosebook/tools';

import { watchCatalog } from '#src/tools/bundle.ts';
import { SCHEMA_LINE } from '#src/tools/catalog.ts';
import { todoOf } from '#src/tools/todo.ts';
import { cli, copyOf, fixture } from './fixture.ts';

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
      'copy/catalog/app.yaml app.typo: "contxt" is not a field: kind, surface, context, args, closed, min, fragment, allow, comment, remove, en',
      'copy/catalog/app.yaml app.typo: context is required (`require` in the config)',
    ]);
  });

  test('a comment and a mark for removal load, and are warnings until someone acts on them', () => {
    const problems = problemsOf({
      'copy/catalog/app.yaml': [
        `app.a:\n${entry('Hi', '  comment: Too chatty.\n')}`,
        `app.b:\n${entry('Bye', '  remove: true\n')}`,
        `app.c:\n${entry('x', '  remove: yes please\n')}`,
      ].join(''),
    });
    expect(problems).toEqual([
      'copy/catalog/app.yaml app.a: a comment to act on, then delete: Too chatty.',
      'copy/catalog/app.yaml app.b: marked for removal: delete the entry, its translations and the code that reads it',
      'copy/catalog/app.yaml app.c: remove is true or false',
    ]);
  });

  test("args describes a tag too, which the types and the translator's notes say", () => {
    const config = fixture({
      'copy/catalog/app.yaml': [
        'app.terms:',
        '  context: Under the checkout button.',
        '  args:',
        '    link: links to the terms of sale',
        '  en: Read the <link>terms</link>.',
        '',
      ].join('\n'),
      'copy/locales/de.yaml': '{}\n',
    });
    const { catalog, files } = generate(config, { check: true });
    expect(catalog.problems).toEqual([]);
    expect(files.get(join(config.out, 'index.ts'))).toContain('   * `<link>`: Links to the terms of sale.');
    expect(todoOf(config, catalog, new Map(), 'de', false).text).toContain('#   <link>: links to the terms of sale');
  });

  test("a select arm ICU can't name says what it can", () => {
    const problems = problemsOf({ 'copy/catalog/app.yaml': `app.a:\n${entry('{type, select, application/pdf {PDF} other {File}}')}` });
    expect(problems).toEqual([
      'copy/catalog/app.yaml app.a: names a select arm "application/pdf": an arm\'s name is letters, digits and _, so write it application_pdf and map the value to it in code, or write the catalog in MF2, which quotes it: |application/pdf|',
    ]);
  });

  test("a select's null arm says what an absent value shows, and makes the argument optional", async () => {
    const config = fixture(
      { 'copy/catalog/task.yaml': 'task.assigned: "Assigned to {name}{role, select, null {} other {, as {role}}}"\n' },
      { require: [] },
    );
    const { catalog, files } = generate(config);
    expect(catalog.messages[0]!.args).toEqual(
      new Map([
        ['name', 'string'],
        ['role', 'string | null | undefined'],
      ]),
    );
    expect(files.get(join(config.out, 'index.ts'))).toContain('readonly role?: string | null | undefined;');
    const copy = copyOf({ en: { 'task.assigned': catalog.messages[0]!.text } });
    expect(copy.t('task.assigned', { name: 'Ada' })).toBe('Assigned to Ada');
    expect(copy.t('task.assigned', { name: 'Ada', role: null })).toBe('Assigned to Ada');
    expect(copy.t('task.assigned', { name: 'Ada', role: 'reviewer' })).toBe('Assigned to Ada, as reviewer');
  });

  test('a closed select takes only its arms, in the source and in every translation', () => {
    const config = fixture(
      {
        'copy/catalog/app.yaml': [
          'app.mode:\n  closed: [mode]\n  en: "{mode, select, dark {Dark} light {Light} other {Light}}"',
          'app.bad:\n  closed: [count]\n  en: "{count, number} {x}"',
        ].join('\n'),
        'copy/locales/de.yaml': 'app.mode: "{mode, select, dark {Dunkel} dim {Gedimmt} other {Hell}}"\n',
      },
      { require: [] },
    );
    const catalog = loadCatalog(config, undefined, { partial: true });
    expect(catalog.messages.find((m) => m.key === 'app.mode')?.args).toEqual(new Map([['mode', '"dark" | "light"']]));
    expect(catalog.problems.map((p) => `${p.file} ${p.key}: ${p.message}`)).toEqual([
      'copy/catalog/app.yaml app.bad: closed.count is not a select with arms of its own in this message',
      'copy/locales/de.yaml app.mode: differs from the source: {mode} selects on "dim", which no closed arm of the source names',
    ]);
  });

  test('an argument used twice takes both uses where they agree, and fails where they cannot', () => {
    const config = fixture(
      {
        'copy/catalog/app.yaml': [
          'app.tool: "{tool, select, shell {Shell} other {{tool}}}"',
          'app.both: "{mode, select, dark {Dark} other {Light}} and {mode, select, auto {auto} other {set}}"',
          'app.open: "{x, select, other {any}} {x}"',
          'app.on: "{on, select, true {On} other {Off}}"',
          'app.clash: "{n, number} {n, select, one {one} other {more}}"',
        ].join('\n'),
        'copy/locales/de.yaml': 'app.tool: "{tool}"\n',
      },
      { require: [] },
    );
    const catalog = loadCatalog(config, undefined, { partial: true });
    const args = (key: string) => catalog.messages.find((m) => m.key === key)?.args;
    expect(args('app.tool')).toEqual(new Map([['tool', '"shell" | (string & {})']]));
    expect(args('app.both')).toEqual(new Map([['mode', '"dark" | "auto" | (string & {})']]));
    expect(args('app.open')).toEqual(new Map([['x', 'string']]));
    expect(args('app.on')).toEqual(new Map([['on', 'boolean']]));
    // A translation may print the argument where its source selects on it.
    expect(catalog.messages.find((m) => m.key === 'app.tool')?.translations.has('de')).toBe(true);
    expect(catalog.problems.map((p) => `${p.key}: ${p.message}`)).toEqual(['app.clash: "n" is used as two different types']);
  });

  test('placeholders are documented exactly when context is required', () => {
    const problems = problemsOf({
      'copy/catalog/app.yaml': `app.a:\n${entry('{n, plural, one {# x} other {# xs}}')}app.b:\n${entry('Hi', '  args:\n    who: a name\n')}`,
    });
    expect(problems).toEqual([
      'copy/catalog/app.yaml app.a: args.n is missing: say what the placeholder holds',
      'copy/catalog/app.yaml app.b: args.who is neither a placeholder nor a tag of this message',
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
    expect(problemsOf({ 'copy/catalog/app.yaml': 'app.a: "{d, date, ::yMMMdJmm}"' }, { require: [] })[0]).toContain(
      'date fields the formatter drops without a word: J',
    );
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
      // "Just now" says when, so it isn't the "just" that says something is easy.
      'app.c:\n  kind: state\n  context: A status.\n  en: Saved just now.',
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
      'app.b:\n  kind: name\n  context: A title.\n  allow:\n    word-budget: Intentional.\n  en: Pro Plus Team Monthly Plan',
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

  test('a rule is scoped by area, and an area sets its own severities', () => {
    const titled = definePlugin({
      name: 'menus',
      rules: {
        'title-case': { type: 'capitalization', description: 'A menu item is in title case.', on: { area: ['native'] }, case: 'title' },
      },
    });
    const config = fixture(
      {
        'copy/catalog/app.yaml': 'app.a:\n  kind: action\n  context: A button.\n  en: Save Draft',
        'copy/catalog/native.yaml': [
          'native.a:\n  kind: action\n  context: A menu item.\n  en: Save All Drafts',
          'native.b:\n  kind: action\n  context: A menu item.\n  en: Save draft',
        ].join('\n'),
      },
      { lint: { extends: 'strict', plugins: [titled], areas: { native: { 'sentence-case': 'off' } } } },
    );
    expect(lint(loadCatalog(config).messages, config).map((f) => `${f.key} [${f.rule}] ${f.message}`)).toEqual([
      'app.a [sentence-case] "Draft" is capitalized in a sentence-case action: add it to lint.properNouns if it is a name',
      'native.b [menus/title-case] "draft" is out of title case: change it, or add it to exceptions if it is a name',
    ]);
    expect(() => fixture({}, { lint: { areas: { native: { 'sentence-cases': 'off' } } } })).toThrow(
      'lint.areas.native.sentence-cases is not a rule',
    );
  });

  test('a path is written with the separator the config names, and --fix writes it', () => {
    const yaml = [
      'app.a:\n  kind: description\n  context: A hint.\n  en: Open Settings > General.',
      'app.b:\n  kind: description\n  context: A hint.\n  en: Open Settings->General.',
      'app.c:\n  kind: description\n  context: A hint.\n  en: Open Settings › General.',
      'app.d:\n  kind: description\n  context: A hint.\n  en: Read and / or write 2 > 1.',
    ].join('\n');
    expect(findings(yaml, { extends: 'none', rules: { path: 'error' }, pathSeparator: '>' })).toEqual([
      'app.b [path] a path is written with a spaced >',
      'app.c [path] a path is written with a spaced >',
    ]);
    const config = fixture({ 'copy/catalog/app.yaml': yaml }, { lint: { extends: 'none', rules: { path: 'error' } } });
    const found = lint(loadCatalog(config).messages, config);
    expect(found.map((f) => `${f.key} ${f.message}`)).toEqual([
      'app.a a path is written with a spaced ›',
      'app.b a path is written with a spaced ›',
    ]);
    expect(applyFixes(config, loadCatalog(config), found)).toEqual({ fixed: 2, problems: [] });
    expect(readFileSync(join(config.catalog, 'app.yaml'), 'utf8').match(/Open Settings › General\./g)).toHaveLength(3);
  });

  test('an arrow with no word after it is an affordance, a lone one with no capital after a flow, and one slash says or', () => {
    const yaml = [
      'app.a:\n  kind: action\n  context: A link.\n  en: View loop →',
      'app.e:\n  context: A caption.\n  en: origin → {hops}\n  args:\n    hops: The hops.',
      'app.f:\n  context: A caption.\n  en: retry → fail',
      'app.b:\n  kind: name\n  context: A label.\n  en: Preference / Context',
      'app.c:\n  kind: description\n  context: A hint.\n  en: Open Settings / Privacy / Cookies.',
      'app.d:\n  kind: description\n  context: A hint.\n  en: Open {page} → Billing.\n  args:\n    page: The page.',
    ].join('\n');
    expect(findings(yaml, { extends: 'none', rules: { path: 'error' } })).toEqual([
      'app.c [path] a path is written with a spaced ›',
      'app.d [path] a path is written with a spaced ›',
    ]);
  });

  test('no-em-dash names the dash it found, and a range asks for an en dash', () => {
    const yaml = [
      'app.a:\n  kind: description\n  context: A hint.\n  en: Saved — for now.',
      'app.b:\n  kind: description\n  context: A hint.\n  en: Saved - for now.',
      'app.c:\n  kind: description\n  context: A hint.\n  en: Saved – for now.',
      'app.d:\n  kind: description\n  context: A hint.\n  en: Open 9am - 5pm.',
      'app.e:\n  kind: description\n  context: A hint.\n  en: Mar 30 - Apr 6',
      'app.f:\n  kind: description\n  context: A hint.\n  en: Mar 30 – Apr 6',
    ].join('\n');
    const rules = { extends: 'none', rules: { 'no-em-dash': 'error' } } as const;
    expect(findings(yaml, rules)).toEqual([
      'app.a [no-em-dash] an em-dash stands in for punctuation: a comma, a period or a colon does the job',
      'app.b [no-em-dash] a spaced hyphen stands in for punctuation: a comma, a period or a colon does the job',
      'app.c [no-em-dash] a spaced en dash stands in for punctuation: a comma, a period or a colon does the job',
      'app.d [no-em-dash] a range is written with an en dash: "1–5"',
      'app.e [no-em-dash] a range is written with an en dash: "Mar 30 – Apr 6"',
    ]);
    const config = fixture({ 'copy/catalog/app.yaml': yaml }, { lint: rules });
    expect(applyFixes(config, loadCatalog(config), lint(loadCatalog(config).messages, config)).fixed).toBe(2);
    const fixed = readFileSync(join(config.catalog, 'app.yaml'), 'utf8');
    expect(fixed).toContain('Open 9am–5pm.');
    expect(fixed.match(/Mar 30 – Apr 6/g)).toHaveLength(2);
  });

  test('a rule or plugin the config cannot place is an error', () => {
    expect(() => fixture({}, { lint: { rules: { 'house/no-we': 'warn' } } })).toThrow('lint.rules.house/no-we is not a rule');
    expect(() => fixture({}, { lint: { plugins: [house, house] } })).toThrow('"house" is added twice');
    expect(() => fixture({}, { lint: { plugins: [{ name: 'my/house', rules: {} }] } })).toThrow('is not a plugin name');
    expect(() => fixture({}, { lint: { plugins: [{ name: 'voice', rules: {} }] } })).toThrow(`"voice" is prosebook's own`);
    expect(() => fixture({}, { lint: { rules: { 'house/*': 'off' } } })).toThrow('lint.rules.house/* is not a rule');
    expect(() => fixture({}, { lint: { areas: { native: { 'house/*': 'off' } } } })).toThrow('lint.areas.native.house/* is not a rule');
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

  test('a match taking in a placeholder is named and placed as the message writes it', () => {
    const names = definePlugin({
      name: 'names',
      rules: {
        'no-possessive-name': {
          type: 'existence',
          description: 'A name filled in never takes ’s.',
          recommended: 'error',
          patterns: [`${HOLE}'s\\b`],
          message: '"{match}" puts ’s after a placeholder',
        },
        'no-trailing-name': {
          description: 'A fix that would drop the placeholder.',
          recommended: 'error',
          check: ({ text }) => (text.primary.endsWith(` ${HOLE}`) ? [{ message: 'ends on a name', match: `by ${HOLE}`, fix: 'by' }] : []),
        },
      },
    });
    const yaml = [
      'app.a:\n  kind: description\n  context: A chart.\n  args:\n    team: The team.\n  en: "{team}’s usage"',
      'app.b:\n  kind: description\n  context: A chart.\n  en: Northwind’s usage',
      'app.c:\n  kind: description\n  context: A tip.\n  en: "Clear <code>npm</code>’s cache"',
      'app.d:\n  kind: description\n  context: A byline.\n  args:\n    name: Who wrote it.\n  en: "Written by {name}"',
    ].join('\n');
    const shown = (files: Record<string, string>, config = {}) => {
      const rules = { 'names/no-possessive-name': 'error', 'names/no-trailing-name': 'error' } as const;
      const loaded = fixture(files, { lint: { extends: 'none', plugins: [names], rules }, ...config });
      return lint(loadCatalog(loaded).messages, loaded).map(
        (f) => `${f.key} ${f.message} ${JSON.stringify(f.at)} ${JSON.stringify(f.fix ?? null)}`,
      );
    };
    expect(shown({ 'copy/catalog/app.yaml': yaml })).toEqual([
      'app.a "{team}’s" puts ’s after a placeholder {"start":0,"end":8} null',
      'app.c "<code>npm</code>’s" puts ’s after a placeholder {"start":6,"end":24} null',
      'app.d ends on a name {"start":8,"end":17} null',
    ]);
    const mf2 = [
      'app.a:\n  kind: description\n  context: A chart.\n  args:\n    team: The team.\n  en: "{$team}’s usage"',
      'app.c:\n  kind: description\n  context: A tip.\n  en: "Clear {#code}npm{/code}’s cache"',
    ].join('\n');
    expect(shown({ 'copy/catalog/app.yaml': mf2 }, { messageFormat: 2 })).toEqual([
      'app.a "{$team}’s" puts ’s after a placeholder {"start":0,"end":9} null',
      'app.c "{#code}npm{/code}’s" puts ’s after a placeholder {"start":6,"end":25} null',
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

  /** Entries with every placeholder documented, as `key: message` pairs. */
  const entries = (messages: Record<string, string>) =>
    Object.entries(messages)
      .map(([key, text]) => {
        const names = [...text.matchAll(/\{(?:\$(\w+)|([A-Za-z_]\w*)\s*[,}])/g)].map((m) => m[1] ?? m[2]);
        const args = [...new Set(names)].map((a) => `\n    "${a}": A value.`).join('');
        return `${key}:\n  context: A string.\n${args === '' ? '' : `  args:${args}\n`}  en: ${JSON.stringify(text)}`;
      })
      .join('\n');

  test('a state on a detail line needs no period, and an exemption can name a reason the config holds', () => {
    const yaml = [
      'app.count:\n  kind: state\n  surface: detail\n  context: Under a row.\n  args:\n    count: Lines.\n  en: "{count, plural, one {# line} other {# lines}}"',
      'app.badge:\n  kind: state\n  surface: status\n  context: A badge.\n  allow:\n    period: badge\n  en: Running',
      'app.typo:\n  kind: state\n  surface: status\n  context: A badge.\n  allow:\n    period: bagde\n  en: Stopped',
    ].join('\n');
    const reasons = { badge: 'A badge reads as a label, as every badge beside it does.' };
    const config = fixture({ 'copy/catalog/app.yaml': yaml }, { lint: { reasons } });
    expect(lint(loadCatalog(config).messages, config).map((f) => `${f.key} [${f.rule}] ${f.message}`)).toEqual([
      'app.typo [allow] allow.period names the reason "bagde", which lint.reasons doesn\'t hold: badge',
    ]);
    expect(() => fixture({}, { lint: { reasons: { shrug: 'Intentional.' } } })).toThrow(
      'lint.reasons.shrug is four words at least: say why the rule is wrong here',
    );
  });

  test('format rules read the placeholders, plurals and selects', () => {
    const yaml = entries({
      'app.a': '{count} files selected',
      'app.b': '{n, number} boxes',
      'app.c': '{count, plural, one {# files} other {# files}}',
      'app.d': '{count, plural, one {1 file.} other {# files.}}',
      'app.e': '{count, plural, one {# file.} other {# files}}',
      'app.f': 'Total: ${price, number}',
      'app.g': '{rate, number}% off',
      'app.h': 'Up to 10,000 files',
      'app.i': '{count, plural, one {# file} other {# files}} selected, by {name}',
      'app.j': '{name} files it, {gender, select, female {her own.} other {their own.}}',
      'app.k': '{rate, number} kbps, {count} fps, {total} IDs',
      'app.l': '{count, plural, =0 {Nothing to upload} other {Uploading # files…}}',
      'app.m': '{used, number} of {window, number} tokens',
      'app.n': '{mode, select, a {{count} files here} other {{count} files there}}',
      'app.o': '{hours, number}h {minutes, number}m, {size, number} MB, {name}s',
      // Nothing after the count has a singular, so one says what other does, as plural-forms asks.
      'app.p': '{count, plural, one {# failed} other {# failed}}',
      'app.q': '{count, plural, one {New notifications, # unread} other {New notifications, # unread}}',
      'app.r': '{count, plural, one {Delete files} other {Delete files}}',
    });
    expect(findings(yaml)).toEqual([
      'app.a [plural-count] count is followed by "files", which reads "1 files": make it a plural with a "# file" arm',
      'app.b [plural-count] n is followed by "boxes", which reads "1 boxes": make it a plural with a "# box" arm',
      'app.c [plural-one] the one and other arms of count both write "files": write the singular, "file", in one',
      'app.d [plural-one] the one arm of count writes 1, which one is not in every language: write #, or make the arm =1',
      'app.e [arm-endings] some arms of count end with a stop and some without: end them alike',
      'app.f [formatted-by-hand] "$" is typed before price: format it as a currency, which puts the symbol where the locale does',
      'app.g [formatted-by-hand] "%" is typed after rate: format it as a percent, which takes the fraction (0.5 for 50%)',
      'app.h [formatted-by-hand] "10,000" groups its digits the English way: make it a placeholder formatted as a number',
      'app.k [plural-count] total is followed by "IDs", which reads "1 IDs": make it a plural with a "# ID" arm',
      'app.l [plural-forms] English writes {count} in the forms one and other: add one, even where an arm says what other says',
      'app.n [plural-count] count is followed by "files", which reads "1 files": make it a plural with a "# file" arm',
      'app.o [formatted-by-hand] "h" is typed after hours: format it as a unit, {hours, number, ::unit/hour unit-width-narrow}, which writes it as the locale does',
      'app.o [formatted-by-hand] "m" is typed after minutes: format it as a unit, {minutes, number, ::unit/minute unit-width-narrow}, which writes it as the locale does',
      'app.o [formatted-by-hand] "MB" is typed after size: format it as a unit, {size, number, ::unit/megabyte unit-width-narrow}, which writes it as the locale does',
      'app.r [plural-one] the one and other arms of count both write "files": write the singular, "file", in one',
    ]);
  });

  test('format rules read MessageFormat 2 as they read MF1', () => {
    const match = '.input {$count :number}\n.match $count\none {{{$count} file.}}\n* {{{$count} files}}';
    const yaml = entries({ 'app.a': '{$count :number} files', 'app.b': match });
    const config = fixture({ 'copy/catalog/app.yaml': yaml }, { messageFormat: 2 });
    expect(lint(loadCatalog(config).messages, config).map((f) => `${f.key} [${f.rule}] ${f.message}`)).toEqual([
      'app.a [plural-count] count is followed by "files", which reads "1 files": make it a plural with a "# file" arm',
      'app.b [arm-endings] some arms of count end with a stop and some without: end them alike',
    ]);
  });

  test('translations are read by the rules written for every locale, or for theirs', () => {
    const catalog = [
      'app.a:\n  context: After a save.\n  en: Saved.',
      'app.b:\n  context: A count.\n  args:\n    count: The files.\n  en: "{count, plural, one {# file} other {# files}}"',
      'app.c:\n  context: A total.\n  args:\n    price: The sum.\n  en: "Total: {price, number}"',
      'app.d:\n  context: A wait.\n  en: Please wait.',
      'app.e:\n  kind: action\n  surface: action\n  context: A button.\n  en: Add to cart',
      'app.f:\n  context: A check.\n  allow:\n    source-ending: German closes this one, as its other confirmations do.\n  en: Done',
    ].join('\n');
    const germanUsesDu = definePlugin({
      name: 'de',
      rules: {
        du: {
          description: 'The product says du.',
          on: { locale: ['de'] },
          recommended: 'warn',
          check: ({ text }) => (text.variants.some((v) => phrase('Sie').test(v)) ? ['"Sie" addresses the reader formally: say du'] : []),
        },
      },
    });
    const growth = {
      name: 'fit',
      rules: {
        button: {
          type: 'occurrence',
          description: 'A button grows half again at most.',
          on: { surface: ['action'], locale: 'all' },
          count: 'characters',
          max: 1.5,
          relative: true,
          recommended: 'warn',
        },
      },
    } as const satisfies Plugin;
    const config = fixture(
      {
        'copy/catalog/app.yaml': catalog,
        'copy/locales/de.yaml':
          'app.a: Gespeichert\napp.c: "Summe:  {price, number}"\napp.d: Bitte warten Sie.\napp.e: In den Warenkorb legen\napp.f: Fertig.\n',
        'copy/locales/de-CH.yaml': 'app.d: Warten Sie.\n',
        'copy/locales/ru.yaml': 'app.b: "{count, plural, one {1 файл} few {# файла} many {# файлов} other {# файла}}"\n',
        'copy/locales/tr.yaml': 'app.b: "{count, plural, one {# dosya} other {# dosya}}"\n',
      },
      { lint: { plugins: [germanUsesDu, growth], banned: [{ words: ['please'], why: 'pleads: say what to do' }] } },
    );
    expect(lint(loadCatalog(config).messages, config).map((f) => `${f.locale} ${f.key} [${f.rule}] ${f.message}`)).toEqual([
      'de app.a [source-ending] the source ends with a stop, and this does not: end it as the source does',
      'ru app.b [plural-one] the one arm of count writes 1, which one is not in every language: write #, or make the arm =1',
      'de app.c [whitespace] no leading, trailing or doubled spaces',
      'en app.d [banned-word] "please" pleads: say what to do',
      'de-CH app.d [de/du] "Sie" addresses the reader formally: say du',
      'de app.d [de/du] "Sie" addresses the reader formally: say du',
      "de app.e [fit/button] 16 characters at most (1.5 times the source's 11), and this is 22",
    ]);
  });

  test('a finding says where it stands in the text, and --fix writes what the rule offers', () => {
    const catalog = [
      'app.a: Colour could not load...',
      "app.b: It''s gone...",
      'app.c:\n  context: Kept as it was.\n  en: Pick a colour, any colour',
      '',
    ].join('\n');
    const config = fixture(
      { 'copy/catalog/app.yaml': catalog, 'copy/locales/de.yaml': 'app.a: "Farbe  nicht geladen."\n' },
      { require: [], lint: { extends: 'strict' } },
    );
    const findings = lint(loadCatalog(config).messages, config);
    const shown = findings.map(
      (f) => `${f.locale} ${f.key} [${f.rule}] ${JSON.stringify(f.at)} ${JSON.stringify(f.fix?.map((e) => e.text))}`,
    );
    expect(shown).toEqual([
      'en app.a [spelling] {"start":0,"end":6} ["Color"]',
      'en app.a [contractions] {"start":7,"end":16} ["couldn\'t"]',
      'en app.a [ellipsis] {"start":21,"end":24} ["…"]',
      'de app.a [whitespace] {"start":5,"end":7} [" "]',
      // The literal reads "It's", but the text writes "It''s": nowhere to put the fix.
      'en app.b [ellipsis] undefined undefined',
      'en app.c [spelling] {"start":7,"end":13} ["color","color"]',
    ]);

    expect(applyFixes(config, loadCatalog(config), findings)).toEqual({ fixed: 5, problems: [] });
    expect(readFileSync(join(config.catalog, 'app.yaml'), 'utf8')).toBe(
      ["app.a: Color couldn't load…", "app.b: It''s gone...", 'app.c:\n  context: Kept as it was.\n  en: Pick a color, any color', ''].join(
        '\n',
      ),
    );
    expect(readFileSync(join(config.locales, 'de.yaml'), 'utf8')).toBe('app.a: "Farbe nicht geladen."\n');
  });

  test('fixes land in MessageFormat 2 arms, which are read out of order', () => {
    const match = '.input {$n :number}\n.match $n\none {{{$n} colour}}\n* {{{$n} colours}}';
    const config = fixture(
      { 'copy/catalog/app.yaml': `app.a:\n  args:\n    "n": Colours picked.\n  en: |-\n${match.replace(/^/gm, '    ')}\n` },
      {
        messageFormat: 2,
        require: [],
        lint: { extends: 'strict' },
      },
    );
    const findings = lint(loadCatalog(config).messages, config);
    expect(applyFixes(config, loadCatalog(config), findings).fixed).toBe(2);
    expect(loadCatalog(config).messages[0]!.text).toBe(match.replace('colour}', 'color}').replace('colours}', 'colors}'));
  });

  const translated = (catalog: Record<string, string>, locales: Record<string, string>, config = {}) => {
    const files = Object.fromEntries(Object.entries(locales).map(([locale, yaml]) => [`copy/locales/${locale}.yaml`, yaml]));
    const loaded = fixture({ 'copy/catalog/app.yaml': entries(catalog), ...files }, { require: [], ...config });
    return lint(loadCatalog(loaded).messages, loaded);
  };
  const shown = (found: ReturnType<typeof lint>) => found.map((f) => `${f.locale} ${f.key} [${f.rule}] ${f.message}`);

  test("a plural writes every form its locale's counts take, and is warned of one it never picks", () => {
    const found = translated(
      {
        'app.a': '{count, plural, one {# file} other {# files}}',
        'app.b': '{count, plural, zero {No files} one {# file} other {# files}}',
        'app.c': '{count, plural, =0 {Is empty} other {Is full}}',
        'app.d': '{rank, selectordinal, one {#st} other {#th}}',
        'app.e': '{count, plural, =0 {No files} =1 {One file} other {# files}}',
        // A count of its own is an exact arm, which any locale may write.
        'app.f': '{count, plural, =4 {A full set} few {A few} one {# file} other {# files}}',
      },
      {
        de: 'app.a: "{count, plural, other {# Dateien}}"\napp.c: "{count, plural, =0 {Leer} other {Voll}}"\napp.e: "{count, plural, =0 {Keine} =1 {Eine Datei} other {# Dateien}}"\n',
        pl: 'app.a: "{count, plural, one {# plik} other {# plików}}"\napp.e: "{count, plural, =0 {Brak} =1 {Jeden plik} other {# plików}}"\n',
      },
    );
    const plurals = new Set(['plural-forms', 'plural-unused-form']);
    expect(shown(found.filter((f) => plurals.has(f.rule)))).toEqual([
      'de app.a [plural-forms] German writes {count} in the forms one and other: add one, even where an arm says what other says',
      'pl app.a [plural-forms] Polish writes {count} in the forms one, few, many and other: add few and many, even where an arm says what other says',
      'en app.b [plural-unused-form] English never picks zero for {count}, not even for 0: write =0, or remove the arm',
      'en app.d [plural-forms] English writes {rank} in the ordinal forms one, two, few and other: add two and few, even where an arm says what other says',
      // =1 is the only count Polish's one takes, so the exact arm stands for it.
      'pl app.e [plural-forms] Polish writes {count} in the forms few, many and other: add few and many, even where an arm says what other says',
      'en app.f [plural-unused-form] English never picks few for {count}: remove the arm, or write the count it is for as an exact arm, =4',
    ]);
    expect(found.find((f) => f.rule === 'plural-unused-form')?.severity).toBe('warn');

    // MF2 arms every form once * is written, so the forms written are what counts, in both rules.
    const match = (variants: string) => `|-\n    .input {$n :number}\n    .match $n\n${variants.replace(/^/gm, '    ')}`;
    const mf2 = fixture(
      {
        'copy/catalog/app.yaml': `app.a: ${match('4 {{A full set}}\nfew {{A few}}\none {{{$n} file}}\n* {{{$n} files}}')}\n`,
        'copy/locales/pl.yaml': `app.a: ${match('one {{{$n} plik}}\n* {{{$n} plików}}')}\n`,
      },
      { require: [], messageFormat: 2 },
    );
    expect(shown(lint(loadCatalog(mf2).messages, mf2))).toEqual([
      'en app.a [plural-unused-form] English never picks few for {n}: remove the arm, or write the count it is for as an exact arm, =4',
      'pl app.a [plural-forms] Polish writes {n} in the forms one, few, many and other: add few and many, even where an arm says what other says',
    ]);
  });

  test("a count's min leaves out the forms only smaller counts take, in each locale", () => {
    const yaml = [
      'app.sites:\n  min:\n    count: 2\n  en: "{count, plural, other {# sites}}"',
      'app.bad:\n  min:\n    total: 2\n    count: 1.5\n  en: "{total, number} of {count, plural, one {# site} other {# sites}}"',
    ].join('\n');
    const files = {
      'copy/catalog/app.yaml': yaml,
      'copy/locales/de.yaml': 'app.sites: "{count, plural, other {# Websites}}"\n',
      // Russian's one is 21 too, and Polish's few 2 to 4: a minimum of 2 reaches both.
      'copy/locales/ru.yaml': 'app.sites: "{count, plural, few {# сайта} many {# сайтов} other {# сайта}}"\n',
      'copy/locales/pl.yaml': 'app.sites: "{count, plural, many {# witryn} other {# witryny}}"\n',
    };
    const loaded = loadCatalog(fixture(files, { require: [] }), undefined, { partial: true });
    expect(loaded.problems.map((p) => `${p.key}: ${p.message}`)).toEqual([
      'app.bad: min.total is not the count of a plural in this message',
      'app.bad: min.count is a whole number: min: { count: 2 }',
    ]);
    const config = fixture(files, { require: [] });
    writeFileSync(join(config.catalog, 'app.yaml'), yaml.split('\napp.bad')[0]!);
    expect(shown(lint(loadCatalog(config).messages, config).filter((f) => f.rule === 'plural-forms'))).toEqual([
      'pl app.sites [plural-forms] Polish writes {count} in the forms few, many and other: add few, even where an arm says what other says',
      'ru app.sites [plural-forms] Russian writes {count} in the forms one, few, many and other: add one, even where an arm says what other says',
    ]);
    expect(todoOf(config, loadCatalog(config), new Map(), 'fr').text).toContain('#   {count}: always 2 or more');
  });

  test('check prints warnings beside errors, and fails only on errors', () => {
    const files = {
      'prosebook.config.json': '{ "require": [] }',
      'copy/catalog/app.yaml': `${SCHEMA_LINE}\napp.a: "{count, plural, zero {No files} one {# file} other {# files}}"\n`,
    };
    const config = fixture(files, { require: [] });
    generate(config);
    const warned = cli(config.root, 'check');
    expect(warned.stderr).toContain('warn  copy/catalog/app.yaml:2:1 app.a: [plural-unused-form] English never picks zero for {count}');
    expect(warned.code).toBe(0);

    writeFileSync(join(config.catalog, 'app.yaml'), `${SCHEMA_LINE}\napp.a: "{count, plural, other {# files}}"\n`);
    generate(config);
    const failed = cli(config.root, 'check');
    expect(failed.stderr).toContain('error copy/catalog/app.yaml:2:1 app.a: [plural-forms]');
    expect(failed.code).toBe(1);
  });

  test("quotes, French spacing, Spanish's opening marks and full-width punctuation follow each language", () => {
    const found = translated(
      {
        'app.a': 'Open "Settings"',
        'app.b': 'Saved!',
        'app.c': 'Ready?',
        'app.d': 'Note: ready, done.',
        'app.e': 'Name {name}',
      },
      {
        de: 'app.a: Öffne “Einstellungen”\n',
        'de-CH': 'app.a: Öffne «Einstellungen»\n',
        fr: 'app.a: Ouvrir «Réglages»\napp.b: Enregistré!\napp.c: "Prêt ?"\napp.d: "Remarque\u202F: prêt."\napp.e: "Nom «{name}»"\n',
        'fr-CH': 'app.b: Enregistré!\n',
        es: 'app.b: ¡Guardado!\napp.c: Listo?\n',
        ja: 'app.d: 注意:準備完了.\n',
        zh: 'app.d: "注意: 准备好了, 完成."\n',
      },
    );
    const rules = new Set(['quotes', 'french-spacing', 'inverted-marks', 'full-width']);
    const ours = found.filter((f) => rules.has(f.rule));
    expect(shown(ours)).toEqual([
      'de app.a [quotes] German quotes with „…“: write „Einstellungen“',
      'fr app.a [french-spacing] French sets a narrow no-break space after «',
      'fr app.a [french-spacing] French sets a narrow no-break space before »',
      'fr app.b [french-spacing] French sets a narrow no-break space before ; ! and ?',
      'es app.c [inverted-marks] a question in Spanish opens with ¿: ¿Listo?',
      'fr app.c [french-spacing] French sets a narrow no-break space before ; ! and ?',
      'ja app.d [full-width] Japanese writes . after its own text as 。',
      'ja app.d [full-width] Japanese writes : after its own text as ：',
      'zh app.d [full-width] Chinese writes , after its own text as ，',
      'zh app.d [full-width] Chinese writes . after its own text as 。',
      'zh app.d [full-width] Chinese writes : after its own text as ：',
      'fr app.e [french-spacing] French sets a narrow no-break space after «',
      'fr app.e [french-spacing] French sets a narrow no-break space before »',
    ]);

    const fixes = ours.filter((f) => f.fix !== undefined).map((f) => `${f.locale} ${f.key} ${JSON.stringify(f.fix!.map((e) => e.text))}`);
    expect(fixes).toEqual([
      'de app.a ["„Einstellungen“"]',
      'fr app.a ["«\u202f"]',
      'fr app.a ["\u202f»"]',
      'fr app.b ["\u202f!"]',
      'fr app.c ["\u202f?"]',
      'ja app.d ["。"]',
      'ja app.d ["："]',
      'zh app.d ["，"]',
      'zh app.d ["。"]',
      'zh app.d ["："]',
    ]);
  });

  test('lint.quotes sets the marks per locale, and must be pairs', async () => {
    const found = translated(
      { 'app.a': 'Open "Settings"' },
      { de: 'app.a: Öffne „Einstellungen“\n' },
      { lint: { quotes: { de: ['»', '«'] } } },
    );
    expect(shown(found)).toEqual(['de app.a [quotes] German quotes with »…«: write »Einstellungen«']);
    // A JSON config is not type-checked.
    const json = fixture({ 'prosebook.config.json': JSON.stringify({ lint: { quotes: { de: ['»'] } } }) });
    const loaded = await loadConfig(json.root).then(
      () => 'loaded',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(loaded).toContain('lint.quotes.de is a pair of marks');
  });

  test('two entries saying the same words in the same role are one entry', () => {
    const catalog = (shared?: string) =>
      fixture(
        {
          'copy/catalog/app.yaml': [
            'app.save:\n  kind: action\n  context: Saves the form.\n  en: Save',
            'app.store:\n  kind: action\n  context: Saves the draft.\n  en: Save',
            'app.title:\n  kind: name\n  context: A heading.\n  en: Save',
            'app.old:\n  kind: action\n  context: Saves.\n  remove: true\n  en: Save',
          ].join('\n'),
          'copy/catalog/editor.yaml': 'editor.save:\n  kind: action\n  context: Saves the file.\n  en: Save',
        },
        shared === undefined ? {} : { extract: { shared } },
      );
    const duplicates = (config: ReturnType<typeof fixture>) =>
      shown(lint(loadCatalog(config).messages, config).filter((f) => f.rule === 'duplicate'));
    expect(duplicates(catalog())).toEqual([
      'en app.store [duplicate] says what app.save says, in the same role: read app.save where this is read, and remove this entry',
      'en editor.save [duplicate] says what app.save says, in the same role: read app.save where this is read, and remove this entry',
    ]);
    expect(duplicates(catalog('common'))[1]).toBe(
      'en editor.save [duplicate] says what app.save says, in the same role: move one into common.*, read it in both places, and remove the other',
    );
  });
});

test('generate --check reports what is out of date without writing', () => {
  const config = fixture({ 'copy/catalog/app.yaml': 'app.a: A\n' }, { require: [] });
  expect(generate(config, { check: true }).changed.length).toBeGreaterThan(0);
  generate(config);
  expect(generate(resolveConfig(config.root, { require: [] }), { check: true }).changed).toEqual([]);
});

test('generate starts each catalog file with the schema line, and --check fails on one without it', () => {
  const own = '# yaml-language-server: $schema=../schemas/catalog.json\napp.b: B\n';
  const config = fixture({ 'copy/catalog/app.yaml': 'app.a: A\n', 'copy/catalog/web.yaml': 'web.a: A\r\n' }, { require: [] });
  writeFileSync(join(config.root, 'copy/catalog/own.yaml'), own.replace('app.b', 'own.b'));
  generate(config);
  const read = (file: string) => readFileSync(join(config.root, 'copy/catalog', file), 'utf8');
  expect(read('app.yaml')).toBe(`${SCHEMA_LINE}\napp.a: A\n`);
  expect(read('web.yaml')).toBe(`${SCHEMA_LINE}\r\nweb.a: A\r\n`);
  // A schema line of the file's own is left as it is.
  expect(read('own.yaml')).toBe(own.replace('app.b', 'own.b'));
  writeFileSync(join(config.root, 'copy/catalog/app.yaml'), 'app.a: A\n');
  expect(generate(config, { check: true }).changed).toEqual([join(config.catalog, 'app.yaml')]);
});

test('the schema offers the key: message shorthand only where no field is required', () => {
  const shorthand = (require: ('context' | 'kind')[]) =>
    JSON.stringify(catalogSchema(fixture({}, { require }))).includes('with nothing said about it');
  expect(shorthand([])).toBe(true);
  expect(shorthand(['context'])).toBe(false);
  expect(shorthand(['context', 'kind'])).toBe(false);
});

test('a config file edited is read again, and the catalog watcher regenerates with it', async () => {
  const { root } = fixture({ 'prosebook.config.ts': "export default { source: 'en' };\n" });
  const file = join(root, 'prosebook.config.ts');
  // Written apart in time, as an edit is: a module changed within the clock's resolution reads as the same.
  const edit = (content: string, seconds: number) => {
    writeFileSync(file, content);
    utimesSync(file, seconds, seconds);
  };
  edit("export default { source: 'en' };\n", 1_000_000);
  expect((await loadConfig(root)).source).toBe('en');
  edit("export default { source: 'de' };\n", 1_000_100);
  expect((await loadConfig(root)).source).toBe('de');

  const seen: string[] = [];
  const stop = watchCatalog(await loadConfig(root), undefined, (config) => seen.push(config.source), String);
  try {
    edit("export default { source: 'fr' };\n", 1_000_200);
    for (let i = 0; i < 100 && seen.length === 0; i++) await Bun.sleep(20);
    expect(seen.at(-1)).toBe('fr');
  } finally {
    stop();
  }
});
