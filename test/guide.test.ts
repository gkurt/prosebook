import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { definePlugin, generate, lint, loadCatalog, writingGuide } from 'prosebook/tools';

import { fixture } from './fixture.ts';

const CATALOG = { 'copy/catalog/app.yaml': 'app.title:\n  context: The title bar.\n  en: My app\n' };

const house = definePlugin({
  name: 'house',
  rules: {
    'what-next': { type: 'guideline', description: 'An error says what failed and what to do next.', on: { surface: ['error'] } },
    tone: { type: 'guideline', description: 'Talk to the reader as you would a colleague.' },
    quiet: { type: 'guideline', description: 'Turned off.', recommended: 'off' },
    toast: {
      type: 'occurrence',
      description: 'A toast is read in passing: 40 characters at most.',
      on: { surface: ['toast'], area: ['cart'] },
      count: 'characters',
      max: 40,
      recommended: 'warn',
      guide: true,
    },
    hush: { type: 'existence', description: 'Checked, and not said.', words: ['hush'], message: 'no', recommended: 'warn' },
  },
});

describe('the writing guide', () => {
  test('generate writes it beside the catalog, and --check fails on one the config has moved past', () => {
    const config = fixture(CATALOG);
    const path = join(config.catalog, 'WRITING.md');
    expect(config.guide).toBe(path);
    generate(config);
    expect(readFileSync(path, 'utf8')).toBe(writingGuide(config));
    expect(generate(config, { check: true }).changed).toEqual([]);
    writeFileSync(path, 'Hand-written.\n');
    expect(generate(config, { check: true }).changed).toEqual([path]);
  });

  test('it goes where guide says, or nowhere with false', () => {
    const elsewhere = fixture(CATALOG, { guide: 'docs/copy.md' });
    generate(elsewhere);
    expect(existsSync(join(elsewhere.root, 'docs/copy.md'))).toBe(true);
    const none = fixture(CATALOG, { guide: false });
    generate(none);
    expect(existsSync(join(none.catalog, 'WRITING.md'))).toBe(false);
  });

  test('it says what each kind and surface is for, and leaves what the lint checks to the lint', () => {
    const guide = writingGuide(fixture({}, { lint: { extends: 'strict', concepts: { tablet: 'device' } } }));
    expect(guide).toContain('- `name`: Identifies a thing');
    expect(guide).toContain('- `error`: Says what failed.');
    expect(guide).toContain('An entry holds the message under `en`, in ICU MessageFormat, a `context` sentence');
    expect(guide).not.toContain('seamless');
    expect(guide).not.toContain('tablet');
    expect(guide).not.toContain('## Guidelines');
    expect(writingGuide(fixture({}, { messageFormat: 2 }))).toContain('in MessageFormat 2');
  });

  test('it says the guidelines, and the checked rules marked guide, with what they read', () => {
    const guide = writingGuide(fixture({}, { lint: { plugins: [house], areas: { native: { 'house/tone': 'off' } } } }));
    expect(guide).toContain('- On `error`: An error says what failed and what to do next.');
    expect(guide).toContain('- Not in `native.*`: Talk to the reader as you would a colleague.');
    expect(guide).toContain('- On `toast`, in `cart.*`: A toast is read in passing: 40 characters at most.');
    expect(guide).not.toContain('Turned off.');
    expect(guide).not.toContain('Checked, and not said.');
  });

  test('a guideline finds nothing in the lint', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.failed:\n  context: Saving failed.\n  surface: error\n  en: It failed.\n' },
      { lint: { plugins: [house] } },
    );
    expect(lint(loadCatalog(config).messages, config).filter((f) => f.rule.startsWith('house/'))).toEqual([]);
  });
});
