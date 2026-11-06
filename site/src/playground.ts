// The playground: `prosebook/playground`, the real tools built for the browser, over a catalog the
// visitor edits. Loaded once the section is near, as the tools weigh more than the rest of the page.
// The tool's own words (problems, findings, generated code) are prosebook's, in English; the page's
// words around them are this site's catalog.
import { createCopy, type Copy } from 'prosebook';
import type * as Playground from 'prosebook/playground';
import type { Files, Finding, Message, Played, Problem, ProsebookConfig } from 'prosebook/playground';

import { t } from './copy.ts';
import { highlightCatalog, highlightCode } from './playground/highlight.ts';
import { CATALOG, FILES, GERMAN } from './playground/starter.ts';

type Engine = typeof Playground;

const CONFIG: ProsebookConfig = {
  pseudo: 'en-XA',
  lint: { extends: 'strict' },
  native: [
    { language: 'swift', out: 'ios/Copy.swift', keys: ['order'] },
    { language: 'kotlin', out: 'android/Copy.kt', package: 'shop', keys: ['order'] },
  ],
};

const STARTER: Files = { [FILES.catalog]: CATALOG, [FILES.german]: GERMAN };

/** The generated files a tab shows, by tab. */
const GENERATED: Record<string, string> = {
  'index.ts': 'src/copy/index.ts',
  'en.ts': 'src/copy/en.ts',
  'Copy.swift': 'ios/Copy.swift',
  'Copy.kt': 'android/Copy.kt',
};

const root = document.getElementById('playground')!;
const editor = root.querySelector<HTMLTextAreaElement>('textarea')!;
const painted = root.querySelector<HTMLElement>('.ed pre')!;
const path = root.querySelector<HTMLElement>('[data-path]')!;
const status = root.querySelector<HTMLElement>('.status')!;
const out = root.querySelector<HTMLElement>('.out')!;
const lintTab = root.querySelector<HTMLButtonElement>('[data-tab="lint"]')!;

const state: {
  files: Files;
  file: string;
  tab: string;
  played?: Played;
  copies?: Map<string, Copy>;
  /** Each message's placeholder values, kept across edits while the placeholder keeps its name and kind. */
  values: Map<string, Record<string, unknown>>;
} = { files: { ...STARTER }, file: FILES.catalog, tab: 'preview', values: new Map() };

let engine: Engine | undefined;

// `props` is loose on purpose: typed per tag, the union of every element's fields is more than TypeScript will hold.
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

function say(text: string, tone?: 'ok' | 'err') {
  status.textContent = text;
  status.className = `status${tone === undefined ? '' : ` ${tone}`}`;
}

// --- Running the tools

async function run() {
  if (engine === undefined) return;
  let played: Played;
  try {
    played = engine.play(state.files, CONFIG);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), 'err');
    return;
  }
  const copies = new Map<string, Copy>();
  for (const locale of played.catalog.locales) copies.set(locale, createCopy(played.catalog, { locale, onError: () => {} }));
  await Promise.all([...copies.values()].map((c) => c.ready));
  state.played = played;
  state.copies = copies;

  const errors = played.problems.filter((p) => p.severity === 'error').length;
  lintTab.textContent = t('playground.lint', { count: played.problems.length + played.findings.length });
  if (errors > 0) say(t('playground.broken', { count: errors }), 'err');
  else say(t('playground.summary', { messages: played.messages.length, locales: played.catalog.locales.length }), 'ok');
  show();
}

let pending: ReturnType<typeof setTimeout> | undefined;
/** The highlighted copy of the text, under the textarea's transparent one, scrolled with it. */
function paint() {
  painted.innerHTML = highlightCatalog(editor.value);
  painted.scrollTop = editor.scrollTop;
}

editor.addEventListener('scroll', () => {
  painted.scrollTop = editor.scrollTop;
});

editor.addEventListener('input', () => {
  paint();
  state.files[state.file] = editor.value;
  clearTimeout(pending);
  pending = setTimeout(() => void run(), 120);
});

// Tab indents, as in an editor; Shift+Tab or Escape then Tab leaves the field.
let escaped = false;
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') escaped = true;
  if (e.key !== 'Tab' || e.shiftKey || escaped) return void (escaped = e.key === 'Escape');
  e.preventDefault();
  editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
  editor.dispatchEvent(new Event('input'));
});

function openFile(file: string) {
  state.file = file;
  editor.value = state.files[file]!;
  paint();
  path.textContent = file;
  editor.setAttribute('aria-label', file);
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-file]')) b.setAttribute('aria-pressed', String(b.dataset.file === file));
}

for (const b of root.querySelectorAll<HTMLButtonElement>('[data-file]')) b.addEventListener('click', () => openFile(b.dataset.file!));
for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab!;
    for (const other of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) other.setAttribute('aria-pressed', String(other === b));
    show();
  });
}
root.querySelector('[data-reset]')!.addEventListener('click', () => {
  state.files = { ...STARTER };
  state.values.clear();
  openFile(state.file);
  void run();
});

// --- The output panel

function show() {
  const played = state.played;
  if (played === undefined) return;
  out.replaceChildren();
  out.scrollTop = 0;
  if (state.tab === 'preview') out.append(...played.messages.map(preview));
  else if (state.tab === 'lint') out.append(lintList(played));
  else showFile(played.generated[GENERATED[state.tab]!]);
}

/** A generated file, scrolled to its first message: native files open with a runtime the messages call. */
function showFile(text: string | undefined) {
  if (text === undefined) {
    out.append(h('p', { className: 'empty' }, t('playground.missing')));
    return;
  }
  const pre = h('pre');
  pre.innerHTML = highlightCode(text);
  out.append(pre);
  const first = text.split('\n').findIndex((line) => /^\s*(?:public func|fun) /.test(line));
  if (first > 4) out.scrollTop = (first - 4) * parseFloat(getComputedStyle(pre).lineHeight);
}

// --- Preview: each message with a field per placeholder, rendered in every locale

type Field = { kind: 'number' | 'date' | 'text' | 'list' | 'boolean' } | { kind: 'select'; arms: string[] };

/** The field a placeholder's TypeScript type asks for, as `generate` writes it. */
function fieldOf(type: string): Field {
  if (/\bDate\b/.test(type)) return { kind: 'date' };
  if (/\bstring\[\]/.test(type)) return { kind: 'list' };
  if (type === 'boolean') return { kind: 'boolean' };
  // `"packed" | "shipped" | (string & {})`: the arms a select names, and `other` where it's open.
  const arms = [...type.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((m) => JSON.parse(m[0]) as string);
  if (arms.length > 0) return { kind: 'select', arms: type.includes('string & {}') ? [...arms, 'other'] : arms };
  if (/\bnumber\b/.test(type)) return { kind: 'number' };
  return { kind: 'text' };
}

function sample(name: string, field: Field): unknown {
  switch (field.kind) {
    case 'number':
      return /amount|price|total|cost/i.test(name) ? 42.5 : 3;
    case 'date':
      return new Date(Date.now() + 3 * 86_400_000);
    case 'list':
      return ['grep', 'sed', 'awk'];
    case 'boolean':
      return true;
    case 'select':
      return field.arms[0];
    case 'text':
      return /name/i.test(name) ? 'Ada' : name;
  }
}

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function valuesOf(m: Message): Record<string, unknown> {
  const kept = state.values.get(m.key) ?? {};
  const values: Record<string, unknown> = {};
  for (const [name, type] of m.args) {
    const field = fieldOf(type);
    const was = kept[name];
    const fits =
      was !== undefined &&
      (field.kind === 'select' ? typeof was === 'string' && field.arms.includes(was) : sampleKind(sample(name, field)) === sampleKind(was));
    values[name] = fits ? was : sample(name, field);
  }
  state.values.set(m.key, values);
  return values;
}

const sampleKind = (v: unknown) => (v instanceof Date ? 'date' : Array.isArray(v) ? 'list' : typeof v);

function input(m: Message, name: string, field: Field, values: Record<string, unknown>, rerender: () => void): HTMLElement {
  const set = (v: unknown) => {
    values[name] = v;
    rerender();
  };
  const value = values[name];
  if (field.kind === 'select') {
    const select = h('select', {}, ...field.arms.map((arm) => h('option', { value: arm, selected: arm === value }, arm)));
    select.addEventListener('change', () => set(select.value));
    return select;
  }
  if (field.kind === 'boolean') {
    const box = h('input', { type: 'checkbox', checked: value === true });
    box.addEventListener('change', () => set(box.checked));
    return box;
  }
  const text = h('input', {
    type: field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text',
    value: value instanceof Date ? dayOf(value) : Array.isArray(value) ? value.join(', ') : String(value),
    step: 'any',
  });
  text.addEventListener('input', () => set(read(field.kind, text.value)));
  text.setAttribute('aria-label', `${m.key} ${name}`);
  return text;
}

/** A field's text as the value its placeholder takes; nothing where it's empty, which shows the placeholder. */
function read(kind: Field['kind'], raw: string): unknown {
  if (raw === '') return undefined;
  if (kind === 'number') return Number(raw);
  if (kind === 'date') return new Date(`${raw}T12:00`);
  if (kind === 'list') return raw.split(',').map((s) => s.trim());
  return raw;
}

/** What a tag wraps, as the page would render it. */
function tagged(tag: string) {
  return (chunks: unknown[]) => {
    const el = tag === 'link' || tag === 'a' ? h('a', { href: '#playground' }) : h(tag === 'b' || tag === 'strong' ? 'b' : 'u');
    el.append(...chunks.map((c) => (c instanceof Node ? c : String(c))));
    return el;
  };
}

function preview(m: Message): HTMLElement {
  const values = valuesOf(m);
  const says = h('div', { className: 'says' });
  const render = () => {
    const copies = state.copies!;
    const catalog = state.played!.catalog;
    const tags = Object.fromEntries(m.tags.map((tag) => [tag, tagged(tag)]));
    says.replaceChildren();
    for (const [locale, copy] of copies) {
      const own = catalog.messages[locale]?.[m.key] !== undefined;
      // A copy of the visitor's catalog, not the site's: none of its keys is the site's to keep.
      const parts = copy.rich(m.key as never, { ...values, ...tags } as never); // prosebook-ignore
      const line = h('span', { className: own ? 'said' : 'said fallback' }, ...parts.map((p) => (p instanceof Node ? p : String(p))));
      if (!own) line.title = t('playground.fallback', { locale });
      says.append(h('span', { className: 'loc' }, locale), line);
    }
  };
  render();
  const fields = [...m.args].map(([name, type]) => h('label', {}, h('span', {}, name), input(m, name, fieldOf(type), values, render)));
  return h(
    'div',
    { className: 'msg' },
    h('div', { className: 'key' }, m.key),
    ...(fields.length > 0 ? [h('div', { className: 'args' }, ...fields)] : []),
    says,
  );
}

// --- Lint: the catalog's problems, then the writing rules' findings, each fix one click

function lintList(played: Played): HTMLElement {
  const items = [...played.problems.map(problemItem), ...played.findings.map(findingItem)];
  if (items.length === 0) return h('p', { className: 'empty ok' }, t('playground.clean'));
  return h('ul', { className: 'findings' }, ...items);
}

const where = (file: string | undefined, key: string | undefined) =>
  h('span', { className: 'where' }, [key, file === FILES.german ? 'de' : undefined].filter(Boolean).join(' · '));

function problemItem(p: Problem): HTMLElement {
  return h('li', { className: p.severity }, h('div', {}, where(p.file, p.key), h('div', {}, p.message)));
}

function findingItem(f: Finding): HTMLElement {
  const body = h('div', {}, where(f.file, f.key), h('div', {}, f.message, ' ', h('code', {}, f.rule)));
  const li = h('li', { className: f.severity }, body);
  if (f.fix !== undefined) {
    const button = h('button', { type: 'button', className: 'toggle' }, t('playground.fix'));
    button.addEventListener('click', () => {
      const fixed = engine!.fix(state.files, [f], CONFIG);
      if (fixed.problems.length > 0) return say(fixed.problems.map((p) => p.message).join('; '), 'err');
      state.files = fixed.files;
      openFile(state.file);
      void run();
    });
    li.append(button);
  }
  return li;
}

// --- Loading

openFile(FILES.catalog);
say(t('playground.loading'));

let started = false;
function start() {
  if (started) return;
  started = true;
  near.disconnect();
  import('prosebook/playground')
    .then((loaded) => {
      engine = loaded;
      return run();
    })
    .catch((e: unknown) => say(t('playground.failed', { reason: e instanceof Error ? e.message : String(e) }), 'err'));
}

// Once the section is near, or anything in it is focused first.
const near = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && start(), { rootMargin: '600px' });
near.observe(root);
root.addEventListener('focusin', start);
