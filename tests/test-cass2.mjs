import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
const four04 = [];
page.on('response', r => { if (r.status() === 404) four04.push(r.url()); });
await page.goto('http://127.0.0.1:8099/make-cassette-image.html');
await page.waitForTimeout(2500);

// a photographic-looking test picture, wider than the window so the crop bites
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 2000; c.height = 1200;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 2000, 1200);
  g.addColorStop(0, '#2b4a7a'); g.addColorStop(0.5, '#c86a3c'); g.addColorStop(1, '#1d1d28');
  x.fillStyle = g; x.fillRect(0, 0, 2000, 1200);
  x.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 300; i++) x.fillRect(Math.random()*2000, Math.random()*1200, 3, 3);
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 6;
  for (let i = 0; i < 2000; i += 120) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 300, 1200); x.stroke(); }
  return new Promise(res => c.toBlob(b => {
    const dt = new DataTransfer(); dt.items.add(new File([b], 'Summer 1994.png', { type: 'image/png' }));
    document.getElementById('fileInput').files = dt.files;
    document.getElementById('fileInput').dispatchEvent(new Event('change'));
    setTimeout(res, 700);
  }));
});
await page.waitForTimeout(900);
await page.locator('#canvas').screenshot({ path: SCR + '/cass-photo.png' });

// a handwriting face, no outline
await page.selectOption('#fontSel', 'Kind Handwriting');
await page.fill('#outlineW', '0');
await page.locator('#outlineW').dispatchEvent('input');
await page.waitForTimeout(500);
await page.locator('#canvas').screenshot({ path: SCR + '/cass-hand.png' });

// zoom and nudge
await page.fill('#imgZoom', '1.8'); await page.locator('#imgZoom').dispatchEvent('input');
await page.fill('#imgY', '-40'); await page.locator('#imgY').dispatchEvent('input');
await page.waitForTimeout(400);
const bleed = await page.evaluate(() => {
  const g = document.getElementById('canvas').getContext('2d');
  const at = (x,y) => { const d = g.getImageData(x,y,1,1).data; return `${d[0]},${d[1]},${d[2]}`; };
  return { above: at(500, 380), below: at(500, 662), corner: at(5,5) };
});
console.log('after zoom+nudge, outside the hole:', JSON.stringify(bleed));
console.log('still backing?', bleed.above === '3,3,3' && bleed.corner === '3,3,3' ? 'PASS' : 'FAIL');

// backing colour change
await page.fill('#backing', '#ffffff'); await page.locator('#backing').dispatchEvent('input');
await page.waitForTimeout(300);
const white = await page.evaluate(() => { const d = document.getElementById('canvas').getContext('2d').getImageData(5,5,1,1).data; return `${d[0]},${d[1]},${d[2]}`; });
console.log('backing swatch works:', white === '255,255,255' ? 'PASS' : 'FAIL ' + white);

console.log('404s:', four04.length ? four04.join(', ') : 'none');
await browser.close();
