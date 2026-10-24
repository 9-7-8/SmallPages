/* Opening a page and calling into it.

   Every tool's command line is the same four steps — serve the checkout,
   launch a browser, open the page, call one of the jobs the page exposes on
   `window.CLI` — so they live here once and a tool module is left with
   nothing but its own arguments and its own output.

   A page's jobs are the page's own functions. `drive` does not know what any
   of them do; it hands them an object and brings back whatever they return,
   which has to survive a trip through structured cloning, so a job returns
   plain data and never a canvas, a blob or a DOM node. */

import { launch, REPO } from "./browser.mjs";
import { serve } from "./serve.mjs";

export { REPO };

export async function drive(page, options = {}) {
  const { viewport = { width: 1280, height: 1200 } } = options;
  const site = await serve(REPO);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport });
  const tab = await ctx.newPage();

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
    await browser.close().catch(() => {});
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

  return { tab, call, close, trouble };
}
