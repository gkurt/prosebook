import type { CopydeckConfig } from 'copydeck/config';

export default {
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  pseudo: 'en-XA',
  lint: { extends: 'strict', properNouns: ['Corner', 'Shop'] },
} satisfies CopydeckConfig;
