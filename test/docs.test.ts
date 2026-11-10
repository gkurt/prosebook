import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { docFiles, docMessageOf, docsOf, proseIn, proseOf, readLock, resolveConfig, type ProsebookConfig } from 'prosebook/tools';

import { cli, fixture } from './fixture.ts';

/** A rule that finds "click here", as a JSON config would carry it, and the guidelines off. */
const LINT: ProsebookConfig['lint'] = {
  plugins: [
    {
      name: 'house',
      rules: {
        'no-click-here': {
          type: 'existence',
          description: 'A link says where it goes.',
          words: ['click here'],
          message: '"{match}" hides where the link goes: name the destination',
          recommended: 'error',
        },
      },
    },
  ],
  rules: { 'voice/*': 'off' },
};

const CONFIG = (catalog: string, docs: string[]) =>
  `export default { catalog: ${catalog}, docs: ${JSON.stringify(docs)}, lint: ${JSON.stringify(LINT)} };\n`;

const GUIDE = `---
title: Guide
---

# Getting started

Install it, then [click here](https://example.com) for the \`init\` command.

\`\`\`sh
click here to run nothing: this is code
\`\`\`

- Each item is **its own** entry.
- A second item
  runs on to a second line.
  1. A nested item.

> [!NOTE]
> Click here to read the note.

| Option | What it does |
| ------ | ------------ |
| \`root\` | Names the config's folder. |

<p align="center"><img src="x.png"></p>

Setext heading
--------------
`;

describe("a doc's prose", () => {
  test('each heading, paragraph, item, cell and quote is a piece, where its words start', () => {
    const found = proseIn('docs/guide.md', GUIDE).map(({ line, column, where, text }) => [line, column, where, text]);
    expect(found).toEqual([
      [5, 3, 'heading', 'Getting started'],
      [7, 1, 'paragraph', 'Install it, then click here for the `init` command.'],
      [13, 3, 'item', 'Each item is its own entry.'],
      [14, 3, 'item', 'A second item runs on to a second line.'],
      [16, 6, 'item', 'A nested item.'],
      [19, 3, 'quote', 'Click here to read the note.'],
      [21, 3, 'header', 'Option'],
      [21, 12, 'header', 'What it does'],
      [23, 12, 'cell', "Names the config's folder."],
      [27, 1, 'heading', 'Setext heading'],
    ]);
  });

  test('links, emphasis and tags leave their words; code spans and URLs stay as written', () => {
    expect(proseOf('A [link](/a "Title") and ![an image](x.png) and **bold** and _it_ and snake_case.')).toBe(
      'A link and and bold and it and snake_case.',
    );
    expect(proseOf('Press <kbd>Alt</kbd>, see <https://x.dev>, \\*not emphasis\\*.')).toBe(
      'Press `Alt`, see https://x.dev, *not emphasis*.',
    );
    expect(proseOf('`npm install`')).toBeUndefined();
    expect(proseOf('src/index.ts')).toBeUndefined();
  });

  test('code spans and URLs are placeholders, the same one twice one placeholder', () => {
    const { text, args } = docMessageOf("Run `a` or `b`, then `a`, at https://x.dev. It's {done}.");
    expect(text).toBe("Run {code} or {code2}, then {code}, at {link}. It''s '{'done'}'.");
    expect([...args.keys()]).toEqual(['code', 'code2', 'link']);
  });

  test('a comment above a block passes it by or exempts it', () => {
    const md = `<!-- prosebook-ignore -->
Click here, ignored.

<!-- prosebook-allow house/no-click-here: the button beside it names the page -->
- Click here, allowed.
- And here.

Click here, linted.
`;
    const found = proseIn('a.md', md);
    expect(found.map((p) => [p.text, p.allow])).toEqual([
      ['Click here, allowed.', { 'house/no-click-here': 'the button beside it names the page' }],
      ['And here.', { 'house/no-click-here': 'the button beside it names the page' }],
      ['Click here, linted.', undefined],
    ]);
  });

  test('docs names files, folders and globs, and leaves out those after a !', () => {
    const config = fixture(
      { 'README.md': '# A\n', 'docs/a.md': 'A\n', 'docs/b.mdx': 'B\n', 'docs/old/c.md': 'C\n', 'notes/d.md': 'D\n', 'docs/e.txt': '' },
      { docs: ['README.md', 'docs', '!docs/old', 'notes/*.md'] },
    );
    expect(docFiles(config)).toEqual(['README.md', 'docs/a.md', 'docs/b.mdx', 'notes/d.md']);
    expect(() => docFiles(resolveConfig(config.root, { docs: ['missing.md'] }))).toThrow('docs names missing.md');
  });

  test('a heading is a name on a heading, held to lint.docs, where word-budget is off unless set', () => {
    const config = fixture({ 'a.md': '# Every one of these words in a long heading\n\nA paragraph.\n' }, { docs: ['a.md'] });
    const [heading, paragraph] = docsOf(config);
    expect([heading!.kind, heading!.surface, heading!.context]).toEqual(['name', 'heading', 'A heading in the doc a.md.']);
    expect([paragraph!.kind, paragraph!.surface]).toEqual([undefined, undefined]);
    expect(config.lint.docs['word-budget']).toBe('off');
    expect(() => resolveConfig(config.root, { lint: { docs: { nope: 'off' } } })).toThrow('lint.docs.nope');
  });
});

describe('the docs, linted', () => {
  test('lint holds them to the rules beside the catalog, and fails on an error there', () => {
    const config = fixture({
      'prosebook.config.ts': CONFIG("'copy/catalog'", ['docs']),
      'copy/catalog/app.yaml': 'app.title:\n  context: The page title.\n  en: Docs\n',
      'docs/guide.md': GUIDE,
    });
    const run = cli(config.root, 'lint');
    expect(run.stderr).toContain('error docs/guide.md:7:1 "Install it, then click here for the `init` command.": [house/no-click-here]');
    expect(run.stderr).toContain('error docs/guide.md:19:3 "Click here to read the note.": [house/no-click-here]');
    expect(run.stderr).not.toContain('this is code');
    expect(run.stderr).toContain('in the docs');
    expect(run.code).toBe(1);
    expect(cli(config.root, 'check').code).toBe(1);

    writeFileSync(join(config.root, 'docs/guide.md'), '# Guide\n\nRead the guide.\n');
    const clean = cli(config.root, 'lint');
    expect(clean.stdout).toContain('2 strings in the docs pass the writing rules');
    expect(clean.code).toBe(0);
  });

  test('approve passes a piece by its file and line, until its words change', () => {
    const config = fixture({
      'prosebook.config.ts': CONFIG('false', ['README.md']),
      'README.md': '# Readme\n\nClick here for the docs.\n',
    });
    expect(cli(config.root, 'lint').code).toBe(1);
    expect(cli(config.root, 'approve', 'README.md:3').stdout).toContain(
      'approved "Click here for the docs." (en) against house/no-click-here',
    );
    expect(Object.keys(readLock(config.lock).judged!['en']!)).toEqual(['Click here for the docs.']);
    expect(cli(config.root, 'lint').stdout).toContain('strings in the code and the docs pass');
    writeFileSync(join(config.root, 'README.md'), '# Readme\n\nClick here for the guide.\n');
    expect(cli(config.root, 'lint').code).toBe(1);
  });
});
