---
packages:
  'prosebook': minor
---

### Dates in Rust, Swift and Kotlin

A `{when, date}` or `{when, time}` message now generates native code, with each format taken apart from `Intl` and checked against it as number formats are: a `Date` in Swift and a `java.time.Instant` in Kotlin, shown in the device's time zone, and in Rust a `DateTime` of the clock's fields, made with `DateTime::from_unix(seconds, offset)`.

### Apple plurals in a `.stringsdict`

The `apple` target writes a message with a plural to a `.stringsdict` beside its `.strings` table, each plural a variable with its count as `%lld`, instead of failing `generate`.
