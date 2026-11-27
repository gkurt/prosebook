/**
 * The copy inspector on the built page: deictic's overlay with prosebook's Copy tab, its requests answered in
 * the browser (`standalone.ts`), since a static page has no dev server. In dev the integration starts it, so
 * this does nothing.
 */
import type { DevHooks } from 'prosebook';

if (import.meta.env.PROD) {
  // There before any copy is made, so each adds itself and a saved edit reaches its messages.
  (globalThis as DevHooks).__PROSEBOOK_HOT__ = new Set();
  void import('virtual:deictic/client');
}
