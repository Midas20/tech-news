// Enough YAML for GitHub's topic index and no more.
//
// This lives in its own module because the script that uses it is executable
// top to bottom -- it opens a database and imports 1,251 topics the moment it
// is loaded. A test that wanted one pure function from it got the import as
// well, and wrote eight rows into a live vocabulary. A parser is a pure
// function; nothing that reaches for one should have to run a program.

/**
 * Enough YAML for this file format and no more.
 *
 * The frontmatter is flat scalars plus folded strings; there are no nested
 * structures to get wrong, and pulling in a YAML parser to read seven keys would
 * be the larger risk.
 */
export function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: Record<string, string> = {};
  let key = '';
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1]!;
      out[key] = unquote(kv[2]!.trim());
    } else if (key && /^\s+\S/.test(line)) {
      // A folded continuation line, which short_description often uses.
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

/**
 * Take the quotes off a YAML scalar.
 *
 * Skipping this is what put a technology called “"Animal Crossing"” in the
 * registry, quotation marks and all. YAML requires quoting when a value holds a
 * colon or a comma, which is why the thirteen it damaged read like a list of
 * the awkward ones -- "JSON:API", "CC: Tweaked", "Nashville, Tennessee",
 * "PSR-15: HTTP Server Request Handlers". They were not awkward entries; they
 * were correctly quoted ones, and the parser kept the quotes as text.
 *
 * Only a matched outer pair: a display name may legitimately contain a quote
 * character, and stripping one end of it would be a new bug of the same shape.
 */
export function unquote(v: string): string {
  const m = /^"([\s\S]*)"$/.exec(v) ?? /^'([\s\S]*)'$/.exec(v);
  if (!m) return v;
  return m[1]!.replace(/\\"/g, '"').replace(/''/g, "'");
}
