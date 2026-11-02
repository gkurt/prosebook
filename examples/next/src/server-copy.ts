import { cookies, headers } from 'next/headers';
import { acceptedLocales } from 'prosebook';
import { createServerCopy } from 'prosebook/react/server';

import { catalog } from './copy/index.ts';

/**
 * The catalog for server components: one copy per request, in the locale the reader picked, or else
 * the best match for what their browser asks for.
 */
export const serverCopy = createServerCopy(catalog, async () => {
  const picked = (await cookies()).get('locale')?.value;
  const asked = acceptedLocales((await headers()).get('accept-language'));
  return picked === undefined ? asked : [picked, ...asked];
});
