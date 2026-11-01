## prosebook@0.2.0

### `plural-count` leaves unit symbols alone: `{rate, number} kbps` is no plural

### `arm-endings` doesn't count an arm that trails off in an ellipsis, as in `Uploading # files…`

### A date skeleton's `j` is the hour as each locale writes it

`{when, date, ::yMMMdjmm}` read "Oct 28, 2026, 5"; it now reads "Oct 28, 2026, 2:05 PM", and "14:05" in German. A date field the formatter would drop, such as `J`, fails the build.

### A build fails on a read whose key it can't see

`prune` is `'strict'` by default: `t(item.key)` or `<Text id={id} />` fails the build instead of showing the key where its message was pruned. Mark a deliberate one `prosebook-ignore`, or set `prune: 'loose'`. `prune: true` is gone.

### The Vite plugin takes a `root` for apps that share one catalog

### Generated TypeScript passes `noUnusedParameters`

### Lint rules scoped by area: `on.area`, and `lint.areas` for severities per area

### A `path` rule under `strict`: `Settings › General`, with `lint.pathSeparator`

### The catalog schema offers the `key: message` shorthand only when no field is required

## prosebook@0.1.0

### A typed copy catalog: YAML entries compiled to plain functions, for React and any JavaScript

### ICU MessageFormat or MessageFormat 2, switchable per catalog, with `prosebook migrate`

### Stale translations marked from the lock, with a word diff of what changed

### `prosebook scan` and `extract` move hardcoded JSX text into the catalog

### In dev, Alt-click a string to open its entry; Alt-right-click edits it on the page

### Lint plugins, rules as data, translation linting, `lint --fix` and SARIF output
