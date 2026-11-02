import { createCopy, preferredLocales } from 'prosebook';
import { mount } from 'svelte';

import App from './App.svelte';
import { catalog } from './copy/index.ts';

// App renders <link> for every message, so call sites need not pass it.
declare module 'prosebook' {
  interface Register {
    tags: 'link';
  }
}

const copy = createCopy(catalog, { locale: preferredLocales() });

mount(App, { target: document.getElementById('app')!, props: { copy } });
