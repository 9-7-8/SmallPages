/* The command line, checked by running it.

   `cli/run.mjs` is a second front door onto the same pages, so the thing
   worth proving is that it is the same door: the colour printed in a terminal
   has to be the colour shown in the tab, down to the last digit, and a
   palette read off a picture has to come out the same either way.

   So this suite does two different things. It runs the command for real as a
   subprocess, on pictures painted here — flat bands of known width, and a
   noisy one an encoder has to work at — and checks the answer against
   arithmetic. Then it opens the same page in a browser, drives it by hand,
   and checks the two agree. A command line that quietly grew its own colour
   maths, or its own idea of how big 400 pixels is, would pass the first half
   and fail the second. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { chromium, CHROMIUM_BIN, REPO, WORK, scoring } from "./lib/env.mjs";
import { booleans as PLAYLIST_FLAGS } from "../cli/tools/playlist-to-audio.mjs";

const { ok, done } = scoring();
const CLI = path.join(REPO, "cli", "run.mjs");

/* ------------------------------------------------------------ the picture -- */

/* A PNG, written here rather than committed, so a fixture is bytes this file
   decided on with nothing in between that could dither or resample it. `row`
   is called once per line and hands back that line's RGB triples. */
function pngOf(W, H, row) {
  const chunk = (tag, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const mid = Buffer.concat([Buffer.from(tag, "latin1"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(mid) >>> 0);
    return Buffer.concat([head, mid, crc]);
  };
  const raw = Buffer.concat(Array.from({ length: H }, (_, y) =>
    Buffer.concat([Buffer.from([0]), Buffer.from(row(y))])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;            // eight bits a channel, truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* Flat vertical bands, each as wide as its share of the frame. What the
   colour picker should find is exactly the list that went in. */
function bandsPng(bands, W = 600, H = 300) {
  const line = [];
  let x = 0;
  bands.forEach(([rgb, share], i) => {
    const w = i === bands.length - 1 ? W - x : Math.round(W * share);
    for (let n = 0; n < w; n++) line.push(...rgb);
    x += w;
  });
  return pngOf(W, H, () => line);
}

/* Something an encoder has to work at. Flat bands compress to almost nothing
   whatever quality is asked for, so they cannot show a quality setting doing
   anything — a picture needs detail in it for that. The wobble comes off a
   fixed sequence rather than `Math.random`, because a compressor test that
   measures a different picture every run measures luck. */
function noisePng(W = 800, H = 600) {
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  return pngOf(W, H, (y) => {
    const line = [];
    for (let x = 0; x < W; x++) {
      const v = Math.sin(x / 9) * 60 + Math.sin(y / 13) * 60 + 128 + next() * 70;
      line.push(v & 255, (v * 0.7 + 40) & 255, (v * 0.4 + 90) & 255);
    }
    return line;
  });
}

/* What a file says it is in its own first bytes. Not a decoder — the page is
   the only decoder in this repository and the checks below use it as one —
   just enough to catch a WebP written under a name ending in .jpg. */
function magic(file) {
  const head = fs.readFileSync(file).subarray(0, 12);
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF"
      && head.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  /* The one here that no browser can write, so uncrop.html writes it itself:
     little-endian byte order, then 42, which is the whole of a TIFF header
     that is not an offset. */
  if (head.subarray(0, 2).toString("latin1") === "II"
      && head.readUInt16LE(2) === 42) return "tiff";
  return "something else";
}

const BANDS = [
  [[224, 58, 62], 0.4],
  [[47, 110, 180], 0.3],
  [[242, 201, 76], 0.2],
  [[30, 30, 34], 0.1],
];
const HEXES = ["#e03a3e", "#2f6eb4", "#f2c94c", "#1e1e22"];
const PICTURE = path.join(WORK, "cli-bands.png");
fs.writeFileSync(PICTURE, bandsPng(BANDS));
const PHOTO = path.join(WORK, "cli-photo.png");
fs.writeFileSync(PHOTO, noisePng());

/* ------------------------------------------------------------- running it -- */

let extraEnv = {};
const run = (...args) => new Promise((settle) => {
  const child = spawn(process.execPath, [CLI, ...args],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"],
      /* A fresh browser profile for every command, so nothing one check
         leaves in the browser's storage can make the next one pass. The
         kept profile is checked on its own, further down. */
      env: { ...process.env, NO_COLOR: "1", SMALLPAGES_PROFILE: "none", ...extraEnv } });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("close", (code) => settle({ code, out, err }));
});

const json = async (...args) => {
  const got = await run(...args, "--json");
  if (got.code !== 0) throw new Error(`${args.join(" ")} exited ${got.code}: ${got.err.trim()}`);
  return JSON.parse(got.out);
};

/* ------------------------------------------------------------ the listing -- */

{
  const got = await run();
  ok("with nothing asked for it lists what has a command line",
    got.code === 0 && ["color-picker", "frutiger-orb", "image-compressor",
      "playlist-to-audio", "quote-maker", "ruler", "uncrop"]
      .every((tool) => got.out.includes(tool)),
    got.out.slice(0, 400));
  const help = await run("color-picker", "--help");
  ok("a tool's --help names its commands",
    ["convert", "palette", "pixel", "contrast", "gradient", "match"]
      .every((c) => help.out.includes(c)), help.out.slice(0, 200));
  ok("and --help opens no browser, so it answers at once",
    help.code === 0 && !/Chromium|playwright/i.test(help.err), help.err.slice(0, 200));
}

/* ------------------------------------------------------------- convert -- */

{
  const d = await json("color-picker", "convert", "#4f8fd0");
  ok("convert gives the colour back as hex", d.hex === "#4f8fd0", d.hex);
  ok("and as rgb", d.rgb === "rgb(79, 143, 208)", d.rgb);
  ok("and as hsl", d.hsl === "hsl(210, 58%, 56%)", d.hsl);
  ok("and in OKLCH", /^oklch\(63\.6% 0\.119 250\.5\)$/.test(d.oklch), d.oklch);
  ok("and in Lab", /^lab\(57\.9% /.test(d.lab), d.lab);
  ok("and as CMYK", /^cmyk\(\d+%, \d+%, \d+%, \d+%\)$/.test(d.cmyk), d.cmyk);
  ok("the press model is the default, and says what it found",
    d.cmykMode === "coated" && /Printable|process-ink gamut/.test(d.gamut), d.gamut);
  ok("the ramp runs black to white through the colour",
    d.shades.length === 11 && d.shades[0] === "#000000"
      && d.shades[5] === "#4f8fd0" && d.shades[10] === "#ffffff",
    d.shades.join(" "));
  ok("and the harmony strip carries all seven rules",
    d.harmony.length === 7 && d.harmony[0].colors[0] === "#4f8fd0",
    d.harmony.map((h) => h.rule).join(", "));

  const straight = await json("color-picker", "convert", "#4f8fd0", "--cmyk", "straight");
  ok("--cmyk straight is a different answer from the press one",
    straight.cmyk !== d.cmyk && /no claim about any press/.test(straight.gamut),
    `${straight.cmyk} vs ${d.cmyk}`);

  const named = await json("color-picker", "convert", "rebeccapurple");
  ok("a CSS keyword is a colour too", named.hex === "#663399", named.hex);
}

/* ------------------------------------------------------------- palette -- */

{
  const d = await json("color-picker", "palette", PICTURE);
  ok("palette finds the four colours that are in the picture",
    d.colors.length === 4, JSON.stringify(d.colors.map((c) => c.hex)));
  ok("and gives them back exactly, commonest first",
    d.colors.map((c) => c.hex).join(" ") === HEXES.join(" "),
    d.colors.map((c) => c.hex).join(" "));
  ok("with the share of the frame each one covers",
    d.colors.map((c) => Math.round(c.share * 100)).join(" ") === "40 30 20 10",
    d.colors.map((c) => c.share).join(" "));
  ok("and it says where the colours came from",
    d.from === "image" && d.colors.every((c) => c.origin === "image"), d.from);

  const two = await json("color-picker", "palette", PICTURE, "--count", "2");
  ok("--count combines down to the number asked for",
    two.colors.length === 2, String(two.colors.length));

  const tri = await json("color-picker", "palette", PICTURE, "--rule", "triadic");
  ok("a rule with no count takes its count from its own geometry",
    tri.colors.length === 3 && tri.rule === "triadic",
    `${tri.rule} ${tri.colors.length}`);

  const mono = await json("color-picker", "palette", "--colour", "#4f8fd0",
                          "--rule", "monochromatic", "--count", "4");
  ok("and a palette can be grown from a colour with no picture at all",
    mono.colors.length === 4 && mono.from === "colour"
      && mono.colors.every((c) => c.origin === "step"),
    JSON.stringify(mono.colors.map((c) => c.hex)));
}

/* --------------------------------------------------------------- pixel -- */

{
  const d = await json("color-picker", "pixel", PICTURE, "--at", "100,150");
  ok("pixel reads a pixel out of the first band", d.hex === "#e03a3e", d.hex);
  ok("and says how big the picture was",
    d.picture.width === 600 && d.picture.height === 300,
    `${d.picture.width} × ${d.picture.height}`);

  const far = await json("color-picker", "pixel", PICTURE, "--at", "590,10", "--sample", "1");
  ok("a pixel in the last band is the last band's colour", far.hex === "#1e1e22", far.hex);

  const off = await run("color-picker", "pixel", PICTURE, "--at", "900,10");
  ok("a pixel outside the picture is refused, with the size in the complaint",
    off.code === 1 && /outside the picture/.test(off.err), off.err.trim());
}

/* ------------------------------------------------------------ contrast -- */

{
  const d = await json("color-picker", "contrast", "#767676", "white");
  ok("contrast gives the WCAG ratio", Math.abs(d.ratio - 4.54) < 0.01, String(d.ratio));
  ok("and grades it four ways", d.grades.length === 4, String(d.grades.length));
  ok("4.54:1 passes AA and fails AAA",
    d.grades[0].pass === true && d.grades[1].pass === false,
    JSON.stringify(d.grades.map((g) => g.pass)));
  ok("and APCA is answered as well", d.lc > 60 && d.lc < 80, String(d.lc));

  const fixed = await json("color-picker", "contrast", "#8899aa", "white", "--fix", "text");
  ok("--fix walks the text to a lightness that passes",
    fixed.fix.moved === true && fixed.fix.needed === true && fixed.ratio >= 4.5,
    JSON.stringify(fixed.fix));
  const already = await json("color-picker", "contrast", "#111111", "white", "--fix", "text");
  ok("and leaves a pair that already passes where it is",
    already.fix.needed === false && already.fix.moved === false,
    JSON.stringify(already.fix));
}

/* ------------------------------------------------------------ gradient -- */

{
  const d = await json("color-picker", "gradient", "#4f8fd0", "coral");
  ok("gradient spaces two stops at the ends",
    d.stops.length === 2 && d.stops[0].pos === 0 && d.stops[1].pos === 100,
    JSON.stringify(d.stops));
  ok("and writes the CSS twice: once plainly, once in the space asked for",
    /linear-gradient\(90deg, #4f8fd0 0%, #ff7f50 100%\)/.test(d.css)
      && /in oklab/.test(d.css), d.css);

  const conic = await json("color-picker", "gradient", "red", "blue", "green",
                           "--shape", "conic", "--angle", "45", "--space", "srgb");
  ok("a conic gradient in sRGB has no space named in it, because that is the default",
    /conic-gradient\(from 45deg/.test(conic.css) && !/ in /.test(conic.css), conic.css);
  ok("and three colours with no positions are spaced evenly",
    conic.stops.map((s) => s.pos).join(" ") === "0 50 100",
    conic.stops.map((s) => s.pos).join(" "));

  const at = await json("color-picker", "gradient", "red", "blue", "--at", "20,80");
  ok("--at puts the stops where it says",
    at.stops[0].pos === 20 && at.stops[1].pos === 80, JSON.stringify(at.stops));
}

/* --------------------------------------------------------------- match -- */

{
  const d = await json("color-picker", "match", "#4f8fd0", "--count", "5");
  ok("match returns five threads and five chips",
    d.threads.length === 5 && d.pantone.length === 5,
    `${d.threads.length} / ${d.pantone.length}`);
  ok("ranked by how different they look, nearest first",
    d.threads.every((h, i) => i === 0 || h.de >= d.threads[i - 1].de),
    d.threads.map((h) => h.de).join(" "));
  ok("the nearest thread to this blue is within sight of it",
    d.threads[0].de < 3, String(d.threads[0].de));
  ok("and every hit says which chart it came from",
    d.threads.every((h) => h.book && h.code), JSON.stringify(d.threads[0]));

  const one = await json("color-picker", "match", "teal", "--chart", "DMC Stranded", "--count", "3");
  ok("--chart narrows it to one chart",
    one.threads.length === 3 && one.threads.every((h) => h.book === "DMC Stranded"),
    one.threads.map((h) => h.book).join(", "));

  const charts = await json("color-picker", "charts");
  ok("charts lists what there is to match against",
    charts.threads.length > 5 && charts.pantone.length === 2,
    `${charts.threads.length} charts, ${charts.pantone.length} books`);
  ok("and the totals add up to what match reports",
    charts.threads.reduce((n, b) => n + b.colors, 0) === d.totals.threads,
    `${charts.threads.reduce((n, b) => n + b.colors, 0)} vs ${d.totals.threads}`);

  const nope = await run("color-picker", "match", "teal", "--chart", "Nonesuch");
  ok("and a chart that does not exist is a sentence, not a silent fall-back",
    nope.code === 1 && /no thread chart called/.test(nope.err), nope.err.trim());
}

/* ----------------------------------------------------- image-compressor -- */

/* The first tool here that writes a file, so there are two things to prove
   rather than one: that the arithmetic is right, and that the bytes left on
   disk are a real picture of the size claimed for them.

   The second is checked by handing the saved file back to the page. The page
   is the only image decoder in this repository, and a WebP reader written
   here to check a WebP written there would be precisely the second tool this
   whole arrangement exists to avoid. */
{
  const photoBytes = fs.statSync(PHOTO).size;

  const d = await json("image-compressor", PHOTO);
  ok("a bare run is the page's own defaults: WebP at 78, and the full size",
    d.compressed.ext === "webp" && d.quality === 78 && d.cap === 800
      && d.compressed.width === 800 && d.compressed.height === 600,
    `${d.compressed.ext} q${d.quality} cap ${d.cap} `
      + `${d.compressed.width}×${d.compressed.height}`);
  ok("and it is reading the file that is actually on disk",
    d.original.bytes === photoBytes, `${d.original.bytes} vs ${photoBytes}`);
  ok("the tally subtracts what it says it subtracts",
    d.saved.bytes === d.original.bytes - d.compressed.bytes
      && Math.abs(d.saved.percent - (d.saved.bytes / d.original.bytes) * 100) < 0.06,
    `${d.saved.bytes} bytes, ${d.saved.percent}%`);
  ok("and with no --out nothing is written at all",
    d.wrote === null, String(d.wrote));

  const small = await json("image-compressor", PHOTO, "--max", "400");
  ok("--max caps the longest side and the short one follows it down",
    small.compressed.width === 400 && small.compressed.height === 300,
    `${small.compressed.width}×${small.compressed.height}`);

  /* The slider is the page's only way of saying how big, and it moves in
     forties from 240 — so 300 is not a size this page can be asked for, and
     the thing that must not happen is the command line quietly reporting the
     300 it was given rather than the 320 it got. */
  const snapped = await json("image-compressor", PHOTO, "--max", "300");
  ok("a cap the slider cannot express lands where the slider lands, and says so",
    snapped.asked === 300 && snapped.cap === 320
      && snapped.compressed.width === 320 && snapped.compressed.height === 240,
    `asked ${snapped.asked}, got ${snapped.cap}, `
      + `${snapped.compressed.width}×${snapped.compressed.height}`);

  const rough = await json("image-compressor", PHOTO, "--format", "jpeg", "--quality", "30");
  const fine = await json("image-compressor", PHOTO, "--format", "jpeg", "--quality", "90");
  ok("a lower quality is a smaller file",
    rough.compressed.bytes < fine.compressed.bytes,
    `${rough.compressed.bytes} at 30 vs ${fine.compressed.bytes} at 90`);
  const frac = await json("image-compressor", PHOTO, "--format", "jpeg", "--quality", "0.3");
  ok("and a fraction is the same ask as the percentage, to the byte",
    frac.quality === 30 && frac.compressed.bytes === rough.compressed.bytes,
    `q${frac.quality}, ${frac.compressed.bytes} vs ${rough.compressed.bytes}`);

  /* -------------------------------------------------- and out to a file -- */

  const out = path.join(WORK, "cli-small.webp");
  fs.rmSync(out, { force: true });
  const wrote = await json("image-compressor", PHOTO, "--max", "400", "--out", out);
  ok("--out writes the file, exactly as big as the tally said it would be",
    fs.existsSync(out) && fs.statSync(out).size === wrote.compressed.bytes,
    `${fs.existsSync(out) ? fs.statSync(out).size : "missing"} `
      + `vs ${wrote.compressed.bytes}`);
  ok("and what it wrote is really a WebP", magic(out) === "webp", magic(out));

  const back = await json("image-compressor", out);
  ok("and the page, handed the saved file back, opens it at 400×300",
    back.original.width === 400 && back.original.height === 300
      && back.original.bytes === wrote.compressed.bytes,
    `${back.original.width}×${back.original.height}, ${back.original.bytes} bytes`);

  const asJpeg = path.join(WORK, "cli-small.jpg");
  fs.rmSync(asJpeg, { force: true });
  const jpg = await json("image-compressor", PHOTO, "--max", "400", "--out", asJpeg);
  ok("the ending of an --out name picks the encoder with no --format at all",
    jpg.compressed.ext === "jpg" && magic(asJpeg) === "jpeg",
    `${jpg.compressed.ext} on disk is ${magic(asJpeg)}`);

  const into = path.join(WORK, "cli-out");
  fs.rmSync(into, { recursive: true, force: true });
  const dir = await json("image-compressor", PHOTO, "--format", "png",
                         "--out", into + path.sep);
  ok("--out on a directory takes the name the page's own Save button gives",
    dir.name === "cli-photo-small.png"
      && fs.existsSync(path.join(into, "cli-photo-small.png"))
      && magic(path.join(into, "cli-photo-small.png")) === "png",
    `${dir.name}, written: ${fs.existsSync(path.join(into, "cli-photo-small.png"))}`);

  const formats = await json("image-compressor", "formats");
  ok("formats says what this browser will write, and marks the default",
    formats.formats.length >= 2 && formats.formats.filter((f) => f.default).length === 1
      && formats.quality.default === 78 && formats.longestSide.step === 40,
    formats.formats.map((f) => f.ext + (f.default ? "*" : "")).join(" "));

  /* ------------------------------------------- and what goes wrong here -- */

  const tiff = await run("image-compressor", PHOTO, "--format", "tiff");
  ok("a format the page cannot write lists the three it can",
    tiff.code === 1 && /--format is one of jpeg, webp, png/.test(tiff.err),
    tiff.err.trim());
  const clash = await run("image-compressor", PHOTO,
                          "--out", path.join(WORK, "clash.jpg"), "--format", "webp");
  ok("an --out ending that contradicts --format is refused, not resolved",
    clash.code === 1 && /disagree about the format/.test(clash.err)
      && !fs.existsSync(path.join(WORK, "clash.jpg")), clash.err.trim());
  const thin = await run("image-compressor", PHOTO, "--quality", "5");
  ok("a quality off the end of the page's slider is a sentence",
    thin.code === 1 && /--quality is 20 to 100/.test(thin.err), thin.err.trim());
  const tiny = await run("image-compressor", PHOTO, "--max", "100");
  ok("and so is a cap below the smallest size the page offers",
    tiny.code === 1 && /240 pixels/.test(tiny.err), tiny.err.trim());
  const pile = await run("image-compressor", PHOTO, PHOTO);
  ok("two pictures at once says which page is the one that takes a pile",
    pile.code === 1 && /one picture at a time/.test(pile.err), pile.err.trim());
  const notPicture = path.join(WORK, "cli-not-a-picture.txt");
  fs.writeFileSync(notPicture, "this is not a picture");
  const refused = await run("image-compressor", notPicture);
  ok("and a file that is not a picture comes back as the page's own complaint",
    refused.code === 1 && /not an image this page can open/.test(refused.err),
    refused.err.trim());
}

/* ----------------------------------------------------- playlist-to-audio -- */

/* The third tool, and the first that produces neither a reading nor a file:
   what comes out is a command somebody is going to paste into a terminal. So
   the right answer is written out below rather than measured, and the half
   that matters is further down, where the page is driven by hand and the
   command it shows is held against the command that was printed. */

const LIST = "OLAK5uy_kVmHRcAlIhVuN0GLqDxvXVQ7pnU";
const MUSIC = `https://music.youtube.com/playlist?list=${LIST}`;

/* The page as it opens, with nothing but a playlist pasted into it: the
   balanced tier at MP3 V0, the seven ticked boxes, and D:\Music in the folder
   field. Every one of those is the page's own default rather than a choice
   made at this end, which is the whole of what `playlist-to-audio <url>` with
   no flags is supposed to be. */
const BARE = [
  "yt-dlp",
  '-f "bestaudio/best"',
  "-x --audio-format mp3 --audio-quality 0",
  '-P "D:\\Music"',
  '-o "%(playlist_title|Downloads)s/%(playlist_index)03d %(title)s.%(ext)s"',
  "--embed-metadata",
  '--parse-metadata "playlist_title:%(album)s"',
  "--embed-thumbnail",
  '--download-archive "archive.txt"',
  "--ignore-errors --no-overwrites",
  "--sleep-requests 1.5 --sleep-interval 2 --max-sleep-interval 6",
  "--yes-playlist",
  `"${MUSIC}"`,
];

{
  const said = await json("playlist-to-audio", MUSIC);
  ok("the bare command is the page's own defaults, argument for argument",
    said.parts.map((p) => p.arg).join("\n") === BARE.join("\n"),
    said.parts.map((p) => p.arg).filter((a, i) => a !== BARE[i]).join(" / "));
  ok("and the command it prints is those arguments, wrapped for PowerShell",
    said.command === BARE.join(" `\n    "), JSON.stringify(said.command.slice(0, 60)));
  ok("with the tier, the setting and the boxes said out loud beside it",
    said.tier === "balanced" && said.quality === "mp3:0"
      && said.options.sponsorblock === false
      && Object.values(said.options).filter(Boolean).length === 7,
    `${said.tier} ${said.quality} ${JSON.stringify(said.options)}`);
  ok("and the playlist canonicalised, with the page's own reading of it",
    said.url.target === MUSIC && said.url.id === LIST
      && said.url.kind === "YouTube Music playlist"
      && said.url.note === `YouTube Music playlist · ${LIST}`,
    JSON.stringify(said.url));
  ok("every part but yt-dlp itself carries its annotation",
    said.parts.filter((p) => !p.why).map((p) => p.arg).join() === "yt-dlp",
    said.parts.filter((p) => !p.why).map((p) => p.arg).join(" / "));

  /* The flags, each one changing its own part of the command and nothing
     else. The arguments are compared as a set against the bare command, so a
     flag that quietly moved something else would come out here. */
  const flagged = await json("playlist-to-audio", LIST,
    "--tier", "max", "--quality", "flac", "--shell", "bash", "--one-line",
    "--to", "/srv/music", "--only", "1-20", "--cookies", "firefox",
    "--no-cover", "--sponsorblock");
  const args = flagged.parts.map((p) => p.arg);
  ok("the flags each change their own part of the command",
    args.includes("-x --audio-format flac")
      && args.includes('-P "/srv/music"')
      && args.includes("--playlist-items 1-20")
      && args.includes("--cookies-from-browser firefox")
      && args.includes("--sponsorblock-remove sponsor,selfpromo")
      && !args.includes("--embed-thumbnail")
      && args.at(-1) === `"https://www.youtube.com/playlist?list=${LIST}"`,
    args.join(" / "));
  ok("and --one-line prints what the page's Wrap lines button would",
    flagged.command === args.join(" ") && !/\n/.test(flagged.command),
    JSON.stringify(flagged.command.slice(0, 50)));
  ok("--shell bash is the only thing that changes the continuation character",
    (await json("playlist-to-audio", LIST, "--shell", "bash")).command
      .includes(" \\\n    "), "");

  /* `tiers` is the page answering for itself, and it is also the one check
     holding the tool's flag list against the page's boxes. `cli/tools` has to
     name those eight to print `--help` without opening a browser, which is
     the one place in cli/ where something the page knows is written down
     twice; this is what keeps the copy honest. */
  const tiers = await json("playlist-to-audio", "tiers");
  ok("tiers reports the three cards and marks the one the page opens on",
    tiers.tiers.map((t) => t.key).join() === "max,balanced,min"
      && tiers.tiers.filter((t) => t.chosen).map((t) => t.key).join() === "balanced",
    tiers.tiers.map((t) => t.key + (t.chosen ? "*" : "")).join(" "));
  ok("and the settings inside each card, with each card's own default marked",
    tiers.tiers.every((t) => t.quality.length >= 3
      && t.quality.filter((q) => q.default).length === 1)
      && tiers.tiers[1].quality[0].value === "mp3:0",
    tiers.tiers.map((t) => t.quality.filter((q) => q.default)[0].value).join(" "));
  const fromPage = tiers.options
    .map((o) => `${o.on ? "no-" : ""}${o.name}`).sort().join(" ");
  const fromTool = PLAYLIST_FLAGS
    .filter((f) => !["one-line", "why"].includes(f)).sort().join(" ");
  ok("and the eight boxes the tool names are the eight the page has, "
    + "the same way round",
    fromPage === fromTool, `page: ${fromPage}\n        tool: ${fromTool}`);

  /* The estimate, which is the one piece of arithmetic in this page: a
     bitrate times a runtime. Twenty-five four-minute tracks is 6,000 seconds,
     so the three figures are exact rather than approximate. */
  const seconds = 25 * 240;
  const est = await json("playlist-to-audio", "sizes", "--tracks", "25",
                         "--length", "4:00");
  ok("sizes is the bitrate times the runtime, to the byte",
    est.seconds === seconds && est.duration === "1 h 40 m"
      && est.tiers.map((t) => t.bytes).join()
         === [160, 245, 6].map((k) => k * 1000 * seconds / 8).join(),
    `${est.duration} · ${est.tiers.map((t) => t.bytes).join(" ")}`);
  ok("and it defaults to the page's own 25 tracks of four minutes",
    (await json("playlist-to-audio", "sizes")).seconds === seconds,
    String((await json("playlist-to-audio", "sizes")).seconds));
  const long = await json("playlist-to-audio", "sizes", "--tracks", "180",
                          "--length", "3:30", "--tier", "min");
  ok("a longer playlist multiplies out the same way, and --tier marks a row",
    long.seconds === 180 * 210
      && long.tiers.filter((t) => t.chosen).map((t) => t.key).join() === "min",
    `${long.seconds} · ${long.tiers.filter((t) => t.chosen).map((t) => t.key)}`);

  /* ------------------------------------------- and what goes wrong here -- */

  const tier = await run("playlist-to-audio", LIST, "--tier", "lossless");
  ok("a tier the page has no card for lists the three it has",
    tier.code === 1 && /--tier is one of max, balanced, min/.test(tier.err),
    tier.err.trim());
  const setting = await run("playlist-to-audio", LIST, "--tier", "max",
                            "--quality", "mp3:0");
  ok("a setting from the wrong card comes back with that card's own list",
    setting.code === 1
      && /no setting for the max tier called "mp3:0" — there is best, flac, wav/
         .test(setting.err), setting.err.trim());
  const stray = await run("playlist-to-audio", LIST, "--no-covers");
  ok("a flag that is nearly one of these names the one it is nearly",
    stray.code === 1 && /no flag called --no-covers/.test(stray.err)
      && /did you mean --no-cover\?/.test(stray.err), stray.err.trim());
  const host = await run("playlist-to-audio", "https://vimeo.com/staffpicks");
  ok("a link that is not YouTube is the page's own sentence, and builds nothing",
    host.code === 1 && /That host isn't YouTube/.test(host.err)
      && !/yt-dlp/.test(host.out), host.err.trim());
  const pile = await run("playlist-to-audio", LIST, LIST);
  ok("two playlists at once says where a slice of one goes instead",
    pile.code === 1 && /one playlist at a time/.test(pile.err), pile.err.trim());
  const wrongPlace = await run("playlist-to-audio", LIST, "--tracks", "40");
  ok("and the estimate's own flags, on the command, say which command wants them",
    wrongPlace.code === 1 && /not the command's/.test(wrongPlace.err),
    wrongPlace.err.trim());
  const wav = await json("playlist-to-audio", "sizes", "--tier", "max",
                         "--quality", "wav", "--tracks", "25", "--length", "4:00");
  ok("and the container moves the top row, since WAV is not the Opus stream",
    wav.tiers[0].bytes === 1411 * 1000 * seconds / 8
      && wav.tiers[1].bytes === 245 * 1000 * seconds / 8,
    wav.tiers.map((t) => `${t.kbps}k`).join(" "));
  const elsewhere = await run("playlist-to-audio", "sizes", "--to", "/srv/music");
  ok("a flag that belongs to the command is refused by the estimate",
    elsewhere.code === 1 && /not a flag `sizes` takes/.test(elsewhere.err)
      && /--tracks, --length, --tier, --quality/.test(elsewhere.err),
    elsewhere.err.trim());
  const atTiers = await run("playlist-to-audio", "tiers", "--tier", "max");
  ok("and `tiers`, which takes none, says that rather than ignoring it",
    atTiers.code === 1 && /takes none but --json/.test(atTiers.err),
    atTiers.err.trim());
  const length = await run("playlist-to-audio", "sizes", "--length", "about four");
  ok("a length the page's own parser cannot read is a sentence, not a fallback",
    length.code === 1 && /a length reads as 4:00, 1:04:00, or 4\.5/.test(length.err),
    length.err.trim());
  const bareHelp = await run("playlist-to-audio", "--help");
  ok("and --help names every flag without opening a browser",
    bareHelp.code === 0
      && PLAYLIST_FLAGS.every((f) => bareHelp.out.includes(`--${f}`))
      && ["--tier", "--quality", "--to", "--only", "--cookies", "--shell"]
         .every((f) => bareHelp.out.includes(f)),
    PLAYLIST_FLAGS.filter((f) => !bareHelp.out.includes(`--${f}`)).join(" "));
}

/* ----------------------------------------------------------------- uncrop -- */

/* The fourth tool, and the first whose bare command runs nothing at all. On
   image-compressor.html opening a picture has already encoded it, so a bare
   command is a tally; on uncrop.html opening one only shows you the figures
   and Uncrop is a separate press, so a bare command here is those figures and
   `--out` is the press. Which makes the arithmetic checkable without
   fetching 80 MB of weights: the canvas, the share of it that is new, the
   gaps on each side and the number of model passes all come back from a run
   that downloads nothing.

   `--fill reflect` is the one fill that needs no model at all, so it is the
   one the written files are checked with. */
{
  const d = await json("uncrop", PHOTO, "--canvas", "1200x900");
  ok("a canvas given outright is the canvas, and the picture is centred on it",
    d.plan.width === 1200 && d.plan.height === 900
      && d.plan.gaps.left === 200 && d.plan.gaps.right === 200
      && d.plan.gaps.top === 150 && d.plan.gaps.bottom === 150,
    JSON.stringify([d.plan.width, d.plan.height, d.plan.gaps]));
  ok("the share that is new is the canvas less the picture, to the pixel",
    d.plan.newPixels === 1200 * 900 - 800 * 600
      && Math.abs(d.plan.newShare - 0.5556) < 0.001,
    `${d.plan.newPixels} new, ${d.plan.newShare}`);
  ok("a border this modest is one pass",
    d.plan.passes === 1, String(d.plan.passes));
  ok("and a bare command writes nothing and runs nothing",
    d.wrote === null && d.seconds === undefined, JSON.stringify([d.wrote, d.seconds]));

  const twice = await json("uncrop", PHOTO, "--grow", "2");
  ok("--grow is a multiple of the picture, and a bigger jump is more passes",
    twice.plan.width === 1600 && twice.plan.height === 1200 && twice.plan.passes === 2,
    JSON.stringify([twice.plan.width, twice.plan.height, twice.plan.passes]));

  /* With no canvas asked for at all it is the picture's own size, which is
     what the page opens on and leaves nothing to invent. */
  const bare = await json("uncrop", PHOTO);
  ok("a bare command is the picture's own size, with nothing to invent yet",
    bare.plan.width === 800 && bare.plan.height === 600
      && bare.plan.passes === 0 && bare.plan.exact === true,
    JSON.stringify([bare.plan.width, bare.plan.height, bare.plan.passes]));

  /* A shape keeps the width and works the height out, which on this picture
     makes the canvas shorter than the picture — so some of it is cut, and the
     page says how much rather than cropping quietly. */
  const wide = await json("uncrop", PHOTO, "--ratio", "16:9");
  ok("--ratio keeps the width and reshapes the height",
    wide.plan.width === 800 && wide.plan.height === 450,
    `${wide.plan.width}×${wide.plan.height}`);
  ok("and a canvas that cuts the picture says what share of it goes",
    Math.abs(wide.plan.cropped - 0.25) < 0.002
      && /25% of the picture/.test(wide.plan.note),
    `${wide.plan.cropped}: ${wide.plan.note}`);

  /* Half the picture's own pixels is 400 × 300, which leaves 400 either side
     of it on a 1200-wide canvas rather than the 200 the full-size one left. */
  const scaled = await json("uncrop", PHOTO, "--canvas", "1200x900", "--scale", "0.5");
  ok("--scale is a multiple of the picture's own pixels",
    scaled.plan.gaps.left === 400 && scaled.plan.gaps.top === 300
      && scaled.plan.newPixels === 1200 * 900 - 400 * 300,
    JSON.stringify(scaled.plan.gaps));
  const put = await json("uncrop", PHOTO, "--canvas", "1200x900", "--at", "0,0");
  ok("--at puts the corner where it says, rather than centring it",
    put.plan.gaps.left === 0 && put.plan.gaps.top === 0
      && put.plan.gaps.right === 400 && put.plan.gaps.bottom === 300,
    JSON.stringify(put.plan.gaps));

  /* The nine buttons on the page, as words. */
  const corner = await json("uncrop", PHOTO, "--canvas", "1200x900", "--align", "bottom right");
  const edge = await json("uncrop", PHOTO, "--canvas", "1200x900", "--align", "left");
  ok("--align is the page's align pad, by corner and by edge",
    corner.plan.gaps.left === 400 && corner.plan.gaps.top === 300
      && corner.plan.gaps.right === 0 && corner.plan.gaps.bottom === 0
      && edge.plan.gaps.left === 0 && edge.plan.gaps.top === 150,
    JSON.stringify([corner.plan.gaps, edge.plan.gaps]));
  const bothWays = await run("uncrop", PHOTO, "--align", "top", "--at", "0,0");
  ok("and saying where twice over is refused rather than one winning quietly",
    bothWays.code === 1 && /use one/.test(bothWays.err), bothWays.err.trim());

  /* The files. Two formats, one of which no browser can write. */
  const asPng = path.join(WORK, "cli-uncrop.png");
  const asTif = path.join(WORK, "cli-uncrop.tif");
  const made = await json("uncrop", PHOTO, "--canvas", "1200x900",
    "--fill", "reflect", "--out", asPng);
  ok("--out writes the file and says where it went",
    fs.existsSync(asPng) && made.wrote.endsWith("cli-uncrop.png")
      && made.width === 1200 && made.height === 900,
    JSON.stringify([made.wrote, made.width, made.height]));
  ok("and what it wrote is really a PNG", magic(asPng) === "png", magic(asPng));

  const back = await json("image-compressor", asPng);
  ok("and the page next door, handed it back, opens it at 1200×900",
    back.original.width === 1200 && back.original.height === 900,
    `${back.original.width}×${back.original.height}`);

  await json("uncrop", PHOTO, "--canvas", "1200x900", "--fill", "reflect", "--out", asTif);
  ok("a TIFF comes out a TIFF, which is the one format no browser can write",
    magic(asTif) === "tiff", magic(asTif));
  ok("and it is bigger than the PNG of the same picture, being Deflate on raw samples",
    fs.statSync(asTif).size > fs.statSync(asPng).size * 0.5,
    `${fs.statSync(asTif).size} against ${fs.statSync(asPng).size}`);

  const intoDir = await json("uncrop", PHOTO, "--canvas", "400x400",
    "--fill", "reflect", "--out", WORK + path.sep);
  ok("--out <dir> uses the page's own Save name",
    intoDir.name === "cli-photo-uncropped-400x400.png"
      && fs.existsSync(path.join(WORK, intoDir.name)), intoDir.name);

  /* The canvas sizes and shapes the page offers, listed by asking the page.
     Nothing in `cli/` keeps a copy of them, so the thing to check is that
     what comes out of the terminal is what is on the buttons. */
  const sizes = await json("uncrop", "sizes");
  ok("the sizes command lists the page's own presets and shapes",
    sizes.sizes.length === 7 && sizes.shapes.length === 8
      && sizes.sizes.find((f) => f.name === "2480x3508").label === "A4 at 300 dpi"
      && sizes.shapes[0].name === "keep",
    JSON.stringify(sizes.sizes.map((f) => f.name)));

  /* And a preset can be asked for by the words on its button, which is the
     half of this the page has to do because the words are the page's. */
  const a4 = await json("uncrop", PHOTO, "--canvas", "a4at300dpi");
  ok("--canvas takes the name on a preset button as well as its figures",
    a4.plan.width === 2480 && a4.plan.height === 3508,
    `${a4.plan.width}×${a4.plan.height}`);
  const named = await run("uncrop", PHOTO, "--canvas", "enormous");
  ok("and a name that is neither is refused in the page's own words",
    named.code === 1 && /two numbers like 2560x1440/.test(named.err), named.err.trim());

  const swapped = await json("uncrop", PHOTO, "--canvas", "1920x1080", "--swap");
  ok("--swap is the page's Swap button",
    swapped.plan.width === 1080 && swapped.plan.height === 1920,
    `${swapped.plan.width}×${swapped.plan.height}`);

  /* *Show what was added*, which the page draws into its panel and the
     terminal saves at the size of the picture. */
  const marked = path.join(WORK, "cli-uncrop-marked.png");
  const both = await json("uncrop", PHOTO, "--canvas", "1200x900", "--fill", "reflect",
    "--out", asPng, "--show-added", marked);
  ok("--show-added writes a second picture beside the first",
    both.wrote.endsWith("cli-uncrop.png") && both.marked.endsWith("cli-uncrop-marked.png")
      && fs.existsSync(marked), JSON.stringify([both.wrote, both.marked]));
  ok("and it is the same canvas, marked rather than cropped or resized",
    (await json("image-compressor", marked)).original.width === 1200
      && !fs.readFileSync(marked).equals(fs.readFileSync(asPng)),
    `${fs.statSync(marked).size} bytes against ${fs.statSync(asPng).size}`);

  const markedDir = await json("uncrop", PHOTO, "--canvas", "400x400", "--fill", "reflect",
    "--show-added", WORK + path.sep);
  ok("into a directory it is named for what it is, and the run still happened",
    markedDir.marked.endsWith("cli-photo-what-was-added-400x400.png")
      && markedDir.wrote === null && markedDir.seconds !== undefined,
    JSON.stringify([markedDir.marked, markedDir.wrote]));
}

/* ----------------------------------------------------- uncrop, a batch -- */

/* A border on each side, and several pictures in one command. The border is
   the page's four Add fields, handed over as typed, so `15%h` is worked out by
   the page; the batch is the same page and the same flags, once a picture,
   with the page and the model loaded once. The pictures are a folder of three
   of different shapes, with a file that is not a picture and a file this
   command wrote last time sitting among them, because a real folder has
   both. */
const BATCH = path.join(WORK, "cli-batch");
const BATCH_OUT = path.join(WORK, "cli-batch-out");
fs.rmSync(BATCH, { recursive: true, force: true });
fs.rmSync(BATCH_OUT, { recursive: true, force: true });
fs.mkdirSync(BATCH, { recursive: true });
const shades = (W, H, k) => pngOf(W, H, (y) => {
  const line = [];
  for (let x = 0; x < W; x++) line.push((x * k) & 255, (y * 3) & 255, (x + y * k) & 255);
  return line;
});
fs.writeFileSync(path.join(BATCH, "cover-1.png"), shades(200, 300, 3));
fs.writeFileSync(path.join(BATCH, "cover-2.png"), shades(120, 180, 5));
fs.writeFileSync(path.join(BATCH, "cover-10.png"), shades(300, 200, 7));
fs.writeFileSync(path.join(BATCH, "notes.txt"), "not a picture");
fs.writeFileSync(path.join(BATCH, "cover-1-uncropped.png"), shades(10, 10, 1));
const ihdrOf = (file) => {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

{
  const d = await json("uncrop", BATCH, "--left", "15%h", "--fill", "reflect", "--out", BATCH_OUT);
  ok("a folder is a batch of the pictures in it, in name order, numbers as numbers",
    d.pictures.map((p) => path.basename(p.file)).join() === "cover-1.png,cover-2.png,cover-10.png",
    d.pictures.map((p) => p.file).join(", "));
  ok("leaving out what is not a picture and what this command wrote last time",
    d.total.pictures === 3 && d.total.written === 3 && d.total.failed === 0,
    JSON.stringify(d.total));
  const written = ["cover-1", "cover-2", "cover-10"].map((n) => path.join(BATCH_OUT, `${n}-uncropped.png`));
  ok("each is written into --out as <its name>-uncropped, with no slash needed on the end",
    written.every((f) => fs.existsSync(f)) && magic(written[0]) === "png",
    fs.existsSync(BATCH_OUT) ? fs.readdirSync(BATCH_OUT).join(", ") : "no folder");
  ok("and each got 15% of its own height on the left, worked out by the page",
    JSON.stringify(written.map(ihdrOf)) === JSON.stringify([
      { w: 245, h: 300 }, { w: 147, h: 180 }, { w: 330, h: 200 }])
      && d.pictures[0].plan.gaps.left === 45 && d.pictures[0].plan.gaps.right === 0,
    JSON.stringify(written.map((f) => fs.existsSync(f) ? ihdrOf(f) : null)));
  /* Not checked: that each picture's wait is for *that* picture to open
     (`loads` going up) rather than for any picture to be there. Waiting on
     the wrong thing was tried and nothing here noticed, because a picture
     this small opens before the next call reaches the page, and `handIn`
     refuses a load count that did not move anyway. The race is real for a
     big picture and cannot be staged with a small one. */
  ok("every picture in it was really run",
    d.pictures.every((p) => p.ran === "mirror") && d.fill === "reflect",
    JSON.stringify(d.pictures.map((p) => p.ran)));

  /* One picture of the batch, on its own, with the same flag, is the same
     file — the batch is the single command again, not a second way of doing
     it. And its name is the single command's, with the size in it. */
  const single = path.join(WORK, "cli-batch-single.png");
  const alone = await json("uncrop", path.join(BATCH, "cover-2.png"), "--left", "15%h",
    "--fill", "reflect", "--out", single);
  ok("a picture out of a batch is that picture uncropped on its own, byte for byte",
    fs.readFileSync(single).equals(fs.readFileSync(written[1])) && alone.plan.width === 147,
    `${fs.statSync(single).size} against ${fs.statSync(written[1]).size}`);
  const intoDir = await json("uncrop", path.join(BATCH, "cover-2.png"), "--left", "15%h",
    "--fill", "reflect", "--out", WORK + path.sep);
  ok("and one picture on its own keeps the name the page's Save button gives it",
    intoDir.name === "cover-2-uncropped-147x180.png", intoDir.name);

  /* Readable, as it goes: a line a picture and a total. */
  const said = await run("uncrop", path.join(BATCH, "cover-1.png"), path.join(BATCH, "cover-2.png"),
    "--right", "40", "--top", "10%", "--fill", "reflect", "--out", path.join(WORK, "cli-batch-said"));
  ok("a batch reports each picture as it goes, and a total",
    said.code === 0 && /1\/2\s+cover-1\.png/.test(said.out) && /2\/2\s+cover-2\.png/.test(said.out)
      && /2 of 2 written/.test(said.out) && /200 × 300 → 240 × 330/.test(said.out),
    said.out.trim() + said.err.trim());

  const looked = await json("uncrop", BATCH, "--left", "74");
  ok("a batch with no --out reads every picture and writes nothing",
    looked.total.written === 0 && looked.pictures.every((p) => p.wrote === null && p.plan.gaps.left === 74),
    JSON.stringify(looked.total));

  /* A picture in the middle of a batch that will not open is named, and the
     rest still run; the exit says something went wrong. */
  const broken = path.join(WORK, "cli-batch-broken.png");
  fs.writeFileSync(broken, Buffer.from("this is not a png at all"));
  const mixed = await run("uncrop", path.join(BATCH, "cover-1.png"), broken, path.join(BATCH, "cover-2.png"),
    "--left", "10", "--fill", "reflect", "--out", path.join(WORK, "cli-batch-mixed"), "--json");
  let m = null;
  try { m = JSON.parse(mixed.out); } catch { /* reported below */ }
  ok("a picture that will not open is named, the rest are still written, and the exit is 1",
    mixed.code === 1 && m && m.total.written === 2 && m.total.failed === 1
      && /not an image this browser can read/.test(m.pictures[1].error),
    mixed.out.slice(0, 600) + mixed.err);

  const oneFile = await run("uncrop", BATCH, "--left", "10", "--out", path.join(WORK, "x.png"));
  ok("a batch's --out is a directory, and a name ending .png is refused before anything runs",
    oneFile.code === 1 && /has to be a directory/.test(oneFile.err), oneFile.err.trim());
  const clash = await run("uncrop", PHOTO, "--left", "10%", "--canvas", "800x600");
  ok("a border and a canvas both saying how big it is is refused",
    clash.code === 1 && /use one or the other/.test(clash.err), clash.err.trim());
  const notOne = await run("uncrop", PHOTO, "--left", "lots");
  ok("and a border that is not one is a sentence, before a browser is launched",
    notOne.code === 1 && /--left wants pixels like 40/.test(notOne.err), notOne.err.trim());
  const empty = path.join(WORK, "cli-batch-empty");
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(path.join(empty, "readme.txt"), "nothing");
  const none = await run("uncrop", empty, "--left", "10");
  ok("a folder with no pictures in it says so",
    none.code === 1 && /has no pictures in it/.test(none.err), none.err.trim());

  const help = await run("uncrop", "--help");
  ok("--help puts the batch and the border up front, and best as the default fill",
    /--left <n\|n%>/.test(help.out) && /<folder>/.test(help.out) && /The page opens on best/.test(help.out),
    help.out.slice(0, 400));
}

/* -------------------------------------------- a browser that remembers -- */

/* Each command used to start a fresh browser profile, so the 206 MB of LaMa
   weights uncrop.html keeps in IndexedDB were fetched again for every
   picture. The command line now keeps a profile and serves the checkout on
   the same port each time, because storage belongs to an origin and a port
   is part of one. Checked here through `drive` itself, in a profile of the
   suite's own, with something put in the page's weight store by one run and
   read back by the next — and the null, a fresh profile, which must not see
   it. */
{
  const { drive } = await import(pathToFileURL(path.join(REPO, "cli", "lib", "drive.mjs")).href);
  const kept = path.join(WORK, "cli-profile");
  fs.rmSync(kept, { recursive: true, force: true });
  const port = 47000 + (process.pid % 900);
  const first = await drive("uncrop.html", { profile: kept, port });
  await first.tab.evaluate(() => window.UNCROP.keep("probe", new Uint8Array([7, 8, 9]).buffer));
  const origin1 = first.origin;
  await first.close();
  const second = await drive("uncrop.html", { profile: kept, port });
  const back = await second.tab.evaluate(async () => {
    const got = await window.UNCROP.cached("probe");
    return got ? Array.from(new Uint8Array(got)) : null;
  });
  const origin2 = second.origin;
  await second.close();
  ok("a kept profile is served on the same origin every time",
    origin1 === origin2 && origin1.endsWith(`:${port}`) && first.kept && second.kept,
    `${origin1} then ${origin2}`);
  ok("so what a page keeps in its storage is still there on the next command",
    JSON.stringify(back) === "[7,8,9]", JSON.stringify(back));

  const fresh = await drive("uncrop.html", { profile: false });
  const nothing = await fresh.tab.evaluate(async () => (await window.UNCROP.cached("probe")) || null);
  await fresh.close();
  ok("and a fresh profile, which is what the suites run in, starts with none of it",
    nothing === null && !fresh.kept, JSON.stringify(nothing));

  /* `--help` needs no browser, so it must not need a Playwright either. */
  extraEnv = { PLAYWRIGHT_MODULE: path.join(WORK, "no-playwright-here", "index.mjs") };
  const bare = await run("uncrop", "--help");
  extraEnv = {};
  ok("--help answers without a Playwright to hand",
    bare.code === 0 && /--left/.test(bare.out), bare.err.trim().slice(0, 300));
}

/* ------------------------------------------------------- what goes wrong -- */

{
  const bad = await run("color-picker", "convert", "not-a-colour");
  ok("a colour the page cannot read exits non-zero and says so",
    bad.code === 1 && /not a colour/.test(bad.err), bad.err.trim());
  const rule = await run("color-picker", "palette", PICTURE, "--rule", "nonsense");
  ok("a flag with a fixed set of answers lists them when it is given another",
    rule.code === 1 && /--rule is one of/.test(rule.err), rule.err.trim());
  const nosuch = await run("nosuchpage", "convert", "red");
  ok("a page with no command line yet says that, rather than failing obscurely",
    nosuch.code === 2 && /no command line for/.test(nosuch.err), nosuch.err.trim());
  const missing = await run("color-picker", "palette", "no-such-file.png");
  ok("and a file that is not there is caught before a browser is launched",
    missing.code === 1 && /no such file/.test(missing.err), missing.err.trim());

  const toobig = await run("uncrop", PHOTO, "--canvas", "9000x9000");
  ok("a canvas past what the page will hold is refused with the page's reason",
    toobig.code === 1 && /ceiling of 64/.test(toobig.err), toobig.err.trim());
  const twoWays = await run("uncrop", PHOTO, "--canvas", "800x600", "--width", "800");
  ok("two ways of saying the same thing is refused rather than resolved",
    twoWays.code === 1 && /use one or the other/.test(twoWays.err), twoWays.err.trim());
  const lying = await run("uncrop", PHOTO, "--out", "x.png", "--format", "tiff");
  ok("a name that would lie about the format in it is refused",
    lying.code === 1 && /disagree about the format/.test(lying.err), lying.err.trim());
  const bothSizes = await run("uncrop", PHOTO, "--fit", "--scale", "2");
  ok("and two ways of sizing the picture is refused too",
    bothSizes.code === 1 && /use one/.test(bothSizes.err), bothSizes.err.trim());
}

/* ----------------------------------------- the same answer as the tab -- */

/* The point of the whole arrangement: the command line is the page, so the
   page had better agree with it. This drives color-picker.html the way a
   person would — type into the hex field, read the fields underneath — and
   holds the result against what the command printed. */
{
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(pathToFileURL(path.join(REPO, "color-picker.html")).href);
  await page.waitForTimeout(250);

  for (const colour of ["#4f8fd0", "#e03a3e", "#1e1e22"]) {
    await page.fill("#f-hex", colour);
    await page.waitForTimeout(120);
    const inTab = await page.evaluate(() => ({
      hsl: document.getElementById("f-hsl").textContent,
      oklch: document.getElementById("f-oklch").textContent,
      lab: document.getElementById("f-lab").textContent,
    }));
    const onCli = await json("color-picker", "convert", colour);
    ok(`${colour} reads the same in the tab as on the command line`,
      inTab.hsl === onCli.hsl && inTab.oklch === onCli.oklch && inTab.lab === onCli.lab,
      `${JSON.stringify(inTab)} vs ${JSON.stringify(onCli)}`);
  }

  /* And the palette, which is the one answer with a picture behind it.
     `palette <picture>` with no rule asked for is the image tab's own
     "Build a palette from this" button, which sets the rule back to Dominant
     and lets the picture decide the count — so that is the button to press
     here, rather than the palette tab's box left on whatever it was. */
  await page.click("#tab-image");
  await page.setInputFiles("#file", PICTURE);
  await page.waitForSelector("#stage-wrap:not([hidden])", { timeout: 15000 });
  await page.click("#img-palette");
  await page.waitForTimeout(300);
  const onScreen = await page.evaluate(() =>
    [...document.querySelectorAll("#pal-grid .swatch .hex")].map((e) => e.textContent.trim()));
  const printed = (await json("color-picker", "palette", PICTURE)).colors.map((c) => c.hex);
  ok("and a palette read off a picture is the same list either way",
    onScreen.join(" ") === printed.join(" "), `${onScreen.join(" ")} vs ${printed.join(" ")}`);

  ok("no page errors", errs.length === 0, errs.join(" | "));
  await browser.close();
}

/* ------------------------------ the same answer as the tab, compressing -- */

/* image-compressor.html driven by hand: the real file input, the real Save as
   box, the real sliders, and then the real Save button.

   The last of those is what makes this the strongest check in the file. The
   colour checks above compare two readings of a number; this compares two
   files. A download triggered by clicking the page's own button, and the file
   `--out` wrote at the same three settings, have to be byte for byte the same
   thing — which they can only be if the command line is pressing the page's
   own buttons rather than a copy of them. */
{
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1200 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(pathToFileURL(path.join(REPO, "image-compressor.html")).href);
  await page.setInputFiles("#fileInput", PHOTO);
  await page.waitForFunction(() => window.CLI.image().ready, null, { timeout: 30000 });

  /* Save as is a real select, so it is really selected. The two sliders are
     set and then told they moved, which is all a drag amounts to as far as
     the page is concerned — there is no way to drag a range input to an
     exact figure, and 400 is the figure the arithmetic above is about. */
  await page.selectOption("#formatSel", "image/jpeg");
  await page.evaluate(() => {
    for (const [id, value] of [["quality", "40"], ["scale", "400"]]) {
      const slider = document.getElementById(id);
      slider.value = value;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  /* Waiting on the answer rather than on a stopwatch: the page debounces its
     encode, so the tally saying 400×300 is what means it has caught up. */
  await page.waitForFunction(() => {
    const cell = document.querySelectorAll("#tally .cell")[1];
    return cell && cell.querySelector(".sub").textContent === "400×300 · jpeg";
  }, null, { timeout: 30000 });

  const inTab = await page.evaluate(() => ({
    cells: [...document.querySelectorAll("#tally .cell")].map((c) => ({
      cap: c.querySelector(".cap").textContent,
      n: c.querySelector(".n").textContent,
      sub: c.querySelector(".sub").textContent,
    })),
    status: document.getElementById("status").textContent.trim(),
  }));

  const sameAgain = path.join(WORK, "cli-same-again.jpg");
  fs.rmSync(sameAgain, { force: true });
  const onCli = await json("image-compressor", PHOTO, "--format", "jpeg",
                           "--quality", "40", "--max", "400", "--out", sameAgain);

  const parts = [onCli.original, onCli.compressed, onCli.saved];
  ok("the three figures on screen are the three the command line prints",
    inTab.cells.length === 3 && inTab.cells.every((c, i) => c.n === parts[i].human),
    `${inTab.cells.map((c) => c.n).join(" / ")} vs `
      + `${parts.map((x) => x.human).join(" / ")}`);
  ok("and so are the captions and the lines under them",
    inTab.cells.every((c, i) => c.cap === parts[i].cap && c.sub === parts[i].sub),
    `${inTab.cells.map((c) => c.cap + " " + c.sub).join(" / ")}`);
  ok("and the page's own status line came back with them",
    inTab.status === onCli.status, `${inTab.status} vs ${onCli.status}`);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#saveBtn"),
  ]);
  const byHand = path.join(WORK, "cli-by-hand.jpg");
  await download.saveAs(byHand);
  ok("the Save button's own name for the file is the name --out uses on a directory",
    download.suggestedFilename() === onCli.name,
    `${download.suggestedFilename()} vs ${onCli.name}`);
  ok("and the file saved by hand is byte for byte the file --out wrote",
    Buffer.compare(fs.readFileSync(byHand), fs.readFileSync(sameAgain)) === 0,
    `${fs.statSync(byHand).size} by hand vs ${fs.statSync(sameAgain).size} `
      + "from the command line");

  ok("no page errors from image-compressor.html", errs.length === 0, errs.join(" | "));
  await browser.close();
}

/* ------------------------------ the same answer as the tab, as a command -- */

/* playlist-to-audio.html driven by hand: the URL field, the tier cards, the
   box inside the card that is up, the checkboxes and the two selects. Then
   what the page shows is held against what the command printed.

   The first check is the one that would have caught the bug this page was
   fixed for. `playlist-to-audio <url>` with no flags is meant to be the page
   as it opens, and for a while the page as it opened was lying about itself:
   Balanced was lit up and the Smallest file command was underneath it. A
   command line that read the tier off the pressed card, or that had its own
   idea of what the default was, would pass everything above and fail here. */
{
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.location().url || "")) {
      errs.push(m.text());
    }
  });

  await page.goto(pathToFileURL(path.join(REPO, "playlist-to-audio.html")).href);

  /* Everything a person would read: the command, the annotations under it,
     and which card is pressed. */
  const shown = () => page.evaluate(() => ({
    cmd: document.getElementById("cmd").textContent,
    why: [...document.querySelectorAll("#why tr")]
      .map((tr) => [...tr.children].map((td) => td.textContent).join("␟")),
    pressed: [...document.querySelectorAll(".tier")]
      .find((b) => b.getAttribute("aria-pressed") === "true").dataset.tier,
  }));

  await page.fill("#url", MUSIC);
  let onScreen = await shown();
  let printed = await json("playlist-to-audio", MUSIC);
  ok("a playlist pasted in, and nothing else touched, is the bare command",
    onScreen.cmd === printed.prompt + printed.command,
    `${JSON.stringify(onScreen.cmd.slice(0, 70))}\n        vs `
      + JSON.stringify((printed.prompt + printed.command).slice(0, 70)));
  ok("and the tier the card shows is the tier the command line says it used",
    onScreen.pressed === printed.tier, `${onScreen.pressed} vs ${printed.tier}`);
  ok("with the page in the other browser showing the very same thing",
    onScreen.cmd === printed.shown, JSON.stringify(printed.shown.slice(0, 70)));

  /* And the same again with eight controls moved by hand, because a default
     agreeing is not the same as a setting agreeing. */
  await page.click('.tier[data-tier="max"]');
  await page.selectOption("#maxq", "wav");
  await page.selectOption("#shell", "bash");
  await page.selectOption("#cookies", "brave");
  await page.uncheck("#o-thumb");
  await page.uncheck("#o-slow");
  await page.check("#o-sponsor");
  await page.fill("#dest", "/srv/music");
  await page.fill("#items", "4-9");

  /* The eight flags for the eight controls, named once so the runs below
     cannot drift apart from each other. */
  const HAND = ["--tier", "max", "--quality", "wav", "--shell", "bash",
                "--cookies", "brave", "--no-cover", "--no-pauses",
                "--sponsorblock", "--to", "/srv/music", "--only", "4-9"];

  onScreen = await shown();
  printed = await json("playlist-to-audio", MUSIC, ...HAND);
  ok("eight controls moved by hand come out as the same command as eight flags",
    onScreen.cmd === printed.prompt + printed.command,
    `${JSON.stringify(onScreen.cmd.slice(0, 90))}\n        vs `
      + JSON.stringify((printed.prompt + printed.command).slice(0, 90)));

  /* The annotation table too, which is the part of the page a terminal
     otherwise has no way of seeing. `--why` prints these, so they are worth
     knowing to be the page's own sentences rather than a set written here. */
  ok("and the table under it is the annotations --why prints, in order",
    onScreen.why.join("\n") === printed.parts.filter((x) => x.why)
      .map((x) => `${x.arg.split(" ")[0]}␟${x.why}`).join("\n"),
    `${onScreen.why.length} rows on screen, `
      + `${printed.parts.filter((x) => x.why).length} printed`);

  const why = await run("playlist-to-audio", MUSIC, ...HAND, "--why");
  ok("which is what comes out of --why in prose",
    why.code === 0 && onScreen.why.every((row) =>
      why.out.includes(row.split("␟")[0])),
    why.out.slice(0, 120));

  /* One line, by the page's own button and by the flag. */
  await page.click("#wrap-btn");
  onScreen = await shown();
  printed = await json("playlist-to-audio", MUSIC, ...HAND, "--one-line");
  ok("and the Wrap lines button is --one-line, down to the spaces",
    onScreen.cmd === printed.prompt + printed.command,
    JSON.stringify(onScreen.cmd.slice(0, 90)));

  /* And the state that was the bug, which nothing outside the page can get
     it into any more. `tier` is a script-level binding, so the suite can set
     it by hand to prove the hook refuses to answer from a page that is
     showing one tier and would build another — rather than tripping over a
     <select> that does not exist and failing as a null dereference, which is
     how this read before the guard went in. */
  const confused = await page.evaluate(async () => {
    tier = "mp3";
    try { await window.CLI.jobs.command({ url: "PLabc" }); return "answered"; }
    catch (e) { return e.message; }
  });
  ok("a tier that is none of the three cards is refused in those words",
    /none of its three cards/.test(confused), confused);

  ok("no page errors from playlist-to-audio.html", errs.length === 0,
    errs.join(" | "));
  await browser.close();
}

/* ------------------------------ the same answer as the tab, uncropping -- */

/* uncrop.html driven by hand: the real file input, the real width and height
   fields, the real Centre button, the real fill buttons and the real Save.

   Then the same comparison that makes the image-compressor block the
   strongest in this file — two files rather than two readings of a number.
   The fill here is the mirror rather than a model, which is what makes the
   comparison possible at all: it is the one fill that fetches nothing, and it
   is drawn from the picture by arithmetic, so the same canvas and the same
   placement give the same bytes every time. A command line that had grown its
   own idea of where to put the picture, or of how far to mirror, would pass
   everything above and fail this. */
{
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1400 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(pathToFileURL(path.join(REPO, "uncrop.html")).href);
  await page.setInputFiles("#file", PHOTO);
  await page.waitForFunction(() => window.CLI.jobs.image().ready, null, { timeout: 30000 });

  /* Typed into the two fields, then centred with the button — which is what
     the command line's own default placement means, and the thing the two
     have to agree about. */
  await page.fill("#w", "1200");
  await page.fill("#h", "900");
  await page.click("#centre");
  await page.click('button[data-method="reflect"]');

  const figures = await page.textContent("#figures");
  const printed = await json("uncrop", PHOTO, "--canvas", "1200x900", "--fill", "reflect");
  ok("the figures on screen are the figures the terminal printed",
    figures.includes("1200 × 900") && figures.includes("1.08 MP")
      && figures.includes(`${Math.round(printed.plan.newShare * 100)}%`)
      && figures.includes("200 left") && figures.includes("1 pass"),
    `${figures.trim()} against ${JSON.stringify(printed.plan)}`);

  await page.click("#run");
  await page.waitForFunction(() => window.UNCROP.state.result, null, { timeout: 60000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#save"),
  ]);
  const byHand = path.join(WORK, "cli-uncrop-by-hand.png");
  await download.saveAs(byHand);

  const byFlag = path.join(WORK, "cli-uncrop-by-flag.png");
  const said = await json("uncrop", PHOTO, "--canvas", "1200x900",
    "--fill", "reflect", "--out", byFlag);
  ok("Save and --out give the file the same name",
    download.suggestedFilename() === said.name
      && said.name === "cli-photo-uncropped-1200x900.png",
    `${download.suggestedFilename()} against ${said.name}`);
  ok("and the same file, byte for byte",
    fs.readFileSync(byHand).equals(fs.readFileSync(byFlag)),
    `${fs.statSync(byHand).size} bytes by hand against ${fs.statSync(byFlag).size} by flag`);

  /* The page's own refusal, reached the way a person reaches it — by typing a
     number into the width field — and then read through the hook the way the
     terminal reads it, so the sentence in a tab is the sentence in a shell.
     The field used to clamp this quietly, which handed you a canvas you had
     not asked for and made the refusal unreachable. */
  await page.fill("#w", "20000");
  const onScreen = await page.textContent("#flag");
  const stillOff = await page.locator("#run").isDisabled();
  ok("a canvas no browser will draw is refused rather than quietly brought down",
    /16384 pixels on a side/.test(onScreen) && stillOff
      && (await page.evaluate(() => window.UNCROP.state.target.w)) === 20000,
    `${onScreen.trim()} (button disabled: ${stillOff})`);
  const refused = await page.evaluate(async () => {
    try { await window.CLI.jobs.run({ width: 20000, height: 1000 }); return "answered"; }
    catch (e) { return e.message; }
  });
  ok("and the terminal is told the same thing in the same words",
    /16384 pixels on a side/.test(refused), refused);

  /* The border, by hand: the picture in through the file input, 15%h typed
     into the page's own Add-left field, the mirror, Uncrop and Save. The file
     has to be the one the batch above wrote for the same picture with
     `--left 15%h` — which is the check that the command line has not grown
     its own idea of what fifteen per cent of a picture is. */
  await page.evaluate(() => { document.getElementById("file").value = ""; });
  await page.setInputFiles("#file", path.join(BATCH, "cover-2.png"));
  await page.waitForFunction(() => window.CLI.jobs.image().name === "cover-2", null, { timeout: 30000 });
  await page.locator("#addLeft").fill("15%h");
  await page.click('button[data-method="reflect"]');
  await page.click("#run");
  await page.waitForFunction(() => window.UNCROP.state.result, null, { timeout: 60000 });
  const [bordered] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
  const borderByHand = path.join(WORK, "cli-border-by-hand.png");
  await bordered.saveAs(borderByHand);
  ok("15%h typed into the page's Add field is the file --left 15%h wrote, byte for byte",
    fs.readFileSync(borderByHand).equals(fs.readFileSync(path.join(BATCH_OUT, "cover-2-uncropped.png"))),
    `${fs.statSync(borderByHand).size} bytes by hand against `
      + `${fs.statSync(path.join(BATCH_OUT, "cover-2-uncropped.png")).size} from the batch`);

  ok("no page errors from uncrop.html", errs.length === 0, errs.join(" | "));
  await browser.close();
}

/* --------------------------- the same answer as the tab, measuring -- */

/* ruler.html is the one page here whose whole point is a physical length, and
   a terminal has no glass to put one against. What it can have is the
   arithmetic, and the arithmetic is the half that goes wrong quietly: where
   each tick falls at a given density is a sum nobody checks by eye.

   So the command is run on figures that are not in doubt — ten centimetres at
   96 pixels to the inch is 377.95 pixels, and two inches in sixteenths is
   thirty-three ticks — and then the page is opened, set to the same density
   by typing in its own box, and the ticks it *drew* are read back off the
   canvas and held against the ones the command printed. A command line that
   had grown its own idea of how long a centimetre is would pass the first
   half and fail the second. */
{
  const d = await json("ruler", "ticks", "10cm", "--dpi", "96");
  ok("ticks gives every millimetre of ten centimetres",
    d.ticks.length === 101 && d.step === 1, `${d.ticks.length} ticks`);
  ok("and the figures sit on the centimetres",
    d.counts.join(",") === "11,10,80"
      && d.ticks.filter((t) => t.label !== null).map((t) => t.label).join("")
         === "012345678910",
    d.counts.join(","));
  ok("ten centimetres is 377.95 px at 96 to the inch, and the tick is there",
    d.ticks[100].px === 377.953 && d.lengthPx === 377.95,
    `${d.ticks[100].px} px`);

  const imp = await json("ruler", "ticks", "2in", "--units", "imperial",
    "--finest", "1/16", "--dpi", "96");
  ok("two inches in sixteenths is thirty-three ticks, halving all the way down",
    imp.ticks.length === 33 && imp.counts.join(",") === "3,2,4,8,16",
    imp.counts.join(","));
  ok("and an inch is 96 px at 96 px to the inch",
    imp.ticks[16].px === 96, String(imp.ticks[16].px));

  const conv = await json("ruler", "convert", "85.6mm", "--dpi", "96");
  ok("convert spells a bank card every way the readout does",
    conv.mm === 85.6 && conv.cm === 8.56 && conv.inches === 3.37008
      && conv.imperial === "3 3/8\u2033" && conv.px === 323.53,
    JSON.stringify(conv.imperial + " " + conv.px));

  const dial = await json("ruler", "dial", "6cm", "--degrees", "5", "--at", "37.5");
  ok("the dial marks 72 times at five degrees, with six rings in six centimetres",
    dial.ticks.length === 72 && dial.rings.length === 6, `${dial.ticks.length} marks`);
  ok("and reads the arm's tip where trigonometry puts it",
    Math.abs(dial.at.acrossMm - Math.cos(37.5 * Math.PI / 180) * 60) < 0.01
      && Math.abs(dial.at.upMm - Math.sin(37.5 * Math.PI / 180) * 60) < 0.01,
    `${dial.at.acrossMm}, ${dial.at.upMm}`);

  const refused = await run("ruler", "ticks", "--finest", "1/5");
  ok("a division the page has not got is refused in the page's own words",
    refused.code === 1 && /no 1\/5 division/.test(refused.err)
      && /5mm, 2mm, 1mm, 0.5mm/.test(refused.err), refused.err.trim());

  /* And now the page itself, driven by hand. */
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(`file://${path.join(REPO, "ruler.html")}`);
  await page.waitForFunction(() => window.RULER && window.CLI);
  await page.fill("#ppiIn", "96");
  await page.waitForFunction(() => Math.abs(window.RULER.state.cssPpi - 96) < 0.001);

  const drawn = await page.evaluate(() => {
    const c = document.getElementById("rule");
    const dpr = window.devicePixelRatio || 1;
    const img = c.getContext("2d").getImageData(0, 0, c.width, Math.round(7 * dpr));
    const found = [];
    for (let x = 0; x < c.width; x++) {
      for (let y = Math.ceil(2 * dpr); y < img.height; y++) {
        if (img.data[(y * c.width + x) * 4 + 3] > 40) { found.push(x / dpr); break; }
      }
    }
    return found;
  });
  const wanted = d.ticks.map((t) => Math.round(t.px));
  ok("every tick the command printed is a tick the page drew, to the pixel",
    wanted.every((px, i) => drawn[i] === px),
    `${drawn.slice(0, 4)} drawn against ${wanted.slice(0, 4)} printed`);

  /* The readout under the rule against `convert` on the same length: two
     different routes into the page's own arithmetic, which have to meet. */
  const rule = await page.locator("#rule").boundingBox();
  await page.mouse.click(rule.x + 200, rule.y + 40);
  await page.waitForFunction(() => window.RULER.state.markMm !== null);
  const onScreen = await page.textContent("#reading");
  const printed = await json("ruler", "convert", "52.9166666667mm", "--dpi", "96");
  ok("and a mark 200 px along reads what convert says 200 px is",
    onScreen.includes(printed.metric) && onScreen.includes(printed.imperial)
      && onScreen.includes("200 px"),
    `${onScreen.trim()} against ${printed.metric} / ${printed.imperial}`);

  ok("no page errors from ruler.html", errs.length === 0, errs.join(" | "));
  await browser.close();
}

/* --------------------------- the same answer as the tab, setting a quote -- */

/* quote-maker.html decides one number — how large the type has to be for the
   words to wrap inside the margin — and everything else follows from it. That
   is a measurement, which means it depends on the face, the canvas and the
   wrap all agreeing; and it is exactly the sort of thing a command line grows
   its own version of, because "fit some text in a box" looks like arithmetic
   anybody could redo in Node.

   So the command is run against figures that are not in doubt — the margin is
   nine per cent of the shorter side, so a 1200 x 800 canvas has a 1056-pixel
   box and no line may be wider than that — and then the page is opened, given
   the same quote through its own boxes, and asked what it made of it. The two
   have to agree to the pixel.

   No photograph in any of this: a suite that needed images.pexels.com would
   fail on a train. The picture half is covered in test-quote.mjs, with the
   CDN intercepted. */
{
  const QUOTE = "The mountains are calling and I must go.";
  const d = await json("quote-maker", QUOTE, "--by", "John Muir",
    "--canvas", "1200x800", "--font", "Georgia", "--fill", "100");

  ok("the canvas is the size it was asked for",
    d.width === 1200 && d.height === 800 && !d.capped, `${d.width}x${d.height}`);
  ok("and no line is wider than the nine-per-cent margin leaves room for",
    d.widest <= 1200 - Math.round(800 * 0.09) * 2,
    `${d.widest} wide in a ${1200 - Math.round(800 * 0.09) * 2} box`);
  ok("at full size the type is the size that fits and no more",
    d.size === d.fitted, `${d.size} vs ${d.fitted}`);
  ok("the words that went in are the words that came out",
    d.lines.join(" ") === QUOTE && d.author === "John Muir", d.lines.join("|"));
  ok("and nothing is written without --out",
    d.wrote === null && d.name.endsWith(".png"), String(d.wrote));

  const half = await json("quote-maker", QUOTE, "--canvas", "1200x800",
    "--font", "Georgia", "--fill", "50");
  ok("--fill 50 is half the fitted size, to the rounding",
    half.size === Math.max(4, Math.round(d.fitted * 0.5)),
    `${half.size} against ${Math.round(d.fitted * 0.5)}`);

  /* The page resolves the names, so these are the page's answers and not a
     copy of the list kept here. */
  const sizes = await json("quote-maker", "sizes");
  ok("sizes lists the presets with the limits on either side of them",
    sizes.sizes.length > 15 && sizes.sizes.some((x) => x.alias === "4k")
      && sizes.limits.maxSide === 65535, `${sizes.sizes.length} sizes`);
  const fonts = await json("quote-maker", "fonts");
  ok("fonts lists the drawer in vendor/fonts as well as the machine's own",
    fonts.fonts.filter((f) => f.where === "vendor").length === 31
      && fonts.fonts.some((f) => f.name === "Georgia" && f.where === "local"),
    `${fonts.fonts.length} faces`);
  const photos = await json("quote-maker", "photos");
  ok("photos lists the built-in photographs without fetching any of them",
    photos.photos.length === 27 && photos.photos.every((x) => x.id && x.by && x.page),
    `${photos.photos.length} photographs`);

  const badFace = await run("quote-maker", QUOTE, "--font", "Comic Papyrus");
  ok("a face the drawer has not got is refused in the page's own words",
    badFace.code === 1 && /no face called/.test(badFace.err)
      && /League Gothic/.test(badFace.err), badFace.err.trim().slice(0, 120));
  const badSize = await run("quote-maker", QUOTE, "--canvas", "retina-ish");
  ok("and so is a canvas it has not got",
    badSize.code === 1 && /no canvas called/.test(badSize.err), badSize.err.trim().slice(0, 100));
  const clash = await run("quote-maker", QUOTE, "--out", path.join(WORK, "q.jpg"),
    "--format", "png");
  ok("an ending and a --format that disagree are refused rather than resolved",
    clash.code === 1 && /disagree about the format/.test(clash.err), clash.err.trim());
  const stray = await run("quote-maker", QUOTE, "--colours", "#fff");
  ok("a flag that is nearly a flag is a sentence naming the real one",
    stray.code === 1 && /no flag called --colours/.test(stray.err)
      && /--colour/.test(stray.err), stray.err.trim());

  /* --out, under the three rules image-compressor settled. */
  const file = path.join(WORK, "cli-quote.png");
  fs.rmSync(file, { force: true });
  const wrote = await json("quote-maker", QUOTE, "--canvas", "640x480",
    "--font", "Georgia", "--out", file);
  const png = fs.readFileSync(file);
  ok("--out <file> writes a PNG the size of the canvas",
    png.readUInt32BE(16) === 640 && png.readUInt32BE(20) === 480
      && png.length === wrote.fileBytes,
    `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${png.length} bytes`);

  const dir = path.join(WORK, "cli-quotes");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const intoDir = await json("quote-maker", QUOTE, "--canvas", "320x240",
    "--format", "webp", "--out", dir + path.sep);
  ok("--out <dir>/ writes it under the name the page's own Save would give it",
    fs.existsSync(path.join(dir, intoDir.name)) && intoDir.name.endsWith(".webp")
      && magic(path.join(dir, intoDir.name)) === "webp",
    intoDir.name);

  /* A picture of its own, through the page's own file input. */
  const withPhoto = await json("quote-maker", QUOTE, "--canvas", "800x600",
    "--font", "Georgia", "--photo", PHOTO, "--shade", "60");
  ok("--photo <file> goes in through the page's own file input",
    withPhoto.photo && withPhoto.photo.from === "file"
      && withPhoto.photo.width === 800 && withPhoto.photo.height === 600,
    JSON.stringify(withPhoto.photo));
  ok("and the contrast is measured against it rather than against the plain colour",
    typeof withPhoto.contrast === "number" && withPhoto.contrast > 1,
    String(withPhoto.contrast));

  /* The same seed twice, which is the only reason a dice roll is worth having
     from a terminal at all. */
  const rollA = await json("quote-maker", QUOTE, "--random-font", "--random-colour",
    "--seed", "42");
  const rollB = await json("quote-maker", QUOTE, "--random-font", "--random-colour",
    "--seed", "42");
  ok("the same seed rolls the same face and colour from one run to the next",
    rollA.rolled.font === rollB.rolled.font
      && rollA.rolled.colour === rollB.rolled.colour,
    JSON.stringify([rollA.rolled, rollB.rolled]));
  ok("and --random-font did not swallow the quote after it",
    rollA.lines.join(" ") === QUOTE, rollA.lines.join(" "));

  /* And now the page itself, driven by hand. Georgia rather than one of the
     faces in vendor/fonts, because a @font-face loaded off file:// is blocked
     in Chrome and the point here is the fitting, not the fetching. */
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(pathToFileURL(path.join(REPO, "quote-maker.html")).href);
  await page.waitForFunction(() => window.CLI && window.CLI.image().renders > 0);
  await page.selectOption("#font", "Georgia");
  await page.fill("#width", "1200");
  await page.fill("#height", "800");
  await page.fill("#text", QUOTE);
  await page.fill("#author", "John Muir");
  /* A range input is not one Playwright will `fill`, so the slider is moved
     the way the page's own listener hears it. */
  await page.evaluate(() => {
    const f = document.getElementById("fill");
    f.value = "100";
    f.dispatchEvent(new Event("input"));
  });

  const inTab = await page.evaluate(async () => {
    /* The page's own plan, asked for the way the page asks itself — no
       settings handed in, so this is purely what the boxes above say. */
    const p = await window.CLI.jobs.make({});
    return { width: p.width, height: p.height, size: p.size, fitted: p.fitted,
      widest: p.widest, lines: p.lines, author: p.author };
  });

  ok("the tab lays the same quote out at the same type size as the terminal",
    inTab.size === d.size && inTab.fitted === d.fitted,
    `tab ${inTab.size}/${inTab.fitted}, terminal ${d.size}/${d.fitted}`);
  ok("and wraps it into the same lines, the same width",
    inTab.lines.join("|") === d.lines.join("|") && inTab.widest === d.widest,
    `${inTab.lines.join("|")} (${inTab.widest}) against ${d.lines.join("|")} (${d.widest})`);
  ok("and on the same canvas, with the same attribution",
    inTab.width === d.width && inTab.height === d.height && inTab.author === d.author,
    `${inTab.width}x${inTab.height} / ${inTab.author}`);

  ok("no page errors from quote-maker.html", errs.length === 0, errs.join(" | "));
  await browser.close();
}

/* --------------------------- the same answer as the tab, blowing an orb -- */

/* frutiger-orb.html is six drawing steps whose every measurement is a share
   of the orb, and the orb is a share of the shorter side of the canvas. That
   is arithmetic anybody could redo in Node — which is exactly why nobody
   should: two copies of "eighty per cent of the shorter side" drift the first
   time one of them learns about a margin.

   So the command is run against figures that are not in doubt — a 50% orb on
   an 800 x 600 canvas is 300 pixels across, its bloom at 55% of the radius is
   82.5, and the highlight at 72% of the diameter is 216 wide — and then the
   page is opened, set to the same thing through its own boxes and sliders,
   and asked what it made of it. The two have to agree to the pixel.

   Nothing here needs the network: the page fetches nothing and the one
   picture that goes in is painted at the top of this file. */
{
  const d = await json("frutiger-orb", "--canvas", "800x600", "--size", "50",
    "--colour", "#1a7ae0");

  ok("the canvas is the size it was asked for",
    d.width === 800 && d.height === 600 && !d.capped, `${d.width}x${d.height}`);
  ok("and the orb is half the shorter side, centred on it",
    d.diameter === 300 && d.cx === 400 && d.cy === 300,
    `${d.diameter} across at ${d.cx},${d.cy}`);
  ok("the bloom and the highlight are shares of the orb, not pixel counts",
    d.bloom.radius === 150 * 0.55 && d.highlight.width === 300 * 0.72
      && d.highlight.height === 300 * 0.48,
    `bloom r${d.bloom.radius}, highlight ${d.highlight.width}x${d.highlight.height}`);
  ok("the colour went in and came back with what the page makes of it",
    d.base === "#1a7ae0" && d.saturation === 79.2 && d.flat === false,
    `${d.base} at ${d.saturation}%`);
  ok("and nothing is written without --out",
    d.wrote === null && d.name === "orb-1a7ae0.png", String(d.wrote));

  /* The page's own defaults, which is what a command that says nothing has
     to be. Each of these is read off the control rather than echoed back. */
  /* `--json` is the only flag here, which is also what makes this run at all:
     run.mjs answers a command with no arguments and no flags with the help. */
  const bare = await json("frutiger-orb");
  ok("a command with nothing set is the page exactly as it opens",
    bare.width === 1000 && bare.diameter === 800 && bare.base === "#1a7ae0"
      && bare.opacity === 100 && bare.background === "#ffffff"
      && bare.bloom.blend === "overlay" && bare.format === "PNG",
    JSON.stringify({ w: bare.width, d: bare.diameter, c: bare.base,
      blend: bare.bloom.blend }));

  /* The page resolves the names, so these are the page's answers and not a
     copy of the list kept here. */
  const sizes = await json("frutiger-orb", "sizes");
  ok("sizes lists the presets, the formats and the blend modes together",
    sizes.sizes.some((x) => x.alias === "4k") && sizes.formats.length === 3
      && sizes.blends.some((b) => b.name === "overlay" && b.default)
      && sizes.limits.maxArea === 268435456,
    `${sizes.sizes.length} sizes, ${sizes.blends.length} blends`);

  const badBlend = await run("frutiger-orb", "--blend", "rainbow");
  ok("a blend mode the canvas has not got is refused in the page's own words",
    badBlend.code === 1 && /no blend mode called "rainbow"/.test(badBlend.err)
      && /soft-light/.test(badBlend.err), badBlend.err.trim().slice(0, 140));
  const badSize = await run("frutiger-orb", "--canvas", "retina-ish");
  ok("and so is a canvas it has not got",
    badSize.code === 1 && /no canvas called/.test(badSize.err), badSize.err.trim().slice(0, 100));
  const far = await run("frutiger-orb", "--opacity", "150");
  ok("a slider asked for more than it has says where its end is",
    far.code === 1 && /--opacity has to be between 0 and 100/.test(far.err),
    far.err.trim());
  const clash = await run("frutiger-orb", "--out", path.join(WORK, "o.jpg"),
    "--format", "png");
  ok("an ending and a --format that disagree are refused rather than resolved",
    clash.code === 1 && /disagree about the format/.test(clash.err), clash.err.trim());
  const stray = await run("frutiger-orb", "--colours", "#fff");
  ok("a flag that is nearly a flag is a sentence naming the real one",
    stray.code === 1 && /no flag called --colours/.test(stray.err)
      && /--colour/.test(stray.err), stray.err.trim());

  /* --out, under the three rules image-compressor settled. */
  const file = path.join(WORK, "cli-orb.png");
  fs.rmSync(file, { force: true });
  const wrote = await json("frutiger-orb", "--canvas", "640x480", "--out", file);
  const png = fs.readFileSync(file);
  ok("--out <file> writes a PNG the size of the canvas",
    png.readUInt32BE(16) === 640 && png.readUInt32BE(20) === 480
      && png.length === wrote.fileBytes,
    `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${png.length} bytes`);

  const dir = path.join(WORK, "cli-orbs");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const intoDir = await json("frutiger-orb", "--canvas", "320x240",
    "--colour", "#e04b3c", "--format", "webp", "--out", dir + path.sep);
  ok("--out <dir>/ writes it under the name the page's own Save would give it",
    intoDir.name === "orb-e04b3c.webp" && magic(path.join(dir, intoDir.name)) === "webp",
    intoDir.name);

  /* A texture of its own, through the page's own file input. The bands
     picture is 600 x 300, so covering a 300-pixel square scales it by one and
     is cropped left and right rather than squashed. */
  const withTexture = await json("frutiger-orb", "--canvas", "300x300",
    "--texture", PICTURE, "--size", "20");
  ok("--texture <file> goes in through the page's own file input",
    withTexture.texture && withTexture.texture.width === 600
      && withTexture.texture.height === 300, JSON.stringify(withTexture.texture));

  /* `--transparent` takes no value, so it must not swallow the word after it;
     and the file it writes has to really have nothing behind the orb, which
     is a question for the pixels and not for the JSON. */
  const clear = path.join(WORK, "cli-orb-clear.png");
  fs.rmSync(clear, { force: true });
  const clearSaid = await json("frutiger-orb", "--transparent", "--canvas", "240x240",
    "--out", clear);
  ok("--transparent did not swallow the flag after it",
    clearSaid.transparent === true && clearSaid.width === 240, JSON.stringify(clearSaid.asked));

  const flat = await json("frutiger-orb", "--transparent", "--format", "jpeg",
    "--canvas", "240x240");
  ok("and a JPEG is told it cannot have any, in a sentence",
    flat.transparentAsked && flat.transparent === false
      && /no transparency/.test(flat.status), flat.status);

  /* And now the page itself, driven by hand: the same canvas, the same orb,
     set through the boxes and the sliders rather than through the hook. */
  const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text());
  });

  await page.goto(pathToFileURL(path.join(REPO, "frutiger-orb.html")).href);
  await page.waitForFunction(() => window.CLI && window.CLI.image().renders > 0);
  await page.fill("#width", "800");
  await page.fill("#height", "600");
  /* A range input is not one Playwright will `fill`, so the slider is moved
     the way the page's own listener hears it. */
  await page.evaluate(() => {
    const s = document.getElementById("orbSize");
    s.value = "50";
    s.dispatchEvent(new Event("input"));
  });

  const inTab = await page.evaluate(async () => {
    /* The page's own figures, asked for the way the page asks itself — no
       settings handed in, so this is purely what the controls above say. */
    const p = await window.CLI.jobs.make({});
    return { width: p.width, height: p.height, diameter: p.diameter,
      radius: p.radius, cx: p.cx, cy: p.cy, base: p.base,
      saturation: p.saturation, highlight: p.highlight, bloom: p.bloom,
      name: p.name };
  });

  ok("the tab blows the same orb at the same size as the terminal",
    inTab.width === d.width && inTab.height === d.height
      && inTab.diameter === d.diameter && inTab.radius === d.radius,
    `tab ${inTab.width}x${inTab.height}/${inTab.diameter}, terminal ${d.width}x${d.height}/${d.diameter}`);
  ok("and puts the highlight and the bloom in the same places",
    JSON.stringify(inTab.highlight) === JSON.stringify(d.highlight)
      && JSON.stringify(inTab.bloom) === JSON.stringify(d.bloom),
    `${JSON.stringify(inTab.bloom)} against ${JSON.stringify(d.bloom)}`);
  ok("and would write the file under the same name",
    inTab.name === d.name && inTab.saturation === d.saturation,
    `${inTab.name} against ${d.name}`);

  /* The transparent PNG the command wrote, read back by the one thing in
     this repository that can read a PNG — the browser the page runs in. */
  const back = await page.evaluate(async (arr) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)]));
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    return { width: bmp.width, height: bmp.height,
      corner: px(2, 2), middle: px(bmp.width >> 1, bmp.height >> 1) };
  }, Array.from(fs.readFileSync(clear)));
  ok("the file --transparent wrote really has nothing behind the orb",
    back.width === 240 && back.corner[3] === 0 && back.middle[3] === 255,
    JSON.stringify([back.corner, back.middle]));

  ok("no page errors from frutiger-orb.html", errs.length === 0, errs.join(" | "));
  await browser.close();
}

process.exit(done());
