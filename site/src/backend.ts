/**
 * What answers the built page's inspector: `prosebook/playground`'s endpoints over the catalog's own YAML,
 * held to the lint the CLI holds it to. An edit is kept in memory, and shown on the page as a dev server's
 * hot update would show it; a reload brings the published words back.
 */
import { createCopy, type DevHooks } from 'prosebook';
import type { Read } from 'prosebook/inspector';
import { endpoints, play, type Files, type ProsebookConfig } from 'prosebook/playground';
import { lint } from './lint.ts';

const REPO = 'https://github.com/gkurt/prosebook';
const CONFIG: ProsebookConfig = { catalog: 'copy/catalog', source: 'en', lint };

const yaml = import.meta.glob<string>('../copy/catalog/*.yaml', { query: '?raw', import: 'default', eager: true });
const files: Files = Object.fromEntries(Object.entries(yaml).map(([path, content]) => [path.replace(/^\.\.\//, ''), content]));

/** Each entry's text and the locale's compiled messages. No entry of the page's takes a value. */
function read(of: Files) {
  const { catalog } = play(of, CONFIG);
  const t = createCopy(catalog).t;
  const messages = catalog.messages['en'] ?? {};
  // The catalog as edited, every key of it: nothing the build prunes by.
  // prosebook-ignore
  return { messages, texts: new Map(Object.keys(messages).map((key) => [key, t(key)])) };
}

/** Where a page says a key's text beyond its text nodes. */
const ATTRIBUTES = ['aria-label', 'content', 'data-copied'];

/** `before` wherever the page says it, replaced by `after`. */
function rewrite(before: string, after: string) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.trim() === before && text.parentElement?.closest('script, style') === null) text.data = text.data.replace(before, after);
  }
  for (const name of ATTRIBUTES)
    for (const el of document.querySelectorAll(`[${name}]`)) if (el.getAttribute(name) === before) el.setAttribute(name, after);
  if (document.title === before) document.title = after;
}

let shown = read(files).texts;
let served: [string, Read[]][] = [];

const handle = endpoints(files, CONFIG, {
  base: import.meta.env.BASE_URL.replace(/\/?$/, '/'),
  open: ({ file, line }) => window.open(`${REPO}/blob/main/site/${file}#L${line}`, '_blank', 'noopener'),
  saved(next) {
    // Reading each entry again tells the inspector its new text, as any read does.
    const { messages, texts } = read(next);
    for (const hot of (globalThis as DevHooks).__PROSEBOOK_HOT__ ?? []) hot('en', messages);
    for (const [key, after] of texts) {
      const before = shown.get(key);
      if (before === undefined || before === after) continue;
      rewrite(before, after);
      // The build's read of the old text no longer stands.
      const stale = served.findIndex(([text]) => text === before);
      if (stale !== -1) served.splice(stale, 1);
    }
    shown = texts;
  },
});

/** Answers a request of the inspector's; `reads` is the build's, which an edit takes its old text out of. */
export function answer(reads: [string, Read[]][], request: Request): Promise<Response | undefined> {
  served = reads;
  return handle(request);
}
