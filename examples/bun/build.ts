import { prosebook } from 'prosebook/bun';

// The `bun build` command reads no plugins, so the build is a script. The plugin prunes the client
// and the server alike: each ships only the messages some module names.
const result = await Bun.build({
  entrypoints: ['./src/server.ts'],
  target: 'bun',
  outdir: './dist',
  minify: true,
  // The server imports the inspector's routes only in dev, so the build leaves them, and the tools
  // they need, out of the bundle.
  external: ['prosebook/bun'],
  plugins: [prosebook()],
});

for (const output of result.outputs) console.log(`  ${output.path}`);
