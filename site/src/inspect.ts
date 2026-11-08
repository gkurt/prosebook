// The inspector over this page, built: hold Alt (or press Inspect) and click any of its words to edit
// their entry, held to the real lint by `prosebook/playground`. In an app the dev server does this
// against your files; here the page carries what it read as it was built (`copy.ts`), and edits stay
// in the page. Loaded only in the built page: in dev, the real inspector covers it. The dialog's own
// words are the tool's, which prosebook says in English; the page's words are this site's catalog.
import { createCopy } from 'prosebook';
import type * as Playground from 'prosebook/playground';
import type { Files, Finding, Played } from 'prosebook/playground';

import config from '#config';
import { reads, t } from '#src/copy.ts';

type Read = { key: string; values: Record<string, unknown> };

const REPO = 'https://github.com/gkurt/prosebook/blob/main/site/';

/** The catalog's files as written, loaded with the tools when a dialog first opens. */
const sources = import.meta.glob<string>('../copy/catalog/*.yaml', { query: '?raw', import: 'default' });

let engine: Promise<{ tools: typeof Playground; files: Files }> | undefined;
const load = () =>
  (engine ??= Promise.all([
    import('prosebook/playground'),
    Promise.all(Object.entries(sources).map(async ([path, read]) => [path.replace('../', ''), await read()] as const)),
  ]).then(([tools, files]) => ({ tools, files: Object.fromEntries(files) })));

const norm = (text: string) => text.replace(/\s+/g, ' ').trim();

const served = document.getElementById('reads')?.dataset['reads'];
const built = served === undefined ? [] : (JSON.parse(served) as [string, Read][]);
/** What the dialog has saved since, by the text it now shows. */
const saved = new Map<string, Read>();

/** What the build read, then what scripts here read since, then what was saved: the newer wins where they said the same. */
const known = () => new Map([...built, ...reads, ...saved].map(([text, read]) => [norm(text), read]));

interface Hit {
  read: Read;
  /** The text node the string is, beside others in its element, or the element it fills. */
  node: Text | Element;
}

/** Code samples and the playground's output are their own text, not the page's copy. */
const notCopy = (el: Element) => el.closest('pre, textarea, .out, .dlg, #inspect-layer') !== null;

function hitAt(x: number, y: number): Hit | undefined {
  const target = document.elementFromPoint(x, y);
  if (target === null || notCopy(target)) return undefined;
  // The text under the pointer first: "Also:" shares its paragraph with links.
  const said = known();
  const caret = document.caretPositionFromPoint?.(x, y);
  const node = caret?.offsetNode;
  if (node instanceof Text) {
    const read = said.get(norm(node.data));
    if (read !== undefined) return { read, node };
  }
  for (let el: Element | null = target; el !== null && el !== document.body; el = el.parentElement) {
    const read = said.get(norm(el.textContent ?? ''));
    if (read !== undefined) return { read, node: el };
  }
  return undefined;
}

function rectsOf(node: Text | Element): DOMRect[] {
  if (node instanceof Element) return [node.getBoundingClientRect()];
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].filter((r) => r.width > 0);
}

// One outline per line of the string under the pointer, its key on the first, as the dev inspector draws it.
const layer = Object.assign(document.createElement('div'), { id: 'inspect-layer' });
document.body.append(layer);
function show(hit: Hit | undefined) {
  if (hit === undefined) return layer.replaceChildren();
  const rects = rectsOf(hit.node);
  const label = Object.assign(document.createElement('span'), { textContent: hit.read.key });
  const first = rects[0]!;
  Object.assign(label.style, { left: `${first.left - 2}px`, top: `${first.top < 24 ? first.bottom + 2 : first.top - 22}px` });
  layer.replaceChildren(
    ...rects.map((r) => {
      const box = document.createElement('i');
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      return box;
    }),
    label,
  );
}

const toggle = document.getElementById('inspect') as HTMLButtonElement;
let inspecting = false;
let pointer = { x: 0, y: 0 };
const active = (e: { altKey: boolean }) => e.altKey || inspecting;

addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  show(active(e) ? hitAt(e.clientX, e.clientY) : undefined);
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Alt') return;
  void load();
  show(hitAt(pointer.x, pointer.y));
});
addEventListener('keyup', (e) => e.key === 'Alt' && !inspecting && show(undefined));
addEventListener('blur', () => !inspecting && show(undefined));
addEventListener('scroll', () => show(undefined), { passive: true });
toggle.addEventListener('click', () => {
  inspecting = !inspecting;
  toggle.setAttribute('aria-pressed', String(inspecting));
  document.documentElement.classList.toggle('inspecting', inspecting);
  if (inspecting) void load();
  else show(undefined);
});
// Alt-click on a link would download it; while inspecting, a click edits rather than follows.
addEventListener(
  'mousedown',
  (e) => {
    if (dialog !== undefined && !dialog.contains(e.target as Node)) close();
    if (active(e) && hitAt(e.clientX, e.clientY) !== undefined) e.preventDefault();
  },
  { capture: true },
);
addEventListener(
  'click',
  (e) => {
    if (!active(e) || e.target === toggle) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    show(undefined);
    void open(hit);
  },
  { capture: true },
);

// The dialog, as the dev inspector draws it, kept to the text and what lint says of it.
let dialog: HTMLElement | undefined;
const close = () => {
  dialog?.remove();
  dialog = undefined;
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const fileOf = (files: Files, key: string) =>
  Object.keys(files).find((path) => new RegExp(`^${key.replaceAll('.', '\\.')}:`, 'm').test(files[path]!));

/** `files` with the key's source message replaced, written as a single-quoted scalar on one line. */
function withMessage(files: Files, key: string, text: string): Files {
  const path = fileOf(files, key)!;
  const lines = files[path]!.split('\n');
  const start = lines.indexOf(`${key}:`);
  const at = lines.findIndex((l, i) => i > start && l.startsWith('  en: '));
  const quoted = `'${text.replaceAll("'", "''")}'`;
  lines[at] = `  en: ${quoted}`;
  // A message written over several lines goes with its first.
  while (lines[at + 1] !== undefined && /^ {3,}\S/.test(lines[at + 1]!)) lines.splice(at + 1, 1);
  return { ...files, [path]: lines.join('\n') };
}

async function open(hit: Hit) {
  close();
  const { tools, files } = await load();
  const { key } = hit.read;
  let current: Files = files;
  let played: Played = tools.play(current, config);
  const entry = played.messages.find((m) => m.key === key);
  if (entry === undefined) return;

  const path = fileOf(files, key)!;
  const line = files[path]!.split('\n').indexOf(`${key}:`) + 1;
  const field = make('textarea', {
    value: entry.text,
    rows: Math.min(8, Math.max(2, Math.ceil(entry.text.length / 48))),
    spellcheck: true,
  });
  const findings = make('ul', { className: 'findings' });
  const problems = make('ul', { className: 'problems' });
  /** The text lint last spoke of: a fix is made to it, and only while the field still holds it. */
  let checked = entry.text;

  const say = (found: Finding[]) =>
    findings.replaceChildren(
      ...found.map((f) => {
        const item = make(
          'li',
          {},
          make('span', { className: 'say', textContent: f.message }),
          make('span', { className: 'rule', textContent: f.rule }),
        );
        if (f.fix !== undefined) {
          const fix = make('button', { type: 'button', className: 'small', textContent: 'Fix' });
          fix.addEventListener('click', () => {
            if (field.value !== checked) return;
            const fixed = tools.fix(withMessage(current, key, field.value), [f], config);
            if (fixed.problems.length > 0)
              return problems.replaceChildren(...fixed.problems.map((p) => make('li', { textContent: p.message })));
            field.value = tools.play(fixed.files, config).messages.find((m) => m.key === key)?.text ?? field.value;
            check();
          });
          item.append(fix);
        }
        return item;
      }),
    );
  const check = () => {
    const edited = withMessage(current, key, field.value);
    played = tools.play(edited, config);
    checked = field.value;
    problems.replaceChildren(...played.problems.filter((p) => p.key === key).map((p) => make('li', { textContent: p.message })));
    say(played.findings.filter((f) => f.key === key && f.locale === config.source));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  field.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(check, 250);
  });

  const save = () => {
    clearTimeout(timer);
    check();
    if (problems.childElementCount > 0) return;
    current = withMessage(current, key, field.value);
    engine = Promise.resolve({ tools, files: current });
    swap(hit, played);
    close();
  };
  const button = (props: object, onClick: () => void) => {
    const b = make('button', { type: 'button', ...props });
    b.addEventListener('click', onClick);
    return b;
  };
  const mac = /Mac|iP/.test(navigator.platform);
  const panel = make(
    'div',
    { className: 'dlg' },
    make(
      'header',
      {},
      make('span', { className: 'key', textContent: key }),
      make('span', { className: 'grow' }),
      make('a', {
        className: 'quiet',
        href: `${REPO}${path}#L${line}`,
        target: '_blank',
        rel: 'noopener',
        textContent: `${path.split('/').pop()}:${line} ↗`,
      }),
      button({ className: 'quiet x', textContent: '×', title: 'Close (Esc)', ariaLabel: 'Close' }, close),
    ),
    make(
      'div',
      { className: 'body' },
      ...(entry.context === undefined ? [] : [make('p', { className: 'context', textContent: entry.context })]),
      make('label', {}, field, findings),
    ),
    problems,
    make(
      'footer',
      {},
      make('span', { className: 'hint grow', textContent: `${t('inspect.local')} ${mac ? '⌘' : 'Ctrl'}+Enter saves.` }),
      button({ className: 'save', textContent: 'Save' }, save),
    ),
  );
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Edit ${key}`);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  });
  document.body.append(panel);
  dialog = panel;
  check();
  // Below the string, or above it where there is no room.
  const rects = rectsOf(hit.node);
  const last = rects.at(-1)!;
  const box = panel.getBoundingClientRect();
  const below = last.bottom + 8;
  Object.assign(panel.style, {
    left: `${Math.max(12, Math.min(rects[0]!.left, innerWidth - box.width - 12))}px`,
    top: `${below + box.height <= innerHeight - 12 ? below : Math.max(12, rects[0]!.top - box.height - 8)}px`,
  });
  field.focus();
}

/** The string on the page read again from the edited catalog, its tags the page's own elements. */
function swap(hit: Hit, played: Played) {
  const elements = hit.node instanceof Element ? [...hit.node.children] : [];
  const tags: string[] = [];
  /** A tag stands for the element it stood for before, in the order the tags first come. */
  const tag = (name: string) => (chunks: (string | Node)[]) => {
    let at = tags.indexOf(name);
    if (at === -1) at = tags.push(name) - 1;
    const el = (elements[at]?.cloneNode(false) as Element | undefined) ?? document.createElement('span');
    el.append(...chunks);
    return el;
  };
  const text = played.messages.find((m) => m.key === hit.read.key)?.text ?? '';
  const named = [...new Set([...text.matchAll(/<([\w-]+)>/g)].map((m) => m[1]!))];
  const values = { ...hit.read.values, ...Object.fromEntries(named.map((name) => [name, tag(name)])) };
  const read = createCopy(played.catalog).rich as (key: string, values: object) => (string | Node)[];
  const parts = read(hit.read.key, values);
  if (hit.node instanceof Text) hit.node.data = parts.map((p) => (typeof p === 'string' ? p : p.textContent)).join('');
  else hit.node.replaceChildren(...parts);
  saved.set(hit.node.textContent ?? '', hit.read);
}
