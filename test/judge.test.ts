import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';

import type { Experimental_DecisionModel } from 'ai';
import { decisionJudge } from 'prosebook/ai';
import {
  definePlugin,
  generate,
  judgeCatalog,
  lint,
  loadCatalog,
  readLock,
  resolveConfig,
  serializeLock,
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
    { lint: { plugins: [HOUSE], rules: { 'voice/*': 'off' } }, judge: { model: judge }, ...options },
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
    });
    expect(judged(config).map((f) => [f.key, f.rule, f.severity])).toEqual([['form.reporter', 'house/labels', 'warn']]);
    expect(judged(config)[0]!.message).toContain('A label names the field, as a noun.');
    // 0.95 × 0.9, kept to two places, under a hash of what was asked.
    expect(readLock(config.lock).judged!['en']!['form.reporter']!['house/labels']).toMatch(/^[0-9a-f]{10}:0\.86$/);
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
    expect((await run(resolveConfig(config.root, { ...configOf(config), judge: { model: other } }))).stats.requests).toBe(2);
  });

  test('keeps the probability, so a new threshold needs no new run', async () => {
    const config = project(fakeJudge());
    await run(config);
    expect(judged(config)).toHaveLength(1);
    expect(judged(resolveConfig(config.root, { ...configOf(config), judge: { model: fakeJudge(), threshold: 0.9 } }))).toHaveLength(0);
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
    const config = project(flaky, { judge: { model: flaky, concurrency: 1 } });
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
    expect(() => resolveConfig('.', { judge: { model: {} as Judge } })).toThrow('judge.model is not a model');
    expect(() => resolveConfig('.', { judge: { model: fakeJudge(), threshold: 1.5 } })).toThrow('judge.threshold is 1.5');
  });

  test('the CLI: --check fails on an entry not judged, and lint reads the verdicts with no model', async () => {
    const config = fixture({
      'prosebook.config.ts': `import { definePlugin } from 'prosebook/config';
const house = definePlugin({ name: 'house', rules: { labels: { type: 'guideline', description: 'A label names the field, as a noun.' } } });
const model = { id: 'fake/cli', judge: async ({ questions }) => ({ probabilities: Object.fromEntries(Object.keys(questions).map((q) => [q, 0.9])) }) };
export default { lint: { plugins: [house], rules: { 'voice/*': 'off' } }, judge: { model } };
`,
      'copy/catalog/form.yaml':
        'form.reporter:\n  kind: name\n  surface: label\n  context: The label over who filed it.\n  en: Reported by\n',
    });
    const check = cli(config.root, 'judge', '--check');
    expect(check.code).toBe(1);
    expect(check.stderr).toContain('form.reporter (en): not judged on house/labels');
    const first = cli(config.root, 'judge');
    expect(first.stdout).toContain('judged 1 of 1 entries (2 questions)');
    expect(first.stdout).toContain('cost unknown');
    expect(first.stderr).toContain('[house/labels] breaks a guideline, the model judges');
    expect(cli(config.root, 'judge').stdout).toContain('nothing was asked');
    expect(cli(config.root, 'judge', '--check').code).toBe(0);
    expect(cli(config.root, 'lint').stderr).toContain('[house/labels]');
    expect(readFileSync(config.lock, 'utf8')).toContain('"judged"');
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
