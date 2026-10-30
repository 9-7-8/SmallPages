/* frutiger-orb.html, from a terminal.

   The glossy bubble, written where `--out` says. Nothing here draws anything:
   the page's own controls are set, the page's own canvas is read back, and
   the bytes the Save button would have handed you come out of the tab.

       node cli/run.mjs frutiger-orb
       node cli/run.mjs frutiger-orb --colour "#e04b3c" --out orb.png
       node cli/run.mjs frutiger-orb --canvas 4k --texture sky.jpg --opacity 70 --out wall.jpg

   The `--out` rules are image-compressor.html's, unchanged:

     --out <file>   written there, the ending picking the encoder
     --out <dir>/   written in there, under the page's own Save name
     no --out       nothing written, and you get the figures instead

   The page has no "just do it" button to copy, because it draws an orb the
   moment it opens and every control is a tuning of that one. So a command
   with nothing set is the page exactly as it opens: the guide's own blue, on
   a 1000-pixel square, on white. (`run.mjs` answers a command with no
   arguments *and* no flags with this help, which is the same for every tool
   here, so the nearest thing to a bare run is `--json` on its own.) */

import fs from "node:fs";
import path from "node:path";
import { number, only } from "../lib/args.mjs";
import { bold, dim, emit, rows, swatch, wrap } from "../lib/out.mjs";

export const page = "frutiger-orb.html";
export const summary = "a Frutiger Aero orb in any colour, over any texture, as "
  + "a PNG, JPEG or WebP";

/* Flags that take no value, so they do not swallow the word after them. */
export const booleans = ["transparent"];

const TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

const FLAGS = [
  "out", "format", "quality", "canvas", "width", "height", "colour", "color",
  "opacity", "size", "background", "transparent", "texture", "texture-blur",
  "highlight", "highlight-width", "highlight-height", "highlight-top",
  "highlight-fade", "highlight-blur", "bloom", "bloom-size", "bloom-drop",
  "bloom-blur", "blend",
];

export const usage = `a Frutiger Aero orb, out of frutiger-orb.html.

  node cli/run.mjs frutiger-orb [options]
  node cli/run.mjs frutiger-orb sizes

The orb

  --colour <hex>                the colour it is, as #1a7ae0. --color too.
                                A fully saturated one is drawn and remarked
                                on rather than refused, as on the page
  --opacity <0-100>             how much of what is behind shows through the
                                finished orb; 100
  --size <10-100>               how much of the shorter side it takes up; 80

The canvas

  --canvas <name>               1920x1080, or a preset — tutorial, icon,
                                1080p, 1440p, 4k, phone, portrait. The page
                                resolves it, so \`sizes\` lists the ones there are
  --width <px> --height <px>    the two numbers instead, 64 to 16384

Behind it

  --background <hex>            the colour behind the orb; #ffffff
  --transparent                 no colour behind it. A texture, if there is
                                one, still is: this turns off the colour layer
                                and nothing else. A JPEG has no transparency,
                                so for one of those it is ignored altogether
                                and --background is used instead
  --texture <file>              a picture behind it, cropped to cover
  --texture <none>              no picture, which is the No texture button
  --texture-blur <0-100>        blur it, and nothing else; 0

The highlight — step two and three of the guide

  --highlight <0-100>           how white the reflection is; 95
  --highlight-width <10-100>    its width, as a share of the orb; 72
  --highlight-height <5-100>    its height, the same way; 48
  --highlight-top <0-40>        how far below the orb's top edge it sits; 3
  --highlight-fade <10-250>     how far down the mask takes it to nothing,
                                as a share of its own height; 150
  --highlight-blur <0-20>       how soft its edge is; 1

The bloom — step four, five and six

  --bloom <0-100>               how strong the blurred circle in the bottom
                                is; 100
  --bloom-size <5-150>          its radius against the orb's; 55
  --bloom-drop <-100-150>       how far below the middle it sits; 48
  --bloom-blur <0-40>           how far it is blurred, as a share of the orb,
                                so the same number is the same orb at any
                                size; 7
  --blend <mode>                how it mixes: overlay, screen, soft-light,
                                hard-light, color-dodge, source-over. The page
                                refuses one it has not got, with the list

The file

  --out <file>                  write it here. The ending picks the encoder —
                                .png, .jpg or .webp — unless --format says
  --out <dir>/                  write it in there, under the page's own name
  --format png|jpeg|webp        which encoder, whatever the ending says
  --quality <20-100>            for JPEG and WebP; 92. PNG ignores it

  --json                        the whole thing as JSON
  --help                        this

With no --out nothing is written: you get the figures — the orb's diameter in
pixels, how saturated the colour is, where the highlight and the bloom landed
— which is what the page shows you under the canvas before you press Save.`;

/* Where the file goes, and what the name says about the format. A name ending
   in a slash, or one that is already a directory, means "in there"; the name
   inside it is the page's own and is not known until it has drawn something,
   so that half waits. The same three rules image-compressor.html settled. */
function destination(flags) {
  if (flags.out === undefined) return null;
  if (flags.out === true) {
    throw new Error("--out wants somewhere to write: a file, or a directory");
  }
  const asked = String(flags.out);
  const full = path.resolve(asked);
  const intoDir = /[\\/]$/.test(asked)
    || (fs.existsSync(full) && fs.statSync(full).isDirectory());
  if (intoDir) return { dir: full, file: null, type: null };
  const ext = path.extname(full).replace(/^\./, "").toLowerCase();
  return { dir: path.dirname(full), file: full, type: BY_EXT[ext] || null };
}

function colour(value, what) {
  if (value === undefined) return null;
  if (value === true) throw new Error(`${what} wants a hex colour like #ff8800`);
  const said = String(value).trim();
  if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(said)) {
    throw new Error(`${what} wants a hex colour like #ff8800, not "${value}"`);
  }
  return said.startsWith("#") ? said : `#${said}`;
}

/* What `--texture` was: a file to hand in, or the No texture button. A path is
   tried as a path first, so a file literally called `none` still works. */
function wantTexture(flags) {
  if (flags.texture === undefined) return null;
  if (flags.texture === true) {
    throw new Error("--texture wants a picture to put behind the orb, or `none`");
  }
  const said = String(flags.texture);
  const full = path.resolve(said);
  if (fs.existsSync(full)) {
    if (fs.statSync(full).isDirectory()) {
      throw new Error(`${said} is a directory — the page takes one picture`);
    }
    return { kind: "file", file: full };
  }
  if (/^(none|no|off)$/i.test(said)) return { kind: "none" };
  throw new Error(`no such file: ${said} — and it is not \`none\``);
}

/* The picture goes in through the page's own file input, which is the path a
   dropped file takes. The page draws when it has it, so the wait is for the
   render count to go up rather than for `ready`, which was already true for
   the orb that was on the canvas before this. */
async function handIn(handle, file) {
  const before = (await handle.tab.evaluate(() => window.CLI.image())).renders;
  await handle.tab.setInputFiles("#textureFile", file);
  await handle.tab.waitForFunction((was) => {
    const said = window.CLI.image();
    return said.failed || (said.renders > was && said.texture);
  }, before, { timeout: 60000 });
  const said = await handle.tab.evaluate(() => window.CLI.image());
  if (!said.texture) {
    throw new Error(said.note || `${path.basename(file)} would not open`);
  }
  return said;
}

/* The one listing. It asks the page rather than holding a copy of the answer,
   which is the only reason a preset added to the page turns up here without
   anybody editing this file. */
async function listing(open, asJson) {
  const handle = await open();
  try {
    const said = await handle.call("sizes", {});
    emit(said, (d) => [
      "",
      ...rows(d.sizes.map((s) => [s.name,
        `${s.group.padEnd(8)} ${dim(s.note || "")}`
          + (s.alias ? `  ${bold(s.alias)}` : "")])),
      "",
      ...wrap(`Or any two numbers. A canvas past ${d.limits.maxSide} pixels on a `
        + `side, or past ${d.limits.maxArea} pixels of area, is more than a `
        + "browser will paint, so it comes down to fit and the page says so."),
      "",
      ...rows(d.formats.map((f) => [f.name.toLowerCase(),
        `.${f.ext.padEnd(5)} ${dim(f.note)}`])),
      "",
      ...rows(d.blends.map((b) => [b.name,
        dim(b.label) + (b.default ? `  ${bold("— the default")}` : "")])),
      "",
      `  ${d.colours.map((hex) => swatch(hex)).join("")}  ${dim(d.colours.join(" "))}`,
      "",
    ], asJson);
  } finally { await handle.close(); }
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;

  if (words.length === 1 && words[0] === "sizes" && flags.out === undefined) {
    await listing(open, asJson);
    return;
  }

  /* Everything a typo could be caught by happens before `open()`, so a bad
     flag never costs a browser launch. */
  only(flags, FLAGS);

  if (words.length) {
    throw new Error(`the orb is made from flags alone, and ${words.join(" ")} `
      + "is not one — `sizes` is the only word this takes");
  }
  if (flags.canvas === true) {
    throw new Error("--canvas wants a size: 1920x1080, or a preset name "
      + "(`sizes` lists them)");
  }
  if (flags.canvas !== undefined
      && (flags.width !== undefined || flags.height !== undefined)) {
    throw new Error("--canvas and --width/--height both say how big — "
      + "give one or the other");
  }
  if (flags.blend === true) {
    throw new Error("--blend wants a mode (`sizes` lists them)");
  }
  /* The format names are this file's, but the blend modes and the canvas
     presets are not: those are the page's own lists and the page answers for
     them, so a typo comes back with the names it really has. */
  const named = flags.format === undefined ? null
    : String(flags.format).toLowerCase().replace(/^image\//, "").replace(/^jpg$/, "jpeg");
  if (named !== null && !Object.hasOwn(TYPES, named)) {
    throw new Error(`--format is ${Object.keys(TYPES).join(", ")} — not "${flags.format}"`);
  }

  const dest = destination(flags);
  /* An ending naming one format and a `--format` naming another is a file
     that would lie about what is inside it, so it is refused. */
  if (named && dest && dest.type && dest.type !== TYPES[named]) {
    throw new Error(`--out ${path.basename(dest.file)} and --format ${named} `
      + "disagree about the format — drop one of them");
  }

  const texture = wantTexture(flags);

  const asked = {
    canvas: flags.canvas === undefined ? null : String(flags.canvas),
    width: number(flags.width, "--width", { min: 64, max: 16384 }),
    height: number(flags.height, "--height", { min: 64, max: 16384 }),
    colour: colour(flags.colour !== undefined ? flags.colour : flags.color, "--colour"),
    opacity: number(flags.opacity, "--opacity", { min: 0, max: 100 }),
    size: number(flags.size, "--size", { min: 10, max: 100 }),
    background: colour(flags.background, "--background"),
    transparent: flags.transparent ? true : null,
    textureBlur: number(flags["texture-blur"], "--texture-blur", { min: 0, max: 100 }),
    highlight: number(flags.highlight, "--highlight", { min: 0, max: 100 }),
    highlightWidth: number(flags["highlight-width"], "--highlight-width", { min: 10, max: 100 }),
    highlightHeight: number(flags["highlight-height"], "--highlight-height", { min: 5, max: 100 }),
    highlightTop: number(flags["highlight-top"], "--highlight-top", { min: 0, max: 40 }),
    highlightFade: number(flags["highlight-fade"], "--highlight-fade", { min: 10, max: 250 }),
    highlightBlur: number(flags["highlight-blur"], "--highlight-blur", { min: 0, max: 20 }),
    bloom: number(flags.bloom, "--bloom", { min: 0, max: 100 }),
    bloomSize: number(flags["bloom-size"], "--bloom-size", { min: 5, max: 150 }),
    bloomDrop: number(flags["bloom-drop"], "--bloom-drop", { min: -100, max: 150 }),
    bloomBlur: number(flags["bloom-blur"], "--bloom-blur", { min: 0, max: 40 }),
    blend: flags.blend === undefined ? null : String(flags.blend),
    format: named ? TYPES[named] : (dest ? dest.type : null),
    quality: number(flags.quality, "--quality", { min: 20, max: 100 }),
    bytes: !!dest,
  };
  /* Anything not asked for is left out entirely rather than sent as a null,
     so the page sees "say nothing about this" and leaves its own control
     alone — which is what makes every default here the page's default. */
  for (const key of Object.keys(asked)) if (asked[key] == null) delete asked[key];

  const handle = await open();
  try {
    if (texture && texture.kind === "file") await handIn(handle, texture.file);
    if (texture && texture.kind === "none") await handle.call("clearTexture", {});

    const said = await handle.call("make", asked);

    let wrote = null;
    if (dest) {
      /* The bytes came out of the tab one number at a time; a short array
         would otherwise be written as a truncated file that still opens. */
      if (!said.bytes || said.bytes.length !== said.fileBytes) {
        throw new Error(`the page sent ${said.bytes ? said.bytes.length : 0} `
          + `bytes back for a ${said.fileBytes}-byte file, so nothing was written`);
      }
      const target = dest.file || path.join(dest.dir, said.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(said.bytes));
      const near = path.relative(process.cwd(), target);
      wrote = near.startsWith("..") ? target : near;
    }

    /* Nobody wants a megabyte of numbers printed, in prose or as JSON. */
    const { bytes, ...answer } = said;
    answer.wrote = wrote;

    emit(answer, (d) => {
      const out = [
        "",
        ...rows([
          ["canvas", `${d.width}×${d.height}`
            + (d.capped ? dim(`  (asked for ${d.asked.width}×${d.asked.height})`) : "")],
          ["orb", `${Math.round(d.diameter)} px across  ${dim(d.size + "% of the shorter side")}`],
          ["colour", `${swatch(d.base)}${d.base}  ${dim(d.saturation + "% saturated")}`],
          ["opacity", `${d.opacity}%`],
          /* The texture is drawn over the colour, so a canvas with one on it
             has a picture behind the orb whatever the transparent box says —
             which only turns the colour layer off. Saying "nothing" here
             because the box is ticked would be describing the wrong canvas. */
          ["behind", d.texture
            ? `${d.texture.name}  ${dim(d.texture.width + "×" + d.texture.height
                + (d.textureBlur ? ", blurred " + d.textureBlur : ""))}`
            : (d.transparent ? dim("nothing — transparent")
              : `${swatch(d.background)}${d.background}`)],
          ["highlight", `${d.highlight.strength}%  `
            + dim(`${Math.round(d.highlight.width)}×${Math.round(d.highlight.height)} px, `
              + `fading over ${Math.round(d.highlight.fade)}`)],
          ["bloom", `${d.bloom.strength}% on ${d.bloom.blend}  `
            + dim(`r${Math.round(d.bloom.radius)} px, blurred ${Math.round(d.bloom.blur)}`)],
          ["format", d.quality == null ? d.format : `${d.format}  ${dim("quality " + d.quality)}`],
        ]),
      ];
      if (d.capped) {
        out.push("", ...wrap(`${d.asked.width}×${d.asked.height} is past what a `
          + `browser will paint, so the canvas came down to ${d.width}×${d.height}.`));
      }
      if (d.transparentAsked && !d.transparent) {
        out.push("", ...wrap(`A ${d.format} has no transparency, so the orb was `
          + `flattened onto ${d.background} instead.`));
      }
      if (d.flat) {
        out.push("", ...wrap("That colour is fully saturated, which the guide this "
          + "page follows warns against: there is nowhere left to brighten into, "
          + "so the highlight flattens against it."));
      }
      out.push("",
        d.wrote ? `  wrote ${bold(d.wrote)}`
          : `  ${dim("nothing written — --out <file> saves it")}`,
        "");
      return out;
    }, asJson);
  } finally { await handle.close(); }
}
