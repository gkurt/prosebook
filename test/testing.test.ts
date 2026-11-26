import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCopy } from '#src/test.ts';
import { loadCatalog } from '#src/tools/catalog.ts';
import { reviewOf, reviewText } from '#src/tools/review.ts';
import { fixTestText, testPatterns, testText } from '#src/tools/tests.ts';
import { cli, fixture } from './fixture.ts';

const git = (root: string, ...args: string[]) => {
  const proc = Bun.spawnSync(['git', ...args], { cwd: root });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout.toString();
};

const project = () =>
  fixture(
    {
      'prosebook.config.json': '{ "require": [] }',
      'copy/catalog/cart.yaml': [
        'cart.checkout: Check out',
        'cart.items: "{count, plural, one {# item} other {# items}}"',
        'cart.greeting: "Hi {name}, <b>welcome</b> back."',
        'cart.state: "{state, select, open {Open} other {Closed}}"',
        'cart.total: "Total: {sum, number, ::currency/EUR}"',
        'cart.owner: "{name} has {count, plural, one {# item} other {# items}}"',
        'cart.role: "{role, select, assistant {Assistant} other {{role}}}"',
        'cart.method: "{method} {path}"',
        'cart.on: "On {branch}"',
        `cart.host: "{host} isn't a public address."`,
        '',
      ].join('\n'),
      'copy/locales/de/cart.yaml': 'cart.checkout: Zur Kasse\n',
    },
    { require: [] },
  );

describe('prosebook/test', () => {
  test('t reads the YAML as written now, no generate first', async () => {
    const copy = await loadCopy({ root: project().root });
    expect(copy.t('cart.checkout')).toBe('Check out');
    expect(copy.t('cart.items', { count: 2 })).toBe('2 items');
    expect(copy.t('cart.greeting', { name: 'Ada' })).toBe('Hi Ada, welcome back.');
  });

  test('t throws on a key the catalog lacks, and on a placeholder with no value', async () => {
    const copy = await loadCopy({ root: project().root });
    expect(() => copy.t('cart.nope' as never)).toThrow('the catalog has no entry cart.nope');
    expect(() => copy.t('cart.items' as never)).toThrow("copy.match('cart.items')");
  });

  test('match takes any text for a placeholder not given, and any arm of a plural or select', async () => {
    const copy = await loadCopy({ root: project().root });
    const items = copy.match('cart.items');
    expect(items.test('1 item')).toBe(true);
    expect(items.test('12 items')).toBe(true);
    expect(items.test('12 things')).toBe(false);
    expect(copy.match('cart.greeting').test('Hi  Grace Hopper,\nwelcome back.')).toBe(true);
    expect(copy.match('cart.greeting').test('Hi Grace, welcome back')).toBe(false);
    expect(copy.match('cart.state').test('Closed')).toBe(true);
    expect(copy.match('cart.checkout').test('Check out (2)')).toBe(false);
    expect(copy.match('cart.checkout', {}, { partial: true }).test('Check out (2)')).toBe(true);
    expect(copy.match('cart.checkout', {}, { partial: 'start' }).test('Check out (2)')).toBe(true);
    expect(copy.match('cart.checkout', {}, { partial: 'start' }).test('(2) Check out')).toBe(false);
    expect(copy.match('cart.checkout', {}, { partial: 'end' }).test('(2) Check out')).toBe(true);
    expect(copy.match('cart.checkout', {}, { partial: 'end' }).test('Check out (2)')).toBe(false);
  });

  test('formats values as the app does', async () => {
    const copy = await loadCopy({ root: project().root, timeZone: 'UTC' });
    expect(copy.number(1234.5)).toBe('1,234.5');
    expect(copy.date(Date.UTC(2026, 10, 9), { dateStyle: 'medium' })).toBe('Nov 9, 2026');
    expect(copy.list(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(copy.in('de').number(1234.5)).toBe('1.234,5');
  });

  test('match writes a value given as the app would', async () => {
    const copy = await loadCopy({ root: project().root });
    expect(copy.match('cart.items', { count: 1 }).test('1 item')).toBe(true);
    expect(copy.match('cart.items', { count: 1 }).test('2 items')).toBe(false);
    expect(copy.match('cart.state', { state: 'open' }).test('Open')).toBe(true);
    expect(copy.match('cart.state', { state: 'open' }).test('Closed')).toBe(false);
    expect(copy.match('cart.total', { sum: 1234.5 }).test('Total: €1,234.50')).toBe(true);
    expect(copy.match('cart.total', { sum: 1234.5 }).test('Total: €9.00')).toBe(false);
    const owner = copy.match('cart.owner', { count: 3 });
    expect(owner.test('Ada has 3 items')).toBe(true);
    expect(owner.test('Ada has 1 item')).toBe(false);
  });

  test('match with a distance takes that many characters inserted, deleted or replaced in all', async () => {
    const copy = await loadCopy({ root: project().root });
    const one = copy.match('cart.checkout', {}, { distance: 1 });
    expect(['Check out', 'Checkout', 'Check-out', 'Check outs', 'check out'].map((t) => one.test(t))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['Chekc out', 'Pay now', 'Check it out'].map((t) => one.test(t))).toEqual([false, false, false]);
    expect(copy.match('cart.checkout', {}, { distance: 2 }).test('Chekc out')).toBe(true);
    // Shared across the words and arms of the whole message, not each.
    const greeting = copy.match('cart.greeting', {}, { distance: 1 });
    expect(greeting.test('Hi Ada, welcome back!')).toBe(true);
    expect(greeting.test('Hey Ada, welcome back.')).toBe(false);
    expect(copy.match('cart.greeting', {}, { distance: 2 }).test('Hey Ada, welcome back.')).toBe(true);
    expect(copy.match('cart.greeting', {}, { distance: 2 }).test('Hey Ada, welcome back!')).toBe(false);
    // A value given is written as the app writes it, and isn't counted.
    const items = copy.match('cart.items', { count: 3 }, { distance: 1 });
    expect(items.test('3 itens')).toBe(true);
    expect(items.test('4 items')).toBe(false);
    expect(copy.match('cart.items', {}, { distance: 1 }).test('1 iten')).toBe(true);
  });

  test('a distance is a whole number, and one too large for the message says so', async () => {
    const copy = await loadCopy({ root: project().root });
    expect(() => copy.match('cart.checkout', {}, { distance: 1.5 })).toThrow('distance is 1.5: give a whole number of characters');
    expect(() => copy.match('cart.owner', {}, { distance: 9 })).toThrow('give a smaller one');
  });

  test('in reads another locale, falling back to the source where it has no translation', async () => {
    const de = (await loadCopy({ root: project().root })).in('de');
    expect(de.t('cart.checkout')).toBe('Zur Kasse');
    expect(de.match('cart.checkout').test('Zur Kasse')).toBe(true);
    expect(de.match('cart.items').test('3 items')).toBe(true);
    expect(() => de.in('fr')).toThrow('the catalog has no locale fr: name one of en, de');
  });

  test('a project with no catalog says where it looked', async () => {
    const root = fixture({}, {}).root;
    expect(loadCopy({ root: `${root}/missing` })).rejects.toThrow('no catalog at');
  });
});

const spec = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('checks out', async ({ page }) => {",
  "  await page.getByRole('button', { name: 'Check out' }).click();",
  "  await expect(page.getByText('3 items')).toBeVisible();",
  "  await page.goto('/cart');",
  '  // prosebook-ignore',
  "  await page.getByText('Check out').hover();",
  '});',
  '',
].join('\n');

describe('test-text', () => {
  test('finds the copy a test says, and scan --fix reads it by key', () => {
    const config = project();
    mkdirSync(join(config.root, 'e2e'), { recursive: true });
    writeFileSync(join(config.root, 'e2e', 'cart.spec.ts'), spec);
    const scanned = cli(config.root, 'scan');
    expect(scanned.stderr).toContain(
      `warn  e2e/cart.spec.ts:4:42 test says "Check out", the text of cart.checkout: read copy.t('cart.checkout') from prosebook/test`,
    );
    expect(scanned.stderr).toContain(`e2e/cart.spec.ts:5:31 test says "3 items", the text of cart.items: read copy.match('cart.items')`);
    // Not a test's title, the route, nor a line marked to be left.
    expect(scanned.stderr).not.toContain('checks out"');
    expect(scanned.stderr).not.toContain(':8:');
    expect(scanned.stdout).toContain('2 test(s) saying the copy as text');
    expect(scanned.code).toBe(0);
    expect(cli(config.root, 'scan', '--strict').code).toBe(1);

    const fixed = cli(config.root, 'scan', '--fix');
    expect(fixed.stdout).toContain('2 test literal(s) in 1 file(s) now read the catalog through prosebook/test');
    const code = readFileSync(join(config.root, 'e2e', 'cart.spec.ts'), 'utf8');
    expect(code).toContain("import { test, expect } from '@playwright/test';\nimport { copy } from 'prosebook/test';\n");
    expect(code).toContain("{ name: copy.t('cart.checkout') }");
    expect(code).toContain("page.getByText(copy.match('cart.items'))");
    expect(cli(config.root, 'scan').stdout).toContain('0 test(s) saying the copy as text');
  });

  test("a file's own copy has no match, so only plain messages are fixed", () => {
    const patterns = testPatterns(
      loadCatalog(project()).messages.filter((m) => m.key !== 'cart.state'),
      'en',
    );
    const code = "import { copy } from './copy.ts';\nexpect(a).toBe('Check out');\nexpect(b).toBe('2 items');\n";
    const found = testText('e2e/a.spec.ts', code, patterns, 'en');
    expect(found.map((f) => f.read)).toEqual(["copy.t('cart.checkout')", undefined]);
    expect(fixTestText(code, found)).toBe(
      "import { copy } from './copy.ts';\nexpect(a).toBe(copy.t('cart.checkout'));\nexpect(b).toBe('2 items');\n",
    );
  });

  test('an arm that is only a placeholder, a code, or what a read of the copy is given is no message', () => {
    const patterns = testPatterns(loadCatalog(project()).messages, 'en');
    const code = [
      "send('assistant', 'POST', 'q1', 'sendNow');",
      "expect(text).toBe(copy.t('cart.checkout'));",
      "copy.in('de');",
      "copy.t('cart.greeting', { name: 'Assistant' });",
      "copy.in('de').match('cart.role', { role: 'Assistant' }, { partial: 'start' });",
      "getByText('Assistant');",
      '',
    ].join('\n');
    expect(testText('e2e/a.spec.ts', code, patterns, 'en').map((f) => [f.text, f.read])).toEqual([
      ['Assistant', "copy.match('cart.role')"],
    ]);
  });

  test('through a placeholder taking words, only where the message says a phrase around it', () => {
    const patterns = testPatterns(loadCatalog(project()).messages, 'en');
    const reads = (line: string) => testText('e2e/a.spec.ts', line, patterns, 'en').map((f) => f.read);
    expect(reads("expect(a).toBe('Hi Grace Hopper, how are you today?');")).toEqual([]);
    // `Hi {name}, welcome back.` has three words of its own, and `On {branch}` one: words of the test's own fill them.
    expect(reads("expect(a).toBe('Hi Ada, welcome back.');")).toEqual([]);
    expect(reads("expect(a).toBe('On it.');")).toEqual([]);
    expect(reads(`expect(a).toHaveText("localhost isn't a public address.");`)).toEqual(["copy.match('cart.host')"]);
    // A number fills its placeholder with no letters, as the catalog writes it, and nothing else does.
    expect(reads("expect(a).toHaveText('12 items');")).toEqual(["copy.match('cart.items')"]);
    expect(reads("expect(a).toHaveText('the items');")).toEqual([]);
  });

  test('only what a test expects of the page, less what it put in itself', () => {
    const patterns = testPatterns(loadCatalog(project()).messages, 'en');
    const code = [
      "await page.getByLabel('Name').fill('Check out');",
      "await expect(page.getByText('Check out')).toBeVisible();",
      "seed({ title: 'Closed' });",
      "await page.locator('li').filter({ hasText: 'Open' }).click();",
      "expect(screen.getAllByRole('button', { name: 'Assistant' })).toHaveLength(1);",
      '',
    ].join('\n');
    expect(testText('e2e/a.spec.ts', code, patterns, 'en').map((f) => f.text)).toEqual(['Open', 'Assistant']);
  });

  test('scan.ignore keeps it out of a folder', () => {
    const config = fixture(
      {
        'prosebook.config.json': JSON.stringify({ require: [], scan: { ignore: { 'test-text': ['e2e'] } } }),
        'copy/catalog/cart.yaml': 'cart.checkout: Check out\n',
        'e2e/cart.spec.ts': spec,
      },
      { require: [] },
    );
    expect(cli(config.root, 'scan').stdout).toContain('0 test(s) saying the copy as text');
  });

  test('diff names the tests still saying the text a change rewrote', () => {
    const config = fixture(
      {
        'prosebook.config.json': '{ "require": [] }',
        'copy/catalog/cart.yaml': 'cart.checkout: Check out\n',
        'e2e/cart.spec.ts': "page.getByText('Check out');\n",
      },
      { require: [] },
    );
    git(config.root, 'init', '-q');
    git(config.root, 'add', '-A');
    git(config.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'catalog');
    writeFileSync(join(config.catalog, 'cart.yaml'), 'cart.checkout: Pay now\n');
    const review = reviewOf(config, 'HEAD');
    if ('problem' in review) throw new Error(review.problem);
    expect(review.changes[0]!.tests).toEqual(['e2e/cart.spec.ts:1']);
    expect(reviewText(review)).toContain(
      "still said in e2e/cart.spec.ts:1: read it by key with prosebook/test, copy.t or copy.match('cart.checkout')",
    );
  });
});
