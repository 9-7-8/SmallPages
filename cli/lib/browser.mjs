/* A Playwright, and a Chromium for it to drive.

   The command line here runs the real page in a real browser rather than
   working the answer out in Node. That is the whole design: a page is one
   self-contained file and the only copy of what it knows, so a Node
   reimplementation would be a second colour picker, a second PDF builder, a
   second of whatever, and the two would drift the first time either was
   touched. Driving the page costs a browser launch and buys an answer that
   cannot disagree with the one in the tab.

   Both are looked for rather than demanded, so that an ordinary machine with
   Chrome or Edge on it and a Playwright installed anywhere npm puts one needs
   no setting at all. The environment variables still beat everything, and the
   container paths these were first written against are still on the list.

   tests/lib/env.mjs asks the same question and takes its answer from here, so
   there is one list of places to look rather than two that can disagree. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/* ------------------------------------------------------------ Playwright -- */

/* Where npm puts a package, in the order a person is likely to have used:
   this checkout, the folder they are standing in, their home folder, and the
   global root. The global root is worked out from where Node itself lives
   first, because that costs nothing; asking npm is the last resort, because
   it is a second or so of starting npm every time any command runs. */
function npmRoots() {
  const roots = [
    path.join(REPO, "node_modules"),
    path.join(process.cwd(), "node_modules"),
    path.join(os.homedir(), "node_modules"),
  ];
  if (process.env.npm_config_prefix) {
    roots.push(path.join(process.env.npm_config_prefix, "node_modules"),
      path.join(process.env.npm_config_prefix, "lib", "node_modules"));
  }
  if (process.platform === "win32") {
    if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, "npm", "node_modules"));
    roots.push(path.join(path.dirname(process.execPath), "node_modules"));
  } else {
    roots.push(path.join(path.dirname(process.execPath), "..", "lib", "node_modules"),
      "/usr/local/lib/node_modules", "/usr/lib/node_modules", "/opt/homebrew/lib/node_modules",
      "/opt/node22/lib/node_modules");
  }
  return roots;
}

const inRoot = (root) => [
  path.join(root, "playwright", "index.mjs"),
  path.join(root, "playwright-core", "index.mjs"),
];

/* $PLAYWRIGHT_MODULE may name the index.mjs or the folder it is in. */
function named() {
  const said = process.env.PLAYWRIGHT_MODULE;
  if (!said) return null;
  if (fs.existsSync(said) && fs.statSync(said).isDirectory()) {
    return first([path.join(said, "index.mjs"), ...inRoot(path.join(said, "node_modules"))]);
  }
  return said;
}

function findPlaywright() {
  const near = first([named(), ...npmRoots().flatMap(inRoot)]);
  if (near) return near;
  /* One string rather than a list of arguments: on Windows npm is a `.cmd`,
     which needs a shell, and a shell is handed a command line, not a list. */
  const npm = spawnSync("npm root -g",
    { encoding: "utf8", shell: true, windowsHide: true, timeout: 15000 });
  const root = npm.status === 0 && npm.stdout.trim();
  return root ? first(inRoot(root)) : null;
}

/* The sentence for a machine with none, saying exactly what to type. The
   download is skipped because a Chrome or an Edge that is already installed
   is enough, and is looked for below. */
export const NO_PLAYWRIGHT = "no Playwright found, and the command line drives the page"
  + " through it. Install it once, without its own browser:\n\n"
  + (process.platform === "win32"
    ? "    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; npm i -g playwright      in PowerShell\n"
      + "    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g playwright            in Git Bash\n"
    : "    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g playwright\n")
  + "\n  or point PLAYWRIGHT_MODULE at a copy you already have (its index.mjs, or its folder).";

export const PLAYWRIGHT = findPlaywright();

/* As a URL, because on Windows a bare `C:\…` path is read as a URL with the
   scheme `c:` and refused (ERR_UNSUPPORTED_ESM_URL_SCHEME). Not found is not
   an error here: `--help` needs no browser, so the complaint waits for the
   first thing that does. */
export const chromium = PLAYWRIGHT
  ? (await import(pathToFileURL(PLAYWRIGHT).href)).chromium
  : null;

/* -------------------------------------------------------------- Chromium -- */

/* The Chrome or Edge a person already has, by where each one installs
   itself. Playwright drives either, headless, exactly as it drives its own
   Chromium, so a machine with one of these needs no browser download. */
function installed() {
  const env = process.env;
  if (process.platform === "win32") {
    const bases = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA,
      "C:\\Program Files", "C:\\Program Files (x86)"];
    return [
      ...bases.map((b) => b && path.join(b, "Google", "Chrome", "Application", "chrome.exe")),
      ...bases.map((b) => b && path.join(b, "Microsoft", "Edge", "Application", "msedge.exe")),
      ...bases.map((b) => b && path.join(b, "Chromium", "Application", "chrome.exe")),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge",
    "/opt/google/chrome/chrome"];
}

/* Playwright's own download, when there is one, is what it was built
   against, so it comes before the system's browsers; asking it where that
   would be costs nothing and tells us whether it is really there. */
function playwrightsOwn() {
  if (!chromium) return null;
  try {
    const p = chromium.executablePath();
    return p && fs.existsSync(p) ? p : null;
  } catch { return null; }
}

const shipped = first([
  ...expand(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers",
                      "chromium-*/chrome-linux/chrome")),
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
]);

/* undefined means "let Playwright decide", which it only gets to when its
   own Chromium is really there. */
export const CHROMIUM_BIN = process.env.CHROMIUM_BIN
  || shipped
  || (playwrightsOwn() ? undefined : first(installed()))
  || undefined;

export const NO_BROWSER = "no browser for Playwright to drive. Any one of these will do:\n\n"
  + "    install Google Chrome or Microsoft Edge, which is found where it installs itself\n"
  + "    npx playwright install chromium          Playwright's own\n"
  + "    set CHROMIUM_BIN to the path of a Chrome, Edge or Chromium executable";

/* The launch options worth never copying around: no autoplay gate, because
   half of these pages are audio and a page that waits for a click it will
   never get is a page that hangs. */
export const LAUNCH_ARGS = ["--autoplay-policy=no-user-gesture-required"];

/* A failed launch that is really "there is no browser" says so in those
   words rather than in Playwright's, which name a path the reader never
   chose. */
function explain(err) {
  if (/Executable doesn't exist|spawn \S+ ENOENT/i.test(String(err.message))
      && !process.env.CHROMIUM_BIN) {
    return new Error(`${NO_BROWSER}\n\n  (Playwright said: ${String(err.message).split("\n")[0]})`);
  }
  return err;
}

export function needPlaywright() {
  if (!chromium) throw new Error(NO_PLAYWRIGHT);
  return chromium;
}

export async function launch(options = {}) {
  needPlaywright();
  return chromium.launch({
    executablePath: CHROMIUM_BIN,
    args: LAUNCH_ARGS,
    ...options,
  }).catch((e) => { throw explain(e); });
}

/* A browser that remembers. Every command used to open a fresh profile, so a
   page that keeps something in the browser's own storage — uncrop.html keeps
   its 206 MB of model weights in IndexedDB so as never to fetch them twice —
   forgot it the moment the command ended and fetched it again on the next.
   A persistent profile keeps it, provided the page is served from the same
   origin each time, which is `drive`'s half of the bargain. */
export async function launchKept(dir, options = {}) {
  needPlaywright();
  fs.mkdirSync(dir, { recursive: true });
  return chromium.launchPersistentContext(dir, {
    executablePath: CHROMIUM_BIN,
    args: LAUNCH_ARGS,
    ...options,
  }).catch((e) => { throw explain(e); });
}

/* Where that profile lives: the place each system keeps a program's
   throwaway-but-worth-keeping files. Deleting it costs nothing but the next
   download. */
export function profileDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "SmallPages", "cli-profile");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "SmallPages", "cli-profile");
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "smallpages", "cli-profile");
}
