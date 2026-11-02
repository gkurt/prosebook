import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
import { acceptedLocales, negotiate } from 'prosebook';

import { catalog } from './copy/index.ts';

/** The locale the reader picked, or else the best match for what their browser asks for. */
export const getLocale = createServerFn({ method: 'GET' }).handler(() => {
  const picked = getCookie('locale');
  const asked = acceptedLocales(getRequestHeader('accept-language'));
  return negotiate(picked === undefined ? asked : [picked, ...asked], catalog.locales, catalog.source);
});
