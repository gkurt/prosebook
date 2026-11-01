import { defineConfig } from 'tsdown';

// One entry per export in package.json, plus the CLI and the dev inspector the Vite plugin serves from
// beside itself. React, Vite and Node built-ins stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.tsx',
    vite: 'src/vite.ts',
    inspector: 'src/inspector.ts',
    config: 'src/tools/config.ts',
    tools: 'src/tools/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'esm',
  platform: 'node',
  // `.js`, as package.json names them: the package is `type: module`.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
});
