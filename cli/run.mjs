#!/usr/bin/env node
/* The pages, from a terminal.

       node cli/run.mjs                        what has a command line
       node cli/run.mjs color-picker --help     what that one takes
       node cli/run.mjs color-picker convert "#4f8fd0"

   Every page here is one self-contained HTML file and the only copy of what
   it knows, so nothing is reimplemented in Node. A command opens the real
   page in a headless Chromium, calls one of the jobs the page offers on
   `window.CLI`, and prints what comes back. The answer on the command line is
   the answer in the tab, because it came from the same code.

   `cli/README.md` says what adding a page to this takes. Games are not in it:
   a game is something you play. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./lib/args.mjs";
import { drive } from "./lib/drive.mjs";
import { bold, dim, wrap } from "./lib/out.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(here, "tools");

const known = fs.existsSync(TOOLS)
  ? fs.readdirSync(TOOLS).filter((f) => f.endsWith(".mjs")).sort()
      .map((f) => f.replace(/\.mjs$/, ""))
  : [];

async function load(name) {
  return import(path.join(TOOLS, `${name}.mjs`));
}

function contents() {
  const lines = [
    "",
    `  ${bold("SmallPages")} from the command line.`,
    "",
    "    node cli/run.mjs <tool> <command> [options]",
    "    node cli/run.mjs <tool> --help",
    "",
  ];
  if (!known.length) return [...lines, `  ${dim("nothing here yet")}`, ""];
  return lines;
}

const { words, flags } = parse(process.argv.slice(2));
const name = words.shift();

if (!name) {
  const lines = contents();
  for (const tool of known) {
    const mod = await load(tool);
    lines.push(`  ${bold(tool)}`);
    lines.push(...wrap(mod.summary || "", 70, "    ").map(dim));
  }
  lines.push("", `  ${dim("The rest of the pages are still browser-only; "
    + "cli/README.md says what adding one takes.")}`, "");
  console.log(lines.join("\n"));
  process.exit(0);
}

const asked = name.replace(/\.html$/, "");
if (!known.includes(asked)) {
  console.error(`no command line for "${name}" yet.`
    + (known.length ? ` There is one for ${known.join(", ")}.` : ""));
  console.error("cli/README.md says what adding one takes.");
  process.exit(2);
}

const tool = await load(asked);

if (flags.help || (!words.length && !Object.keys(flags).length)) {
  console.log("\n" + tool.usage + "\n");
  process.exit(0);
}

/* The browser is not opened until a command has been understood, so a typo
   costs nothing and `--help` never launches anything. */
const open = () => drive(tool.page);

try {
  await tool.run({ words, flags, open });
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
}
