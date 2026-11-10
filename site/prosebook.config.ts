import { typeSafeAi } from '@ai-sdk/typesafe-ai';
import { decisionJudge } from 'prosebook/ai';
import type { ProsebookConfig } from 'prosebook/config';

export default {
  catalog: 'copy/catalog',
  out: 'src/copy',
  source: 'en',
  lint: {
    extends: 'strict',
    properNouns: ['prosebook', 'YAML', 'Vite', 'Next.js', 'Bun', 'Astro', 'GitHub', 'MIT', 'Gokhan', 'Kurt', 'Rust', 'Swift', 'Kotlin'],
  },
  // Declared with or without the key: only `prosebook judge` asks the model (`bun run judge` at the repo's
  // root, skipped without TYPESAFE_AI_API_KEY), and lint reads the verdicts the lock holds.
  judge: {
    models: [decisionJudge(typeSafeAi.decisionModel('jev-latest'), { price: { input: 0.042 } })],
    prompt: "prosebook's homepage: what it is and how it reads, for developers deciding whether to use it.",
  },
} satisfies ProsebookConfig;
