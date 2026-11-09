---
packages:
  'prosebook': minor
---

### A relative time read as a string stays current in every binding

A component reading a message with `t` (or `rich`, or `relative`) now renders again when a relative time in it next reads
differently, as `<Text>` did, and nothing else does: React and Preact render the component whose `useCopy()` read it, Vue, Solid
and Svelte rerun only the template, effect or `computed` that read it. It shares the one timer `<Text>` uses, which now goes
through the same reads. `live: true` is left for reads made straight from the copy, outside any binding.
