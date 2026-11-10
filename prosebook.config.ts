import type { ProsebookConfig } from 'prosebook/config';

/**
 * The repo's own words: no app copy, so no catalog, and the docs read with `prosebook lint --docs`
 * (`bun run docs`). The site has its own config and catalog, under `site/`.
 */
export default {
  catalog: false,
  docs: ['README.md', 'API.md', 'CONTRIBUTING.md', 'AGENTS.md'],
  lint: {
    extends: 'strict',
    // Names, one word each: `Native` for React Native.
    properNouns: ['Rspack', 'Native', 'Expo', 'JavaScript', 'MessageFormat', 'Rust', 'Swift', 'Kotlin'],
  },
} satisfies ProsebookConfig;
