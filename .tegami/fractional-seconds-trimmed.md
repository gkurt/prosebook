---
packages:
  'prosebook': patch
---

### A duration's fraction of a second drops its trailing zeros and counts as a unit

With `fractionalDigits: 1`, 12 seconds is "12s" rather than "12.0s", and with the default `units` of 2, 3 minutes 5 seconds is "3m 5s" rather than "3m 5.0s". Digital keeps every digit, and `fractionalDigits` is 1 to 3.
