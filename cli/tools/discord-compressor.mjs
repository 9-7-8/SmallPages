/* discord-compressor.html, from a terminal.

   One file in, one that fits out — a video re-encoded, a picture re-encoded,
   a sound re-encoded, anything else deflated and, if it comes to it, cut into
   parts. Nothing here compresses anything: the file goes in at the page's own
   file input, the page's own boxes are set, and the bytes the Save button
   would have handed you are written where `--out` says.

       node cli/run.mjs discord-compressor clip.webm
       node cli/run.mjs discord-compressor clip.webm --out small.webm --res 720 --fps 30
       node cli/run.mjs discord-compressor photo.jpg --out small.webp --limit 20
       node cli/run.mjs discord-compressor backup.tar --zip --split --out parts/

   The bare command writes nothing and prints what the page would do, which is
   what the page itself shows before you press anything. That also makes a
   sweep over `--res` or `--limit` cost nothing but time, which is most of
   what anybody wants a compressor in a terminal for.

   Which answers `--res`, `--fps`, `--codec`, `--sound`, `--format`,
   `--bitrate` and `--channels` will take depends on the file and on the
   browser, so none of them is checked against a list kept here: the page
   refuses them with the list it really has. What *is* checked here is that a
   flag belongs to the kind of file it was given, because the page would
   otherwise ignore `--quality` on a video without a word. */

import fs from "node:fs";
import path from "node:path";
import { number, only } from "../lib/args.mjs";
import { bold, dim, emit, rows, wrap } from "../lib/out.mjs";

export const page = "discord-compressor.html";
export const summary = "any file brought under Discord's upload limit — a "
  + "video or a picture re-encoded, anything else deflated or split";

export const booleans = ["mono", "zip", "split"];

/* Which flags mean anything to which kind of file. A flag the page would
   quietly ignore is a run that looks like it worked. */
const BY_KIND = {
  video: ["res", "fps", "codec", "sound", "mono"],
  animation: ["res", "fps", "codec"],
  image: ["format", "quality", "max"],
  audio: ["bitrate", "channels"],
  file: ["zip"],
};
const ALWAYS = ["limit", "out", "split"];

export const usage = `any file brought under Discord's upload limit, out of
discord-compressor.html.

  node cli/run.mjs discord-compressor <file> [options]
  node cli/run.mjs discord-compressor limits

Everything

  --limit <MB>                  the size to come in under. The page opens at
                                10, which is under every limit Discord has
                                had since 2022; \`limits\` lists the rest
  --out <file>                  write the result here
  --out <dir>/                  write it into that directory, under the name
                                the page's own "Save it" button would give it
  --split                       if it still will not fit, cut it into parts
                                that each do. Several files, so --out has to
                                be a directory

A video, or an animated GIF

  --res keep|1080|720|480|…     the short side, so a portrait clip asked for
                                720 comes out 720 across
  --fps keep|30|24|15|…         frames a second. Fewer is smaller *and*
                                quicker, since a frame not wanted is a frame
                                not read
  --codec vp9|vp8|av1           whichever this browser will write
  --sound 96|64|32|none         kilobits a second for the sound, off the top
                                of the budget. A GIF has none to keep
  --mono                        downmix the sound to one channel

A picture

  --format webp|jpg|png|avif    whichever this browser will write
  --quality <20-100>            the *most* it will use. It goes lower on its
                                own before it makes the picture smaller
  --max <pixels>                cap the longest side

Sound on its own

  --bitrate <kbps>              or left out, as high as the limit allows
  --channels keep|mono

Anything else

  --zip                         deflate it. On by default for a file nothing
                                here can read inside

  --json                        the whole answer as JSON
  --help                        this

  limits                        the presets, and what this browser's encoders
                                will write

With no --out nothing is written: you get the figures for the file that would
have been saved.`;

/* Where the file goes. A name ending in a slash, or one that is already a
   directory, means "in there" — and the name inside it is the page's own,
   which is not known until the page has made something, so that half waits. */
function destination(flags) {
  if (flags.out === undefined) return null;
  if (flags.out === true) {
    throw new Error("--out wants somewhere to write: a file, or a directory");
  }
  const asked = String(flags.out);
  const full = path.resolve(asked);
  const intoDir = /[\\/]$/.test(asked)
    || (fs.existsSync(full) && fs.statSync(full).isDirectory());
  return intoDir ? { dir: full, file: null } : { dir: path.dirname(full), file: full };
}

/* The file goes in through the page's own file input, which is the path a
   dropped file takes. The wait is on the counter going up rather than on
   `ready`, because a video's boxes are only filled in once its frame rate has
   been measured and a job that set one before then set nothing at all. */
async function handIn(handle, file) {
  const before = await handle.tab.evaluate(() => window.CLI.file().loads);
  await handle.tab.setInputFiles("#fileInput", file);
  await handle.tab.waitForFunction(
    (n) => window.CLI.file().loads > n || window.CLI.file().failed,
    before, { timeout: 180000 });
  const said = await handle.tab.evaluate(() => window.CLI.file());
  if (!said.ready) throw new Error(said.note || `${path.basename(file)} would not open`);
  return said;
}

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;

  if (words.length === 1 && words[0] === "limits") {
    const handle = await open();
    try {
      const said = await handle.call("limits", {});
      emit(said, (d) => [
        "",
        ...rows(d.presets.map((p) => [`${p.mb} MB`,
          `${dim(p.note)}${p.default ? `  ${bold("— the default")}` : ""}`])),
        "",
        ...rows(d.codecs.map((c) => [c.id, dim(c.note)])),
        ...(d.codecs.length ? [] : wrap("This browser has no video encoder, so it"
          + " cannot re-encode a video at all.")),
        "",
        ...rows(d.formats.map((f) => [f.ext, dim(f.note)])),
        "",
        ...wrap(`Quality runs ${d.quality.min} to ${d.quality.max}, and is a ceiling`
          + " rather than a setting: the page goes lower on its own before it takes"
          + ` pixels away. The longest side starts at ${d.longestSide.min} and moves`
          + ` in ${d.longestSide.step}.`),
        "",
        ...wrap(`A video is encoded at ${d.rungs.join(", ")} times the bitrate the`
          + " limit allows, all off one read of it, and the largest result that fits"
          + " is kept. Nothing is written below "
          + `${Math.round(d.minVideoBitrate / 1000)} kbps.`),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  /* Everything a typo could be caught by happens before `open()`, so a bad
     flag never costs a browser launch. */
  const file = words[0];
  if (!file) {
    throw new Error("which file? a path to anything at all — or `limits` for the"
      + " presets and what this browser can write");
  }
  if (words.length > 1) {
    throw new Error(`the page takes one file at a time, and ${words.length} were given`);
  }
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`no such file: ${file}`);
  if (fs.statSync(full).isDirectory()) throw new Error(`${file} is a directory`);

  only(flags, [...ALWAYS, ...new Set(Object.values(BY_KIND).flat())]);

  /* A number, and nothing more: how large a limit may be is the box's
     business and the page refuses one off either end with the box's own
     figures in the sentence. What is caught here is `--limit banana`, which
     should not cost a browser launch. */
  const limit = number(flags.limit, "--limit");
  const dest = destination(flags);
  /* Splitting makes several files and the convention for that is a directory
     and nothing else — a name ending in `.zip` would become one part called
     `.zip` and the rest called nothing anybody asked for. */
  if (flags.split && dest && dest.file) {
    throw new Error("--split can make several files, so --out has to be a directory"
      + ` — ${path.basename(dest.file)} is a name for one`);
  }

  const handle = await open();
  try {
    const opened = await handIn(handle, full);

    /* Now the kind is known, so a flag that means nothing to it can be said
       out loud instead of being dropped on the floor. */
    const mine = new Set([...ALWAYS, ...(BY_KIND[opened.kind] || [])]);
    const stray = Object.keys(flags).filter((f) =>
      !mine.has(f) && !["help", "json", "h"].includes(f));
    if (stray.length) {
      throw new Error(`${path.basename(file)} is ${opened.kind === "image" ? "a picture"
        : opened.kind === "audio" ? "sound"
        : opened.kind === "animation" ? "an animation"
        : opened.kind === "video" ? "a video" : "a file nothing here can read inside"}`
        + `, so --${stray.join(", --")} ${stray.length > 1 ? "mean" : "means"} nothing to it.`
        + ` What it takes: ${[...mine].map((f) => "--" + f).join(", ")}`);
    }

    const asked = {
      limit,
      res: flags.res, fps: flags.fps, codec: flags.codec,
      sound: flags.sound === undefined ? undefined
        : /^(none|no|off|0)$/i.test(String(flags.sound)) ? "0" : String(flags.sound),
      mono: flags.mono === undefined ? undefined : !!flags.mono,
      format: flags.format === undefined ? undefined : String(flags.format).toLowerCase(),
      quality: number(flags.quality, "--quality", { min: 20, max: 100 }),
      max: number(flags.max, "--max", { min: 1, max: 100000 }),
      bitrate: flags.bitrate === undefined ? undefined : String(flags.bitrate),
      channels: flags.channels,
      zip: flags.zip === undefined ? undefined : !!flags.zip,
      split: flags.split === undefined ? undefined : !!flags.split,
      bytes: !!dest,
    };
    for (const key of Object.keys(asked)) if (asked[key] === undefined) delete asked[key];

    const said = await handle.call("fit", asked);

    const wrote = [];
    if (dest) {
      const put = (name, numbers, expect) => {
        if (!numbers || numbers.length !== expect) {
          throw new Error(`the page sent ${numbers ? numbers.length : 0} bytes back for a `
            + `${expect}-byte file, so nothing was written`);
        }
        const target = dest.file || path.join(dest.dir, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(numbers));
        const near = path.relative(process.cwd(), target);
        wrote.push(near.startsWith("..") ? target : near);
      };
      if (said.parts) {
        /* Several files, so `--out` is a directory whatever it looked like,
           and each one is named the way the page's own list names it. */
        said.parts.forEach((part, i) => put(part.name, said.partBytes[i], part.bytes));
      } else {
        put(said.name, said.bytes, said.went.bytes);
      }
    }

    const { bytes, partBytes, ...answer } = said;
    answer.wrote = wrote.length ? wrote : null;

    emit(answer, (d) => {
      const wide = Math.max(d.came.human.length, d.went.human.length, d.limitHuman.length);
      const lines = [
        "",
        `  ${bold(path.basename(file))}  ${dim(d.came.kind)}`,
        "",
        ...rows([
          ["came in", `${d.came.human.padStart(wide)}`],
          ["came out", `${d.went.human.padStart(wide)}   ${dim(d.name)}`],
          ["the limit", `${d.limitHuman.padStart(wide)}   `
            + (d.parts ? dim("every part fits")
               : d.fits ? dim("it fits") : bold("it does not fit"))],
        ]),
        "",
        ...wrap(d.detail),
      ];
      if (d.tries && d.tries.length > 1) {
        const widest = Math.max(...d.tries.map((t) => t.human.length));
        lines.push("", ...rows(d.tries.map((t) => [t.label,
          `${t.human.padStart(widest)}`
          + (t.kept ? `  ${bold("← kept")}` : t.size > d.limit ? dim("  over") : "")
          + (t.pass === 2 ? dim("  (second pass)") : "")])));
      }
      if (d.parts) {
        lines.push("", ...rows(d.parts.map((p) => [p.name,
          `${(p.bytes / 1024).toFixed(0)} KB`])), "", ...wrap(d.join));
      }
      lines.push("",
        d.wrote
          ? `  wrote ${bold(d.wrote.length === 1 ? d.wrote[0] : `${d.wrote.length} files`)}`
            + (d.wrote.length === 1 ? "" : `\n${d.wrote.map((w) => "    " + dim(w)).join("\n")}`)
          : `  ${dim("nothing written — --out <file> saves it")}`,
        "");
      return lines;
    }, asJson);
  } finally { await handle.close(); }
}
