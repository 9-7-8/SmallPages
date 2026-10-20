import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
const SCR = WORK + '';
const PDF_B64 = fs.readFileSync(SCR + '/sample.pdf').toString('base64');

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/anything-to-image.html');
await page.waitForTimeout(600);
ok('pdf.js loaded', await page.evaluate(() => typeof window.pdfjsLib), 'object');
ok('worker preloaded', await page.evaluate(() => typeof window.pdfjsWorker === 'object'), '');

const drop = async (b64, name, type) => page.evaluate(async ([b64, name, type]) => {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u8], name, { type }));
  const i = document.getElementById('fileInput');
  i.files = dt.files;
  i.dispatchEvent(new Event('change'));
}, [b64, name, type]);

await drop(PDF_B64, 'sample.pdf', 'application/pdf');
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  meta: document.getElementById('meta').textContent,
  pdfFieldShown: !document.getElementById('pdfField').hidden,
  pageFieldShown: !document.getElementById('pageField').hidden,
  allText: document.getElementById('allBtn').textContent,
  allShown: !document.getElementById('allBtn').hidden,
  options: [...document.querySelectorAll('#pageSel option')].map(o => o.textContent),
  sizes: (window.__pages || []).map(p => `${p.canvas.width}x${p.canvas.height}`),
}));
await page.evaluate(() => { window.__pages = pages; });
let s = await read();
ok('three pages', s.options.length === 3, JSON.stringify(s.options));
ok('pdf control shown', s.pdfFieldShown, '');
ok('page picker shown', s.pageFieldShown, '');
ok('save-all says zip', /Save all 3 as \.zip/.test(s.allText), s.allText);
ok('status names the pdf', /3 pages from sample\.pdf/.test(s.status), s.status);
ok('status reports the crop', /cropped to the ink/.test(s.status), s.status);
ok('status reports dpi', /144 dpi/.test(s.status), s.status);

// The ink boxes are known: page 1 rect 200x300pt at (100,200) from bottom-left
// of a 612x792 page. At scale 2 that is 400x600 px, cropped exactly.
ok('page 1 cropped to its rect', s.sizes[0] === '400x600', s.sizes[0]);
ok('page 2 cropped to its rect', s.sizes[1] === '1000x200', s.sizes[1]);
ok('page 3 cropped to its tiny mark', s.sizes[2] === '12x12', s.sizes[2]);

// crop off -> full pages
await page.uncheck('#pdfTrim');
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__pages = pages; });
s = await read();
ok('uncropped pages are the full sheet', s.sizes.every(z => z === '1224x1584'), JSON.stringify(s.sizes));
ok('status says full pages', /full pages/.test(s.status), s.status);

// scale change
await page.selectOption('#pdfScale', '1');
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__pages = pages; });
s = await read();
ok('72 dpi halves the sheet', s.sizes.every(z => z === '612x792'), JSON.stringify(s.sizes));
await page.check('#pdfTrim');
await page.selectOption('#pdfScale', '2');
await page.waitForTimeout(2200);

// the zip
const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await page.click('#allBtn');
const got = await dl;
ok('zip downloads', !!got, 'no download fired');
if (got) {
  const p = SCR + '/out.zip';
  await got.saveAs(p);
  ok('zip is named after the document', got.suggestedFilename() === 'sample.zip', got.suggestedFilename());
  console.log('      saved', fs.statSync(p).size, 'bytes');
}
s = await read();
ok('status reports the zip', /Saved sample\.zip — 3 images/.test(s.status), s.status);

// a plain image must still behave, and must hide the pdf control
const PNG = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 120; c.height = 90;
  const x = c.getContext('2d'); x.fillStyle = '#2244aa'; x.fillRect(0,0,120,90);
  const b = await new Promise(r => c.toBlob(r));
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (const v of buf) s += String.fromCharCode(v);
  return btoa(s);
});
await drop(PNG, 'plain.png', 'image/png');
await page.waitForTimeout(1200);
s = await read();
ok('image hides the pdf control', !s.pdfFieldShown, '');
ok('image hides save-all', !s.allShown, '');
ok('image still renders', /120 × 90/.test(s.meta), s.meta);

await page.screenshot({ path: SCR + '/ati-image.png', fullPage: true });
await drop(PDF_B64, 'sample.pdf', 'application/pdf');
await page.waitForTimeout(2500);
await page.screenshot({ path: SCR + '/ati-pdf.png', fullPage: true });

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
