---
packages:
  'prosebook': minor
---

### `prosebook/react/server`: `createServerCopy`, one copy per request for React Server Components

`createServerCopy(catalog, () => locales)` returns a reader every server component in a request shares: asked once for the locale, ready when it resolves, and kept per request by React's `cache`.
