/* color-picker.html, from a terminal.

   The page has six tabs and this has six commands, one each, plus a seventh
   that lists the thread charts so a name can be checked before it is asked
   for. None of them works a colour out: every answer comes back from the page
   through `window.CLI`, so a reading printed here is the reading shown there.

       node cli/run.mjs color-picker convert "#4f8fd0"
       node cli/run.mjs color-picker palette photo.jpg --count 6
       node cli/run.mjs color-picker contrast "#767676" white --fix fg
*/

import path from "node:path";
import fs from "node:fs";
import { number, oneOf } from "../lib/args.mjs";
import { bold, dim, emit, rows, swatch, wrap } from "../lib/out.mjs";

export const page = "color-picker.html";
export const summary = "colour conversions, palettes from a picture, contrast, "
  + "gradients, nearest thread and Pantone";

const RULES = ["dominant", "complementary", "split", "analogous", "triadic",
               "tetradic", "square", "monochromatic"];
const SPACES = ["srgb", "oklab", "oklch-longer"];
const SHAPES = ["linear", "radial", "conic"];

export const usage = `colour work from the command line, out of color-picker.html.

  node cli/run.mjs color-picker <command> [options]

Commands

  convert <colour>              every reading of one colour, and whether a
                                press can print it
    --cmyk straight|coated      which CMYK answer (default coated: the press
                                model, which is also the gamut test)
    --shades                    also the eleven-step ramp through it
    --harmony                   also the harmony strip off its hue

  palette <picture>             the colours that are actually in a picture
    --count <2-16>              how many; left out, the picture decides
    --rule <name>               ${RULES.slice(0, 4).join(", ")},
                                ${RULES.slice(4).join(", ")}
                                (default dominant, which is what the page's
                                own "Build a palette from this" asks for)
    --colour <colour>           grow the palette from a colour instead of a
                                picture, which needs no file

  pixel <picture> --at <x,y>    read one pixel, as the loupe does
    --sample 1|3|5|9            average that box around it (default 3)

  contrast <text> <background>  WCAG ratio, the four gradings, and APCA
    --fix text|background       walk that side to the nearest passing lightness

  gradient <colour> <colour>…   the CSS for a gradient through them
    --space ${SPACES.join("|")}
    --shape ${SHAPES.join("|")}
    --angle <0-360>             for a linear or conic one (default 90)
    --at <n,n,…>                stop positions in per cent, one per colour

  match <colour>                the nearest real thread and Pantone chip
    --count <n>                 how many of each (default 8)
    --chart <name>              one thread chart rather than all of them
    --book <name>               one Pantone book rather than both
    --find <text>               only codes or names containing this

  charts                        what there is to match against

Anywhere

  --json                        the whole answer as JSON instead of prose
  --help                        this`;

/* --fix takes the words the command line uses; the page calls the two sides
   fg and bg. */
const SIDES = { text: "fg", fg: "fg", background: "bg", bg: "bg" };

function picture(words, what) {
  const file = words[0];
  if (!file) throw new Error(`${what} needs a picture — a path to an image file`);
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`no such file: ${file}`);
  return full;
}

/* The picture goes in through the page's own file input, which is the path a
   dropped file takes, and then the page is given as long as it needs to
   decode it. */
async function handIn(handle, file) {
  await handle.tab.click("#tab-image");
  await handle.tab.setInputFiles("#file", file);
  await handle.tab.waitForFunction(() => {
    const said = window.CLI.image();
    return said.ready || /not an image|could not be decoded|will not let/.test(said.note);
  }, null, { timeout: 60000 });
  const said = await handle.tab.evaluate(() => window.CLI.image());
  if (!said.ready) throw new Error(said.note || `${path.basename(file)} would not decode`);
  return said;
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;
  const command = words.shift();

  if (!command) throw new Error("which command? `--help` lists them");

  if (command === "convert") {
    const colour = words[0];
    if (!colour) throw new Error("convert needs a colour: a hex, an rgb(), a keyword, anything CSS takes");
    const cmyk = oneOf(flags.cmyk, "--cmyk", ["straight", "coated"], "coated");
    const handle = await open();
    try {
      const said = await handle.call("convert", { color: colour, cmyk });
      emit(said, (d) => [
        "",
        `  ${swatch(d.hex)}${bold(d.hex)}`,
        "",
        ...rows([
          ["rgb", d.rgb], ["hsl", d.hsl], ["hsv", d.hsv],
          ["oklch", d.oklch], ["lab", d.lab], ["cmyk", d.cmyk], ["css", d.css],
        ]),
        "",
        ...wrap(d.gamut),
        ...(flags.shades ? ["", `  ${dim("shades")}`,
          "  " + d.shades.map((h) => swatch(h) + h).join(" ")] : []),
        ...(flags.harmony ? ["", `  ${dim("harmony")}`,
          ...d.harmony.map((h) => `  ${h.rule.padEnd(20)} `
            + h.colors.map((c) => swatch(c) + c).join(" "))] : []),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "palette") {
    const fromColour = flags.colour || flags.color;
    const count = number(flags.count, "--count", { min: 2, max: 16 });
    const rule = oneOf(flags.rule, "--rule", RULES, "dominant");
    const file = fromColour ? null : picture(words, "palette");
    const handle = await open();
    try {
      if (file) await handIn(handle, file);
      const said = await handle.call("palette", {
        from: file ? "image" : "current",
        color: fromColour === true ? null : fromColour,
        count, rule,
      });
      emit(said, (d) => [
        "",
        ...d.colors.map((c) => "  " + swatch(c.hex) + c.hex
          + (c.share != null ? dim(`  ${(c.share * 100).toFixed(1)}% of the picture`) : "")
          + (c.shades > 1 ? dim(`  ${c.shades} shades in it`) : "")
          + (c.turnedBy ? dim(`  turned ${c.turnedBy}° onto the rule`) : "")
          + (c.step ? dim(`  step ${c.step}`) : "")),
        "",
        ...wrap(d.note),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "pixel") {
    const file = picture(words, "pixel");
    const at = String(flags.at || "").split(/[ ,x]+/).filter(Boolean);
    if (at.length !== 2) throw new Error("pixel wants --at x,y");
    const sample = number(flags.sample, "--sample", { min: 1, max: 9 });
    if (sample !== null && ![1, 3, 5, 9].includes(sample)) {
      throw new Error("--sample is 1, 3, 5 or 9");
    }
    const handle = await open();
    try {
      await handIn(handle, file);
      const said = await handle.call("pixel", {
        x: Number(at[0]), y: Number(at[1]), sample,
      });
      emit(said, (d) => [
        "",
        `  ${swatch(d.hex)}${bold(d.hex)}  ${dim(`at ${d.at.x}, ${d.at.y} of `
          + `${d.picture.width} × ${d.picture.height}`
          + (d.sample > 1 ? `, averaged over ${d.sample} × ${d.sample}` : ""))}`,
        "",
        ...rows([["rgb", d.rgb], ["hsl", d.hsl], ["oklch", d.oklch], ["lab", d.lab]]),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "contrast") {
    const [fg, bg] = words;
    if (!fg || !bg) throw new Error("contrast needs two colours: the text, then the background");
    let fix = null;
    if (flags.fix) {
      fix = SIDES[String(flags.fix).toLowerCase()];
      if (!fix) throw new Error("--fix is text or background");
    }
    const handle = await open();
    try {
      const said = await handle.call("contrast", { fg, bg, fix });
      emit(said, (d) => [
        "",
        `  ${swatch(d.fg)}${d.fg} on ${swatch(d.bg)}${d.bg}`,
        `  ${bold(d.ratio.toFixed(2) + ":1")}  ${dim("WCAG 2")}     `
          + `${bold("Lc " + d.lc)}  ${dim("APCA")}`,
        "",
        ...d.grades.map((g) => `  ${g.pass ? "✓" : "✗"} ${g.what.padEnd(18)} `
          + dim(g.verdict)),
        "",
        ...wrap(d.apca),
        ...(d.fix ? ["", ...wrap(
          !d.fix.needed
            ? `Already over 4.5:1, so the ${d.fix.side === "fg" ? "text" : "background"} `
              + "was left where it is."
            : d.fix.moved
              ? `The ${d.fix.side === "fg" ? "text" : "background"} moved from `
                + `${d.fix.from} to ${d.fix.to} to clear 4.5:1.`
              : `No lightness of ${d.fix.from} reaches 4.5:1 against the other side.`)] : []),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "gradient") {
    if (words.length < 2) throw new Error("a gradient wants at least two colours");
    const space = oneOf(flags.space, "--space", SPACES, "oklab");
    const shape = oneOf(flags.shape, "--shape", SHAPES, "linear");
    const angle = number(flags.angle, "--angle", { min: 0, max: 360 });
    const at = flags.at
      ? String(flags.at).split(/[ ,]+/).filter(Boolean).map(Number)
      : null;
    if (at && at.length !== words.length) {
      throw new Error(`--at wants one position per colour: ${words.length} of them`);
    }
    const handle = await open();
    try {
      const said = await handle.call("gradient", {
        colors: words, at, space, shape, angle,
      });
      emit(said, (d) => [
        "",
        "  " + d.stops.map((s) => swatch(s.hex) + s.hex + dim(` ${s.pos}%`)).join("   "),
        "",
        ...d.css.split("\n").map((line) => "  " + line),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "match") {
    const colour = words[0];
    if (!colour) throw new Error("match needs a colour");
    const count = number(flags.count, "--count", { min: 1, max: 60 });
    const handle = await open();
    try {
      const said = await handle.call("match", {
        color: colour, count,
        chart: flags.chart === true ? null : flags.chart,
        book: flags.book === true ? null : flags.book,
        find: flags.find === true ? null : flags.find,
      });
      const wide = (list) => list.reduce((w, h) => Math.max(w, h.book.length), 0);
      const book = Math.max(wide(said.threads), wide(said.pantone));
      const hit = (h) => "  " + swatch(h.hex) + h.hex + "  "
        + (h.code + (h.name ? " " + h.name : "")).padEnd(30)
        + dim(h.book.padEnd(book) + `  ΔE ${h.de.toFixed(2)} — ${h.nearness}`);
      emit(said, (d) => [
        "",
        `  ${swatch(d.color)}${bold(d.color)}${d.find ? dim(`  only "${d.find}"`) : ""}`,
        "",
        `  ${dim("thread")}`,
        ...(d.threads.length ? d.threads.map(hit) : [`  ${dim("nothing matches")}`]),
        "",
        `  ${dim("pantone")}`,
        ...(d.pantone.length ? d.pantone.map(hit) : [`  ${dim("nothing matches")}`]),
        "",
        ...wrap(`${d.totals.threads.toLocaleString()} thread colours across `
          + `${d.totals.charts} charts and ${d.totals.pantone.toLocaleString()} `
          + `Pantone chips, ranked by CIEDE2000. Every value is an sRGB `
          + `approximation of a physical thread or ink: narrow a shortlist with `
          + `this, then hold the real card against it.`),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "charts") {
    const handle = await open();
    try {
      const said = await handle.call("charts", {});
      emit(said, (d) => [
        "",
        `  ${dim("thread charts")}`,
        ...rows(d.threads.map((b) => [b.name, `${b.fibre}, ${b.colors} colours`])),
        "",
        `  ${dim("pantone books")}`,
        ...rows(d.pantone.map((b) => [b.name, `${b.colors} chips`])),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  throw new Error(`no command called "${command}" — `
    + "convert, palette, pixel, contrast, gradient, match, charts");
}
