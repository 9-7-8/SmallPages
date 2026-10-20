import { chromium, CHROMIUM_BIN, WORK } from "../lib/env.mjs";
import fs from "fs"; import path from "path";
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const files = fs.readdirSync(".").filter(f => f.endsWith(".html")).sort();
for (const f of files) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  await page.goto("file://" + path.resolve(f));
  await page.waitForTimeout(400);
  const hits = await page.evaluate(() => {
    const SKIP = new Set(["CODE","PRE","SCRIPT","STYLE","A","EM","STRONG","P","LI","TEXTAREA"]);
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (SKIP.has(el.tagName)) continue;
      if (el.querySelector("code, pre")) continue;
      // first text node directly inside this element
      const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!node) continue;
      const t = node.textContent.trim();
      if (!/^[a-z]/.test(t)) continue;
      out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/)[0] : ""}  ${t.slice(0, 80)}`);
    }
    // attributes too
    for (const el of document.querySelectorAll("[title],[aria-label],[placeholder]")) {
      for (const a of ["title","aria-label","placeholder"]) {
        const v = el.getAttribute(a);
        if (v && /^[a-z]/.test(v)) out.push(`@${a}  ${v.slice(0, 80)}`);
      }
    }
    return [...new Set(out)];
  });
  if (hits.length || errs.length) {
    console.log(`\n### ${f}`);
    for (const h of hits) console.log("  " + h);
    for (const e of errs) console.log("  !! " + e);
  }
  await page.close();
}
await browser.close();
