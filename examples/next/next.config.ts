import type { NextConfig } from 'next';
import { withProsebook } from 'prosebook/next';

const nextConfig: NextConfig = {};

// Generates the catalog's modules in `next dev` and `next build`, regenerates them on every catalog
// edit, prunes the build to the messages the code names, and in dev serves the inspector: Alt-click a
// string a client component reads to open its entry, Alt-right-click to edit it.
export default withProsebook(nextConfig);
