/* Opening a page and calling into it.

   Every tool's command line is the same four steps — serve the checkout,
   launch a browser, open the page, call one of the jobs the page exposes on
   `window.CLI` — so they live here once and a tool module is left with
   nothing but its own arguments and its own output.

   A page's jobs are the page's own functions. `drive` does not know what any
   of them do; it hands them an object and brings back whatever they return,
   which has to survive a trip through structured cloning, so a job returns
   plain data and never a canvas, a blob or a DOM node.

   The browser keeps a profile between commands, so whatever a page keeps in
   its own storage survives from one run to the next — which for uncrop.html
   is 206 MB of model weights that used to be fetched again for every single
   picture. Storage belongs to an origin and a port is part of the origin, so
   a remembering browser is always handed the checkout on the same port. When
   it cannot be — the port is taken, or another command already has the
   profile open — the run goes ahead in a fresh one and says what that costs.

       SMALLPAGES_PROFILE=none        a fresh profile every time, on any port;
                                      the suites run like this, so nothing one
                                      of them leaves behind reaches the next
       SMALLPAGES_PROFILE=<dir>       keep the profile there instead
       SMALLPAGES_PORT=<n>            the port a remembering run serves on */

import { launch, launchKept, profileDir, REPO } from "./browser.mjs";
import { serve } from "./serve.mjs";

export { REPO };

export const KEPT_PORT = 47615;

/* Which profile, if any. `false` is a fresh one. */
export function profileWanted(env = process.env) {
  const said = env.SMALLPAGES_PROFILE;
  if (said === undefined || said === "") return profileDir();
  if (/^(none|off|fresh|no|0)$/i.test(said)) return false;
  return said;
}

const note = (s) => process.stderr.write(`  ${s}\n`);

async function browserFor(viewport, profile, port) {
  if (!profile) {
    const site = await serve(REPO);
    const browser = await launch();
    const ctx = await browser.newContext({ viewport, acceptDownloads: true });
    return { site, ctx, browser, kept: false };
  }

  let site;
  try {
    site = await serve(REPO, { port });
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e;
    note(`port ${port} is taken, so this run cannot use what the browser kept from the`
      + " last one — a model will be fetched again. SMALLPAGES_PORT moves it.");
    return browserFor(viewport, false, port);
  }
  try {
    const ctx = await launchKept(profile, { viewport, acceptDownloads: true });
    return { site, ctx, browser: null, kept: true };
  } catch (e) {
    await site.close().catch(() => {});
    /* A profile is a folder only one browser may hold at a time, and a
       second command started while the first is still going is the usual
       reason it will not open. That is no reason to refuse to run. */
    if (/Executable|no browser|no Playwright/i.test(String(e.message))) throw e;
    note(`the kept browser profile at ${profile} would not open (another command may be`
      + " using it), so this run starts fresh and a model will be fetched again.");
    return browserFor(viewport, false, port);
  }
}

export async function drive(page, options = {}) {
  const {
    viewport = { width: 1280, height: 1200 },
    profile = profileWanted(),
    port = Number(process.env.SMALLPAGES_PORT) || KEPT_PORT,
  } = options;
  const { site, ctx, browser, kept } = await browserFor(viewport, profile, port);
  const tab = ctx.pages()[0] || await ctx.newPage();

  /* A page that throws on the way up has nothing to say for itself through a
     job, so its complaints are kept and shown with whatever goes wrong. */
  const trouble = [];
  tab.on("pageerror", (e) => trouble.push(String(e.message)));
  tab.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon|404/.test(m.text())) return;
    trouble.push(m.text());
  });

  const close = async () => {
    await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await site.close().catch(() => {});
  };

  try {
    await tab.goto(`${site.origin}/${page}`, { waitUntil: "load" });
    await tab.waitForFunction(() => window.CLI && window.CLI.jobs, null,
      { timeout: 20000 });
  } catch (err) {
    await close();
    throw new Error(`${page} never offered a command line`
      + (trouble.length ? `:\n  ${trouble.join("\n  ")}` : ` (${err.message})`));
  }

  const call = async (job, args = {}) => {
    const known = await tab.evaluate(() => Object.keys(window.CLI.jobs));
    if (!known.includes(job)) {
      throw new Error(`${page} has no job called "${job}" — it has `
        + known.join(", "));
    }
    try {
      return await tab.evaluate(
        ([name, opts]) => window.CLI.jobs[name](opts), [job, args]);
    } catch (err) {
      /* Playwright wraps what the page threw in its own stack. The page's own
         sentence is the useful part, and the only part a reader asked for. */
      const said = String(err.message).split("\n")[0]
        .replace(/^.*?Error: /, "");
      throw new Error(said || err.message);
    }
  };

  return { tab, call, close, trouble, origin: site.origin, kept };
}
