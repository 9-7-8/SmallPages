import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1300, height: 1500 }, acceptDownloads: true });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const offsite = [];
page.on('request', r => { const u = r.url(); if (!/^(http:\/\/127\.0\.0\.1:8099|blob:|data:)/.test(u)) offsite.push(u.slice(0, 80)); });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/images-to-pdf.html');
await page.waitForTimeout(400);

// Three test pages of different shapes, written as real image files.
const SHAPES = [
  ['wide.png',   1600, 500,  'Harbour notes', ['The tide came in at four.', 'Nothing else happened.']],
  ['tall.jpg',   700, 1500,  'Receipt', ['Coffee 3.40', 'Pastry 2.80', 'Total 6.20']],
  ['square.png', 900, 900,   'Second page', ['A square photograph of a page.']],
];
for (const [name, w, h, title, body] of SHAPES) {
  const b64 = await page.evaluate(async ([w, h, title, body, type]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#111';
    x.font = `bold ${Math.round(h / 12)}px Georgia`;
    x.fillText(title, 40, Math.round(h / 7));
    x.font = `${Math.round(h / 22)}px Georgia`;
    body.forEach((line, i) => x.fillText(line, 40, Math.round(h / 4) + i * Math.round(h / 14)));
    const blob = await new Promise(r => c.toBlob(r, type, 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (const v of buf) s += String.fromCharCode(v);
    return btoa(s);
  }, [w, h, title, body, name.endsWith('.jpg') ? 'image/jpeg' : 'image/png']);
  fs.writeFileSync(`${SCR}/i2p-${name}`, Buffer.from(b64, 'base64'));
}

const t0 = Date.now();
await page.setInputFiles('#fileInput', SHAPES.map(s => `${SCR}/i2p-${s[0]}`));
await page.waitForFunction(() => /words read|could not/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
console.log('      read 3 pages in', Date.now() - t0, 'ms');
console.log('     ', await page.textContent('#status'));

const s1 = await page.evaluate(() => ({
  sheets: document.querySelectorAll('.sheet').length,
  states: [...document.querySelectorAll('.sheet .state')].map(e => e.textContent),
  raw: document.getElementById('rawText').value,
  title: document.getElementById('pageTitle').textContent,
}));
ok('three pages listed', s1.sheets === 3, s1.sheets);
ok('all three read', s1.states.every(s => s === 'read'), JSON.stringify(s1.states));
ok('text came out of page 1', /Harbour/i.test(s1.raw), JSON.stringify(s1.raw));
console.log('      page 1 text:', JSON.stringify(s1.raw));

const grab = async (sel, name) => {
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.click(sel);
  const got = await dl;
  const p = `${SCR}/${name}`;
  await got.saveAs(p);
  return p;
};

const pdfPath = await grab('#pdfBtn', 'out.pdf');
ok('pdf saved', fs.statSync(pdfPath).size > 1000, fs.statSync(pdfPath).size);
console.log('      pdf', (fs.statSync(pdfPath).size / 1024).toFixed(1), 'KB');

const md = await grab('#mdBtn', 'out.md');
const txt = await grab('#txtBtn', 'out.txt');
console.log('      md', fs.statSync(md).size, 'bytes, txt', fs.statSync(txt).size, 'bytes');
console.log('--- markdown ---'); console.log(fs.readFileSync(md, 'utf8').trim().slice(0, 400));

ok('the reader makes no offsite requests', offsite.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)).length === 0, offsite.join(' | '));
console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.screenshot({ path: SCR + '/shot-i2p.png', fullPage: true });
await browser.close();
