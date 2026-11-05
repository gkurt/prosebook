---
packages:
  'prosebook': minor
---

### Named formats: a number or date format named once in the config, shown the same everywhere

`formats: { number: { price: { style: 'currency', currency: 'EUR' } }, date: { receipt: { dateStyle: 'medium', timeStyle: 'short' } } }` lets a message say `{total, number, price}` (`{$total :number format=price}` in MF2) and code say `copy.number(total, 'price')` or `copy.date(when, 'receipt')`, with the names typed. `formats.locales` shows a format differently in a locale or language. The writing guide lists the formats, and the `named-format` lint warns of a message that writes out a named format's options rather than its name.
