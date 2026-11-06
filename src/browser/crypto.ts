/**
 * `node:crypto` in the browser build: the one hash the lock takes of a source text. Not SHA-256,
 * which nothing in the browser compares with a lock on disk; stable, which is all a session needs.
 */
export function createHash() {
  let text = '';
  const hash = {
    update(more: string) {
      text += more;
      return hash;
    },
    digest() {
      let a = 0x811c9dc5;
      let b = 0x01000193;
      for (let i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
        b = Math.imul(b ^ text.charCodeAt(i), 0x5bd1e995);
      }
      return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).repeat(2);
    },
  };
  return hash;
}
