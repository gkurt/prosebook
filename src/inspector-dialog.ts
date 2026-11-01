/**
 * The inspector's dialog: Alt-right-click a string to edit its entry on the page, in every locale, as
 * fields or as the YAML written in its files. The server checks each edit as the whole catalog before
 * writing it (`tools/entry.ts`); once written, the page updates in place like after any catalog edit.
 * While typing, it asks the server to check the edit unsaved, and shows what lint says of each locale
 * under its text: a finding selects its words, and one that has a fix makes it.
 *
 * A reviewer who would rather ask than edit leaves a comment, or marks the entry for removal: both are
 * written in the catalog, where whoever edits next, often an agent, finds them among the warnings.
 *
 * It renders in a shadow root, so the app's styles don't reach it and its own don't leak out.
 */
import type { Problem } from '#src/tools/catalog.ts';
import type { EntryEdit, EntryFields, EntryFinding, EntryView } from '#src/tools/entry.ts';

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
  --bg: #fff; --fg: #1d1b17; --muted: #6b665c; --line: #e2ded4; --field: #faf9f6; --err: #b91c1c; --warn: #b45309; --ok: #15803d;
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column;
  width: min(460px, calc(100vw - 24px)); max-height: min(80vh, 680px);
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.22); font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .panel { --bg: #1d1c17; --fg: #ece8dd; --muted: #a29c8d; --line: #34322a; --field: #15140f; --err: #f87171; --warn: #fbbf24; --ok: #4ade80; color-scheme: dark; }
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
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-weight: 400; color: var(--fg); }
.findings:empty { display: none; }
.findings.all { padding: 0 12px 8px; }
.findings li { display: flex; align-items: baseline; gap: 6px; }
.findings li::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.findings li.error::before { background: var(--err); }
.findings .say { flex: 1; border: 0; padding: 0; background: transparent; font: inherit; text-align: left; color: inherit; }
.findings button.say:hover { text-decoration: underline; }
.findings .rule { font: 11px/1.4 ui-monospace, monospace; color: var(--muted); }
.findings button.fix { padding: 2px 8px; font-size: 12px; }
.status { color: var(--muted); }
.status.ok { color: var(--ok); }
button {
  font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; padding: 7px 12px; cursor: pointer;
}
button.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
button.link { border: 0; padding: 7px 0; color: var(--muted); text-decoration: underline; background: transparent; }
button.close { border: 0; padding: 2px 6px; font-size: 18px; color: var(--muted); background: transparent; }
button.remove[aria-pressed='true'] { color: var(--err); border-color: currentColor; }
.removing textarea[name='message'], .removing textarea[name^='translation.'] { text-decoration: line-through; color: var(--muted); }
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
    clearTimeout(timer);
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
  // Marked for removal: written with the fields, so it is the YAML tab's to change while that is open.
  let remove = false;
  const removeButton = el('button', {
    type: 'button',
    className: 'remove',
    title: 'Leave the entry for whoever edits next to delete, with the code that reads it',
  });
  const showRemove = () => {
    removeButton.hidden = tab === 'yaml' || view === undefined;
    removeButton.setAttribute('aria-pressed', String(remove));
    removeButton.textContent = remove ? 'Marked for removal' : 'Mark for removal';
    panel.classList.toggle('removing', remove && tab === 'fields');
  };
  removeButton.addEventListener('click', () => {
    remove = !remove;
    showRemove();
  });
  // What lint said, and each locale's text it said it of: a finding's place and fix are in that text.
  let findings: EntryFinding[] = [];
  let checked = new Map<string, string>();
  const heard = (next: EntryView) => {
    findings = next.findings;
    checked = new Map([[next.source, next.fields.message], ...Object.entries(next.fields.translations)]);
  };
  const all = el('ul', { className: 'findings all' });

  const showProblems = (list: readonly Problem[]) =>
    problems.replaceChildren(
      ...list.map((p) =>
        el('li', { textContent: p.file === undefined ? p.message : `${[p.file, p.key].filter(Boolean).join(' ')}: ${p.message}` }),
      ),
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

  const fieldOf = (locale: string) =>
    root.querySelector<HTMLTextAreaElement>(`[name="${locale === view?.source ? 'message' : `translation.${locale}`}"]`);

  const item = (f: EntryFinding, prefix: string) => {
    const field = fieldOf(f.locale);
    // Typed over since the check: the next one is on its way, so the old place and fix are left alone.
    const current = () => (tab === 'fields' && field !== null && field.value === checked.get(f.locale) ? field : undefined);
    const text = `${prefix}${f.message}`;
    const at = tab === 'fields' ? f.at : undefined;
    const say =
      at === undefined
        ? el('span', { className: 'say', textContent: text })
        : el('button', { type: 'button', className: 'say', textContent: text });
    say.addEventListener('click', () => {
      const target = current();
      if (at === undefined || target === undefined) return;
      target.focus();
      target.setSelectionRange(at.start, at.end);
    });
    const li = el('li', { className: f.severity }, say, el('span', { className: 'rule', textContent: f.rule }));
    const fixed = f.fixed;
    if (fixed !== undefined && tab === 'fields') {
      const fix = el('button', { type: 'button', className: 'fix', textContent: 'Fix' });
      fix.addEventListener('click', () => {
        const target = current();
        if (target === undefined) return;
        target.value = fixed;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
      li.append(fix);
    }
    return li;
  };

  const showFindings = () => {
    if (tab === 'yaml') {
      all.replaceChildren(...findings.map((f) => item(f, `${f.locale}: `)));
      return;
    }
    all.replaceChildren();
    for (const list of root.querySelectorAll<HTMLUListElement>('.body .findings'))
      list.replaceChildren(...findings.filter((f) => f.locale === list.dataset['locale']).map((f) => item(f, '')));
  };

  /** A text field with what lint says of its locale under it. */
  const withFindings = (label: HTMLLabelElement, locale: string) => {
    const list = el('ul', { className: 'findings' });
    list.dataset['locale'] = locale;
    label.append(list);
    return label;
  };

  const render = () => {
    if (view === undefined) return;
    tabs.fields.setAttribute('aria-selected', String(tab === 'fields'));
    tabs.yaml.setAttribute('aria-selected', String(tab === 'yaml'));
    remove = view.fields.remove;
    showRemove();
    if (tab === 'yaml') {
      const v = view;
      body.replaceChildren(
        area('yaml.catalog', v.files.catalog, v.yaml.catalog, false, 3),
        ...ordered().map((l) =>
          placeholder(area(`yaml.${l}`, v.files.translations[l]!, v.yaml.translations[l] ?? '', false, 1), `${v.key}: …`),
        ),
      );
      showFindings();
      return;
    }
    const f = view.fields;
    const fallsBack = `No translation: the ${view.source} text shows`;
    const translation = (l: string) =>
      withFindings(
        placeholder(
          area(`translation.${l}`, `Translation · ${l}${f.translations[l] === '' ? ' · none yet' : ''}`, f.translations[l] ?? '', true),
          fallsBack,
        ),
        l,
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
      withFindings(area('message', `${focus() === undefined ? 'Message' : 'Source'} · ${view.source}`, f.message, true), view.source),
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
      placeholder(area('comment', 'Comment · for whoever edits next', f.comment, true, 1), 'Ask for a change instead of making it'),
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
    showFindings();
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
      comment: value('comment') ?? '',
      remove,
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

  // Checked a moment after typing stops; a reply to an older check than the last is dropped.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = 0;
  const check = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const mine = ++asked;
      void send(false).then((checkedView) => {
        if (mine !== asked) return;
        if (checkedView === undefined) findings = [];
        else heard(checkedView);
        showFindings();
      });
    }, 350);
  };
  body.addEventListener('input', check);
  body.addEventListener('change', check);

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
    heard(converted);
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
    all,
    problems,
    el('footer', {}, openFile, el('span', { className: 'grow' }), status, removeButton, cancel, saveButton),
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
  if ('problems' in reply) {
    showProblems(reply.problems);
  } else {
    view = reply;
    heard(reply);
  }
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
