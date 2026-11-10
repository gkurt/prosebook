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
  // root, skipped without AI_GATEWAY_API_KEY), and lint reads the verdicts the lock holds.
  judge: {
    models: [decisionJudge('typesafe-ai/jev')],
    prompt: "prosebook's homepage: what it is and how it reads, for developers deciding whether to use it.",
  },
} satisfies ProsebookConfig;
