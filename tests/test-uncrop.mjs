/* Uncrop. A picture onto a bigger canvas, and the border invented.

   Three different things are being tested here and only one of them is the
   model, which this suite never downloads:

     - the arithmetic the page shows you before anything runs. Where the
       picture sits, how much of the canvas is new, how many passes that will
       take, and which of the three warnings a canvas has earned. All of it
       comes out of `plan` and `framesFor`, so all of it can be checked
       without a run.

     - the mirror fill, end to end through the buttons, because it is the one
       fill that needs nothing fetched. It is also the only check that the
       picture survives a run: the interior has to come back byte for byte.

     - the model path, with a stand-in runtime. 80 MB of weights is not
       something a test suite should fetch, and it would not make the checks
       any better: what can go wrong here is the page's own work, not the
       network's. So the suite puts its own session into `window.UNCROP
       .sessions`, which is the same slot a real one would fill, and the page
       packs the tensors, builds the mask, reads the answer back and pastes it
       exactly as it would for MI-GAN. The stub decides only what the answer
       is — and in one case decides it the wrong way round, which is how the
       mask-polarity check gets tested at all.

   The files are read back where a reader is needed and no second
   implementation is created by having one: PNG, WebP and JPEG go back into
   the page, which is the only image decoder in this repository. TIFF is the
   exception, and has to be — the page is the only *writer* of one here, so
   the suite reads its tags in Node and inflates a strip with `node:zlib`,
   which is a standard decoder rather than a mirror of the encoder above it.

   What this suite cannot check is written down at the bottom. */
import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const { ok, done } = scoring();
const SITE = 'http://127.0.0.1:8099/uncrop.html';

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 1500 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => {
  // The missing favicon is the container, not the page, and Chromium puts the
  // file only in the location.
  if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text());
});

await page.goto(SITE);

/* ---------------------------------------------------------- the pictures -- */

/* Drawn rather than committed. Both have structure in them off a fixed
   sequence rather than Math.random, because a mirror check against flat
   colour passes however the mirror is drawn, and because a blur that is
   supposed to be measurable needs something to blur. */
async function paint(name, w, h, what) {
  const bytes = await page.evaluate(async ({ w, h, what }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (what === 'bands') {
      let seed = 7919;
      const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const img = x.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
        const at = (y * w + i) * 4;
        img.data[at] = (Math.sin(i / 7) * 70 + 120 + next() * 50) & 255;
        img.data[at + 1] = (Math.sin(y / 5) * 60 + 130) & 255;
        img.data[at + 2] = (i * 2) & 255;
        img.data[at + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      // one flat landmark, so "is this pixel the one I think it is" is answerable
      x.fillStyle = '#00ff00';
      x.fillRect(10, 10, 12, 12);
    } else {
      x.clearRect(0, 0, w, h);
      x.fillStyle = '#20a050';
      x.fillRect(w / 4, h / 4, w / 2, h / 2);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, { w, h, what });
  const file = path.join(WORK, name);
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
}

const BANDS = await paint('uncrop-bands.png', 120, 80, 'bands');
const HOLED = await paint('uncrop-holed.png', 60, 60, 'holed');

const open = async (file) => {
  const was = await page.evaluate(() => window.UNCROP.state.loads);
  // Setting the same file again fires no `change`, so the input is cleared
  // first and the wait is on the page having opened another picture rather
  // than on it merely holding one.
  await page.evaluate(() => { document.getElementById('file').value = ''; });
  await page.setInputFiles('#file', file);
  await page.waitForFunction(n => window.UNCROP.state.loads > n && window.CLI.jobs.image().ready,
    was, { timeout: 15000 });
};
const state = () => page.evaluate(() => window.UNCROP.state);
const planFor = (o) => page.evaluate(o => window.UNCROP.plan(o), o);

await open(BANDS);

/* -------------------------------------------------------- 1. where it sits -- */

{
  const s = await state();
  ok('the canvas a picture lands on is the picture itself',
    s.target.w === 120 && s.target.h === 80
      && s.rect.x === 0 && s.rect.y === 0 && s.rect.w === 120 && s.rect.h === 80,
    JSON.stringify([s.target, s.rect]));
  const p = await page.evaluate(() => window.UNCROP.currentPlan());
  ok('with nothing to invent yet, said in those words rather than as a crop',
    p.level === 'none' && p.exact === true && p.passes === 0
      && /nothing to invent yet/.test(p.note), JSON.stringify(p));
  ok('and the button still offers to uncrop rather than to crop',
    (await page.textContent('#run')).trim() === 'Uncrop',
    await page.textContent('#run'));
}

/* A width or a height has to be clearable. The field used to be rewritten
   from the canvas on every keystroke, which put 16 back under the cursor the
   moment it was emptied and made 1920 come out as something else entirely. */
{
  await page.fill('#w', '640');
  await page.fill('#h', '480');
  const before = (await state()).target;

  await page.locator('#w').focus();
  await page.fill('#w', '');
  const emptied = { field: await page.locator('#w').inputValue(), target: (await state()).target };
  await page.locator('#w').type('1920');
  const typed = { field: await page.locator('#w').inputValue(), target: (await state()).target };

  ok('a size field can be emptied, and the canvas keeps the last size it was given',
    emptied.field === '' && emptied.target.w === 640,
    `${JSON.stringify(emptied)} after ${JSON.stringify(before)}`);
  ok('and typing a new one into the empty field gets that number, not a mangled one',
    typed.field === '1920' && typed.target.w === 1920, JSON.stringify(typed));

  /* The same thing by way of 0, which is the other way somebody clears a
     number field. */
  await page.fill('#h', '0');
  const zeroed = { field: await page.locator('#h').inputValue(), target: (await state()).target };
  await page.locator('#h').type('80');
  const after = (await state()).target;
  ok('nor does typing 0 drag the canvas down to the smallest one allowed',
    zeroed.field === '0' && zeroed.target.h === 480, JSON.stringify(zeroed));
  ok('and 0 then 80 is eighty, not eight hundred and something',
    after.h === 80, JSON.stringify(after));

  /* And what is being typed stays what is being typed. The canvas takes whole
     pixels, so 640.7 becomes 641 — and writing that 641 back into the field
     under the cursor is the other half of how a number being typed turns into
     something else. */
  await page.fill('#w', '640.7');
  ok('the field keeps the number being typed even where the canvas rounds it',
    (await page.locator('#w').inputValue()) === '640.7' && (await state()).target.w === 641,
    `${await page.locator('#w').inputValue()} in the field, ${(await state()).target.w} on the canvas`);

  /* And an abandoned half-number does not sit in the field looking like a
     setting. */
  await page.fill('#w', '');
  await page.locator('#w').blur();
  ok('leaving a field empty puts the canvas\'s own figure back into it',
    (await page.locator('#w').inputValue()) === '641',
    await page.locator('#w').inputValue());
}

await page.click('button[data-size="1920x1080"]');
ok('a size preset sets both sides', JSON.stringify((await state()).target) === '{"w":1920,"h":1080}',
  JSON.stringify((await state()).target));

await page.fill('#w', '600');
await page.click('button[data-ratio="1:1"]');
{
  const s = await state();
  ok('a shape button keeps the width and works the height out from it',
    s.target.w === 600 && s.target.h === 600, JSON.stringify(s.target));
}

await page.click('button[data-ratio="keep"]');
ok("keep-the-shape gives the canvas the picture's own proportions",
  Math.abs((await state()).target.h - 400) <= 1, JSON.stringify((await state()).target));

/* The drag has to convert screen pixels into canvas pixels through the view's
   own scale, which is the sort of thing that is right at one zoom and wrong
   at every other, so it is checked on a canvas the view has to shrink. */
await page.click('button[data-size="2560x1440"]');
ok('a big canvas leaves a small picture at its own pixels rather than blowing it up',
  (await state()).rect.w === 120, JSON.stringify((await state()).rect));
{
  const before = (await state()).rect;
  const box = await page.locator('#view').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  const after = (await state()).rect;
  const scale = await page.evaluate(() => 2560 / document.getElementById('view').width);
  const wantX = Math.round(before.x + 60 * scale), wantY = Math.round(before.y + 30 * scale);
  ok('dragging the picture moves it by the view scale, not by screen pixels',
    Math.abs(after.x - wantX) <= 2 && Math.abs(after.y - wantY) <= 2,
    `moved to ${after.x},${after.y} and wanted ${wantX},${wantY}`);
}

{
  const before = (await state()).rect;
  await page.locator('#view').focus();
  await page.keyboard.press('ArrowRight');
  const one = (await state()).rect;
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  const ten = (await state()).rect;
  ok('the arrow keys nudge one canvas pixel and ten with shift',
    one.x === before.x + 1 && ten.x === one.x + 10, `${before.x} -> ${one.x} -> ${ten.x}`);
}

/* The nine align buttons. Each one is checked against the arithmetic it
   stands for rather than against the others, and the pad is checked as a
   readout too: it lights the cell the picture is on, and nothing at all once
   the picture has been dragged somewhere that is not one of them. */
await page.click('button[data-size="1920x1080"]');
{
  const cells = [
    ['left top', 0, 0], ['centre top', 900, 0], ['right top', 1800, 0],
    ['left centre', 0, 500], ['centre centre', 900, 500], ['right centre', 1800, 500],
    ['left bottom', 0, 1000], ['centre bottom', 900, 1000], ['right bottom', 1800, 1000],
  ];
  const wrong = [];
  for (const [where, x, y] of cells) {
    await page.click(`button[data-align="${where}"]`);
    const r = (await state()).rect;
    if (r.x !== x || r.y !== y) wrong.push(`${where} went to ${r.x},${r.y} not ${x},${y}`);
    const lit = await page.evaluate(() => [...document.querySelectorAll('#align button')]
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.align));
    if (JSON.stringify(lit) !== JSON.stringify([where])) wrong.push(`${where} lit ${lit}`);
  }
  ok('each of the nine align buttons puts the picture where it says, and lights up',
    wrong.length === 0, wrong.join(' | '));

  await page.evaluate(() => window.UNCROP.place({ x: 337, y: 211 }));
  const lit = await page.evaluate(() => [...document.querySelectorAll('#align button')]
    .filter(b => b.getAttribute('aria-pressed') === 'true').length);
  ok('and a picture dragged off them lights none of them',
    lit === 0, `${lit} still lit`);
}

/* The same nine as words, which is how the terminal asks for them. */
{
  const said = await page.evaluate(() => {
    const out = {};
    for (const spec of ['top left', 'bottom-right', 'centre', 'left', 'TOP', 'center']) {
      try {
        window.UNCROP.placeAs({ size: '1920x1080', align: spec });
        out[spec] = `${window.UNCROP.state.rect.x},${window.UNCROP.state.rect.y}`;
      } catch (e) { out[spec] = `refused: ${e.message}`; }
    }
    return out;
  });
  ok('a corner or an edge can be asked for in words, spelled either way',
    said['top left'] === '0,0' && said['bottom-right'] === '1800,1000'
      && said.centre === '900,500' && said.left === '0,500'
      && said.TOP === '900,0' && said.center === '900,500',
    JSON.stringify(said));

  const bad = await page.evaluate(() => {
    try { window.UNCROP.placeAs({ align: 'sideways' }); return 'took it'; }
    catch (e) { return e.message; }
  });
  ok('and a word that is neither is refused with the list',
    /not a corner or an edge/.test(bad), bad);
}

/* The slider reads as a share of fitting the canvas, so it is read at the one
   place that share is known: Fit inside puts it at 100. */
await page.click('#fitBtn');
{
  const before = (await state()).rect;
  const was = Number(await page.locator('#scale').inputValue());
  ok('Fit inside fits the picture to the canvas, and the slider says 100',
    was === 100 && (before.w === 1920 || before.h === 1080),
    `${was}: ${JSON.stringify(before)}`);
  await page.locator('#scale').fill('50');
  await page.locator('#scale').dispatchEvent('input');
  const after = (await state()).rect;
  const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  ok('the size slider scales about the middle, so the picture does not walk off',
    Math.abs(mid(before)[0] - mid(after)[0]) <= 1 && Math.abs(mid(before)[1] - mid(after)[1]) <= 1,
    `${mid(before)} -> ${mid(after)}`);
  ok('and halfway along the slider is half the picture',
    Math.abs(after.w - before.w / 2) <= 2, `${before.w} -> ${after.w}`);
}

/* ------------------------------------------------- 2. what it says it will do -- */

/* All of this is `plan` and `framesFor`, which is the same arithmetic the
   figures line, the warning, the Uncrop button and the command line read. */

{
  const p = await planFor({ width: 300, height: 300, rect: { x: 90, y: 110, w: 120, h: 80 } });
  ok('the share of the canvas that is new is the canvas less the picture',
    p.newPixels === 300 * 300 - 120 * 80 && Math.abs(p.newShare - 0.8933) < 0.001,
    JSON.stringify([p.newPixels, p.newShare]));
  ok('and the gap on each side is measured from the picture to the edge',
    p.gaps.left === 90 && p.gaps.right === 90 && p.gaps.top === 110 && p.gaps.bottom === 110,
    JSON.stringify(p.gaps));
}

{
  const frames = await page.evaluate(() =>
    window.UNCROP.framesFor({ x: 90, y: 110, w: 120, h: 80 }, { w: 300, h: 300 }));
  ok('the fill is grown in frames, and the last one is the whole canvas',
    frames.length === 3 && JSON.stringify(frames[2]) === '{"x":0,"y":0,"w":300,"h":300}',
    JSON.stringify(frames));
  /* The point of the passes: no single pass may invent a band wider than
     about a third of what it can already see, which is the whole reason the
     page does not simply run the model once. */
  let widest = 0;
  let prev = { x: 90, y: 110, w: 120, h: 80 };
  for (const f of frames) {
    widest = Math.max(widest, (prev.x - f.x) / prev.w, (prev.y - f.y) / prev.h,
      (f.x + f.w - prev.x - prev.w) / prev.w, (f.y + f.h - prev.y - prev.h) / prev.h);
    prev = f;
  }
  ok('no pass is asked to invent a band wider than a third of what it can see',
    widest <= 0.35, `widest band was ${widest.toFixed(3)} of the frame`);
}

{
  const steps = await page.evaluate(() => [1.5, 2, 4, 10].map((R) => {
    const w = 1000, W = Math.round(1000 * R);
    return window.UNCROP.framesFor(
      { x: Math.round((W - w) / 2), y: Math.round((W - w) / 2), w, h: w }, { w: W, h: W }).length;
  }));
  /* The figures the note beside the Fill card gives, which is the only
     promise about how long a run takes that the page makes. */
  ok('half again is one pass, twice is two, four times three and ten times five',
    JSON.stringify(steps) === '[1,2,3,5]', JSON.stringify(steps));

  const tiny = await planFor({ width: 4000, height: 4000, rect: { x: 1980, y: 1980, w: 40, h: 40 } });
  ok('a hundredfold jump stops at the eight-pass limit and says what that costs',
    tiny.passes === 8 && /limit is reached/.test(tiny.note), `${tiny.passes}: ${tiny.note}`);
}

{
  const quiet = await planFor({ width: 2000, height: 2000, rect: { x: 100, y: 100, w: 1800, h: 1800 } });
  const heavy = await planFor({ width: 4000, height: 3200, rect: { x: 100, y: 100, w: 3800, h: 3000 } });
  const huge = await planFor({ width: 7000, height: 5000, rect: { x: 100, y: 100, w: 6800, h: 4800 } });
  ok('four megapixels earns no warning at all', quiet.level === 'ok' && !quiet.note,
    `${quiet.level}: ${quiet.note}`);
  ok('thirteen earns the first one, with the memory it will cost',
    heavy.level === 'heavy' && /MB a copy/.test(heavy.note), `${heavy.level}: ${heavy.note}`);
  ok('thirty-five earns the loud one, and says a phone will give up',
    huge.level === 'huge' && /phone or tablet/.test(huge.note), `${huge.level}: ${huge.note}`);
}

{
  const wide = await planFor({ width: 20000, height: 1000, rect: { x: 0, y: 0, w: 120, h: 80 } });
  const fat = await planFor({ width: 9000, height: 9000, rect: { x: 0, y: 0, w: 120, h: 80 } });
  ok('over 16384 on a side is refused, because no browser will draw it',
    wide.level === 'stop' && /16384 pixels on a side/.test(wide.blocked), wide.blocked);
  ok('and so is 81 megapixels, with the reason rather than a shrug',
    fat.level === 'stop' && /ceiling of 64/.test(fat.blocked), fat.blocked);
}

{
  const gone = await planFor({ width: 400, height: 400, rect: { x: 900, y: 900, w: 120, h: 80 } });
  const half = await planFor({ width: 400, height: 400, rect: { x: -60, y: 10, w: 120, h: 80 } });
  ok('a picture dragged off the canvas is refused and told how to get back',
    gone.level === 'stop' && /press Centre/.test(gone.blocked), gone.blocked);
  ok('a picture half off it is allowed, and told how much will be cut',
    half.level !== 'stop' && Math.abs(half.cropped - 0.5) < 0.01 && /50% of the picture/.test(half.note),
    `${half.cropped}: ${half.note}`);
}

/* The warning is only worth having if it reaches the button. */
await page.evaluate(() => { window.UNCROP.setSize(9000, 9000); window.UNCROP.centre(); });
ok('a refused canvas disables Uncrop', await page.locator('#run').isDisabled(),
  'the button was still live');
ok('and the refusal is on screen in the loud panel',
  /ceiling of 64/.test(await page.textContent('#flag'))
  && (await page.getAttribute('#flag', 'class')).includes('stop'),
  await page.textContent('#flag'));

await page.evaluate(() => { window.UNCROP.setSize(300, 300); window.UNCROP.centre(); });
ok('and a sane one brings it back', !(await page.locator('#run').isDisabled()), 'still disabled');

/* A canvas the picture already covers is not an uncrop, and the page says so
   rather than running three passes that paint nothing. */
await page.evaluate(() => {
  window.UNCROP.place({ scale: 4, x: 0, y: 0 });
  window.UNCROP.setSize(200, 160);
  window.UNCROP.place({ x: -20, y: -20 });
});
{
  const p = await page.evaluate(() => window.UNCROP.currentPlan());
  ok('a canvas the picture covers has nothing to invent',
    p.level === 'none' && p.passes === 0 && /this is a crop/.test(p.note), JSON.stringify(p));
  ok('and the button stops offering to uncrop it',
    (await page.textContent('#run')).trim() === 'Crop it', await page.textContent('#run'));
}

/* ------------------------------------------------------- 3. the mirror fill -- */

/* The one fill that needs nothing fetched, so it is the one driven entirely
   through the buttons, and the one that proves the picture survives a run. */

await open(BANDS);
await page.click('button[data-method="reflect"]');
await page.evaluate(() => { window.UNCROP.setSize(300, 300); window.UNCROP.centre(); });
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result, null, { timeout: 60000 });

{
  const s = await state();
  ok('the result is exactly the canvas that was asked for',
    s.result.w === 300 && s.result.h === 300, JSON.stringify(s.result));
  ok('and a mirror does not claim the model\'s passes',
    !/pass/.test(await page.textContent('#outFigures')) && /mirrored/.test(await page.textContent('#outFigures')),
    await page.textContent('#outFigures'));
}

/* The mirror itself: a pixel k out from the left edge is the pixel k-1 in
   from it. Not byte for byte, because the melt starts at the seam — but the
   melt is only a few per cent that close in, so a tolerance of 6 is a real
   check and a mirror drawn the wrong way round is nowhere near it. */
{
  const read = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const r = window.UNCROP.state.rect;
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
    const rows = [];
    for (let k = 1; k <= 4; k++) {
      rows.push({ out: at(r.x - k, r.y + 40), in: at(r.x + k - 1, r.y + 40) });
    }
    return {
      rows,
      above: { out: at(r.x + 60, r.y - 2), in: at(r.x + 60, r.y + 1) },
      /* far out, where the melt has had its way */
      far: at(2, 150),
    };
  });
  const worst = Math.max(...read.rows.map(p => Math.max(...p.out.map((v, i) => Math.abs(v - p.in[i])))));
  ok('each pixel just outside the left edge is the mirror of the one just inside',
    worst <= 6, `worst channel was ${worst} off: ${JSON.stringify(read.rows)}`);
  const up = Math.max(...read.above.out.map((v, i) => Math.abs(v - read.above.in[i])));
  ok('and the top edge is mirrored too, not just the sides',
    up <= 12, `${up} off: ${JSON.stringify(read.above)}`);
}

/* The melt. Near the seam the mirror keeps the picture's own texture; far out
   it is blurred into itself, which is measurable as the variation between
   neighbouring pixels dropping away. */
{
  const rough = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const r = window.UNCROP.state.rect;
    const wiggle = (x0, y0) => {
      const d = g.getImageData(x0, y0, 30, 1).data;
      let sum = 0;
      for (let i = 4; i < d.length; i += 4) sum += Math.abs(d[i] - d[i - 4]);
      return sum / 29;
    };
    return { inside: wiggle(r.x + 5, r.y + 40), near: wiggle(r.x - 32, r.y + 40), far: wiggle(1, r.y + 40) };
  });
  ok('the mirror is melted into a blur with distance from the picture',
    rough.far < rough.near * 0.6 && rough.near > 1,
    `inside ${rough.inside.toFixed(2)}, near ${rough.near.toFixed(2)}, far ${rough.far.toFixed(2)}`);
}

/* The page's central claim. Everything but the outermost couple of pixels of
   the picture has to come back exactly as it went in, which is checked
   against the fixture decoded by the page itself rather than against a second
   PNG reader written here. */
{
  const diff = await page.evaluate(async (fixture) => {
    const img = new Image();
    await new Promise((go, no) => { img.onload = go; img.onerror = no; img.src = fixture; });
    const want = document.createElement('canvas');
    want.width = img.naturalWidth; want.height = img.naturalHeight;
    want.getContext('2d').drawImage(img, 0, 0);
    const a = want.getContext('2d').getImageData(0, 0, want.width, want.height).data;

    const r = window.UNCROP.state.rect;
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const b = g.getImageData(r.x, r.y, r.w, r.h).data;

    let inner = 0, edge = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
      const onEdge = x < 2 || y < 2 || x >= r.w - 2 || y >= r.h - 2;
      if (onEdge) edge = Math.max(edge, d); else inner = Math.max(inner, d);
    }
    return { inner, edge };
  }, '/tests/.work/uncrop-bands.png');
  ok('the picture itself comes back byte for byte', diff.inner === 0,
    `worst channel inside the picture was ${diff.inner} off`);
  /* The exception to the line above — the outermost two pixels are blended
     with what meets them — is checked under the stubbed model below rather
     than here. Under a mirror the fill beneath the picture's edge *is* the
     picture's edge, so blending the two changes nothing at all, and whether a
     check here saw a difference came down to the rasteriser's rounding: it
     passed on a software canvas and failed on a GPU one. */
}

const FIXTURE_BANDS = '/tests/.work/uncrop-bands.png';

/* -------------------------------------------------- 4. the model path, stubbed -- */

/* The stand-in. It is handed the tensors the page packed and gives back an
   answer of its own choosing, which means everything between the file input
   and the saved picture is the page's real code: the work scale, the
   letterbox, the mask, the channel order, the range detection, the paste, the
   upscale and the stamp.

   `how` is the only dishonest knob. An `inverted` stub reads the mask the
   other way round — paints where it was told not to and leaves alone where it
   was told to paint — which is exactly the failure a wrong model card
   produces, and the page is supposed to notice and turn the mask over. */
async function stub(o = {}) {
  await page.evaluate((o) => {
    window.ort = {
      Tensor: class {
        constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; }
      },
    };
    window.SEEN = [];
    const side = 512, n = side * side;
    const float = o.type === 'float32';
    window.UNCROP.sessions.fast = {
      kind: 'fast', imageIn: 'image', maskIn: 'mask',
      imageType: o.type || 'uint8', maskType: o.type || 'uint8',
      side, hole: float ? 1 : 255, over255: false, settled: false, on: 'wasm',
      session: {
        inputNames: ['image', 'mask'], outputNames: ['out'],
        run: async (feed) => {
          if (o.delay) await new Promise(r => setTimeout(r, o.delay));
          const img = feed.image.data, msk = feed.mask.data;
          const marked = float ? 1 : 255;
          let painted = 0, told = 0;
          const out = float ? new Float32Array(3 * n) : new Uint8Array(3 * n);
          const full = float ? 1 : 255;
          /* `tint` is a model that reconstructs the part it was told to keep
             slightly wrong, which every inpainting network does. The page is
             supposed to put the known content back over the answer so that
             the error does not compound over the passes. */
          const sag = o.how === 'tint' ? (float ? 0.08 : 20) : 0;
          for (let i = 0; i < n; i++) {
            if (msk[i] === marked) told++;
            const fill = o.how === 'inverted' ? msk[i] !== marked : msk[i] === marked;
            if (fill) {
              painted++;
              /* `ramp` paints how far down its own square view each pixel is,
                 which is how the suite can tell where the page cropped that
                 view back out of it. Everything else paints flat magenta. */
              const down = o.how === 'ramp' ? (Math.floor(i / side) / (side - 1)) * full : 0;
              out[i] = full;
              out[n + i] = o.how === 'ramp' ? down : 0;
              out[2 * n + i] = full;
            } else {
              out[i] = Math.max(0, img[i] - sag);
              out[n + i] = Math.max(0, img[n + i] - sag);
              out[2 * n + i] = Math.max(0, img[2 * n + i] - sag);
            }
          }
          /* What the page actually marked, at three places the suite can
             reason about without rebuilding the page's own arithmetic. */
          const spot = (fx, fy) => msk[Math.round(fy * side) * side + Math.round(fx * side)] === marked;
          /* The box it was told to keep, which is the mask itself rather than
             a consequence of it — the page stamps the picture back over
             everything at the end, so a mask that eats the picture's edge
             cannot be seen in the result at all. */
          let x0 = side, y0 = side, x1 = -1, y1 = -1;
          for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
            if (msk[y * side + x] === marked) continue;
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
          window.SEEN.push({ painted, told, corner: spot(0.01, 0.01), middle: spot(0.5, 0.5),
            kept: { x0, y0, x1, y1 } });
          if (o.broken) return {};
          return { out: { data: out, dims: [1, 3, side, side] } };
        },
      },
    };
  }, o);
}

const runModel = async (o) => {
  await page.evaluate(() => { window.UNCROP.update(); });
  await page.click('button[data-method="fast"]');
  await page.click('#run');
  await page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 60000 });
};

await open(BANDS);
await stub({ how: 'honest' });
await page.evaluate(() => { window.UNCROP.setSize(300, 300); window.UNCROP.centre(); });
await runModel();

{
  const s = await state();
  const seen = await page.evaluate(() => window.SEEN);
  ok('a three-pass canvas is three model runs and no more',
    s.result.passes === 3 && seen.length === 3, `${s.result.passes} passes, ${seen.length} runs`);
  /* The null measurement for the polarity check below: a model that reads the
     mask the way the page sends it must not be run twice. Without this, a
     check that the wrong one is re-run would pass if the page simply re-ran
     everything always. */
  ok('a model that wants the mask the way it was sent is not run twice',
    seen.length === 3, `${seen.length} runs for 3 passes`);
  ok('the mask marks the far corner and leaves the picture alone',
    seen[0].corner === true && seen[0].middle === false, JSON.stringify(seen[0]));
  ok('and the model painted exactly what it was told to paint',
    seen.every(r => r.painted === r.told), JSON.stringify(seen.map(r => [r.painted, r.told])));
}

{
  const read = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const r = window.UNCROP.state.rect;
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
    return { corner: at(3, 3), far: at(296, 296), inside: at(r.x + 60, r.y + 40), landmark: at(r.x + 15, r.y + 15) };
  });
  const magenta = (p) => p[0] > 200 && p[1] < 60 && p[2] > 200;
  ok("what the model painted is what lands outside the picture",
    magenta(read.corner) && magenta(read.far), JSON.stringify(read));
  ok('and the picture is still the picture underneath it',
    !magenta(read.inside) && read.landmark[1] > 200 && read.landmark[0] < 60,
    JSON.stringify(read));
}

/* The feather, where there is something different to blend with: the fill
   here is flat magenta, so the picture's outermost two pixels have to come
   out pulled towards it, and the ones inside them not at all. */
{
  const diff = await page.evaluate(async (fixture) => {
    const img = new Image();
    await new Promise((go, no) => { img.onload = go; img.onerror = no; img.src = fixture; });
    const want = document.createElement('canvas');
    want.width = img.naturalWidth; want.height = img.naturalHeight;
    want.getContext('2d').drawImage(img, 0, 0);
    const a = want.getContext('2d').getImageData(0, 0, want.width, want.height).data;
    const r = window.UNCROP.state.rect;
    const b = window.UNCROP.resultCanvas().getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
    let inner = 0, edge = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = (y * r.w + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
      const onEdge = x < 2 || y < 2 || x >= r.w - 2 || y >= r.h - 2;
      if (onEdge) edge = Math.max(edge, d); else inner = Math.max(inner, d);
    }
    return { inner, edge };
  }, FIXTURE_BANDS);
  ok('the outermost two pixels of the picture are blended into the fill',
    diff.edge > 8 && diff.inner === 0,
    `edge ${diff.edge} off, inside ${diff.inner} off — the feather did nothing, so the seam is a hard line`);
}

/* Where the mask's edge actually falls, worked out here from the frame the
   page chose and compared against what the model was handed. This is read off
   the mask rather than off the picture on purpose: the page stamps your
   picture back over the whole result at the end, so a mask that eats three
   pixels of the picture's edge is repainted by the model, covered by the
   stamp, and leaves nothing in the output to find. The arithmetic is the
   letterbox again — the frame fitted into 512, centred — with the box rounded
   inward, because a known pixel wrongly called hole is repainted and looks
   fine while a hole pixel wrongly called known is a hard ring. */
{
  const frame = await page.evaluate(() => window.UNCROP.framesFor(
    window.UNCROP.state.rect, window.UNCROP.state.target)[0]);
  const rect = (await state()).rect;
  const s2 = 512 / Math.max(frame.w, frame.h);
  const dh = Math.max(1, Math.round(frame.h * s2)), dw = Math.max(1, Math.round(frame.w * s2));
  const ox = Math.floor((512 - dw) / 2), oy = Math.floor((512 - dh) / 2);
  const want = {
    x0: Math.ceil(ox + (rect.x - frame.x) * s2),
    y0: Math.ceil(oy + (rect.y - frame.y) * s2),
    x1: Math.floor(ox + (rect.x + rect.w - frame.x) * s2) - 1,
    y1: Math.floor(oy + (rect.y + rect.h - frame.y) * s2) - 1,
  };
  const kept = (await page.evaluate(() => window.SEEN))[0].kept;
  ok('the mask keeps exactly the picture and marks everything else',
    JSON.stringify(kept) === JSON.stringify(want),
    `${JSON.stringify(kept)} against ${JSON.stringify(want)}`);
}

/* And the other way round. A mask rounded the cautious way leaves a thin band
   just outside the picture marked as known, which nothing then paints — so it
   keeps the mirror the hole was seeded with and comes out as a hairline of
   reflected photograph around the picture. The band two pixels out has to be
   the model's work. */
{
  const just = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const r = window.UNCROP.state.rect;
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
    return [at(r.x - 2, r.y + 40), at(r.x + r.w + 1, r.y + 40),
      at(r.x + 60, r.y - 2), at(r.x + 60, r.y + r.h + 1)];
  });
  ok('and it starts at the picture, so nothing is left unpainted around it',
    just.every(p => p[0] > 200 && p[1] < 60 && p[2] > 200), JSON.stringify(just));
}

/* What each pass hands the next. A model reconstructs the part it was told to
   keep a little wrong, so the page puts the known content back over the
   answer; without that, a band invented on the first pass is reconstructed
   once more on every pass after it and drifts away from itself. */
await stub({ how: 'tint' });
await page.evaluate(() => { window.UNCROP.setSize(300, 300); window.UNCROP.centre(); });
await runModel();
{
  const read = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    return {
      firstPass: Array.from(g.getImageData(60, 150, 1, 1).data).slice(0, 3),
      lastPass: Array.from(g.getImageData(3, 150, 1, 1).data).slice(0, 3),
    };
  });
  ok('a band invented on the first pass is not reconstructed again by the later ones',
    read.firstPass[0] > 250 && read.firstPass[2] > 250 && read.lastPass[0] > 250,
    `first-pass band ${read.firstPass}, last-pass band ${read.lastPass}`);
}

/* The polarity check, which is the one piece of this page that exists because
   a model card can be wrong. */
await stub({ how: 'inverted' });
await page.evaluate(() => { window.UNCROP.sessions.fast.settled = false; });
await runModel();
{
  const seen = await page.evaluate(() => window.SEEN);
  const hole = await page.evaluate(() => window.UNCROP.sessions.fast.hole);
  const read = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const r = window.UNCROP.state.rect;
    return {
      corner: Array.from(g.getImageData(3, 3, 1, 1).data).slice(0, 3),
      inside: Array.from(g.getImageData(r.x + 60, r.y + 40, 1, 1).data).slice(0, 3),
    };
  });
  ok('a model that wants its mask the other way round is caught on the first pass',
    seen.length === 4, `${seen.length} runs for 3 passes, so the re-run did not happen`);
  ok('the mask is turned over for the rest of the run', hole === 0, `hole is ${hole}`);
  ok('and the answer comes out the same way up as if it had been right',
    read.corner[0] > 200 && read.corner[1] < 60 && read.inside[1] < 200,
    JSON.stringify(read));
}

/* A model that hands back floats between nought and one rather than bytes,
   which is what LaMa's export does, and which comes out as a black picture if
   the page does not notice. */
await stub({ how: 'honest', type: 'float32' });
await runModel();
{
  const corner = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    return Array.from(g.getImageData(3, 3, 1, 1).data).slice(0, 3);
  });
  ok('a model that answers in floats between 0 and 1 is read at full brightness',
    corner[0] > 200 && corner[2] > 200, JSON.stringify(corner));
}

/* A canvas that is not square, so the frame is letterboxed into the model's
   square view and the padding is masked as hole. If the padding were handed
   over as real picture, the fill would bend towards that grey; if the crop
   back out were wrong, the grey itself would land in the result. */
await stub({ how: 'honest' });
await page.evaluate(() => {
  window.UNCROP.setSize(480, 270);
  window.UNCROP.place({ scale: 1 });
  window.UNCROP.centre();
});
await runModel();
{
  const read = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
    return [at(2, 2), at(477, 2), at(2, 267), at(477, 267)];
  });
  const grey = (p) => Math.abs(p[0] - 128) < 40 && Math.abs(p[1] - 128) < 40 && Math.abs(p[2] - 128) < 40;
  ok('a wide canvas is letterboxed into the model and none of the padding comes back',
    read.every(p => !grey(p) && p[0] > 200 && p[2] > 200), JSON.stringify(read));
}

/* Where in that square view the canvas actually sat, read off a model that
   paints how far down its own view each pixel is. A 480 × 270 canvas goes in
   at 512 × 288 — 512/480 across, so 270 × 512/480 down — which leaves
   (512 - 288) / 2 = 112 rows of padding above it. So the top row of the
   result is row 112 of 511 of the view, and the bottom row is row 399. Get
   the crop wrong and the ramp comes back stretched, offset, or both. */
await stub({ how: 'ramp' });
await runModel();
{
  const band = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const row = (y) => {
      const d = g.getImageData(0, y, 12, 1).data;
      let sum = 0;
      for (let i = 1; i < d.length; i += 4) sum += d[i];
      return Math.round(sum / 12);
    };
    return { top: row(0), bottom: row(269) };
  });
  const want = { top: Math.round(112 / 511 * 255), bottom: Math.round(399 / 511 * 255) };
  ok('and the canvas is cropped back out of that view at the rows it went in at',
    Math.abs(band.top - want.top) <= 6 && Math.abs(band.bottom - want.bottom) <= 6,
    `top ${band.top} and bottom ${band.bottom}, wanted ${want.top} and ${want.bottom}`);
}

/* Stopping. The flag is read between passes, so a run stopped during the
   first one gives up before the second. */
await stub({ how: 'honest', delay: 400 });
await page.evaluate(() => { window.UNCROP.setSize(800, 800); window.UNCROP.centre(); });
await page.click('#run');
await page.waitForFunction(() => /Pass 1/.test(document.getElementById('step').textContent),
  null, { timeout: 20000 });
/* The working panel, while it is actually working. The spinner is a 26-pixel
   circle and has to stay one: it is a flex item in a row whose other child is
   the text, and a rule meant for the text stretched it across the whole panel
   as a diagonal streak — which looked like a broken page and passed every
   check there was, because nothing here had ever measured it. */
{
  const spinner = await page.locator('#working .spinner').boundingBox();
  const bar = await page.locator('#bar').evaluate(n => n.classList.contains('waiting'));
  ok('the spinner stays a small circle rather than stretching across the panel',
    spinner.width <= 30 && Math.abs(spinner.width - spinner.height) <= 1,
    JSON.stringify(spinner));
  ok('and a step that cannot say how far along it is sweeps instead of filling',
    bar === true, 'the bar was in filling mode during inference');
}

await page.click('#stop');
await page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 30000 });
{
  const seen = await page.evaluate(() => window.SEEN.length);
  ok('Stop gives up between passes rather than finishing the run',
    (await page.textContent('#runNote')).trim() === 'Stopped.' && seen < 4,
    `${await page.textContent('#runNote')} after ${seen} runs`);
}

/* A model that answers with nothing. The page has to say so in a sentence
   rather than throw into the console. */
await stub({ how: 'honest', broken: true });
await page.evaluate(() => { window.UNCROP.setSize(300, 300); window.UNCROP.centre(); });
await runModel();
{
  const note = (await page.textContent('#runNote')).trim();
  ok('a model that returns nothing is reported in a sentence, not a stack trace',
    /returned nothing/.test(note) && (await page.getAttribute('#runNote', 'class')).includes('error'),
    note);
}

/* A picture scaled well past the canvas, which is this page's way of cropping
   and is also the one placement that asks for a layer no canvas will hand
   out: eight times a 120 × 80 picture is 960 × 640, and the feathered copy of
   it would be that size whatever the canvas. The result still has to be the
   canvas, filled, with no transparent corner where a failed allocation would
   leave one. */
await open(BANDS);
await page.click('button[data-method="reflect"]');
await page.evaluate(() => {
  window.UNCROP.place({ scale: 8 });
  window.UNCROP.setSize(200, 160);
  window.UNCROP.centre();
});
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result && window.UNCROP.state.result.crop,
  null, { timeout: 30000 });
{
  const read = await page.evaluate(() => {
    const c = window.UNCROP.resultCanvas();
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let clear = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) clear++;
    return { w: c.width, h: c.height, clear };
  });
  ok('a picture scaled past the canvas is cropped to it with nothing left blank',
    read.w === 200 && read.h === 160 && read.clear === 0, JSON.stringify(read));
}

/* ----------------------------------------------------------- 5. the files -- */

/* Back to the mirror for these, so what is being saved is a real picture
   rather than a stub's flat magenta: a flat colour encodes to nothing at any
   quality and so cannot show a quality setting doing anything. */
await open(BANDS);
await page.click('button[data-method="reflect"]');
await page.evaluate(() => { window.UNCROP.setSize(360, 240); window.UNCROP.centre(); });
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result, null, { timeout: 60000 });

/* PNG, WebP and JPEG go back into the page to be read, because the page is
   the only image decoder in this repository and a second one written here
   would be the thing this repo spends its time avoiding. */
const reread = (fmt, q) => page.evaluate(async ({ fmt, q }) => {
  const c = window.UNCROP.resultCanvas();
  const g = c.getContext('2d');
  const want = g.getImageData(0, 0, c.width, c.height).data;
  const blob = await window.UNCROP.encode(c, fmt, q);
  const bmp = await createImageBitmap(blob);
  const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  t.getContext('2d').drawImage(bmp, 0, 0);
  const got = t.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let worst = 0;
  for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(want[i] - got[i]));
  return { worst, size: blob.size, type: blob.type, w: bmp.width, h: bmp.height };
}, { fmt, q });

{
  const png = await reread('png', 100);
  ok('a PNG comes back out of the page the same picture that went in',
    png.worst === 0 && png.type === 'image/png' && png.w === 360 && png.h === 240,
    JSON.stringify(png));

  const webpBest = await reread('webp', 100);
  const webpThin = await reread('webp', 60);
  /* Pinned because the page's notes claim it: the slider at 100 is lossless
     here, which is a Chromium behaviour rather than a guarantee of the
     format, and it is the reason the notes say "asks for lossless". */
  ok('WebP at 100 is lossless, which is what the notes beside it claim',
    webpBest.worst === 0 && webpBest.type === 'image/webp', JSON.stringify(webpBest));
  ok('and the slider below that is a real quality setting, not a label',
    webpThin.worst > 0 && webpThin.size < webpBest.size,
    `${webpThin.size} bytes at 60 against ${webpBest.size} at 100, worst ${webpThin.worst}`);

  const jpg = await reread('jpeg', 85);
  ok('a JPEG is a JPEG, lossy, and smaller than the lossless pair',
    jpg.type === 'image/jpeg' && jpg.worst > 0 && jpg.size < png.size, JSON.stringify(jpg));
}

/* TIFF is the one file here the page is the only writer of and nothing is the
   reader of, so it is read in Node: the tags out of the IFD, which is the
   same kind of reading as a PNG's IHDR, and the samples out of one strip
   through node:zlib, which is a standard decoder rather than a mirror of the
   encoder. */
function readTiff(buf) {
  if (buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) {
    throw new Error('not a little-endian TIFF');
  }
  const ifd = buf.readUInt32LE(4);
  const count = buf.readUInt16LE(ifd);
  const tags = {};
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), n = buf.readUInt32LE(e + 4);
    const bytes = sizes[type] * n;
    const at = bytes <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    const vals = [];
    for (let k = 0; k < n * (type === 5 ? 2 : 1); k++) {
      vals.push(type === 3 ? buf.readUInt16LE(at + 2 * k)
        : (type === 4 || type === 5) ? buf.readUInt32LE(at + 4 * k)
        : buf[at + k]);
    }
    tags[tag] = type === 2 ? Buffer.from(vals).toString('latin1') : vals;
  }
  return { tags, next: buf.readUInt32LE(ifd + 2 + 12 * count) };
}

const tiffOf = async () => Buffer.from(await page.evaluate(async () => {
  const blob = await window.UNCROP.encode(window.UNCROP.resultCanvas(), 'tiff', 100);
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}));

{
  const buf = await tiffOf();
  const { tags, next } = readTiff(buf);
  ok('the TIFF says what it is: size, three samples of eight bits, RGB, chunky, Deflate',
    tags[256][0] === 360 && tags[257][0] === 240
    && String(tags[258]) === '8,8,8' && tags[277][0] === 3
    && tags[262][0] === 2 && tags[284][0] === 1 && tags[259][0] === 8,
    JSON.stringify(tags));
  ok('and it carries 300 dpi in inches, so a print comes out the size it should',
    tags[282][0] === 300 && tags[282][1] === 1 && tags[296][0] === 2,
    JSON.stringify([tags[282], tags[283], tags[296]]));
  ok('there is exactly one image in it', next === 0, `next IFD at ${next}`);

  const off = tags[273], len = tags[279];
  const raw = zlib.inflateSync(buf.subarray(off[0], off[0] + len[0]));
  ok('the strip inflates to exactly the samples it should hold',
    off.length === 1 && raw.length === 360 * 240 * 3, `${raw.length} bytes from ${off.length} strip(s)`);
  ok('nothing is left over at the end of the file',
    off[0] + len[0] <= buf.length && buf.length < off[0] + len[0] + 4096,
    `${buf.length} bytes, strip ends at ${off[0] + len[0]}`);

  /* The samples themselves, against what the page has on its canvas. */
  const want = await page.evaluate(() => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    const spots = [[0, 0], [359, 0], [180, 120], [12, 200], [359, 239]];
    return spots.map(([x, y]) => [x, y, ...Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3)]);
  });
  const off3 = want.map(([x, y, r, g, b]) => {
    const i = (y * 360 + x) * 3;
    return Math.max(Math.abs(raw[i] - r), Math.abs(raw[i + 1] - g), Math.abs(raw[i + 2] - b));
  });
  ok('and they are the pixels the page has on screen, in the right order',
    Math.max(...off3) === 0, `worst ${Math.max(...off3)} at ${JSON.stringify(want)}`);
}

/* A canvas tall enough to need several strips, which is the part of the
   writer that a single-strip picture never exercises. */
await page.evaluate(() => { window.UNCROP.setSize(400, 2000); window.UNCROP.centre(); });
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result && window.UNCROP.state.result.h === 2000,
  null, { timeout: 60000 });
{
  const buf = await tiffOf();
  const { tags } = readTiff(buf);
  const rows = tags[278][0], offs = tags[273], lens = tags[279];
  const sizes = offs.map((o, i) => zlib.inflateSync(buf.subarray(o, o + lens[i])).length);
  const wanted = offs.map((_, i) => Math.min(rows, 2000 - i * rows) * 400 * 3);
  ok('a tall picture is written in several strips, each the rows it claims',
    offs.length > 1 && JSON.stringify(sizes) === JSON.stringify(wanted),
    `${offs.length} strips of ${rows} rows: ${sizes} against ${wanted}`);
  ok('the strips run in order and end where the next one starts',
    offs.every((o, i) => i === 0 || o === offs[i - 1] + lens[i - 1]), JSON.stringify(offs));

  const last = zlib.inflateSync(buf.subarray(offs[offs.length - 1], offs[offs.length - 1] + lens[lens.length - 1]));
  const want = await page.evaluate((y) => {
    const g = window.UNCROP.resultCanvas().getContext('2d');
    return Array.from(g.getImageData(7, y, 1, 1).data).slice(0, 3);
  }, 1999);
  const at = ((1999 - (offs.length - 1) * rows) * 400 + 7) * 3;
  ok('and the bottom row of the last strip is the bottom row of the picture',
    Math.max(Math.abs(last[at] - want[0]), Math.abs(last[at + 1] - want[1]),
      Math.abs(last[at + 2] - want[2])) === 0,
    `${[last[at], last[at + 1], last[at + 2]]} against ${want}`);
}

/* The alpha path. A canvas the picture already covers is a crop, and a crop
   of something part-transparent has to come out with four samples and the
   tag that says the fourth one is alpha. */
await open(HOLED);
await page.evaluate(() => {
  window.UNCROP.place({ scale: 1, x: 0, y: 0 });
  window.UNCROP.setSize(60, 60);
  window.UNCROP.place({ x: 0, y: 0 });
});
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result && window.UNCROP.state.result.crop,
  null, { timeout: 30000 });
{
  const buf = await tiffOf();
  const { tags } = readTiff(buf);
  const raw = zlib.inflateSync(buf.subarray(tags[273][0], tags[273][0] + tags[279][0]));
  ok('a part-transparent picture is written with four samples and marked as alpha',
    tags[277][0] === 4 && String(tags[258]) === '8,8,8,8' && String(tags[338]) === '2',
    JSON.stringify(tags));
  ok('and the transparency is still transparent in the file',
    raw[3] === 0 && raw[(30 * 60 + 30) * 4 + 3] === 255,
    `corner alpha ${raw[3]}, middle alpha ${raw[(30 * 60 + 30) * 4 + 3]}`);
}

/* WebP's own ceiling, which is lower than the canvas's, so the page has to
   refuse rather than hand back a file that is not a WebP. */
await open(BANDS);
await page.evaluate(() => { window.UNCROP.setSize(16384, 32); window.UNCROP.centre(); });
await page.click('button[data-method="reflect"]');
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result && window.UNCROP.state.result.w === 16384,
  null, { timeout: 90000 });
{
  const tried = await page.evaluate(async () => {
    const out = {};
    for (const fmt of ['webp', 'png']) {
      try {
        const blob = await window.UNCROP.encode(window.UNCROP.resultCanvas(), fmt, 100);
        out[fmt] = { ok: true, type: blob.type, size: blob.size };
      } catch (e) { out[fmt] = { ok: false, why: String(e.message) }; }
    }
    return out;
  });
  ok('a picture too wide for WebP is refused in a sentence that names the limit',
    tried.webp.ok === false && /16383 pixels on a side/.test(tried.webp.why), JSON.stringify(tried.webp));
  ok('and the same picture still saves as a PNG',
    tried.png.ok === true && tried.png.type === 'image/png', JSON.stringify(tried.png));
}

{
  const nonsense = await page.evaluate(async () => {
    try { await window.UNCROP.encode(window.UNCROP.resultCanvas(), 'bmp', 100); return 'no complaint'; }
    catch (e) { return String(e.message); }
  });
  ok('a format the page does not have is a sentence rather than a silent PNG',
    /there is no bmp here/.test(nonsense), nonsense);
}

/* The quality slider belongs to the two formats that have one. */
/* Read off the screen rather than off the class list. It was a class check
   first, and it passed while the slider sat there under PNG the whole time:
   the page's own `.row > label` rule is a class and an element, which outranks
   a bare `.qwrap`, so the rule meant to hide it never applied. */
{
  const shown = async () => page.locator('#qwrap').evaluate(
    n => getComputedStyle(n).display !== 'none');
  await page.click('button[data-format="jpeg"]');
  const onJpeg = await shown();
  await page.click('button[data-format="tiff"]');
  const onTiff = await shown();
  await page.click('button[data-format="webp"]');
  const onWebp = await shown();
  await page.click('button[data-format="png"]');
  const onPng = await shown();
  ok('the quality slider is there for JPEG and WebP and nowhere else',
    onJpeg && onWebp && !onTiff && !onPng,
    `jpeg ${onJpeg}, webp ${onWebp}, tiff ${onTiff}, png ${onPng}`);
}

/* ------------------------------------------------- 5b. what was added -- */

/* The page's own *Show what was added*, and the full-size version of it the
   terminal saves. They are one function drawn at two scales, so the thing to
   check is that the drawing does what it says: everything dimmed, your own
   pixels left alone, a line between them. */
await open(BANDS);
await page.click('button[data-method="reflect"]');
await page.evaluate(() => { window.UNCROP.setSize(360, 240); window.UNCROP.centre(); });
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result, null, { timeout: 60000 });

{
  const read = async () => page.evaluate(() => {
    const g = document.getElementById('out').getContext('2d');
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
    return { corner: at(4, 4), middle: at(180, 120) };
  });
  const plain = await read();
  await page.click('#showAdded');
  const marked = await read();
  await page.click('#showAdded');
  const back = await read();

  const sum = (p) => p[0] + p[1] + p[2];
  ok('Show what was added dims the fill and leaves your own pixels alone',
    sum(marked.corner) < sum(plain.corner) * 0.6
      && Math.abs(sum(marked.middle) - sum(plain.middle)) <= 6,
    `${JSON.stringify(plain)} became ${JSON.stringify(marked)}`);
  ok('and pressing it again puts the picture back',
    JSON.stringify(back) === JSON.stringify(plain),
    `${JSON.stringify(plain)} came back as ${JSON.stringify(back)}`);
}

{
  const full = await page.evaluate(() => {
    const c = window.UNCROP.markedCanvas();
    const g = c.getContext('2d');
    const r = window.UNCROP.state.rect;
    const p = window.UNCROP.resultCanvas().getContext('2d');
    const at = (ctx, x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return {
      w: c.width, h: c.height,
      inside: { marked: at(g, r.x + 40, r.y + 40), plain: at(p, r.x + 40, r.y + 40) },
      outside: { marked: at(g, 6, 6), plain: at(p, 6, 6) },
      /* the plain result must not have been drawn on in the making of it */
      stillPlain: at(p, 6, 6),
    };
  });
  const sum = (p) => p[0] + p[1] + p[2];
  ok('the terminal gets the same marking at the size of the picture, not the panel',
    full.w === 360 && full.h === 240, `${full.w} × ${full.h}`);
  ok('with the fill dimmed and the picture untouched',
    sum(full.outside.marked) < sum(full.outside.plain) * 0.6
      && JSON.stringify(full.inside.marked) === JSON.stringify(full.inside.plain),
    JSON.stringify(full));
  ok('and the result itself is not marked up by the making of it',
    JSON.stringify(full.stillPlain) === JSON.stringify(full.outside.plain),
    JSON.stringify([full.stillPlain, full.outside.plain]));
}

/* ------------------------------------------- 5c. the page's own sizes -- */

/* The canvas presets and shapes, which the terminal lists by asking the page
   rather than by keeping a copy of them. The check is against the buttons
   themselves, because the buttons are the list. */
{
  /* A job that throws would otherwise take the suite down with a stack trace
     instead of failing the checks that are about it. */
  const said = await page.evaluate(() => {
    try { return window.CLI.jobs.sizes(); }
    catch (e) { return { sizes: [], shapes: [], threw: e.message }; }
  });
  const onPage = await page.evaluate(() => ({
    sizes: [...document.querySelectorAll('#presets button[data-size]')].map(b => b.dataset.size),
    shapes: [...document.querySelectorAll('#ratios button[data-ratio]')].map(b => b.dataset.ratio),
  }));
  ok('the sizes the terminal is told about are the buttons on the page',
    JSON.stringify(said.sizes.map(s => s.name)) === JSON.stringify(onPage.sizes)
      && JSON.stringify(said.shapes.map(s => s.name)) === JSON.stringify(onPage.shapes),
    JSON.stringify([said.sizes.map(s => s.name), onPage.sizes]));
  const a4 = said.sizes.find(s => s.name === '2480x3508');
  ok('and each one carries the figures that are on it',
    said.sizes.every(s => s.name === `${s.width}x${s.height}`)
      && !!a4 && a4.label === 'A4 at 300 dpi',
    JSON.stringify(said.sizes));

  /* A preset can be asked for by its figures, by the words on the button, or
     by those words with the spaces taken out, because all three are what
     somebody will type. */
  /* Caught rather than left to throw: a name the page has stopped
     recognising is a wrong answer to report, not a stack trace to read. */
  const ways = await page.evaluate(() => ['2480x3508', 'A4 at 300 dpi', 'a4at300dpi', 'A4AT300DPI']
    .map(name => {
      try {
        window.UNCROP.placeAs({ size: name });
        return `${window.UNCROP.state.target.w}x${window.UNCROP.state.target.h}`;
      } catch (e) { return `refused: ${e.message}`; }
    }));
  ok('a size preset answers to its figures and to the words on its button',
    ways.every(w => w === '2480x3508'), JSON.stringify(ways));

  const nonsense = await page.evaluate(() => {
    try { window.UNCROP.placeAs({ size: 'enormous' }); return 'took it'; }
    catch (e) { return e.message; }
  });
  ok('and a size that is neither is refused in a sentence',
    /two numbers like 2560x1440/.test(nonsense), nonsense);

  await page.evaluate(() => window.UNCROP.placeAs({ size: '1920x1080' }));
  const swapped = await page.evaluate(() => {
    window.UNCROP.placeAs({ swap: true });
    return window.UNCROP.state.target;
  });
  ok('and Swap turns the canvas on its side',
    swapped.w === 1080 && swapped.h === 1920, JSON.stringify(swapped));
}

/* ------------------------------------------- 6. the button and the terminal -- */

/* The page's Save button and `window.CLI`'s job have to produce the same
   file, because the command line is defined as the page doing its own work.
   Two files compared byte for byte rather than two readings of a number,
   which is what caught the image compressor quietly growing arithmetic of
   its own. */
await open(BANDS);
await page.click('button[data-method="reflect"]');
await page.evaluate(() => { window.UNCROP.setSize(260, 200); window.UNCROP.centre(); });
await page.click('#run');
await page.waitForFunction(() => window.UNCROP.state.result, null, { timeout: 60000 });
await page.click('button[data-format="png"]');

{
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#save'),
  ]);
  const saved = path.join(WORK, 'uncrop-saved.png');
  await download.saveAs(saved);
  const onDisk = fs.readFileSync(saved);
  ok('Save writes the file under the name the page shows',
    download.suggestedFilename() === 'uncrop-bands-uncropped-260x200.png',
    download.suggestedFilename());
  ok('and the name is in the note under the button',
    /uncrop-bands-uncropped-260x200\.png/.test(await page.textContent('#saveNote')),
    await page.textContent('#saveNote'));

  const job = await page.evaluate(() => window.CLI.jobs.run({
    width: 260, height: 200, method: 'reflect', format: 'png',
  }));
  ok('the terminal asks for the same canvas and is told the same about it',
    job.width === 260 && job.height === 200 && job.method === 'reflect' && job.name === download.suggestedFilename(),
    JSON.stringify({ w: job.width, h: job.height, m: job.method, n: job.name }));
  ok('and the file it hands back is the Save button\'s file, byte for byte',
    Buffer.from(job.bytes).equals(onDisk),
    `${job.bytes.length} bytes from the job against ${onDisk.length} from the button`);
}

{
  const refused = await page.evaluate(async () => {
    try { await window.CLI.jobs.run({ width: 9000, height: 9000, method: 'reflect' }); return 'no complaint'; }
    catch (e) { return String(e.message); }
  });
  ok('a canvas the page refuses is refused at the terminal too, with the reason',
    /ceiling of 64/.test(refused), refused);

  const nofill = await page.evaluate(async () => {
    try { await window.CLI.jobs.run({ method: 'sideways' }); return 'no complaint'; }
    catch (e) { return String(e.message); }
  });
  ok('and a fill that does not exist is named rather than ignored',
    /no "sideways" fill/.test(nofill), nofill);

  const formats = await page.evaluate(() => window.CLI.jobs.formats());
  ok('the terminal can ask what it can save and gets the four with their endings',
    formats.length === 4 && formats.find(f => f.name === 'jpeg').ext === 'jpg'
    && formats.find(f => f.name === 'tiff').quality === false
    && formats.find(f => f.name === 'webp').maxSide === 16383,
    JSON.stringify(formats));
}

/* ------------------------------------------------- 7. a border each side -- */

/* The four Add fields: the direct way to say "this much more on the left",
   which used to mean working out the canvas and the picture's corner by hand.
   A share is of the picture — its width for left and right, its height for
   top and bottom, or whichever %w or %h names. */
await open(BANDS);                                   // 120 × 80
{
  /* On a page of its own, because this one has had its fill changed by every
     section above. The button lit and the variable the run reads have to
     agree, which is the playlist page's old bug in another shape. */
  const fresh = await ctx.newPage();
  await fresh.goto(SITE);
  const opens = {
    lit: await fresh.getAttribute('button[data-method="best"]', 'aria-pressed'),
    method: await fresh.evaluate(() => window.UNCROP.state.method),
  };
  await fresh.close();
  ok('the page opens on the best model, which is what the terminal defaults to',
    opens.lit === 'true' && opens.method === 'best', JSON.stringify(opens));

  await page.locator('#addLeft').fill('');
  await page.locator('#addLeft').pressSequentially('15%h');
  let s = await state();
  ok('15%h on the left adds a strip fifteen per cent of the picture\'s height wide',
    s.target.w === 120 + 12 && s.target.h === 80 && s.rect.x === 12 && s.rect.y === 0,
    JSON.stringify([s.target, s.rect]));
  const figures = await page.textContent('#figures');
  ok('and the figures say so: the new canvas, and 12 on the left and nothing else',
    figures.includes('132 × 80') && figures.includes('12 left') && !/right|top|bottom/.test(figures),
    figures);

  await page.locator('#addTop').fill('40');
  s = await state();
  ok('a number is pixels, and a second side keeps the first',
    s.target.w === 132 && s.target.h === 120 && s.rect.x === 12 && s.rect.y === 40,
    JSON.stringify([s.target, s.rect]));

  await page.locator('#addRight').fill('25%');
  s = await state();
  ok('a bare % on the right is of the picture\'s width',
    s.target.w === 120 + 12 + 30 && s.rect.x === 12, JSON.stringify([s.target, s.rect]));

  await page.locator('#addBottom').fill('10%w');
  s = await state();
  ok('and %w on the bottom is of its width, whatever the side would take by default',
    s.target.h === 80 + 40 + 12, JSON.stringify(s.target));

  /* Something that is not a border yet is left alone, the way the width field
     leaves a half-typed number alone, and leaving the field puts back what it
     really is. */
  await page.locator('#addTop').fill('4o');
  s = await state();
  ok('a field holding something that is not a border changes nothing',
    s.target.h === 132 && s.rect.y === 40, JSON.stringify([s.target, s.rect]));
  await page.locator('#view').focus();
  ok('and leaving it puts the border back, as it was typed',
    (await page.inputValue('#addTop')) === '40' && (await page.inputValue('#addLeft')) === '15%h',
    `${await page.inputValue('#addTop')} / ${await page.inputValue('#addLeft')}`);

  /* Once something else shapes the canvas the fields stop being the setting
     and become a readout of it, in pixels. */
  await page.fill('#w', '300');
  await page.locator('#view').focus();
  s = await state();
  ok('a canvas set by hand turns the fields into the pixels each side now has',
    (await page.inputValue('#addLeft')) === String(s.rect.x)
      && (await page.inputValue('#addRight')) === String(300 - s.rect.x - s.rect.w),
    `${await page.inputValue('#addLeft')} ${await page.inputValue('#addRight')} for ${JSON.stringify(s.rect)}`);

  /* The terminal's way in is the same function behind the same fields. */
  const viaJob = await page.evaluate(() => window.CLI.jobs.plan({ sides: { left: '15%h' } }));
  ok('the terminal\'s border is the page\'s border',
    viaJob.width === 132 && viaJob.height === 80 && viaJob.gaps.left === 12 && viaJob.gaps.right === 0,
    JSON.stringify([viaJob.width, viaJob.height, viaJob.gaps]));
  const halved = await page.evaluate(() => window.CLI.jobs.plan({ sides: { left: '50%' }, scale: 0.5 }));
  ok('and a share is of the picture as it sits, so at half size half its width is 30',
    halved.width === 90 && halved.gaps.left === 30, JSON.stringify([halved.width, halved.gaps]));
  const badSide = await page.evaluate(() => {
    try { window.CLI.jobs.plan({ sides: { left: 'lots' } }); return 'no complaint'; }
    catch (e) { return String(e.message); }
  });
  ok('a border that is not one is refused in a sentence that says what one is',
    /not a border for the left/.test(badSide) && /15%h/.test(badSide), badSide);
}

/* ------------------------------------------------------------- 8. a batch -- */

const B1 = await paint('uncrop-batch-tall.png', 90, 140, 'bands');
const B2 = await paint('uncrop-batch-wide.png', 160, 60, 'bands');

/* The runtime again, but this time as the page's own `sessionFor` sees it:
   `ort.InferenceSession.create` is the stub, and the weights are a few bytes
   put in the page's own IndexedDB store first, so `weights()` finds them
   there and fetches nothing. That is the cache round trip the suite could
   not reach before, and it means session creation — the GPU, the fallbacks,
   the polarity — is the page's real code. `gpu` decides whether the page is
   told there is a WebGPU adapter; `gpuRunFails` makes every run on it throw
   the error a GTX 1070 Ti really threw. */
async function fakeRuntime(o = {}) {
  await page.evaluate(async (o) => {
    window.CREATES = []; window.RUNS = []; window.RELEASED = 0;
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: o.gpu ? { requestAdapter: async () => ({}) } : undefined,
    });
    const side = 512, n = side * side;
    window.ort = {
      env: { wasm: {} },
      Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
      InferenceSession: {
        create: async (bytes, opts) => {
          const ep = opts.executionProviders[0];
          window.CREATES.push(ep);
          return {
            inputNames: ['image', 'mask'], outputNames: ['out'], inputMetadata: [],
            release: async () => { window.RELEASED++; },
            run: async (feed) => {
              window.RUNS.push(ep);
              if (ep === 'webgpu' && o.gpuRunFails) {
                throw new Error('[WebGPU] Kernel "[Add] /generator/model/model.5/conv1/ffc/convg2g/Add"'
                  + ' failed. Error: Can\'t perform binary op on the given tensors');
              }
              /* LaMa's export answers in 0–255 floats; magenta where told. */
              const img = feed.image.data, msk = feed.mask.data;
              const out = new Float32Array(3 * n);
              for (let i = 0; i < n; i++) {
                const hole = msk[i] === 1;
                out[i] = hole ? 255 : img[i] * 255;
                out[n + i] = hole ? 0 : img[n + i] * 255;
                out[2 * n + i] = hole ? 255 : img[2 * n + i] * 255;
              }
              return { out: { data: out, dims: [1, 3, side, side] } };
            },
          };
        },
      },
    };
    delete window.UNCROP.sessions.best;
    for (const k of Object.keys(window.UNCROP.gpuFailed)) delete window.UNCROP.gpuFailed[k];
    await window.UNCROP.keep('best', new Uint8Array(16).buffer);
  }, o);
}

/* A stored zip read in Node, which needs no decoder: a header, the name, the
   bytes as they are. */
function unzip(buf) {
  const out = [];
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18), nlen = buf.readUInt16LE(at + 26), xlen = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nlen).toString('utf8');
    const data = buf.subarray(at + 30 + nlen + xlen, at + 30 + nlen + xlen + size);
    out.push({ name, data, method: buf.readUInt16LE(at + 8) });
    at += 30 + nlen + xlen + size;
  }
  return out;
}
const ihdr = (png) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });

{
  await page.evaluate(() => { document.getElementById('file').value = ''; });
  const was = (await state()).loads;
  await page.setInputFiles('#file', [BANDS, B1, B2]);
  await page.waitForFunction(n => window.UNCROP.state.loads > n, was, { timeout: 15000 });
  const b = await page.evaluate(() => window.UNCROP.batch);
  ok('several pictures at once are a batch, with the first open to be set up',
    b.queue.length === 3 && (await state()).src.name === 'uncrop-bands'
      && await page.locator('#runAll').isVisible()
      && (await page.textContent('#runAll')).trim() === 'Uncrop all 3',
    JSON.stringify(b));
  ok('and the page says it will use what is set on this one on every one',
    /3 pictures/.test(await page.textContent('#batchSays'))
      && /Nothing is added to them yet/.test(await page.textContent('#batchRecipe')),
    `${await page.textContent('#batchSays')} | ${await page.textContent('#batchRecipe')}`);

  await page.locator('#addLeft').fill('15%h');
  ok('a border typed as a share is said as one, for every picture',
    (await page.textContent('#batchRecipe')).trim() === 'Each picture gets 15% of its height on the left.',
    await page.textContent('#batchRecipe'));

  await page.click('button[data-method="reflect"]');
  const [zipped] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('#runAll'),
  ]);
  const zfile = path.join(WORK, 'uncrop-batch.zip');
  await zipped.saveAs(zfile);
  const entries = unzip(fs.readFileSync(zfile));
  ok('Uncrop all saves the lot as one zip, each named after the picture it came from',
    zipped.suggestedFilename() === 'uncropped-3-pictures.zip'
      && entries.map(e => e.name).join() === 'uncrop-bands-uncropped.png,uncrop-batch-tall-uncropped.png,uncrop-batch-wide-uncropped.png',
    `${zipped.suggestedFilename()}: ${entries.map(e => e.name).join(', ')}`);
  const sizes = entries.map(e => ihdr(e.data));
  ok('and each one got its own 15% of its own height, on the left',
    JSON.stringify(sizes) === JSON.stringify([
      { w: 120 + 12, h: 80 }, { w: 90 + 21, h: 140 }, { w: 160 + 9, h: 60 }]),
    JSON.stringify(sizes));
  ok('the run says how it went, picture by picture adding up to a total',
    /^3 of 3 uncropped in/.test((await page.textContent('#runNote')).trim())
      && /Save all 3 as PNG/.test(await page.textContent('#saveAll')),
    `${await page.textContent('#runNote')} | ${await page.textContent('#saveAll')}`);

  /* The last picture in the zip has to be the file the page would make of it
     on its own, with the same border typed in — a batch is the page doing the
     same thing again, not a second way of doing it. */
  await open(B2);
  await page.click('button[data-method="reflect"]');
  const alone = await page.evaluate(() => window.CLI.jobs.run({ sides: { left: '15%h' }, method: 'reflect', format: 'png' }));
  ok('and a picture out of the batch is that picture uncropped on its own, byte for byte',
    Buffer.from(alone.bytes).equals(entries[2].data),
    `${alone.bytes.length} bytes alone against ${entries[2].data.length} from the zip`);
}

/* A canvas, not a border: a fixed size and a place on it carry over as the
   size and the same share of the room either side, which is what the align
   pad means — so against the bottom right stays against the bottom right. */
{
  await open(BANDS);
  await page.click('#presets button[data-size="1920x1080"]');
  await page.click('#align button[data-align="right bottom"]');
  const rc = await page.evaluate(() => window.UNCROP.recipeNow());
  const said = await page.evaluate((rc) => window.UNCROP.describeRecipe(rc), rc);
  await open(B1);
  await page.evaluate((rc) => window.UNCROP.applyRecipe(rc), rc);
  const s = await state();
  ok('a canvas and a corner carry over to a picture of another size',
    s.target.w === 1920 && s.target.h === 1080 && s.rect.x === 1920 - 90 && s.rect.y === 1080 - 140,
    JSON.stringify([s.target, s.rect]));
  ok('and the sentence says so', said === 'Each picture goes on a 1920 × 1080 canvas, against the bottom right, at its own pixels.', said);
}

/* A model in a batch is started once and used for every picture. */
{
  const fetched = [];
  const watch = (r) => { if (/huggingface|jsdelivr/.test(r.url())) fetched.push(r.url()); };
  page.on('request', watch);
  await fakeRuntime({ gpu: false });
  await page.evaluate(() => { document.getElementById('file').value = ''; });
  const was = (await state()).loads;
  await page.setInputFiles('#file', [BANDS, B1, B2]);
  await page.waitForFunction(n => window.UNCROP.state.loads > n, was, { timeout: 15000 });
  await page.locator('#addLeft').fill('40');
  await page.click('button[data-method="best"]');
  const [zipped] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('#runAll'),
  ]);
  const entries = unzip(fs.readFileSync(await zipped.path()));
  const made = await page.evaluate(() => ({ creates: window.CREATES, runs: window.RUNS.length }));
  ok('a model run over a batch is started once, not once a picture',
    made.creates.length === 1 && made.creates[0] === 'wasm' && entries.length === 3,
    JSON.stringify({ ...made, entries: entries.length }));
  page.off('request', watch);
  ok('and its weights came out of the page\'s own storage, with nothing fetched',
    fetched.length === 0 && made.runs >= 3, `${made.runs} runs; fetched ${fetched.join(', ')}`);
}

/* Stopping a batch stops the batch, not just the picture it was on. */
{
  await page.evaluate(() => {
    const was = window.UNCROP.sessions.best.session.run;
    window.UNCROP.sessions.best.session.run = async (feed) => {
      await new Promise(r => setTimeout(r, 300));
      return was(feed);
    };
  });
  const runsBefore = await page.evaluate(() => window.RUNS.length);
  await page.click('#runAll');
  await page.waitForFunction(() => /Picture 1 of 3/.test(document.getElementById('batchStep').textContent),
    null, { timeout: 20000 });
  await page.click('#stop');
  await page.waitForFunction(() => !window.UNCROP.batch.batching, null, { timeout: 30000 });
  const note = (await page.textContent('#runNote')).trim();
  /* Broken on purpose: taking out Stop's reach into the batch is caught here.
     Taking out either of the two places the batch loop looks at it is not,
     because each holds the batch up without the other — the check before the
     next picture and the one after a stopped picture. Both are kept.

     The first picture is one pass, so a Stop pressed during it may land
     before the pass starts or after it, and either is right; what is wrong is
     the batch carrying on to the second. */
  const runs = await page.evaluate(() => window.RUNS.length);
  ok('Stop during a batch ends the batch rather than moving on to the next picture',
    /^[01] of 3 uncropped/.test(note) && /stopped before the rest/.test(note) && runs <= runsBefore + 1,
    `${note} after ${runs} runs`);
}

/* ------------------------------------------- 9. a GPU that fails part way -- */

/* What happened on a GTX 1070 Ti: LaMa's session started on WebGPU and then
   a run failed inside a kernel. The page only fell back to the CPU when
   *starting* failed, so the run just ended in an error. Now a run that fails
   on the GPU is started again on the CPU, the status line says so, and the
   model stays off the GPU for the rest of the session. */
{
  await open(BANDS);
  await fakeRuntime({ gpu: true, gpuRunFails: true });
  await page.evaluate(() => {
    window.SAID = [];
    new MutationObserver(() => window.SAID.push(document.getElementById('stepDetail').textContent))
      .observe(document.getElementById('stepDetail'), { childList: true, characterData: true, subtree: true });
    window.UNCROP.setSize(300, 300); window.UNCROP.centre();
  });
  await page.click('button[data-method="best"]');
  await page.click('#run');
  await page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 60000 });
  const s = await state();
  const got = await page.evaluate(() => ({ creates: window.CREATES, runs: window.RUNS, released: window.RELEASED, said: window.SAID }));
  ok('a run that fails on the GPU is finished on the CPU instead of ending in an error',
    s.result && s.result.on === 'wasm' && s.result.passes === 3 && /Kernel/.test(s.result.fellBack),
    JSON.stringify({ result: s.result, note: await page.textContent('#runNote') }));
  ok('by throwing the GPU session away and starting one on the CPU, once',
    got.creates.join() === 'webgpu,wasm' && got.released === 1, JSON.stringify(got.creates) + ` released ${got.released}`);
  ok('and the pass that failed is the one run again, with the rest on the CPU',
    got.runs.join() === 'webgpu,wasm,wasm,wasm', got.runs.join());
  ok('the status line said so while it happened',
    got.said.some(t => /failed on your GPU, so it is starting again on the CPU/.test(t)), got.said.join(' | '));
  ok('and so does the line it finished on',
    /failed on your GPU, so it ran on the CPU/.test(await page.textContent('#runNote'))
      && /it failed on your GPU/.test(await page.textContent('#outFigures')),
    `${await page.textContent('#runNote')} | ${await page.textContent('#outFigures')}`);

  /* Remembered: a session started again later in the same visit is not
     offered the GPU, because the fault is in a kernel and would come back. */
  await page.evaluate(() => { delete window.UNCROP.sessions.best; window.CREATES = []; });
  await page.click('#run');
  await page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 60000 });
  const again = await page.evaluate(() => window.CREATES);
  ok('the model stays off the GPU for the rest of the session',
    again.join() === 'wasm' && (await state()).result.on === 'wasm' && !!(await state()).result.fellBack,
    JSON.stringify(again));
  ok('and the cost line says why it is on the CPU',
    /failed on your GPU, so it stays on the CPU/.test(await page.textContent('#cost')),
    await page.textContent('#cost'));

  /* The null: a GPU that works is used and nothing is said about falling back. */
  await fakeRuntime({ gpu: true, gpuRunFails: false });
  await page.click('#run');
  await page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 60000 });
  const fine = await state();
  ok('a GPU that works is kept, with nothing said about the CPU',
    fine.result.on === 'webgpu' && !fine.result.fellBack
      && (await page.evaluate(() => window.CREATES.join())) === 'webgpu'
      && !/CPU/.test(await page.textContent('#runNote')),
    JSON.stringify(fine.result));
}

/* --------------------------------------------------------------- the tally -- */

ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

await browser.close();

/* ------------------------------------------------------ what is not checked --

   - **Either real model.** Nothing here downloads MI-GAN or LaMa, so nothing
     here knows that the URLs still serve, that the two exports take their
     inputs under the names and types the page assumes, or that what comes
     back looks anything like a continuation of the picture. The stub proves
     the page's half of the contract and the polarity check is there because
     the other half cannot be proved from here. The first run against the real
     weights is the test this suite cannot be.

   - **Whether a fill looks right.** A model's output is judged here on
     landing in the right pixels, not on being any good — there is no check
     that could tell a plausible sky from a smear, and a page that quietly
     started producing smears would pass every line above.

   - **WebGPU itself.** Section 9 tells the page there is an adapter and
     stubs the runtime, so the choice of WebGPU, the fallback when a run on
     it fails, and remembering that are the page's real code; a real GPU, and
     the proxy and thread settings for the CPU, are not exercised.

   - **The weight cache, filled by a download.** `keep` and `cached` are now
     reached — sections 8 and 9 put the weights in the store and the page
     reads them back — but `weights()` writing what it has just fetched is
     still only reached with a real download.

   Broken on purpose for the borders, the batch and the GPU fallback: a bare
   % read on the wrong axis, the picture left at the edge instead of where the
   border leaves it, no fallback on a failed run, the fallback not
   remembered, no status line about it, a batch's name with the size in it,
   the recipe not applied, the session thrown away between pictures, the
   fields showing pixels while a border is being typed, the page opening on
   the fast model, and Stop not reaching the batch were each caught. The two
   places the batch loop reads Stop cover for each other, as written beside
   that check.

   - **Anything above 64 megapixels, and the 16384 limit itself.** The
     refusals are checked as arithmetic; what a browser actually does when
     handed a canvas that big is not.

   - **A format this browser cannot write.** `encode` refuses a blob that
     comes back under the wrong type, which is what a canvas does when asked
     for a format it has not got — but Chromium writes all three of these, so
     that guard cannot be reached from outside and nothing here covers it.

   - **The mask, to within the feather.** The mask's box is checked against
     arithmetic to the pixel, which is the only way it can be: the picture is
     stamped back over the result at the end, so a mask one or two pixels out
     leaves nothing in the output at all. Reading it off the saved picture
     instead was tried and could not see a twelve-pixel error.

   Every check above was then broken on purpose, one at a time, and watched to
   see which one noticed. Twenty-one deliberate faults; the two that went
   unnoticed the first time round — a mask rounded the generous way, and the
   model's square view pasted back without being cropped — are what the
   mask-box and letterbox-ramp checks were added for.
*/

process.exit(done());
