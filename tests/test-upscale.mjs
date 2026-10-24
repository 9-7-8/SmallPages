/* The image upscaler. Two super-resolution models in a worker, a pass plan
   that gets from whatever the picture is to whatever was asked for, and a
   seam to compare the answer against the browser's own stretch.

   What is worth checking here is not that a function returned a number: it is
   that the picture coming out is the size that was asked for, that it is
   actually sharper than a stretch of the same input rather than merely
   bigger, and that the tiles the models are fed in do not leave a grid behind
   them. The models run on whatever GPU the test machine has — in a headless
   container that is a software rasteriser, so each tile costs seconds — which
   is why every picture here is tiny and why the suite waits on the fast
   model's answer rather than on both. */
import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';
import fs from 'node:fs';

const { ok, done } = scoring();
const SITE = 'http://127.0.0.1:8099/image-upscaler.html';

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => {
  const t = m.text();
  // The software-WebGL notice and the missing favicon are the container, not
  // the page.
  if (m.type() === 'error' && !/favicon|404|GroupMarker|swiftshader/i.test(t)) errs.push(t);
});

/* The pictures the suite draws for itself. Flat colour would upscale
   perfectly by any means at all and prove nothing, so each one has the kind
   of structure an upscaler is judged on: a hard diagonal, bars and a disc, or
   a dead-straight ramp. */
const PAINTERS = `
  const paint = {
    wedge: (x, w, h) => {
      x.fillStyle = '#1b3a6b'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#f4c542';
      x.beginPath(); x.moveTo(0, h); x.lineTo(w, 0); x.lineTo(w, h); x.fill();
    },
    shapes: (x, w, h) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#101820';
      for (let i = 0; i < 5; i++) x.fillRect(8 + i * 20, 10, 8, h - 40);
      x.beginPath(); x.arc(w * 0.3, h * 0.8, h * 0.12, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#c03020';
      x.beginPath(); x.moveTo(w * 0.6, h * 0.6); x.lineTo(w, h * 0.6); x.lineTo(w, h); x.fill();
    },
    ramp: (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#102030'); g.addColorStop(1, '#e0d0c0');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    },
    flat: (x, w, h) => { x.fillStyle = '#404a55'; x.fillRect(0, 0, w, h); },
  };
  const draw = (what, w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint[what](c.getContext('2d'), w, h);
    return c;
  };
  const shrink = (canvas, w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, w, h);
    return c;
  };
`;

/* Hands the page a file the way a person would, and keeps what it was made
   from in `window.__truth` when the picture is a reduction of a bigger one —
   which is the only way to ask whether an upscale got back what was lost. */
async function hand(spec) {
  await page.evaluate(async (s) => {
    const F = new Function(`${s.painters}; return { draw, shrink };`)();
    const big = F.draw(s.what, s.w, s.h);
    const file = s.scale ? F.shrink(big, Math.round(s.w / s.scale), Math.round(s.h / s.scale)) : big;
    if (s.scale) {
      window.__truth = big.getContext('2d').getImageData(0, 0, s.w, s.h);
      window.__input = file.getContext('2d').getImageData(0, 0, file.width, file.height);
    }
    const blob = await new Promise(r => file.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], s.name, { type: 'image/png' }));
    const input = document.getElementById('fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, { ...spec, painters: PAINTERS });
}

const state = () => page.evaluate(() => ({
  state: document.body.dataset.state,
  fast: document.body.dataset.fast,
  best: document.body.dataset.best,
  status: document.getElementById('status').textContent,
  meta: document.getElementById('meta').textContent,
  tagLeft: document.getElementById('tagLeft').textContent,
  tagRight: document.getElementById('tagRight').textContent,
  bare: document.getElementById('wipe').classList.contains('bare'),
  seam: Number(document.getElementById('seam').getAttribute('aria-valuenow')),
  clip: document.getElementById('beforeLayer').style.clipPath,
  out: (() => { const c = document.querySelector('#afterLayer canvas'); return c ? [c.width, c.height] : null; })(),
  sizes: [...document.querySelectorAll('#sizeSeg button')].map(b => `${b.dataset.size}:${b.disabled ? 'off' : 'on'}`),
  models: [...document.querySelectorAll('#modelSeg button')].map(b => `${b.dataset.model}:${b.disabled ? 'off' : 'on'}`),
  pressed: {
    size: document.querySelector('#sizeSeg [aria-pressed="true"]')?.dataset.size,
    model: document.querySelector('#modelSeg [aria-pressed="true"]')?.dataset.model,
  },
  target: [document.getElementById('targetW').value, document.getElementById('targetH').value],
}));

// Each tile is seconds on a software rasteriser, so the waits are generous
// and the pictures are small.
const settled = (which = 'fast', ms = 180000) =>
  page.waitForFunction(w => ['ready', 'failed'].includes(document.body.dataset[w]), which,
                       { timeout: ms, polling: 500 });

const click = async (sel) => { await page.click(sel); };

/* ----------------------------------------------------------------- empty -- */

await page.goto(SITE);
await page.waitForTimeout(300);
let s = await state();
ok('starts with nothing shown', s.out === null && s.status === '', JSON.stringify(s.status));
ok('4× is the size it offers first', s.pressed.size === '4', s.pressed.size);
ok('the fast model is the one it offers first', s.pressed.model === 'fast', s.pressed.model);

/* ------------------------------------------------- the fast model, 4× -- */

await hand({ name: 'wedge.png', what: 'wedge', w: 24, h: 18 });
await settled('fast');
s = await state();
ok('the fast answer is exactly 4× the picture', String(s.out) === '96,72', String(s.out));
ok('it says which model drew it', /Real-ESRGAN general x4v3/.test(s.status), s.status);
ok('and in one 4× pass', /one 4× pass/.test(s.status), s.status);
ok('the tag over the picture names the model and the step', s.tagRight === 'Fast · 4×', s.tagRight);
ok('the other side of the seam is the stretch', s.tagLeft === 'Stretched', s.tagLeft);
ok('the quality model is already running behind it', s.best === 'running' || s.best === 'ready', s.best);

/* The handover is the thing the page is built around: the fast answer goes up
   and the heavier one replaces it when it lands, with nobody asked to wait. */
await settled('best');
s = await state();
ok('the quality model lands by itself and takes the view',
   s.pressed.model === 'best' && /Real-CUGAN conservative/.test(s.status), `${s.pressed.model} ${s.status}`);
ok('it is the same size as the fast answer', String(s.out) === '96,72', String(s.out));
ok('the fast answer is still there to compare',
   /Fast has finished too/.test(s.status), s.status);

const differ = await page.evaluate(() => {
  // The two models must not be handing back the same pixels — that would mean
  // one of them never ran.
  const canvas = document.querySelector('#afterLayer canvas');
  const now = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  document.querySelector('#modelSeg [data-model="fast"]').click();
  const then = document.querySelector('#afterLayer canvas')
    .getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < now.length; i += 4) sum += Math.abs(now[i] - then[i]);
  return sum / (now.length / 4);
});
ok('the two models drew different pictures', differ > 0.5, `mean difference ${differ.toFixed(2)}`);

/* -------------------------------------------------------------- the seam -- */

const box = await page.evaluate(() => {
  const r = document.getElementById('wipe').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.25, box.y + box.h * 0.5, { steps: 6 });
await page.mouse.up();
s = await state();
ok('dragging the seam takes it where the pointer went', Math.abs(s.seam - 25) <= 2, s.seam);
// the browser gives the computed form back, which is where the px come from
ok('and clips the stretched side to match', /^inset\(0(px)? 7[456](\.\d+)?%/.test(s.clip), s.clip);

await page.focus('#seam');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
s = await state();
ok('the arrow keys walk it across too', Math.abs(s.seam - 29) <= 2, s.seam);
await page.keyboard.press('End');
s = await state();
ok('End puts the stretch over the whole picture', s.seam === 100, s.seam);
await page.keyboard.press('Home');
s = await state();
ok('Home takes it off again', s.seam === 0, s.seam);

/* ----------------------------------------------------- the other sizes --- */

await click('#sizeSeg [data-size="2"]');
await settled('fast');
s = await state();
ok('2× is exactly 2×', String(s.out) === '48,36', String(s.out));
ok('2× still costs the fast model a 4× pass', /one 4× pass/.test(s.status), s.status);

await click('#sizeSeg [data-size="8"]');
await settled('fast');
s = await state();
ok('8× is exactly 8×', String(s.out) === '192,144', String(s.out));
ok('8× is two passes', /4× then 4×/.test(s.status), s.status);

/* --------------------------------------------------------- target sizes -- */

await click('#sizeSeg [data-size="target"]');
s = await state();
ok('the target boxes start from the 4× size', s.target.join('×') === '96×72', s.target.join('×'));

await page.fill('#targetW', '150');
await page.waitForTimeout(100);
s = await state();
ok('the height follows the width in proportion', s.target.join('×') === '150×113', s.target.join('×'));
await page.keyboard.press('Enter');
await settled('fast');
s = await state();
ok('a target size comes out at exactly that size', String(s.out) === '150,113', String(s.out));
ok('and says what it ran to get there', /Real-ESRGAN/.test(s.status), s.status);

/* A reduction is not a job for a model, and the page has to say so rather
   than quietly running one. */
await page.fill('#targetW', '12');
await page.keyboard.press('Enter');
await settled('fast');
s = await state();
ok('a target smaller than the original is just resampled', String(s.out) === '12,9', String(s.out));
ok('it says there is no model in it', /No model: this is a reduction/.test(s.status), s.status);
ok('and the model buttons are off while it is', s.models.join(' ') === 'fast:off best:off', s.models.join(' '));
ok('the tag says resampled rather than a model name', /^Resampled/.test(s.tagRight), s.tagRight);

/* ------------------------------------------------- what it refuses to do -- */

// 4× of a 1200 × 900 picture is seventeen megapixels, past the ceiling on
// both models, so nothing should start at all.
await page.goto(SITE);
await page.waitForTimeout(200);
await hand({ name: 'big.png', what: 'flat', w: 1200, h: 900 });
await page.waitForTimeout(1500);
s = await state();
ok('a size past the ceiling starts no run', s.fast === 'idle' && s.best === 'idle', `${s.fast}/${s.best}`);
ok('it says how big that would have been', /megapixels/.test(s.status), s.status);
ok('the sizes that cannot be reached are turned off',
   s.sizes.join(' ') === '2:on 4:off 8:off target:on', s.sizes.join(' '));
ok('the original stands there on its own', s.bare && String(s.out) === '1200,900', `${s.bare} ${s.out}`);

/* ------------------------------------------- did it actually upscale it? -- */

/* The claim a super-resolution page lives or dies by. A known picture is
   reduced by four, handed over, and the answer is measured against the
   original it came from — alongside the browser's own stretch of the same
   input, which is what the page puts on the other side of the seam. Beating
   that stretch is the whole point, and a model that had quietly failed to
   load would come out level with it. */
await page.goto(SITE);
await page.waitForTimeout(200);
await hand({ name: 'shapes.png', what: 'shapes', w: 128, h: 96, scale: 4 });
await settled('fast');
s = await state();
ok('the reduced picture comes back at the size it started', String(s.out) === '128,96', String(s.out));

const quality = await page.evaluate((painters) => {
  const F = new Function(`${painters}; return { draw, shrink };`)();
  const truth = window.__truth;
  const small = window.__input;
  // the stretch the page itself shows on the left of the seam
  const stretched = (() => {
    const c = document.createElement('canvas');
    c.width = small.width; c.height = small.height;
    c.getContext('2d').putImageData(small, 0, 0);
    const big = document.createElement('canvas');
    big.width = truth.width; big.height = truth.height;
    const x = big.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, truth.width, truth.height);
    return x.getImageData(0, 0, truth.width, truth.height);
  })();
  const out = document.querySelector('#afterLayer canvas')
    .getContext('2d').getImageData(0, 0, truth.width, truth.height);
  const psnr = (a, b) => {
    let se = 0, n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      for (let k = 0; k < 3; k++) { const d = a.data[i + k] - b.data[i + k]; se += d * d; n++; }
    }
    return 10 * Math.log10(255 * 255 / (se / n));
  };
  return { stretch: psnr(truth, stretched), model: psnr(truth, out) };
}, PAINTERS);
ok('the model is closer to the original than a stretch is',
   quality.model > quality.stretch + 1.5,
   `model ${quality.model.toFixed(2)} dB vs stretch ${quality.stretch.toFixed(2)} dB`);

/* ---------------------------------------------------------- tile seams --- */

/* The models take a fixed 64 px patch, so anything wider than that is walked
   in overlapping tiles and blended back together. Getting that blend wrong
   leaves a grid down the picture, which is the one bug in a tiled upscaler
   that everybody sees and no dimension check catches. A dead-straight ramp is
   the probe: whatever the model does to it, the answer should still be smooth,
   so a tile boundary shows up as a kink nowhere else in the row has. */
await page.goto(SITE);
await page.waitForTimeout(200);
await hand({ name: 'ramp.png', what: 'ramp', w: 150, h: 40 });
await settled('fast');
s = await state();
ok('a picture wider than one tile comes back whole', String(s.out) === '600,160', String(s.out));

const seams = await page.evaluate(() => {
  const canvas = document.querySelector('#afterLayer canvas');
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const y = Math.floor(height / 2);
  const row = [];
  for (let x = 0; x < width; x++) row.push(data[(y * width + x) * 4]);
  // |second difference| along the row: a kink at a tile edge is a spike in it
  const kink = [];
  for (let x = 1; x + 1 < width; x++) kink.push(Math.abs(row[x - 1] - 2 * row[x] + row[x + 1]));
  // the tiles start at 0, 52 and 86 of the input, so the joins land here
  const joins = [52 * 4, 86 * 4];
  const near = (x) => joins.some(j => Math.abs(x - j) <= 6);
  const at = kink.filter((_, i) => near(i + 1));
  const away = kink.filter((_, i) => !near(i + 1));
  const mean = (a) => a.reduce((t, v) => t + v, 0) / a.length;
  return { worstJoin: Math.max(...at), worstElsewhere: Math.max(...away),
           meanJoin: mean(at), meanElsewhere: mean(away), span: Math.max(...row) - Math.min(...row) };
});
ok('the ramp survived as a ramp', seams.span > 120, `span ${seams.span}`);
ok('no kink at the tile joins beyond what the rest of the row has',
   seams.worstJoin <= Math.max(2, seams.worstElsewhere),
   `join ${seams.worstJoin} vs elsewhere ${seams.worstElsewhere}`);
ok('and the joins are no rougher on average',
   seams.meanJoin <= seams.meanElsewhere + 0.3,
   `join ${seams.meanJoin.toFixed(2)} vs elsewhere ${seams.meanElsewhere.toFixed(2)}`);

/* ------------------------------------------------------- the saved file -- */

/* Reading the PNG back off disk is the only way to know what was actually
   written: the header carries the size, so a file that claims to be the
   upscale and isn't gets caught here rather than in a label. */
const save = WORK + '/upscaled.png';
fs.rmSync(save, { force: true });
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#saveBtn'),
]);
await download.saveAs(save);
const png = fs.readFileSync(save);
const ihdr = png.indexOf('IHDR');
const wrote = [png.readUInt32BE(ihdr + 4), png.readUInt32BE(ihdr + 8)];
ok('the download is a PNG of the upscale, read back off disk',
   png.slice(1, 4).toString() === 'PNG' && String(wrote) === '600,160', String(wrote));
ok('its name says what size it is', /600x160\.png$/.test(download.suggestedFilename()),
   download.suggestedFilename());

/* ------------------------------------------------ asking for the other one -- */

/* Picking the quality model while the fast one is still going has to hand the
   GPU over rather than start a second run beside the first. Both runs went
   through one worker from the beginning, so the second would have orphaned
   the first: its answer would have come back under an id nobody was waiting
   for any more, and the model that ran it would have sat at "running" for the
   rest of the session. */
await page.goto(SITE);
await page.waitForTimeout(200);
// Four tiles rather than one, so the fast run is still going when the other
// model is asked for — and the asking reads the state and clicks in the same
// breath, so there is no window between the two for it to finish in.
await hand({ name: 'wedge.png', what: 'wedge', w: 100, h: 70 });
await page.waitForFunction(() => document.body.dataset.fast === 'running', null,
                           { timeout: 60000, polling: 50 });
const cutIn = await page.evaluate(() => {
  const was = document.body.dataset.fast;
  document.querySelector('#modelSeg [data-model="best"]').click();
  return was;
});
s = await state();
ok('the fast run gives way when the other model is asked for',
   cutIn === 'running' && s.fast === 'idle' && s.pressed.model === 'best',
   `was ${cutIn}, now ${s.fast} / ${s.pressed.model}`);

await settled('best');
s = await state();
ok('the model that was asked for is the one that answers',
   /Real-CUGAN conservative/.test(s.status) && String(s.out) === '400,280', s.status);

await settled('fast');
s = await state();
ok('and the one that gave way is picked up again afterwards, not left hanging',
   s.fast === 'ready', s.fast);
ok('with the asked-for answer still the one on screen',
   s.pressed.model === 'best' && s.tagRight === 'High quality · 4×', s.tagRight);

ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

await browser.close();
process.exit(done());
