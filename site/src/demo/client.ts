/** The demo in the browser: the sample picked, its text as edited, and the count it is read with. */
import '#src/inspect.ts';
import { readOf, SAMPLES, START_COUNT, type Sample } from './samples.ts';

const root = document.querySelector<HTMLElement>('#try')!;
const find = (selector: string) => root.querySelector<HTMLElement>(selector)!;

const field = root.querySelector('textarea')!;
const marks = find('.marks');
const read = find('.read');
const shown = find('.shown');
const notes = find('.notes');
const counter = find('.counter');
const range = root.querySelector<HTMLInputElement>('input[type=range]')!;

/** Each sample keeps its edits while another is shown. */
const texts = new Map(SAMPLES.map((s) => [s.id, s.text]));
let sample = SAMPLES[0]!;
let count = START_COUNT;

// The tools are most of the page's weight, so they load once the page is idle, or on the first edit.
const importTools = () => import('./view.ts');
let tools: ReturnType<typeof importTools> | undefined;
const load = () => (tools ??= importTools());

async function update() {
  const text = field.value;
  texts.set(sample.id, text);
  read.innerHTML = readOf(sample, count);
  const { view } = await load();
  // An edit made while the tools loaded is the one to show.
  if (text !== field.value) return;
  const next = view(sample, text, count);
  marks.innerHTML = next.marks;
  notes.innerHTML = next.notes;
  shown.classList.toggle('unread', next.shown === undefined);
  if (next.shown !== undefined) shown.textContent = next.shown;
}

function pick(next: Sample) {
  sample = next;
  for (const tab of root.querySelectorAll<HTMLElement>('[data-sample]'))
    tab.setAttribute('aria-pressed', String(tab.dataset['sample'] === next.id));
  for (const fields of root.querySelectorAll<HTMLElement>('[data-fields]')) fields.hidden = fields.dataset['fields'] !== next.id;
  counter.hidden = next.count === undefined;
  field.value = texts.get(next.id)!;
  // The marks are the old sample's until the lint answers; the text alone keeps the field's height right.
  marks.textContent = `${field.value} `;
  void update();
}

field.addEventListener('input', () => {
  marks.textContent = `${field.value} `;
  void update();
});

range.addEventListener('input', () => {
  count = Number(range.value);
  void update();
});

async function mend(index: number) {
  const { fixed } = await load();
  field.value = fixed(sample, field.value, index);
  marks.textContent = `${field.value} `;
  await update();
}

root.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  const tab = target?.closest<HTMLElement>('[data-sample]');
  const next = SAMPLES.find((s) => s.id === tab?.dataset['sample']);
  if (next !== undefined) return pick(next);
  const index = target?.closest<HTMLElement>('[data-fix]')?.dataset['fix'];
  if (index !== undefined) void mend(Number(index));
});

if ('requestIdleCallback' in window) requestIdleCallback(() => void load());
else setTimeout(() => void load(), 1500);

const copy = document.querySelector<HTMLButtonElement>('.install button')!;
const label = copy.textContent;
copy.addEventListener('click', () => {
  void navigator.clipboard.writeText(copy.dataset['command']!).then(() => {
    copy.textContent = copy.dataset['copied']!;
    setTimeout(() => (copy.textContent = label), 1500);
  });
});
