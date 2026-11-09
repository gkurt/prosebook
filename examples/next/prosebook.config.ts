import type { ProsebookConfig } from 'prosebook/config';

export default {
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  pseudo: 'en-XA',
  // Turbopack resolves `./en` to `en.ts`, but not `./en.js`.
  importExtension: '',
  // "Saved just now.", "Saved 5 minutes ago.": a time under a minute reads as app.now.
  formats: { relative: { recent: { now: 'app.now' } } },
  lint: { extends: 'strict', properNouns: ['Corner', 'Shop'] },
} satisfies ProsebookConfig;
