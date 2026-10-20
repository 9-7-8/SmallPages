import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
page.on('pageerror', e => bad.push('pageerror: ' + e.message));
await page.goto('http://127.0.0.1:8099/make-cassette-image.html');
await page.waitForTimeout(3000);

const faces = await page.evaluate(() => [...document.querySelectorAll('#fontSel option')].map(o => o.value));
console.log('faces offered:', faces.length);
console.log('League Gothic present:', faces.includes('League Gothic'));

// every bundled face must actually be loaded, not silently falling back
const loaded = await page.evaluate(async (names) => {
  await document.fonts.ready;
  const miss = [];
  for (const n of names) {
    try { await document.fonts.load(`40px "${n}"`); } catch {}
    if (!document.fonts.check(`40px "${n}"`)) miss.push(n);
  }
  return miss;
}, faces.filter(f => !['Arial','Impact','Courier New','Georgia','Verdana'].includes(f)));
console.log(loaded.length ? 'FAIL unloaded faces: ' + loaded.join(', ') : 'PASS all bundled faces load');
console.log(bad.length ? 'FAIL requests/errors: ' + bad.join(' | ') : 'PASS no failed requests');

await page.selectOption('#fontSel', 'Cubby Brush');
await page.waitForTimeout(600);
await page.locator('#canvas').screenshot({ path: SCR + '/cass-faces.png' });
await browser.close();
