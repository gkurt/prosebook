import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createCopy, type Catalog } from 'copydeck';
import { CopyProvider } from 'copydeck/react';
import { applyExtract, areaOf, generate, loadCatalog, planExtract } from 'copydeck/tools';

import { fixture } from './fixture.ts';

const COMPONENT = `import { useState } from 'react';

export function Profile({ user, items }: { user: { name: string }; items: string[] }) {
  const [q] = useState('');
  return (
    <section title="Your profile">
      <h2>Profile</h2>
      <p>
        Hi {user.name}, read the <a href="/terms">terms of <b>sale</b></a>.
      </p>
      <input placeholder="Search items" value={q} readOnly />
      <button type="button">Save</button>
      <footer>
        <span>
          <strong>Shop</strong> {user.name} · MIT
        </span>
        <span>{items.length}</span>
      </footer>
      <img src="x.png" alt="" /> Next step
      {/* copydeck-ignore */}
      <span>ACME</span>
      <code>npm install</code>
      <ul>
        {items.map((item) => (
          <li key={item} title="An item">
            {item}: done
          </li>
        ))}
      </ul>
    </section>
  );
}
`;

describe('copydeck extract', () => {
  test('the rewritten component renders exactly what the hardcoded one did', async () => {
    const config = fixture(
      {
        'src/Before.tsx': COMPONENT,
        'src/After.tsx': COMPONENT,
        'copy/catalog/profile.yaml': 'profile.save:\n  context: Saves the profile.\n  en: Save\n',
      },
      { scan: { dirs: ['src'] } },
    );
    const plan = planExtract(config, [join(config.root, 'src', 'After.tsx')], { area: 'profile' });
    expect(plan.files[0]!.extractions.map((x) => `${x.line} ${x.key}${x.reused ? ' (reused)' : ''}: ${x.message}`)).toEqual([
      '6 profile.your-profile-tooltip: Your profile',
      '7 profile.profile: Profile',
      '9 profile.hi-read-the-terms: Hi {name}, read the <a>terms of <b>sale</b></a>.',
      '11 profile.search-items-placeholder: Search items',
      '12 profile.save (reused): Save',
      '15 profile.shop-mit: <strong>Shop</strong> {name} · MIT',
      '19 profile.next-step: Next step',
      '25 profile.an-item-tooltip: An item',
      '26 profile.done: {item}: done',
    ]);
    applyExtract(config, plan);
    generate(config);

    const after = readFileSync(join(config.root, 'src', 'After.tsx'), 'utf8');
    expect(after).toContain("import { Text, useCopy } from 'copydeck/react';");
    expect(after).toContain('  const { t } = useCopy();\n  const [q]');
    expect(after).toContain('<li key={item} title={t("profile.an-item-tooltip")}>');
    expect(after).toContain('<Text id="profile.done" values={{ item: item }} />');
    expect(after).toContain('<span>ACME</span>');
    expect(after).toContain('<code>npm install</code>');

    const { catalog } = (await import(join(config.out, 'index.ts'))) as { catalog: Catalog };
    const copy = createCopy(catalog);
    const props = { user: { name: 'Ada' }, items: ['one', 'two'] };
    const render = (Component: ComponentType<typeof props>) =>
      renderToStaticMarkup(createElement(CopyProvider, { copy }, createElement(Component, props)));
    const { Profile: Before } = (await import(join(config.root, 'src', 'Before.tsx'))) as { Profile: ComponentType<typeof props> };
    const { Profile: After } = (await import(join(config.root, 'src', 'After.tsx'))) as { Profile: ComponentType<typeof props> };
    expect(render(After)).toBe(render(Before));
  });

  test('the catalog entries carry a kind, surface, context and argument docs to review', () => {
    const config = fixture({ 'src/Cart.tsx': COMPONENT });
    const plan = planExtract(config, [join(config.root, 'src', 'Cart.tsx')]);
    applyExtract(config, plan);
    const yaml = readFileSync(join(config.catalog, 'cart.yaml'), 'utf8');
    expect(yaml.startsWith('# yaml-language-server: $schema=./catalog.schema.json\n')).toBe(true);
    expect(yaml).toContain(
      [
        '# TODO(copydeck extract): check the key, kind and context.',
        'cart.hi-read-the-terms:',
        '  context: In Profile, the text of a <p>.',
        '  args:',
        '    name: "TODO: what `user.name` holds"',
        '  en: Hi {name}, read the <a>terms of <b>sale</b></a>.',
      ].join('\n'),
    );
    expect(yaml).toContain('cart.profile:\n  kind: name\n  surface: heading\n');
    expect(yaml).toContain('cart.save:\n  kind: action\n  surface: action\n');
    // What was written loads as a valid catalog.
    expect(loadCatalog(config).messages).toHaveLength(9);
  });

  test('an attribute outside a component body is left alone, with a warning', () => {
    const config = fixture({ 'src/Badge.tsx': 'export const Badge = () => <span aria-label="New badge">New</span>;\n' });
    const [file] = planExtract(config, [join(config.root, 'src', 'Badge.tsx')]).files;
    expect(file!.extractions.map((x) => x.key)).toEqual(['badge.new']);
    expect(file!.warnings[0]).toContain('aria-label="New badge" is not inside a component with a body');
  });

  test('t joins an existing useCopy() call, and copy.t stands in where t is taken', () => {
    const config = fixture({
      'src/A.tsx': [
        "import { useCopy } from 'copydeck/react';",
        'export function A() {',
        '  const { locale } = useCopy();',
        '  return <input placeholder="Search" lang={locale} />;',
        '}',
        'export function B({ tabs }: { tabs: string[] }) {',
        '  return tabs.map((t) => <input key={t} placeholder="Find" />);',
        '}',
        'export function C() {',
        '  const copy = useCopy();',
        '  return <input placeholder="Go" />;',
        '}',
      ].join('\n'),
    });
    const plan = planExtract(config, [join(config.root, 'src', 'A.tsx')]);
    applyExtract(config, plan);
    const code = readFileSync(join(config.root, 'src', 'A.tsx'), 'utf8');
    expect(code).toContain('const { t, locale } = useCopy();');
    expect(code).toContain('placeholder={t("a.search-placeholder")}');
    expect(code).toContain(
      'const copy = useCopy();\n  return tabs.map((t) => <input key={t} placeholder={copy.t("a.find-placeholder")} />);',
    );
    expect(code).toContain('const copy = useCopy();\n  return <input placeholder={copy.t("a.go-placeholder")} />;');
    expect(plan.files[0]!.warnings).toEqual([]);
  });

  test('an argument YAML 1.1 reads as a boolean is quoted, so the catalog still loads', () => {
    const config = fixture({ 'src/Count.tsx': 'export function Count({ n }: { n: string }) {\n  return <p>You have {n} files</p>;\n}\n' });
    applyExtract(config, planExtract(config, [join(config.root, 'src', 'Count.tsx')]));
    expect(readFileSync(join(config.catalog, 'count.yaml'), 'utf8')).toContain('    "n": "TODO: what `n` holds"');
    expect(loadCatalog(config).messages.map((m) => m.text)).toEqual(['You have {n} files']);
  });

  test('an area is named after the file, or its folder for an index', () => {
    expect(areaOf('src/components/CartPanel.tsx')).toBe('cart-panel');
    expect(areaOf('src/routes/settings/index.tsx')).toBe('settings');
    expect(areaOf('src/HTMLViewer.tsx')).toBe('html-viewer');
  });
});
