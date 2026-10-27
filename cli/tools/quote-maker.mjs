/* quote-maker.html, from a terminal.

   A quote over a photograph, at whatever resolution, written where `--out`
   says. Nothing here lays text out or picks a colour: the words go into the
   page's own box, the page's own sliders are set, and the bytes the Save
   button would have handed you come back out.

       node cli/run.mjs quote-maker "The mountains are calling and I must go."
       node cli/run.mjs quote-maker "…" --by "John Muir" --photo random --out wall.png
       node cli/run.mjs quote-maker "…" --canvas 4k --font "League Gothic" --out wall.jpg

   The `--out` rules are image-compressor.html's, unchanged:

     --out <file>   written there, the ending picking the encoder
     --out <dir>/   written in there, under the page's own Save name
     no --out       nothing written, and you get the plan instead

   What the page's "just do it" button would be, here, is the page itself:
   it opens already showing you a quote. So the quote is the only argument
   that is ever required, and leaving it out leaves the page's own — every
   flag below defaults to whatever the control on the page defaults to, and a
   command with no flags at all is the picture the page opens on. (`run.mjs`
   answers a command with no arguments *and* no flags with this help, which is
   the same for every tool here.) */

import fs from "node:fs";
import path from "node:path";
import { number, oneOf, only } from "../lib/args.mjs";
import { bold, dim, emit, rows, swatch, wrap } from "../lib/out.mjs";

export const page = "quote-maker.html";
export const summary = "a quote set over a photograph, at any resolution, as "
  + "a PNG, JPEG or WebP";

/* Flags that take no value, so they do not swallow the word after them —
   `--random-font "a quote"` has to leave the quote where it can be found. */
export const booleans = ["random-font", "random-colour", "random-color"];

const FORMATS = ["png", "jpeg", "webp"];
const TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const BY_EXT = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};

const FLAGS = [
  "out", "format", "quality", "canvas", "width", "height", "font", "colour",
  "color", "background", "fill", "shade", "align", "by", "photo", "seed",
  "random-font", "random-colour", "random-color",
];

export const usage = `a quote over a photograph, out of quote-maker.html.

  node cli/run.mjs quote-maker "<the quote>" [options]
  node cli/run.mjs quote-maker fonts | sizes | photos

The quote

  "<the quote>"                 the words. A newline in it starts a new line,
                                the way the box on the page does. Left out,
                                you get the quote the page opens on
  --by <name>                   the attribution under it. "" for none

The canvas

  --canvas <name>               1920x1080, or a preset — 4k, 1080p, 1440p,
                                ultrawide, square, phone. The page resolves
                                it, so \`sizes\` lists the ones there are
  --width <px> --height <px>    the two numbers instead, 64 to 16384

The type

  --font <face>                 one of the faces the page offers; \`fonts\`
                                lists them. Left out, Georgia
  --colour <hex>                the words, as #ffffff. --color too
  --fill <20-100>               how much of the canvas the words fill; 80
  --align left|centre|right     centre
  --random-font                 a face at random, after --font if both
  --random-colour               a colour at random — light on a dark picture
                                and dark on a light one, so it stays readable
  --seed <n>                    makes both of those roll the same way twice

Behind it

  --photo <file>                your own picture, cropped to cover
  --photo random                one of the mountains, fetched from Pexels
  --photo <id>                  that one; \`photos\` lists them with their ids
  --background <hex>            the plain colour under or instead of it
  --shade <0-100>               how far the picture is pushed back behind the
                                words, light or dark to suit them; 35

The file

  --out <file>                  write it here. The ending picks the encoder —
                                .png, .jpg or .webp — unless --format says
  --out <dir>/                  write it in there, under the page's own name
  --format ${FORMATS.join("|")}       which encoder, whatever the ending says
  --quality <20-100>            for JPEG and WebP; 92. PNG ignores it

  --json                        the whole plan as JSON
  --help                        this

With no --out nothing is written: you get the plan — the size the words came
out at, how they wrapped, and what they measure against the picture behind
them — which is what the page shows you before you press Save.`;

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

/* What `--photo` was: a file to hand in, one of the built-in photographs, or
   nothing. A path is tried as a path first, so a file literally called
   `random` in the current folder still works. */
function wantPhoto(flags) {
  if (flags.photo === undefined) return null;
  if (flags.photo === true) {
    throw new Error("--photo wants a picture: a file, `random`, `none`, or "
      + "the id of one of the built-in photographs (`photos` lists them)");
  }
  const said = String(flags.photo);
  const full = path.resolve(said);
  if (fs.existsSync(full)) {
    if (fs.statSync(full).isDirectory()) {
      throw new Error(`${said} is a directory — the page takes one picture`);
    }
    return { kind: "file", file: full };
  }
  if (/^(random|dice|any)$/i.test(said)) return { kind: "random" };
  if (/^(none|no|off)$/i.test(said)) return { kind: "none" };
  if (/^\d+$/.test(said)) return { kind: "id", id: Number(said) };
  throw new Error(`no such file: ${said} — and it is not \`random\`, \`none\`, `
    + "or the id of a built-in photograph (`photos` lists them)");
}

/* The picture goes in through the page's own file input, which is the path a
   dropped file takes. The page draws when it has it, so the wait is for the
   render count to go up rather than for `ready`, which was already true for
   the picture before this one. */
async function handIn(handle, file) {
  const before = (await handle.tab.evaluate(() => window.CLI.image())).renders;
  await handle.tab.setInputFiles("#photoFile", file);
  await handle.tab.waitForFunction((was) => {
    const said = window.CLI.image();
    return said.failed || (said.renders > was && said.photo && said.photo.from === "file");
  }, before, { timeout: 60000 });
  const said = await handle.tab.evaluate(() => window.CLI.image());
  if (!said.photo || said.photo.from !== "file") {
    throw new Error(said.note || `${path.basename(file)} would not open`);
  }
  return said;
}

/* One of the listings. They ask the page rather than holding a copy of the
   answer, which is the only reason a face added to vendor/fonts turns up here
   without anybody editing this file. */
async function listing(open, which, asJson) {
  const handle = await open();
  try {
    const said = await handle.call(which, {});
    if (which === "fonts") {
      emit(said, (d) => [
        "",
        ...rows(d.fonts.map((f) => [f.name,
          dim(f.where === "vendor" ? "in the repo" : "from your machine")
            + (f.default ? `  ${bold("— the default")}` : "")])),
        "",
        ...wrap(d.note),
        "",
      ], asJson);
    } else if (which === "sizes") {
      emit(said, (d) => [
        "",
        ...rows(d.sizes.map((s) => [s.name,
          `${s.group.padEnd(14)} ${dim(s.note || "")}`
            + (s.alias ? `  ${bold(s.alias)}` : "")])),
        "",
        ...wrap(`Or any two numbers. A canvas past ${d.limits.maxSide} pixels on a `
          + `side, or past ${d.limits.maxArea} pixels of area, is more than a `
          + "browser will paint, so it comes down to fit and the page says so."),
        "",
      ], asJson);
    } else {
      emit(said, (d) => [
        "",
        ...rows(d.photos.map((p) => [String(p.id), `${p.by.padEnd(20)} ${dim(p.what)}`])),
        "",
        ...wrap(d.note + ". --photo random takes one at random; --photo <id> "
          + "takes that one."),
        "",
      ], asJson);
    }
  } finally { await handle.close(); }
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;

  if (words.length === 1 && ["fonts", "sizes", "photos"].includes(words[0])
      && flags.out === undefined) {
    await listing(open, words[0], asJson);
    return;
  }

  /* Everything a typo could be caught by happens before `open()`, so a bad
     flag never costs a browser launch. */
  only(flags, FLAGS);

  if (words.length > 1) {
    throw new Error("the page sets one quote at a time, and "
      + `${words.length} were given — quote them as one argument, and use a `
      + "newline inside it for a line break");
  }
  const text = words[0];

  if (flags.canvas === true) {
    throw new Error("--canvas wants a size: 1920x1080, or a preset name "
      + "(`sizes` lists them)");
  }
  if (flags.canvas !== undefined && (flags.width !== undefined || flags.height !== undefined)) {
    throw new Error("--canvas and --width/--height both say how big — "
      + "give one or the other");
  }
  if (flags.font === true) throw new Error("--font wants a face (`fonts` lists them)");
  if (flags.by === true) throw new Error('--by wants a name, or "" for none');

  const named = oneOf(
    flags.format === undefined ? undefined
      : String(flags.format).toLowerCase().replace(/^image\//, "").replace(/^jpg$/, "jpeg"),
    "--format", FORMATS, null);

  const dest = destination(flags);
  /* An ending naming one format and a `--format` naming another is a file
     that would lie about what is inside it, so it is refused. */
  if (named && dest && dest.type && dest.type !== TYPES[named]) {
    throw new Error(`--out ${path.basename(dest.file)} and --format ${named} `
      + "disagree about the format — drop one of them");
  }

  const photo = wantPhoto(flags);
  const seed = number(flags.seed, "--seed", { min: 0, max: 2 ** 31 });
  const randomFont = !!flags["random-font"];
  const randomColour = !!(flags["random-colour"] || flags["random-color"]);

  const asked = {
    text,
    author: flags.by === undefined ? null : String(flags.by),
    canvas: flags.canvas === undefined ? null : String(flags.canvas),
    width: number(flags.width, "--width", { min: 64, max: 16384 }),
    height: number(flags.height, "--height", { min: 64, max: 16384 }),
    font: flags.font === undefined ? null : String(flags.font),
    colour: colour(flags.colour !== undefined ? flags.colour : flags.color, "--colour"),
    background: colour(flags.background, "--background"),
    fill: number(flags.fill, "--fill", { min: 20, max: 100 }),
    shade: number(flags.shade, "--shade", { min: 0, max: 100 }),
    align: flags.align === undefined || flags.align === true ? null : String(flags.align),
    format: named ? TYPES[named] : (dest ? dest.type : null),
    quality: number(flags.quality, "--quality", { min: 20, max: 100 }),
    randomFont, randomColour, seed,
    bytes: !!dest,
  };
  /* Anything not asked for is left out entirely rather than sent as a null,
     so the page sees "say nothing about this" and leaves its own control
     alone — which is what makes every default here the page's default. */
  for (const key of Object.keys(asked)) if (asked[key] == null) delete asked[key];

  const handle = await open();
  try {
    if (photo && photo.kind === "file") await handIn(handle, photo.file);
    if (photo && photo.kind === "random") await handle.call("pexels", { seed });
    if (photo && photo.kind === "id") await handle.call("pexels", { id: photo.id });
    if (photo && photo.kind === "none") await handle.call("clearPhoto", {});

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
        ...d.lines.filter((l) => l).map((l) => `  ${bold(l)}`),
        ...(d.author ? ["", `  ${dim("— " + d.author)}`] : []),
        "",
        ...rows([
          ["canvas", `${d.width}×${d.height}`
            + (d.capped ? dim(`  (asked for ${d.asked.width}×${d.asked.height})`) : "")],
          ["face", `${d.font}  ${dim(d.where === "vendor" ? "in the repo" : "from your machine")}`],
          ["type", `${d.size} px`
            + (d.size < d.fitted ? dim(`  (${d.fitted} px is as large as it fits)`) : "")],
          ["colour", `${swatch(d.colour)}${d.colour}`],
          ["align", d.align],
          ["contrast", `${d.contrast}:1 ${dim("against the picture behind the words")}`],
          ["picture", d.photo
            ? (d.photo.by
              ? `${d.photo.by}  ${dim(d.photo.width + "×" + d.photo.height + " from Pexels")}`
              : `${d.photo.name}  ${dim(d.photo.width + "×" + d.photo.height)}`)
            : dim(`none — the plain ${d.background}`)],
          ["shade", d.photo ? `${d.shade}` : null],
          ["format", d.quality == null ? d.format : `${d.format}  ${dim("quality " + d.quality)}`],
          ["rolled", d.rolled
            ? Object.entries(d.rolled).map(([k, v]) => `${k} ${v}`).join(", ") : null],
        ]),
      ];
      if (d.capped) {
        out.push("", ...wrap(`${d.asked.width}\u00d7${d.asked.height} is past what a `
          + `browser will paint, so the canvas came down to ${d.width}\u00d7${d.height}.`));
      }
      if (d.missingFace) {
        out.push("", ...wrap(`${d.missingFace} did not load from vendor/fonts, so the `
          + "quote is set in the fallback — and was fitted to the fallback too."));
      }
      if (d.contrast < 3) {
        out.push("", ...wrap(`At ${d.contrast}:1 the words will be hard to read `
          + "against the picture. More --shade, or a lighter or darker --colour."));
      }
      if (d.photo && d.photo.page) out.push("", `  ${dim("photo: " + d.photo.page)}`);
      out.push("",
        d.wrote ? `  wrote ${bold(d.wrote)}`
          : `  ${dim("nothing written — --out <file> saves it")}`,
        "");
      return out;
    }, asJson);
  } finally { await handle.close(); }
}
