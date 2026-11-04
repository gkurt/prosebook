import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createCopy, type Catalog } from 'prosebook';
import { CopyProvider } from 'prosebook/react';
import { applyExtract, areaOf, generate, loadCatalog, planExtract, slugOf } from 'prosebook/tools';

import { writingGuide } from '#src/tools/guide.ts';

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
      {/* prosebook-ignore */}
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

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', noEmit: true },
});

describe('prosebook extract', () => {
  test('the rewritten component renders exactly what the hardcoded one did', async () => {
    const config = fixture(
      {
        'src/Before.tsx': COMPONENT,
        'src/After.tsx': COMPONENT,
        'copy/catalog/profile.yaml': 'profile.save:\n  context: Saves the profile.\n  en: Save\n',
      },
      { scan: { dirs: ['src'] } },
    );
    const plan = await planExtract(config, [join(config.root, 'src', 'After.tsx')], { area: 'profile' });
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
    expect(after).toContain("import { Text, useCopy } from 'prosebook/react';");
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

  test('the catalog entries carry a kind, surface, context and argument docs to review', async () => {
    const config = fixture({ 'src/Cart.tsx': COMPONENT });
    const plan = await planExtract(config, [join(config.root, 'src', 'Cart.tsx')]);
    applyExtract(config, plan);
    const yaml = readFileSync(join(config.catalog, 'cart.yaml'), 'utf8');
    expect(yaml.startsWith('# yaml-language-server: $schema=./catalog.schema.json\n')).toBe(true);
    expect(yaml).toContain(
      [
        '# TODO(prosebook extract): check the key, kind and context.',
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

  test('an attribute outside a component body is left alone, with a warning', async () => {
    const config = fixture({ 'src/Badge.tsx': 'export const Badge = () => <span aria-label="New badge">New</span>;\n' });
    const [file] = (await planExtract(config, [join(config.root, 'src', 'Badge.tsx')])).files;
    expect(file!.extractions.map((x) => x.key)).toEqual(['badge.new']);
    expect(file!.warnings[0]).toContain('aria-label="New badge" is not inside a component with a body');
  });

  test('t joins an existing useCopy() call, and copy.t stands in where t is taken', async () => {
    const config = fixture({
      'src/A.tsx': [
        "import { useCopy } from 'prosebook/react';",
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
    const plan = await planExtract(config, [join(config.root, 'src', 'A.tsx')]);
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

  test('an argument YAML 1.1 reads as a boolean is quoted, so the catalog still loads', async () => {
    const config = fixture({ 'src/Count.tsx': 'export function Count({ n }: { n: string }) {\n  return <p>You have {n} files</p>;\n}\n' });
    applyExtract(config, await planExtract(config, [join(config.root, 'src', 'Count.tsx')]));
    expect(readFileSync(join(config.catalog, 'count.yaml'), 'utf8')).toContain('    "n": "TODO: what `n` holds"');
    expect(loadCatalog(config).messages.map((m) => m.text)).toEqual(['You have {n} files']);
  });

  test('the spaces around a run render as before: a {" "} before a line break, and a literal\'s own', async () => {
    const SPACES = [
      'const Branch = ({ name }: { name: string }) => <code>{name}</code>;',
      'export function Pull({ branch, n, files }: { branch: string; n: number; files: string[] }) {',
      '  return (',
      '    <div>',
      '      <p>',
      "        from{' '}",
      '        <Branch name={branch} />',
      '      </p>',
      '      <p>',
      "        in {n}{' '}",
      '        {files.map((f) => <b key={f}>{f}</b>)}',
      '      </p>',
      "      <p>{'Merged '}<Branch name={branch} /></p>",
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const config = fixture({ 'src/Before.tsx': SPACES, 'src/After.tsx': SPACES });
    const plan = await planExtract(config, [join(config.root, 'src', 'After.tsx')], { area: 'pull', types: false });
    expect(plan.files[0]!.extractions.map((x) => `${x.message} → ${x.replacement}`)).toEqual([
      'from → <Text id="pull.from" />',
      'in {n} → <Text id="pull.in" values={{ n: n }} />',
      'Merged → <Text id="pull.merged" />{" "}',
    ]);
    applyExtract(config, plan);
    generate(config);
    const { catalog } = (await import(join(config.out, 'index.ts'))) as { catalog: Catalog };
    const props = { branch: 'main', n: 3, files: ['a.ts'] };
    const render = (Component: ComponentType<typeof props>) =>
      renderToStaticMarkup(createElement(CopyProvider, { copy: createCopy(catalog) }, createElement(Component, props)));
    const { Pull: Before } = (await import(join(config.root, 'src', 'Before.tsx'))) as { Pull: ComponentType<typeof props> };
    const { Pull: After } = (await import(join(config.root, 'src', 'After.tsx'))) as { Pull: ComponentType<typeof props> };
    expect(render(After)).toBe(render(Before));
  });

  test("an element's title is a tooltip, a component's its heading, and a sentence a description", async () => {
    const config = fixture({
      'src/Cards.tsx': [
        'const NavCard = ({ title }: { title: string }) => <h3>{title}</h3>;',
        'export function Cards() {',
        '  return (',
        '    <div>',
        '      <NavCard title="Billing" />',
        '      <span title="Copy link">⧉</span>',
        '      <span title="Copies the link to this page, for sharing.">?</span>',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
    });
    const plan = await planExtract(config, [join(config.root, 'src', 'Cards.tsx')], { types: false });
    expect(plan.entries.map((e) => `${e.key} ${e.kind}/${e.surface}`)).toEqual([
      'cards.billing-title name/heading',
      'cards.copy-link-tooltip name/tooltip',
      'cards.copies-the-link-to-tooltip description/tooltip',
    ]);
  });

  test('words several areas say go in the shared area, or are named', async () => {
    const files = {
      'copy/catalog/dialog.yaml': 'dialog.cancel:\n  kind: action\n  surface: action\n  context: Closes the dialog.\n  en: Cancel\n',
      'src/Cart.tsx': 'export const Cart = () => <button>Cancel</button>;\n',
      'src/Plan.tsx': 'export const Plan = () => <><button>Cancel</button><p>Your plan</p></>;\n',
    };
    const paths = (root: string) => ['src/Cart.tsx', 'src/Plan.tsx'].map((p) => join(root, p));
    const loose = fixture(files);
    const plan = await planExtract(loose, paths(loose.root), { types: false });
    expect(plan.entries.map((e) => e.key)).toEqual(['cart.cancel', 'plan.cancel', 'plan.your-plan']);
    expect(plan.warnings).toEqual([
      '"Cancel" is an entry in 3 areas (dialog.cancel, cart.cancel, plan.cancel): set extract.shared in the config to keep words like it in one',
    ]);

    const config = fixture(files, { extract: { shared: 'common' } });
    const shared = await planExtract(config, paths(config.root), { types: false });
    expect(shared.entries.map((e) => e.key)).toEqual(['common.cancel', 'plan.your-plan']);
    expect(shared.files.flatMap((f) => f.extractions).map((x) => `${x.key}${x.reused ? ' (reused)' : ''}`)).toEqual([
      'common.cancel',
      'common.cancel (reused)',
      'plan.your-plan',
    ]);
    expect(shared.warnings).toEqual([]);
    expect(writingGuide(config)).toContain('are one entry in `common.yaml`: read that one rather than adding another.');
  });

  test('two files that would share an area each take their folder too, and say so', async () => {
    const config = fixture({
      'src/routes/notifications.tsx': 'export const Page = () => <h1>Notifications</h1>;\n',
      'src/components/Notifications.tsx': 'export const List = () => <p>Nothing new</p>;\n',
      'src/components/Cart.tsx': 'export const Cart = () => <p>Your cart</p>;\n',
    });
    const paths = ['src/routes/notifications.tsx', 'src/components/Notifications.tsx', 'src/components/Cart.tsx'];
    const plan = await planExtract(
      config,
      paths.map((p) => join(config.root, p)),
      { types: false },
    );
    expect(plan.entries.map((e) => e.key)).toEqual([
      'routes-notifications.notifications',
      'components-notifications.nothing-new',
      'cart.your-cart',
    ]);
    expect(plan.files[0]!.warnings).toEqual([
      "src/routes/notifications.tsx and src/components/Notifications.tsx would share the area notifications, so each takes its folder's name: src/routes/notifications.tsx → routes-notifications, src/components/Notifications.tsx → components-notifications. Pass --area to choose",
    ]);
    expect(plan.files[2]!.warnings).toEqual([]);
  });

  test('a label and the hint under it are two entries, where JSX renders them with no space', async () => {
    const config = fixture({
      'src/Init.tsx': [
        'export function Init() {',
        '  return (',
        '    <label>',
        '      Init commands',
        '      <span className="hint">A bash script run as the sandbox starts.</span>',
        '    </label>',
        '  );',
        '}',
        'export const Terms = () => <p>Read the <span>Terms</span> first.</p>;',
      ].join('\n'),
    });
    const [file] = (await planExtract(config, [join(config.root, 'src', 'Init.tsx')], { types: false })).files;
    expect(file!.extractions.map((x) => x.message)).toEqual([
      'Init commands',
      'A bash script run as the sandbox starts.',
      'Read the <span>Terms</span> first.',
    ]);
  });

  test('a key is reused for the same words in the same role only', async () => {
    const config = fixture({
      'copy/catalog/find.yaml': [
        'find.search:\n  kind: action\n  surface: action\n  context: Runs the search.\n  en: Search',
        // Names no role, so any role may reuse it.
        'find.find:\n  context: Anywhere.\n  en: Find',
      ].join('\n'),
      'src/Find.tsx': [
        'export function Find() {',
        '  return (',
        '    <form aria-label="Search">',
        '      <input placeholder="Search" />',
        '      <dl><dt>Search</dt></dl>',
        '      <button>Search</button>',
        '      <button>Search</button>',
        '      <button>Find</button>',
        '    </form>',
        '  );',
        '}',
      ].join('\n'),
    });
    const [file] = (await planExtract(config, [join(config.root, 'src', 'Find.tsx')], { types: false })).files;
    expect(file!.extractions.map((x) => `${x.where} ${x.key}${x.reused ? ' (reused)' : ''}`)).toEqual([
      'aria-label find.search-aria',
      'placeholder find.search-placeholder',
      'text find.search-2',
      'text find.search (reused)',
      'text find.search (reused)',
      'text find.find (reused)',
    ]);
  });

  test('a key, an example value or a command is not copy', async () => {
    const config = fixture({
      'src/Bar.tsx': [
        'const Kbd = ({ children }: { children: string }) => <kbd>{children}</kbd>;',
        'export const Bar = () => (',
        '  <div>',
        '    <p>Fit to view <Kbd>F</Kbd></p>',
        '    <input placeholder="us-west-2" />',
        '    <textarea placeholder="sudo apt-get update && sudo apt-get install -y jq" />',
        "    <textarea placeholder={'api.example.com\\n*.example.org'} />",
        '  </div>',
        ');',
      ].join('\n'),
    });
    const [file] = (await planExtract(config, [join(config.root, 'src', 'Bar.tsx')], { types: false })).files;
    expect(file!.extractions.map((x) => x.message)).toEqual(['Fit to view']);
  });

  test('markup with no words beside it is no sentence, and says nothing', async () => {
    const config = fixture({
      'tsconfig.json': TSCONFIG,
      'src/Button.tsx': [
        "import type { ReactNode } from 'react';",
        'export const Button = ({ children, icon }: { children: ReactNode; icon: ReactNode }) => (',
        '  <button>',
        '    {icon} {children}',
        '  </button>',
        ');',
      ].join('\n'),
    });
    const [file] = (await planExtract(config, [join(config.root, 'src', 'Button.tsx')])).files;
    expect(file!.extractions).toEqual([]);
    expect(file!.warnings).toEqual([]);
  });

  test('an area is named after the file, or its folder for an index', async () => {
    expect(areaOf('src/components/CartPanel.tsx')).toBe('cart-panel');
    expect(areaOf('src/routes/settings/index.tsx')).toBe('settings');
    expect(areaOf('src/HTMLViewer.tsx')).toBe('html-viewer');
    expect(areaOf('src/GitHubConnect.tsx')).toBe('github-connect');
    expect(areaOf('src/AcmeCorpPanel.tsx', ['AcmeCorp'])).toBe('acmecorp-panel');
  });

  test("a key is the message's first words, whole", () => {
    expect(slugOf("The last run couldn't start")).toBe('the-last-run-couldnt');
    expect(slugOf('The GitHub app’s settings')).toBe('the-github-apps-settings');
  });
});
