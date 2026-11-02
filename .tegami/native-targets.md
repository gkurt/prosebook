---
packages:
  'prosebook': minor
---

### Rust, Swift and Kotlin from the same catalog

`native: [{ language: 'rust', out: 'src-tauri/src/copy.rs', keys: ['tray'] }]` makes `generate` write an enum of the locales with a typed member per message, with CLDR's plural rules and number formats taken apart from `Intl`, so a tray, a menu bar or a CLI says what the browser says.
