/* The colour picker's palette builder: the part that reads an image and says
   what colours are in it.

   Every image here is painted by the suite in flat bands of known colour and
   known width, so the right answer is arithmetic rather than opinion — a band
   that is three tenths of the picture has to come back as three tenths of the
   picture. The colour maths is written out again at the bottom of this file
   rather than borrowed from the page, so a mistake in the page's OKLab cannot
   agree with itself. */
import { chromium, CHROMIUM_BIN } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/color-picker.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) pass++; else fail++;
  console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
};

await page.goto(URL);
await page.waitForTimeout(250);

/* ------------------------------------------------------------ the images -- */

/* Flat vertical bands, each as wide as its share of the picture. Nothing is
   dithered, blurred or noised, so what the page should find is exactly the
   list that went in. */
const bandsPng = (bands) => page.evaluate(async (list) => {
  const W = 600, H = 300;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let x = 0;
  list.forEach(([hex, share], i) => {
    const w = i === list.length - 1 ? W - x : Math.round(W * share);
    g.fillStyle = hex;
    g.fillRect(x, 0, w, H);
    x += w;
  });
  const blob = await new Promise(done => c.toBlob(done, 'image/png'));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}, bands);

async function load(bands, name = 'bands.png') {
  await page.click('#tab-image');
  const bytes = await bandsPng(bands);
  await page.setInputFiles('#file', { name, mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await page.waitForSelector('#stage-wrap:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(200);
}

const read = () => page.evaluate(() => ({
  swatches: [...document.querySelectorAll('#pal-grid .swatch')].map(s => ({
    hex: s.querySelector('.hex').textContent.trim(),
    meta: s.querySelector('.meta').textContent.trim(),
  })),
  status: document.getElementById('pal-status').textContent,
  countBox: document.getElementById('pal-count').value,
  rule: document.getElementById('pal-rule').value,
}));

async function build({ count = '', rule = 'dominant' } = {}) {
  await page.click('#tab-palette');
  await page.selectOption('#pal-rule', rule);
  await page.fill('#pal-count', String(count));
  await page.click('#pal-go');
  await page.waitForTimeout(350);
  return read();
}

const shareOf = (meta) => {
  const m = /^(\d+)%/.exec(meta);
  return m ? Number(m[1]) : (/^under 1%/.test(meta) ? 0.5 : null);
};
const partsOf = (meta) => {
  const m = /(\d+) shades combined/.exec(meta);
  return m ? Number(m[1]) : 1;
};

/* ----------------------------------------------- the commonest colours -- */

const THREE = [['#cc2222', 0.5], ['#22aa44', 0.3], ['#2244cc', 0.2]];
await load(THREE);
await page.click('#img-palette');
await page.waitForTimeout(500);
let r = await read();

ok('the button goes to the picture\'s own colours', r.rule === 'dominant', r.rule);
ok('and asks for no particular number of them', r.countBox === '', JSON.stringify(r.countBox));
ok('three bands come back as three colours', r.swatches.length === 3,
  JSON.stringify(r.swatches));
ok('each one of them the colour that was painted',
  r.swatches.every((s, i) => near(s.hex, THREE[i][0]) < 0.02),
  r.swatches.map((s, i) => `${s.hex} for ${THREE[i][0]} (${near(s.hex, THREE[i][0]).toFixed(3)})`).join(', '));
ok('commonest first, with the share each one covers',
  r.swatches.map(s => shareOf(s.meta)).join(',') === '50,30,20',
  r.swatches.map(s => s.meta).join(' | '));

/* ------------------------------------------------- combining what is alike -- */

/* Two blues a hair apart and a red. The blues are one colour to anybody
   looking at the picture, and the palette has to say so — with their
   coverage added together rather than one of them thrown away. */
await load([['#2244cc', 0.35], ['#2546d0', 0.35], ['#cc2222', 0.3]]);
r = await build();
ok('two shades of one colour come back as one colour', r.swatches.length === 2,
  JSON.stringify(r.swatches));
ok('and it says how many shades went into it', partsOf(r.swatches[0].meta) === 2,
  r.swatches[0].meta);
ok('carrying the coverage of both', shareOf(r.swatches[0].meta) === 70, r.swatches[0].meta);
ok('and the colour is one of the two, not an average of them',
  near(r.swatches[0].hex, '#2244cc') < 0.01 || near(r.swatches[0].hex, '#2546d0') < 0.01,
  r.swatches[0].hex);
ok('the red is left alone', near(r.swatches[1].hex, '#cc2222') < 0.02, r.swatches[1].hex);

/* Nothing in a palette it chose the size of should be close enough to
   anything else in it to be called the same colour. That is the whole of
   what "combining similar colours" means, stated as a property. */
const SIX = [['#cc2222', 1 / 6], ['#22aa44', 1 / 6], ['#2244cc', 1 / 6],
             ['#dddd22', 1 / 6], ['#aa22cc', 1 / 6], ['#eeeeee', 1 / 6]];
await load(SIX);
r = await build();
let closest = Infinity;
for (let i = 0; i < r.swatches.length; i++) {
  for (let j = i + 1; j < r.swatches.length; j++) {
    closest = Math.min(closest, near(r.swatches[i].hex, r.swatches[j].hex));
  }
}
ok('no two colours it chose are the same colour', closest >= 0.1, `nearest pair ${closest.toFixed(3)}`);

/* ------------------------------------------------------- how many it picks -- */

ok('six colours that all hold a sixth of the frame give six',
  r.swatches.length === 6, JSON.stringify(r.swatches.map(s => s.hex)));
ok('and it says why it went past five', /Past five/.test(r.status), r.status);

await load(THREE);
r = await build();
ok('three give three', r.swatches.length === 3, JSON.stringify(r.swatches.map(s => s.hex)));
ok('and it says why it stopped short of five', /Fewer than five/.test(r.status), r.status);

/* Five real colours and a speck. Five is what it aims for, and a speck is
   not a reason to go to six. */
await load([['#cc2222', 0.24], ['#22aa44', 0.24], ['#2244cc', 0.24],
            ['#dddd22', 0.14], ['#eeeeee', 0.13], ['#111111', 0.01]]);
r = await build();
ok('a speck does not earn a sixth place', r.swatches.length === 5,
  JSON.stringify(r.swatches.map(s => s.hex + ' ' + s.meta)));
ok('and it says one was left out', /1 smaller one left out/.test(r.status), r.status);
ok('the five are the five big bands',
  r.swatches.every(s => ['#cc2222', '#22aa44', '#2244cc', '#dddd22', '#eeeeee']
    .some(want => near(s.hex, want) < 0.02)),
  JSON.stringify(r.swatches.map(s => s.hex)));

/* ------------------------------------------------------- asking for a number -- */

await load(SIX);
r = await build({ count: 3 });
ok('asked for three, it gives three', r.swatches.length === 3,
  JSON.stringify(r.swatches.map(s => s.hex + ' ' + s.meta)));
ok('every one of them still a colour that is in the picture',
  r.swatches.every(s => SIX.some(([hex]) => near(s.hex, hex) < 0.02)),
  JSON.stringify(r.swatches.map(s => s.hex)));
ok('with the shares still adding up to the whole picture',
  Math.abs(r.swatches.reduce((t, s) => t + shareOf(s.meta), 0) - 100) <= 2,
  r.swatches.map(s => s.meta).join(' | '));
ok('and the swatch says what was folded into it',
  r.swatches.some(s => partsOf(s.meta) > 1), r.swatches.map(s => s.meta).join(' | '));

r = await build({ count: 12 });
ok('asked for twelve where there are six, it gives six', r.swatches.length === 6,
  JSON.stringify(r.swatches.map(s => s.hex)));
ok('and says that is all the picture has',
  /You asked for 12/.test(r.status), r.status);

r = await build({ count: 99 });
ok('a number past the top of the range is clamped, not obeyed',
  r.countBox === '16', r.countBox);

/* ------------------------------------------------ a rule, with no number -- */

await load(THREE);
for (const [rule, want] of [['complementary', 2], ['triadic', 3], ['square', 4],
                            ['analogous', 5], ['monochromatic', 5]]) {
  r = await build({ rule: rule });
  ok(`${rule} with an empty box asks for ${want}`, r.swatches.length === want,
    `${r.swatches.length}: ${r.status}`);
}
r = await build({ rule: 'triadic', count: 6 });
ok('and a number still overrules it', r.swatches.length === 6, r.swatches.length);

/* --------------------------------------------------------------- copying -- */

r = await build();
await page.click('#pal-copy');
await page.waitForTimeout(200);
const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim().split('\n');
ok('copy hex gives the colours that are on screen',
  copied.join(',') === r.swatches.map(s => s.hex).join(','),
  `${copied.join(',')} against ${r.swatches.map(s => s.hex).join(',')}`);

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passing, ${fail} failing`);
await browser.close();
process.exit(fail ? 1 : 0);

/* ------------------------------------------------------- the colour maths -- */

/* sRGB to OKLab, written out here rather than read off the page: the point
   of measuring how far apart two of its answers are is to check the page,
   and borrowing its arithmetic to do that checks nothing. */
function near(hexA, hexB) {
  const a = oklab(hexA), b = oklab(hexB);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

function oklab(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}
