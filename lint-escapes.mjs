/* Backslashes that do not survive a template literal.
 *
 *   node lint-escapes.mjs [files…]      (defaults to the .mjs files here)
 *
 * The journeys send JavaScript to the browser inside template literals, and a
 * template literal eats escapes on the way. `\s` is not an escape sequence, so
 * the backslash is dropped and a whitespace regex quietly starts matching the
 * letter s — "Coastal" becomes "Coa tal" and a test lies to you. `\n`, `\t` and
 * `\r` are worse in one way: they survive as real characters, so a regex
 * containing one is a regex with a line break in it.
 *
 * The fix is always the same: double the backslash.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(here).filter(f => f.endsWith('.mjs') && f !== 'lint-escapes.mjs').map(f => join(here, f));

/* a template literal keeps these; everything else loses its backslash */
const SURVIVES = new Set(['\\', '`', '$', "'", '"']);
/* these survive as a character, which is not what a regex wanted */
const BECOMES_A_CHARACTER = new Set(['n', 't', 'r', 'v', 'f', 'b', '0']);

function scan(text) {
  const found = [];
  let i = 0, line = 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch !== '`') { i++; continue; }

    /* read the whole template literal, keeping track of where each line starts */
    i++;
    const body = [];
    const lineAt = [];
    while (i < text.length && text[i] !== '`') {
      if (text[i] === '\\') { body.push(text[i], text[i + 1]); lineAt.push(line, line); i += 2; continue; }
      if (text[i] === '\n') line++;
      body.push(text[i]); lineAt.push(line); i++;
    }
    i++;
    const src = body.join('');

    /* a backslash before one of these is not an escape at all: the backslash is
       simply dropped, whatever the template was for */
    for (let k = 0; k < src.length; k++) {
      if (src[k] !== '\\') continue;
      const next = src[k + 1];
      if (SURVIVES.has(next)) { k++; continue; }
      if (BECOMES_A_CHARACTER.has(next)) { k++; continue; }   /* judged below, in context */
      found.push({ line: lineAt[k] || line, why: `\\${next} is not an escape, so the backslash is dropped and the pattern matches "${next}"`,
                   snippet: src.slice(Math.max(0, k - 30), k + 30) });
      k++;
    }

    /* \n, \t and \r are real escapes — harmless in a string, fatal inside a
       regex, where they put an actual line break or tab in the pattern */
    const REGEX_LITERAL = /(?<![a-zA-Z0-9_)\]])\/(?![*/])(?:\[[^\]]*\]|\\.|[^/\n])+\/[gimsuy]*/g;
    let m;
    while ((m = REGEX_LITERAL.exec(src))) {
      for (let k = m.index; k < m.index + m[0].length; k++) {
        if (src[k] !== '\\') continue;
        const next = src[k + 1];
        if (BECOMES_A_CHARACTER.has(next)) {
          found.push({ line: lineAt[k] || line,
                       why: `\\${next} inside a regex becomes a real character here, not the pattern you meant`,
                       snippet: src.slice(Math.max(0, k - 30), k + 30) });
        }
        k++;
      }
    }
  }
  return found.map(f => ({ ...f, snippet: f.snippet.replace(/\n/g, ' ') }));
}

let bad = 0;
for (const file of files) {
  const hits = scan(readFileSync(file, 'utf8'));
  for (const h of hits) {
    bad++;
    console.error(`${basename(file)}:${h.line}  ${h.why}`);
    console.error(`    …${h.snippet.trim()}…`);
    console.error(`    write it doubled instead.`);
  }
}
if (bad) { console.error(`\nFAIL ${bad} backslash${bad === 1 ? '' : 'es'} would not survive its template literal.`); process.exit(1); }
console.log(`ok   every backslash in ${files.length} file${files.length === 1 ? '' : 's'} survives its template literal`);
