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
    expect(config.tone.formality).toBe('informal');
    expect(config.tone.doc).toStartWith('Calm, exact and brief');
    expect(config.lint.banned).toEqual([{ words: ['synergy'], why: 'is jargon' }]);
    expect(config.lint.rules['contractions']?.severity).toBe('off');
    expect(resolveConfig('.', { extends: [house], tone: { formality: 'formal' } }).tone.formality).toBe('formal');
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
    expect(guide).toContain('errors stay straightforward. We sell to bakeries.');
    expect(guide).toContain('Translations address the reader with the informal form of `you`, where a language has two (du, tu, tú).');
    expect(guide).toContain(
      '- `state` on `error`: "We couldn\'t save your list. Check your connection, then try again.", not "Oops! Something went wrong."',
    );
    expect(guide).toContain('In `legal.*`, plain: Plain and neutral,');
    expect(guide).toContain('Translations address the reader with the formal form of `you`, where a language has two (Sie, vous, usted).');
    expect(guide).toContain('- In `legal.*`: No idioms or figures of speech');
    expect(writingGuide(project({}))).not.toContain('## Tone');
  });

  test("a translation prompt says each entry's tone and the form of you it takes", () => {
    const config = project({ extends: 'friendly', tone: { areas: { legal: 'plain' } } });
    const prompt = todoOf(config, render(config).catalog, new Map(), 'de', true).text;
    expect(prompt).toContain('Tone, by entry:\n- app.failed: Warm and direct');
    expect(prompt).toContain('Address the reader with the informal form of `you`');
    expect(prompt).toContain('- legal.failed: Plain and neutral');
    expect(prompt).toContain('Address the reader with the formal form of `you`');
    const one = project({ extends: 'technical' });
    expect(todoOf(one, render(one).catalog, new Map(), 'de', true).text).toContain('Tone:\nTerse and exact');
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
