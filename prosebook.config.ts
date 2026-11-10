import { decisionJudge } from 'prosebook/ai';
import type { ProsebookConfig } from 'prosebook/config';

/**
 * The repo's own words: no app copy, so no catalog, and the docs read with `prosebook lint --docs`
 * (`bun run docs`) and judged with `prosebook judge --docs` (`bun run docs:judge`, which needs
 * `AI_GATEWAY_API_KEY`). The site has its own config and catalog, under `site/`.
 */
export default {
  catalog: false,
  docs: ['README.md', 'API.md', 'CONTRIBUTING.md', 'AGENTS.md'],
  lock: 'prosebook.lock.json',
  lint: {
    extends: 'strict',
    // Names, one word each: `Native` for React Native.
    properNouns: ['Rspack', 'Native', 'Expo', 'JavaScript', 'MessageFormat', 'Rust', 'Swift', 'Kotlin'],
  },
  // Declared with or without the key: only `judge` asks the model, and lint reads the lock's verdicts.
  judge: {
    models: [decisionJudge('typesafe-ai/jev')],
    prompt: "The docs of prosebook, a library for an app's copy: read by developers setting it up and by agents changing it.",
  },
} satisfies ProsebookConfig;
