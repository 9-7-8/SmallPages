import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/make-cassette-image.html');
await page.waitForFunction(() => document.getElementById('status').textContent !== '', null, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(2500);

// art loaded through the bundle
const art = await page.evaluate(() => ({ bundle: !!window.CASSETTE_ART, status: document.getElementById('status').textContent }));
ok('inlined bundle present', art.bundle, String(art.bundle));
ok('no fallback warning', !/loose PNGs/.test(art.status), art.status);

// faces
const faces = await page.evaluate(() => [...document.querySelectorAll('#fontSel option')].map(o => o.value));
ok('31 bundled + 5 system faces', faces.length === 36, faces.length);
ok('League Gothic offered', faces.includes('League Gothic'), '');

// geometry: the window must sit where the hole in the shell is
const geo = await page.evaluate(() => {
  const SRC = 3135, SIZE = 1000, k = SIZE / SRC;
  return { x: 889*k, y: 1222*k, w: 1358*k, h: 825*k };
});
console.log('window at', JSON.stringify(Object.fromEntries(Object.entries(geo).map(([a,b])=>[a,+b.toFixed(1)]))));

// Paint a flat red picture and check the red actually lands inside the hole and
// nowhere else — that is the 67px bug, measured rather than eyeballed.
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1358; c.height = 825;
  const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0,0,1358,825);
  return new Promise(res => c.toBlob(b => {
    const f = new File([b], 'Red Test.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.getElementById('fileInput').files = dt.files;
    document.getElementById('fileInput').dispatchEvent(new Event('change'));
    setTimeout(res, 600);
  }));
});
await page.waitForTimeout(900);

const probe = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return `${d[0]},${d[1]},${d[2]}`; };
  const red = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] > 180 && d[1] < 80 && d[2] < 80; };
  // window in canvas space: x 283.6..717.8, y 389.8..653.0
  return {
    insideTop:    red(500, 395),
    insideBottom: red(500, 648),
    insideLeft:   red(288, 520),
    insideRight:  red(713, 520),
    aboveHole:    red(500, 380),
    belowHole:    red(500, 662),
    leftOfHole:   red(275, 520),
    rightOfHole:  red(726, 520),
    corner:       at(5, 5),
  };
});
ok('picture reaches the top of the hole', probe.insideTop, '');
ok('picture reaches the bottom of the hole', probe.insideBottom, 'the 67px bug');
ok('picture reaches the left of the hole', probe.insideLeft, '');
ok('picture reaches the right of the hole', probe.insideRight, '');
ok('no bleed above the hole', !probe.aboveHole, '');
ok('no bleed below the hole', !probe.belowHole, '');
ok('no bleed left of the hole', !probe.leftOfHole, '');
ok('no bleed right of the hole', !probe.rightOfHole, '');
ok('backing fills the corner', probe.corner === '3,3,3', probe.corner);

// title came from the file name
ok('title taken from file name', await page.inputValue('#titleText') === 'Red Test', await page.inputValue('#titleText'));

// long titles shrink rather than overrun
const fit = await page.evaluate(async () => {
  const out = [];
  for (const t of ['A', 'Home Movies', 'The Very Long Summer Of Nineteen Eighty Four And After']) {
    document.getElementById('titleText').value = t;
    document.getElementById('titleText').dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 60));
    const c = document.getElementById('canvas').getContext('2d');
    const size = parseFloat(c.font);
    // ink bounds of what was drawn
    const m = c.measureText(t);
    out.push({ t: t.slice(0, 20), size, w: +(m.actualBoundingBoxLeft + m.actualBoundingBoxRight).toFixed(1) });
  }
  return out;
});
console.log('fitting:', JSON.stringify(fit));
ok('long title shrinks below short title', fit[2].size < fit[0].size, JSON.stringify(fit.map(f=>f.size)));
ok('every title fits the 730px label box', fit.every(f => f.w <= 730), JSON.stringify(fit.map(f=>f.w)));

// saving works (the taint test)
const dl = await page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
const clicked = page.click('#pngBtn');
const got = await Promise.race([page.waitForEvent('download', { timeout: 15000 }), new Promise(r => setTimeout(() => r(null), 15000))]);
await clicked;
ok('png saves (canvas not tainted)', !!got, 'toBlob threw or never fired');
if (got) {
  const p = SCR + '/cass-out.png';
  await got.saveAs(p);
  console.log('      saved as', got.suggestedFilename());
}

await page.screenshot({ path: SCR + '/cass-wide.png', fullPage: true });
const shot = await page.locator('#canvas').screenshot({ path: SCR + '/cass-canvas.png' });

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
