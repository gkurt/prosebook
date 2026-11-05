import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generate } from 'prosebook/tools';

import { REVIEW_MARKER, reviewMarkdown, reviewOf, reviewText, type Review } from '#src/tools/review.ts';
import { cli, fixture } from './fixture.ts';

const git = (root: string, ...args: string[]) => {
  const proc = Bun.spawnSync(['git', ...args], { cwd: root });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout.toString();
};

/** A project committed to git, then edited: one source changed, one added, one removed, one renamed, one translation changed. */
const edited = () => {
  const config = fixture(
    {
      'prosebook.config.json': '{ "require": [] }',
      'copy/catalog/cart.yaml': [
        'cart.checkout: Check out',
        'cart.items: Items in your cart',
        'cart.old: Gone soon',
        'cart.title: Your cart',
        '',
      ].join('\n'),
      'copy/locales/de.yaml': 'cart.checkout: Zur Kasse\ncart.title: Warenkorb\n',
    },
    { require: [] },
  );
  generate(config);
  git(config.root, 'init', '-q');
  git(config.root, 'add', '-A');
  git(config.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'catalog');
  writeFileSync(
    join(config.catalog, 'cart.yaml'),
    ['cart.checkout: Pay now', 'cart.count: Items in your cart', 'cart.title: Your cart', 'cart.total: "Total: <b>{sum}</b>"', ''].join(
      '\n',
    ),
  );
  writeFileSync(join(config.locales, 'de.yaml'), 'cart.checkout: Zur Kasse\ncart.title: Einkaufswagen\n');
  return config;
};

const reviewed = (config: ReturnType<typeof fixture>, base = 'HEAD') => {
  const review = reviewOf(config, base);
  if ('problem' in review) throw new Error(review.problem);
  return review;
};

describe('diff', () => {
  test('each entry the change touched, with what it left stale and untranslated', () => {
    const review = reviewed(edited());
    expect(review.changes.map((c) => [c.change, c.from ?? '', c.key, c.stale, c.untranslated])).toEqual([
      ['changed', '', 'cart.checkout', ['de'], []],
      ['renamed', 'cart.items', 'cart.count', [], []],
      ['removed', '', 'cart.old', [], []],
      ['changed', '', 'cart.title', [], []],
      ['added', '', 'cart.total', [], ['de']],
    ]);
    expect(reviewText(review)).toBe(
      [
        'prosebook: 5 entries changed since HEAD: 2 changed, 1 added, 1 removed, 1 renamed. 1 translation now stale.',
        '',
        'changed  cart.checkout: [-Check out-]{+Pay now+}',
        '         stale in de: their translations were made from the text before',
        'renamed  cart.items → cart.count: Items in your cart',
        'removed  cart.old: [-Gone soon-]',
        'changed  cart.title: Your cart',
        '  de     [-Warenkorb-]{+Einkaufswagen+}',
        'added    cart.total: {+Total: <b>{sum}</b>+}',
        '         not yet translated in de',
      ].join('\n'),
    );
  });

  test('as Markdown, every cell escaped, for a pull request comment', () => {
    const markdown = reviewMarkdown(reviewed(edited()));
    expect(markdown.startsWith(`${REVIEW_MARKER}\n### Copy changes\n`)).toBe(true);
    expect(markdown).toContain(
      '| `cart.checkout`<br>changed | <del>Check out</del><ins>Pay now</ins><br><sub>stale in de: their translations were made from the text before</sub> |',
    );
    expect(markdown).toContain('| `cart.count`<br>renamed from `cart.items` | Items in your cart |');
    // A tag in a message is text in the comment, not markup.
    expect(markdown).toContain('<ins>Total: &lt;b&gt;{sum}&lt;/b&gt;</ins>');
    expect(markdown).toContain('**de** <del>Warenkorb</del><ins>Einkaufswagen</ins>');
  });

  test('lint findings on the words a change wrote, and none on those it left alone', () => {
    const config = edited();
    writeFileSync(join(config.locales, 'de.yaml'), 'cart.checkout: Zur Kasse\ncart.title: "Warenkorb  "\n');
    const review: Review = reviewed(config);
    const findings = review.changes.flatMap((c) => c.findings.map((f) => `${c.key} ${f.locale} [${f.rule}]`));
    expect(findings).toEqual(['cart.title de [whitespace]']);
  });

  test('no changes, and a base git has no commit for', () => {
    const config = edited();
    git(config.root, 'add', '-A');
    git(config.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'edit');
    expect(reviewText(reviewed(config))).toBe('prosebook: no copy changes since HEAD');
    expect(reviewMarkdown(reviewed(config))).toContain('No copy changes since `HEAD`.');
    expect(reviewOf(config, 'nope')).toEqual({
      problem: '"nope" is no commit here: name a branch or a commit, such as origin/main (a shallow clone may not have it)',
    });
    // The commit before the edit still shows it.
    expect(reviewed(config, 'HEAD~1').changes.length).toBeGreaterThan(0);

    const run = cli(config.root, 'diff', 'HEAD~1', '--format', 'markdown');
    expect(run.code).toBe(0);
    expect(run.stdout).toStartWith(REVIEW_MARKER);
    expect(cli(config.root, 'diff', '--format', 'html').stderr).toContain('diff writes text or markdown');
  });
});
