/* Argument parsing, kept to what these tools actually take: words, and
   `--name value` or `--name=value` flags. No short cluster, no subcommand
   grammar, nothing that needs a dependency.

   A flag named in `booleans` never swallows the word after it, which is the
   one ambiguity worth settling by hand: `--json palette.png` has to leave the
   file where a tool can find it. */

export function parse(argv, booleans = []) {
  const bool = new Set([...booleans, "help", "json", "h"]);
  const words = [];
  const flags = {};

  const flagLike = (a) => a.length > 1 && a.startsWith("-") && !/^-?[.\d]/.test(a);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { words.push(...argv.slice(i + 1)); break; }
    if (!flagLike(a)) { words.push(a); continue; }

    const eq = a.indexOf("=");
    const name = (eq === -1 ? a : a.slice(0, eq)).replace(/^--?/, "");
    if (eq !== -1) { flags[name] = a.slice(eq + 1); continue; }
    if (bool.has(name)) { flags[name] = true; continue; }

    const next = argv[i + 1];
    if (next === undefined || flagLike(next)) { flags[name] = true; continue; }
    flags[name] = next;
    i++;
  }

  if (flags.h) { flags.help = true; delete flags.h; }
  return { words, flags };
}

/* `--count 7` arrives as the string "7". A tool that wants a number wants to
   say so once and be told plainly when it was handed something else. */
export function number(value, what, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === true || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} wants a number, not "${value}"`);
  if (n < min || n > max) {
    throw new Error(`${what} has to be between ${min} and ${max}, not ${n}`);
  }
  return n;
}

/* The same for a flag with a fixed set of answers, so a typo is a sentence
   rather than a silent fall through to the default. */
export function oneOf(value, what, allowed, fallback) {
  if (value === undefined || value === true) return fallback;
  if (!allowed.includes(value)) {
    throw new Error(`${what} is one of ${allowed.join(", ")} — not "${value}"`);
  }
  return value;
}
