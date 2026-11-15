---
packages:
  'prosebook': minor
---

### A judge or translate run cut short keeps what it had

`prosebook judge` writes the lock every few seconds, so a run killed or crashing midway keeps its answers and the next asks only the rest. Ctrl+C ends `judge` and `translate` by writing what they have, exiting with 130. A request that fails no longer stops the run: it goes on to the next entry or batch, and a model is given up on only once several of its requests fail in a row. `judgeCatalog` takes `save`, `saveEvery` and `signal`, and its run and `translateLocale`'s say `stopped`.
