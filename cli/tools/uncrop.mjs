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
       node cli/run.mjs uncrop covers/ --left 15%h --out wider/

   Several pictures, or a folder of them, are a batch: the page is opened and
   the model loaded once, and each picture goes through the page's own file
   input in turn with the same flags. The border flags (`--left 15%`) are
   handed over as typed, like `--canvas`, because what a share of a picture
   comes to is the page's arithmetic and not this file's.

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

export const booleans = ["fit", "swap"];

const FILLS = ["best", "fast", "reflect"];
const SIDES = ["left", "right", "top", "bottom"];

/* What a folder in a batch contributes: the files a browser can open as a
   picture, by their ending. What this command wrote last time is left out,
   so a batch whose --out is its own folder can be run twice. */
const PICTURE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const OURS = /-(uncropped|what-was-added)(-\d+x\d+)?(-\d+)?\.[a-z]+$/i;
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
  node cli/run.mjs uncrop <picture> <picture> … | <folder> [options] --out <dir>/
  node cli/run.mjs uncrop sizes
  node cli/run.mjs uncrop formats

  node cli/run.mjs uncrop cover.jpg --left 15%h --out cover-wide.png
  node cli/run.mjs uncrop covers/ --left 15%h --out wider/

The fill is LaMa, the page's best model, unless --fill says otherwise.

A border on each side — the direct way to add a strip

  --left <n|n%>  --right <n|n%>  --top <n|n%>  --bottom <n|n%>
                                pixels, or a share of the picture: a % is of
                                its width on the left and right and of its
                                height on the top and bottom; 15%w or 15%h
                                says which. The canvas grows to fit and the
                                picture sits where the borders leave it, so
                                --left 74 is a 74 px strip down the left and
                                --left 15%h a strip 15% of the picture's
                                height wide. A side left out gets none. These
                                are the page's four Add fields, and stand in
                                for --canvas, --ratio, --grow, --align and --at

Several pictures at once

  Name several, or a folder (its pictures, not its sub-folders), and they are
  a batch: the page and the model are loaded once and every picture gets the
  same flags. --out is then a directory, and each is written there as
  <its name>-uncropped.<ext>, which is the name the page's own batch gives it.
  Each picture is reported as it goes, and a total at the end; one that fails
  is named and the rest still run.

The canvas

  --canvas <WxH|name>           the canvas to fill, as 2560x1440 — or the name
                                of one of the page's own sizes, which
                                \`uncrop sizes\` lists
  --width <px>  --height <px>   the same, one side at a time
  --ratio <W:H>                 keep the width and work the height out from
                                this shape, or "keep" for the picture's own
  --grow <n>                    the canvas as a multiple of the picture, so
                                --grow 2 leaves half the canvas to invent.
                                Left out, the canvas is the picture's own size,
                                which is what the page opens on
  --swap                        swap the two sides over, the page's Swap button

Where the picture sits on it

  --scale <n>                   the picture's size as a multiple of its own
                                pixels; 1 is actual size, which is the default
  --fit                         scale it to fit the canvas instead
  --align <where>               put the picture against a corner or an edge:
                                "top left", "bottom-right", "left", "centre".
                                These are the nine buttons on the page
  --at <x,y>                    or its top-left corner outright, in canvas
                                pixels. Left out, the picture is centred

The fill

  --fill ${FILLS.join("|")}      which fill. The page opens on best:
                                ${FILL_NOTE.best}.
                                fast is ${FILL_NOTE.fast},
                                quicker and visibly rougher.
                                reflect needs no download and no connection.
                                The weights are kept in a browser profile
                                between runs, so only the first run fetches
                                them; a run that fails on the GPU carries on
                                on the CPU by itself and says so

Saving

  --out <file>                  write the result here. The ending picks the
                                format — .png, .webp, .jpg or .tif — unless
                                --format says otherwise
  --out <dir>/                  write it into that directory, under the name
                                the page's own Save button would give it;
                                for a batch, the only kind of --out there is
  --show-added <file|dir/>      write a second copy with the invented border
                                dimmed and a dashed line round what you
                                brought, which is the page's own
                                "Show what was added"
  --format ${FORMATS.join("|")}      which format, whatever the ending says
  --quality <40-100>            for WebP and JPEG; the page's slider sits at
                                92, and 100 asks WebP for lossless. PNG and
                                TIFF ignore it

  --json                        the whole answer as JSON
  --help                        this

  sizes                         the canvas sizes and shapes the page offers
  formats                       what can be saved, and the limits of each

With neither --out nor --show-added nothing is run and nothing is written: you
get the canvas, how much of it is new and how many model passes it would take,
which is what the page shows you before you press Uncrop. The first run of
either model needs a connection, for the runtime and the weights; reflect
never does.`;

/* Where a file goes, and what that says about the format. A name ending in
   a slash, or one that is already a directory, means "in there" — and the
   name inside it is the page's own, which is not known until the page has
   made something, so that half waits. */
function destination(flags, which = "out", batch = false) {
  if (flags[which] === undefined) return null;
  if (flags[which] === true) {
    throw new Error(`--${which} wants somewhere to write: a file, or a directory`);
  }
  const asked = String(flags[which]);
  const full = path.resolve(asked);
  const ext = path.extname(full).replace(/^\./, "").toLowerCase();
  /* A batch writes several files, so its --out is a directory whether or not
     it ends in a slash — except that a name ending in a picture's ending was
     meant as one file, and saying so beats making a folder called wide.png. */
  if (batch) {
    if (BY_EXT[ext] && !(fs.existsSync(full) && fs.statSync(full).isDirectory())) {
      throw new Error(`a batch writes a file per picture, so --${which} has to be a directory`
        + ` — not ${path.basename(full)}. Each is named <its name>-uncropped.<ext> inside it`);
    }
    return { dir: full, file: null, format: null };
  }
  const intoDir = /[\\/]$/.test(asked)
    || (fs.existsSync(full) && fs.statSync(full).isDirectory());
  if (intoDir) return { dir: full, file: null, format: null };
  return { dir: path.dirname(full), file: full, format: BY_EXT[ext] || null };
}

/* The four Add fields. Handed to the page as typed, because what 15% of a
   picture comes to is the page's arithmetic; only the shape is looked at
   here, so a typo costs no browser launch. */
function borders(flags) {
  const given = SIDES.filter((s) => flags[s] !== undefined);
  if (!given.length) return null;
  const out = {};
  for (const side of given) {
    const said = flags[side] === true ? "" : String(flags[side]).trim();
    if (!/^\d+(\.\d+)?\s*(px|%|%w|%h)?$/i.test(said)) {
      throw new Error(`--${side} wants pixels like 40, or a share of the picture like 15%,`
        + ` 15%w or 15%h — not "${flags[side] === true ? "" : flags[side]}"`);
    }
    out[side] = said;
  }
  const clash = ["canvas", "width", "height", "ratio", "grow", "swap", "fit", "align", "at"]
    .find((f) => flags[f] !== undefined);
  if (clash) {
    throw new Error(`--${given[0]} sets the canvas and where the picture sits on it, and so`
      + ` does --${clash} — use one or the other`);
  }
  return out;
}

/* The pictures a command names: files as they are, a folder as the pictures
   in it, in name order with the numbers in names counted as numbers. */
function pictures(words) {
  const files = [];
  let folders = 0;
  for (const w of words) {
    const full = path.resolve(w);
    if (!fs.existsSync(full)) throw new Error(`no such file: ${w}`);
    if (fs.statSync(full).isDirectory()) {
      folders++;
      const inside = fs.readdirSync(full)
        .filter((n) => PICTURE_EXT.test(n) && !OURS.test(n))
        .map((n) => path.join(full, n))
        .filter((p) => fs.statSync(p).isFile())
        .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined,
          { numeric: true, sensitivity: "base" }));
      if (!inside.length) {
        throw new Error(`${w} has no pictures in it — a folder is read for .png, .jpg, .webp,`
          + " .gif, .bmp and .avif files, leaving out ones this command wrote");
      }
      files.push(...inside);
    } else {
      files.push(full);
    }
  }
  return { files, batch: files.length > 1 || folders > 0 };
}

/* `--canvas` is handed to the page as it was typed, because what a canvas
   size may be is the page's business: it is two numbers, or the name on one
   of the page's own preset buttons, and `uncrop sizes` lists those by asking
   the page rather than by keeping a copy of them here. Only the shape of the
   thing is checked before a browser is launched, which is enough to catch a
   flag that was meant to be something else.

   `--width` and `--height` say the same thing one side at a time. Both ways
   at once is refused rather than resolved in whichever order this file
   happens to read them. */
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
  const said = String(pair);
  if (pair === true || !/^[\w .×x-]+$/i.test(said)) {
    throw new Error("--canvas wants a size like 2560x1440, or the name of one of"
      + ` the page's own — \`uncrop sizes\` lists them`);
  }
  return { size: said };
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
  /* In a batch the page already holds the picture before, so the wait is for
     another one to have opened rather than for one to be there — and the
     last picture's complaint, if it had one, is cleared first so that it
     cannot be read as this one's. Clearing the input also means the same
     file twice still fires a change. */
  const before = await handle.tab.evaluate(() => {
    document.getElementById("file").value = "";
    document.getElementById("loadNote").classList.remove("error");
    return window.CLI.jobs.image().loads || 0;
  });
  await handle.tab.setInputFiles("#file", file);
  await handle.tab.waitForFunction(
    (n) => window.CLI.jobs.image().loads > n
      || document.getElementById("loadNote").classList.contains("error"),
    before, { timeout: 60000 });
  const said = await handle.call("image", {});
  if (!said.ready || said.loads <= before) {
    throw new Error(await handle.tab.textContent("#loadNote")
      || `${path.basename(file)} would not open`);
  }
  return said;
}

/* Rounded, but never rounded all the way to none or all: a picture that is a
   thousandth of the canvas still leaves 99% new rather than 100, and the
   figures line on the page follows the same rule. */
const share = (n) => {
  const pct = Math.round(n * 100);
  if (pct === 100 && n < 1) return "99%";
  if (pct === 0 && n > 0) return "under 1%";
  return `${pct}%`;
};

function sides(gaps) {
  const said = [];
  if (gaps.left) said.push(`${gaps.left} left`);
  if (gaps.right) said.push(`${gaps.right} right`);
  if (gaps.top) said.push(`${gaps.top} top`);
  if (gaps.bottom) said.push(`${gaps.bottom} bottom`);
  return said.join(", ");
}

function ranOn(d) {
  const ran = { webgpu: "your GPU", wasm: "the CPU", mirror: "no model at all",
    crop: "nothing — it was a crop" }[d.ran] || d.ran;
  return d.fellBack ? `${ran}, because it failed on your GPU   ${dim(d.fellBack)}` : ran;
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
  if (d.wrote || d.marked) {
    lines.push("", ...rows([
      ["ran on", ranOn(d)],
      ["took", `${d.seconds}s`],
    ]), "");
    if (d.wrote) lines.push(`  wrote ${bold(d.wrote)}`);
    if (d.marked) lines.push(`  and ${bold(d.marked)}, with what was added marked on it`);
    lines.push("");
  } else {
    lines.push("", `  ${dim("nothing run and nothing written — --out <file> does it")}`, "");
  }
  return lines;
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;
  only(flags, ["out", "show-added", "canvas", "width", "height", "ratio", "grow",
    "scale", "fit", "swap", "align", "at", "fill", "format", "quality", ...SIDES]);

  if (words.length === 1 && words[0] === "sizes") {
    const handle = await open();
    try {
      const said = await handle.call("sizes", {});
      emit(said, (d) => [
        "",
        ...rows(d.sizes.map((f) => {
          const plain = f.label.replace(/[^0-9]/g, "") === f.name.replace(/[^0-9]/g, "");
          return [f.name, plain ? dim(`${f.width} × ${f.height}`) : f.label];
        })),
        "",
        ...wrap("Any of those is a --canvas, by its figures or by its name, and so is"
          + " any other size: --canvas 3000x2000. The shapes below are --ratio, which"
          + " keeps the width the canvas already has and works the height out from it."),
        "",
        ...rows(d.shapes.map((f) => [f.name, dim(f.label)])),
        "",
        ...wrap("With no canvas given at all it is the picture's own size, which is"
          + " what the page opens on and which leaves nothing to invent until you"
          + " make it bigger: --canvas, --ratio or --grow."),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

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
  if (!words.length) {
    throw new Error("which picture? a path to an image file, several, or a folder of them"
      + " — or `formats` for what can be saved");
  }
  const { files, batch } = pictures(words);

  const fill = oneOf(flags.fill === undefined ? undefined : String(flags.fill).toLowerCase(),
    "--fill", FILLS, "best");
  const dest = destination(flags, "out", batch);
  const marks = destination(flags, "show-added", batch);
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

  const edges = borders(flags);
  const where = edges ? { sides: edges, scale: number(flags.scale, "--scale", { min: 0.01, max: 40 }) } : {
    ...canvas(flags),
    ...corner(flags),
    align: flags.align === undefined ? null
      : flags.align === true
        ? (() => { throw new Error('--align wants a corner or an edge, like "top left"'); })()
        : String(flags.align),
    swap: !!flags.swap,
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
  if (where.align && (where.x !== undefined || where.y !== undefined)) {
    throw new Error("--align and --at both say where the picture goes — use one");
  }
  const quality = number(flags.quality, "--quality", { min: 40, max: 100 });

  /* The bytes came out of the tab one number at a time, so a short array
     would otherwise be written as a truncated file that still opens. In a
     batch two pictures can share a name across two folders, and the second
     is numbered rather than written over the first. */
  const taken = new Set();
  const put = (where2, got) => {
    if (!got.bytes || !got.bytes.length) {
      throw new Error("the page came back with no file, so nothing was written");
    }
    let target = where2.file || path.join(where2.dir, got.name);
    if (batch) {
      for (let n = 2; taken.has(target.toLowerCase()); n++) {
        target = path.join(where2.dir, got.name.replace(/(\.[^.]+)$/, `-${n}$1`));
      }
      taken.add(target.toLowerCase());
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(got.bytes));
    const near = path.relative(process.cwd(), target);
    return near.startsWith("..") ? target : near;
  };

  /* One picture, start to finish: in through the file input, the page's plan
     for it, and — with somewhere to write — the page's run and its Save. */
  const one = async (handle, file) => {
    /* `ready` and `loads` are the page's own "have you got it yet" and are of
       no interest to anybody reading the answer. */
    const { ready, loads, ...picture } = await handIn(handle, file);

    /* The plan comes back from the page whether or not anything is going to
       be run, because it is the page's own reading of the canvas and it is
       what carries the refusal when there is one. */
    const plan = await handle.call("plan", where);
    const answer = { picture, plan, fill, wrote: null };
    if (!dest && !marks) {
      if (plan.blocked) throw new Error(plan.blocked);
      return answer;
    }

    const said = await handle.call("run", {
      ...where, method: fill, format: format || undefined,
      quality: quality === null ? undefined : quality, batch,
    });
    const wrote = dest ? put(dest, said) : null;
    /* The marked-up copy is the page's own *Show what was added*, drawn at the
       size of the picture rather than the size of the panel. It follows the
       run, because it marks up what the run just made. */
    let marked = null;
    if (marks) {
      marked = put(marks, await handle.call("marked", {
        format: format || undefined,
        quality: quality === null ? undefined : quality, batch,
      }));
    }
    const { bytes, ...rest } = said;
    return Object.assign(answer, rest, { plan: await handle.call("plan", where), wrote, marked });
  };

  if (!batch) {
    const handle = await open();
    try {
      const answer = await one(handle, files[0]);
      emit(answer, (d) => readable(d, files[0], fill), asJson);
    } finally { await handle.close(); }
    return;
  }

  /* A batch. The page is opened once, so a model is fetched and started
     once, and every picture is the same flags handed to the same page. Each
     one is said as it finishes, because a batch of LaMa runs is minutes and
     a terminal that is silent for minutes looks hung; the JSON is the whole
     run at the end. A picture that fails is named and the rest carry on. */
  const started = Date.now();
  const results = [];
  const handle = await open();
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const shown = path.relative(process.cwd(), file).startsWith("..")
        ? file : path.relative(process.cwd(), file);
      let got;
      try {
        got = { file: shown, ...(await one(handle, file)) };
      } catch (e) {
        got = { file: shown, error: String(e.message || e) };
      }
      results.push(got);
      if (!asJson) console.log(progressLine(got, i, files.length));
    }
  } finally { await handle.close(); }

  const failed = results.filter((r) => r.error).length;
  const total = {
    pictures: results.length,
    written: results.filter((r) => r.wrote).length,
    failed,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  if (asJson) {
    console.log(JSON.stringify({ pictures: results, total, fill }, null, 2));
  } else {
    const did = dest || marks
      ? `${total.written} of ${total.pictures} written`
      : `${total.pictures - failed} of ${total.pictures} read — nothing run and nothing written, --out <dir>/ does it`;
    console.log(["", `  ${bold(did)}   ${dim(`${total.seconds}s, ${fill}`)}`
      + (failed ? `   ${failed} failed` : ""), ""].join("\n"));
  }
  if (failed) process.exitCode = 1;
}

/* One line a picture, as a batch goes. */
function progressLine(r, i, n) {
  const at = dim(`${String(i + 1).padStart(String(n).length)}/${n}`);
  if (r.error) return `  ${at}  ${bold(path.basename(r.file))}   ${r.error}`;
  const p = r.plan;
  const bits = [
    `${r.picture.width} × ${r.picture.height} → ${p.width} × ${p.height}`,
    p.passes ? `${share(p.newShare)} new, ${p.passes} pass${p.passes === 1 ? "" : "es"}` : "nothing to invent",
  ];
  if (r.wrote || r.marked) {
    bits.push(`${r.seconds}s on ${ranOn(r)}`);
    if (r.wrote) bits.push(`wrote ${r.wrote}`);
    if (r.marked) bits.push(`marked ${r.marked}`);
  }
  return `  ${at}  ${bold(path.basename(r.file))}   ${dim(bits.join(" · "))}`;
}
