import { anthropic } from '@ai-sdk/anthropic';
import { typeSafeAi } from '@ai-sdk/typesafe-ai';
import { decisionJudge, languageJudge } from 'prosebook/ai';
import type { ProsebookConfig } from 'prosebook/config';

export default {
  catalog: 'copy/catalog',
  out: 'src/copy',
  source: 'en',
  lint: {
    extends: 'strict',
    properNouns: ['prosebook', 'YAML', 'Vite', 'Next.js', 'Bun', 'Astro', 'GitHub', 'MIT', 'Gokhan', 'Kurt', 'Rust', 'Swift', 'Kotlin'],
  },
  // Asked by `prosebook judge` (`bun run judge` at the repo's root); lint reads the verdicts the lock holds.
  judge: {
    // Each asked only where its key is set; the answers the lock holds count everywhere. Haiku also suggests rewrites.
    models: [
      decisionJudge(typeSafeAi.decisionModel('jev-latest'), { price: { input: 0.042 }, ask: Boolean(process.env['TYPESAFE_AI_API_KEY']) }),
      languageJudge(anthropic('claude-haiku-5-5'), { price: { input: 0.1, output: 0.5 }, ask: Boolean(process.env['ANTHROPIC_API_KEY']) }),
    ],
    prompt: "prosebook's homepage: what it is and how it reads, for developers deciding whether to use it.",
  },
} satisfies ProsebookConfig;
