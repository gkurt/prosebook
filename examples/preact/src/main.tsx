import { render } from 'preact';
import { createCopy, preferredLocales } from 'prosebook';
import { CopyProvider } from 'prosebook/preact';

import { App } from './App.tsx';
import { catalog } from './copy/index.ts';

// The provider below renders <link> for every message, so call sites need not pass it.
declare module 'prosebook' {
  interface Register {
    tags: 'link';
  }
}

const copy = createCopy(catalog, { locale: preferredLocales() });

render(
  <CopyProvider copy={copy} tags={{ link: (chunks) => <a href="#terms">{chunks}</a> }}>
    <App />
  </CopyProvider>,
  document.getElementById('root')!,
);
