/* image-compressor.html, from a terminal.

   One picture in, one smaller picture out, through the browser's own encoder
   — which is to say through the page, because this *is* the page. Nothing
   here re-encodes anything: the file goes in at the page's own file input,
   the page's own sliders are set, and the bytes the Save button would have
   handed you are written where `--out` says.

       node cli/run.mjs image-compressor photo.jpg
       node cli/run.mjs image-compressor photo.jpg --out small.webp --quality 70
       node cli/run.mjs image-compressor photo.jpg --out small.jpg --max 2000

   This is the first tool here that writes a file, so it is where the `--out`
   convention gets settled for the eighteen pages behind it. Three rules, and
   the reasoning is in cli/README.md:

     --out <file>   written there, the ending picking the encoder
     --out <dir>/   written in there, under the page's own Save name
     no --out       nothing written, and you get the tally instead

   That last one is not a safety rail, it is the page: opening a picture shows
   you what you would be saving, and saving is a second act. It also makes a
   sweep over `--quality` cost nothing but time. */

import fs from "node:fs";
import path from "node:path";
import { number, oneOf } from "../lib/args.mjs";
import { bold, dim, emit, rows, wrap } from "../lib/out.mjs";

export const page = "image-compressor.html";
export const summary = "a picture re-encoded smaller by the browser's own "
  + "encoder, with what the saving cost";

const FORMATS = ["jpeg", "webp", "png"];
const TYPES = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" };

/* What the ending of an `--out` name says about the format. Only the three
   the page can write are in here: any other ending says nothing about the
   encoder and leaves the choice to `--format`, or to the page's own default. */
const BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", png: "image/png",
};

export const usage = `a picture made smaller, out of image-compressor.html.

  node cli/run.mjs image-compressor <picture> [options]
  node cli/run.mjs image-compressor formats

Options

  --out <file>                  write the compressed picture here. The ending
                                picks the encoder — .jpg, .webp or .png —
                                unless --format says otherwise
  --out <dir>/                  write it into that directory, under the name
                                the page's own "Save it" button would give it
  --format ${FORMATS.join("|")}        which encoder, whatever the ending says.
                                Left out, the page's own default: WebP where
                                the browser can write it
  --quality <20-100>            for a lossy format; the page's slider sits at
                                78. A fraction is the same ask, so 0.7 and 70
                                both mean 70, and PNG ignores both
  --max <pixels>                cap the longest side. The page's slider starts
                                at 240 and moves in 40, and never enlarges, so
                                the cap it actually used is printed back

  --json                        the whole tally as JSON
  --help                        this

  formats                       what this browser will write, and the limits
                                of the two sliders

With no --out nothing is written: you get the tally for the file that would
have been saved, which is what the page shows before you press anything.`;

/* The page's slider is 20 to 100, and canvas itself takes 0 to 1. Both are
   accepted because both are what somebody will type: at or under 1 is a
   fraction of full quality, and between 1 and 20 there is nothing the slider
   can be set to. */
function quality(flag) {
  if (flag === undefined || flag === true) return null;
  const n = number(flag, "--quality");
  if (n === null) return null;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  if (n < 20 || n > 100) {
    throw new Error("--quality is 20 to 100, or a fraction of one like 0.7"
      + ` — not ${flag}`);
  }
  return n;
}

/* Where the file goes, and what that says about the format. A name ending in
   a slash, or one that is already a directory, means "in there" — and the
   name inside it is the page's own, which is not known until the page has
   encoded something, so that half waits. */
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

/* The picture goes in through the page's own file input, which is the path a
   dropped file takes, and then the page is given as long as it needs to
   decode it and encode it once. A file it will not open says so on screen
   rather than throwing, so that sentence is what comes back here. */
async function handIn(handle, file) {
  await handle.tab.setInputFiles("#fileInput", file);
  await handle.tab.waitForFunction(() => {
    const said = window.CLI.image();
    return said.ready || said.failed;
  }, null, { timeout: 60000 });
  const said = await handle.tab.evaluate(() => window.CLI.image());
  if (!said.ready) {
    throw new Error(said.note || `${path.basename(file)} would not open`);
  }
  return said;
}

/* The things worth saying out loud because the page quietly did something
   other than what was asked for, or because what came back is not what a
   reader expects to see. */
function notes(d, flags) {
  const said = [];
  if (d.asked != null && d.asked !== d.cap) {
    said.push(`--max ${d.asked} became ${d.cap}: the page's cap moves in `
      + "40-pixel steps, from 240 up to the picture's own longest side, and "
      + "never enlarges.");
  }
  if (!d.lossy && flags.quality !== undefined) {
    said.push(`${d.compressed.format} is lossless, so --quality was not used.`);
  }
  if (!d.saved.smaller) said.push(d.status);
  return said.flatMap((s) => wrap(s));
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;

  /* `formats` rather than a picture. A file called exactly that, with no
     ending, is not one the page would open anyway — and `./formats` is still
     a path. */
  if (words.length === 1 && words[0] === "formats") {
    const handle = await open();
    try {
      const said = await handle.call("formats", {});
      emit(said, (d) => [
        "",
        ...rows(d.formats.map((f) => [f.ext,
          `${f.name.padEnd(5)}  ${dim(f.note)}`
            + (f.default ? `  ${bold("— the default")}` : "")])),
        "",
        ...wrap(`Quality runs ${d.quality.min} to ${d.quality.max} and sits at `
          + `${d.quality.default}, and means nothing to a lossless format. The `
          + `longest side starts at ${d.longestSide.min} pixels and moves in `
          + `${d.longestSide.step}, up to the picture's own size.`),
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
      + "what this browser can write");
  }
  if (words.length > 1) {
    throw new Error("the page compresses one picture at a time, and "
      + `${words.length} were given. image-grid.html is the one that takes a pile`);
  }
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`no such file: ${file}`);
  if (fs.statSync(full).isDirectory()) throw new Error(`${file} is a directory`);

  if (flags.format === true) {
    throw new Error(`--format is one of ${FORMATS.join(", ")}`);
  }
  const named = oneOf(
    flags.format === undefined ? undefined
      : String(flags.format).toLowerCase().replace(/^image\//, "")
        .replace(/^jpg$/, "jpeg"),
    "--format", FORMATS, null);

  const dest = destination(flags);
  /* An ending that names one format and a `--format` that names another is a
     file that would lie about what is inside it, so it is refused rather than
     silently resolved whichever way round this happens to be written. */
  if (named && dest && dest.type && dest.type !== TYPES[named]) {
    throw new Error(`--out ${path.basename(dest.file)} and --format ${named} `
      + "disagree about the format — drop one of them");
  }
  const type = named ? TYPES[named] : (dest ? dest.type : null);

  const asked = {
    format: type,
    quality: quality(flags.quality),
    cap: number(flags.max, "--max", { min: 1, max: 100000 }),
    bytes: !!dest,
  };

  const handle = await open();
  try {
    await handIn(handle, full);
    const said = await handle.call("compress", asked);

    let wrote = null;
    if (dest) {
      /* The bytes came out of the tab one number at a time; a short array
         would otherwise be written as a truncated file that still opens. */
      if (!said.bytes || said.bytes.length !== said.compressed.bytes) {
        throw new Error(`the page sent ${said.bytes ? said.bytes.length : 0} `
          + `bytes back for a ${said.compressed.bytes}-byte file, so nothing `
          + "was written");
      }
      const target = dest.file || path.join(dest.dir, said.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(said.bytes));
      const near = path.relative(process.cwd(), target);
      wrote = near.startsWith("..") ? target : near;
    }

    /* The bytes themselves are not an answer anybody wants printed, in prose
       or as a million numbers of JSON. */
    const { bytes, ...answer } = said;
    answer.wrote = wrote;

    emit(answer, (d) => {
      const wide = Math.max(d.original.human.length, d.compressed.human.length,
                            d.saved.human.length);
      const figure = (part) => `${part.human.padStart(wide)}   ${dim(part.sub)}`;
      return [
        "",
        `  ${bold(path.basename(file))}`,
        "",
        ...rows([
          ["original", figure(d.original)],
          ["compressed", figure(d.compressed)],
          [d.saved.smaller ? "saved" : "added", figure(d.saved)],
        ]),
        "",
        ...rows([
          ["quality", d.lossy ? String(d.quality) : dim("lossless")],
          ["longest side", `${d.cap} px`],
        ]),
        ...notes(d, flags),
        "",
        d.wrote
          ? `  wrote ${bold(d.wrote)}`
          : `  ${dim("nothing written — --out <file> saves it")}`,
        "",
      ];
    }, asJson);
  } finally { await handle.close(); }
}
