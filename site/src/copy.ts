import { createCopy, type DevHooks } from 'prosebook';
import type { Read } from 'prosebook/inspector';
import { catalog } from './copy/index.ts';

/**
 * What the build read, by the text it came to. The built page carries it (`#reads`) for its inspector,
 * which has no dev server to ask what the server rendered; in dev the integration keeps its own.
 */
export const reads = new Map<string, Read[]>();
if (import.meta.env.SSR && import.meta.env.PROD) {
  // The demo's first view reads a catalog of its own through the same hook; only the page's keys can be opened.
  const own = catalog.messages[catalog.source] ?? {};
  (globalThis as DevHooks).__PROSEBOOK_READ__ = (key, text, locale) => {
    if (Object.hasOwn(own, key)) reads.set(text, [{ key, locale }]);
  };
}

/** The page's words: read by the page as it is built, and by its scripts in the browser. */
export const { t } = createCopy(catalog);
