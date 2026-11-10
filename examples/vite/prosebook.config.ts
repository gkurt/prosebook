import { decisionJudge } from 'prosebook/ai';
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
  // The guidelines above, and the voice ones, asked of a model by `prosebook judge` (`bun run judge` at the repo's
  // root, skipped without AI_GATEWAY_API_KEY); lint reads the verdicts the lock holds. The one example judged:
  // the others say the same shop's words.
  judge: {
    models: [decisionJudge('typesafe-ai/jev')],
    prompt: 'A small corner shop online: shoppers browse, fill a cart and check out.',
  },
} satisfies ProsebookConfig;
