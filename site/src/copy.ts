import { createCopy, type DevHooks } from 'prosebook';

import { catalog } from './copy/index.ts';

/** The page's one copy, in English, read by the page as it is built and by its scripts in the browser. */
export const copy = createCopy(catalog);

/**
 * Each text the page shows, by the key it was read from, with the values it was read with: the DOM
 * carries no keys, so the built page carries these for its inspector (`inspect.ts`), as a dev server
 * hands its reads to the real one. Tag functions are left out: the page's own elements stand for them.
 */
export const reads = new Map<string, { key: string; values: Record<string, unknown> }>();

const values = new Map<string, Record<string, unknown>>();
const plain = (given: object | undefined) =>
  Object.fromEntries(Object.entries(given ?? {}).filter(([, value]) => typeof value !== 'function'));

// As the page is built, and in the built page; in dev the real inspector holds the hook.
if (import.meta.env.PROD) {
  const hooks = globalThis as DevHooks;
  const before = hooks.__PROSEBOOK_READ__;
  hooks.__PROSEBOOK_READ__ = (key, text, locale) => {
    // The playground's copy reads its own catalog: only this one's keys are the page's.
    if (key in catalog.messages[catalog.source]!) reads.set(text, { key, values: values.get(key) ?? {} });
    before?.(key, text, locale);
  };
}

/** A read that keeps the values it was given, for the inspector to read the message again with. */
function keeping<F>(read: F): F {
  const call = read as unknown as (key: string, given?: object) => unknown;
  const kept = (key: string, given?: object) => {
    values.set(key, plain(given));
    return call(key, given);
  };
  return kept as unknown as F;
}

export const t = keeping(copy.t);
export const rich = keeping(copy.rich);
