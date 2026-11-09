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
    // Said in `prosebook todo de --prompt` too, as it reads German.
    du: { type: 'guideline', description: 'Address the shopper as du, never Sie.', on: { locale: ['de'] } },
  },
});

export default {
  catalog: 'copy/catalog',
  locales: 'copy/locales',
  out: 'src/copy',
  source: 'en',
  pseudo: 'en-XA',
  // "Saved just now.", "Saved 5 minutes ago.": a time under a minute reads as app.now.
  formats: { relative: { recent: { now: { entry: 'app.now' } } } },
  lint: { extends: 'strict', properNouns: ['Corner', 'Shop'], plugins: [shop] },
} satisfies ProsebookConfig;
