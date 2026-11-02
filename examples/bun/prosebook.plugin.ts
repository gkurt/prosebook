import { prosebook } from 'prosebook/bun';

// The dev server's plugin, named in bunfig.toml, with the options build.ts gives its own.
export default prosebook({ split: true });
