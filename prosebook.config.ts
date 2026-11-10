import { anthropic } from '@ai-sdk/anthropic';
import { typeSafeAi } from '@ai-sdk/typesafe-ai';
import { decisionJudge, languageJudge } from 'prosebook/ai';
import type { ProsebookConfig } from 'prosebook/config';

/**
 * The repo's own words: no app copy, so no catalog, and the docs read with `prosebook lint --docs`
 * (`bun run docs`) and judged with `prosebook judge --docs` (`bun run docs:judge`, which needs
 * `TYPESAFE_AI_API_KEY`). The site has its own config and catalog, under `site/`.
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
  judge: {
    // Each asked only where its key is set; the answers the lock holds count everywhere. Haiku also suggests rewrites.
    models: [
      decisionJudge(typeSafeAi.decisionModel('jev-latest'), { price: { input: 0.042 }, ask: Boolean(process.env['TYPESAFE_AI_API_KEY']) }),
      languageJudge(anthropic('claude-haiku-5-5'), { price: { input: 0.1, output: 0.5 }, ask: Boolean(process.env['ANTHROPIC_API_KEY']) }),
    ],
    prompt: "The docs of prosebook, a library for an app's copy: read by developers setting it up and by agents changing it.",
  },
} satisfies ProsebookConfig;
