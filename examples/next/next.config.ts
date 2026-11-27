import type { NextConfig } from 'next';
import { withProsebook } from 'prosebook/next';

const nextConfig: NextConfig = {};

// Generates the catalog's modules in `next dev` and `next build`, regenerates them on every catalog
// edit, prunes the build to the messages the code names, splits client components' messages by area,
// and in dev adds the copy inspector with deictic: Alt-click a string a client component reads to edit
// its entry.
export default withProsebook(nextConfig, { split: true });
