import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1500 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/image-grid.html');
await page.waitForTimeout(400);

ok('starts empty', await page.textContent('#status') === 'No pictures yet.', await page.textContent('#status'));
ok('canvas starts tiny', await page.evaluate(() => document.getElementById('canvas').width) === 16, '');

// Seven pictures of deliberately mixed shapes and known flat colours.
const SPEC = [
  ['a-wide.png',   800, 200, '#ff0000'],
  ['b-tall.png',   200, 800, '#00ff00'],
  ['c-square.png', 400, 400, '#0000ff'],
  ['d-small.png',  100, 100, '#ffff00'],
  ['e-wide.png',   600, 300, '#ff00ff'],
  ['f-tall.png',   300, 600, '#00ffff'],
  ['g-square.png', 500, 500, '#ff8800'],
];
await page.evaluate(async (spec) => {
  const files = [];
  for (const [name, w, h, col] of spec) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, w, h);
    const b = await new Promise(r => c.toBlob(r));
    files.push(new File([b], name, { type: 'image/png' }));
  }
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  const i = document.getElementById('fileInput');
  i.files = dt.files;
  i.dispatchEvent(new Event('change'));
}, SPEC);
await page.waitForTimeout(1200);

const read = () => page.evaluate(() => ({
  w: document.getElementById('canvas').width,
  h: document.getElementById('canvas').height,
  shape: document.getElementById('shape').textContent,
  status: document.getElementById('status').textContent,
  thumbs: document.querySelectorAll('.thumb').length,
  order: [...document.querySelectorAll('.thumb')].map(t => t.title.split(' —')[0]),
}));

let s = await read();
ok('seven taken', /7 pictures/.test(s.status), s.status);
ok('seven thumbnails', s.thumbs === 7, s.thumbs);
ok('sorted by name', s.order.join(',') === 'a-wide.png,b-tall.png,c-square.png,d-small.png,e-wide.png,f-tall.png,g-square.png', s.order.join(','));

// 3 columns, 7 images -> 3x3, cell = longest edge = 800 -> 2400 x 2400
ok('3 columns gives 3 x 3', /3 × 3/.test(s.shape), s.shape);
ok('cell is the longest edge', /800px/.test(s.shape), s.shape);
ok('canvas 2400 x 2400', s.w === 2400 && s.h === 2400, `${s.w}x${s.h}`);
ok('two empty cells reported', /2 cells left empty/.test(s.shape), s.shape);

// the colours must land in the right cells, centred, aspect kept
const probe = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[3] === 0 ? 'clear' : `#${[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('')}`; };
  return {
    cell0centre: px(400, 400),    // a-wide, red
    cell0top:    px(400, 150),    // above the 800x200 band -> transparent padding
    cell1centre: px(1200, 400),   // b-tall, green
    cell1left:   px(900, 400),    // left of the 200-wide band -> transparent
    cell2centre: px(2000, 400),   // c-square, blue
    cell3centre: px(400, 1200),   // d-small, yellow
    cell6centre: px(400, 2000),   // g-square, orange
    cell7:       px(1200, 2000),  // empty
    cell8:       px(2000, 2000),  // empty
  };
});
ok('wide image centred, padded above', probe.cell0centre === '#ff0000' && probe.cell0top === 'clear', JSON.stringify(probe));
ok('tall image centred, padded left', probe.cell1centre === '#00ff00' && probe.cell1left === 'clear', JSON.stringify(probe));
ok('square image in cell 2', probe.cell2centre === '#0000ff', probe.cell2centre);
ok('small image in cell 3', probe.cell3centre === '#ffff00', probe.cell3centre);
ok('last image in cell 6', probe.cell6centre === '#ff8800', probe.cell6centre);
ok('empty cells transparent', probe.cell7 === 'clear' && probe.cell8 === 'clear', `${probe.cell7}/${probe.cell8}`);

// small picture must not be upscaled: d-small is 100x100 in an 800 cell
const dSmall = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  const solid = (x, y) => g.getImageData(x, y, 1, 1).data[3] > 0;
  // cell 3 is col 0 row 1: x 0..800, y 800..1600, centre 400,1200
  let left = 400; while (left > 0 && solid(left - 1, 1200)) left--;
  let right = 400; while (right < 800 && solid(right + 1, 1200)) right++;
  return right - left + 1;
});
ok('100px picture stays 100px in an 800px cell', Math.abs(dSmall - 100) <= 2, dSmall);

// rows mode
await page.selectOption('#axisSel', 'r');
await page.fill('#count', '2'); await page.locator('#count').dispatchEvent('input');
s = await read();
ok('2 rows of 7 gives 4 x 2', /4 × 2/.test(s.shape), s.shape);

// gap
await page.selectOption('#axisSel', 'c');
await page.fill('#count', '3'); await page.locator('#count').dispatchEvent('input');
await page.fill('#gap', '50'); await page.locator('#gap').dispatchEvent('input');
s = await read();
ok('gap widens the sheet', s.w === 2400 + 100, s.w);

// cover mode crops rather than pads
await page.fill('#gap', '0'); await page.locator('#gap').dispatchEvent('input');
await page.selectOption('#fitSel', 'cover');
await page.waitForTimeout(200);
const covered = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[3] === 0 ? 'clear' : 'solid'; };
  return { topLeft: px(10, 10), bottomRight: px(790, 790), nextCellEdge: px(810, 10) };
});
ok('cover fills the whole cell', covered.topLeft === 'solid' && covered.bottomRight === 'solid', JSON.stringify(covered));
ok('cover does not spill into the next cell', covered.nextCellEdge === 'solid', 'cell 1 should have its own image');
await page.selectOption('#fitSel', 'contain');

// set cell size
await page.selectOption('#cellMode', 'set');
await page.fill('#cell', '256'); await page.locator('#cell').dispatchEvent('input');
s = await read();
ok('set cell size honoured', s.w === 768 && /256px/.test(s.shape), `${s.w} ${s.shape}`);

// background fill
await page.check('#bgOn');
await page.fill('#bgColor', '#112233'); await page.locator('#bgColor').dispatchEvent('input');
const bg = await page.evaluate(() => { const d = document.getElementById('canvas').getContext('2d').getImageData(600, 600, 1, 1).data; return `${d[0]},${d[1]},${d[2]},${d[3]}`; });
ok('background fills empty cells', bg === '17,34,51,255', bg);
await page.uncheck('#bgOn');

// the canvas cap
await page.selectOption('#cellMode', 'auto');
await page.fill('#count', '1'); await page.locator('#count').dispatchEvent('input');
await page.evaluate(() => { document.getElementById('cellMode').value = 'set'; document.getElementById('cellMode').dispatchEvent(new Event('change')); });
await page.fill('#cell', '2000'); await page.locator('#cell').dispatchEvent('input');
s = await read();
ok('1 column of 7 at 2000px is capped', /brought down/.test(s.shape) || s.h <= 16384, s.shape);
ok('capped canvas stays within limits', s.w <= 16384 && s.h <= 16384 && s.w * s.h <= 268435456, `${s.w}x${s.h}`);

// drag reorder
await page.selectOption('#cellMode', 'auto');
await page.fill('#count', '3'); await page.locator('#count').dispatchEvent('input');
const before = (await read()).order;
await page.evaluate(() => {
  const thumbs = document.querySelectorAll('.thumb');
  const dt = new DataTransfer();
  thumbs[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  thumbs[3].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
  thumbs[3].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
});
await page.waitForTimeout(300);
const after = (await read()).order;
ok('drag moves a picture', after[3] === before[0] && after[0] === before[1], `${before.join(',')} -> ${after.join(',')}`);
ok('drag switches sort to as-arrived', await page.inputValue('#sortSel') === 'added', await page.inputValue('#sortSel'));

// remove one
await page.click('.thumb .drop');
await page.waitForTimeout(300);
s = await read();
ok('remove drops one', s.thumbs === 6, s.thumbs);
ok('6 pictures in 3 columns is 3 x 2', /3 × 2/.test(s.shape), s.shape);

// save
const got = await Promise.race([
  (async () => { const d = page.waitForEvent('download', { timeout: 20000 }); await page.click('#pngBtn'); return d; })(),
  new Promise(r => setTimeout(() => r(null), 20000)),
]);
ok('png saves', !!got, 'no download');
if (got) console.log('      filename:', got.suggestedFilename());

// clear
await page.click('#clearBtn');
s = await read();
ok('clear empties everything', s.thumbs === 0 && s.w === 16 && s.status === 'No pictures yet.', JSON.stringify(s));

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.filter(e => !/favicon/.test(e)).join(' | ') : 'no console errors');
await browser.close();
