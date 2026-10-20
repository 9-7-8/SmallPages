import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
const SCR = WORK + '';
const B64 = fs.readFileSync(SCR + '/book.xlsx').toString('base64');
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ acceptDownloads: true });
const errs = []; page.on('pageerror', e => errs.push(e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto('http://127.0.0.1:8099/anything-to-image.html');
await page.waitForTimeout(600);
await page.evaluate(async (b64) => {
  const bin = atob(b64); const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([u8], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const i = document.getElementById('fileInput'); i.files = dt.files; i.dispatchEvent(new Event('change'));
}, B64);
await page.waitForTimeout(2500);
const r = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  tabs: [...document.querySelectorAll('#pageSel option')].map(o => o.textContent),
  pdfShown: !document.getElementById('pdfField').hidden,
  all: document.getElementById('allBtn').textContent,
}));
ok('two tabs rendered', r.tabs.length === 2, JSON.stringify(r.tabs) + ' | ' + r.status);
ok('tab names kept', /Alpha/.test(r.tabs[0]) && /Beta/.test(r.tabs[1]), JSON.stringify(r.tabs));
ok('pdf control stays hidden for a workbook', !r.pdfShown, '');
ok('save-all offers a zip', /Save all 2 as \.zip/.test(r.all), r.all);
const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await page.click('#allBtn');
const got = await dl;
ok('workbook zip saves', !!got, 'none');
if (got) { ok('zip named after the workbook', got.suggestedFilename() === 'book.zip', got.suggestedFilename()); await got.saveAs(SCR + '/book-out.zip'); }
if (errs.length) console.log('errors:', errs.join(' | '));
await browser.close();
