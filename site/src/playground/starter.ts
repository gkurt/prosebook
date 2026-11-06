// The playground's starting files: an order page of the shop the examples sell from. One entry has a
// finding with a fix, so the lint has something to show; the rest is clean.
export const CATALOG = `# yaml-language-server: $schema=./catalog.schema.json
order.status:
  kind: state
  surface: status
  context: Beside the order's number, says where the parcel is.
  args:
    status: where the parcel is
  en: '{status, select, packed {Packed and waiting for pickup.} shipped {On its way.} other {Delivered.}}'

order.items:
  kind: state
  surface: status
  context: Under the order's number, counts what it holds.
  args:
    count: how many items the order holds
  en: '{count, plural, =0 {Nothing in this order yet.} one {# item in this order.} other {# items in this order.}}'

order.total:
  kind: state
  surface: status
  context: Under the items, the sum of the order.
  args:
    amount: the total price, in euros
  fragment: true
  en: 'Total: {amount, number, ::currency/EUR}'

order.arrives:
  kind: description
  surface: hint
  context: Under the status, the day the parcel should arrive.
  args:
    day: the day it should arrive
  en: 'Arrives on {day, date, ::MMMMEEEEd}.'

order.thanks:
  kind: description
  surface: hint
  context: At the top of the order page, right after checkout.
  args:
    name: the shopper's first name
  en: 'Thanks for your order, {name}.'

order.track:
  kind: action
  surface: action
  context: The button that opens the carrier's tracking page.
  en: Track parcel...
`;

export const GERMAN = `order.status: '{status, select, packed {Verpackt, wartet auf Abholung.} shipped {Unterwegs.} other {Zugestellt.}}'
order.items: '{count, plural, =0 {Noch nichts in dieser Bestellung.} one {# Artikel in dieser Bestellung.} other {# Artikel in dieser Bestellung.}}'
order.total: 'Summe: {amount, number, ::currency/EUR}'
order.arrives: 'Kommt am {day, date, ::MMMMEEEEd}.'
order.thanks: 'Danke für deine Bestellung, {name}.'
order.track: Sendung verfolgen…
`;

export const FILES = { catalog: 'copy/catalog/order.yaml', german: 'copy/locales/de/order.yaml' } as const;
