/* ruler.html, from a terminal.

   The page is a rule you hold things against, and that half plainly cannot
   come down a pipe: a terminal has no idea how dense a screen it is not
   looking at. What it can have is the arithmetic underneath — where every
   tick falls, what a length is in the other system, how many pixels an inch
   is on a screen of a given size — and that arithmetic is the page's own, so
   a figure printed here is a figure drawn there.

       node cli/run.mjs ruler screen
       node cli/run.mjs ruler ticks 30cm --finest 0.5mm
       node cli/run.mjs ruler ticks 12in --units imperial --dpi 113.5
       node cli/run.mjs ruler dial 8cm --degrees 5 --at 37.5
       node cli/run.mjs ruler convert 85.6mm

   `--dpi` is how a scale gets into a headless browser, and it means what the
   page's own box means: pixels to the inch on the page, at this zoom. With
   nothing said it is the 96 that CSS itself assumes, which is the page's own
   opening guess on anything that is not a handheld.

   Four flags are handed over as they were typed rather than checked here —
   `--units`, `--finest`, `--degrees` and `--zero`. Which divisions a scale
   has is the page's business, and `ruler ticks --finest 1/5` comes back with
   the list the page really has rather than a copy of it kept in Node. */

import { number } from "../lib/args.mjs";
import { only } from "../lib/args.mjs";
import { bold, dim, emit, rows, wrap } from "../lib/out.mjs";

export const page = "ruler.html";
export const summary = "where a rule's ticks fall and what a length is in the "
  + "other system, at a screen of whatever density";

export const usage = `the rule and the dial, out of ruler.html.

  node cli/run.mjs ruler <command> [options]

Commands

  screen                        what a browser will say about the screen it is
                                on, and the scale that follows from it. Run
                                headless it is saying it about a headless
                                browser, which is the point of --dpi
  ticks [<length>]              every tick on the straight rule, where it
                                falls and what it says. Default 30cm, or 12in
                                on the imperial scale
  dial [<radius>]               the same for the radial one: the degrees, the
                                rings and the scale along nought. Default
                                10cm, or 4in
  convert <length>              one length spelled every way the readout
                                under the rule spells it
  objects                       the real things the page offers to calibrate
                                against, and the size each one is made to

Options

  --units metric|imperial       which scale. Default metric
  --finest <division>           the smallest line on it: 5mm, 2mm, 1mm, 0.5mm,
                                or 1/4, 1/8, 1/16, 1/32. Default 1mm and 1/16
  --degrees 5|2|1               the smallest mark on the dial (dial only)
  --zero east|north             nought at the right counting anticlockwise, or
                                at the top counting clockwise (dial only)
  --at <degrees>                read the dial at this angle (dial only)
  --dpi <n>                     pixels to the inch on the page. Default 96,
                                which is what CSS assumes and what a screen
                                almost never is
  --diagonal <inches>           work the scale out from the screen's diagonal
                                instead, the way the page's own box does

Anywhere

  --json                        the whole answer, every tick of it
  --help                        this

A length is written as somebody would type it — 30cm, 300mm, 12in, 4ft — or
as a bare number, which means centimetres on the metric scale and inches on
the imperial one.`;

const KNOWN = ["units", "finest", "degrees", "zero", "at", "dpi", "diagonal"];

/* The scale, however it was asked for. Both of these are numbers here and
   nothing more: what counts as a screen is the page's limit, and it says so
   in its own words. */
function scaleFrom(flags) {
  const dpi = number(flags.dpi, "--dpi", { min: 1, max: 100000 });
  const diagonal = number(flags.diagonal, "--diagonal", { min: 0.1, max: 1000 });
  if (dpi !== null && diagonal !== null) {
    throw new Error("--dpi and --diagonal are two ways of saying the same "
      + "thing — give one of them");
  }
  if (diagonal !== null) return { diagonal };
  /* Nothing said leaves the page on its own scale rather than setting one,
     which headless is the same 96 either way — but it is the page saying so,
     and `screen` then reports where the figure came from truthfully. */
  return dpi === null ? {} : { dpi };
}

const asked = (flags) => ({
  units: flags.units,
  finest: flags.finest,
  ...scaleFrom(flags),
});

/* A column of figures with their pixel positions: the labelled ticks, which
   is what anybody reading a plan in prose is after. Every tick is in --json. */
function figures(plan) {
  const lit = plan.ticks.filter((t) => t.label !== null);
  const unit = plan.units === "metric" ? "cm" : "in";
  return rows(lit.map((t) => [`${t.label} ${unit}`,
    `${String(t.px).padStart(9)} px   ${dim(`${t.mm} mm`)}`]));
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;
  const command = words.shift();
  if (!command) throw new Error("which command? `--help` lists them");
  only(flags, KNOWN);

  if (command === "screen") {
    const handle = await open();
    try {
      const said = await handle.call("scale", scaleFrom(flags));
      emit(said, (d) => [
        "",
        ...rows([
          ["device pixel ratio", String(d.dpr)],
          ["screen, CSS px", `${d.cssWidth} × ${d.cssHeight}`],
          ["screen, device px", `${d.deviceWidth} × ${d.deviceHeight}`],
          ["reported resolution", d.reportedDpi === null
            ? dim("not answered")
            : `${d.reportedDpi} dpi   ${dim("the ratio × 96, and nothing more")}`],
          ["CSS reckons", `${d.cssAssumes} px to the inch`],
        ]),
        "",
        ...rows([
          ["this page", `${bold(String(d.cssPpi))} px to the inch   `
            + dim(`${d.pxPerMm} px to the mm`)],
          ["the screen itself", `${d.ppi} ppi`],
          ["which implies", `${d.impliedDiagonal} inches across the diagonal`],
          ["from", d.from],
        ]),
        "",
        ...wrap(dim("Headless, the first block is about a browser with no "
          + "screen behind it. The second is whatever --dpi or --diagonal "
          + "said, and the page on a real screen keeps its own.")),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "ticks") {
    if (words.length > 1) throw new Error("one length at a time");
    const handle = await open();
    try {
      const said = await handle.call("ticks", { ...asked(flags), length: words[0] });
      emit(said, (d) => [
        "",
        `  ${bold(`${d.lengthMm} mm`)} of ${d.units} rule, `
          + `down to ${d.finest}, at ${d.cssPpi} px to the inch`,
        "",
        ...figures(d),
        "",
        ...rows([
          ["ticks", String(d.ticks.length)],
          ["by rank", d.counts.map((n, i) => `${i}: ${n}`).join("   ")],
          ["smallest step", `${d.step} mm   ${dim(`${(d.step * d.pxPerMm).toFixed(3)} px`)}`],
          ["the whole rule", `${d.lengthPx} px`],
        ]),
        "",
        ...wrap(dim("Rank 0 is the tick that carries a figure and each rank "
          + "after it is a shorter line. --json has all of them.")),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "dial") {
    if (words.length > 1) throw new Error("one radius at a time");
    const handle = await open();
    try {
      const said = await handle.call("dial", {
        ...asked(flags),
        radius: words[0],
        degrees: flags.degrees,
        zero: flags.zero,
        at: number(flags.at, "--at", { min: -3600, max: 3600 }),
      });
      emit(said, (d) => [
        "",
        `  a dial of ${bold(`${d.radiusMm} mm`)} radius, marked every `
          + `${d.degrees}°, nought at the ${d.zero === "north" ? "top" : "right"} `
          + `counting ${d.turning}`,
        "",
        ...rows([
          ["degree marks", String(d.ticks.length)],
          ["figures", d.ticks.filter((t) => t.label !== null).length
            + dim(" — every 10°")],
          ["rings", `${d.rings.length}, one to the ${d.ring}`],
          ["scale along nought", `${d.scale.units}, down to ${d.scale.finest}`],
          ["the radius", `${d.radiusPx} px`],
        ]),
        ...(d.at ? ["", ...rows([
          ["at", `${bold(`${d.at.deg}°`)}   ${dim(`${d.at.radians} rad`)}`],
          ["the arm's tip", `${d.at.acrossMm} mm across, ${d.at.upMm} mm up`],
          ["the arm itself", `${d.at.arm.metric}   ${dim(d.at.arm.imperial)}`],
        ])] : []),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "convert") {
    if (!words.length) {
      throw new Error("convert needs a length: 30cm, 300mm, 12in, or a bare "
        + "number");
    }
    if (words.length > 1) throw new Error("one length at a time");
    const handle = await open();
    try {
      const said = await handle.call("convert", { ...asked(flags), length: words[0] });
      emit(said, (d) => [
        "",
        `  ${bold(d.asked)}`,
        "",
        ...rows([
          ["millimetres", String(d.mm)],
          ["centimetres", String(d.cm)],
          ["inches", String(d.inches)],
          ["as a rule says it", `${d.metric}   ${d.imperial}   `
            + dim(`to the nearest ${d.division}`)],
          ["pixels", `${d.px}   ${dim(`at ${d.cssPpi} px to the inch`)}`],
        ]),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (command === "objects") {
    const handle = await open();
    try {
      const said = await handle.call("objects", {});
      emit({ objects: said }, (d) => [
        "",
        ...rows(d.objects.map((o) => [o.name,
          `${String(o.mm).padStart(6)} mm   ${o.label}`
            + (o.round ? dim("  (across)") : "")])),
        "",
        ...d.objects.flatMap((o) => wrap(dim(`${o.name}: ${o.note}`), 72, "  ")),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  throw new Error(`no command called "${command}" — it is screen, ticks, `
    + "dial, convert or objects");
}
