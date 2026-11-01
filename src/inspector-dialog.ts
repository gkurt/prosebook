/**
 * The inspector's dialog: Alt-right-click a string to edit its entry on the page, in every locale, as
 * fields or as the YAML written in its files. The server checks each edit as the whole catalog before
 * writing it (`tools/entry.ts`); once written, the page updates in place like after any catalog edit.
 *
 * It renders in a shadow root, so the app's styles don't reach it and its own don't leak out.
 */
import type { Problem } from '#src/tools/catalog.ts';
import type { EntryEdit, EntryFields, EntryView } from '#src/tools/entry.ts';

export interface DialogOptions {
  base: string;
  key: string;
  /** The locale the string was found in, whose translation comes first, or nothing to start at the source. */
  locale?: string;
  /** Where the pointer was, so the dialog opens beside it. */
  x: number;
  y: number;
  /** Opens the entry in the editor instead. */
  openFile: () => void;
}

type Reply = { view?: EntryView; problems?: Problem[] };

const STYLE = `
:host { all: initial; }
.panel {
  --bg: #fff; --fg: #1d1b17; --muted: #6b665c; --line: #e2ded4; --field: #faf9f6; --err: #b91c1c; --ok: #15803d;
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column;
  width: min(460px, calc(100vw - 24px)); max-height: min(80vh, 680px);
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.22); font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .panel { --bg: #1d1c17; --fg: #ece8dd; --muted: #a29c8d; --line: #34322a; --field: #15140f; --err: #f87171; --ok: #4ade80; color-scheme: dark; }
}
header, footer { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
header { border-bottom: 1px solid var(--line); }
footer { border-top: 1px solid var(--line); justify-content: space-between; flex-wrap: wrap; }
.key { font: 600 12px/1.5 ui-monospace, monospace; color: #fff; background: #7c3aed; padding: 1px 6px; border-radius: 4px; }
.locale { font: 12px/1 ui-monospace, monospace; color: var(--muted); }
.grow { flex: 1; }
.tabs { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.tabs button { border: 0; border-radius: 0; padding: 4px 10px; background: transparent; }
.tabs button[aria-selected='true'] { background: #7c3aed; color: #fff; }
.body { padding: 12px; overflow: auto; display: grid; gap: 12px; }
label { display: grid; gap: 4px; font-size: 12px; font-weight: 500; color: var(--muted); }
label small { font-weight: 400; font-family: ui-monospace, monospace; }
textarea, input, select {
  font: 13px/1.45 ui-monospace, 'SF Mono', Consolas, monospace; color: var(--fg); background: var(--field);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: 100%; box-sizing: border-box;
}
textarea { resize: vertical; }
.prose { font-family: inherit; }
textarea:focus, input:focus, select:focus { outline: 2px solid #7c3aed; outline-offset: -1px; }
.row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; }
.check { display: flex; align-items: center; gap: 6px; padding-bottom: 7px; color: var(--fg); font-weight: 400; }
.check input { width: auto; }
fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
legend { font-size: 12px; font-weight: 500; color: var(--muted); padding: 0 0 4px; }
.problems { margin: 0; padding: 0 12px 0 28px; color: var(--err); }
.problems:empty { display: none; }
.problems li { margin: 2px 0; }
.status { color: var(--muted); }
.status.ok { color: var(--ok); }
button {
  font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; padding: 7px 12px; cursor: pointer;
}
button.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
button.link { border: 0; padding: 7px 0; color: var(--muted); text-decoration: underline; background: transparent; }
button.close { border: 0; padding: 2px 6px; font-size: 18px; color: var(--muted); background: transparent; }
`;

let closeOpen: (() => void) | undefined;

/** An element with properties set (`className`, `value`, `checked`, ...) and children appended. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const rowsFor = (text: string, least: number) => Math.min(12, Math.max(least, text.split('\n').length + (text.length > 60 ? 1 : 0)));

/** Opens the dialog for an entry, closing any already open. */
export async function openDialog(options: DialogOptions): Promise<void> {
  closeOpen?.();
  const query = new URLSearchParams({ key: options.key });
  const host = el('div');
  const root = host.attachShadow({ mode: 'open' });
  const panel = el('div', { className: 'panel' });
  // Hidden until it has its place beside the pointer, which needs its size, which needs the entry.
  panel.style.visibility = 'hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Edit ${options.key}`);
  root.append(el('style', { textContent: STYLE }), panel);

  const close = () => {
    host.remove();
    if (closeOpen === close) closeOpen = undefined;
  };
  closeOpen = close;

  const problems = el('ul', { className: 'problems' });
  const status = el('span', { className: 'status' });
  const body = el('div', { className: 'body' });
  const tabs = {
    fields: el('button', { type: 'button', textContent: 'Fields' }),
    yaml: el('button', { type: 'button', textContent: 'YAML' }),
  };
  let tab: 'fields' | 'yaml' = 'fields';
  let view: EntryView | undefined;

  const showProblems = (list: readonly Problem[]) =>
    problems.replaceChildren(
      ...list.map((p) => el('li', { textContent: p.where === 'prosebook' ? p.message : `${p.where}: ${p.message}` })),
    );

  const area = (name: string, label: string, value: string, prose = false, least = 2) =>
    el(
      'label',
      {},
      label,
      // YAML doesn't wrap: a wrapped line would hide its indentation.
      el('textarea', {
        name,
        value,
        rows: rowsFor(value, least),
        spellcheck: prose,
        wrap: prose ? 'soft' : 'off',
        className: prose ? 'prose' : '',
      }),
    );

  // The locale the string was read in comes first; the others follow, in the catalog's order.
  const focus = () => (options.locale !== undefined && view?.locales.includes(options.locale) === true ? options.locale : undefined);
  const ordered = () => (view === undefined ? [] : [...new Set([focus(), ...view.locales].filter((l) => l !== undefined))]);
  const placeholder = (label: HTMLLabelElement, text: string) => {
    label.querySelector('textarea')!.placeholder = text;
    return label;
  };

  const render = () => {
    if (view === undefined) return;
    tabs.fields.setAttribute('aria-selected', String(tab === 'fields'));
    tabs.yaml.setAttribute('aria-selected', String(tab === 'yaml'));
    if (tab === 'yaml') {
      const v = view;
      body.replaceChildren(
        area('yaml.catalog', v.files.catalog, v.yaml.catalog, false, 3),
        ...ordered().map((l) =>
          placeholder(area(`yaml.${l}`, v.files.translations[l]!, v.yaml.translations[l] ?? '', false, 1), `${v.key}: …`),
        ),
      );
      return;
    }
    const f = view.fields;
    const fallsBack = `No translation: the ${view.source} text shows`;
    const translation = (l: string) =>
      placeholder(
        area(`translation.${l}`, `Translation · ${l}${f.translations[l] === '' ? ' · none yet' : ''}`, f.translations[l] ?? '', true),
        fallsBack,
      );
    const others = ordered().filter((l) => l !== focus());
    const select = (name: string, value: string, choices: string[]) =>
      el(
        'select',
        { name },
        el('option', { value: '', textContent: '—' }),
        ...choices.map((c) => el('option', { value: c, textContent: c, selected: c === value })),
      );
    const argNames = [...new Set([...view.argNames, ...Object.keys(f.args)])];
    body.replaceChildren(
      ...(focus() === undefined ? [] : [translation(focus()!)]),
      area('message', `${focus() === undefined ? 'Message' : 'Source'} · ${view.source}`, f.message, true),
      ...(others.length === 0
        ? []
        : [
            el(
              'fieldset',
              {},
              el('legend', { textContent: focus() === undefined ? 'Translations' : 'Other translations' }),
              ...others.map(translation),
            ),
          ]),
      area('context', 'Context', f.context, true, 1),
      el(
        'div',
        { className: 'row' },
        el('label', {}, 'Kind', select('kind', f.kind, view.kinds)),
        el('label', {}, 'Surface', select('surface', f.surface, view.surfaces)),
        el('label', { className: 'check' }, el('input', { type: 'checkbox', name: 'fragment', checked: f.fragment }), 'Fragment'),
      ),
      ...(argNames.length === 0
        ? []
        : [
            el(
              'fieldset',
              {},
              el('legend', { textContent: 'What each placeholder holds' }),
              ...argNames.map((n) =>
                el('label', {}, el('small', { textContent: `{${n}}` }), el('input', { name: `arg.${n}`, value: f.args[n] ?? '' })),
              ),
            ),
          ]),
    );
  };

  const value = (name: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)?.value;

  const current = (): EntryEdit => {
    const byLocale = (prefix: string) => Object.fromEntries(ordered().map((l) => [l, value(`${prefix}${l}`) ?? '']));
    if (tab === 'yaml') return { yaml: { catalog: value('yaml.catalog') ?? '', translations: byLocale('yaml.') } };
    const args: Record<string, string> = {};
    for (const input of root.querySelectorAll<HTMLInputElement>('input[name^="arg."]')) args[input.name.slice(4)] = input.value;
    const fields: EntryFields = {
      message: value('message') ?? '',
      translations: byLocale('translation.'),
      context: value('context') ?? '',
      kind: value('kind') ?? '',
      surface: value('surface') ?? '',
      fragment: root.querySelector<HTMLInputElement>('input[name="fragment"]')?.checked === true,
      args,
    };
    return { fields };
  };

  const send = async (write: boolean): Promise<EntryView | undefined> => {
    const res = await fetch(`${options.base}__prosebook/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: options.key, edit: current(), write }),
    });
    const reply = (await res.json()) as Reply;
    showProblems(reply.problems ?? []);
    return reply.view;
  };

  const save = async () => {
    status.className = 'status';
    status.textContent = 'Checking…';
    const saved = await send(true);
    status.textContent = '';
    if (saved === undefined) return;
    status.className = 'status ok';
    status.textContent = 'Saved';
    setTimeout(close, 600);
  };

  const switchTo = async (next: 'fields' | 'yaml') => {
    if (next === tab) return;
    // The other tab shows this one's edits, so they are turned into it on the server, checked.
    const converted = await send(false);
    if (converted === undefined) return;
    view = converted;
    tab = next;
    render();
  };

  tabs.fields.addEventListener('click', () => void switchTo('fields'));
  tabs.yaml.addEventListener('click', () => void switchTo('yaml'));

  const saveButton = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
  saveButton.addEventListener('click', () => void save());
  const cancel = el('button', { type: 'button', textContent: 'Cancel' });
  cancel.addEventListener('click', close);
  const closeButton = el('button', { type: 'button', className: 'close', textContent: '×', title: 'Close' });
  closeButton.addEventListener('click', close);
  const openFile = el('button', { type: 'button', className: 'link', textContent: 'Open in editor' });
  openFile.addEventListener('click', () => {
    options.openFile();
    close();
  });

  panel.append(
    el(
      'header',
      {},
      el('span', { className: 'key', textContent: options.key }),
      el('span', { className: 'locale', textContent: options.locale ?? '' }),
      el('span', { className: 'grow' }),
      el('span', { className: 'tabs' }, tabs.fields, tabs.yaml),
      closeButton,
    ),
    body,
    problems,
    el('footer', {}, openFile, el('span', { className: 'grow' }), status, cancel, saveButton),
  );
  // Keys typed here are the dialog's: the app's shortcuts don't see them.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) host.addEventListener(type, (e) => e.stopPropagation());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
  });

  document.body.append(host);
  const res = await fetch(`${options.base}__prosebook/entry?${query}`);
  const reply = (await res.json()) as EntryView | { problems: Problem[] };
  if ('problems' in reply) showProblems(reply.problems);
  else view = reply;
  render();

  // Beside the pointer, inside the window.
  const box = panel.getBoundingClientRect();
  const left = Math.min(Math.max(12, options.x - 24), innerWidth - box.width - 12);
  const below = options.y + 16;
  const top = below + box.height <= innerHeight - 12 ? below : Math.max(12, options.y - box.height - 16);
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, visibility: '' });
  // Growing later, with problems or the other tab, moves it up rather than past the bottom.
  new ResizeObserver(() => {
    const now = panel.getBoundingClientRect();
    const fitted = Math.max(12, Math.min(now.top, innerHeight - now.height - 12));
    if (fitted !== now.top) panel.style.top = `${fitted}px`;
  }).observe(panel);
  (root.querySelector<HTMLElement>(`[name="translation.${focus()}"]`) ?? root.querySelector<HTMLElement>('textarea'))?.focus();
}
