/**
 * The dev inspector each integration loads into the page: hold Alt and point at a string to see its
 * key, Alt-click to open the entry it came from, Alt-Shift-click to open the catalog entry instead of
 * the translation. Alt-right-click edits the entry on the page instead (`inspector-dialog.ts`).
 *
 * Text on screen carries no key. `<Text>` renders a fragment, so marking it would take a wrapper
 * element that exists only in dev and changes what a stylesheet sees; `t()` returns a bare string. So
 * the runtime reports every read (`ReadHook`) and the text under the pointer is matched back to them.
 */
import type { DevHooks } from '#src/runtime/types.ts';

import { openDialog } from './inspector-dialog.ts';
import { record, type Read, type Reads } from './reads.ts';

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
  /** Where the text is in the element's, or nothing for an attribute's. */
  at?: { start: number; end: number };
}

const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'value'];

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
      const found = at === undefined ? whole(text, said) : covering(text, said, at);
      if (found !== undefined) best = { text: said, read: seen[0]!, others: seen.length - 1, element: el, at: found };
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

/** The occurrence of `said` in `text` holding the character at `at`. */
function covering(text: string, said: string, at: number): Hit['at'] {
  const start = text.indexOf(said, Math.max(0, at - said.length + 1));
  return start === -1 || start > at ? undefined : { start, end: start + said.length };
}

/** The text without the space around it, when that is what was said. */
function whole(text: string, said: string): Hit['at'] {
  if (text.trim() !== said.trim()) return undefined;
  const start = text.length - text.trimStart().length;
  return { start, end: start + text.trim().length };
}

/** The range of the element's text between two indexes in it. */
export function rangeOf(el: Element, { start, end }: { start: number; end: number }): Range {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (start >= offset && start < offset + length) range.setStart(node, start - offset);
    if (end > offset && end <= offset + length) {
      range.setEnd(node, end - offset);
      break;
    }
    offset += length;
  }
  return range;
}

/**
 * The boxes a range's text takes on screen, one per line: a range across elements has a rect for each
 * element and each piece of text, which overlap.
 */
function linesOf(range: Range): DOMRect[] {
  const lines: DOMRect[] = [];
  for (const r of [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top)) {
    const line = lines.find((l) => Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > Math.min(l.height, r.height) / 2);
    if (line === undefined) {
      lines.push(DOMRect.fromRect(r));
      continue;
    }
    const left = Math.min(line.left, r.left);
    const top = Math.min(line.top, r.top);
    Object.assign(line, { x: left, y: top, width: Math.max(line.right, r.right) - left, height: Math.max(line.bottom, r.bottom) - top });
  }
  return lines;
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

/**
 * Starts listening for reads and for Alt on the page, once: Bun and Next call it from the generated
 * index, which runs again whenever it changes.
 */
export function install({ base }: InspectorOptions): void {
  const hooks = globalThis as DevHooks;
  if (hooks.__PROSEBOOK_READ__ !== undefined) return;
  const reads: Reads = new Map();
  hooks.__PROSEBOOK_READ__ = (key, text, locale) => record(reads, key, text, locale);
  // What a server render read, as Astro's pages and a framework's first frame are: asked for again each
  // time Alt goes down, since a page the server renders again after an edit runs no script to say so.
  let served: Reads = new Map();
  const fetchServed = () =>
    fetch(`${base}__prosebook/reads`)
      .then(async (res) => {
        if (res.ok) served = new Map((await res.json()) as [string, Read[]][]);
      })
      .catch(() => undefined);
  void fetchServed();
  // The browser's own reads win where both came to the same text: they are the more recent.
  const known = () => (served.size === 0 ? reads : new Map([...served, ...reads]));

  // A box per line of the text found, the label on the first.
  const layer = document.createElement('div');
  const label = document.createElement('div');
  Object.assign(layer.style, { position: 'fixed', inset: '0', display: 'none', zIndex: '2147483647', pointerEvents: 'none' });
  const lineBox = () => {
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      outline: '2px solid #7c3aed',
      background: 'rgb(124 58 237 / 0.08)',
    });
    return box;
  };
  Object.assign(label.style, {
    position: 'fixed',
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
    return target === null ? undefined : keyAt(target, caretAt(x, y), known());
  };
  const hide = () => {
    layer.style.display = 'none';
  };
  const show = () => {
    frame = 0;
    const hit = pointer === undefined ? undefined : hitAt(pointer.x, pointer.y);
    if (hit === undefined) return hide();
    // Only the text's own lines, as an element may hold other strings beside it.
    const lines = hit.at === undefined ? [] : linesOf(rangeOf(hit.element, hit.at));
    if (lines.length === 0) lines.push(hit.element.getBoundingClientRect());
    layer.replaceChildren(
      ...lines.map((r) => {
        const box = lineBox();
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        return box;
      }),
      label,
    );
    const first = lines[0]!;
    // Below the first line when there is no room above it.
    Object.assign(label.style, {
      left: `${first.left - 2}px`,
      top: first.top < 24 ? `${first.bottom + 2}px` : '',
      bottom: first.top < 24 ? '' : `${innerHeight - first.top + 2}px`,
    });
    label.textContent = `${hit.read.key} · ${hit.read.locale}${hit.others > 0 ? ` (+${hit.others} with this text)` : ''}`;
    layer.style.display = 'block';
    if (!layer.isConnected) document.body.append(layer);
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
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Alt' && !e.repeat) void fetchServed().then(() => update(e));
      update(e);
    },
    true,
  );
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
