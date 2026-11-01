import { createServerFn } from '@tanstack/react-start';
import { getCookie, getRequestHeader } from '@tanstack/react-start/server';
import { negotiate } from 'prosebook';

import { catalog } from './copy/index.ts';

/** The locale the reader picked, or else the best match for what their browser asks for. */
export const getLocale = createServerFn({ method: 'GET' }).handler(() => {
  const picked = getCookie('locale');
  const asked = (getRequestHeader('accept-language') ?? '').split(',').map((part) => part.split(';', 1)[0]!.trim());
  return negotiate(picked === undefined ? asked : [picked, ...asked], catalog.locales, catalog.source);
});
