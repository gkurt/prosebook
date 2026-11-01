import { cookies, headers } from 'next/headers';
import { createCopy, negotiate } from 'prosebook';
import { cache } from 'react';

import { catalog, type Locale } from './copy/index.ts';

/** The locale the reader picked, or else the best match for what their browser asks for. */
export const requestLocale = cache(async (): Promise<Locale> => {
  const picked = (await cookies()).get('locale')?.value;
  const asked = ((await headers()).get('accept-language') ?? '').split(',').map((part) => part.split(';', 1)[0]!.trim());
  return negotiate(picked === undefined ? asked : [picked, ...asked], catalog.locales, catalog.source);
});

/** The catalog for server components: one copy per request, in the request's locale. */
export const serverCopy = cache(async () => {
  const copy = createCopy(catalog, { locale: await requestLocale() });
  await copy.ready;
  return copy;
});
