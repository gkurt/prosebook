import { describe, expect, test } from 'bun:test';

import { hardcodedText, isReferenced, keyRefs } from 'copydeck/tools';

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
      {/* copydeck-ignore */}
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
