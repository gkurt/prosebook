import type { ProsebookConfig } from 'prosebook/config';

export default {
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  // Node strips the types and runs the generated modules as they are, so imports name the `.ts` file.
  importExtension: '.ts',
  lint: { extends: 'strict', properNouns: ['Corner', 'Shop'] },
} satisfies ProsebookConfig;
