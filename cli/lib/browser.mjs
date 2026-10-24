/* A Playwright, and a Chromium for it to drive.

   The command line here runs the real page in a real browser rather than
   working the answer out in Node. That is the whole design: a page is one
   self-contained file and the only copy of what it knows, so a Node
   reimplementation would be a second colour picker, a second PDF builder, a
   second of whatever, and the two would drift the first time either was
   touched. Driving the page costs a browser launch and buys an answer that
   cannot disagree with the one in the tab.

   These paths were written against one container, where all of this sat at
   fixed locations. Those are the last fallback rather than the only answer,
   so an environment variable or an ordinary local install works too.

   tests/lib/env.mjs asks the same question and takes its answer from here, so
   there is one list of places to look rather than two that can disagree. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "..", "..");

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

/* The launch options worth never copying around: no autoplay gate, because
   half of these pages are audio and a page that waits for a click it will
   never get is a page that hangs. */
export async function launch(options = {}) {
  return chromium.launch({
    executablePath: CHROMIUM_BIN,
    args: ["--autoplay-policy=no-user-gesture-required"],
    ...options,
  });
}
