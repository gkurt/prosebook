import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  approve,
  hardcodedText,
  judgeCatalog,
  lint,
  loadCatalog,
  messageOf,
  readLock,
  resolveConfig,
  scannedMessages,
  verdictsOf,
  type ProsebookConfig,
} from 'prosebook/tools';

import { cli, fixture } from './fixture.ts';

/** A rule that finds "click here", as a JSON config would carry it, and every other rule off. */
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
const CONFIG = (catalog: string) => `export default { catalog: ${catalog}, lint: ${JSON.stringify(LINT)} };
`;

const PAGE = `export function Page() {
  return (
    <main>
      <a href="/docs">Click here for the docs</a>
      <p>Saved every five minutes.</p>
    </main>
  );
}
`;

describe('text in code as entries', () => {
  test('a template says its holes as placeholders, and literal syntax is escaped', () => {
    expect(messageOf('Hello ${user.name}, you have ${count} {new} items').text).toBe("Hello {name}, you have {count} '{'new'}' items");
    expect([...messageOf('${a.x} and ${b.x}').args.keys()]).toEqual(['x', 'x2']);
    expect(messageOf("It's <b>").text).toBe("It''s '<'b>");
  });

  test('the same words are one entry, unless a place is exempt from rules the others are not', () => {
    const at = (line: number, allow?: Record<string, string>) => ({
      file: 'a.tsx',
      line,
      column: 1,
      text: 'Click here',
      where: 'text',
      via: 'jsx' as const,
      ...(allow && { allow }),
    });
    const messages = scannedMessages(resolveConfig('.', {}), [
      at(1),
      at(2),
      at(3, { 'house/x': 'the link opens a dialog, named beside it' }),
    ]);
    expect(messages.map((m) => m.places!.map((p) => p.line))).toEqual([[1, 2], [3]]);
    expect(messages.every((m) => m.key === 'Click here')).toBe(true);
  });
});

const ROLES = `export function Cart() {
  toast.error('Could not save the cart');
  toast('Saved');
  const columns = [{ label: 'Unit price', description: 'Before tax' }];
  return (
    <form>
      <h1>Shopping Cart</h1>
      <Dialog.Title>Remove item</Dialog.Title>
      <button><span>Check Out Now</span></button>
      <SubmitButton>Pay</SubmitButton>
      <label>Email</label>
      <p>Thanks for shopping.</p>
      <Link href="/returns">Returns</Link>
      <input placeholder="Search" aria-label="Search the shop" title="Find a product" />
      <Tooltip label="Removes the item from your cart" />
      <MenuItem label="Empty cart" />
      <Checkbox label="Gift wrap" />
    </form>
  );
}
`;

describe('roles guessed from where text stands', () => {
  test('by element, component, attribute, property and call, only where the place says it plainly', () => {
    const config = resolveConfig('.', {});
    const places = hardcodedText('src/Cart.tsx', ROLES, config.scan);
    const roles = Object.fromEntries(scannedMessages(config, places).map((m) => [m.key, [m.kind, m.surface]]));
    expect(roles).toEqual({
      'Could not save the cart': ['state', 'error'],
      Saved: ['state', 'toast'],
      'Unit price': ['name', 'label'],
      'Before tax': ['description', undefined],
      'Shopping Cart': ['name', 'heading'],
      'Remove item': ['name', 'heading'],
      'Check Out Now': ['action', 'action'],
      Pay: ['action', 'action'],
      Email: ['name', 'label'],
      'Thanks for shopping.': [undefined, undefined],
      Returns: [undefined, undefined],
      Search: [undefined, 'placeholder'],
      'Search the shop': [undefined, 'aria'],
      'Find a product': [undefined, 'tooltip'],
      // A label is its element's text, so a component's role wins over the attribute's.
      'Removes the item from your cart': [undefined, 'tooltip'],
      'Empty cart': ['action', 'action'],
      'Gift wrap': ['name', 'label'],
    });
    expect(scannedMessages(config, places).find((m) => m.key === 'Check Out Now')!.context).toBe('Text in a <button>.');
  });

  test('only the kinds and surfaces the config defines', () => {
    const config = resolveConfig('.', { kinds: {}, surfaces: { heading: 'Heads a section.' } });
    const [heading] = scannedMessages(config, hardcodedText('src/A.tsx', 'export const A = () => <h1>Cart</h1>;', config.scan));
    expect([heading!.kind, heading!.surface]).toEqual([undefined, 'heading']);
  });

  test('the strict preset holds a button and a heading to their kind', () => {
    const config = fixture({
      'prosebook.config.ts': "export default { catalog: false, lint: { extends: 'strict', rules: { 'voice/*': 'off' } } };\n",
      'src/Cart.tsx': ROLES,
    });
    const run = cli(config.root, 'lint');
    expect(run.stderr).toContain('src/Cart.tsx:7:11 "Shopping Cart": [sentence-case]');
    expect(run.stderr).toContain('"Check Out Now": [sentence-case]');
    expect(run.stderr).not.toContain('"Thanks for shopping."');
  });

  const SEAMLESS = 'export const A = () => <main><h1>Seamless Sync</h1><p>A seamless sync.</p></main>;';
  const findings = (config: ProsebookConfig) => {
    const resolved = resolveConfig('.', config);
    return lint(scannedMessages(resolved, hardcodedText('src/A.tsx', SEAMLESS, resolved.scan)), resolved, []).map(
      (f) => `${f.key}: ${f.rule}`,
    );
  };

  test('lint.guessed sets severities where the role was guessed, and lint.areas reaches no text in code', () => {
    expect(findings({ lint: { extends: 'strict', rules: { 'voice/*': 'off' } } })).toEqual(
      expect.arrayContaining(['Seamless Sync: sentence-case', 'Seamless Sync: banned-word', 'A seamless sync.: banned-word']),
    );
    const guessed = findings({
      lint: { extends: 'strict', rules: { 'voice/*': 'off' }, guessed: { 'sentence-case': 'off', 'banned-word': 'off' } },
    });
    expect(guessed).toEqual(['A seamless sync.: banned-word']);
    const areas = findings({ lint: { extends: 'strict', rules: { 'voice/*': 'off' }, areas: { '': { 'banned-word': 'off' } } } });
    expect(areas).toContain('A seamless sync.: banned-word');
    expect(() => resolveConfig('.', { lint: { guessed: { nope: 'off' } } })).toThrow('lint.guessed.nope');
  });

  test('scan.roles turns guesses off, a kind or a surface taking the whole guess with it', () => {
    const config = resolveConfig('.', {});
    const places = hardcodedText('src/Cart.tsx', ROLES, config.scan);
    const roleOf = (roles: false | Record<string, false>, key: string) => {
      const m = scannedMessages(resolveConfig('.', { scan: { roles } }), places).find((x) => x.key === key)!;
      return [m.kind, m.surface];
    };
    expect(roleOf({ heading: false }, 'Shopping Cart')).toEqual([undefined, undefined]);
    expect(roleOf({ heading: false }, 'Email')).toEqual(['name', 'label']);
    expect(roleOf({ name: false }, 'Email')).toEqual([undefined, undefined]);
    expect(roleOf(false, 'Pay')).toEqual([undefined, undefined]);
    expect(() => resolveConfig('.', { scan: { roles: { headings: false } } })).toThrow(
      'scan.roles.headings is neither a kind nor a surface',
    );
  });
});

describe('catalog: false', () => {
  test('refuses what only a catalog reads, and loading a catalog', () => {
    expect(() => resolveConfig('.', { catalog: false, locales: 'copy/locales' })).toThrow(
      "locales is for a catalog's messages, and catalog is false: remove it",
    );
    expect(() => loadCatalog(resolveConfig('.', { catalog: false }))).toThrow();
  });

  test('lint holds the text in code to the rules, at each place it stands', () => {
    const config = fixture({ 'prosebook.config.ts': CONFIG('false'), 'src/Page.tsx': PAGE });
    const run = cli(config.root, 'lint');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('error src/Page.tsx:4:23 "Click here for the docs": [house/no-click-here]');
    expect(run.stderr).toContain('prosebook approve <file>:<line>');
    expect(cli(config.root, 'generate').stderr).toContain('generate reads the catalog, and catalog is false');
    expect(cli(config.root, 'lint', '--fix').code).toBe(1);
    expect(cli(config.root, 'scan').stdout).toContain('2 string(s), which prosebook lint holds');
    expect(cli(config.root, 'check').code).toBe(1);
  });

  test('a prosebook-allow comment exempts its place, and is held to the reasons a catalog allow is', () => {
    const allowed = PAGE.replace(
      '      <a href',
      '      {/* prosebook-allow house/no-click-here: the docs open in a side panel beside it */}\n      <a href',
    );
    const config = fixture({ 'prosebook.config.ts': CONFIG('false'), 'src/Page.tsx': allowed });
    expect(cli(config.root, 'lint').code).toBe(0);

    const shrug = PAGE.replace('      <a href', '      {/* prosebook-allow house/no-click-here: it is fine */}\n      <a href');
    writeFileSync(join(config.root, 'src/Page.tsx'), shrug);
    expect(cli(config.root, 'lint').stderr).toContain('[allow] allow.house/no-click-here is four words at least');

    const unneeded = PAGE.replace(
      '      <p>',
      '      {/* prosebook-allow house/no-click-here: the sentence names no link at all */}\n      <p>',
    );
    writeFileSync(join(config.root, 'src/Page.tsx'), unneeded);
    expect(cli(config.root, 'lint').stderr).toContain(
      '"Saved every five minutes.": [allow] allow.house/no-click-here exempts the entry from a rule it passes',
    );
  });

  test('approve passes the words as written, wherever they move, until they change', () => {
    const config = fixture({ 'prosebook.config.ts': CONFIG('false'), 'src/Page.tsx': PAGE });
    const approved = cli(config.root, 'approve', 'src/Page.tsx:4');
    expect(approved.stdout).toContain('approved "Click here for the docs" (en) against house/no-click-here');
    expect(readLock(config.lock).judged!['en']!['Click here for the docs']!['house/no-click-here']!['author']).toMatch(/^[0-9a-f]{10}:0$/);
    expect(cli(config.root, 'lint').code).toBe(0);

    // Moved to another file: still the same words.
    mkdirSync(join(config.root, 'src/moved'), { recursive: true });
    writeFileSync(join(config.root, 'src/moved/Page.tsx'), `\n\n${PAGE}`);
    writeFileSync(join(config.root, 'src/Page.tsx'), 'export {};\n');
    expect(cli(config.root, 'lint').code).toBe(0);

    // Changed: the approval no longer holds, and the next approval drops it from the lock.
    writeFileSync(join(config.root, 'src/moved/Page.tsx'), PAGE.replace('for the docs', 'for the guide'));
    expect(cli(config.root, 'lint').stderr).toContain('"Click here for the guide": [house/no-click-here]');
    expect(cli(config.root, 'approve', 'Click here for the guide').code).toBe(0);
    expect(Object.keys(readLock(config.lock).judged!['en']!)).toEqual(['Click here for the guide']);
    expect(cli(config.root, 'approve', 'Saved every five minutes.').stderr).toContain('breaks no rule: nothing to approve');
    expect(cli(config.root, 'approve', '--all').stderr).toContain('none needs approving');
  });
});

describe('approve, in a catalog', () => {
  test('passes an entry against any rule it breaks, without a judge', async () => {
    const config = fixture(
      {
        'prosebook.config.ts': CONFIG("'copy/catalog'"),
        'copy/catalog/docs.yaml': 'docs.link:\n  context: The link to the docs.\n  en: Click here for the docs\n',
      },
      { lint: LINT },
    );
    const { messages } = loadCatalog(config);
    const before = lint(messages, config, messages, verdictsOf(config, messages, readLock(config.lock)));
    expect(before.map((f) => f.rule)).toContain('house/no-click-here');
    const result = approve(config, messages, undefined, ['docs.link', 'docs.nope']);
    expect(result.approved).toEqual([{ key: 'docs.link', rules: before.map((f) => f.rule) }]);
    expect(result.problems).toEqual([expect.stringContaining('docs.nope (en) is no entry')]);
    const lock = { ...readLock(config.lock), judged: result.verdicts };
    expect(lint(messages, config, messages, verdictsOf(config, messages, lock))).toEqual([]);
    // A judge's run keeps it, though no model is asked of that rule.
    const judging = resolveConfig(config.root, {
      lint: LINT,
      judge: { models: [{ id: 'fake/none', judge: () => Promise.resolve({ probabilities: {} }) }] },
    });
    const run = await judgeCatalog(judging, { messages, problems: [] }, lock);
    expect(run.verdicts['en']!['docs.link']!['house/no-click-here']!['author']).toBe(
      result.verdicts['en']!['docs.link']!['house/no-click-here']!['author'],
    );
  });

  test('scan --lint holds the hardcoded text to the rules too', () => {
    const config = fixture({
      'prosebook.config.ts': CONFIG("'copy/catalog'"),
      'copy/catalog/docs.yaml': 'docs.title:\n  context: The page title.\n  en: Docs\n',
      'src/Page.tsx': PAGE,
    });
    const run = cli(config.root, 'scan', '--lint');
    expect(run.stderr).toContain('src/Page.tsx:4:23 "Click here for the docs": [house/no-click-here]');
    expect(run.stderr).toContain('prosebook extract');
    expect(run.code).toBe(1);
    expect(readFileSync(join(config.root, 'src/Page.tsx'), 'utf8')).toBe(PAGE);
  });
});
