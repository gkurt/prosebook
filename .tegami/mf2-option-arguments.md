---
packages:
  'prosebook': minor
---

### MF2 options from arguments: `{$price :currency currency=$code}`

An option can take its value from an argument: a currency, unit, time zone, calendar, display or digit count. The argument is typed with the rest, the formatter is built once per value, and `migrate 1` stops at such a message, since MF1 can't say it.

### A `:currency` or `:unit` takes its currency or unit from the `.input` that declared its operand

`.input {$price :currency currency=EUR}` then `{$price :currency fractionDigits=0}` was refused for naming no currency; it is in euros, as MF2 has it.
