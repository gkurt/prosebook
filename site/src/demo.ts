// A recreation of the dev inspector over the example's own cart catalog. In an app, the dev server does
// this against the running page and your real files. The shop's catalog below is the demo's data, and
// the tool's own words (its problems and findings, its dialog) are prosebook's, which it says in English;
// the page's words around them are this site's catalog.
import { rich, t } from './copy.ts';

const CATALOG = `# yaml-language-server: $schema=./catalog.schema.json
cart.title:
  kind: name
  surface: heading
  context: Heads the shopping cart panel.
  en: Cart

cart.items:
  kind: state
  surface: status
  context: Under the cart heading, counts what is in the cart.
  args:
    count: how many items are in the cart
  en: '{count, plural, =0 {Your cart is empty.} one {# item in your cart.} other {# items in your cart.}}'

cart.total:
  kind: state
  surface: status
  context: The sum of the cart, beside the checkout button.
  args:
    amount: the total price, in euros
  fragment: true
  en: 'Total: {amount, number, ::currency/EUR}'

cart.add:
  kind: action
  surface: action
  context: The button on a product that adds one to the cart.
  en: Add to cart

cart.remove:
  kind: action
  surface: action
  context: The button that empties the cart.
  en: Empty cart

cart.checkout:
  kind: action
  surface: action
  context: The button that starts paying for the cart.
  en: Check out...

cart.terms:
  kind: description
  surface: hint
  context: Under the checkout button. The link opens the terms of sale.
  en: By checking out you agree to our <link>terms of sale</link>.

cart.shipping:
  kind: description
  surface: hint
  context: Under the total, says how long delivery takes.
  args:
    days: how many working days delivery takes
  en: 'Arrives in {days, plural, one {# working day} other {# working days}}.'`;

const GERMAN = `cart.title: Warenkorb
cart.items: '{count, plural, =0 {Dein Warenkorb ist leer.} one {# Artikel im Warenkorb.} other {# Artikel im Warenkorb.}}'
cart.total: 'Summe: {amount, number, ::currency/EUR}'
cart.add: In den Warenkorb
cart.remove: Warenkorb leeren
cart.checkout: Zur Kasse...
cart.terms: Mit der Bestellung stimmst du unseren <link>Verkaufsbedingungen</link> zu.`;

type Locale = 'en' | 'de';

const files: Record<Locale, { path: string; lines: string[] }> = {
  en: { path: 'copy/catalog/cart.yaml', lines: CATALOG.split('\n') },
  de: { path: 'copy/locales/de/cart.yaml', lines: GERMAN.split('\n') },
};

const unquote = (v: string): string =>
  v.startsWith("'") ? v.slice(1, -1).replaceAll("''", "'") : v.startsWith('"') ? (JSON.parse(v) as string) : v;
const quote = (v: string) => (/[{}<>:#'"]|^\s|\s$/.test(v) ? `'${v.replaceAll("'", "''")}'` : v);

/** Where a key's message is in a file: the line its entry starts on, the message's line, and the text before the value on it. */
interface Spot {
  start: number;
  line: number;
  prefix: string;
}

function locate(locale: Locale, key: string): Spot | undefined {
  const { lines } = files[locale];
  if (locale === 'de') {
    const line = lines.findIndex((l) => l.startsWith(`${key}: `));
    return line === -1 ? undefined : { start: line, line, prefix: `${key}: ` };
  }
  const start = lines.indexOf(`${key}:`);
  if (start === -1) return undefined;
  const line = lines.findIndex((l, i) => i > start && l.startsWith('  en: '));
  return { start, line, prefix: '  en: ' };
}

function message(locale: Locale, key: string): string | undefined {
  const at = locate(locale, key);
  return at && unquote(files[locale].lines[at.line]!.slice(at.prefix.length));
}

// Just enough ICU for these messages: arguments, plural and select, `#` and tags.
type Part = string | { hash: true } | { tag: string; children: Part[] } | { arg: string; type?: string; arms?: Record<string, Part[]> };

function parse(src: string): Part[] {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`${what} at character ${i + 1}`);
  };
  const eat = (ch: string) => (src[i] === ch ? i++ : fail(`expected "${ch}"`));
  const skip = () => {
    while (src[i] === ' ') i++;
  };
  const word = () => {
    skip();
    const m = /^[=\w-]+/.exec(src.slice(i)) ?? fail('expected a name');
    i += m[0].length;
    skip();
    return m[0];
  };
  const nodes = (): Part[] => {
    const out: Part[] = [];
    let text = '';
    const flush = () => {
      if (text) out.push(text);
      text = '';
    };
    while (i < src.length && src[i] !== '}' && !(src[i] === '<' && src[i + 1] === '/')) {
      if (src[i] === '{') {
        flush();
        out.push(arg());
      } else if (src[i] === '<') {
        flush();
        out.push(tag());
      } else if (src[i] === '#') {
        flush();
        out.push({ hash: true });
        i++;
      } else {
        text += src[i++];
      }
    }
    flush();
    return out;
  };
  const arg = (): Part => {
    eat('{');
    const name = word();
    if (src[i] === '}') {
      i++;
      return { arg: name };
    }
    eat(',');
    const type = word();
    if (src[i] === '}') {
      i++;
      return { arg: name, type };
    }
    eat(',');
    const arms: Record<string, Part[]> = {};
    for (skip(); src[i] !== '}'; skip()) {
      if (i >= src.length) fail(`the message ends inside {${name}}`);
      const key = word();
      eat('{');
      arms[key] = nodes();
      eat('}');
    }
    i++;
    if (!arms.other) throw new Error(`{${name}, ${type}} needs an other arm`);
    return { arg: name, type, arms };
  };
  const tag = (): Part => {
    eat('<');
    const name = word();
    eat('>');
    const children = nodes();
    eat('<');
    eat('/');
    if (word() !== name) fail(`expected </${name}>`);
    eat('>');
    return { tag: name, children };
  };
  const out = nodes();
  if (i < src.length) fail(`unexpected "${src[i]}"`);
  return out;
}

function render(nodes: Part[], locale: Locale, values: Record<string, number>, n?: number): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    if (typeof node === 'string') {
      frag.append(node);
    } else if ('hash' in node) {
      frag.append(new Intl.NumberFormat(locale).format(n ?? 0));
    } else if ('tag' in node) {
      const a = document.createElement('a');
      a.href = '#in-context';
      a.append(render(node.children, locale, values, n));
      frag.append(a);
    } else if (node.arms) {
      const v = values[node.arg] ?? 0;
      const arm =
        node.type === 'plural'
          ? (node.arms[`=${v}`] ?? node.arms[new Intl.PluralRules(locale).select(v)] ?? node.arms.other!)
          : (node.arms[v] ?? node.arms.other!);
      frag.append(render(arm, locale, values, v));
    } else {
      frag.append(String(values[node.arg]));
    }
  }
  return frag;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const app = byId('app');
const outline = byId('outline');
const editor = byId('editor');
const fileLabel = byId('file');
const status = byId('status');
const lintNote = byId('lint-note');
const toggle = byId('inspect');
const state: { locale: Locale; count: number; inspecting: boolean; alt: boolean; open?: { key: string; locale: Locale } } = {
  locale: 'en',
  count: 3,
  inspecting: false,
  alt: false,
};

// The key's name as a Mac's keyboard prints it.
if (/Mac|iPhone|iPad/.test(navigator.platform))
  byId('hint').replaceChildren(...rich<'demo.hint', Node>('demo.hint', { key: '⌥ Option', kbd: (chunks) => make('kbd', {}, ...chunks) }));

/** The locale an element's message is found in. */
function source(key: string): Locale {
  const translated = state.locale === 'de' && message('de', key) !== undefined;
  return translated ? 'de' : 'en';
}

const keyOf = (el: Element) => (el as HTMLElement).dataset.key!;

function paint() {
  for (const el of app.querySelectorAll('[data-key]')) {
    const key = keyOf(el);
    try {
      el.replaceChildren(render(parse(message(source(key), key) ?? ''), state.locale, { count: state.count, days: 3 }));
    } catch {
      // A message mid-edit that doesn't parse keeps what it showed.
    }
  }
  for (const b of document.querySelectorAll<HTMLElement>('[data-locale]'))
    b.setAttribute('aria-pressed', String(b.dataset.locale === state.locale));
  noteFindings();
}

const inspecting = () => state.inspecting || state.alt;

function hover(target: EventTarget | null) {
  const el = inspecting() && target instanceof Element ? target.closest('[data-key]') : null;
  if (!el || !app.contains(el)) {
    outline.style.display = 'none';
    return;
  }
  const box = el.getBoundingClientRect();
  const host = app.getBoundingClientRect();
  Object.assign(outline.style, {
    display: 'block',
    left: `${box.left - host.left}px`,
    top: `${box.top - host.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  outline.firstChild!.textContent = `${keyOf(el)} · ${source(keyOf(el))}`;
}

function open(key: string, catalog: boolean) {
  const locale = catalog ? 'en' : source(key);
  const file = files[locale];
  const at = locate(locale, key)!;
  state.open = { key, locale };
  fileLabel.textContent = `${file.path}:${at.start + 1}`;
  editor.replaceChildren(
    ...file.lines.map((text, index) => {
      const row = document.createElement('div');
      row.className = 'line';
      const num = document.createElement('span');
      num.className = 'n';
      num.textContent = String(index + 1);
      row.append(num);
      const inEntry = locale === 'de' ? index === at.line : index >= at.start && index <= at.line;
      if (inEntry) row.classList.add('hit');
      if (index !== at.line) {
        row.append(text || ' ');
        return row;
      }
      const input = document.createElement('input');
      input.value = message(locale, key) ?? '';
      input.spellcheck = false;
      input.setAttribute('aria-label', `${key} in ${file.path}`);
      input.addEventListener('input', () => edit(locale, key, at, input.value));
      row.append(at.prefix, input);
      return row;
    }),
  );
  const hit = editor.querySelector<HTMLElement>('.hit')!;
  editor.scrollTop = hit.offsetTop - 24;
  const why = locale === 'de' ? t('demo.translation') : state.locale === 'de' && !catalog ? t('demo.fallback') : t('demo.catalog');
  status.className = 'status';
  status.textContent = `${why} ${t('demo.edit')}`;
}

function edit(locale: Locale, key: string, at: Spot, value: string) {
  try {
    parse(value);
  } catch (e) {
    status.className = 'status err';
    status.textContent = `${files[locale].path} ${key}: is not valid ICU MessageFormat: ${(e as Error).message}`;
    return;
  }
  files[locale].lines[at.line] = at.prefix + quote(value);
  paint();
  status.className = 'status ok';
  status.textContent = t('demo.saved');
}

app.addEventListener('mousemove', (e) => {
  state.alt = e.altKey;
  hover(e.target);
});
app.addEventListener('mouseleave', () => (outline.style.display = 'none'));
app.addEventListener(
  'click',
  (e) => {
    const target = e.target as Element;
    const el = target.closest('[data-key]');
    if (inspecting() || e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      if (el) {
        outline.style.display = 'none';
        openDialog(keyOf(el), el);
      }
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'add') state.count++;
    if (act === 'empty') state.count = 0;
    if (target.closest('a')) e.preventDefault();
    paint();
  },
  true,
);

// The Alt-click dialog. In an app the plugin reads and writes the real files and checks the whole
// catalog; here it edits the copies above and checks the messages.
const KINDS = ['name', 'action', 'description', 'state'];
const SURFACES = [
  'action',
  'aria',
  'choice',
  'confirm',
  'empty',
  'error',
  'heading',
  'hint',
  'label',
  'placeholder',
  'status',
  'title',
  'toast',
  'tooltip',
];
let dialog: HTMLElement | undefined;

/** The lines an entry takes in a file. */
function entryLines(locale: Locale, key: string): string[] {
  const at = locate(locale, key)!;
  return files[locale].lines.slice(locale === 'de' ? at.line : at.start, at.line + 1);
}

interface Fields {
  kind: string;
  surface: string;
  context: string;
  fragment: boolean;
  args: Record<string, string>;
  comment: string;
  remove: boolean;
  message: string | undefined;
}

/** An entry's fields, read from its catalog lines. */
function fieldsFrom(lines: string[]): Fields {
  const fields: Fields = { kind: '', surface: '', context: '', fragment: false, args: {}, comment: '', remove: false, message: undefined };
  for (const line of lines.slice(1)) {
    const arg = /^ {4}([\w-]+): (.*)$/.exec(line);
    const field = /^ {2}(kind|surface|context|fragment|comment|remove|en): (.*)$/.exec(line);
    if (arg) {
      fields.args[arg[1]!] = unquote(arg[2]!);
      continue;
    }
    if (!field) continue;
    const [, name, value] = field as unknown as [string, 'kind' | 'surface' | 'context' | 'comment' | 'fragment' | 'remove' | 'en', string];
    if (name === 'en') fields.message = unquote(value);
    else if (name === 'fragment' || name === 'remove') fields[name] = value === 'true';
    else fields[name] = unquote(value);
  }
  return fields;
}

function linesFrom(key: string, fields: Fields): string[] {
  const args = Object.entries(fields.args).filter(([, v]) => v.trim());
  return [
    `${key}:`,
    ...(['kind', 'surface', 'context'] as const).filter((f) => fields[f].trim()).map((f) => `  ${f}: ${quote(fields[f].trim())}`),
    ...(args.length > 0 ? ['  args:', ...args.map(([n, v]) => `    ${n}: ${quote(v.trim())}`)] : []),
    ...(fields.fragment ? ['  fragment: true'] : []),
    ...(fields.comment.trim() ? [`  comment: ${quote(fields.comment.trim())}`] : []),
    ...(fields.remove ? ['  remove: true'] : []),
    `  en: ${quote(fields.message ?? '')}`,
  ];
}

/** What is wrong with an edit, as prosebook would say it, or nothing. */
function check(key: string, catalogLines: string[], translation: string): string[] {
  const problems: string[] = [];
  const fields = fieldsFrom(catalogLines);
  // An empty translation is none: German falls back to the source.
  const messages: [string, string | undefined][] = [
    [files.en.path, fields.message],
    ...(translation === '' ? [] : [[files.de.path, translation] as [string, string]]),
  ];
  for (const [path, text] of messages) {
    if (text === undefined) {
      problems.push(`${path} ${key}: en is the message, and it is missing`);
      continue;
    }
    try {
      parse(text);
    } catch (e) {
      problems.push(`${path} ${key}: is not valid ICU MessageFormat: ${(e as Error).message}`);
    }
  }
  return problems;
}

interface Finding {
  rule: string;
  message: string;
  match?: RegExp;
  fix?: string;
}

// What lint says under each text in the dialog, cut down to three of its rules: in an app, the
// plugin checks the edit unsaved on the server and runs them all.
const ends = (text: string) => /[.!?…:]["')”]*$/.test(text.trim());
function findingsOf(text: string, source?: string): Finding[] {
  const found: Finding[] = [];
  if (/ {2,}/.test(text)) found.push({ rule: 'whitespace', message: 'no leading, trailing or doubled spaces', match: / {2,}/g, fix: ' ' });
  if (text.includes('...')) found.push({ rule: 'ellipsis', message: 'ellipses should be one character: …', match: /\.{3}/g, fix: '…' });
  if (source !== undefined && text.trim() !== '' && ends(text) !== ends(source)) {
    found.push({
      rule: 'source-ending',
      message: ends(source)
        ? 'the source ends with a stop, and this does not: end it as the source does'
        : 'ends with a stop, and the source does not: drop it',
    });
  }
  return found;
}

// Points at a string lint has something to say about, so its findings are a click away. The
// catalog above writes one on purpose: "Check out..." with three periods.
function noteFindings() {
  const keys = [...new Set([...app.querySelectorAll('[data-key]')].map(keyOf))];
  const flagged = keys
    .flatMap((key) => {
      const en = message('en', key) ?? '';
      const de = message('de', key);
      return [
        ...(findingsOf(en).length > 0 ? [{ key, text: en }] : []),
        ...(de !== undefined && findingsOf(de, en).length > 0 ? [{ key, text: de }] : []),
      ];
    })
    .at(0);
  lintNote.className = flagged ? 'lint-note' : 'lint-note clean';
  lintNote.textContent = flagged ? t('demo.finding', flagged) : t('demo.clean');
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function openDialog(key: string, anchor: Element) {
  dialog?.remove();
  const locale = source(key);
  const translated = locale === 'de';
  const fields = fieldsFrom(entryLines('en', key));
  // The field last in focus, whose file Open in editor opens.
  let focused: Locale = locale;

  const area = (name: string, label: string, value: string, placeholder = '') =>
    make(
      'label',
      {},
      label,
      make('textarea', { name, value, placeholder, rows: Math.min(10, Math.max(2, value.split('\n').length + 1)), spellcheck: true }),
    );
  /** A locale's text, with what lint says of it underneath. */
  const text = (l: Locale) => {
    const label =
      l === 'en'
        ? area('message', 'en · source', fields.message ?? '')
        : area('translation', 'de', message('de', key) ?? '', 'No translation: the en text shows');
    label.querySelector('textarea')!.addEventListener('focus', () => (focused = l));
    label.append(make('ul', { className: 'findings' }));
    return label;
  };
  const select = (name: string, value: string, choices: string[]) =>
    make(
      'select',
      { name },
      make('option', { value: '', textContent: '—' }),
      ...choices.map((c) => make('option', { value: c, textContent: c, selected: c === value })),
    );
  const checkbox = (name: string, label: string, checked: boolean) =>
    make('label', { className: 'check' }, make('input', { type: 'checkbox', name, checked }), label);

  const more = make('details', { open: remembered() });
  more.addEventListener('toggle', () => remember(more.open));
  more.append(
    make('summary', {}, 'More', make('span', { className: 'count' })),
    make(
      'div',
      {},
      ...(translated ? [] : [text('de')]),
      area('context', 'Context', fields.context),
      make(
        'div',
        { className: 'row' },
        make('label', {}, 'Kind', select('kind', fields.kind, KINDS)),
        make('label', {}, 'Surface', select('surface', fields.surface, SURFACES)),
      ),
      ...Object.entries(fields.args).map(([n, v]) =>
        make(
          'label',
          {},
          make('code', { textContent: `{${n}}` }),
          make('input', { name: `arg.${n}`, value: v, placeholder: 'What it holds' }),
        ),
      ),
      area('comment', 'Comment', fields.comment, 'Ask whoever edits next for a change'),
      make(
        'div',
        { className: 'row' },
        checkbox('fragment', 'Fragment', fields.fragment),
        checkbox('remove', 'Mark for removal', fields.remove),
      ),
    ),
  );
  const body = make('div', { className: 'body' }, text(locale), ...(translated ? [text('en')] : []), more);
  const problems = make('ul', { className: 'problems' });
  const value = (name: string) => body.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)?.value;
  const checked = (name: string) => body.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.checked;

  const lintNow = () => {
    let hidden = 0;
    for (const list of body.querySelectorAll('.findings')) {
      const field = list.parentElement!.querySelector('textarea')!;
      const found = findingsOf(field.value, field.name === 'translation' ? value('message') : undefined);
      if (more.contains(list)) hidden += found.length;
      list.replaceChildren(
        ...found.map((f) => {
          const say = make('button', { type: 'button', className: 'say', textContent: f.message });
          say.addEventListener('click', () => {
            const at = f.match && new RegExp(f.match.source).exec(field.value);
            if (!at) return;
            field.focus();
            field.setSelectionRange(at.index, at.index + at[0].length);
          });
          const item = make('li', {}, say, make('span', { className: 'rule', textContent: f.rule }));
          if (f.fix !== undefined) {
            const fix = make('button', { type: 'button', className: 'small', textContent: 'Fix' });
            fix.addEventListener('click', () => {
              field.value = field.value.replace(f.match!, f.fix!);
              lintNow();
            });
            item.append(fix);
          }
          return item;
        }),
      );
    }
    more.querySelector('.count')!.textContent = hidden === 0 ? '' : ` · ${hidden} ${hidden === 1 ? 'finding' : 'findings'}`;
  };
  body.addEventListener('input', lintNow);

  /** The edit on screen, as catalog lines and a translation. */
  const current = () => {
    const args: Record<string, string> = {};
    for (const input of body.querySelectorAll<HTMLInputElement>('input[name^="arg."]')) args[input.name.slice(4)] = input.value;
    const edited: Fields = {
      kind: value('kind') ?? '',
      surface: value('surface') ?? '',
      context: value('context') ?? '',
      fragment: checked('fragment'),
      args,
      comment: value('comment') ?? '',
      remove: checked('remove'),
      message: value('message'),
    };
    return { lines: linesFrom(key, edited), translation: value('translation') ?? '' };
  };

  const close = () => {
    panel.remove();
    if (dialog === panel) dialog = undefined;
  };
  const save = () => {
    const edit = current();
    const found = check(key, edit.lines, edit.translation);
    problems.replaceChildren(...found.map((p) => make('li', { textContent: p })));
    if (found.length > 0) return;
    const at = locate('en', key)!;
    files.en.lines.splice(at.start, at.line - at.start + 1, ...edit.lines);
    // German gains the line, changes it, or loses it when left empty.
    const de = locate('de', key);
    const line = `${key}: ${quote(edit.translation)}`;
    if (de === undefined && edit.translation !== '') files.de.lines.push(line);
    else if (de !== undefined && edit.translation === '') files.de.lines.splice(de.line, 1);
    else if (de !== undefined) files.de.lines[de.line] = line;
    paint();
    if (state.open) open(state.open.key, state.open.locale === 'en' && source(state.open.key) === 'de');
    status.className = 'status ok';
    status.textContent = t('demo.dialog-saved', { key });
    close();
  };
  const button = (props: Partial<HTMLButtonElement>, onClick: () => void) => {
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
      button({ className: 'quiet', textContent: 'Open in editor ↗' }, () => {
        open(key, focused === 'en');
        close();
      }),
      button({ className: 'quiet x', textContent: '×', title: 'Close (Esc)' }, close),
    ),
    body,
    problems,
    make(
      'footer',
      {},
      make('span', { className: 'hint grow', textContent: `${mac ? '⌘' : 'Ctrl'}+Enter saves · Esc closes` }),
      button({ className: 'save', textContent: 'Save' }, save),
    ),
  );
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Edit ${key}`);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  });
  lintNow();
  document.body.append(panel);
  dialog = panel;
  // Below the string, or above it where there is no room, and moved up if it grows past the bottom.
  const r = anchor.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const below = r.bottom + 8;
  Object.assign(panel.style, {
    left: `${Math.max(12, Math.min(r.left, innerWidth - box.width - 12))}px`,
    top: `${below + box.height <= innerHeight - 12 ? below : Math.max(12, r.top - box.height - 8)}px`,
  });
  new ResizeObserver(() => {
    const now = panel.getBoundingClientRect();
    const fitted = Math.max(12, Math.min(now.top, innerHeight - now.height - 12));
    if (fitted !== now.top) panel.style.top = `${fitted}px`;
  }).observe(panel);
  body.querySelector('textarea')?.focus();
}

// Whether More is open, remembered as the dev dialog does.
const MORE = 'prosebook:inspector:more';
function remembered(): boolean {
  try {
    return localStorage.getItem(MORE) === 'open';
  } catch {
    return false;
  }
}
function remember(open: boolean) {
  try {
    localStorage.setItem(MORE, open ? 'open' : '');
  } catch {
    // Remembered for this page only.
  }
}

// Alt-click on a link would download it; on a button, focus it.
app.addEventListener('mousedown', (e) => e.altKey && e.preventDefault());
// A press outside the dialog closes it, as the dev dialog does.
addEventListener(
  'mousedown',
  (e) => {
    if (dialog === undefined || dialog.contains(e.target as Node)) return;
    dialog.remove();
    dialog = undefined;
  },
  { capture: true },
);
addEventListener('keydown', (e) => {
  if (e.key === 'Alt') state.alt = true;
});
addEventListener('keyup', (e) => {
  if (e.key !== 'Alt') return;
  state.alt = false;
  outline.style.display = 'none';
});
addEventListener('blur', () => {
  state.alt = false;
  outline.style.display = 'none';
});
toggle.addEventListener('click', () => {
  state.inspecting = !state.inspecting;
  toggle.setAttribute('aria-pressed', String(state.inspecting));
  app.classList.toggle('inspecting', state.inspecting);
  if (!state.inspecting) outline.style.display = 'none';
});
for (const b of document.querySelectorAll<HTMLElement>('[data-locale]')) {
  b.addEventListener('click', () => {
    state.locale = b.dataset.locale as Locale;
    paint();
    if (state.open) open(state.open.key, false);
  });
}

paint();
