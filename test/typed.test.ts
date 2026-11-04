import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { draftPlurals, formatDiff, generate, planExtract, readLock, singularOf, wordDiff } from 'prosebook/tools';

import { fixture } from './fixture.ts';

describe('stale translations show what changed', () => {
  test('a word diff marks what was removed and added', () => {
    const diff = (a: string, b: string) => formatDiff(wordDiff(a, b));
    expect(diff('Save', 'Save draft')).toBe('Save{+ draft+}');
    expect(diff('Save the draft', 'Save a draft')).toBe('Save [-the-]{+a+} draft');
    expect(diff('Open the file now', 'Close a folder now')).toBe('[-Open the file-]{+Close a folder+} now');
    expect(diff('{n, plural, one {# item} other {# items}}', '{n, plural, one {# file} other {# files}}')).toBe(
      '{n, plural, one {# [-item-]{+file+}} other {# [-items-]{+files+}}}',
    );
  });

  test('the lock keeps the text a translation was made from, and drops it once nothing needs it', () => {
    const config = fixture({ 'copy/catalog/app.yaml': 'app.a: Save\n', 'copy/locales/de/app.yaml': 'app.a: Speichern\n' }, { require: [] });
    generate(config);
    writeFileSync(join(config.catalog, 'app.yaml'), 'app.a: Save draft\n');
    expect(generate(config).stale.get('de')?.get('app.a')).toEqual({ was: 'Save', now: 'Save draft', translation: 'Speichern' });
    expect(Object.values(readLock(config.lock).sources)).toEqual(['Save']);

    writeFileSync(join(config.locales, 'de', 'app.yaml'), 'app.a: Entwurf speichern\n');
    generate(config);
    expect(Object.values(readLock(config.lock).sources)).toEqual(['Save draft']);
  });

  test('a version 1 lock still marks stale translations, without the earlier text', () => {
    const config = fixture(
      { 'copy/catalog/app.yaml': 'app.a: Save draft\n', 'copy/locales/de/app.yaml': 'app.a: Speichern\n' },
      { require: [] },
    );
    // Written by prosebook 0.1 when the source said "Save".
    writeFileSync(config.lock, JSON.stringify({ de: { 'app.a': 'd0b8a2d5b4:4ab7d2ad1e' } }));
    const stale = generate(config).stale.get('de')?.get('app.a');
    expect(stale?.was).toBeUndefined();
    expect(readLock(config.lock).version).toBe(2);
  });
});

describe('typed placeholders', () => {
  const COMPONENT = `import type { ReactNode } from 'react';

export function Inbox({ user, files, when, children }: { user: { name: string }; files: string[]; when: Date; children: ReactNode }) {
  const kept: number = files.length - 1;
  return (
    <div>
      <p>Hi {user.name}, you have {files.length} files.</p>
      <p>Kept {kept} of them.</p>
      <p>Last sync {when}.</p>
      <p>See {children} here.</p>
    </div>
  );
}
`;

  test('TypeScript says which placeholders are numbers and dates; markup is left alone', async () => {
    const config = fixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', noEmit: true },
      }),
      'src/Inbox.tsx': COMPONENT,
    });
    const plan = await planExtract(config, [join(config.root, 'src', 'Inbox.tsx')]);
    expect(plan.types).toBe('TypeScript');
    expect(plan.files[0]!.extractions.map((x) => x.message)).toEqual([
      'Hi {name}, you have {length, plural, one {# file} other {# files}}.',
      'Kept {kept, number} of them.',
      'Last sync {when, date, medium}.',
    ]);
    expect(plan.files[0]!.warnings).toEqual([
      'src/Inbox.tsx:10:10 {children} holds markup, not text, so this sentence was left as it is: make it a tag, or give the text around it entries of its own',
    ]);
  });

  test('a number made text in code is the number, which the message formats and counts', async () => {
    const config = fixture({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', noEmit: true },
      }),
      'src/Stats.tsx': [
        'export function Stats({ c, frameMs, when }: { c: number; frameMs: number; when: Date }) {',
        '  return (',
        '    <div>',
        '      <p>{c.toLocaleString()} nodes</p>',
        '      <p>Frame {frameMs.toFixed(2)} ms</p>',
        '      <p>Synced {when.toLocaleString()}</p>',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
    });
    const plan = await planExtract(config, [join(config.root, 'src', 'Stats.tsx')]);
    expect(plan.files[0]!.extractions.map((x) => `${x.message} ← ${x.replacement}`)).toEqual([
      '{c, plural, one {# node} other {# nodes}} ← <Text id="stats.nodes" values={{ c: c }} />',
      'Frame {frameMs, number, ::.00} ms ← <Text id="stats.frame-ms" values={{ frameMs: frameMs }} />',
      // A date's toLocaleString says its time too, which a date format would drop: left a string.
      'Synced {value} ← <Text id="stats.synced" values={{ value: when.toLocaleString() }} />',
    ]);
  });

  test('without TypeScript, the syntax still gives away a count', async () => {
    const config = fixture({
      'src/Inbox.jsx': COMPONENT.replace(/: \{[^)]*\}\)/, ')')
        .replace(': number', '')
        .replace(/^import type.*\n/, ''),
    });
    const plan = await planExtract(config, [join(config.root, 'src', 'Inbox.jsx')], { types: false });
    expect(plan.types).toBe('syntax');
    expect(plan.files[0]!.extractions.map((x) => x.message)).toEqual([
      'Hi {name}, you have {length, plural, one {# file} other {# files}}.',
      'Kept {kept} of them.',
      'Last sync {when}.',
      'See {children} here.',
    ]);
  });

  test('plurals are drafted only after a count followed by a plural noun', () => {
    expect(['files', 'boxes', 'categories', 'matches', 'days'].map(singularOf)).toEqual(['file', 'box', 'category', 'match', 'day']);
    expect(['is', 'was', 'class', 'news', 'people'].map(singularOf)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(draftPlurals('{n, number} of {m, number} items left')).toBe('{n, number} of {m, plural, one {# item} other {# items}} left');
  });
});
