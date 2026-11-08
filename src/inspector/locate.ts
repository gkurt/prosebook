/**
 * Text on screen back to the read that said it. Text carries no key: `<Text>` renders a fragment, so
 * marking it would take a wrapper element that exists only in dev and changes what a stylesheet sees,
 * and `t()` returns a bare string. So the runtime reports every read (`ReadHook`), and the text under
 * the pointer is matched back to them.
 */
import type { Read, Reads } from './reads.ts';

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
export function linesOf(range: Range): DOMRect[] {
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
