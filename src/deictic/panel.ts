/**
 * The Copy tab's editor: one entry, opened on its text as read, in its locale, with what lint says of it; the
 * source beside a translation; and the rest of the entry (its other locales, context, role, placeholders) under
 * More, closed each time it opens.
 *
 * Saving is deictic's `apply`: the server half checks the edit as the whole catalog and hands back the files'
 * new text, which deictic writes and keeps in its history, so the popup's undo takes it back. While typing, the
 * editor asks the `entry` route to check the edit unsaved, and a finding selects its words or, with a fix, makes
 * it: no lint code ships to the browser.
 *
 * A reviewer who would rather ask than edit leaves a comment, or marks the entry for removal: both are written in
 * the catalog, where whoever edits next, often an agent, finds them among the warnings.
 *
 * It draws in deictic's shadow root, with deictic's custom properties, every class under `.prosebook`.
 */
import type { Problem } from '#src/tools/catalog.ts';
import type { EntryFields, EntryFinding, EntryView } from '#src/tools/entry.ts';

import type { EntryEdit, Place } from './routes.ts';

export interface EditorContext {
  /** One of the plugin's routes. */
  request: (route: string, init?: RequestInit) => Promise<Response>;
  /** Saves the edit through deictic, which rejects with the server's reason and shows it. */
  apply: (edit: EntryEdit) => Promise<unknown>;
  /** Opens a place in the editor, through deictic (`context.edit`), which rejects with why it couldn't. */
  open: (place: Place) => Promise<void>;
  /** Says what leaving would lose: the Save button while there's an edit, else nothing. */
  unsaved: (action: HTMLElement | undefined) => void;
  /** Outlines the string on the page while the key is hovered, where the panel was opened on one: answers what ends it. */
  outline?: () => () => void;
}

type Reply = { view?: EntryView; problems?: Problem[] };

/** The copy inspector's color, its tag's in deictic's caption and its key's in the panel, apart from deictic's accent. */
export const PURPLE = '#7c3aed';

export const STYLE = `
.prosebook { display: grid; gap: 12px; }
.prosebook .bar { display: flex; align-items: center; gap: 8px; }
.prosebook .key { font: 600 12px/1.5 ui-monospace, monospace; color: #fff; background: ${PURPLE}; padding: 1px 6px; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prosebook button kbd { display: inline-block; box-sizing: border-box; min-width: 18px; margin-left: 6px; padding: 0 4px; border: 1px solid rgb(255 255 255 / 0.3); border-bottom-width: 2px; border-radius: 4px; font: 11px/15px ui-monospace, monospace; text-align: center; }
.prosebook button kbd + kbd { margin-left: 3px; }
.prosebook .grow { flex: 1; }
.prosebook button.quiet { border: 0; color: var(--deictic-muted); }
.prosebook button.quiet:hover { color: var(--deictic-fg); }
.prosebook .hint { font-size: 12px; color: var(--deictic-muted); }
.prosebook label { display: grid; gap: 4px; font-size: 12px; font-weight: 500; color: var(--deictic-muted); }
.prosebook textarea { font: 13px/1.45 system-ui, sans-serif; resize: vertical; }
.prosebook select { font: inherit; color: inherit; background: rgb(0 0 0 / 0.35); border: 1px solid var(--deictic-line); border-radius: 6px; padding: 4px 6px; }
.prosebook summary { cursor: pointer; font-size: 12px; font-weight: 500; color: var(--deictic-muted); }
.prosebook summary .count { color: var(--deictic-problem); font-weight: 400; }
.prosebook details > div { display: grid; gap: 12px; margin-top: 12px; }
.prosebook .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.prosebook .check { display: flex; align-items: center; gap: 6px; color: var(--deictic-fg); font-weight: 400; }
.prosebook .check input { width: auto; margin: 0; }
.prosebook .problems { margin: 0; padding-left: 16px; color: var(--deictic-problem); }
.prosebook .problems:empty { display: none; }
.prosebook .findings { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; font-weight: 400; color: var(--deictic-fg); }
.prosebook .findings:empty { display: none; }
.prosebook .findings li { display: flex; align-items: baseline; gap: 6px; }
.prosebook .findings li::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: #fbbf24; }
.prosebook .findings li.error::before { background: var(--deictic-problem); }
.prosebook .findings .say { flex: 1; border: 0; padding: 0; text-align: left; }
.prosebook .findings .say:hover { text-decoration: underline; }
.prosebook .findings .rule { font: 11px/1.4 ui-monospace, monospace; color: var(--deictic-muted); }
.prosebook .picks { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.prosebook .picks button { display: grid; width: 100%; gap: 2px; padding: 6px 8px; text-align: left; border-radius: 6px; }
.prosebook .picks code { color: var(--deictic-muted); }
`;

/** An element with properties set (`className`, `value`, `checked`, ...) and children appended. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: object = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

export function button(props: object, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', ...props });
  b.addEventListener('click', onClick);
  return b;
}

const rowsFor = (text: string) => Math.min(10, Math.max(2, text.split('\n').length + (text.length > 50 ? 1 : 0)));

/** Draws the editor for an entry into `container`, once it's read; answers what stops it. */
export function showEntry(container: HTMLElement, context: EditorContext, key: string, locale: string): () => void {
  let editor: Editor | undefined;
  let stopped = false;
  void context
    .request(`entry?${new URLSearchParams({ key })}`)
    .then(async (res) => {
      const loaded = (await res.json()) as EntryView | { problems: Problem[] };
      if (stopped) return;
      if ('problems' in loaded) {
        container.replaceChildren(el('ul', { className: 'problems' }, ...loaded.problems.map((p) => el('li', { textContent: p.message }))));
        return;
      }
      editor = new Editor(container, context, loaded, loaded.locales.includes(locale) ? locale : loaded.source);
    })
    .catch((e: unknown) => {
      if (!stopped) container.replaceChildren(el('p', { className: 'problems', textContent: e instanceof Error ? e.message : String(e) }));
    });
  return () => {
    stopped = true;
    editor?.stop();
  };
}

/** Each text field's name: the source's `message`, a translation's `translation.<locale>`. */
const nameOf = (view: EntryView, locale: string) => (locale === view.source ? 'message' : `translation.${locale}`);

class Editor {
  private readonly problems = el('ul', { className: 'problems' });
  private readonly more = el('details');
  /** What the Save button says, beside its keys' caps. */
  private readonly saying = el('span', { textContent: 'Save' });
  private readonly saveButton = button({ className: 'primary' }, () => void this.save());
  /** What lint said, and each locale's text it said it of: a finding's place and fix are in that text. */
  private findings: EntryFinding[] = [];
  private checked = new Map<string, string>();
  /** The fields as last saved or read, which an edit differs from. */
  private saved = '';
  /** The locale whose file Open in editor opens: the field last in focus. */
  private focused: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private asked = 0;
  private readonly root: HTMLElement;
  private readonly context: EditorContext;
  private readonly view: EntryView;
  /** The locale the string was read in. */
  private readonly locale: string;

  constructor(root: HTMLElement, context: EditorContext, view: EntryView, locale: string) {
    this.root = root;
    this.context = context;
    this.view = view;
    this.locale = locale;
    this.focused = locale;
    this.heard(view);
    root.replaceChildren(this.bar(), this.body(), this.problems, this.footer());
    this.saved = JSON.stringify(this.fields());
    this.showFindings();

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void this.save();
    });
    root.addEventListener('input', this.edited);
    root.addEventListener('change', this.edited);
    root.addEventListener('focusin', (e) => {
      const field = e.composedPath()[0];
      if (field instanceof HTMLTextAreaElement && field.dataset['locale'] !== undefined) this.focused = field.dataset['locale'];
    });
    this.field(locale)?.focus();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private readonly edited = () => {
    const changed = JSON.stringify(this.fields()) !== this.saved;
    this.context.unsaved(changed ? this.saveButton : undefined);
    if (changed) this.saying.textContent = 'Save';
    this.check();
  };

  private bar(): HTMLElement {
    const open = button(
      { className: 'quiet', textContent: 'Open entry ↗', title: 'Open the entry in your editor' },
      () => void this.openFile(),
    );
    const key = el('span', { className: 'key', textContent: this.view.key, title: this.view.key });
    let unlit: (() => void) | undefined;
    key.addEventListener('pointerenter', () => (unlit = this.context.outline?.()));
    key.addEventListener('pointerleave', () => {
      unlit?.();
      unlit = undefined;
    });
    return el('div', { className: 'bar' }, key, el('span', { className: 'grow' }), open);
  }

  private footer(): HTMLElement {
    const mac = /Mac|iP/.test(navigator.platform);
    // Its keys as caps in the button itself, as in deictic's own tips.
    this.saveButton.append(this.saying, el('kbd', { textContent: mac ? '⌘' : 'Ctrl' }), el('kbd', { textContent: '↵' }));
    return el('div', { className: 'bar' }, el('span', { className: 'grow' }), this.saveButton);
  }

  /** The text as read, the source beside a translation, and the rest of the entry under More. */
  private body(): DocumentFragment {
    const { view, locale } = this;
    const f = view.fields;
    const translated = locale !== view.source;

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
    const body = document.createDocumentFragment();
    body.append(this.text(locale), ...(translated ? [this.text(view.source)] : []), this.more);
    return body;
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
        button({ textContent: 'Fix' }, () => {
          const target = current();
          if (target === undefined) return;
          target.value = fixed;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }),
      );
    }
    return li;
  }

  private showProblems(problems: Problem[]): void {
    this.problems.replaceChildren(
      ...problems.map((p) => el('li', { textContent: p.file === undefined ? p.message : `${p.file}: ${p.message}` })),
    );
  }

  /** Checked a moment after typing stops; a reply to an older check than the last is dropped. */
  private check(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const mine = ++this.asked;
      void this.context
        .request('entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: this.view.key, fields: this.fields() } satisfies EntryEdit),
        })
        .then(async (res) => {
          const reply = (await res.json()) as Reply;
          if (mine !== this.asked) return;
          this.showProblems(reply.problems ?? []);
          if (reply.view === undefined) this.findings = [];
          else this.heard(reply.view);
          this.showFindings();
        });
    }, 300);
  }

  // The button says how saving goes, so the bar keeps its width.
  private async save(): Promise<void> {
    const b = this.saveButton;
    if (b.disabled) return;
    clearTimeout(this.timer);
    b.disabled = true;
    this.saying.textContent = 'Saving…';
    const fields = this.fields();
    try {
      await this.context.apply({ key: this.view.key, fields });
    } catch {
      // deictic shows why, under the panel.
      b.disabled = false;
      this.saying.textContent = 'Save';
      return;
    }
    this.saved = JSON.stringify(fields);
    this.context.unsaved(undefined);
    this.showProblems([]);
    b.disabled = false;
    this.saying.textContent = 'Saved';
  }

  private async openFile(): Promise<void> {
    const res = await this.context.request(`place?${new URLSearchParams({ key: this.view.key, locale: this.focused })}`);
    if (!res.ok) return this.showProblems([{ severity: 'error', message: await res.text() }]);
    await this.context
      .open((await res.json()) as Place)
      .catch((e: unknown) => this.showProblems([{ severity: 'error', message: e instanceof Error ? e.message : String(e) }]));
  }
}
