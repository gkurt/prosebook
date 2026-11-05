import { createCopy } from 'prosebook';

import { catalog } from './copy/index.ts';

/** The page's one copy, in English, read by the page as it is built and by the demo in the browser. */
export const copy = createCopy(catalog);

export const { t, rich } = copy;
