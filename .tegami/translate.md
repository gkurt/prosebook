---
packages:
  'prosebook': minor
---

### `prosebook translate` asks a model for what a locale is missing

`translate.model` in the config, `languageTranslator(model)` from `prosebook/ai`, gets the prompt `todo --prompt` writes, a batch of entries at a time. Each reply is checked as `import` checks one: an entry that drops a placeholder is asked again with its problem, and left untranslated if it is still wrong.
