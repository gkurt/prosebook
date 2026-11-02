/**
 * `prosebook/react/server`: the catalog in React Server Components, which can't use context. Apart
 * from `prosebook/react`, whose module makes a context as it loads, which the server build refuses.
 */
import { cache } from 'react';

import { createCopy, type Catalog, type Copy, type CopyOptions } from '#src/runtime/copy.ts';
import type { MessageShapes } from '#src/runtime/types.ts';

/** What a request asks for: a locale, or the locales it prefers, most preferred first. */
type Asked<L extends string> = L | (string & {}) | readonly string[];

/**
 * A reader of one copy per request, ready to use: `locale` is asked once per request, and every
 * server component rendering in it gets the same copy, in the locale negotiated from the answer.
 * React's `cache` keeps it per request, so one request's locale never reaches another's.
 *
 * ```ts
 * export const serverCopy = createServerCopy(catalog, async () => {
 *   const picked = (await cookies()).get('locale')?.value;
 *   const asked = acceptedLocales((await headers()).get('accept-language'));
 *   return picked === undefined ? asked : [picked, ...asked];
 * });
 * const { t, locale } = await serverCopy();
 * ```
 */
export function createServerCopy<M extends MessageShapes, L extends string>(
  catalog: Catalog<M, L>,
  locale: () => Asked<L> | Promise<Asked<L>>,
  options: Omit<CopyOptions<L>, 'locale'> = {},
): () => Promise<Copy<M, L>> {
  return cache(async () => {
    const copy = createCopy(catalog, { ...options, locale: await locale() });
    await copy.ready;
    return copy;
  });
}
