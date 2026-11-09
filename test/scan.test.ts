import { describe, expect, test } from 'bun:test';

import { formattedInCode, hardcodedText, isReferenced, keyRefs, looksLikeCode, unseenReads, type ProsebookConfig } from 'prosebook/tools';

import { scan, whereOf } from '#src/tools/scan.ts';
import { fixture } from './fixture.ts';

describe('hardcoded text', () => {
  const ATTRS = { attributes: ['alt', 'title', 'placeholder', 'aria-label'] };
  const found = (file: string, code: string, options = {}) =>
    hardcodedText(file, code, { ...ATTRS, ...options }).map((h) => `${h.line}:${h.column} ${whereOf(h) || 'text '}${h.text}`);

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
    expect(found('A.tsx', code)).toEqual([
      '4:17 title=Edit profile',
      '5:11 text Your profile',
      '6:27 placeholder=Search',
      '12:8 text Literal child',
    ]);
  });

  test('finds what expressions render: both arms, fallbacks and templates, in text and attributes', () => {
    const code = `
export const A = ({ pending, name, x, ok, cls }) => (
  <div className={\`flex \${cls}\`}>
    <button>{pending ? 'Saving…' : 'Save'}</button>
    <p>{x ?? 'None'} {ok && 'Ready'} {name || \`Guest\`}</p>
    <a aria-label={\`Open \${name}\`} title={ok ? 'Open' : undefined}>{\`\${x} \${name}\`}</a>
    <i>{t(ok ? 'app.on' : 'app.off')}</i>
  </div>
);`;
    expect(found('A.tsx', code)).toEqual([
      '4:24 text Saving…',
      '4:36 text Save',
      '5:14 text None',
      '5:29 text Ready',
      '5:47 text Guest',
      '6:20 aria-label=Open ${name}',
      '6:48 title=Open',
    ]);
  });

  test('finds what notices are given and what label properties hold, outside tests', () => {
    const code = `
export const STATUS = [{ value: 'started', label: 'Started' }, { value: 'done', label: \`Done\` }];
export function save() {
  toast.success('Saved');
  toast.promise(run(), { loading: 'Saving…', error: (e) => e.message });
  alert(failed ? 'It failed' : 'It worked');
  log('Not shown');
  return { header: 'Name', accessorKey: 'name' };
}`;
    const options = { calls: ['toast', 'alert'], properties: ['label', 'header'] };
    expect(found('A.tsx', code, options)).toEqual([
      '2:51 label: Started',
      '2:88 label: Done',
      '4:17 toast.success(…) Saved',
      '5:35 toast.promise(…) Saving…',
      '6:18 alert(…) It failed',
      '6:32 alert(…) It worked',
      '8:20 header: Name',
    ]);
    expect(found('A.test.tsx', code, options)).toEqual([]);
    expect(found('A.stories.tsx', 'export const S = () => <Drawer title="Filters">Pick a range</Drawer>;')).toEqual([]);
    expect(found('A.spec.helper.tsx', 'export const H = () => <p>Panel content</p>;')).toEqual([]);
    expect(found('A.stories.helpers.tsx', 'export const H = () => <p>Panel content</p>;')).toEqual([]);
    // Outside a component, a title or description is as often a model's or an API's.
    expect(found('A.ts', code, options).filter((f) => f.includes(': '))).toEqual([]);
  });
});

test('numbers, dates and lists formatted in code are found, with the copy method and named format to read', () => {
  const formats = { number: { price: { style: 'currency', currency: 'USD' } }, date: { day: { dateStyle: 'medium' } } } as const;
  const code = `
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const big = new Intl.NumberFormat(undefined, { notation: 'compact' });
export const Row = ({ n, when, names, rows }) => (
  <p>
    {n.toLocaleString()} {when.toLocaleDateString()} {when.toLocaleString('en', { dateStyle: 'medium' })}
    {names.join(', ')} {rows.join('\\n')}
    {/* prosebook-ignore */}
    {n.toLocaleString()}
  </p>
);`;
  const found = (file: string) => formattedInCode(file, code, formats).map((f) => `${f.line} ${f.code}: ${f.fix}`);
  expect(found('Row.tsx')).toEqual([
    "2 new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }): copy.number(…, 'price'), which shows it as the format the config names",
    "3 new Intl.NumberFormat(undefined, { notation: 'compact' }): copy.number(…) with these options, or name them under formats.number and pass the name",
    "6 n.toLocaleString(): copy.number(n) or copy.date(n), in the copy's locale",
    "6 when.toLocaleDateString(): copy.date(when), in the copy's locale",
    "6 when.toLocaleString('en', { dateStyle: 'medium' }): copy.date(when, 'day'), which shows it as the format the config names",
    "7 names.join(', '): copy.list(names), in the copy's locale",
  ]);
  // Only a component's join is a list a person reads; tests and stories are left out.
  expect(found('row.ts').some((f) => f.includes('join'))).toBe(false);
  expect(found('Row.test.tsx')).toEqual([]);
});

test.each([
  ['names.sort((a, b) => a.localeCompare(b))', "a.localeCompare(b): copy.compare(a, b), in the copy's locale"],
  [
    'repos.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))',
    "a.name.localeCompare(b.name, undefined, { numeric: true }): copy.compare(a.name, b.name, { numeric: true }), in the copy's locale",
  ],
  [
    'tools.sort((a, b) => a.label.localeCompare(b.label, []))',
    "a.label.localeCompare(b.label, []): copy.compare(a.label, b.label), in the copy's locale",
  ],
  ['new Intl.Collator().compare', "new Intl.Collator(): copy.collator(), in the copy's locale"],
  [
    "new Intl.Collator(undefined, { sensitivity: 'base' })",
    "new Intl.Collator(undefined, { sensitivity: 'base' }): copy.collator({ sensitivity: 'base' }), in the copy's locale",
  ],
  // A locale written in is the code's choice; ids and ISO times sort as raw strings, not as words.
  ["a.localeCompare(b, 'en')", undefined],
  ["new Intl.Collator('en')", undefined],
  ['runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))', undefined],
  ['rows.sort((a, b) => a.id.localeCompare(b.id))', undefined],
  ['rows.sort((a, b) => a.started_at.localeCompare(b.started_at))', undefined],
  ['rows.sort((a, b) => a.repoId.localeCompare(b.repoId))', undefined],
  ['rows.sort((a, b) => a.chat.localeCompare(b.chat))', "a.chat.localeCompare(b.chat): copy.compare(a.chat, b.chat), in the copy's locale"],
])('a sort in a component, %s, is found: %p', (expression, said) => {
  const code = `export const List = ({ names, repos, tools, runs, rows, a, b }) => <p>{String(${expression})}</p>;`;
  expect(formattedInCode('List.tsx', code).map((f) => `${f.code}: ${f.fix}`)).toEqual(said === undefined ? [] : [said]);
  // Outside a component, a sort is as often of data no one reads.
  expect(formattedInCode('list.ts', code)).toEqual([]);
});

test.each([
  // [the expression, as a JSX child; what it is found as, or nothing]
  ['{n.toFixed(1)}', 'n.toFixed(1): copy.number(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 })'],
  ['{n.toFixed()}', 'n.toFixed(): copy.number(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 })'],
  ['{n.toPrecision(3)}', 'n.toPrecision(3): copy.number(n, { minimumSignificantDigits: 3, maximumSignificantDigits: 3 })'],
  [
    '{ms.toFixed(1)} ms',
    "ms.toFixed(1): copy.number(ms, { minimumFractionDigits: 1, maximumFractionDigits: 1, style: 'unit', unit: 'millisecond' })",
  ],
  ['{size} MB', "size: copy.number(size, { style: 'unit', unit: 'megabyte' })"],
  ['{pct}%', "pct: copy.number(pct, { style: 'unit', unit: 'percent' })"],
  [
    '{`${rate.toFixed(2)} Mbps`}',
    "rate.toFixed(2): copy.number(rate, { minimumFractionDigits: 2, maximumFractionDigits: 2, style: 'unit', unit: 'megabit-per-second' })",
  ],
  ["{size + ' GB'}", "size: copy.number(size, { style: 'unit', unit: 'gigabyte' })"],
  ['{temp}&nbsp;°C', "temp: copy.number(temp, { style: 'unit', unit: 'celsius' })"],
  // Named, where a format of the config's shows the same.
  ['{n.toFixed(2)}', "n.toFixed(2): copy.number(n, 'fixed'), which shows it as the format the config names"],
  // Words after a value, a style, arithmetic, digits worked out in code: none is a number shown.
  ['{count} items', undefined],
  ['<div style={{ width: `${w.toFixed(2)}px` }} />', undefined],
  ['<div style={{ width: w.toFixed(0) + "%" }} />', undefined],
  ['<div data-ratio={r.toFixed(2)} />', undefined],
  ['{`${w.toFixed(1)}px`}', undefined],
  ['{Number(n.toFixed(2))}', undefined],
  ['{+n.toFixed(2)}', undefined],
  ['{n.toFixed(digits)}', undefined],
  ['{n.toPrecision()}', undefined],
  ["{t('size.mb', { size })} MB", undefined],
])('a number shown in a component, %s, is found: %p', (shown, said) => {
  const formats = { number: { fixed: { minimumFractionDigits: 2, maximumFractionDigits: 2 } } } as const;
  const code = `export const Metric = ({ n, ms, size, pct, rate, temp, w, r, count, digits, t }) => <p>${shown}</p>;`;
  const fix = (f: { fix: string }) => f.fix.replace(/, in the copy's locale$|, or name them under formats\.number and pass the name$/, '');
  expect(formattedInCode('Metric.tsx', code, formats).map((f) => `${f.code}: ${fix(f)}`)).toEqual(said === undefined ? [] : [said]);
  expect(formattedInCode('metric.ts', `export const m = (n) => \`\${n.toFixed(1)} ms\`;`)).toEqual([]);
});

test('a formatter only asked its options formats nothing', () => {
  const code = [
    'export const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;',
    'export const locale = (new Intl.NumberFormat()).resolvedOptions().locale;',
    'export const day = new Intl.DateTimeFormat().format(new Date());',
  ].join('\n');
  expect(formattedInCode('zone.ts', code).map((f) => `${f.line} ${f.code}`)).toEqual(['3 new Intl.DateTimeFormat()']);
});

test('scan.ignore keeps a check out of a folder', () => {
  const files = {
    'src/App.tsx': 'export const App = ({ n }) => <p>Total {n.toLocaleString()}</p>;\n',
    'src/server/tools.ts': 'export const result = (n: number) => `${n.toLocaleString()} rows`;\n',
  };
  const formatted = (config: ProsebookConfig) => {
    const c = fixture(files, config);
    return scan(c.scan, c.root).formatted.map((f) => f.file);
  };
  expect(formatted({})).toEqual(['src/App.tsx', 'src/server/tools.ts']);
  expect(formatted({ scan: { ignore: { 'formatted-in-code': ['src/server/'] } } })).toEqual(['src/App.tsx']);
  expect(formatted({ scan: { ignore: { 'formatted-in-code': ['./src/server'] } } })).toEqual(['src/App.tsx']);
  const c = fixture(files, { scan: { ignore: { 'formatted-in-code': ['src/server'] } } });
  expect(scan(c.scan, c.root).hardcoded.map((h) => h.text)).toEqual(['Total ${n.toLocaleString()}']);
  expect(() => fixture({}, { scan: { ignore: { formatted: ['src'] } as never } })).toThrow(
    'scan.ignore.formatted is not a check scan runs file by file: hardcoded-text, formatted-in-code, or * for all',
  );
});

test('scan.ignore takes globs, and * for every check', () => {
  const files = {
    'src/App.tsx': 'export const App = ({ n }) => <p>Total {n.toLocaleString()}</p>;\n',
    'src/features/billing/server/rows.ts': 'export const rows = (n: number) => n.toLocaleString();\n',
    'src/features/billing/api.server.ts': 'export const sum = (n: number) => n.toLocaleString();\n',
    'src/admin/Panel.tsx': "export const Panel = ({ n }) => <p>Raw {n.toLocaleString()} {t('admin.raw')}</p>;\n",
  };
  const found = (ignore: NonNullable<ProsebookConfig['scan']>['ignore']) => {
    const c = fixture(files, { scan: { ignore } });
    const { hardcoded, formatted, refs } = scan(c.scan, c.root);
    return { hardcoded: hardcoded.map((h) => h.file), formatted: formatted.map((f) => f.file), refs: [...refs.exact] };
  };
  expect(found({ 'formatted-in-code': ['**/server', '**/*.server.ts'] }).formatted).toEqual(['src/App.tsx', 'src/admin/Panel.tsx']);
  expect(found({ 'formatted-in-code': ['src/features/*'] }).formatted).toEqual(['src/App.tsx', 'src/admin/Panel.tsx']);
  // Every check leaves the folder, but the keys it names still count.
  expect(found({ '*': ['src/admin'] })).toEqual({
    hardcoded: ['src/App.tsx'],
    formatted: ['src/App.tsx', 'src/features/billing/api.server.ts', 'src/features/billing/server/rows.ts'],
    refs: ['admin.raw'],
  });
});

test('JSX text is one sentence across its values and its two-string picks, its entities decoded, and classes are no text', () => {
  const code = `
export const A = ({ clientName, user, n }) => (
  <p className="block h-full">
    Could not allow access. Use another account or restart from {clientName}.
    <span>Advanced Settings&nbsp;</span>
    <b>Agent version &ge; {user.version}</b>
    <i>Hello{' '}{user.name}, you have {n === 1 ? 'one item' : 'items'}</i>
    <Tooltip label={cn('px-2', 'Not prose')} title="A &amp; B" />
  </p>
);
const pill = tv({ slots: { label: 'block h-full cursor-[inherit] truncate' } });`;
  expect(
    hardcodedText('A.tsx', code, { attributes: ['title', 'label'], properties: ['label'] }).map(
      (h) => `${h.line}:${h.column} ${whereOf(h) || 'text '}${h.text}`,
    ),
  ).toEqual([
    '4:5 text Could not allow access. Use another account or restart from ${clientName}.',
    '5:11 text Advanced Settings',
    '6:8 text Agent version ≥ ${user.version}',
    "7:8 text Hello ${user.name}, you have ${n === 1 ? 'one item' : 'items'}",
    '8:52 title=A & B',
  ]);
});

test('code-like tokens are not prose', () => {
  const code = ['form.json()', 'src/index.ts', 'snake_case', 'a::b', 'x=1', 'us-west-2', 'api.example.com\n*.example.org'];
  const classes = ['block h-full cursor-[inherit]', 'md:px-2 text-sm', 'w-1/2', 'hover:bg-red-500/50 !mt-0'];
  const commands = ['sudo apt-get update && sudo apt-get install -y postgresql-client', 'npm install --save-dev x', '$ ls'];
  expect([...code, ...classes, ...commands].filter((t) => !looksLikeCode(t))).toEqual([]);
  const prose = [
    'Done.',
    'Hello world',
    'e-mail',
    'Save!',
    'fieldspec',
    'Wait 5-10 minutes',
    'Settings > General',
    'Visit example.com today',
    'sign-in required',
    'block',
  ];
  expect(prose.filter(looksLikeCode)).toEqual([]);
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

  test("a read through a module's const map of keys is seen, and through any other map is not", () => {
    const code = [
      "const STATUS = { started: 'run.started', done: 'run.done' } as const;",
      "export const KINDS = [{ label: 'kind.a', icon: 'a' }, { label: 'kind.b', icon: 'b' }];",
      "const LABELS = { started: 'Started' };",
      'let loose = { a: "run.started" };',
      't(STATUS[s]);',
      '<Text id={KINDS[i].label} />;',
      't(KINDS[i].icon);',
      't(LABELS[s]);',
      't(loose[s]);',
    ].join('\n');
    expect(unseen(code)).toEqual(['7:1 t t(KINDS[i].icon)', '8:1 t t(LABELS[s])', '9:1 t t(loose[s])']);
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

  const at = (file: string, code: string) => unseenReads(file, code).unseen.map((u) => `${u.line}:${u.column} ${u.name} ${u.code}`);

  test("a Vue component's reads are found in its script and its template, at their lines", () => {
    const code = [
      '<script setup lang="ts">',
      "import { Text, useCopy } from 'prosebook/vue';",
      'const { t } = useCopy();',
      "const title = t('a.title') + t(name);",
      '</script>',
      '',
      '<template>',
      '  <h1 :title="t(hint)">{{ t(`a.${id}`) }} {{ copy.t(item.key) }}</h1>',
      '  <Text id="a.items" :values="{ n }" /><Text :id="key" />',
      "  <Text :id=\"on ? 'a.on' : 'a.off'\" />",
      '  <!-- prosebook-ignore: every key is in the tabs array -->',
      '  <li v-for="tab in tabs" @click="pick(tab)">{{ t(tab.key) }}</li>',
      '</template>',
      '<style>h1 { color: red }</style>',
    ].join('\n');
    expect(at('A.vue', code)).toEqual([
      // Kept for the build to match against aliases bound elsewhere, as in a script.
      '3:15 useCopy useCopy()',
      '4:30 t t(name)',
      '8:15 t t(hint)',
      '8:46 t copy.t(item.key)',
      '9:40 Text <Text :id="key" />',
    ]);
  });

  test("a Svelte component's reads are found in its script and its markup, blocks and attributes alike", () => {
    const code = [
      '<script lang="ts">',
      "  import { getCopy, Text } from 'prosebook/svelte';",
      '  const copy = getCopy();',
      '</script>',
      '',
      '{#each items as item (item.id)}',
      '  <p title={copy.t(item.hint)}>{copy.t(`a.${item.id}`)}</p>',
      '{:else}',
      '  {@const label = copy.t(empty)}',
      '{/each}',
      '{#if copy.has(key)}<Text id={key} />{:else if ready}<Text {id} />{/if}',
      '<Text id="a.items" values={{ n: copy.t(count) }} /><Text id="a.{name}" />',
      '{#snippet link(chunks)}<a href="#"><Text {chunks} /></a>{/snippet}',
      '<style>p { margin: 0 }</style>',
    ].join('\n');
    expect(at('A.svelte', code)).toEqual([
      '3:16 getCopy getCopy()',
      '7:13 t copy.t(item.hint)',
      '9:19 t copy.t(empty)',
      '11:20 Text <Text id={key} />',
      '11:53 Text <Text {id} />',
      '12:33 t copy.t(count)',
      '12:52 Text <Text id="a.{name}" />',
    ]);
  });

  test("an Astro component's reads are found in its frontmatter, its markup's expressions, markup in them included, and its scripts", () => {
    const code = [
      '---',
      "import { t, rich } from '../copy.ts';",
      "const title = t('a.title') + t(name);",
      '---',
      '<!-- t(commented) -->',
      '<h1 title={t(hint)}>{t(`a.${id}`)} {copy.t(item.key)}</h1>',
      "<p>{rich('a.terms', { link: (chunks) => <a href={t(href)}>{chunks}</a> })}</p>",
      "<code>{'{'} t(key) {'}'}</code>",
      '<ul>{items.map((item) => <li {...t(spread)}>{t(item.key)}</li>)}</ul>',
      '<script>',
      "  import { t } from '../copy.ts';",
      '  document.title = t(later);',
      '</script>',
      '<style>h1 { color: red }</style>',
    ].join('\n');
    expect(at('A.astro', code)).toEqual([
      '3:30 t t(name)',
      '6:12 t t(hint)',
      '6:37 t copy.t(item.key)',
      '7:50 t t(href)',
      '9:34 t t(spread)',
      '9:46 t t(item.key)',
      '12:20 t t(later)',
    ]);
  });
});
