/* The image compressor. A picture onto a canvas, back out through the
   browser's own encoder, and a seam to see what the saving cost.

   The tally adding up is the least of it, and is checked first and quickly.
   What this page is really promising is four things it could quietly stop
   doing without a label on screen changing at all:

     - that a lower quality is a smaller *file*, and not just a smaller
       number beside a slider;
     - that the cap on the longest side never enlarges anything;
     - that a JPEG, which has no alpha, comes back with white where the
       transparency was rather than the black a canvas would otherwise give
       it;
     - and that the EXIF block does not survive the trip, which is the page's
       privacy claim and the one thing here a reader cannot check by looking.

   So most of these checks open the saved file again rather than reading a
   figure off the screen, and they open it by handing it back to the page.
   The page is the only image decoder in this repository; a WebP reader
   written here to check a WebP written there would be exactly the second
   implementation the repo spends its time avoiding. Only the first few bytes
   are ever read in Node, and only to catch a WebP wearing a `.jpg` name. */
import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';
import fs from 'node:fs';

const { ok, done } = scoring();
const SITE = 'http://127.0.0.1:8099/image-compressor.html';

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 1400 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => {
  // The missing favicon is the container, not the page. Filtering on the
  // location rather than the text, because Chromium puts the file only there.
  if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text());
});

/* ---------------------------------------------------------- the pictures -- */

/* Drawn here rather than committed. Flat colour would encode to almost
   nothing at any quality at all and so could not show a quality setting
   doing anything, which is most of what this page does — so the main picture
   has detail in it, off a fixed sequence rather than `Math.random`, because a
   compressor test that measures a different picture every run measures luck. */
const PAINT = `
  const paint = {
    noise: (x, w, h) => {
      let seed = 12345;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const img = x.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
        const v = Math.sin(i / 9) * 60 + Math.sin(y / 13) * 60 + 128 + next() * 70;
        const at = (y * w + i) * 4;
        img.data[at] = v & 255;
        img.data[at + 1] = (v * 0.7 + 40) & 255;
        img.data[at + 2] = (v * 0.4 + 90) & 255;
        img.data[at + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    },
    /* Transparent, with one opaque block in the middle: what a JPEG has no
       way of carrying and has to put something behind. */
    holed: (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = '#20a050';
      x.fillRect(w / 4, h / 4, w / 2, h / 2);
    },
    /* Red on the left, blue on the right — so which way up a picture came
       out is a question about one pixel rather than about a shape. */
    halves: (x, w, h) => {
      x.fillStyle = '#e00000'; x.fillRect(0, 0, w / 2, h);
      x.fillStyle = '#0000e0'; x.fillRect(w / 2, 0, w / 2, h);
    },
  };
  const draw = (what, w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint[what](c.getContext('2d'), w, h);
    return c;
  };
`;

/* Hands the page a file the way the file input does, which is the way a
   dropped one arrives too. */
async function hand(spec) {
  await page.evaluate(async (s) => {
    const F = new Function(`${s.painters}; return { draw };`)();
    const blob = await new Promise(r =>
      F.draw(s.what, s.w, s.h).toBlob(r, s.type, s.quality));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], s.name, { type: s.type }));
    const input = document.getElementById('fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, { type: 'image/png', quality: undefined, ...spec, painters: PAINT });
}

/* The same picture, encoded but not handed over — for the one fixture that
   has to be edited on the way in. */
const encoded = (spec) => page.evaluate(async (s) => {
  const F = new Function(`${s.painters}; return { draw };`)();
  const blob = await new Promise(r =>
    F.draw(s.what, s.w, s.h).toBlob(r, s.type, s.quality));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}, { ...spec, painters: PAINT });

/* ------------------------------------------------------------- the state -- */

const state = () => page.evaluate(() => {
  const el = (id) => document.getElementById(id);
  return {
    status: el('status').textContent.trim(),
    failed: el('status').classList.contains('error'),
    shown: el('out').classList.contains('ready'),
    slim: el('dropzone').classList.contains('slim'),
    label: el('dropLabel').textContent,
    formats: [...el('formatSel').options].map(o => o.textContent),
    format: el('formatSel').value,
    formatNote: el('formatNote').textContent,
    quality: el('quality').value,
    qualityOut: el('qualityOut').textContent,
    qualityHidden: el('qualityField').classList.contains('off'),
    scale: el('scale').value,
    scaleMax: el('scale').max,
    scaleOut: el('scaleOut').textContent,
    scaleNote: el('scaleNote').textContent,
    cells: [...document.querySelectorAll('#tally .cell')].map(c => ({
      cap: c.querySelector('.cap').textContent,
      n: c.querySelector('.n').textContent,
      sub: c.querySelector('.sub').textContent,
      win: c.classList.contains('win'),
    })),
    bar: el('barFill').style.width,
    saveOff: el('saveBtn').disabled,
    seam: el('wipePos').value,
    clip: el('wipeTop').style.clipPath,
    seamAt: el('wipeSeam').style.left,
    layers: [!!document.querySelector('#wipeBase img'),
             !!document.querySelector('#wipeTop img')],
  };
});

/* Every successful encode puts a fresh object URL on the compressed layer, so
   that picture's own src is what says the answer on screen is the new one
   rather than the one that was already there. Waiting on a stopwatch instead
   would read the old encode on a slow machine and pass. */
const mark = () => page.evaluate(() =>
  (document.querySelector('#wipeTop img') || {}).src || '');

async function afterEncode(act) {
  const was = await mark();
  await act();
  await page.waitForFunction((src) => {
    const img = document.querySelector('#wipeTop img');
    return !!img && img.src !== src;
  }, was, { timeout: 60000, polling: 50 });
}

const slide = (id, value) => afterEncode(async () => {
  await page.fill(id, String(value));
  await page.locator(id).dispatchEvent('input');
});

/* ------------------------------------------------------- the saved files -- */

async function save(into) {
  const file = `${WORK}/${into}`;
  fs.rmSync(file, { force: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#saveBtn'),
  ]);
  await download.saveAs(file);
  return { file, name: download.suggestedFilename(), size: fs.statSync(file).size,
           bytes: fs.readFileSync(file) };
}

/* Not a decoder — just enough of the first bytes to catch a file written
   under a name that lies about what is in it. */
function magic(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF'
      && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return 'something else';
}

/* The saved file opened again and read as pixels, by the page, because the
   page is the decoder. `points` are [name, x, y]; each comes back as RGBA. */
const pixels = (file, type, points) => page.evaluate(async ([b64, mime, pts]) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const out = { size: [bmp.width, bmp.height] };
  for (const [name, x, y] of pts) {
    out[name] = [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
  }
  return out;
}, [fs.readFileSync(file).toString('base64'), type, points]);

/* ---------------------------------------------------- nothing open yet -- */

await page.goto(SITE);
await page.waitForTimeout(300);
let s = await state();

ok('starts with nothing open', s.status === 'Nothing open yet.' && !s.shown,
   `${s.status} / shown ${s.shown}`);
ok('and the dropzone is the big one, asking for a picture',
   !s.slim && /Drop an image here/.test(s.label), s.label);
/* The page builds this list by asking the canvas what it will encode, rather
   than assuming — Safari only learned WebP recently and nothing much writes
   AVIF. So the list is held against the same question asked independently,
   which is the claim. On a browser that writes all three, mind, a hardcoded
   list would look exactly like this one: what this check buys is a suite that
   is still right on a browser that writes two. */
const canWrite = await page.evaluate(() => {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const can = (t) => {
    try { return probe.toDataURL(t).startsWith(`data:${t}`); } catch { return false; }
  };
  return { JPEG: can('image/jpeg'), WebP: can('image/webp'), PNG: can('image/png') };
});
ok('the formats offered are the ones this browser will really write',
   s.formats.join(',') === Object.keys(canWrite).filter(n => canWrite[n]).join(','),
   `offers ${s.formats.join(',')}, can write ${JSON.stringify(canWrite)}`);
ok('WebP is the one it offers first, being the smallest at a given quality',
   s.format === 'image/webp' && /smaller than JPEG/.test(s.formatNote),
   `${s.format} — ${s.formatNote}`);
ok('the quality slider starts at 78 and says so', s.quality === '78'
   && s.qualityOut === '78' && !s.qualityHidden, `${s.quality}/${s.qualityOut}`);

/* ------------------------------------------------------- a picture lands -- */

await afterEncode(() => hand({ name: 'photo.png', what: 'noise', w: 800, h: 600 }));
s = await state();

ok('a picture opens the panel underneath', s.shown, String(s.shown));
ok('and the dropzone stands aside, offering to take another',
   s.slim && s.label === 'Open another image', `${s.slim} / ${s.label}`);
ok('both sides of the seam have a picture on them',
   s.layers.join() === 'true,true', s.layers.join());
ok('the cap starts at the picture\'s own longest side, so it cannot be enlarged',
   s.scaleMax === '800' && s.scale === '800', `${s.scale} of ${s.scaleMax}`);
ok('and says it is at full size rather than down from anything',
   s.scaleOut === '800px' && /800×600 — full size/.test(s.scaleNote), s.scaleNote);
ok('the tally has the three figures', s.cells.length === 3
   && s.cells.map(c => c.cap).join() === 'Original,Compressed,Saved',
   s.cells.map(c => c.cap).join());
ok('the original is named at the size it really is',
   /800×600 · png/.test(s.cells[0].sub), s.cells[0].sub);
ok('the compressed one is the same size, in the format asked for',
   /800×600 · webp/.test(s.cells[1].sub), s.cells[1].sub);
ok('something was saved, and the page is pleased about it',
   s.cells[2].win && /smaller/.test(s.cells[2].sub), s.cells[2].sub);
ok('and the status line says how much came off',
   /% off the original\.$/.test(s.status), s.status);

/* The one piece of arithmetic on the page: the three cells and the bar all
   come off one subtraction, so they have to agree with each other. */
const sums = await page.evaluate(() => {
  const n = (i) => document.querySelectorAll('#tally .cell')[i].querySelector('.n').textContent;
  const sub = (i) => document.querySelectorAll('#tally .cell')[i].querySelector('.sub').textContent;
  return { saved: n(2), pct: sub(2), bar: document.getElementById('barFill').style.width };
});
ok('the bar is as wide as the share of the original that is left',
   (() => {
     const left = 100 - parseFloat(sums.pct);
     return Math.abs(parseFloat(sums.bar) - left) < 1.5;
   })(), `bar ${sums.bar} against ${sums.pct} saved`);

/* ------------------------------------------------------------- quality -- */

/* The claim the slider makes. Measured on the files themselves rather than on
   the figure next to the slider, because that figure is the only thing a
   broken quality setting would still get right. */
await page.selectOption('#formatSel', 'image/jpeg');
await page.waitForTimeout(300);
s = await state();
ok('picking a lossy format leaves the quality slider where you can reach it',
   !s.qualityHidden && /opens anywhere/.test(s.formatNote), s.formatNote);

const sizes = [];
for (const q of [20, 60, 95]) {
  await slide('#quality', q);
  const got = await save(`imgc-q${q}.jpg`);
  sizes.push({ q, size: got.size, magic: magic(got.bytes) });
}
ok('a lower quality really is a smaller file, each step of the way',
   sizes[0].size < sizes[1].size && sizes[1].size < sizes[2].size,
   sizes.map(x => `q${x.q} ${x.size}`).join(' < '));
ok('and every one of them is a real JPEG on disk',
   sizes.every(x => x.magic === 'jpeg'), sizes.map(x => x.magic).join(' '));
s = await state();
ok('the slider shows the figure it is actually using',
   s.qualityOut === '95' && s.quality === '95', `${s.qualityOut}/${s.quality}`);

/* PNG has no quality to set, so the page takes the slider away rather than
   leaving one that does nothing. */
await afterEncode(() => page.selectOption('#formatSel', 'image/png'));
s = await state();
ok('a lossless format hides the quality slider instead of ignoring it',
   s.qualityHidden && /lossless/.test(s.formatNote), s.formatNote);

/* ----------------------------------------------------------- the cap -- */

await page.selectOption('#formatSel', 'image/webp');
await slide('#scale', 400);
s = await state();
ok('capping the longest side takes the short one with it, in proportion',
   /400×300 · webp/.test(s.cells[1].sub), s.cells[1].sub);
ok('and the note says what it came down from',
   /400×300 — down from 800×600/.test(s.scaleNote), s.scaleNote);

const shrunk = await save('imgc-400.webp');
ok('the file saved at that cap is a WebP', magic(shrunk.bytes) === 'webp',
   magic(shrunk.bytes));
const reread = await pixels(shrunk.file, 'image/webp', []);
ok('and the page, handed it back, opens it at exactly 400×300',
   reread.size.join('×') === '400×300', reread.size.join('×'));
ok('the name it saves under is the picture\'s own, marked small',
   shrunk.name === 'photo-small.webp', shrunk.name);

/* Never enlarged, in the two places that has to hold: the slider will not
   offer more than the picture, and the arithmetic will not act on more than
   the picture. This is the first of them. */
await slide('#scale', 800);
s = await state();
ok('asking for the whole picture gives the whole picture and no more',
   /800×600 · webp/.test(s.cells[1].sub) && /full size/.test(s.scaleNote),
   `${s.cells[1].sub} — ${s.scaleNote}`);

/* And this is the second, which takes some getting at. Because the slider
   will not offer more than the picture, the clamp underneath is never
   normally asked to refuse anything — so it could stop refusing and nothing
   on this page would look any different. Lifting the ceiling and asking for
   three times the picture is the only way to see that it still does, and a
   page that later let somebody type a figure in would be leaning on it. */
await afterEncode(async () => {
  await page.evaluate(() => { document.getElementById('scale').max = '4000'; });
  await page.fill('#scale', '2400');
  await page.locator('#scale').dispatchEvent('input');
});
s = await state();
ok('and asking past the picture, with the slider\'s ceiling lifted, still will not enlarge it',
   /800×600 · webp/.test(s.cells[1].sub) && s.scale === '2400',
   `${s.cells[1].sub} at a cap of ${s.scale}`);

/* ------------------------------------------------------------- the seam -- */

await page.focus('#wipePos');
await page.keyboard.press('Home');
s = await state();
ok('Home puts the compressed version over the whole frame',
   s.seam === '0' && /inset\(0(px)? 0(px)? 0(px)? 0%?\)/.test(s.clip.replace(/\s+/g, ' ')),
   `${s.seam} — ${s.clip}`);
await page.keyboard.press('End');
s = await state();
ok('and End takes it off again, leaving the original underneath',
   s.seam === '100' && /100%\)/.test(s.clip) && s.seamAt === '100%',
   `${s.seam} — ${s.clip} — ${s.seamAt}`);

await page.fill('#wipePos', '40');
await page.locator('#wipePos').dispatchEvent('input');
s = await state();
ok('the seam clips the compressed side from where it sits rightwards',
   /inset\(.*40%\)/.test(s.clip) && s.seamAt === '40%',
   `${s.clip} — ${s.seamAt}`);

/* ---------------------------------------------- what a JPEG does with alpha -- */

/* A JPEG has no alpha channel, so something has to go behind the picture. A
   canvas left to itself gives black, which is the wrong answer and a nasty
   surprise on a logo; the page fills white first, which is what every other
   tool does. The check is on the saved file, since this is a claim about what
   somebody else will open. */
await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => hand({ name: 'logo.png', what: 'holed', w: 200, h: 200 }));

await afterEncode(() => page.selectOption('#formatSel', 'image/jpeg'));
const flat = await save('imgc-alpha.jpg');
const onWhite = await pixels(flat.file, 'image/jpeg',
  [['corner', 10, 10], ['middle', 100, 100]]);
ok('a transparent corner comes out white in a JPEG, not black',
   onWhite.corner.slice(0, 3).every(v => v > 245) && onWhite.corner[3] === 255,
   `corner rgba ${onWhite.corner.join(',')}`);
ok('and what was opaque is still there, the colour it was',
   onWhite.middle[1] > onWhite.middle[0] && onWhite.middle[1] > onWhite.middle[2],
   `middle rgba ${onWhite.middle.join(',')}`);

await afterEncode(() => page.selectOption('#formatSel', 'image/png'));
const kept = await save('imgc-alpha.png');
const onClear = await pixels(kept.file, 'image/png',
  [['corner', 10, 10], ['middle', 100, 100]]);
ok('a PNG keeps the transparency instead, which is what it is in the list for',
   onClear.corner[3] === 0, `corner rgba ${onClear.corner.join(',')}`);
ok('with the opaque part untouched', onClear.middle[3] === 255
   && onClear.middle[1] > onClear.middle[0], `middle rgba ${onClear.middle.join(',')}`);

/* ------------------------------------------- bigger than it started -- */

/* The page says plainly that a canvas PNG will often come out bigger, and
   gives different advice depending on whether there is a quality to lower.
   Both branches are reachable on purpose: a picture that arrives as a
   low-quality JPEG is small enough that almost anything is bigger. */
await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => hand({ name: 'small.jpg', what: 'noise', w: 500, h: 400,
                               type: 'image/jpeg', quality: 0.2 }));
await afterEncode(() => page.selectOption('#formatSel', 'image/png'));
s = await state();
ok('a file that grew is called Added rather than Saved, and is not celebrated',
   s.cells[2].cap === 'Added' && !s.cells[2].win
     && /\+/.test(s.cells[2].n) && /bigger/.test(s.cells[2].sub),
   `${s.cells[2].cap} ${s.cells[2].n} ${s.cells[2].sub}`);
ok('and for a lossless format the advice is to try WebP, not a lower quality',
   /PNG from a canvas usually is; try WebP\./.test(s.status), s.status);

await afterEncode(() => page.selectOption('#formatSel', 'image/jpeg'));
await slide('#quality', 100);
s = await state();
ok('while a lossy one that grew is told to come down instead',
   s.cells[2].cap === 'Added' && /Try a lower quality\./.test(s.status), s.status);

/* ------------------------------------------------- the EXIF block -- */

/* The page's privacy claim: re-encoding keeps the pixels and drops everything
   else, which takes the camera, the timestamp and the GPS coordinates with
   it. The fixture is built here rather than committed, because a photograph
   with real EXIF in it is somebody's photograph — a marker string stands in
   for the lot, and the check is that it is nowhere in what came out.

   The orientation flag rides along with it to answer the other half: the
   picture is stored on its side and has to come out the way the page showed
   it. Chromium honours that flag on decode by itself these days, so this is
   not a check of the one argument that asks it to — it is a check that the
   size reported, the pixels saved and the picture on screen all agree about
   which way up it ended up. */
function exifApp1({ orientation, note }) {
  const text = Buffer.from(note + '\0', 'latin1');
  const head = Buffer.alloc(8);
  head.write('II', 0, 'latin1');          // little-endian, and say so twice
  head.writeUInt16LE(0x2a, 2);
  head.writeUInt32LE(8, 4);               // IFD0 begins right after this
  const ifd = Buffer.alloc(2 + 2 * 12 + 4);
  ifd.writeUInt16LE(2, 0);                // two entries, in tag order
  const at = 8 + ifd.length;              // where the string itself will sit
  ifd.writeUInt16LE(0x010e, 2); ifd.writeUInt16LE(2, 4);          // description
  ifd.writeUInt32LE(text.length, 6); ifd.writeUInt32LE(at, 10);
  ifd.writeUInt16LE(0x0112, 14); ifd.writeUInt16LE(3, 16);        // orientation
  ifd.writeUInt32LE(1, 18); ifd.writeUInt16LE(orientation, 22);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), head, ifd, text]);
  const marker = Buffer.alloc(4);
  marker.writeUInt16BE(0xffe1, 0);
  marker.writeUInt16BE(app1.length + 2, 2);
  return Buffer.concat([marker, app1]);
}

const SECRET = 'SMALLPAGES-EXIF-MUST-NOT-SURVIVE';
const plain = Buffer.from(await encoded({ what: 'halves', w: 400, h: 200,
                                          type: 'image/jpeg', quality: 0.95 }));
const turned = `${WORK}/imgc-sideways.jpg`;
fs.writeFileSync(turned, Buffer.concat([
  plain.subarray(0, 2),                   // the SOI, then the block, then the rest
  exifApp1({ orientation: 6, note: SECRET }),
  plain.subarray(2),
]));
ok('the fixture really does carry the EXIF it is about to lose',
   fs.readFileSync(turned).includes(Buffer.from(SECRET)), 'built without it');

await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => page.setInputFiles('#fileInput', turned));
s = await state();
ok('a picture stored on its side is reported the way up it is shown',
   /200×400 · jpeg/.test(s.cells[0].sub), s.cells[0].sub);
ok('and the compressed copy is that way up too, not the stored way',
   /200×400/.test(s.cells[1].sub), s.cells[1].sub);

await afterEncode(() => page.selectOption('#formatSel', 'image/png'));
const stripped = await save('imgc-stripped.png');
ok('nothing of the EXIF block survives into the saved file',
   !stripped.bytes.includes(Buffer.from(SECRET))
     && !stripped.bytes.includes(Buffer.from('Exif')),
   'the marker string came through');

const turnedOut = await pixels(stripped.file, 'image/png',
  [['top', 100, 10], ['bottom', 100, 390]]);
ok('and the saved pixels are the rotated ones: red above, blue below',
   turnedOut.size.join('×') === '200×400'
     && turnedOut.top[0] > 150 && turnedOut.top[2] < 100
     && turnedOut.bottom[2] > 150 && turnedOut.bottom[0] < 100,
   `${turnedOut.size.join('×')} top ${turnedOut.top.join(',')} `
     + `bottom ${turnedOut.bottom.join(',')}`);

/* --------------------------------------------- when the encoder gives up -- */

/* The failure being guarded against is real and absurd to carry a fixture
   for: past about 268 megapixels a canvas is handed over as normal, gives up
   a context as normal, then paints nothing at all and lets `toBlob` return
   null without a word anywhere. A 400-megapixel scan takes that path.
   Replacing `toBlob` is the same failure for the price of two lines.

   What used to happen next was worse than an error. The page kept the
   previous run's tally, kept the previous picture under the seam, let Save
   hand that file over — and the cheerful "Saved" message wrote over the
   complaint, so the last thing on screen said it had worked. */
await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => hand({ name: 'photo.png', what: 'noise', w: 400, h: 300 }));
s = await state();
ok('before the injection there is a good answer here to lose',
   s.cells.length === 3 && s.layers[1] && !s.saveOff && !s.failed,
   `${s.cells.length} cells, save ${s.saveOff ? 'off' : 'on'}`);

await page.evaluate(() => {
  window.__toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
});
await page.fill('#quality', '25');
await page.locator('#quality').dispatchEvent('input');
await page.waitForFunction(() =>
  document.getElementById('status').classList.contains('error'),
  null, { timeout: 15000 });
s = await state();
ok('an encode that fails says so, in red', s.failed
   && /Couldn.t encode that/.test(s.status), s.status);
ok('and leaves no tally standing from the run before it',
   s.cells.length === 0, `${s.cells.length} cells still there`);
ok('nor the picture that went with it under the seam',
   !s.layers[1] && s.layers[0], s.layers.join());
ok('nor a bar still claiming a saving', s.bar === '0%', s.bar);
ok('and Save is not offered at all', s.saveOff, 'still live');

/* Belt and braces, because the disabled button is only the first of the two:
   made to fire anyway, the handler has to refuse by itself. */
const pending = page.waitForEvent('download', { timeout: 2500 })
  .then(d => d.suggestedFilename()).catch(() => null);
await page.evaluate(() => {
  document.getElementById('saveBtn')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const forced = await pending;
s = await state();
ok('made to fire anyway it hands nothing over, and the complaint still stands',
   forced === null && s.failed && /Couldn.t encode that/.test(s.status),
   `${forced} / ${s.status}`);

/* And it has to come back. A page that went quiet for good on one bad encode
   would be a worse bug than the one this is about. */
await afterEncode(() => page.evaluate(() => {
  HTMLCanvasElement.prototype.toBlob = window.__toBlob;
  const q = document.getElementById('quality');
  q.value = '55';
  q.dispatchEvent(new Event('input', { bubbles: true }));
}));
s = await state();
ok('and when the encoder works again the page comes back on its own',
   !s.failed && s.cells.length === 3 && s.layers[1] && !s.saveOff
     && /% off the original/.test(s.status), s.status);
/* The page logs what went wrong, which is right of it — but that failure was
   ours, so it is taken off the list the last check in this file reads.
   Anything else it logged stays on. */
const logged = errs.filter(e => /gave nothing back/.test(e));
ok('and the failure left a note in the console for whoever opens it',
   logged.length > 0, 'nothing was logged');
for (let i = errs.length - 1; i >= 0; i--) {
  if (/gave nothing back/.test(errs[i])) errs.splice(i, 1);
}

const recovered = await save('imgc-recovered.webp');
const recoveredBack = await pixels(recovered.file, 'image/webp', []);
ok('with a Save that hands over a real file again',
   magic(recovered.bytes) === 'webp' && recoveredBack.size.join('×') === '400×300',
   `${magic(recovered.bytes)} ${recoveredBack.size.join('×')}`);

/* ----------------------------------------------- the browser's ceiling -- */

/* A picture wider than a canvas will go. The slider cannot ask for less than
   the whole of it, since its ceiling is the picture, so this is the one size
   the page has to decide on the reader's behalf — and the note under the
   slider is where that gets admitted.

   16400 across is over the side ceiling while well under the area one, which
   keeps the fixture a few hundred kilobytes rather than a gigabyte. Note the
   asymmetry it rests on: this Chromium will paint a 16400-wide canvas quite
   happily, which is how the fixture gets drawn at all, and the page refuses
   it anyway because which limit bites varies by browser and build.

   Two things this cannot reach, written down rather than left to be
   discovered. The side ceiling is guarded twice — once by the proportional
   shrink and once by a plain clamp on each side — so taking either away on
   its own still comes out at 16383 here and no check below moves. And the
   area ceiling cannot be reached at all: a source over 268 megapixels is a
   gigabyte of fixture and a canvas this browser will not paint in the first
   place, which is rather the point. What an over-area canvas *does* —
   paint nothing and return null from `toBlob` — is the failure injected in
   the section above, so its consequence is covered even though its cause
   cannot be staged. */
await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => hand({ name: 'panorama.png', what: 'halves', w: 16400, h: 100 }));
s = await state();
ok('a picture past what a canvas will paint is brought down to fit',
   /16383×100 · webp/.test(s.cells[1].sub), s.cells[1].sub);
ok('and the note says that is why, rather than calling it full size',
   /16383×100 — brought down to what this browser will draw/.test(s.scaleNote),
   s.scaleNote);
ok('while the original is still reported at the size it really is',
   /16400×100 · png/.test(s.cells[0].sub), s.cells[0].sub);

const wide = await save('imgc-wide.webp');
const widePixels = await pixels(wide.file, 'image/webp',
  [['left', 1000, 50], ['right', 15000, 50]]);
ok('and what it saves is the picture, not the blank an oversized canvas gives',
   widePixels.size.join('×') === '16383×100'
     && widePixels.left[0] > 140 && widePixels.left[2] < 110
     && widePixels.right[2] > 140 && widePixels.right[0] < 110,
   `${widePixels.size.join('×')} left ${widePixels.left.join(',')} `
     + `right ${widePixels.right.join(',')}`);

/* ------------------------------------------------- the other ways in -- */

/* Dropping and pasting are the two ways in that are not the file input, and
   both are a listener on the document that could be removed without anything
   else on the page noticing. */
await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => page.evaluate(async (painters) => {
  const F = new Function(`${painters}; return { draw };`)();
  const blob = await new Promise(r => F.draw('noise', 300, 200).toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true,
                                                 cancelable: true }));
}, PAINT));
s = await state();
ok('a dropped picture opens like any other', s.shown
   && /300×200 · png/.test(s.cells[0].sub), s.cells[0].sub);
ok('and the dropzone is not left looking like something is being dragged over it',
   !(await page.evaluate(() =>
     document.getElementById('dropzone').classList.contains('drag'))), 'still lit');

await page.goto(SITE);
await page.waitForTimeout(200);
await afterEncode(() => page.evaluate(async (painters) => {
  const F = new Function(`${painters}; return { draw };`)();
  const blob = await new Promise(r => F.draw('noise', 240, 160).toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt,
                                                       bubbles: true, cancelable: true }));
}, PAINT));
s = await state();
ok('and so does a pasted one', s.shown && /240×160 · png/.test(s.cells[0].sub),
   s.cells[0].sub);

/* ------------------------------------------------- what it will not open -- */

await page.goto(SITE);
await page.waitForTimeout(200);
const notPicture = `${WORK}/imgc-not-a-picture.txt`;
fs.writeFileSync(notPicture, 'this is not a picture');
await page.setInputFiles('#fileInput', notPicture);
await page.waitForFunction(() =>
  document.getElementById('status').classList.contains('error'),
  null, { timeout: 10000 });
s = await state();
ok('a file that is not a picture is refused, in a sentence and in red',
   s.failed && /not an image this page can open/.test(s.status) && !s.shown,
   `${s.status} / shown ${s.shown}`);

ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

await browser.close();
process.exit(done());
