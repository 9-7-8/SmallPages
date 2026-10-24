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
import zlib from "node:zlib";
import { chromium, CHROMIUM_BIN, REPO, WORK, scoring } from "./lib/env.mjs";

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

const run = (...args) => new Promise((settle) => {
  const child = spawn(process.execPath, [CLI, ...args],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
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
    got.code === 0 && /color-picker/.test(got.out)
      && /image-compressor/.test(got.out), got.out.slice(0, 300));
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

  await page.goto(`file://${path.join(REPO, "color-picker.html")}`);
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

  await page.goto(`file://${path.join(REPO, "image-compressor.html")}`);
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

process.exit(done());
