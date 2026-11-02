import { createCopy, preferredLocales } from 'prosebook';
import { copyPlugin } from 'prosebook/vue';
import { createApp, h } from 'vue';

import App from './App.vue';
import { catalog } from './copy/index.ts';

// The plugin below renders <link> for every message, so call sites need not pass it.
declare module 'prosebook' {
  interface Register {
    tags: 'link';
  }
}

const copy = createCopy(catalog, { locale: preferredLocales() });

createApp(App)
  .use(copyPlugin(copy, { tags: { link: (chunks) => h('a', { href: '#terms' }, chunks) } }))
  .mount('#app');
