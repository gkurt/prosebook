---
packages:
  'prosebook': minor
---

### `acceptedLocales(header)`: an `Accept-Language` header read by weight, for a server's copy

`createCopy(catalog, { locale: acceptedLocales(request.headers.get('accept-language')) })` asks for the request's locales in the order its `q` values rank them, so `de;q=0.1, en;q=0.9` gets English.
