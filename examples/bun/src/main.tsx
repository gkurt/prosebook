import { createCopy, preferredLocales } from 'prosebook';
import { CopyProvider } from 'prosebook/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { catalog } from './copy/index.ts';

// The provider below renders <link> for every message, so call sites need not pass it.
declare module 'prosebook' {
  interface Register {
    tags: 'link';
  }
}

const copy = createCopy(catalog, { locale: preferredLocales() });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CopyProvider copy={copy} tags={{ link: (chunks) => <a href="#terms">{chunks}</a> }}>
      <App />
    </CopyProvider>
  </StrictMode>,
);
