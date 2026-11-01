/**
 * A word diff, for showing a translator what changed in the source since they translated it. Words,
 * runs of whitespace and single punctuation marks are the units, so an ICU brace or a period changes
 * on its own rather than taking its word with it.
 */

export interface DiffPart {
  op: 'same' | 'add' | 'del';
  text: string;
}

const TOKEN = /\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_]/gu;

/** Past this many cells the table costs more than the diff is worth: show the whole change instead. */
const MAX_CELLS = 250_000;

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  if (a.length * b.length > MAX_CELLS) {
    const whole: DiffPart[] = [
      { op: 'del', text: before },
      { op: 'add', text: after },
    ];
    return merge(whole);
  }
  // The longest common subsequence, by suffix, so the walk below reads front to back.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ op: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      parts.push({ op: 'del', text: a[i++]! });
    } else {
      parts.push({ op: 'add', text: b[j++]! });
    }
  }
  while (i < a.length) parts.push({ op: 'del', text: a[i++]! });
  while (j < b.length) parts.push({ op: 'add', text: b[j++]! });
  return merge(parts);
}

/**
 * Adjacent parts of one kind joined, and a space shared by two changes folded into them, so a
 * replaced phrase reads `[-old words-]{+new words+}` rather than alternating word by word.
 */
function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k]!;
    const prev = out.at(-1);
    const next = parts[k + 1];
    if (part.op === 'same' && /^\s+$/.test(part.text) && prev && prev.op !== 'same' && next && next.op !== 'same') {
      // Whitespace between two changes belongs to both.
      out.push({ op: 'del', text: part.text }, { op: 'add', text: part.text });
      continue;
    }
    out.push({ ...part });
  }
  const joined: DiffPart[] = [];
  for (const part of out.filter((p) => p.text !== '')) {
    // Gather each stretch of changes as all its deletions, then all its additions.
    const last = joined.at(-1);
    if (last && last.op === part.op) last.text += part.text;
    else if (part.op === 'del' && last?.op === 'add' && joined.at(-2)?.op === 'del') joined.at(-2)!.text += part.text;
    else joined.push({ ...part });
  }
  return joined;
}

/** The diff as one line: `Save [-the-]{+a+} draft`, the notation of `git diff --word-diff`. */
export function formatDiff(parts: DiffPart[]): string {
  return parts.map((p) => (p.op === 'same' ? p.text : p.op === 'del' ? `[-${p.text}-]` : `{+${p.text}+}`)).join('');
}
