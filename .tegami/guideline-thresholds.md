---
packages:
  'prosebook': minor
---

### A guideline can have its own threshold, and voice/phrases is 0.7

`judge.thresholds` sets a guideline's own threshold by rule name, over every model's: `{ 'voice/phrases': 0.7 }`. `voice/phrases` is 0.7 unless set, as Jev at 0.5 found phrases such as `Link sent to {email}` breaking the guideline. The lock keeps each probability, so a new threshold needs no new run.

### voice/own-words passes a thing that reads or writes in fact

`Couldn’t read the file` and `Tool calls that write` keep to the guideline, where read and write are what a tool does. The guideline's words changed, so `prosebook judge` asks again of every entry.
