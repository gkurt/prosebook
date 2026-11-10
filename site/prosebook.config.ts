import { anthropic } from '@ai-sdk/anthropic';
import { typeSafeAi } from '@ai-sdk/typesafe-ai';
import { decisionJudge, languageJudge } from 'prosebook/ai';
import type { ProsebookConfig } from 'prosebook/config';
import { lint } from './src/lint.ts';

export default {
  catalog: 'copy/catalog',
  out: 'src/copy',
  source: 'en',
  lint,
  // Asked by `prosebook judge` (`bun run judge` at the repo's root); lint reads the verdicts the lock holds.
  judge: {
    // Each asked only where its key is set; the answers the lock holds count everywhere. Haiku, the stronger, is
    // trusted first and suggests rewrites; Jev decides where Haiku hasn't answered.
    models: [
      languageJudge(anthropic('claude-haiku-5-5'), {
        price: { input: 0.1, output: 0.5 },
        // Haiku's answers seldom reach Jev's 0.7: its clear breaks are from about 0.5.
        threshold: 0.5,
        ask: Boolean(process.env['ANTHROPIC_API_KEY']),
      }),
      decisionJudge(typeSafeAi.decisionModel('jev-latest'), { price: { input: 0.042 }, ask: Boolean(process.env['TYPESAFE_AI_API_KEY']) }),
    ],
    prompt: "prosebook's homepage: what it is and how it reads, for developers deciding whether to use it.",
  },
} satisfies ProsebookConfig;
