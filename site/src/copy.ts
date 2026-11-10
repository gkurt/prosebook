import { createCopy } from 'prosebook';
import { catalog } from './copy/index.ts';

/** The page's words: read by the page as it is built, and by its scripts in the browser. */
export const { t } = createCopy(catalog);
