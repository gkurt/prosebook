import { defineConfig } from '@rspack/cli';
import { rspack } from '@rspack/core';
import { ReactRefreshRspackPlugin } from '@rspack/plugin-react-refresh';
import { ProsebookPlugin } from 'prosebook/webpack';

const dev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    // The generated index imports `./en.js`, as TypeScript writes it, for `en.ts`.
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev, refresh: dev } },
          },
        },
      },
    ],
  },
  plugins: [new ProsebookPlugin(), new rspack.HtmlRspackPlugin({ template: './index.html' }), dev && new ReactRefreshRspackPlugin()],
  devServer: { port: 5173 },
});
