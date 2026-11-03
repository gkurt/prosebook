import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { definePlugin, generate, writingGuide } from 'prosebook/tools';

import { fixture } from './fixture.ts';

const CATALOG = { 'copy/catalog/app.yaml': 'app.title:\n  context: The title bar.\n  en: My app\n' };

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

  test('it says only the rules the config turns on', () => {
    const recommended = writingGuide(fixture({}));
    expect(recommended).toContain('- `name`: Identifies a thing');
    expect(recommended).toContain('Held to: at most 4 words; no period at the end; no explanation after a dash or a colon.');
    expect(recommended).not.toContain('sentence case');
    expect(recommended).not.toContain('contractions');
    expect(recommended).not.toContain('`seamless`');

    const strict = writingGuide(fixture({}, { lint: { extends: 'strict', properNouns: ['Shop'] } }));
    expect(strict).toContain('sentence case');
    expect(strict).toContain('In sentence case, these keep their capitals: `Shop`.');
    expect(strict).toContain('`seamless`, `seamlessly`');
    expect(strict).toContain('color (not colour)');
    expect(strict).toContain('at most 1 sentence (2 sentences on error, empty, hint and status)');

    const off = writingGuide(fixture({}, { lint: { extends: 'strict', rules: { 'banned-word': 'off' } } }));
    expect(off).not.toContain('`seamless`');
  });

  test('it says the house rules with what they read, the words and the areas', () => {
    const house = definePlugin({
      name: 'house',
      rules: {
        toast: {
          type: 'occurrence',
          description: 'A toast is read in passing.',
          on: { surface: ['toast'], area: ['cart'] },
          count: 'characters',
          max: 40,
          recommended: 'warn',
        },
        quiet: { type: 'existence', description: 'Never said.', words: ['hush'], message: 'no' },
      },
    });
    const guide = writingGuide(
      fixture(
        {},
        { lint: { plugins: [house], concepts: { tablet: 'device', phone: 'device' }, areas: { native: { 'no-period': 'off' } } } },
      ),
    );
    expect(guide).toContain('- On `toast`, in `cart.*`: A toast is read in passing.');
    expect(guide).not.toContain('Never said.');
    expect(guide).toContain('- `device`, never `tablet` or `phone`.');
    expect(guide).toContain('- `native.*`: `no-period` is off.');
  });

  test('its examples are in the syntax the catalog is written in', () => {
    expect(writingGuide(fixture({}))).toContain('{count, plural, one {# file} other {# files}}');
    const mf2 = writingGuide(fixture({}, { messageFormat: 2 }));
    expect(mf2).toContain('in MessageFormat 2');
    expect(mf2).toContain('.match $count');
    expect(mf2).toContain('{$price :currency currency=EUR}');
  });
});
