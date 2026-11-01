import type { ProsebookConfig } from 'prosebook/config';

export default {
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  pseudo: 'en-XA',
  // Turbopack resolves `./en` to `en.ts`, but not `./en.js`.
  importExtension: '',
  lint: { extends: 'strict', properNouns: ['Corner', 'Shop'] },
} satisfies ProsebookConfig;
