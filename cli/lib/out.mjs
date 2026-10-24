/* Printing. Two shapes for every answer: lines for a person, and `--json` for
   whatever the output is being piped into. A tool builds one object and hands
   it to `emit` with a function that writes the readable version, so the two
   can never describe different runs. */

const plain = !!process.env.NO_COLOR || !process.stdout.isTTY;

/* A terminal that can do 24-bit colour is the one place a colour tool can
   show its answer rather than spell it. Anywhere else this is empty, so the
   columns still line up. */
export function swatch(hex) {
  if (plain) return "";
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "  ";
  const n = parseInt(m[1], 16);
  return `\x1b[48;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m  \x1b[0m `;
}

export const dim = (s) => (plain ? s : `\x1b[2m${s}\x1b[0m`);
export const bold = (s) => (plain ? s : `\x1b[1m${s}\x1b[0m`);

/* Two columns, the left one padded to the widest label. */
export function rows(pairs, indent = "  ") {
  const live = pairs.filter((p) => p && p[1] !== undefined && p[1] !== null);
  const wide = live.reduce((w, [k]) => Math.max(w, String(k).length), 0);
  return live.map(([k, v]) => `${indent}${dim(String(k).padEnd(wide))}  ${v}`);
}

/* A paragraph the page wrote, folded to something a terminal can read. */
export function wrap(text, width = 76, indent = "  ") {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > width) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l);
}

export function emit(data, readable, asJson) {
  if (asJson) { console.log(JSON.stringify(data, null, 2)); return; }
  const said = readable(data);
  console.log((Array.isArray(said) ? said.join("\n") : said).replace(/\n+$/, ""));
}
