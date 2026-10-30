/* The Frutiger orb.

   The page is six drawing steps stacked in a fixed order, and all six are
   invisible to anything but the pixels: a plan that says the highlight is 576
   wide tells you nothing about whether the highlight was drawn, drawn in the
   right place, or drawn underneath the colour it is supposed to sit on. So
   the checks below read the ink back off the canvas, and the plan is only
   trusted about things the ink cannot show.

   Two of them are about compositing rather than about drawing, and they are
   the ones that would quietly go wrong. The orb is built on a canvas of its
   own and laid over the background in one go, so at half opacity every pixel
   inside it has to be exactly halfway between the fully opaque orb and the
   background — fade the layers separately instead and the highlight comes out
   at a different number while still looking plausible. And both white layers
   are clipped to the orb, which cannot be seen at all against a white
   background, because white over white is white: the clip checks are run
   against a dark one, where a leaked halo has somewhere to show.

   What is not checked here: whether it looks like 2006. */
import fs from 'node:fs';
import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/frutiger-orb.html';
const { ok, done } = scoring();

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 },
  acceptDownloads: true });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => {
  // The missing favicon says nothing in its text, only in its location.
  if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text());
});

await page.goto(URL);
await page.waitForFunction(() => window.CLI && window.CLI.image().renders > 0);

/* ------------------------------------------------------------- the tools -- */

const state = () => page.evaluate(() => window.CLI.image());
const plan = (o = {}) => page.evaluate((opts) => window.CLI.jobs.make(opts), o);
const threw = (o) => page.evaluate(async (opts) => {
  try { await window.CLI.jobs.make(opts); return null; } catch (e) { return e.message; }
}, o);

/* One pixel off the canvas, as [r, g, b, a]. Everything below is built on
   this, because the canvas is the file. */
const at = (x, y) => page.evaluate(([px, py]) => {
  const c = document.getElementById('canvas');
  return Array.from(c.getContext('2d').getImageData(Math.round(px), Math.round(py), 1, 1).data);
}, [x, y]);

/* Where the orb really is, measured rather than planned: the first and last
   pixel on a line that is not the background colour. */
const extent = (axis, along) => page.evaluate(([which, n]) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const horizontal = which === 'x';
  const len = horizontal ? c.width : c.height;
  const d = horizontal
    ? g.getImageData(0, Math.round(n), c.width, 1).data
    : g.getImageData(Math.round(n), 0, 1, c.height).data;
  /* The background is whatever the far corner of this line is. */
  const bg = [d[0], d[1], d[2], d[3]];
  let lo = -1, hi = -1;
  for (let i = 0; i < len; i++) {
    const p = i * 4;
    const same = Math.abs(d[p] - bg[0]) < 3 && Math.abs(d[p + 1] - bg[1]) < 3
      && Math.abs(d[p + 2] - bg[2]) < 3 && Math.abs(d[p + 3] - bg[3]) < 3;
    if (same) continue;
    if (lo === -1) lo = i;
    hi = i;
  }
  return lo === -1 ? null : { lo, hi, span: hi - lo + 1 };
}, [axis, along]);

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* The suite's own copies, used only to say what a colour ought to look like
   on the canvas — never to work out what the page should have drawn. */
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};
const toHsl = ([r, g, b]) => {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: d ? d / (1 - Math.abs(max + min - 1)) : 0, l: (max + min) / 2 };
};
const near = (a, b, slack = 2) => a.slice(0, 4).every((v, i) => Math.abs(v - b[i]) <= slack);

/* A file the page has written, handed straight back to the page to be read.
   Nothing in this repository decodes a WebP except a browser, and a second
   decoder written here would be a second implementation to disagree with. */
const readBack = (bytes, where = [2, 2]) => page.evaluate(async ([arr, spot]) => {
  const where = spot;
  const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)]));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
  return {
    width: bmp.width, height: bmp.height,
    corner: px(2, 2), middle: px(bmp.width >> 1, bmp.height >> 1),
    /* Read where the caller is about to read the canvas, so the two figures
       are about the same pixel and not about two pixels that ought to look
       similar. */
    spot: px(Math.round(where[0]), Math.round(where[1])),
  };
}, [bytes, where]);

const magic = (buf) => {
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return 'something else';
};

/* ============================================================ what it opens on */

{
  const p = await plan({});
  const s = await state();
  ok('opens on the 1000-pixel square the guide works at',
    p.width === 1000 && p.height === 1000 && !p.capped, `${p.width}x${p.height}`);
  ok('with the orb at eighty per cent of the shorter side',
    p.size === 80 && p.diameter === 800, `${p.size}% / ${p.diameter}px`);
  ok('in a blue that is not fully saturated, as step one asks',
    p.base === '#1a7ae0' && p.saturation < 97 && p.flat === false,
    `${p.base} at ${p.saturation}%`);
  ok('on white, with nothing behind it',
    p.background === '#ffffff' && !p.transparent && s.texture === null,
    `${p.background} / ${JSON.stringify(s.texture)}`);
  ok('and the white really is painted, not left as transparency',
    near(await at(4, 4), [255, 255, 255, 255]), JSON.stringify(await at(4, 4)));
  ok('the file it would write is named for the colour',
    p.name === 'orb-1a7ae0.png', p.name);
}

/* ================================================================ the geometry */

{
  const p = await plan({});
  const across = await extent('x', p.cy);
  const down = await extent('y', p.cx);
  ok('the orb on the canvas is as wide as the plan says it is',
    Math.abs(across.span - p.diameter) <= 2, `${across.span} against ${p.diameter}`);
  ok('and as tall, so it is a circle rather than an oval',
    Math.abs(down.span - across.span) <= 2, `${down.span} against ${across.span}`);
  ok('and centred',
    Math.abs((across.lo + across.hi) / 2 - p.cx) <= 2
      && Math.abs((down.lo + down.hi) / 2 - p.cy) <= 2,
    `${(across.lo + across.hi) / 2}, ${(down.lo + down.hi) / 2}`);

  const small = await plan({ size: 40 });
  const smallAcross = await extent('x', small.cy);
  ok('--size is a share of the shorter side and not a number of pixels',
    Math.abs(smallAcross.span - 400) <= 2, `${smallAcross.span} at size 40`);

  const wide = await plan({ canvas: '1920x1080', size: 80 });
  const wideAcross = await extent('x', wide.cy);
  ok('so on an oblong canvas it is measured off the short side',
    Math.abs(wideAcross.span - Math.round(1080 * 0.8)) <= 2,
    `${wideAcross.span} on 1920x1080`);
  await plan({ canvas: '1000x1000', size: 80 });
}

/* ========================================================== the six steps */

/* Three places to read: the base colour where neither white layer reaches,
   inside the highlight, and inside the bloom. */
const BASE_AT = (p) => [p.cx - p.radius * 0.82, p.cy + p.radius * 0.1];
const HIGH_AT = (p) => [p.cx, p.cy - p.radius * 0.55];
const BLOOM_AT = (p) => [p.cx, p.cy + p.radius * 0.5];

{
  const p = await plan({});
  const base = await at(...BASE_AT(p));
  const high = await at(...HIGH_AT(p));
  const bloom = await at(...BLOOM_AT(p));

  ok('step one paints the colour that was asked for',
    near(base, [26, 122, 224, 255], 6), JSON.stringify(base));
  ok('steps two and three put a much lighter reflection across the top',
    luma(high) > luma(base) + 70, `${luma(high).toFixed(0)} against ${luma(base).toFixed(0)}`);
  ok('steps four to six brighten the bottom of the orb',
    luma(bloom) > luma(base) + 30, `${luma(bloom).toFixed(0)} against ${luma(base).toFixed(0)}`);

  /* Each layer turned off on its own, which is the only way to know that the
     light patch at the top is the highlight and not the bloom reaching up. */
  const noHigh = await plan({ highlight: 0 });
  ok('with the highlight at nothing the top of the orb is the plain colour',
    near(await at(...HIGH_AT(noHigh)), [26, 122, 224, 255], 8),
    JSON.stringify(await at(...HIGH_AT(noHigh))));
  const noBloom = await plan({ highlight: 95, bloom: 0 });
  ok('and with the bloom at nothing the bottom is the plain colour too',
    near(await at(...BLOOM_AT(noBloom)), [26, 122, 224, 255], 8),
    JSON.stringify(await at(...BLOOM_AT(noBloom))));
  await plan({ bloom: 100 });
}

{
  /* The mask in step three is what makes the ellipse a reflection rather than
     a white blob: it has to be strongest at the top of the ellipse and gone
     by the bottom of it. */
  const p = await plan({});
  const top = await at(p.cx, p.highlight.top + p.highlight.height * 0.1);
  const bottom = await at(p.cx, p.highlight.top + p.highlight.height * 0.92);
  ok('the reflection fades downwards rather than sitting flat',
    luma(top) > luma(bottom) + 25,
    `${luma(top).toFixed(0)} at the top, ${luma(bottom).toFixed(0)} at the bottom`);

  const flat = await plan({ highlightFade: 250 });
  const flatTop = await at(flat.cx, flat.highlight.top + flat.highlight.height * 0.1);
  const flatBottom = await at(flat.cx, flat.highlight.top + flat.highlight.height * 0.92);
  ok('and a longer fade really does flatten it, so the knob is the mask',
    (luma(flatTop) - luma(flatBottom)) < (luma(top) - luma(bottom)),
    `${(luma(flatTop) - luma(flatBottom)).toFixed(0)} against ${(luma(top) - luma(bottom)).toFixed(0)}`);
  await plan({ highlightFade: 150 });
}

{
  /* How the bloom mixes is step six, and the difference between Overlay and
     plain white paint is the whole look. */
  const over = await plan({ blend: 'overlay' });
  const onOverlay = await at(...BLOOM_AT(over));
  const normal = await plan({ blend: 'source-over' });
  const onNormal = await at(...BLOOM_AT(normal));
  ok('Overlay keeps the colour in the bloom where plain white paints it out',
    onNormal[0] > 240 && onNormal[1] > 240 && onNormal[2] > 240 && onOverlay[0] < 200,
    `overlay ${onOverlay} against normal ${onNormal}`);
  await plan({ blend: 'overlay' });
}

/* ======================================================= the same orb, bigger */

/* The page's central claim: every measurement is a share of the orb rather
   than a number of pixels, so one set of settings is the same orb at 512 and
   at 4000. Nothing else here could notice it going — making the bloom's blur
   a fixed pixel count instead of a share of the diameter passed all
   fifty-eight of the other checks.

   So the same settings are drawn twice, four times apart in size, and both
   canvases are scaled down to the same small square and compared pixel for
   pixel. The blurs are turned well up for it: a seven-per-cent blur is nearly
   sharp at any size, and a mutation that fixes it in pixels is then invisible
   either way. At forty per cent two renders of the same orb come back 0.38
   levels apart on average, and the same pair with the blur fixed in pixels
   comes back 2.89 apart. */
const thumbnail = () => page.evaluate(() => {
  const c = document.getElementById('canvas');
  const s = document.createElement('canvas');
  s.width = 64; s.height = 64;
  const g = s.getContext('2d');
  g.drawImage(c, 0, 0, 64, 64);
  return Array.from(g.getImageData(0, 0, 64, 64).data);
});
const apart = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

{
  const BLURRED = { bloomBlur: 40, highlightBlur: 20 };
  await plan({ ...BLURRED, canvas: '400x400' });
  const small = await thumbnail();
  await plan({ ...BLURRED, canvas: '1600x1600' });
  const large = await thumbnail();
  const off = apart(small, large);
  ok('the same settings are the same orb four times the size',
    off < 1, `${off.toFixed(2)} levels apart on average, scaled to the same square`);

  /* And a null: the same measurement where there really is something to find,
     so the figure above is known to be able to move at all. */
  await plan({ ...BLURRED, bloomBlur: 0 });
  const sharp = await thumbnail();
  const moved = apart(sharp, large);
  ok('and the same measurement moves when the orb really does change',
    moved > 2, `${moved.toFixed(2)} levels apart with the bloom unblurred`);
  await plan({ canvas: '1000x1000', bloomBlur: 7, highlightBlur: 1 });
}

/* ============================================================== the clipping */

/* White on white shows nothing, so the leak these look for needs a dark
   background to land on. */
{
  /* One layer at a time, with the other turned off, so that a leak can only
     be blamed on the layer under test. Both of these started out reading the
     same spot with both layers on, and an unclipped highlight was caught by
     the check with *bloom* in its name — a pass and a fail that between them
     said nothing about which clip had gone. */
  const bloomOnly = await plan({ background: '#101010', highlight: 0,
    bloom: 100, bloomSize: 150, bloomBlur: 40 });
  ok('the bloom is clipped to the orb, with no halo leaking past the edge',
    near(await at(bloomOnly.cx, bloomOnly.cy + bloomOnly.radius + 12), [16, 16, 16, 255], 3),
    JSON.stringify(await at(bloomOnly.cx, bloomOnly.cy + bloomOnly.radius + 12)));
  ok('so the background stays exactly the colour it was set to',
    near(await at(6, 6), [16, 16, 16, 255], 1), JSON.stringify(await at(6, 6)));

  /* A tall reflection pushed well down the orb hangs 160 pixels below its
     bottom edge, which is a leak with nowhere to hide. */
  const highOnly = await plan({ bloom: 0, highlight: 95, highlightHeight: 100,
    highlightTop: 20, highlightFade: 250 });
  ok('and so is the highlight, however far down it is pushed',
    near(await at(highOnly.cx, highOnly.cy + highOnly.radius + 12), [16, 16, 16, 255], 3),
    JSON.stringify(await at(highOnly.cx, highOnly.cy + highOnly.radius + 12)));
  await plan({ background: '#ffffff', bloom: 100, bloomSize: 55, bloomBlur: 7,
    highlight: 95, highlightHeight: 48, highlightTop: 3, highlightFade: 150 });
}

/* ============================================================== the opacity */

/* The claim on the page is that the opacity belongs to the finished orb and
   not to each layer, which is exactly the arithmetic below: every pixel
   inside the orb at fifty per cent has to be halfway between the opaque orb
   and the background, highlight and bloom alike. Faded layer by layer the
   highlight lands somewhere else entirely. */
{
  const bg = [32, 32, 32];
  const full = await plan({ opacity: 100, background: '#202020' });
  const spots = [BASE_AT(full), HIGH_AT(full), BLOOM_AT(full)];
  const opaque = [];
  for (const s of spots) opaque.push(await at(...s));

  const half = await plan({ opacity: 50 });
  const mixed = [];
  for (const s of spots) mixed.push(await at(...s));
  const wanted = opaque.map((c) => [0, 1, 2].map((i) => (c[i] + bg[i]) / 2));
  ok('at half opacity every part of the orb is halfway to the background',
    mixed.every((c, i) => near(c.slice(0, 3), wanted[i], 2)),
    mixed.map((c, i) => `${c.slice(0, 3)} wanted ${wanted[i].map(Math.round)}`).join(' | '));

  const none = await plan({ opacity: 0 });
  const gone = [await at(none.cx, none.cy), await at(...HIGH_AT(none)), await at(4, 4)];
  ok('and at none of it there is nothing on the canvas but the background',
    gone.every((c) => near(c, [32, 32, 32, 255], 1)), JSON.stringify(gone));
  await plan({ opacity: 100, background: '#ffffff' });
}

/* ============================================================ behind the orb */

{
  const p = await plan({ background: '#ff00bb' });
  ok('the background colour is the colour it was given',
    near(await at(3, 3), [255, 0, 187, 255], 1), JSON.stringify(await at(3, 3)));

  const clear = await plan({ transparent: true });
  const outside = await at(3, 3);
  const inside = await at(clear.cx, clear.cy);
  ok('transparent leaves nothing at all outside the orb',
    outside[3] === 0, JSON.stringify(outside));
  ok('and the orb itself still fully painted',
    inside[3] === 255, JSON.stringify(inside));

  /* A JPEG has no alpha, and a page that let the box stay ticked for one
     would write a file with a black square where the transparency was. */
  const asJpeg = await plan({ transparent: true, format: 'image/jpeg' });
  ok('a JPEG is told it cannot have transparency, in a sentence',
    asJpeg.transparentAsked && !asJpeg.transparent && /no transparency/.test(asJpeg.status),
    asJpeg.status);
  ok('and is flattened onto the background colour instead',
    near(await at(3, 3), [255, 0, 187, 255], 2), JSON.stringify(await at(3, 3)));
  await plan({ transparent: false, format: 'image/png', background: '#ffffff' });
}

/* ================================================================= a texture */

/* Painted here rather than committed: two flat colours with the seam between
   them well off centre, so that where it lands says whether the picture was
   cropped to cover or squashed to fit.

   Off centre is the whole point, and the first version of this got it wrong.
   The seam was in the middle of the picture, which is a fixed point of both
   mappings: 1600 x 800 covering a 1000 square is drawn 2000 wide with 500
   cropped off each side, and squashed to fit it is drawn 1000 wide with
   nothing cropped — and a seam at the middle of the source lands at the
   middle of the canvas either way. Squashing the picture on purpose passed
   that check. At x=1100 the two disagree: cover puts it at 875, a squash at
   687. (The vertical mapping is the same either way for a wide picture on a
   square canvas, which is why it is the horizontal that is measured.) */
const stub = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 800;
  const g = c.getContext('2d');
  g.fillStyle = '#cc0000'; g.fillRect(0, 0, 1100, 800);
  g.fillStyle = '#0000cc'; g.fillRect(1100, 0, 500, 800);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}));
const STUB = WORK + '/orb-texture.png';
fs.writeFileSync(STUB, stub);

/* A second one, flat all over, for the blur. A flat picture is useless for
   measuring a crop and perfect for measuring an edge: anything the blur drags
   in from outside the picture shows up as a corner that is no longer the
   colour the whole picture is. */
const FLAT = WORK + '/orb-texture-flat.png';
fs.writeFileSync(FLAT, Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1200;
  const g = c.getContext('2d');
  g.fillStyle = '#cc0000'; g.fillRect(0, 0, 1200, 1200);
  g.fillStyle = '#004400'; g.fillRect(500, 500, 200, 200);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
})));

async function handIn(file) {
  const was = (await state()).renders;
  await page.setInputFiles('#textureFile', file);
  await page.waitForFunction((n) => window.CLI.image().renders > n && window.CLI.image().texture,
    was, { timeout: 30000 });
}

{
  await handIn(STUB);
  const s = await state();
  ok('a texture goes in through the page’s own file input',
    s.texture && s.texture.width === 1600 && s.texture.height === 800,
    JSON.stringify(s.texture));

  const p = await plan({ size: 20 });     // a small orb, to leave the texture visible
  ok('and fills the canvas corner to corner, with no letterbox',
    near(await at(4, 4), [204, 0, 0, 255], 2) && near(await at(995, 4), [0, 0, 204, 255], 2)
      && near(await at(4, 995), [204, 0, 0, 255], 2),
    `${await at(4, 4)} / ${await at(995, 4)} / ${await at(4, 995)}`);

  const seam = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 4, c.width, 1).data;
    for (let x = 1; x < c.width; x++) if (d[x * 4 + 2] > 100) return x;
    return -1;
  });
  ok('cropped to cover rather than squashed to fit, which is where the seam falls',
    Math.abs(seam - 875) <= 2, `the seam is at ${seam}, and a squash would put it at 687`);

  ok('the figures name the texture rather than the colour behind it',
    (await page.locator('#figures').textContent()).includes('orb-texture.png'),
    await page.locator('#figures').textContent());

  /* The transparent box turns the colour layer off and nothing else, so with
     a texture loaded it changes nothing visible — and the figures have to go
     on naming the picture that is there rather than calling it nothing. */
  await plan({ transparent: true });
  ok('and go on naming it when the transparent box is ticked over one',
    (await page.locator('#figures').textContent()).includes('orb-texture.png')
      && (await at(4, 4))[3] === 255,
    `${await page.locator('#figures').textContent()} / ${await at(4, 4)}`);
  await plan({ transparent: false });

  /* The overscan. A blur samples past the edge of the picture, and a picture
     drawn at exactly the canvas size has nothing out there, so the corners
     come back pale. Drawn larger first they cannot. */
  await handIn(FLAT);
  await plan({ size: 20, textureBlur: 0 });
  const sharp = await at(3, 3);
  await plan({ textureBlur: 100 });
  const blurred = await at(3, 3);
  ok('a blurred texture keeps its colour in the corners',
    near(blurred, sharp, 6), `${blurred} against ${sharp} unblurred`);
  ok('and the blur is doing something, in the middle where there is detail',
    luma(await at(520, 520)) !== luma(sharp), JSON.stringify(await at(520, 520)));

  await page.click('#clearTexture');
  await page.waitForFunction(() => window.CLI.image().texture === null);
  ok('No texture puts the plain colour back',
    near(await at(3, 3), [255, 255, 255, 255], 1), JSON.stringify(await at(3, 3)));
  await plan({ size: 80, textureBlur: 0 });
}

/* ================================================================== the files */

{
  /* The Save button, caught as a real download and handed back to the page to
     be read — the canvas on screen is supposed to *be* the file. */
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#saveBtn'),
  ]);
  const file = WORK + '/orb-saved.png';
  await download.saveAs(file);
  const bytes = fs.readFileSync(file);
  ok('Save writes a PNG under the name the page said it would',
    download.suggestedFilename() === 'orb-1a7ae0.png' && magic(bytes) === 'png',
    `${download.suggestedFilename()} / ${magic(bytes)}`);

  const p = await plan({});
  const back = await readBack(Array.from(bytes), HIGH_AT(p));
  const onScreen = await at(...HIGH_AT(p));
  ok('and it is the canvas, at full size',
    back.width === 1000 && back.height === 1000, `${back.width}x${back.height}`);
  ok('with the same pixels in it that were on screen',
    near(back.spot, onScreen, 2), `${back.spot} against ${onScreen}`);

  const jpeg = await plan({ format: 'image/jpeg', quality: 90, bytes: true });
  const asJpeg = Buffer.from(jpeg.bytes);
  ok('a JPEG is a JPEG, named .jpg',
    magic(asJpeg) === 'jpeg' && jpeg.name.endsWith('.jpg'), `${magic(asJpeg)} / ${jpeg.name}`);
  const webp = await plan({ format: 'image/webp', bytes: true });
  ok('a WebP is a WebP, named .webp',
    magic(Buffer.from(webp.bytes)) === 'webp' && webp.name.endsWith('.webp'),
    `${magic(Buffer.from(webp.bytes))} / ${webp.name}`);

  const clear = await plan({ format: 'image/png', transparent: true, bytes: true });
  const clearBack = await readBack(clear.bytes, [2, 2]);
  ok('a transparent PNG really is transparent once it has been written',
    clearBack.corner[3] === 0 && clearBack.middle[3] === 255,
    JSON.stringify([clearBack.corner, clearBack.middle]));

  const low = await plan({ format: 'image/jpeg', quality: 20, bytes: true });
  ok('and the quality knob reaches the encoder',
    low.fileBytes < jpeg.fileBytes, `${low.fileBytes} against ${jpeg.fileBytes} at 90`);
  await plan({ format: 'image/png', transparent: false, quality: 92 });
}

/* ============================================================ what it refuses */

{
  ok('a blend mode the canvas has not got is refused with the list',
    /no blend mode called "rainbow"/.test(await threw({ blend: 'rainbow' }) || '')
      && /overlay/.test(await threw({ blend: 'rainbow' })),
    await threw({ blend: 'rainbow' }));
  ok('and a canvas preset it has not got, the same way',
    /no canvas called "retina-ish"/.test(await threw({ canvas: 'retina-ish' }) || ''),
    await threw({ canvas: 'retina-ish' }));
  ok('a slider asked for a value past its end says where the end is',
    /--opacity runs 0 to 100/.test(await threw({ opacity: 150 }) || ''),
    await threw({ opacity: 150 }));
  ok('a colour that is not a colour is a sentence rather than a black orb',
    /--colour wants a hex colour/.test(await threw({ colour: 'cerulean' }) || ''),
    await threw({ colour: 'cerulean' }));
  ok('and two ways of saying how big at once',
    /give one or the other/.test(await threw({ canvas: '4k', width: 800 }) || ''),
    await threw({ canvas: '4k', width: 800 }));

  const names = await plan({ canvas: '4k' });
  ok('a preset name resolves to the size the page says it is',
    names.width === 3840 && names.height === 2160, `${names.width}x${names.height}`);
  await plan({ canvas: '1000x1000' });
}

/* ========================================================= the awkward sizes */

{
  /* Typed into the box rather than asked for with a flag, because the flag is
     refused at the page's own stated limit and the box is not: a number input
     stops nobody typing 30000 into it, and 30000 square is three times the
     pixels a browser will paint. That is the only way in to the two caps, and
     without it they are code nothing can reach. */
  /* A small orb first, because the blurs are a share of its diameter: at 80
     per cent of a sixteen-thousand-pixel canvas the bloom is a nine-hundred
     pixel blur, and this check is about the canvas rather than about how
     patient a filter is. */
  await plan({ size: 12 });
  await page.evaluate(() => {
    /* Both boxes before either redraw, which is not quite what typing does —
       it is what typing does without the half-finished canvas in between, and
       a 30000 x 1000 one costs a second nobody needs to spend here. */
    document.getElementById('width').value = '30000';
    document.getElementById('height').value = '30000';
    document.getElementById('height').dispatchEvent(new Event('input'));
  });
  const p = await plan({});
  ok('a canvas past what a browser will paint comes down to fit',
    p.capped && p.width * p.height <= 268435456 && p.width === p.height
      && p.width < 30000, `${p.width}x${p.height}`);
  ok('and the page says so rather than leaving a blank canvas',
    /more than a browser will paint/.test(p.status), p.status);
  const painted = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    return { w: c.width, h: c.height,
      middle: Array.from(c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data) };
  });
  ok('the canvas really is the size it came down to, with an orb on it',
    painted.w === p.width && painted.h === p.height && painted.middle[3] === 255,
    JSON.stringify(painted));
  await plan({ canvas: '1000x1000', size: 80 });
}

/* ====================================================== the saturation notice */

{
  const p = await plan({ colour: '#ff0000' });
  ok('a fully saturated colour is drawn, and remarked on',
    p.flat === true && p.saturation === 100, `${p.base} at ${p.saturation}%`);
  ok('with the notice on screen rather than only in the data',
    await page.locator('#satNote').isVisible()
      && /nowhere left to brighten/.test(await page.locator('#satNote').textContent()),
    await page.locator('#satNote').textContent());

  await page.click('#satNote button');
  const eased = await plan({});
  ok('and Ease it off takes the saturation down without moving the hue',
    eased.saturation < 97 && eased.base !== '#ff0000' && /^#[0-9a-f]{2}0000$/.test(eased.base) === false
      && eased.flat === false, `${eased.base} at ${eased.saturation}%`);
  ok('after which the notice is gone',
    !(await page.locator('#satNote').isVisible()), 'still showing');
  await plan({ colour: '#1a7ae0' });
}

/* ================================================================ the picker */

/* The colour wells are the square-and-strip from color-picker.html, folded
   away behind their own swatch. Three things are worth holding on to: that
   folded means folded (a `display` on the class beats the `hidden`
   attribute, and the first version of this was folded in the script and wide
   open on screen), that unfolding paints — a hidden element measures zero,
   so a picker painted while folded gets a one-pixel canvas that stays wrong
   afterwards — and that the knobs remember where they were when the colour
   they make has no opinion. */
const pick = (which, what) => page.locator('#' + which + 'Picker ' + what);
const knobs = (which) => page.evaluate((id) => {
  const root = document.getElementById(id + 'Picker');
  return {
    sv: root.querySelector('.sv .knob').style.cssText,
    hue: root.querySelector('.hue .knob').style.top,
    expanded: root.querySelector('.pick-head').getAttribute('aria-expanded'),
  };
}, which);

/* What is actually on the little canvases, which is the only way to tell a
   painted picker from an unpainted one. */
const painted = (which) => page.evaluate((id) => {
  const root = document.getElementById(id + 'Picker');
  const read = (sel) => {
    const c = root.querySelector(sel);
    const g = c.getContext('2d');
    const at = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    return { w: c.width, h: c.height, topLeft: at(2, 2), topRight: at(c.width - 3, 2),
             bottomLeft: at(2, c.height - 3), middle: at(c.width / 2, c.height / 2) };
  };
  return { sv: read('.sv canvas'), hue: read('.hue canvas') };
}, which);

{
  const head = pick('base', '.pick-head');
  ok('the colour well opens folded, saying what the colour is',
    (await knobs('base')).expanded === 'false'
      && (await pick('base', '.hex').textContent()) === '#1a7ae0',
    await pick('base', '.hex').textContent());
  ok('and folded means not on screen, not merely hidden in the markup',
    !(await pick('base', '.pick-body').isVisible()), 'the body is showing');

  /* Folded, the swatch and the hex on the head are the whole of the picker,
     so they have to keep up with a colour set from anywhere else. */
  await plan({ background: '#c83737' });
  ok('a folded picker still shows the colour on its head',
    (await pick('bg', '.hex').textContent()) === '#c83737'
      && !(await pick('bg', '.pick-body').isVisible()),
    await pick('bg', '.hex').textContent());
  await plan({ background: '#ffffff' });

  await head.click();
  const up = await painted('base');
  /* What is *not* checked: that a folded picker skips painting its canvases.
     That early return is an economy rather than a rule — unfolding repaints
     from scratch, so taking it out leaves every check here passing and only
     costs two pointless fills per sync. */
  ok('unfolding paints a square the size it really is, not one pixel',
    up.sv.w > 100 && up.sv.h > 100 && up.hue.h > 100,
    `${up.sv.w}x${up.sv.h}, strip ${up.hue.w}x${up.hue.h}`);
  /* White in the top left corner, the hue itself in the top right, black
     along the bottom: saturation across and brightness down. */
  ok('with saturation across it and brightness down it',
    luma(up.sv.topLeft) > 230 && luma(up.sv.bottomLeft) < 20
      && up.sv.topRight[2] > 200 && up.sv.topRight[0] < 60,
    `${up.sv.topLeft} top left, ${up.sv.topRight} top right, ${up.sv.bottomLeft} bottom left`);
  ok('and the hue strip running through the hues',
    up.hue.topRight[0] > 200 && up.hue.topRight[1] < 60
      && up.hue.middle[1] > 120 && up.hue.middle[0] < 120,
    `${up.hue.topRight} at the top, ${up.hue.middle} in the middle`);

  /* Dragging the square is the page being used, so the orb has to follow. */
  const box = await pick('base', '.sv').boundingBox();
  const was = (await state()).renders;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65);
  await page.mouse.up();
  /* Waited for rather than waited on: a picker that picks a colour and does
     not redraw the orb would otherwise hang here for thirty seconds and come
     back as a stack trace, when it is a thing this check can say in a line.
     It has to be part of the assertion, too — `plan` redraws on its way past,
     so the canvas would look right either way. */
  const redrew = await page.waitForFunction((n) => window.CLI.image().renders > n,
    was, { timeout: 5000 }).then(() => true, () => false);

  const dragged = await plan({});
  ok('dragging in the square picks a colour and redraws the orb with it',
    redrew && dragged.base !== '#1a7ae0'
      && near(await at(...BASE_AT(dragged)), hexToRgb(dragged.base), 6),
    `${dragged.base} on the canvas as ${await at(...BASE_AT(dragged))}`
      + (redrew ? '' : ', and the drag did not redraw it'));
  ok('and the head and the hex box both say the new colour',
    (await pick('base', '.hex').textContent()) === dragged.base
      && (await pick('base', '.hexin').inputValue()) === dragged.base,
    `${await pick('base', '.hex').textContent()} / ${await pick('base', '.hexin').inputValue()}`);

  /* The hue strip, and then the part that a picker which re-derives its
     knobs from the hex every time gets wrong. */
  const strip = await pick('base', '.hue').boundingBox();
  await page.mouse.click(strip.x + strip.width / 2, strip.y + strip.height * 0.35);
  const hued = await plan({});
  const hueKnob = (await knobs('base')).hue;
  ok('dragging the strip moves the hue and leaves the rest alone',
    Math.abs(toHsl(hexToRgb(hued.base)).h - 126) < 12
      && Math.abs(hued.saturation - dragged.saturation) < 3,
    `${hued.base}, hue ${toHsl(hexToRgb(hued.base)).h.toFixed(0)}`);

  const bottom = await pick('base', '.sv').boundingBox();
  await page.mouse.click(bottom.x + bottom.width * 0.5, bottom.y + bottom.height - 2);
  const black = await plan({});
  /* The bottom row is brightness nothing, give or take the pixel the click
     lands on — near enough that the hue it came from is gone from the hex. */
  ok('and dragging to the bottom of the square takes it to black',
    hexToRgb(black.base).slice(0, 3).every((v) => v < 4), black.base);
  ok('without the hue knob forgetting where it was, black having no hue',
    (await knobs('base')).hue === hueKnob,
    `${(await knobs('base')).hue} against ${hueKnob} before`);

  /* Typed in, and arrived from somewhere else. */
  await pick('base', '.hexin').fill('#8a5be0');
  const typed = await plan({});
  ok('a hex typed into the box is the colour on the canvas',
    typed.base === '#8a5be0'
      && near(await at(...BASE_AT(typed)), [138, 91, 224, 255], 6),
    `${typed.base} / ${await at(...BASE_AT(typed))}`);

  await page.locator('#chips button').first().click();
  const chipped = await plan({});
  ok('a preset chip sets the colour and the picker follows it',
    chipped.base === '#1a7ae0'
      && (await pick('base', '.hex').textContent()) === '#1a7ae0',
    `${chipped.base} / ${await pick('base', '.hex').textContent()}`);

  const far = await plan({ colour: '#e04b3c' });
  ok('and so does a colour set from the terminal',
    (await pick('base', '.hex').textContent()) === '#e04b3c'
      && (await pick('base', '.hexin').inputValue()) === '#e04b3c',
    await pick('base', '.hex').textContent());
  ok('with the knobs moved to it rather than left where they were',
    Math.abs(Number((await knobs('base')).hue.replace('%', '')) - 5.7 / 360 * 100) < 2,
    `${(await knobs('base')).hue} for a hue of ${toHsl(hexToRgb(far.base)).h.toFixed(1)}`);

  await head.click();
  ok('and it folds up again',
    (await knobs('base')).expanded === 'false'
      && !(await pick('base', '.pick-body').isVisible()), 'still open');

  /* The background colour is the same component, doing the same job. */
  await pick('bg', '.pick-head').click();
  await pick('bg', '.hexin').fill('#2d6a4f');
  const behind = await plan({});
  ok('the background has the same picker, and it paints the background',
    behind.background === '#2d6a4f' && near(await at(3, 3), [45, 106, 79, 255], 2),
    `${behind.background} / ${await at(3, 3)}`);
  await pick('bg', '.pick-head').click();
  await plan({ colour: '#1a7ae0', background: '#ffffff' });
}

/* ============================================================== the resetting */

{
  await plan({ colour: '#00ff99', opacity: 40, size: 30, bloom: 10, blend: 'screen' });
  await page.click('#resetBtn');
  const p = await plan({});
  ok('Start again puts every control back where the page opened',
    p.base === '#1a7ae0' && p.opacity === 100 && p.size === 80
      && p.bloom.strength === 100 && p.bloom.blend === 'overlay' && p.format === 'PNG',
    JSON.stringify({ base: p.base, opacity: p.opacity, size: p.size,
      bloom: p.bloom.strength, blend: p.bloom.blend }));
}

ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

await browser.close();
process.exit(done());
