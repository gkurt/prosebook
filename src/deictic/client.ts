/**
 * `prosebook/deictic/client`: the copy inspector's page half. While deictic's keys are held, the string under
 * the pointer is outlined and its key is a tag in deictic's caption (`tag`); the Copy tab edits that string's entry (`panel.ts`), or, opened on
 * an element some other way, lets you pick among the strings in it.
 *
 * Text carries no key: `<Text>` renders a fragment and `t()` returns a bare string, so the runtime reports every
 * read (`reads.ts`) and the text under the pointer is matched back to them (`locate.ts`), with what the dev
 * server's own renders read beside them (the `reads` route). The string is taken as the press goes down
 * (`pressed`), before the popup covers it.
 */
import type { ClientContext, ClientPlugin, PanelContext } from 'deictic';

import { caretAt, keyAt, linesOf, rangeOf, type Hit } from './locate.ts';
import { button, el, PURPLE, showEntry, STYLE, type EditorContext } from './panel.ts';
import { listen, type Read, type Reads } from './reads.ts';
import type { EntryEdit, Place } from './routes.ts';

export type { Read } from './reads.ts';

const reads = typeof window === 'undefined' ? new Map<string, Read[]>() : listen();
/** What the dev server's renders read, asked for again each time the keys go down. */
let served: Reads = new Map();
let pointer: { x: number; y: number } | undefined;
/** The string under the last press, by the element deictic opens on. */
let press: { element: Element; hit: Hit | undefined } | undefined;

// The browser's own reads win where both came to the same text: they are the more recent.
const known = (): Reads => (served.size === 0 ? reads : new Map([...served, ...reads]));

const hitAt = (x: number, y: number): Hit | undefined => {
  const target = document.elementFromPoint(x, y);
  return target === null ? undefined : keyAt(target, caretAt(x, y), known());
};

const fetchServed = (context: ClientContext) =>
  context
    .request('reads')
    .then(async (res) => {
      if (res.ok) served = new Map((await res.json()) as [string, Read[]][]);
    })
    .catch(() => undefined);

/** The boxes the text found takes on screen, one per line, or its element's when it has no range. */
function linesOfHit(hit: Hit): DOMRect[] {
  // Only the text's own lines, as an element may hold other strings beside it.
  const lines = hit.at === undefined ? [] : linesOf(rangeOf(hit.element, hit.at));
  return lines.length > 0 ? lines : [hit.element.getBoundingClientRect()];
}

/** Every string read inside an element, longest first: a rich message before the texts inside it. */
function stringsIn(element: Element): { text: string; read: Read }[] {
  const text = element.textContent ?? '';
  const attributes = [element, ...element.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.value));
  const found = [...known()].filter(([said]) => text.includes(said) || attributes.includes(said));
  return found.map(([said, seen]) => ({ text: said, read: seen[0]! })).toSorted((a, b) => b.text.length - a.text.length);
}

const LAYER = `
.prosebook-lines { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
.prosebook-lines .line { position: fixed; box-sizing: border-box; outline: 2px solid #a78bfa; background: rgb(167 139 250 / 0.12); border-radius: 2px; }
`;

/** An outline per line of the string under the pointer, or of the one the panel's key is hovered for. */
function outline(context: ClientContext): { show: (hit: Hit | undefined) => void; remove: () => void } {
  const layer = el('div', { className: 'prosebook-lines' }, el('style', { textContent: LAYER }));
  context.root.append(layer);
  return {
    show(hit) {
      const style = layer.firstChild!;
      if (hit === undefined) return layer.replaceChildren(style);
      const boxes = linesOfHit(hit).map((r) => {
        const box = el('div', { className: 'line' });
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        return box;
      });
      layer.replaceChildren(style, ...boxes);
    },
    remove: () => layer.remove(),
  };
}

export default {
  name: 'prosebook',
  label: 'Copy',
  setup(context) {
    // Before deictic's own listeners, which call `pressed`: the point is the press's.
    const at = (e: PointerEvent) => (pointer = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', at, { capture: true, passive: true });
    window.addEventListener('pointerdown', at, { capture: true, passive: true });
    void fetchServed(context);
  },
  pointing(context) {
    const lines = outline(context);
    let frame = 0;
    const update = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        lines.show(pointer === undefined ? undefined : hitAt(pointer.x, pointer.y));
      });
    };
    window.addEventListener('pointermove', update, { capture: true, passive: true });
    void fetchServed(context).then(update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', update, { capture: true });
      lines.remove();
    };
  },
  tag(_context, at) {
    const hit = hitAt(at.x, at.y);
    if (hit === undefined) return undefined;
    const others = hit.others > 0 ? ` +${hit.others}` : '';
    return { text: `${hit.read.key} · ${hit.read.locale}${others}`, color: PURPLE };
  },
  pressed(_context, element) {
    press = { element, hit: pointer === undefined ? undefined : hitAt(pointer.x, pointer.y) };
  },
  mount(panel, context) {
    const root = el('div', { className: 'prosebook' });
    panel.append(el('style', { textContent: STYLE }), root);
    const editor: EditorContext = {
      request: context.request,
      apply: (edit: EntryEdit) => context.apply(edit),
      unsaved: context.unsaved,
      open: (place: Place) => context.edit(place),
    };
    let stop = () => {};
    const show = (read: Read) => {
      stop = showEntry(root, editor, read.key, read.locale);
    };

    const hit = hitOf(context);
    if (hit !== undefined) {
      // The key's hover outlines the string on the page, for as long as it lasts.
      editor.outline = () => {
        const lines = outline(context);
        lines.show(hit);
        return lines.remove;
      };
      show(hit.read);
      return () => stop();
    }
    const strings = stringsIn(context.element);
    const [only] = strings;
    if (only !== undefined && strings.length === 1) {
      show(only.read);
    } else if (only === undefined) {
      root.append(
        el('p', { className: 'hint', textContent: 'No text here comes from the catalog. Hold the keys over a string to see its key.' }),
      );
    } else {
      root.append(
        el('p', { className: 'hint', textContent: 'Which string?' }),
        el(
          'ul',
          { className: 'picks' },
          ...strings.map(({ text, read }) => {
            const pick = button({}, () => show(read));
            pick.append(el('span', { textContent: text }), el('code', { textContent: read.key }));
            return el('li', {}, pick);
          }),
        ),
      );
    }
    return () => stop();
  },
} satisfies ClientPlugin<null, EntryEdit>;

/** The string the popup was opened on: the press's, on this element, or the spot's it was opened at. */
function hitOf(context: PanelContext<null, EntryEdit>): Hit | undefined {
  if (press?.element === context.element && press.hit !== undefined) return press.hit;
  if (context.at === undefined) return undefined;
  const box = context.element.getBoundingClientRect();
  return hitAt(box.left + context.at.x, box.top + context.at.y);
}
