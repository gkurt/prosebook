import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';

import type { Experimental_DecisionModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { decisionJudge, languageJudge } from 'prosebook/ai';
import {
  approve,
  AUTHOR,
  definePlugin,
  generate,
  askedOf,
  judgeCatalog,
  lint,
  loadCatalog,
  modelsAsked,
  readLock,
  resolveConfig,
  scannedMessages,
  serializeLock,
  unanswered,
  verdictsOf,
  writingGuide,
  type Judge,
  type JudgeRequest,
  type ProsebookConfig,
  type ResolvedConfig,
} from 'prosebook/tools';

import { cli, fixture } from './fixture.ts';

const HOUSE = definePlugin({
  name: 'house',
  rules: {
    labels: { type: 'guideline', description: 'A label names the field, as a noun.', on: { surface: ['label'] } },
    plain: { type: 'guideline', description: 'Say what happens, not what a thing wants.' },
  },
});

const CATALOG = `form.reporter:
  kind: name
  surface: label
  context: The label over the person who filed an issue.
  en: Reported by

form.save:
  kind: action
  surface: action
  context: Saves the form.
  en: Save
`;

/**
 * A judge that finds a label not written as a noun ("Reported by") and nothing else, and records
 * what it was asked. `concerns` and `breaks` are the two questions each guideline is asked as.
 */
function fakeJudge(id = 'fake/judge'): Judge & { asked: JudgeRequest[] } {
  const asked: JudgeRequest[] = [];
  return {
    id,
    asked,
    judge(request) {
      asked.push(request);
      const probabilities: Record<string, number> = {};
      for (const [qid, question] of Object.entries(request.questions)) {
        const labels = question.instructions.includes('as a noun');
        const broken = labels && request.state['message'] === 'Reported by';
        probabilities[qid] = qid.startsWith('concerns') ? (labels ? 0.95 : 0.9) : broken ? 0.9 : 0.1;
      }
      return Promise.resolve({ probabilities, usage: { inputTokens: 100, outputTokens: 10 }, cost: 0.001 });
    },
  };
}

const project = (judge: Judge, options: ProsebookConfig = {}) =>
  fixture(
    { 'copy/catalog/form.yaml': CATALOG },
    { lint: { plugins: [HOUSE], rules: { 'voice/*': 'off' } }, judge: { models: [judge] }, ...options },
  );

async function run(config: ResolvedConfig) {
  const catalog = loadCatalog(config);
  const lock = readLock(config.lock);
  const result = await judgeCatalog(config, catalog, lock);
  writeFileSync(config.lock, serializeLock({ ...lock, judged: result.verdicts }));
  return result;
}

const judged = (config: ResolvedConfig) => {
  const { messages } = loadCatalog(config);
  return lint(messages, config, messages, verdictsOf(config, messages, readLock(config.lock))).filter((f) => f.rule.startsWith('house/'));
};

describe('judge', () => {
  test('a model set ask: false is not asked, and its answers in the lock still count, first as listed', async () => {
    const jev = fakeJudge('fake/jev');
    /** Trusted first, and finds nothing broken. */
    const lenient: Judge = {
      id: 'fake/lenient',
      judge: ({ questions }) => Promise.resolve({ probabilities: Object.fromEntries(Object.keys(questions).map((id) => [id, 0.1])) }),
    };
    const unasked = project(jev, { judge: { models: [{ ...lenient, ask: false }, jev] } });
    await run(unasked);
    expect(jev.asked).toHaveLength(2);
    // Jev decides where the model trusted first gave no answer: the guideline is broken.
    expect(judged(unasked).map((f) => [f.key, f.rule])).toEqual([['form.reporter', 'house/labels']]);
    const { messages } = loadCatalog(unasked);
    const judge = unasked.judge!;
    expect(modelsAsked(judge).map((m) => m.id)).toEqual(['fake/jev']);
    expect(unanswered(askedOf(unasked, judge, messages), readLock(unasked.lock).judged, modelsAsked(judge))).toEqual([]);
    // Asked where its key is: its answers decide, on every machine, whether it can ask the model or not.
    const asked = resolveConfig(unasked.root, { ...configOf(unasked), judge: { models: [lenient, jev] } });
    await run(asked);
    expect(judged(asked)).toEqual([]);
    expect(judged(unasked)).toEqual([]);
  });

  test('the same words in two roles keep an answer each, so the next run asks nothing', async () => {
    const judge = fakeJudge();
    const config = resolveConfig(fixture({}).root, { lint: { plugins: [HOUSE], rules: { 'voice/*': 'off' } }, judge: { models: [judge] } });
    const at = (where: string, line: number) => ({ file: 'a.md', line, column: 1, text: 'Reported by', where, via: 'doc' as const });
    const messages = scannedMessages(config, [at('heading', 1), at('paragraph', 3)]);
    expect(messages.map((m) => m.key)).toEqual(['Reported by', 'Reported by']);
    const first = await judgeCatalog(config, { messages, problems: [] }, readLock(config.lock));
    expect(first.stats.requests).toBe(2);
    expect(first.verdicts['en']!['Reported by']!['house/plain']!['fake/judge']!.split(' ')).toHaveLength(2);
    const second = await judgeCatalog(config, { messages, problems: [] }, { ...readLock(config.lock), judged: first.verdicts });
    expect(second.stats.requests).toBe(0);
    expect(second.verdicts).toEqual(first.verdicts);
  });

  test('only asks of the entries it names, as judge <paths> does, and a later run asks of the rest', async () => {
    const judge = fakeJudge();
    const config = project(judge);
    const catalog = loadCatalog(config);
    const first = await judgeCatalog(config, catalog, readLock(config.lock), { only: (m) => m.key === 'form.save' });
    expect(judge.asked.map((r) => r.state['key'])).toEqual(['form.save']);
    expect(first.stats).toMatchObject({ entries: 1, requests: 1 });
    writeFileSync(config.lock, serializeLock({ ...readLock(config.lock), judged: first.verdicts }));
    await run(config);
    expect(judge.asked.map((r) => r.state['key'])).toEqual(['form.save', 'form.reporter']);
  });

  test('asks once per entry, two questions per guideline, and lint finds what it judged broken', async () => {
    const judge = fakeJudge();
    const config = project(judge);
    const { stats, failures } = await run(config);
    expect(failures).toEqual([]);
    // form.reporter is held to both guidelines, form.save to `plain` alone: labels are on labels only.
    expect(judge.asked.map((r) => Object.keys(r.questions).length).toSorted((a, b) => a - b)).toEqual([2, 4]);
    expect(stats).toMatchObject({ entries: 2, cached: 0, requests: 2, questions: 6, inputTokens: 200, outputTokens: 20, unpriced: 0 });
    expect(stats.cost).toBeCloseTo(0.002);
    const reporter = judge.asked.find((r) => r.state['key'] === 'form.reporter')!;
    expect(reporter.state).toMatchObject({
      message: 'Reported by',
      language: 'English',
      context: 'The label over the person who filed an issue.',
      kind: { name: 'name' },
      surface: { name: 'label' },
      // Each guideline is weighed with the others the entry is held to.
      guidelines: ['A label names the field, as a noun.', 'Say what happens, not what a thing wants.'],
    });
    expect(judged(config).map((f) => [f.key, f.rule, f.severity])).toEqual([['form.reporter', 'house/labels', 'warn']]);
    expect(judged(config)[0]!.message).toContain('A label names the field, as a noun.');
    // 0.95 × 0.9, kept to two places, under a hash of what was asked.
    expect(readLock(config.lock).judged!['en']!['form.reporter']!['house/labels']!['fake/judge']).toMatch(/^[0-9a-f]{10}:0\.86$/);
  });

  test('the prompt goes to the models as notes, and asks again of every entry', async () => {
    const judge = fakeJudge();
    const config = project(judge);
    await run(config);
    judge.asked.length = 0;
    const noted = resolveConfig(config.root, { ...configOf(config), judge: { models: [judge], prompt: 'An app for on-call engineers.' } });
    expect((await run(noted)).stats.requests).toBe(2);
    expect(judge.asked[0]!.state['notes']).toBe('An app for on-call engineers.');
    expect(Object.values(judge.asked[0]!.questions)[0]!.instructions).toContain('`notes`');
  });

  test('several models: each answers once, and the first listed that answered decides', async () => {
    const lenient: Judge = {
      id: 'fake/lenient',
      judge: ({ questions }) => Promise.resolve({ probabilities: Object.fromEntries(Object.keys(questions).map((q) => [q, 0.5])) }),
    };
    const judge = fakeJudge();
    const config = project(judge);
    await run(config);
    judge.asked.length = 0;
    const both = resolveConfig(config.root, { ...configOf(config), judge: { models: [judge, lenient] } });
    // Only the new model is asked; the first's answers stay.
    expect((await run(both)).stats.requests).toBe(2);
    expect(judge.asked).toEqual([]);
    // form.reporter: the first model's 0.86 decides, whatever the second's 0.25.
    expect(judged(both).map((f) => [f.key, f.rule])).toEqual([['form.reporter', 'house/labels']]);
    expect(judged(resolveConfig(config.root, { ...configOf(config), judge: { models: [lenient, judge] } }))).toEqual([]);
  });

  test('the author approves an entry as written: it passes, is not asked of, and is judged again once it changes', async () => {
    const judge = fakeJudge();
    const config = project(judge);
    await run(config);
    const lock = readLock(config.lock);
    const { messages } = loadCatalog(config);
    const result = approve(config, messages, lock.judged, ['form.reporter', 'form.nope']);
    expect(result.approved).toEqual([{ key: 'form.reporter', rules: ['house/labels', 'house/plain'] }]);
    expect(result.problems).toEqual([expect.stringContaining('form.nope (en) is no entry')]);
    writeFileSync(config.lock, serializeLock({ ...lock, judged: result.verdicts }));
    expect(judged(config)).toEqual([]);
    expect(readLock(config.lock).judged!['en']!['form.reporter']!['house/labels']![AUTHOR]).toMatch(/^[0-9a-f]{10}:0$/);
    // A new model leaves the approval: it is of the words, not of what a model was told.
    const other = fakeJudge('fake/other');
    const swapped = resolveConfig(config.root, { ...configOf(config), judge: { models: [other] } });
    await run(swapped);
    expect(other.asked.map((r) => r.state['key'])).toEqual(['form.save']);
    expect(judged(swapped)).toEqual([]);
    // Words changed: the approval no longer holds, and the model is asked again.
    writeFileSync(`${config.catalog}/form.yaml`, CATALOG.replace('context: The label over', 'context: The label above'));
    judge.asked.length = 0;
    await run(config);
    // form.save too: the run with the other model kept only its own answers.
    expect(new Set(judge.asked.map((r) => r.state['key']))).toEqual(new Set(['form.reporter', 'form.save']));
    expect(judged(config)).toHaveLength(1);
  });

  test('approve names only guidelines the entry is held to', async () => {
    const config = project(fakeJudge());
    const { messages } = loadCatalog(config);
    const result = approve(config, messages, undefined, ['form.save'], { rules: ['house/labels'] });
    expect(result.problems).toEqual(['form.save (en) is not held to house/labels: name one of house/plain']);
  });

  test('asks again only of what changed: an entry, or the model', async () => {
    const judge = fakeJudge();
    const config = project(judge);
    await run(config);
    judge.asked.length = 0;
    expect((await run(config)).stats).toMatchObject({ requests: 0, cached: 2 });
    writeFileSync(`${config.catalog}/form.yaml`, CATALOG.replace('en: Save', 'en: Save changes'));
    const again = await run(config);
    expect(again.stats).toMatchObject({ requests: 1, cached: 1 });
    expect(judge.asked.map((r) => r.state['key'])).toEqual(['form.save']);
    const other = fakeJudge('fake/other');
    expect((await run(resolveConfig(config.root, { ...configOf(config), judge: { models: [other] } }))).stats.requests).toBe(2);
  });

  test('keeps the probability, so a new threshold needs no new run', async () => {
    const config = project(fakeJudge());
    await run(config);
    expect(judged(config)).toHaveLength(1);
    expect(judged(resolveConfig(config.root, { ...configOf(config), judge: { models: [fakeJudge()], threshold: 0.9 } }))).toHaveLength(0);
  });

  test("an exemption hides the finding, and is stale only once a verdict says it isn't needed", async () => {
    const judge = fakeJudge();
    const config = project(judge);
    writeFileSync(
      `${config.catalog}/form.yaml`,
      CATALOG.replace('  en: Save\n', '  allow:\n    house/plain: The button is one word.\n  en: Save\n').replace(
        '  en: Reported by\n',
        '  allow:\n    house/labels: Says who, as the panel beside it does.\n  en: Reported by\n',
      ),
    );
    const allowFindings = () => {
      const { messages } = loadCatalog(config);
      return lint(messages, config, messages, verdictsOf(config, messages, readLock(config.lock)))
        .filter((f) => f.rule === 'allow')
        .map((f) => f.key);
    };
    // Not judged yet: neither exemption can be called stale.
    expect(allowFindings()).toEqual([]);
    await run(config);
    expect(judged(config)).toEqual([]);
    // Judged: form.reporter's is still needed, form.save's isn't.
    expect(allowFindings()).toEqual(['form.save']);
  });

  test('stops at the first failure, and keeps what was answered', async () => {
    let calls = 0;
    const flaky: Judge = {
      id: 'fake/flaky',
      judge: (request) => (calls++ === 0 ? fakeJudge().judge(request) : Promise.reject(new Error('rate limited'))),
    };
    const config = project(flaky, { judge: { models: [flaky], concurrency: 1 } });
    const { failures, stats, verdicts } = await run(config);
    expect(failures.map((f) => String(f.error))).toEqual(['Error: rate limited']);
    expect(stats.requests).toBe(1);
    expect(Object.keys(verdicts['en']!)).toHaveLength(1);
  });

  test('the writing guide says to run judge where the config has one', () => {
    const config = project(fakeJudge());
    expect(writingGuide(config)).toContain('Then run `prosebook judge`');
    expect(writingGuide(resolveConfig(config.root, configOf(config)))).not.toContain('prosebook judge');
  });

  test('generate keeps the verdicts in the lock', async () => {
    const config = project(fakeJudge());
    await run(config);
    const before = readLock(config.lock).judged;
    generate(config);
    expect(readLock(config.lock).judged).toEqual(before);
  });

  test('a config with a judge that is not a model, or a threshold past 1, says so', () => {
    expect(() => resolveConfig('.', { judge: { models: [{} as Judge] } })).toThrow('judge.models[0] is not a model');
    expect(() => resolveConfig('.', { judge: { models: [fakeJudge()], threshold: 1.5 } })).toThrow('judge.threshold is 1.5');
  });

  test('the CLI: --check fails on an entry not judged, and lint reads the verdicts with no model', async () => {
    const config = fixture({
      'prosebook.config.ts': `import { definePlugin } from 'prosebook/config';
const house = definePlugin({ name: 'house', rules: {
  labels: { type: 'guideline', description: 'A label names the field, as a noun.' },
  short: { type: 'guideline', description: 'A label is short.' },
} });
const model = { id: 'fake/cli', judge: async ({ questions }) => ({ probabilities: Object.fromEntries(Object.keys(questions).map((q) => [q, 0.9])) }) };
export default { lint: { plugins: [house], rules: { 'voice/*': 'off' } }, judge: { models: [model] } };
`,
      'copy/catalog/form.yaml':
        'form.reporter:\n  kind: name\n  surface: label\n  context: The label over who filed it.\n  en: Reported by\n',
    });
    const check = cli(config.root, 'judge', '--check');
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('form.reporter (en): not judged on house/labels, house/short');
    const first = cli(config.root, 'judge');
    expect(first.stdout).toContain('judged 1 of 1 entries (1 requests, 4 questions)');
    expect(first.stdout).toContain('cost unknown');
    // One line for the entry, and each guideline's words once, after the findings.
    expect(first.stderr).toContain('form.reporter: [house/labels, house/short] breaks these guidelines, the models judge\n');
    expect(first.stderr).toContain(
      '\nGuidelines:\n  house/labels: A label names the field, as a noun.\n  house/short: A label is short.\n',
    );
    expect(first.stderr.match(/A label names the field/g)).toHaveLength(1);
    // Each entry's verdicts stand on one line of the lock.
    expect(readFileSync(config.lock, 'utf8')).toMatch(
      /\n {6}"form\.reporter": \{"house\/labels":\{"fake\/cli":"\w+:0.81"\},"house\/short":\{[^\n]*\}\}\n/,
    );
    expect(readLock(config.lock).judged!['en']!['form.reporter']!['house/short']!['fake/cli']).toMatch(/:0.81$/);
    expect(first.stderr).toContain('prosebook approve <key>');
    expect(cli(config.root, 'judge').stdout).toContain('nothing was asked');
    expect(cli(config.root, 'judge', '--check').code).toBe(0);
    expect(cli(config.root, 'lint').stderr).toContain('[house/labels, house/short]');
    expect(readFileSync(config.lock, 'utf8')).toContain('"judged"');
    const approved = cli(config.root, 'approve', '--all');
    expect(approved.stdout).toContain('approved form.reporter (en) against house/labels');
    expect(cli(config.root, 'lint').stderr).not.toContain('house/labels');
    expect(cli(config.root, 'approve', '--all').stderr).toContain('none needs approving');
  });

  test('the CLI: a run failing before any answer says why, and not that the lock had it all', () => {
    const config = fixture({
      'prosebook.config.ts': `import { definePlugin } from 'prosebook/config';
const house = definePlugin({ name: 'house', rules: { short: { type: 'guideline', description: 'A label is short.' } } });
const model = { id: 'fake/broke', judge: async () => { throw new Error('no credits'); } };
export default { lint: { plugins: [house], rules: { 'voice/*': 'off' } }, judge: { models: [model] } };
`,
      'copy/catalog/form.yaml': 'form.title:\n  context: The form title.\n  en: Report\n',
    });
    const run = cli(config.root, 'judge');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('fake/broke failed, so the run stopped there: no credits');
    expect(run.stdout).not.toContain('nothing was asked');
  });
});

type DecisionModelV4 = Extract<Experimental_DecisionModel, { doDecide: unknown }>;
type CallOptions = Parameters<DecisionModelV4['doDecide']>[0];

describe('decisionJudge', () => {
  /** A decision model answering each boolean question with 0.8, as the AI SDK's contract has it. */
  const model = (calls: CallOptions[]): DecisionModelV4 => ({
    specificationVersion: 'v4',
    provider: 'test',
    modelId: 'decider',
    supportedQuestionTypes: ['boolean'],
    doDecide(options) {
      calls.push(options);
      const answers = Object.fromEntries(Object.keys(options.questions).map((id) => [id, { type: 'boolean' as const, probability: 0.8 }]));
      return Promise.resolve({ answers, usage: { inputTokens: 2_000_000, outputTokens: 50 }, warnings: [] });
    },
  });

  test('asks the questions as boolean ones, and prices the tokens', async () => {
    const calls: CallOptions[] = [];
    const judge = decisionJudge(model(calls), { price: { input: 0.042 } });
    expect(judge.id).toBe('test/decider');
    const response = await judge.judge({
      state: { message: 'Reported by' },
      questions: { q: { instructions: 'Is it a noun?', criteria: { true: 'It is.', false: 'It is not.' } } },
    });
    expect(response).toEqual({ probabilities: { q: 0.8 }, usage: { inputTokens: 2_000_000, outputTokens: 50 }, cost: 0.084 });
    expect(calls[0]!.questions['q']).toEqual({
      type: 'boolean',
      instructions: 'Is it a noun?',
      criteria: { true: 'It is.', false: 'It is not.' },
    });
    expect(calls[0]!.state).toEqual([{ type: 'json', value: { message: 'Reported by' } }]);
  });

  test('without a price, the cost is unknown', async () => {
    const response = await decisionJudge(model([])).judge({
      state: {},
      questions: { q: { instructions: 'Yes?', criteria: { true: 'Y', false: 'N' } } },
    });
    expect(response.cost).toBeUndefined();
  });
});

/** The parts of a resolved config a test builds another from. */
function configOf(config: ResolvedConfig): ProsebookConfig {
  return { lint: { plugins: [HOUSE], rules: { 'voice/*': 'off' } }, catalog: config.catalog, lock: config.lock };
}

describe('suggestions', () => {
  const GREETING = `home.greeting:
  kind: description
  context: Greets the shopper on the home page.
  args:
    name: The shopper's first name.
  en: The shop wants to welcome you, {name}.
`;
  /** A judge finding every entry breaking `house/plain`, suggesting each rewrite in turn. */
  const suggesting = (...rewrites: string[]): Judge => ({
    id: 'fake/writer',
    judge(request) {
      const probabilities = Object.fromEntries(Object.keys(request.questions).map((id) => [id, 0.95]));
      const suggestion = rewrites.shift();
      return Promise.resolve({ probabilities, ...(suggestion !== undefined && { suggestion }) });
    },
  });
  const project = (judge: Judge) =>
    fixture(
      { 'copy/catalog/home.yaml': GREETING },
      { lint: { plugins: [HOUSE], rules: { 'voice/*': 'off' } }, judge: { models: [judge] } },
    );

  test('one keeping the placeholders is kept, and lint offers it as an unsafe fix of the whole text', async () => {
    const config = project(suggesting('Welcome, {name}.'));
    const catalog = loadCatalog(config);
    const run = await judgeCatalog(config, catalog, readLock(config.lock));
    expect(run.stats.suggestions).toBe(1);
    expect(run.suggestions['en']!['home.greeting']!['fake/writer']).toEqual([expect.stringMatching(/^[0-9a-f]{10}:Welcome, \{name\}\.$/)]);
    const lock = { ...readLock(config.lock), judged: run.verdicts, suggested: run.suggestions };
    const [finding] = lint(catalog.messages, config, catalog.messages, verdictsOf(config, catalog.messages, lock)).filter(
      (f) => f.rule === 'house/plain',
    );
    expect(finding).toMatchObject({ suggestion: 'Welcome, {name}.', unsafe: true });
    expect(finding!.fix).toEqual([{ start: 0, end: 'The shop wants to welcome you, {name}.'.length, text: 'Welcome, {name}.' }]);
    // A later run that asks nothing keeps it, while the entry reads as it did.
    const again = await judgeCatalog(config, catalog, lock);
    expect(again.stats.requests).toBe(0);
    expect(again.suggestions).toEqual(run.suggestions);
  });

  test('one dropping or changing a placeholder, or not parsing, is left out', async () => {
    for (const bad of ['Welcome!', 'Welcome, {who}.', 'Welcome, {name, number}.', 'Welcome, {name']) {
      const config = project(suggesting(bad));
      const run = await judgeCatalog(config, loadCatalog(config), readLock(config.lock));
      expect([bad, run.stats.suggestions, run.suggestions]).toEqual([bad, 0, {}]);
    }
  });

  test('the CLI: lint shows it, --fix leaves it, --fix --unsafe writes it', () => {
    const config = fixture({
      'prosebook.config.ts': `import { definePlugin } from 'prosebook/config';
const house = definePlugin({ name: 'house', rules: { plain: { type: 'guideline', description: 'Say what happens, not what a thing wants.' } } });
const model = {
  id: 'fake/cli',
  judge: async ({ questions }) => ({
    probabilities: Object.fromEntries(Object.keys(questions).map((q) => [q, 0.95])),
    suggestion: 'Welcome, {name}.',
  }),
};
export default { lint: { plugins: [house], rules: { 'voice/*': 'off' } }, judge: { models: [model] } };
`,
      'copy/catalog/home.yaml': GREETING,
    });
    expect(cli(config.root, 'judge').stdout).toContain('1 rewrite(s) suggested');
    const shown = cli(config.root, 'lint');
    expect(shown.stderr).toContain(
      'home.greeting: [house/plain] breaks this guideline, the models judge\n      suggested: "Welcome, {name}."',
    );
    expect(shown.stderr).toContain("1 entry has a judge's rewrite: read it, then write it with prosebook lint --fix --unsafe.");
    cli(config.root, 'lint', '--fix');
    expect(readFileSync(`${config.root}/copy/catalog/home.yaml`, 'utf8')).toContain('The shop wants to welcome you, {name}.');
    cli(config.root, 'lint', '--fix', '--unsafe');
    expect(readFileSync(`${config.root}/copy/catalog/home.yaml`, 'utf8')).toContain('en: Welcome, {name}.');
  });

  test('text in a doc: shown with its code spans as written, and not fixed', () => {
    const config = fixture({
      'prosebook.config.ts': `import { definePlugin } from 'prosebook/config';
const house = definePlugin({ name: 'house', rules: { plain: { type: 'guideline', description: 'Say what happens, not what a thing wants.' } } });
const model = {
  id: 'fake/docs',
  judge: async ({ questions }) => ({
    probabilities: Object.fromEntries(Object.keys(questions).map((q) => [q, 0.95])),
    suggestion: 'Run {code} to build it.',
  }),
};
export default { catalog: false, lint: { plugins: [house], rules: { 'voice/*': 'off' } }, judge: { models: [model] } };
`,
      'README.md': '# Readme\n\nThe build wants you to run `bun run build` first.\n',
    });
    cli(config.root, 'judge', '--docs', 'README.md');
    const shown = cli(config.root, 'lint', '--docs', 'README.md');
    expect(shown.stderr).toContain('suggested: "Run `bun run build` to build it."');
  });
});

describe('languageJudge', () => {
  const usage = (input: number, output: number) => ({
    inputTokens: { total: input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: undefined, reasoning: undefined },
  });
  const question = { instructions: 'Is it plain?', criteria: { true: 'It is.', false: 'It is not.' } };

  test('asks for every answer and the rewrite through structured output, and reads them back', async () => {
    const model = new MockLanguageModelV4({
      provider: 'test',
      modelId: 'writer',
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ answers: { q: 1.2, r: 0.1 }, suggestion: 'Welcome, {name}.' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: usage(1_000_000, 1_000_000),
        warnings: [],
      },
    });
    const judge = languageJudge(model, { price: { input: 0.1, output: 0.5 } });
    expect(judge.id).toBe('test/writer');
    const response = await judge.judge({
      state: { message: 'The shop wants to welcome you, {name}.' },
      questions: { q: question, r: question },
    });
    // 1.2 is read as 1: a model writes a number, not a probability.
    expect(response).toEqual({
      probabilities: { q: 1, r: 0.1 },
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      cost: 0.6,
      suggestion: 'Welcome, {name}.',
    });
    const [call] = model.doGenerateCalls;
    expect(call!.responseFormat).toMatchObject({ type: 'json', schema: { required: ['answers', 'suggestion'] } });
    expect(JSON.stringify(call!.prompt)).toContain('Is it plain?');
  });

  test('without suggest, asks for the answers alone', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ answers: { q: 0.2 } }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: usage(10, 5),
        warnings: [],
      },
    });
    const response = await languageJudge(model, { suggest: false }).judge({ state: { message: 'Save' }, questions: { q: question } });
    expect(response.suggestion).toBeUndefined();
    expect(model.doGenerateCalls[0]!.responseFormat).toMatchObject({ schema: { required: ['answers'] } });
  });
});
