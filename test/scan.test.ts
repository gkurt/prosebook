import { describe, expect, test } from 'bun:test';

import { hardcodedText, isReferenced, keyRefs, looksLikeCode, unseenReads } from 'prosebook/tools';

describe('hardcoded text', () => {
  const ATTRS = ['alt', 'title', 'placeholder', 'aria-label'];

  test('finds JSX text and readable attributes, and skips code, symbols and ignored lines', () => {
    const code = `
export function A({ n }) {
  return (
    <form title="Edit profile" className="flex">
      <h1>Your profile</h1>
      <input placeholder={'Search'} type="text" />
      <span>{n} · ×</span>
      <code>npm install</code>
      {/* prosebook-ignore */}
      <p>Brand™</p>
      <img alt="" />
      {"Literal child"}
    </form>
  );
}`;
    expect(hardcodedText('A.tsx', code, ATTRS).map((h) => `${h.line}:${h.column} ${h.where} ${h.text}`)).toEqual([
      '4:17 title Edit profile',
      '5:11 text Your profile',
      '6:27 placeholder Search',
      '12:8 text Literal child',
    ]);
  });
});

test('code-like tokens are not prose', () => {
  expect(['form.json()', 'src/index.ts', 'snake_case', 'a::b', 'x=1'].filter((t) => !looksLikeCode(t))).toEqual([]);
  expect(['Done.', 'Hello world', 'e-mail', 'Save!', 'fieldspec'].filter(looksLikeCode)).toEqual([]);
});

describe('key references', () => {
  test('literal keys anywhere count, and dynamic suffixes keep a whole prefix', () => {
    const refs = keyRefs(`
      t('cart.title');
      const tabs = ["nav.home", "nav.settings"];
      t(\`status.\${state}\`);
      t('errors.' + code);
      const notAKey = 'hello world';
    `);
    expect([...refs.exact].sort()).toEqual(['cart.title', 'nav.home', 'nav.settings']);
    expect([...refs.prefixes].sort()).toEqual(['errors.', 'status.']);
    expect(isReferenced('status.offline', refs)).toBe(true);
    expect(isReferenced('cart.empty', refs)).toBe(false);
  });
});

describe('reads a pruned build cannot see', () => {
  const unseen = (code: string) => unseenReads('A.tsx', code).unseen.map((u) => `${u.line}:${u.column} ${u.name} ${u.code}`);

  test('a key the scan finds is seen: a literal, a choice of literals, a template or sum after a prefix', () => {
    const code = `copy.t('a.one'); t(on ? 'a.on' : 'a.off'); rich(\`a.\${id}\`, {}); t('a.' + id); t('a.b' as const);`;
    expect(unseen(code)).toEqual([]);
  });

  test("a key in a variable, after no prefix, or in a Text's id is not", () => {
    const code = [
      "import { Text } from 'prosebook/react';",
      'copy.t(item.key);',
      't(`${area}.title`);',
      'const { rich: say } = useCopy();',
      'say(on ? "a.b" : key);',
      '<Text id={id} />;',
      '// prosebook-ignore: every key is in the tabs array',
      't(tab.key);',
    ].join('\n');
    expect(unseen(code)).toEqual([
      '2:1 t copy.t(item.key)',
      '3:1 t t(`${area}.title`)',
      '5:1 say say(on ? "a.b" : key)',
      '6:1 Text <Text id={id} />',
    ]);
  });

  test('a name imported here is kept for the build to match against aliases bound elsewhere', () => {
    const reads = unseenReads('A.ts', "import { tRich as say, other } from '@app/text';\nsay(key);\nother(1);\nclock.tick(n);");
    expect(reads.unseen.map((u) => u.name)).toEqual(['tRich', 'other']);
    expect([...unseenReads('B.ts', 'export const { t, rich: tRich } = copy;').aliases]).toEqual(['t', 'tRich']);
  });

  test('a Text from elsewhere, and a local that only shares a name as a property, are not reads', () => {
    const code = "import { Text } from '@ui/kit';\n<Text id={id} />;\ntracks.forEach((t) => t.stop());\n({ t: key });";
    expect(unseen(code)).toEqual([]);
  });
});
