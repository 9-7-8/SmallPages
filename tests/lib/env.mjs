/* The three things every suite here needs and none of them should hardcode:
   a Playwright, a Chromium to point it at, and somewhere to write.

   The first two come from cli/lib/browser.mjs, because the command line needs
   exactly the same two and one list of places to look cannot disagree with
   itself. Where to write is this file's own business, and so is getting the
   fixtures there. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export { chromium, CHROMIUM_BIN } from "../../cli/lib/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TESTS = path.resolve(here, "..");
export const REPO = path.resolve(TESTS, "..");

export const PORT = Number(process.env.SITE_PORT || 8099);
export const SITE = process.env.SITE || `http://127.0.0.1:${PORT}`;

/* Where a suite writes its screenshots and downloads, and where it reads its
   fixtures from. They are the same directory because the suites were written
   against a flat scratchpad, so `WORK + "/docs/alpha.pdf"` and
   `WORK + "/rain.png"` both land somewhere sensible. How the fixtures get
   there, and why that matters, is the next comment down. */
export const WORK = process.env.TEST_WORK || path.join(TESTS, ".work");

const FIXTURES = [
  "docs", "caps", "anki", "dragons", "pdflib",   // folders
  "clip.webm", "sample.pdf", "text.pdf",         // and the loose ones
];

/* Copied rather than linked, and refreshed on every suite. Linking them was
   the obvious thing and it was wrong: a suite that saves its output under a
   fixture's name writes straight through the link and replaces the fixture
   for every suite after it, which is how test-pdfb came to overwrite the PDF
   test-ati-file reads. Copies cost half a megabyte and cannot do that, and
   refreshing means each suite starts from the committed article however the
   one before it left the directory. */
fs.mkdirSync(WORK, { recursive: true });
for (const kit of FIXTURES) {
  const into = path.join(WORK, kit);
  const from = path.join(TESTS, kit);
  if (!fs.existsSync(from)) continue;
  fs.rmSync(into, { recursive: true, force: true });
  fs.cpSync(from, into, { recursive: true });
}

/* What nearly every suite opens with, under the name they call it by. The
   options it carries — the executable, and no autoplay gate, because half of
   these pages are audio — are the command line's too, so they live beside the
   lookup rather than here. */
export { launch as open } from "../../cli/lib/browser.mjs";

/* Some suites were written against material that does not belong in a public
   repository -- a personal flashcard collection, in practice. Rather than
   dropping those suites or committing somebody's cards, they say up front what
   they need and stand down cleanly when it is not there, so a fresh checkout
   reports a skip rather than a stack trace. */
export function need(...files) {
  const missing = files.filter((f) =>
    !fs.existsSync(path.isAbsolute(f) ? f : path.join(WORK, f)));
  if (!missing.length) return;
  console.log(`SKIP  this suite needs ${missing.join(", ")}, which the repo`);
  console.log("      does not carry. tests/README.md says what to put there.");
  process.exit(0);
}


/* A tally, so a suite's last line can be the only thing a runner reads. */
export function scoring() {
  let pass = 0, fail = 0;
  const ok = (name, cond, why = "") => {
    if (cond) { pass++; console.log("PASS  " + name); }
    else { fail++; console.log("FAIL  " + name + (why ? "  <<< " + why : "")); }
    return cond;
  };
  const done = () => {
    console.log(`\n${pass} passing, ${fail} failing`);
    return fail;
  };
  return { ok, done, get pass() { return pass; }, get fail() { return fail; } };
}
