/* The three things every suite here needs and none of them should hardcode:
   a Playwright, a Chromium to point it at, and somewhere to write.

   These suites were written against one container, where all three sat at
   fixed paths. Those paths are the last fallback rather than the only answer,
   so an environment variable or an ordinary local install works too. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TESTS = path.resolve(here, "..");
export const REPO = path.resolve(TESTS, "..");

const first = (where) => where.find((p) => p && fs.existsSync(p));

function expand(globbish) {
  // One `*`, one level, because that is all the Chromium layout needs.
  const star = globbish.indexOf("*");
  if (star === -1) return fs.existsSync(globbish) ? [globbish] : [];
  const head = globbish.slice(0, star);
  const tail = globbish.slice(star + 1);
  const dir = path.dirname(head);
  const stem = path.basename(head);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(stem))
    .map((name) => path.join(dir, name) + tail)
    .filter((p) => fs.existsSync(p))
    .sort()
    .reverse();                       // newest build first
}

const PW = first([
  process.env.PLAYWRIGHT_MODULE,
  path.join(REPO, "node_modules/playwright/index.mjs"),
  "/opt/node22/lib/node_modules/playwright/index.mjs",
  "/usr/lib/node_modules/playwright/index.mjs",
]);
if (!PW) {
  throw new Error("no Playwright found — install it, or set PLAYWRIGHT_MODULE "
    + "to the path of its index.mjs");
}
export const { chromium } = await import(PW);

/* Playwright's own browser lookup is used when nothing is named, so an
   ordinary `npx playwright install chromium` just works; the explicit paths
   are for the container, where the download is skipped and one is provided. */
export const CHROMIUM_BIN = process.env.CHROMIUM_BIN
  || first([
    ...expand(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers",
                        "chromium-*/chrome-linux/chrome")),
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ])
  || undefined;                       // undefined => let Playwright decide

export const PORT = Number(process.env.SITE_PORT || 8099);
export const SITE = process.env.SITE || `http://127.0.0.1:${PORT}`;

/* Where a suite writes its screenshots and downloads, and where it reads its
   fixtures from. They are the same directory because the suites were written
   against a flat scratchpad: the fixture folders are linked in rather than
   copied, so `WORK + "/docs/alpha.pdf"` and `WORK + "/rain.png"` both land
   somewhere sensible and only the second is ever written. */
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

/* What nearly every suite opens with, so the launch options stop being
   copied around: no autoplay gate, because half of these pages are audio. */
export async function open(options = {}) {
  return chromium.launch({
    executablePath: CHROMIUM_BIN,
    args: ["--autoplay-policy=no-user-gesture-required"],
    ...options,
  });
}

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
