/** The entries the demo starts from: a shop's cart, as the examples have it. Sample copy, so it stays in the code. */
export interface Sample {
  id: 'slop' | 'error' | 'button' | 'count';
  key: string;
  kind: string;
  surface: string;
  context: string;
  /** What `count` holds, where the message takes one. */
  count?: string;
  /** The text the visitor starts from: a draft the lint has something to say about, or a plural to read. */
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'slop',
    key: 'sync.about',
    kind: 'description',
    surface: 'hint',
    context: 'Under the sync setting, says what sync does.',
    text: 'Unlock seamless, powerful sync across all your devices!',
  },
  {
    id: 'error',
    key: 'cart.failed',
    kind: 'state',
    surface: 'error',
    context: 'Shown when the payment did not go through.',
    text: 'Oops! Something went wrong, please try again later...',
  },
  {
    id: 'button',
    key: 'cart.checkout',
    kind: 'action',
    surface: 'action',
    context: 'The button that starts paying for the cart.',
    text: 'Click here to check out.',
  },
  {
    id: 'count',
    key: 'cart.items',
    kind: 'state',
    surface: 'status',
    context: 'Under the cart heading, counts what is in the cart.',
    count: 'how many items are in the cart',
    text: '{count, plural, =0 {Your cart is empty.} one {# item in your cart.} other {# items in your cart.}}',
  },
];

export const START_COUNT = 3;

export const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The fields above the text, as the catalog file writes them, one `[field, value]` per line. */
export function fieldsOf(sample: Sample): [string, string][] {
  return [
    ['kind', sample.kind],
    ['surface', sample.surface],
    ['context', sample.context],
  ];
}

/** The call that reads the sample, highlighted. */
export function readOf(sample: Sample, count: number): string {
  const values = sample.count === undefined ? '' : `, { count: <span class="n">${count}</span> }`;
  return `t(<span class="s">'${sample.key}'</span>${values})`;
}
