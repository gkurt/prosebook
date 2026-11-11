import { describe, expect, test } from 'bun:test';

import {
  definePlugin,
  definePreset,
  judgeCatalog,
  lint,
  loadCatalog,
  readLock,
  render,
  resolveConfig,
  todoOf,
  writingGuide,
  type Judge,
  type JudgeRequest,
  type ProsebookConfig,
} from 'prosebook/tools';

import { fixture } from './fixture.ts';

const CATALOG = {
  'copy/catalog/app.yaml': `app.failed:
  kind: state
  surface: error
  context: Saving the list failed.
  en: We could not save your list. Try again!
`,
  'copy/catalog/legal.yaml': `legal.failed:
  kind: state
  surface: error
  context: The terms failed to load.
  en: We can't load the terms. Try again in order to continue!
`,
};

const project = (config: ProsebookConfig) => fixture(CATALOG, { ...config, lint: { rules: { 'voice/*': 'off' }, ...config.lint } });

const findings = (config: ProsebookConfig) =>
  lint(loadCatalog(project(config)).messages, project(config)).map((f) => `${f.key} ${f.rule} ${f.severity}`);

describe('presets', () => {
  test('a preset sets its rules over lint.extends: formal writes negatives out and drops the exclamation mark', () => {
    expect(findings({ extends: 'plain' })).toEqual([
      'app.failed formal/exclamation warn',
      'legal.failed formal/expanded warn',
      'legal.failed formal/exclamation warn',
      'legal.failed plain/words warn',
    ]);
  });

  test("a preset turns a rule off, or on at least as high as it says, and the config's own lint.rules win", () => {
    expect(findings({ extends: 'friendly' })).toEqual(['app.failed contractions warn']);
    expect(findings({ extends: 'friendly', lint: { extends: 'strict' } })).toContain('app.failed contractions error');
    expect(findings({ extends: 'plain', lint: { extends: 'strict' } }).filter((f) => f.includes(' contractions '))).toEqual([]);
    expect(findings({ extends: 'friendly', lint: { rules: { contractions: 'off' } } })).toEqual([]);
  });

  test('an area takes a preset of its own, whose rules hold there alone', () => {
    expect(findings({ extends: 'friendly', tone: { areas: { legal: 'plain' } } })).toEqual([
      'app.failed contractions warn',
      'legal.failed formal/expanded warn',
      'legal.failed formal/exclamation warn',
      'legal.failed plain/words warn',
    ]);
    expect(() =>
      resolveConfig('.', { tone: { areas: { legal: definePreset({ name: 'words', lint: { spelling: { colour: 'color' } } }) } } }),
    ).toThrow('tone.areas.legal adds words, which hold for the whole catalog: extend the preset at the top instead');
  });

  test("a team's preset extends prosebook's, each field of the tone over the one under it", () => {
    const house = definePreset({
      name: 'house',
      extends: ['professional'],
      tone: { formality: 'informal' },
      lint: { banned: [{ words: ['synergy'], why: 'is jargon' }], plugins: [definePlugin({ name: 'house', rules: {} })] },
    });
    const config = resolveConfig('.', { extends: [house] });
    expect(config.tone.presets).toEqual(['formal', 'professional', 'house']);
    expect(config.tone.formality).toEqual({ '*': 'informal' });
    expect(config.tone.doc).toStartWith('Calm, exact and brief');
    expect(config.lint.banned).toEqual([{ words: ['synergy'], why: 'is jargon' }]);
    expect(config.lint.rules['contractions']?.severity).toBe('off');
    expect(resolveConfig('.', { extends: [house], tone: { formality: 'formal' } }).tone.formality).toEqual({ '*': 'formal' });
  });

  test('a preset is checked: one prosebook lacks, one extending itself, two of a name, a rule no one defines', () => {
    expect(() => resolveConfig('.', { extends: 'grumpy' })).toThrow(
      'extends names "grumpy", which is no preset: name one of formal, plain',
    );
    const loop: { name: string; extends: unknown[] } = { name: 'loop', extends: [] };
    loop.extends.push(loop);
    expect(() => resolveConfig('.', { extends: loop as never })).toThrow('preset "loop" extends itself');
    expect(() => resolveConfig('.', { extends: [{ name: 'plain' }, 'plain'] })).toThrow('two presets are named "plain"');
    expect(() => resolveConfig('.', { extends: { name: 'odd', lint: { rules: { nope: 'warn' } } } })).toThrow(
      'preset "odd" sets lint.rules.nope, which is not a rule',
    );
  });
});

describe('the tone', () => {
  test('the writing guide says it, with its examples, the form of you, and each area that differs', () => {
    const guide = writingGuide(project({ extends: 'friendly', tone: { notes: 'We sell to bakeries.', areas: { legal: 'plain' } } }));
    expect(guide).toContain('## Tone\n\nWarm and direct, for apps people choose to use.');
    expect(guide).toContain('Errors stay straightforward. We sell to bakeries.');
    // A catalog in English alone has no other locale's form of you to speak of.
    expect(guide).toContain('The copy addresses the reader informally.\n');
    expect(guide).not.toContain('form of `you`');
    const translated = writingGuide(project({ extends: 'friendly' }), ['de']);
    expect(translated).toContain("The copy addresses the reader informally, in each language's own form of `you`.\n");
    expect(guide).toContain(
      '- `state` on `error`: "We couldn\'t save your list. Check your connection, then try again.", not "Oops! Something went wrong."',
    );
    expect(guide).toContain('In `legal.*`, plain: Plain and neutral,');
    expect(guide).toContain(
      'Write what happened, then what the reader can do. Address the reader as `you`. The reader is addressed formally.',
    );
    expect(guide).toContain('- In `legal.*`: No idioms or figures of speech');
    expect(writingGuide(project({}))).not.toContain('## Tone');
  });

  test("a translation prompt says each entry's tone and the form of you it takes", () => {
    const config = project({ extends: 'friendly', tone: { areas: { legal: 'plain' } } });
    const prompt = todoOf(config, render(config).catalog, new Map(), 'de', true).text;
    expect(prompt).toContain('Tone, by entry:\n- app.failed: Warm and direct');
    expect(prompt).toContain('Address the reader informally: du, dich, dir, dein, not Sie, Ihnen, Ihr.');
    expect(prompt).toContain('- legal.failed: Plain and neutral');
    expect(prompt).toContain('Address the reader formally: Sie, Ihnen, Ihr, not du, dich, dir, dein.');
    const one = project({ extends: 'technical' });
    expect(todoOf(one, render(one).catalog, new Map(), 'de', true).text).toContain('Tone:\nTerse and exact');
  });

  test('formality is set by locale and language over every locale, and each is said in its own words', () => {
    const config = project({
      extends: 'friendly',
      tone: { formality: { fr: 'formal', 'pt-BR': 'formal', sv: 'formal', 'x-new': 'informal' } },
    });
    expect(config.tone.formality).toEqual({ '*': 'informal', fr: 'formal', 'pt-BR': 'formal', sv: 'formal', 'x-new': 'informal' });
    const guide = writingGuide(config);
    expect(guide).toContain('Except:\n\n- French (`fr`): Address the reader formally: vous, votre, vos, not tu, te, toi, ta, tes.');
    expect(guide).toContain('(`pt-BR`): Address the reader formally: o senhor, a senhora, not você.');
    expect(guide).toContain('(`sv`): the reader is addressed formally.');
    expect(guide).toContain('(`x-new`): Address the reader with the informal form of `you`, where the language has two.');
    const prompt = (locale: string) => todoOf(config, render(config).catalog, new Map(), locale, true).text;
    expect(prompt('fr-CA')).toContain('Address the reader formally: vous');
    expect(prompt('ja')).toContain('Address the reader informally: the plain forms, だ and る');
    expect(prompt('sv')).not.toContain('Address the reader');
    expect(() => project({ tone: { formality: { de: 'polite' as never } } })).toThrow(
      'tone.formality.de is "polite": write formal or informal',
    );
    expect(() => project({ tone: { formality: 'polite' as never } })).toThrow('tone.formality is "polite": write formal or informal');
  });

  test('the judge reads it in its notes, with its own prompt', async () => {
    const asked: JudgeRequest[] = [];
    const judge: Judge = {
      id: 'fake/judge',
      judge(request) {
        asked.push(request);
        const probabilities = Object.fromEntries(Object.keys(request.questions).map((q) => [q, 0.1]));
        return Promise.resolve({ probabilities, usage: { inputTokens: 1, outputTokens: 1 }, cost: 0 });
      },
    };
    const config = fixture(CATALOG, { extends: 'playful', judge: { models: [judge], prompt: 'A reading app.' } });
    await judgeCatalog(config, loadCatalog(config), readLock(config.lock));
    const notes = asked.map((r) => r.state['notes']);
    expect(notes).toContain(`A reading app. ${config.tone.doc!}`);
  });
});

const GERMAN = {
  'copy/catalog/app.yaml': `app.save:
  context: Saves the list.
  en: Save your list?

app.share:
  context: Shares the list.
  en: Share your list?

app.delete:
  context: Deletes the list.
  en: Delete your list?

app.zh:
  context: A greeting.
  en: Hello
`,
  'copy/locales/de/app.yaml': `app.save: Möchtest du deine Liste speichern?
app.share: Willst du deine Liste teilen?
app.delete: Möchten Sie Ihre Liste löschen?
`,
  'copy/locales/zh/app.yaml': 'app.zh: 您好，你好\n',
};

const formality = (config: ProsebookConfig = {}) => {
  const resolved = fixture(GERMAN, { ...config, lint: { rules: { 'voice/*': 'off' } } });
  return lint(loadCatalog(resolved).messages, resolved)
    .filter((f) => f.rule === 'formality')
    .map((f) => `${f.key} ${f.locale}: ${f.message}`);
};

describe('the formality rule', () => {
  test('without tone.formality, it finds the entries that leave the form most of the locale takes', () => {
    expect(formality()).toEqual([
      'app.delete de: "Sie" is the formal you, where most of the German copy is informal (2 entries): write du, dich, dir, dein',
      'app.delete de: "Ihre" is the formal you, where most of the German copy is informal (2 entries): write du, dich, dir, dein',
    ]);
  });

  test('with it, every entry of the other form, by locale; a Chinese character within a word', () => {
    expect(formality({ tone: { formality: { de: 'formal', zh: 'formal' } } })).toEqual([
      'app.save de: "du" is the informal you, where the German copy is formal (tone.formality): write Sie, Ihnen, Ihr',
      'app.save de: "deine" is the informal you, where the German copy is formal (tone.formality): write Sie, Ihnen, Ihr',
      'app.share de: "du" is the informal you, where the German copy is formal (tone.formality): write Sie, Ihnen, Ihr',
      'app.share de: "deine" is the informal you, where the German copy is formal (tone.formality): write Sie, Ihnen, Ihr',
      'app.zh zh: "你" is the informal you, where the Chinese copy is formal (tone.formality): write 您',
    ]);
  });

  test("a capitalized form is found past a sentence's start alone, where it may mean they", () => {
    const resolved = fixture(
      {
        'copy/catalog/app.yaml': 'app.they:\n  context: Says who shared it.\n  en: They shared it.\n',
        'copy/locales/de/app.yaml': 'app.they: Sie haben es geteilt.\n',
      },
      { tone: { formality: 'informal' } },
    );
    expect(lint(loadCatalog(resolved).messages, resolved).filter((f) => f.rule === 'formality')).toEqual([]);
  });
});
