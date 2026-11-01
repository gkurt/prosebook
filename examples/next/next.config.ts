import type { NextConfig } from 'next';
import { withProsebook } from 'prosebook/next';

const nextConfig: NextConfig = {};

// Generates the catalog's modules in `next dev` and `next build`, regenerates them on every catalog
// edit, and prunes the build to the messages the code names.
export default withProsebook(nextConfig);
