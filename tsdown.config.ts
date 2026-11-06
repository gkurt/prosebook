import { defineConfig } from 'tsdown';

// One entry per export in package.json, plus the CLI, the dev inspector each integration loads from
// beside itself and the loader the Next config and the webpack plugin name by path. The frameworks, Vite, Bun and
// Node built-ins stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    'react/server': 'src/react/server.ts',
    'preact/index': 'src/preact/index.ts',
    'vue/index': 'src/vue/index.ts',
    'solid/index': 'src/solid/index.ts',
    'svelte/index': 'src/svelte/index.ts',
    vite: 'src/vite.ts',
    next: 'src/next.ts',
    loader: 'src/loader.ts',
    webpack: 'src/webpack.ts',
    bun: 'src/bun.ts',
    astro: 'src/astro.ts',
    inspector: 'src/inspector.ts',
    config: 'src/tools/config.ts',
    tools: 'src/tools/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  platform: 'node',
  // `@types/bun` declares the `bun` module ambiently, which the declaration bundler can't follow.
  // `Text.svelte` ships as source, with its types, for the app's Svelte compiler.
  deps: { neverBundle: ['bun', /\.svelte$/] },
  copy: [{ from: ['src/svelte/Text.svelte', 'src/svelte/Text.svelte.d.ts'], to: 'dist/svelte' }],
  // `.js`, as package.json names them: the package is `type: module`.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
});
