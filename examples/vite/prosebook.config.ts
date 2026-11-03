import { definePlugin, type ProsebookConfig } from 'prosebook/config';

// Advice no pattern can check, said in copy/catalog/WRITING.md for whoever writes next.
const shop = definePlugin({
  name: 'shop',
  rules: {
    'error-next': {
      type: 'guideline',
      description: 'An error says what failed and what the shopper can do about it.',
      on: { surface: ['error'] },
    },
    plain: { type: 'guideline', description: 'Talk to the shopper as someone behind the counter would: plainly, without selling.' },
  },
});

export default {
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  pseudo: 'en-XA',
  lint: { extends: 'strict', properNouns: ['Corner', 'Shop'], plugins: [shop] },
} satisfies ProsebookConfig;
