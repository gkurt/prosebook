# Design gaps from the Canvas adoption

Four gaps in `CANVAS-GAPS.md` were marked _design_: each needs a decision about prosebook's model
before it is built. Each section says what Canvas hit, the options, and a recommendation. What was
small enough to fit the README's design is already done and says so.

## 3. `period` on statuses, hints, badges and toasts

**What happened.** Canvas has 128 `allow: period` entries. By kind and surface: 41 `state/status`, 32
`description/hint`, 24 `state/hint`, 12 `state/error`, 7 `description/label`, 5
`description/placeholder`, 4 `description/tooltip`. Most are phrases rather than sentences: counts
(`{count, plural, one {# line} other {# lines}}`), readings (`{fps, number} fps`), a row's detail
line. And the reasons repeat word for word: "A row's detail line under its name, a phrase rather
than a sentence…" 23 times, "A card's detail line on the canvas…" 22 times, "A line in the
transcript's timeline…" 17 times.

**Done.** The README now has a table of which kind each shape rule holds and on which surfaces
`period` applies (a `description` always; a `state` on `hint`, `status`, `error`, `empty`,
`confirm`). That explains why an `allow.period` on a toast fails: a state on a toast needs no period.

**Options.**

1. **Named reasons.** `lint.reasons: { 'detail-line': "A row's detail line under its name, a phrase
   rather than a sentence." }`, and `allow: { period: detail-line }` takes the reason by name. It keeps
   every exemption explained once, where a reviewer reads it, and changing the reason changes it
   everywhere. Small: `allow` values are strings already. A name with no reason defined fails, as a
   shrug does now.
2. **A surface for phrases.** A default surface `detail`: "a phrase beside or under the thing it
   qualifies: a row's detail line, a reading, a count. Not a sentence." `state.period` doesn't list
   it, so a state there needs no period. Canvas's 41 `state/status` and most of its 24 `state/hint`
   are this. Any project can do it today by defining the surface; the gap is that the defaults don't
   offer one, so writers reach for `allow` instead of saying what the string is.
3. **Severity per surface and kind.** `lint.surfaces: { status: { period: 'off' } }`, beside
   `lint.areas`. General, but it turns the rule off where it is right as well: a status that is a
   whole sentence ("The run stopped.") should still end with a stop.
4. **Detect phrases.** Exempt a message with no verb, or one that is only placeholders and a noun.
   English-only heuristics in a rule that reads every locale's source; it would be wrong both ways.

**Recommendation.** 2, then 1. A `detail` surface says what most of these strings are, and the
writing guide and the lint follow from it. Named reasons cover what's left, the `description/hint`
phrases among them: whether those should be kind `description` at all is for the writer, and a named
reason makes that decision once. Skip 3 and 4.

## 20. A closed `select`, and a boolean one

**What happened.** ICU requires `other`, so `{mode, select, dark {Dark} light {Light} other {}}` types
`mode` as `'dark' | 'light' | (string & {})`. A misspelled arm, or a value nothing handles, isn't
caught. And `{on, select, true {On} other {Off}}` was typed `'true' | (string & {})`, so people
passed `'yes'` and `'no'`.

**Done.** A select whose named arms are `true` and `false` now takes a `boolean` (the runtime already
selected on `String(value)`, so only the type changed).

**Options for a closed union.**

1. **Let `other` be left out.** The parser can accept a select without `other`, typed as the arms it
   names. But ICU MessageFormat and MF2 (`*`) both require the catch-all, and translation tools that
   check messages reject one without it. A value nothing matches would need a runtime fallback, which
   is an `other` by another name.
2. **Read `other {}` as closed.** An empty `other` types the union without `string & {}`. Implicit:
   nothing in the message says "closed", and an empty arm is also a legitimate "say nothing".
3. **Say it in the entry.** `args: { mode: 'the theme' }` stays the doc; a new field names the closed
   arguments, `closed: [mode]`, or `args.mode` takes a mapping, `{ holds: 'the theme', closed: true }`.
   The message stays standard; the type is closed; `other` remains for the runtime and the tools.
   The drift check would hold a translation to the source's arms for such an argument too, which it
   doesn't for an open select.

**Recommendation.** 3, as a field of its own (`closed: [mode]`), which leaves `args` a plain mapping
of name to sentence. The schema, the inspector dialog and `extract` gain one optional field;
generation drops `(string & {})` for those arguments; lint can warn where `other` then says something
no value reaches.

## 23. Label maps other modules read

**What happened.** Code that kept `Record<Status, { label: string }>` maps, read by several modules,
was migrated to getters calling `copy.t`, which read the locale at the moment of the call and hid
the keys from pruning.

**Done.** `MessageKey` and `Translate` are named types now, and the README shows the pattern: the map
holds keys (`Record<Status, MessageKey>`), read with `t` where it renders, the read marked
`prosebook-ignore` since every key it reads is written in the map, which pruning keeps. Where one
sentence alone shows the label, a select (`{status, select, started {Started} …}`) needs no map.

**Options for more.**

1. **A helper**, `defineLabels({ started: 'run.started' })`, returning the map typed by `MessageKey`.
   It adds API for what the type already says.
2. **Let pruning follow the map.** `scan` could treat `t(MAP[x])` as seen when `MAP` is a module-level
   object literal of literal keys, so no `prosebook-ignore` is needed. Worthwhile: the pattern is the
   right one, and the ignore comment is its only friction. It means following a binding in
   `unseenReads`, within one module.

**Recommendation.** 2, scoped to a `const` object or array of string literals declared in the same
module as the read. Not a helper.

## 25. Optional parts of a message

**What happened.** "Assigned to Ada, as reviewer" with ", as reviewer" only when there is a role was
written `{as, select, yes {, as {name}} other {}}` with a dummy `name: ''` when absent.

**Options.**

1. **Two entries, chosen in code.** `role ? t('x.assigned-as', { name, role }) : t('x.assigned', {
   name })`. Whole sentences, which a translator reorders freely; nothing new. The cost is two entries.
2. **A `null` arm.** `{role, select, null {} other {, as {role}}}`: a select arm named `null` matches
   a value that is `null` or `undefined`, and the argument is typed `string | null | undefined`. The
   runtime picks by `String(value)`, which gives `'null'` for null already; `undefined` would need
   mapping too. One entry, but the sentence is still stitched from an arm and the text around it,
   which the README advises against for exactly this reason.
3. **MF2's `.match` on presence.** MF2 has no "is defined" selector; a custom function would be a
   prosebook dialect, not MF2.

**Recommendation.** 1, now said in the README beside the advice against fragments, since it is
what a translator can work with. If one entry is wanted, 2 is the smallest change, but it fixes the
type, not the stitching.

## Not built, by choice

- **21: a plain `{n}` stays `string`.** A number spliced in raw is printed by `String()`, which knows
  no locale; making `{n}` take a number would let `1234` through where `1,234` (or `1.234`) belongs.
  The README now shows the number formats for a number that names something rather than counts it:
  `{line, number, ::group-off}`, `::integer-width/*0000`, `{n, number, integer}`.
