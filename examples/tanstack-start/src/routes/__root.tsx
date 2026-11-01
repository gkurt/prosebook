import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { createCopy, type Copy } from 'prosebook';
import { CopyProvider } from 'prosebook/react';
import { Suspense, use, useState, type ReactNode } from 'react';

import { catalog } from '#src/copy/index.ts';
import { getLocale } from '#src/locale.ts';
import css from '#src/styles.css?url';

// The provider below renders <link> for every message, so call sites need not pass it.
declare module 'prosebook' {
  interface Register {
    tags: 'link';
  }
}

const tags = { link: (chunks: ReactNode[]) => <a href="#terms">{chunks}</a> };

export const Route = createRootRoute({
  loader: () => getLocale(),
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    links: [{ rel: 'stylesheet', href: css }],
  }),
  component: Root,
});

function Root() {
  const locale = Route.useLoaderData();
  // One copy per render on the server, one for the page's life in the browser, both in the request's
  // locale. Made above the boundary: a component that suspends before it mounts loses its state.
  const [copy] = useState(() => createCopy(catalog, { locale }));
  return (
    <html lang={locale}>
      <head>
        <HeadContent />
      </head>
      <body>
        <Suspense>
          <Ready copy={copy}>
            <Outlet />
          </Ready>
        </Suspense>
        <Scripts />
      </body>
    </html>
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
