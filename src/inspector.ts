/**
 * The dev inspector the Vite plugin loads into the page: hold Alt and point at a string to see its
 * key, Alt-click to open the entry it came from, Alt-Shift-click to open the catalog entry instead of
 * the translation. Alt-right-click edits the entry on the page instead (`inspector-dialog.ts`).
 *
 * Text on screen carries no key. `<Text>` renders a fragment, so marking it would take a wrapper
 * element that exists only in dev and changes what a stylesheet sees; `t()` returns a bare string. So
 * the runtime reports every read (`ReadHook`) and the text under the pointer is matched back to them.
 */
import type { DevHooks } from '#src/runtime/types.ts';

import { openDialog } from './inspector-dialog.ts';

export interface Read {
  key: string;
  /** The locale the message was found in. */
  locale: string;
}

/** Recent reads by the text they came to, least recent text first; each text's keys most recent first. */
export type Reads = Map<string, Read[]>;

/** The character under the pointer: a text node and its index there. */
export interface Caret {
  node: Node;
  offset: number;
}

export interface Hit {
  text: string;
  read: Read;
  /** How many other keys came to the same text. */
  others: number;
  /** The innermost element holding all of the text. */
  element: Element;
}

// Enough for every string on a busy screen and the ones it showed a moment ago.
const LIMIT = 2000;
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'value'];

export function record(reads: Reads, key: string, text: string, locale: string): void {
  if (text.trim() === '') return;
  const seen = reads.get(text) ?? [];
  reads.delete(text);
  reads.set(text, seen[0]?.key === key && seen[0].locale === locale ? seen : [{ key, locale }, ...seen.filter((r) => r.key !== key)]);
  if (reads.size > LIMIT) reads.delete(reads.keys().next().value!);
}

/**
 * The read under the caret: the longest text that covers it, in the innermost element holding all of
 * it. A rich message runs across its elements, so it wins over a shorter text inside one of them.
 * Without a caret (over an input, or padding) an element's whole text, or the target's readable
 * attribute, must equal a read.
 */
export function keyAt(target: Element, caret: Caret | undefined, reads: Reads): Hit | undefined {
  let best: Hit | undefined;
  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    const text = el.textContent ?? '';
    const at = caret === undefined ? undefined : offsetIn(el, caret);
    for (const [said, seen] of reads) {
      if (said.length <= (best?.text.length ?? 0)) continue;
      if (at === undefined ? text.trim() === said.trim() : covers(text, said, at))
        best = { text: said, read: seen[0]!, others: seen.length - 1, element: el };
    }
    if (best !== undefined || el !== target) continue;
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      const seen = value === null ? undefined : reads.get(value);
      if (value !== null && seen !== undefined) return { text: value, read: seen[0]!, others: seen.length - 1, element: el };
    }
  }
  return best;
}

/** Whether an occurrence of `said` in `text` holds the character at `at`. */
function covers(text: string, said: string, at: number): boolean {
  const start = text.indexOf(said, Math.max(0, at - said.length + 1));
  return start !== -1 && start <= at;
}

/** The caret's index in the element's text, or nothing when the caret is outside it. */
function offsetIn(el: Element, caret: Caret): number | undefined {
  if (caret.node.nodeType !== Node.TEXT_NODE || !el.contains(caret.node)) return undefined;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node === caret.node) return offset + caret.offset;
    offset += node.textContent?.length ?? 0;
  }
  return undefined;
}

/** The character under a point on screen, where the browser can say. */
export function caretAt(x: number, y: number): Caret | undefined {
  if (typeof document.caretPositionFromPoint !== 'function') return undefined;
  const position = document.caretPositionFromPoint(x, y);
  if (position === null) return undefined;
  const { offsetNode: node, offset } = position;
  // A caret position sits between two characters, and where one string ends the next may begin: take
  // the character the pointer is over, or the one before (past the end of a line, in padding).
  if (node.nodeType !== Node.TEXT_NODE || offset === 0) return { node, offset };
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, Math.min(offset + 1, node.textContent?.length ?? 0));
  const r = range.getBoundingClientRect();
  const over = !range.collapsed && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  return { node, offset: over ? offset : offset - 1 };
}

export interface InspectorOptions {
  /** The dev server's base URL, ending in `/`. */
  base: string;
}

/** Starts listening for reads and for Alt on the page. Called by the module the Vite plugin serves. */
export function install({ base }: InspectorOptions): void {
  const reads: Reads = new Map();
  (globalThis as DevHooks).__PROSEBOOK_READ__ = (key, text, locale) => record(reads, key, text, locale);

  const box = document.createElement('div');
  const label = document.createElement('div');
  box.append(label);
  Object.assign(box.style, {
    position: 'fixed',
    display: 'none',
    zIndex: '2147483647',
    pointerEvents: 'none',
    boxSizing: 'border-box',
    outline: '2px solid #7c3aed',
    background: 'rgb(124 58 237 / 0.08)',
  });
  Object.assign(label.style, {
    position: 'absolute',
    left: '-2px',
    padding: '1px 6px',
    font: '12px/1.5 ui-monospace, monospace',
    whiteSpace: 'nowrap',
    color: '#fff',
    background: '#7c3aed',
  });

  let pointer: { x: number; y: number } | undefined;
  let frame = 0;

  const hitAt = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y);
    return target === null ? undefined : keyAt(target, caretAt(x, y), reads);
  };
  const hide = () => {
    box.style.display = 'none';
  };
  const show = () => {
    frame = 0;
    const hit = pointer === undefined ? undefined : hitAt(pointer.x, pointer.y);
    if (hit === undefined) return hide();
    const r = hit.element.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    // Below the box when there is no room above it.
    Object.assign(label.style, r.top < 24 ? { top: '100%', bottom: '' } : { top: '', bottom: '100%' });
    label.textContent = `${hit.read.key} · ${hit.read.locale}${hit.others > 0 ? ` (+${hit.others} with this text)` : ''}`;
    if (!box.isConnected) document.body.append(box);
  };
  const update = (e: MouseEvent | KeyboardEvent) => {
    if (!e.altKey) return hide();
    if (frame === 0) frame = requestAnimationFrame(show);
  };

  window.addEventListener(
    'mousemove',
    (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      update(e);
    },
    { capture: true, passive: true },
  );
  window.addEventListener('keydown', update, true);
  window.addEventListener('keyup', update, true);
  window.addEventListener('blur', hide);
  // Alt-click on a link would otherwise download it, and on a field focus it.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.altKey && hitAt(e.clientX, e.clientY) !== undefined) e.preventDefault();
    },
    true,
  );
  window.addEventListener(
    'click',
    (e) => {
      if (!e.altKey) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (hit === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      void open(base, hit.read, e.shiftKey);
    },
    true,
  );
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.altKey) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (hit === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      hide();
      const catalog = e.shiftKey;
      void openDialog({
        base,
        key: hit.read.key,
        locale: catalog ? undefined : hit.read.locale,
        x: e.clientX,
        y: e.clientY,
        openFile: () => void open(base, hit.read, catalog),
      });
    },
    true,
  );
}

async function open(base: string, read: Read, catalog: boolean): Promise<void> {
  const query = new URLSearchParams({ key: read.key, locale: read.locale });
  if (catalog) query.set('catalog', '');
  const res = await fetch(`${base}__prosebook/open?${query}`);
  if (!res.ok) console.warn(`prosebook: ${await res.text()}`);
}
