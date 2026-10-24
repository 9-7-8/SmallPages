import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1400 }, acceptDownloads: true });
const errs = [];
/* Chromium's text for a subresource that would not load never names the file
   — "Failed to load resource: … 404" and the URL only in the message's
   location. So filtering the text for "favicon" matched nothing, and this
   suite failed every run on the browser asking for an icon the repo does not
   carry. Filtered on the location instead, a 404 of something the page really
   does want still counts against it. */
const anIcon = m => /\/favicon\.ico$/.test((m.location() || {}).url || '');
page.on('console', m => { if (m.type() === 'error' && !anIcon(m)) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
let failed = 0;
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x)); };

await page.goto('http://127.0.0.1:8099/split-sheet.html');
await page.waitForTimeout(300);

// Draws a sheet in the page and drops it in. `kind` picks the backdrop.
const drop = (kind) => page.evaluate(async (kind) => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  const g = c.getContext('2d');
  if (kind === 'checker') {
    for (let y = 0; y < 300; y += 10) for (let x = 0; x < 400; x += 10) {
      g.fillStyle = ((x + y) / 10) % 2 ? '#cccccc' : '#ffffff'; g.fillRect(x, y, 10, 10);
    }
  } else if (kind === 'noisy') {
    for (let y = 0; y < 300; y += 4) for (let x = 0; x < 400; x += 4) {
      g.fillStyle = `hsl(${(x * 7 + y * 13) % 360} 70% 50%)`; g.fillRect(x, y, 4, 4);
    }
  } else {
    g.fillStyle = '#2a1a16'; g.fillRect(0, 0, 400, 300);         // a dark flat backdrop, like a game kit
  }
  if (kind !== 'noisy') {
    // 1: a ring: dark outline round a white middle the flood must not reach
    g.fillStyle = '#d04040'; g.beginPath(); g.arc(70, 80, 45, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(70, 80, 25, 0, Math.PI * 2); g.fill();
    // 2 and 3: two blocks joined only by a faint mark just off the backdrop (a watermark)
    g.fillStyle = '#3080d0'; g.fillRect(170, 50, 60, 60);
    g.fillStyle = '#30a050'; g.fillRect(270, 50, 60, 60);
    // past the flood's tolerance (32) but under "ignore faint marks" (70): about 56 from the backdrop
    if (kind === 'flat') { g.fillStyle = '#4e3a32'; g.fillRect(230, 75, 40, 10); }
    // 4: a frame with a flourish 2px off its corner, which should stay with it
    g.fillStyle = '#e0b040'; g.fillRect(150, 180, 120, 70);
    g.fillRect(272, 172, 8, 8);
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer(); dt.items.add(new File([blob], `sheet-${kind}.png`, { type: 'image/png' }));
  const i = document.getElementById('fileInput'); i.files = dt.files; i.dispatchEvent(new Event('change'));
}, kind);

const read = () => page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  sizes: [...document.querySelectorAll('.piece canvas')].map(c => `${c.width}x${c.height}`),
  // is the middle of the ring still solid white?
  ringMiddle: (() => {
    const c = [...document.querySelectorAll('.piece canvas')].find(c => Math.abs(c.width - 91) <= 3 && Math.abs(c.height - 91) <= 3);
    if (!c) return 'no ring';
    const d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return d[3] > 200 && d[0] > 240 ? 'white' : `rgba(${[...d].join(',')})`;
  })(),
}));

await drop('flat');
await page.waitForTimeout(1200);
let s = await read();
ok('flat sheet: four pieces', s.sizes.length === 4, `${s.sizes.length}: ${s.sizes.join(' ')} / ${s.status}`);
ok('status names the backdrop', /one colour \(#2a1a16\)/.test(s.status), s.status);
ok('walled-in white survives the flood', s.ringMiddle === 'white', s.ringMiddle);
// each block keeps at most a 2px stub of the mark running off it
const blocks = s.sizes.map(z => z.split('x').map(Number)).filter(([w, h]) => h === 60 && w >= 60 && w <= 62);
ok('faint mark does not join the two blocks', blocks.length === 2, s.sizes.join(' '));
ok('flourish 2px off stays with its frame', s.sizes.some(z => z === '130x78'), s.sizes.join(' '));

// The gap slider: join nothing, and the flourish comes off as its own piece... unless it's too small to count.
await page.fill('#minSize', '0'); await page.locator('#minSize').dispatchEvent('input');
await page.fill('#gap', '0'); await page.locator('#gap').dispatchEvent('input');
await page.waitForTimeout(800);
s = await read();
ok('gap 0 splits the flourish off', s.sizes.length === 5, s.sizes.join(' '));
// Faint marks counted: the watermark now bridges the blocks into one piece.
await page.fill('#gap', '4'); await page.locator('#gap').dispatchEvent('input');
await page.fill('#faint', '0'); await page.locator('#faint').dispatchEvent('input');
await page.waitForTimeout(800);
s = await read();
ok('with faint marks counted the watermark bridges', s.sizes.some(z => z === '160x60'), s.sizes.join(' '));
await page.fill('#faint', '70'); await page.locator('#faint').dispatchEvent('input');
await page.fill('#minSize', '180'); await page.locator('#minSize').dispatchEvent('input');
await page.waitForTimeout(800);

// The zip: every piece, as a real zip, named after the sheet.
const dl = page.waitForEvent('download', { timeout: 20000 });
await page.click('#zipBtn');
const got = await dl.catch(() => null);
ok('zip saves', !!got, 'no download');
if (got) {
  ok('zip named after the sheet', got.suggestedFilename() === 'sheet-flat-pieces.zip', got.suggestedFilename());
  const file = path.join(WORK, 'sheet-pieces.zip');
  await got.saveAs(file);
  const buf = fs.readFileSync(file);
  const count = buf.readUInt16LE(buf.length - 12);
  ok('zip holds four files', count === 4, count);
  ok('first entry is a PNG', buf.slice(30 + buf.readUInt16LE(26), 30 + buf.readUInt16LE(26) + 4).toString('latin1') === '\x89PNG', 'not a PNG');
}

await drop('checker');
await page.waitForTimeout(1200);
s = await read();
ok('checkerboard recognised', /checkerboard/.test(s.status), s.status);
ok('checkerboard sheet: four pieces', s.sizes.length === 4, `${s.sizes.length}: ${s.sizes.join(' ')}`);

await drop('noisy');
await page.waitForTimeout(1200);
s = await read();
ok('a busy picture is refused, with the reason', /isn't one colour/.test(s.status) && s.sizes.length === 0, s.status);

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
process.exit(failed || errs.length ? 1 : 0);
