/* uncrop.html, from a terminal.

   A picture onto a bigger canvas, with the new border invented by an
   inpainting model — which is to say by the page, because this is the page.
   Nothing here places a rectangle or paints a pixel: the file goes in at the
   page's own file input, the page's own canvas fields and fill buttons are
   set, and the bytes its Save button would have handed you are written where
   `--out` says.

       node cli/run.mjs uncrop photo.jpg --canvas 2560x1440
       node cli/run.mjs uncrop photo.jpg --canvas 2560x1440 --out wide.png
       node cli/run.mjs uncrop photo.jpg --ratio 16:9 --fill reflect --out wide.tif

   The `--out` rules are image-compressor.html's, and the last of them lands
   somewhere worth knowing about here. On that page, opening a picture has
   already encoded it, so a bare command is a tally. On this one, opening a
   picture only shows you the figures — the canvas, how much of it is new, how
   many model passes that will take — and Uncrop is a separate press. So a
   bare command here is those figures and nothing else: no model is fetched,
   nothing is run, and nothing is written. `--out` is the press.

   Which also means the cheap thing is cheap. Working out whether a canvas is
   sensible, or which of the three warnings it earns, costs a browser launch
   and no download at all. */

import fs from "node:fs";
import path from "node:path";
import { number, oneOf, only } from "../lib/args.mjs";
import { bold, dim, emit, rows, wrap } from "../lib/out.mjs";

export const page = "uncrop.html";
export const summary = "a picture on a bigger canvas, with the new border "
  + "painted in by an inpainting model";

export const booleans = ["fit"];

const FILLS = ["fast", "best", "reflect"];
const FORMATS = ["png", "webp", "jpeg", "tiff"];

/* What an `--out` ending says about the format. Only the four the page can
   write; anything else says nothing and leaves the choice to `--format`. */
const BY_EXT = {
  png: "png", webp: "webp", jpg: "jpeg", jpeg: "jpeg", tif: "tiff", tiff: "tiff",
};

const FILL_NOTE = {
  fast: "MI-GAN, about 80 MB fetched on the first run",
  best: "LaMa, about 206 MB fetched on the first run",
  reflect: "no model: the edges mirrored outwards and melted into a blur",
};

export const usage = `a picture uncropped onto a bigger canvas, out of uncrop.html.

  node cli/run.mjs uncrop <picture> [options]
  node cli/run.mjs uncrop formats

The canvas

  --canvas <WxH>                the canvas to fill, as 2560x1440
  --width <px>  --height <px>   the same, one side at a time
  --ratio <W:H>                 keep the width and work the height out from
                                this shape, or "keep" for the picture's own
  --grow <n>                    the canvas as a multiple of the picture.
                                Left out, the page's own default of 1.25

Where the picture sits on it

  --scale <n>                   the picture's size as a multiple of its own
                                pixels; 1 is actual size, which is the default
  --fit                         scale it to fit the canvas instead
  --at <x,y>                    the picture's top-left corner on the canvas.
                                Left out, it is centred

The fill

  --fill ${FILLS.join("|")}      which fill. The page opens on fast:
                                ${FILL_NOTE.fast}.
                                best is ${FILL_NOTE.best}.
                                reflect needs no download and no connection
  --out <file>                  write the result here. The ending picks the
                                format — .png, .webp, .jpg or .tif — unless
                                --format says otherwise
  --out <dir>/                  write it into that directory, under the name
                                the page's own Save button would give it
  --format ${FORMATS.join("|")}      which format, whatever the ending says
  --quality <40-100>            for WebP and JPEG; the page's slider sits at
                                92, and 100 asks WebP for lossless. PNG and
                                TIFF ignore it

  --json                        the whole answer as JSON
  --help                        this

  formats                       what can be saved, and the limits of each

With no --out nothing is run and nothing is written: you get the canvas, how
much of it is new and how many model passes it would take, which is what the
page shows you before you press Uncrop. The first run of either model needs a
connection, for the runtime and the weights; reflect never does.`;

/* Where the file goes, and what that says about the format. A name ending in
   a slash, or one that is already a directory, means "in there" — and the
   name inside it is the page's own, which is not known until the page has
   made something, so that half waits. */
function destination(flags) {
  if (flags.out === undefined) return null;
  if (flags.out === true) {
    throw new Error("--out wants somewhere to write: a file, or a directory");
  }
  const asked = String(flags.out);
  const full = path.resolve(asked);
  const intoDir = /[\\/]$/.test(asked)
    || (fs.existsSync(full) && fs.statSync(full).isDirectory());
  if (intoDir) return { dir: full, file: null, format: null };
  const ext = path.extname(full).replace(/^\./, "").toLowerCase();
  return { dir: path.dirname(full), file: full, format: BY_EXT[ext] || null };
}

/* `--canvas 2560x1440`, and the two flags that say the same thing one side at
   a time. Both at once is refused rather than resolved in whichever order
   this file happens to read them. */
function canvas(flags) {
  const pair = flags.canvas;
  const one = flags.width !== undefined || flags.height !== undefined;
  if (pair !== undefined && one) {
    throw new Error("--canvas and --width/--height say the same thing — "
      + "use one or the other");
  }
  if (pair === undefined) {
    return {
      width: number(flags.width, "--width", { min: 1, max: 1e6 }),
      height: number(flags.height, "--height", { min: 1, max: 1e6 }),
    };
  }
  const said = String(pair).toLowerCase().replace(/×/g, "x");
  const bits = said.split("x");
  if (bits.length !== 2) {
    throw new Error(`--canvas wants a size like 2560x1440, not "${pair}"`);
  }
  return {
    width: number(bits[0], "--canvas width", { min: 1, max: 1e6 }),
    height: number(bits[1], "--canvas height", { min: 1, max: 1e6 }),
  };
}

function corner(flags) {
  if (flags.at === undefined) return {};
  if (flags.at === true) throw new Error("--at wants a corner, as x,y");
  const bits = String(flags.at).split(",");
  if (bits.length !== 2) {
    throw new Error(`--at wants a corner like 120,80, not "${flags.at}"`);
  }
  return {
    x: number(bits[0], "--at x", { min: -100000, max: 100000 }),
    y: number(bits[1], "--at y", { min: -100000, max: 100000 }),
  };
}

/* The picture goes in through the page's own file input, which is the path a
   dropped file takes. A file it will not open says so on screen rather than
   throwing, so that sentence is what comes back here. */
async function handIn(handle, file) {
  await handle.tab.setInputFiles("#file", file);
  await handle.tab.waitForFunction(
    () => window.CLI.jobs.image().ready
      || document.getElementById("loadNote").classList.contains("error"),
    null, { timeout: 60000 });
  const said = await handle.call("image", {});
  if (!said.ready) {
    throw new Error(await handle.tab.textContent("#loadNote")
      || `${path.basename(file)} would not open`);
  }
  return said;
}

const share = (n) => `${Math.round(n * 100)}%`;

function sides(gaps) {
  const said = [];
  if (gaps.left) said.push(`${gaps.left} left`);
  if (gaps.right) said.push(`${gaps.right} right`);
  if (gaps.top) said.push(`${gaps.top} top`);
  if (gaps.bottom) said.push(`${gaps.bottom} bottom`);
  return said.join(", ");
}

function readable(d, file, fill) {
  const p = d.plan;
  const lines = [
    "",
    `  ${bold(path.basename(file))}   ${dim(`${d.picture.width} × ${d.picture.height}`)}`,
    "",
    ...rows([
      ["canvas", `${p.width} × ${p.height}   ${dim(`${p.megapixels} MP`)}`],
      ["new", p.passes
        ? `${share(p.newShare)} of it   ${dim(sides(p.gaps))}`
        : dim("nothing — the picture covers the canvas")],
      ["passes", p.passes ? String(p.passes) : dim("none")],
      ["fill", `${fill}   ${dim(FILL_NOTE[fill])}`],
    ]),
  ];
  if (p.blocked || p.note) lines.push("", ...wrap(p.blocked || p.note));
  if (d.wrote) {
    const ran = { webgpu: "your GPU", wasm: "the CPU", mirror: "no model at all",
      crop: "nothing — it was a crop" }[d.ran] || d.ran;
    lines.push("", ...rows([
      ["ran on", ran],
      ["took", `${d.seconds}s`],
    ]), "", `  wrote ${bold(d.wrote)}`, "");
  } else {
    lines.push("", `  ${dim("nothing run and nothing written — --out <file> does it")}`, "");
  }
  return lines;
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;
  only(flags, ["out", "canvas", "width", "height", "ratio", "grow", "scale",
    "fit", "at", "fill", "format", "quality"]);

  if (words.length === 1 && words[0] === "formats") {
    const handle = await open();
    try {
      const said = await handle.call("formats", {});
      emit({ formats: said }, (d) => [
        "",
        ...rows(d.formats.map((f) => [f.name, `.${f.ext.padEnd(5)}`
          + (f.quality ? dim("  a quality slider") : dim("  lossless"))
          + (f.maxSide ? dim(`, up to ${f.maxSide} px a side`) : "")])),
        "",
        ...wrap("PNG is the lossless one that reads everywhere. TIFF is written "
          + "by the page itself, in strips with Deflate, for a big lossless "
          + "picture going into something that edits photographs. WebP at 100 "
          + "asks for lossless and is smaller; below that it is lossy, as JPEG "
          + "always is."),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  /* Everything a typo could be caught by happens before `open()`, so a bad
     flag never costs a browser launch. */
  const file = words[0];
  if (!file) {
    throw new Error("which picture? a path to an image file — or `formats` for "
      + "what can be saved");
  }
  if (words.length > 1) {
    throw new Error("the page uncrops one picture at a time, and "
      + `${words.length} were given`);
  }
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`no such file: ${file}`);
  if (fs.statSync(full).isDirectory()) throw new Error(`${file} is a directory`);

  const fill = oneOf(flags.fill === undefined ? undefined : String(flags.fill).toLowerCase(),
    "--fill", FILLS, "fast");
  const dest = destination(flags);
  const named = oneOf(
    flags.format === undefined ? undefined
      : String(flags.format).toLowerCase().replace(/^jpg$/, "jpeg").replace(/^tif$/, "tiff"),
    "--format", FORMATS, null);
  /* An ending that names one format and a `--format` that names another is a
     file that would lie about what is inside it. */
  if (named && dest && dest.format && dest.format !== named) {
    throw new Error(`--out ${path.basename(dest.file)} and --format ${named} `
      + "disagree about the format — drop one of them");
  }
  const format = named || (dest ? dest.format : null);

  const where = {
    ...canvas(flags),
    ...corner(flags),
    ratio: flags.ratio === undefined ? null
      : flags.ratio === true ? (() => { throw new Error("--ratio wants a shape like 16:9, or keep"); })()
        : String(flags.ratio),
    grow: number(flags.grow, "--grow", { min: 1, max: 40 }),
    scale: number(flags.scale, "--scale", { min: 0.01, max: 40 }),
    fit: !!flags.fit,
  };
  if (where.fit && where.scale !== null) {
    throw new Error("--fit and --scale both set the picture's size — use one");
  }
  const quality = number(flags.quality, "--quality", { min: 40, max: 100 });

  const handle = await open();
  try {
    /* `ready` is the page's own "have you got it yet" flag and is of no
       interest to anybody reading the answer. */
    const { ready, ...picture } = await handIn(handle, full);

    /* The plan comes back from the page whether or not anything is going to
       be run, because it is the page's own reading of the canvas and it is
       what carries the refusal when there is one. */
    const plan = await handle.call("plan", where);
    const answer = { picture, plan, fill, wrote: null };

    if (!dest) {
      if (plan.blocked) throw new Error(plan.blocked);
      emit(answer, (d) => readable(d, file, fill), asJson);
      return;
    }

    const said = await handle.call("run", {
      ...where, method: fill, format: format || undefined,
      quality: quality === null ? undefined : quality,
    });
    if (!said.bytes || !said.bytes.length) {
      throw new Error("the page came back with no file, so nothing was written");
    }
    const target = dest.file || path.join(dest.dir, said.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(said.bytes));
    const near = path.relative(process.cwd(), target);

    const { bytes, ...rest } = said;
    Object.assign(answer, rest, {
      plan: await handle.call("plan", where),
      wrote: near.startsWith("..") ? target : near,
    });
    emit(answer, (d) => readable(d, file, fill), asJson);
  } finally { await handle.close(); }
}
