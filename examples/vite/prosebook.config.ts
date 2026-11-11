import { anthropic } from '@ai-sdk/anthropic';
import { typeSafeAi } from '@ai-sdk/typesafe-ai';
import { decisionJudge, languageJudge } from 'prosebook/ai';
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
  // The guidelines above, and the voice ones, asked of the models by `prosebook judge` (`bun run judge` at the
  // repo's root); lint reads the verdicts the lock holds. The one example judged:
  // the others say the same shop's words.
  judge: {
    // Each asked only where its key is set; the answers the lock holds count everywhere. Haiku, the stronger, is
    // trusted first and suggests rewrites; Jev decides where Haiku hasn't answered.
    models: [
      languageJudge(anthropic('claude-haiku-5-5'), {
        price: { input: 0.1, output: 0.5 },
        ask: Boolean(process.env['ANTHROPIC_API_KEY']),
      }),
      decisionJudge(typeSafeAi.decisionModel('jev-latest'), { price: { input: 0.042 }, ask: Boolean(process.env['TYPESAFE_AI_API_KEY']) }),
    ],
    prompt: 'A small corner shop online: shoppers browse, fill a cart and check out.',
  },
} satisfies ProsebookConfig;
