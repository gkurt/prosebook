'use client';

import { createCopy, type Copy } from 'prosebook';
import { CopyProvider } from 'prosebook/react';
import { Suspense, use, useState, type ReactNode } from 'react';

import { catalog, type Locale } from '@/copy/index.ts';

// The provider below renders <link> for every message, so call sites need not pass it.
declare module 'prosebook' {
  interface Register {
    tags: 'link';
  }
}

const tags = { link: (chunks: ReactNode[]) => <a href="#terms">{chunks}</a> };

/** The catalog for client components, in the locale the server rendered. */
export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  // Made above the boundary: a component that suspends before it mounts loses its state.
  const [copy] = useState(() => createCopy(catalog, { locale }));
  return (
    <Suspense>
      <Ready copy={copy}>{children}</Ready>
    </Suspense>
  );
}

/** Renders once the copy's locale has loaded, so the page hydrates in the locale it was rendered in. */
function Ready({ copy, children }: { copy: Copy; children: ReactNode }) {
  use(copy.ready);
  return (
    <CopyProvider copy={copy} tags={tags}>
      {children}
    </CopyProvider>
  );
}
