/**
 * The dev inspector each integration loads into the page. One gesture: hold Alt to see which entry a
 * string comes from, and Alt-click it to edit that entry on the page (`dialog.ts`), which also opens
 * it in the editor.
 */
import type { DevHooks } from '#src/runtime/types.ts';

import { openDialog } from './dialog.ts';
import { caretAt, keyAt, linesOf, rangeOf, type Hit } from './locate.ts';
import { record, type Read, type Reads } from './reads.ts';

export interface InspectorOptions {
  /** The dev server's base URL, ending in `/`. */
  base: string;
}

const ACCENT = '#7c3aed';

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

  const hitAt = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y);
    return target === null ? undefined : keyAt(target, caretAt(x, y), known());
  };
  const overlay = createOverlay();

  let pointer: { x: number; y: number } | undefined;
  let frame = 0;
  const update = (e: MouseEvent | KeyboardEvent) => {
    if (!e.altKey) return overlay.hide();
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const hit = pointer === undefined ? undefined : hitAt(pointer.x, pointer.y);
      if (hit === undefined) overlay.hide();
      else overlay.show(hit);
    });
  };

  const listen = <K extends keyof WindowEventMap>(type: K, handle: (e: WindowEventMap[K]) => void) =>
    window.addEventListener(type, handle, { capture: true });
  listen('mousemove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
    update(e);
  });
  listen('keydown', (e) => {
    if (e.key === 'Alt' && !e.repeat) void fetchServed().then(() => update(e));
    update(e);
  });
  listen('keyup', update);
  listen('blur', overlay.hide);
  // Alt-click on a link would otherwise download it, and on a field focus it.
  listen('mousedown', (e) => {
    if (e.altKey && hitAt(e.clientX, e.clientY) !== undefined) e.preventDefault();
  });
  listen('click', (e) => {
    if (!e.altKey) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    overlay.hide();
    void openDialog({ base, key: hit.read.key, locale: hit.read.locale, anchor: linesOfHit(hit) });
  });
}

/** The boxes the text found takes on screen, one per line, or its element's when it has no range. */
function linesOfHit(hit: Hit): DOMRect[] {
  // Only the text's own lines, as an element may hold other strings beside it.
  const lines = hit.at === undefined ? [] : linesOf(rangeOf(hit.element, hit.at));
  return lines.length > 0 ? lines : [hit.element.getBoundingClientRect()];
}

/** An outline per line of the text under the pointer, its key on the first. */
function createOverlay(): { show: (hit: Hit) => void; hide: () => void } {
  const layer = document.createElement('div');
  const label = document.createElement('div');
  Object.assign(layer.style, { position: 'fixed', inset: '0', display: 'none', zIndex: '2147483646', pointerEvents: 'none' });
  Object.assign(label.style, {
    position: 'fixed',
    padding: '1px 6px',
    borderRadius: '3px',
    font: '12px/1.5 ui-monospace, monospace',
    whiteSpace: 'nowrap',
    color: '#fff',
    background: ACCENT,
  });
  const box = (r: DOMRect) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      outline: `2px solid ${ACCENT}`,
      background: 'rgb(124 58 237 / 0.08)',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    return el;
  };

  return {
    show(hit) {
      const lines = linesOfHit(hit);
      layer.replaceChildren(...lines.map(box), label);
      const first = lines[0]!;
      // Above the first line, or below it when there is no room above.
      Object.assign(label.style, {
        left: `${first.left - 2}px`,
        top: first.top < 24 ? `${first.bottom + 2}px` : '',
        bottom: first.top < 24 ? '' : `${innerHeight - first.top + 2}px`,
      });
      label.textContent = `${hit.read.key} · ${hit.read.locale}${hit.others > 0 ? ` · +${hit.others} with this text` : ''}`;
      layer.style.display = 'block';
      if (!layer.isConnected) document.body.append(layer);
    },
    hide() {
      layer.style.display = 'none';
    },
  };
}
