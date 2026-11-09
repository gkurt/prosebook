/**
 * The inspector's dialog: Alt-click a string to edit its entry on the page. It opens on the text as
 * read, in its locale, with what lint says of it; the source beside a translation; and the rest of the
 * entry (its other locales, context, role, placeholders) under More, which stays open once opened.
 *
 * The server checks each edit as the whole catalog before writing it (`tools/entry.ts`); once written,
 * the page updates in place like after any catalog edit. While typing, the dialog asks the server to
 * check the edit unsaved, and a finding selects its words or, with a fix, makes it: no lint code ships
 * to the browser.
 *
 * A reviewer who would rather ask than edit leaves a comment, or marks the entry for removal: both are
 * written in the catalog, where whoever edits next, often an agent, finds them among the warnings.
 *
 * It renders in a shadow root, so the app's styles don't reach it and its own don't leak out.
 */
import type { Problem } from '#src/tools/catalog.ts';
import type { EntryFields, EntryFinding, EntryView } from '#src/tools/entry.ts';

export interface DialogOptions {
  base: string;
  key: string;
  /** The locale the string was read in, whose text the dialog opens on. */
  locale: string;
  /** The boxes the string takes on screen, one per line, which the dialog opens beside. */
  anchor: DOMRect[];
}

type Reply = { view?: EntryView; problems?: Problem[] };

const MORE = 'prosebook:inspector:more';

const STYLE = `
:host { all: initial; }
.panel {
  --accent: #7c3aed; --bg: #fff; --fg: #1d1b17; --muted: #6b665c; --line: #e2ded4; --field: #faf9f6; --err: #b91c1c; --warn: #b45309; --ok: #15803d;
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column;
  width: min(420px, calc(100vw - 24px)); max-height: min(80vh, 640px);
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.22); font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .panel { --bg: #1d1c17; --fg: #ece8dd; --muted: #a29c8d; --line: #34322a; --field: #15140f; --err: #f87171; --warn: #fbbf24; --ok: #4ade80; color-scheme: dark; }
}
header, footer { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
header { border-bottom: 1px solid var(--line); }
footer { border-top: 1px solid var(--line); }
.key { font: 600 12px/1.5 ui-monospace, monospace; color: #fff; background: var(--accent); padding: 1px 6px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grow { flex: 1; }
.hint { font-size: 12px; color: var(--muted); }
.body { padding: 12px; overflow: auto; display: grid; gap: 12px; }
label { display: grid; gap: 4px; font-size: 12px; font-weight: 500; color: var(--muted); }
textarea, input, select {
  font: inherit; color: var(--fg); background: var(--field);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: 100%; box-sizing: border-box;
}
textarea { resize: vertical; }
textarea:focus, input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
summary { cursor: pointer; font-size: 12px; font-weight: 500; color: var(--muted); }
summary .count { color: var(--warn); font-weight: 400; }
details > div { display: grid; gap: 12px; margin-top: 12px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.check { display: flex; align-items: center; gap: 6px; color: var(--fg); font-weight: 400; }
.check input { width: auto; margin: 0; }
code { font: 12px/1.4 ui-monospace, monospace; }
.problems { margin: 0; padding: 0 12px 8px 28px; color: var(--err); }
.problems:empty { display: none; }
.findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-weight: 400; color: var(--fg); }
.findings:empty { display: none; }
.findings li { display: flex; align-items: baseline; gap: 6px; }
.findings li::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
.findings li.error::before { background: var(--err); }
.findings .say { flex: 1; border: 0; padding: 0; background: transparent; font: inherit; text-align: left; color: inherit; cursor: pointer; }
.findings .say:hover { text-decoration: underline; }
.findings .rule { font: 11px/1.4 ui-monospace, monospace; color: var(--muted); }
button {
  font: 500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 6px; padding: 7px 12px; cursor: pointer;
}
button.small { padding: 2px 8px; font-size: 12px; }
button.quiet { border: 0; padding: 4px; color: var(--muted); background: transparent; }
button.quiet:hover { color: var(--fg); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary:disabled { cursor: progress; }
button.primary.saved { background: var(--ok); border-color: var(--ok); }
`;

let closeOpen: (() => void) | undefined;

/** An element with properties set (`className`, `value`, `checked`, ...) and children appended. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function button(props: object, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', ...props });
  b.addEventListener('click', onClick);
  return b;
}

const rowsFor = (text: string) => Math.min(10, Math.max(2, text.split('\n').length + (text.length > 50 ? 1 : 0)));

/** localStorage, which a private window or blocked site data may refuse. */
const stored = {
  get: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  set: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Remembered for this page only.
    }
  },
};

/** Opens the dialog for an entry, closing any already open. */
export async function openDialog(options: DialogOptions): Promise<void> {
  closeOpen?.();
  const { base, key } = options;
  const res = await fetch(`${base}__prosebook/entry?${new URLSearchParams({ key })}`);
  const loaded = (await res.json()) as EntryView | { problems: Problem[] };
  if ('problems' in loaded) {
    console.warn(`prosebook: ${loaded.problems.map((p) => p.message).join('\n')}`);
    return;
  }
  const view = loaded;
  const locale = view.locales.includes(options.locale) ? options.locale : view.source;
  const dialog = new Dialog(options, view, locale);
  closeOpen = dialog.close;
}

/** Each text field's name: the source's `message`, a translation's `translation.<locale>`. */
const nameOf = (view: EntryView, locale: string) => (locale === view.source ? 'message' : `translation.${locale}`);

class Dialog {
  private readonly host = el('div');
  private readonly root = this.host.attachShadow({ mode: 'open' });
  private readonly panel = el('div', { className: 'panel' });
  private readonly problems = el('ul', { className: 'problems' });
  private readonly more = el('details');
  private readonly saveButton = button({ className: 'primary', textContent: 'Save' }, () => void this.save());
  /** What lint said, and each locale's text it said it of: a finding's place and fix are in that text. */
  private findings: EntryFinding[] = [];
  private checked = new Map<string, string>();
  /** The locale whose file Open in editor opens: the field last in focus. */
  private focused = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private asked = 0;

  private readonly options: DialogOptions;
  private readonly view: EntryView;
  /** The locale the string was read in. */
  private readonly locale: string;

  constructor(options: DialogOptions, view: EntryView, locale: string) {
    this.options = options;
    this.view = view;
    this.locale = locale;
    this.focused = locale;
    this.heard(view);
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', `Edit ${view.key}`);
    this.root.append(el('style', { textContent: STYLE }), this.panel);
    this.panel.append(this.header(), this.body(), this.problems, this.footer());
    this.showFindings();

    // Keys typed here are the dialog's: the app's shortcuts don't see them.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) this.host.addEventListener(type, (e) => e.stopPropagation());
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void this.save();
    });
    this.panel.addEventListener('input', () => this.check());
    this.panel.addEventListener('change', () => this.check());
    this.panel.addEventListener('focusin', (e) => {
      const field = e.composedPath()[0];
      if (field instanceof HTMLTextAreaElement && field.dataset['locale'] !== undefined) this.focused = field.dataset['locale'];
    });

    document.body.append(this.host);
    // A press anywhere else on the page closes it, as Esc does; the inspector's click there opens the next.
    window.addEventListener('mousedown', this.outside, { capture: true });
    this.place();
    this.field(locale)?.focus();
  }

  private readonly outside = (e: MouseEvent) => {
    if (!e.composedPath().includes(this.host)) this.close();
  };

  readonly close = () => {
    clearTimeout(this.timer);
    window.removeEventListener('mousedown', this.outside, { capture: true });
    this.host.remove();
    if (closeOpen === this.close) closeOpen = undefined;
  };

  private header(): HTMLElement {
    const open = button({ className: 'quiet', textContent: 'Open in editor ↗', title: 'Open the entry in your editor' }, () => {
      void this.openFile();
      this.close();
    });
    const close = button({ className: 'quiet', textContent: '×', title: 'Close (Esc)', ariaLabel: 'Close' }, this.close);
    close.style.fontSize = '18px';
    return el(
      'header',
      {},
      el('span', { className: 'key', textContent: this.view.key, title: this.view.key }),
      el('span', { className: 'grow' }),
      open,
      close,
    );
  }

  private footer(): HTMLElement {
    const mac = /Mac|iP/.test(navigator.platform);
    return el(
      'footer',
      {},
      el('span', { className: 'hint grow', textContent: `${mac ? '⌘' : 'Ctrl'}+Enter saves · Esc closes` }),
      this.saveButton,
    );
  }

  /** The text as read, the source beside a translation, and the rest of the entry under More. */
  private body(): HTMLElement {
    const { view, locale } = this;
    const f = view.fields;
    const translated = locale !== view.source;

    this.more.open = stored.get(MORE) === 'open';
    this.more.addEventListener('toggle', () => stored.set(MORE, this.more.open ? 'open' : ''));
    const placeholders = new Set(view.argNames);
    // Beside the placeholders, the tags `args` describes too.
    const argNames = [...new Set([...placeholders, ...Object.keys(f.args)])];
    const select = (name: string, value: string, choices: string[]) =>
      el(
        'select',
        { name },
        el('option', { value: '', textContent: '—' }),
        ...choices.map((c) => el('option', { value: c, textContent: c, selected: c === value })),
      );
    this.more.append(
      el('summary', {}, 'More', el('span', { className: 'count' })),
      el(
        'div',
        {},
        ...view.locales.filter((l) => l !== locale).map((l) => this.text(l)),
        this.area('context', 'Context', f.context),
        el(
          'div',
          { className: 'row' },
          el('label', {}, 'Kind', select('kind', f.kind, view.kinds)),
          el('label', {}, 'Surface', select('surface', f.surface, view.surfaces)),
        ),
        ...argNames.map((n) =>
          el(
            'label',
            {},
            el('code', { textContent: placeholders.has(n) ? `{${n}}` : `<${n}>` }),
            el('input', { name: `arg.${n}`, value: f.args[n] ?? '', placeholder: 'What it holds' }),
          ),
        ),
        this.area('comment', 'Comment', f.comment, 'Ask whoever edits next for a change'),
        el(
          'div',
          { className: 'row' },
          el('label', { className: 'check' }, el('input', { type: 'checkbox', name: 'fragment', checked: f.fragment }), 'Fragment'),
          el('label', { className: 'check' }, el('input', { type: 'checkbox', name: 'remove', checked: f.remove }), 'Mark for removal'),
        ),
      ),
    );
    return el('div', { className: 'body' }, this.text(locale), ...(translated ? [this.text(view.source)] : []), this.more);
  }

  /** A locale's text, with what lint says of it under it. */
  private text(locale: string): HTMLLabelElement {
    const { view } = this;
    const value = locale === view.source ? view.fields.message : (view.fields.translations[locale] ?? '');
    const label = this.area(
      nameOf(view, locale),
      locale === view.source ? `${locale} · source` : locale,
      value,
      locale === view.source ? undefined : `No translation: the ${view.source} text shows`,
    );
    label.querySelector('textarea')!.dataset['locale'] = locale;
    const list = el('ul', { className: 'findings' });
    list.dataset['locale'] = locale;
    label.append(list);
    return label;
  }

  private area(name: string, label: string, value: string, placeholder = ''): HTMLLabelElement {
    return el('label', {}, label, el('textarea', { name, value, placeholder, rows: rowsFor(value), spellcheck: true }));
  }

  private field(locale: string): HTMLTextAreaElement | null {
    return this.root.querySelector<HTMLTextAreaElement>(`textarea[name="${nameOf(this.view, locale)}"]`);
  }

  private value(name: string): string {
    return this.root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)?.value ?? '';
  }

  private checkbox(name: string): boolean {
    return this.root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked === true;
  }

  private fields(): EntryFields {
    const args: Record<string, string> = {};
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[name^="arg."]')) args[input.name.slice(4)] = input.value;
    return {
      message: this.value('message'),
      translations: Object.fromEntries(this.view.locales.map((l) => [l, this.value(`translation.${l}`)])),
      context: this.value('context'),
      kind: this.value('kind'),
      surface: this.value('surface'),
      fragment: this.checkbox('fragment'),
      args,
      comment: this.value('comment'),
      remove: this.checkbox('remove'),
    };
  }

  private heard(view: EntryView): void {
    this.findings = view.findings;
    this.checked = new Map([[view.source, view.fields.message], ...Object.entries(view.fields.translations)]);
  }

  private showFindings(): void {
    for (const list of this.root.querySelectorAll<HTMLUListElement>('ul.findings')) {
      const locale = list.dataset['locale']!;
      list.replaceChildren(...this.findings.filter((f) => f.locale === locale).map((f) => this.finding(f)));
    }
    // Findings in a field More hides, said on More itself.
    const hidden = this.findings.filter((f) => this.more.contains(this.field(f.locale))).length;
    this.more.querySelector('.count')!.textContent = hidden === 0 ? '' : ` · ${hidden} ${hidden === 1 ? 'finding' : 'findings'}`;
  }

  private finding(f: EntryFinding): HTMLLIElement {
    const field = this.field(f.locale);
    const said = this.checked.get(f.locale);
    // Typed over since the check: the next one is on its way, so the old place and fix are left alone.
    const current = () => (field !== null && field.value === said ? field : undefined);
    const say = button({ className: 'say', textContent: f.message }, () => {
      const target = current();
      if (f.at === undefined || target === undefined) return;
      target.focus();
      target.setSelectionRange(f.at.start, f.at.end);
    });
    const li = el('li', { className: f.severity }, say, el('span', { className: 'rule', textContent: f.rule }));
    const fixed = f.fixed;
    if (fixed !== undefined) {
      li.append(
        button({ className: 'small', textContent: 'Fix' }, () => {
          const target = current();
          if (target === undefined) return;
          target.value = fixed;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }),
      );
    }
    return li;
  }

  private async send(write: boolean): Promise<EntryView | undefined> {
    const res = await fetch(`${this.options.base}__prosebook/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: this.view.key, fields: this.fields(), write }),
    });
    const reply = (await res.json()) as Reply;
    this.problems.replaceChildren(
      ...(reply.problems ?? []).map((p) => el('li', { textContent: p.file === undefined ? p.message : `${p.file}: ${p.message}` })),
    );
    return reply.view;
  }

  /** Checked a moment after typing stops; a reply to an older check than the last is dropped. */
  private check(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const mine = ++this.asked;
      void this.send(false).then((checked) => {
        if (mine !== this.asked) return;
        if (checked === undefined) this.findings = [];
        else this.heard(checked);
        this.showFindings();
      });
    }, 300);
  }

  // The button says how saving goes, so the footer keeps its width.
  private async save(): Promise<void> {
    const b = this.saveButton;
    if (b.disabled) return;
    clearTimeout(this.timer);
    b.disabled = true;
    b.textContent = 'Checking…';
    if ((await this.send(true)) === undefined) {
      b.disabled = false;
      b.textContent = 'Save';
      return;
    }
    b.classList.add('saved');
    b.textContent = 'Saved';
    setTimeout(this.close, 500);
  }

  private async openFile(): Promise<void> {
    const query = new URLSearchParams({ key: this.view.key, locale: this.focused });
    const res = await fetch(`${this.options.base}__prosebook/open?${query}`);
    if (!res.ok) console.warn(`prosebook: ${await res.text()}`);
  }

  /** Below the string, or above it where there is no room below, inside the window either way. */
  private place(): void {
    const { anchor } = this.options;
    const first = anchor[0]!;
    const last = anchor.at(-1)!;
    const box = this.panel.getBoundingClientRect();
    const left = Math.min(Math.max(12, first.left), innerWidth - box.width - 12);
    const below = last.bottom + 8;
    const top = below + box.height <= innerHeight - 12 ? below : Math.max(12, first.top - box.height - 8);
    Object.assign(this.panel.style, { left: `${left}px`, top: `${top}px` });
    // Growing later, with More or problems, moves it up rather than past the bottom.
    new ResizeObserver(() => {
      const now = this.panel.getBoundingClientRect();
      const fitted = Math.max(12, Math.min(now.top, innerHeight - now.height - 12));
      if (fitted !== now.top) this.panel.style.top = `${fitted}px`;
    }).observe(this.panel);
  }
}
