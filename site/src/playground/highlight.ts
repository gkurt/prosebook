// The playground's highlighting, as HTML: the catalog the visitor edits, and the files it generates.
// Enough for these files, not a parser: the real one runs a moment later and says what's wrong.

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const span = (cls: string, text: string) => (text === '' ? '' : `<span class="${cls}">${escape(text)}</span>`);

const KEYWORDS =
  /\b(?:import|export|from|const|let|var|type|readonly|return|switch|case|default|public|private|internal|static|func|fun|val|enum|class|object|struct|extension|protocol|package|when|else|if|in|is|some|override)\b/;
const TOKENS = new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*")|(${KEYWORDS.source})`, 'g');

/** TypeScript, Swift or Kotlin: comments, strings and keywords. */
export function highlightCode(code: string): string {
  let html = '';
  let last = 0;
  for (const m of code.matchAll(TOKENS)) {
    html += escape(code.slice(last, m.index));
    html += span(m[1] !== undefined ? 'c' : m[2] !== undefined ? 's' : 'w', m[0]);
    last = m.index + m[0].length;
  }
  return html + escape(code.slice(last));
}

/**
 * An ICU message: its words as a string, and its syntax (placeholders, their types and arms, `#`
 * and tags) as keywords. Within braces everything is syntax until an arm opens words again.
 */
function message(src: string): string {
  let html = '';
  // The run being built, and its class: the message's words (`s`) or its syntax (`w`).
  let run = '';
  let cls = 's';
  const put = (c: string, text: string) => {
    if (c !== cls) {
      html += span(cls, run);
      run = '';
      cls = c;
    }
    run += text;
  };
  // Words or a placeholder's syntax, innermost last.
  const modes: ('words' | 'syntax')[] = ['words'];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const inSyntax = modes.at(-1) === 'syntax';
    const tag = inSyntax || ch !== '<' ? null : /^<\/?[\w-]+\s*\/?>/.exec(src.slice(i));
    if (ch === '{') {
      modes.push(inSyntax ? 'words' : 'syntax');
      put('w', ch);
    } else if (ch === '}' && modes.length > 1) {
      modes.pop();
      put('w', ch);
    } else if (inSyntax || (ch === '#' && modes.length > 1)) {
      put('w', ch);
    } else if (tag !== null) {
      put('w', tag[0]);
      i += tag[0].length - 1;
    } else {
      put('s', ch);
    }
  }
  return html + span(cls, run);
}

/** A YAML value holding a message, its quotes muted. */
function scalar(value: string): string {
  const quote = value[0];
  if ((quote === "'" || quote === '"') && value.length > 1 && value.endsWith(quote))
    return span('c', quote) + message(value.slice(1, -1)) + span('c', quote);
  return message(value);
}

const ENTRY = /^(\s*)([^\s#:][^:]*?)(:)(\s*)(.*)$/;

/**
 * A catalog or translation file: keys, comments, and the messages, which are the source's `en` in an
 * entry and every value at the top of a translation file. The rest (kind, context, args) is plain.
 */
export function highlightCatalog(yaml: string, source = 'en'): string {
  const lines = yaml.split('\n').map((line) => {
    if (/^\s*#/.test(line)) return span('c', line);
    const m = ENTRY.exec(line);
    if (m === null) return escape(line);
    const [, indent = '', key = '', colon = '', gap = '', value = ''] = m;
    const isMessage = key === source || (indent === '' && key.includes('.'));
    return indent + span('k', key) + colon + gap + (isMessage ? scalar(value) : escape(value));
  });
  // A last empty line still takes its height, as the textarea above it does.
  return `${lines.join('\n')}\n`;
}
