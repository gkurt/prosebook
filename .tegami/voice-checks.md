---
packages:
  'prosebook': minor
---

### The voice plugin checks pointing words, semicolons, colons before a clause and figurative verbs

Five checked rules join the guidelines, warnings under `recommended` and errors under `strict`, each finding with the fix: `voice/pointing` (`it`, `its`, `they`, `their`, `them`, and `there` for a place), `voice/of-its-own`, `voice/semicolons`, `voice/colon-clause` (a lowercase clause after a colon in a `description` or a `state`, an error excepted) and `voice/figurative-verbs` (`comes`, `says`, `asks for`). The docs leave them off unless `lint.docs` sets them.

### An entry's context is held to the same rules as the message

`voice/pointing`, `voice/of-its-own`, `voice/semicolons` and `voice/figurative-verbs` read each entry's `context` too, as the next writer copies the words of a context into the copy, and the writing guide says so. A rule of your own reads the context with `context: true`.

### voice/no-intent is folded into voice/own-words

`voice/own-words` asks for the noun and verb the product or the platform uses, the word a reader searches for: a schedule runs, a value is parsed, a switch is `Enabled` or `Disabled`. `voice/familiar-context` asks to name the thing every time, pronouns with a referent included. Rename `voice/no-intent` to `voice/own-words` wherever an `allow` or `lint.rules` names the rule. The guidelines' words changed, so `prosebook judge` asks again of every entry, and `approve` again of each approval of a guideline.

### The judge's default threshold is 0.5

The product of the two answers about 0.7 each: at 0.7, Jev found one break in an app's copy, where 0.5 finds the real ones. Set `judge.threshold: 0.7` to keep the old verdicts.

### check fails on an entry not judged as written

`prosebook check` names each entry the lock holds no verdict on as written and fails, so an entry nobody ran `prosebook judge` on fails CI; `judge.unjudged: 'warn'` warns instead. The writing guide asks for `prosebook judge` before the work is done.
