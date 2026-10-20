import { chromium, CHROMIUM_BIN, WORK, REPO } from './lib/env.mjs';
import fs from 'node:fs';
const SCR = WORK + '';
const PAGES_IN_FIXTURE = 4;
const B64 = fs.readFileSync(SCR + '/text.pdf').toString('base64');
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

for (const [label, url] of [['file://', 'file://' + REPO + '/anything-to-image.html'],
                            ['http://', 'http://127.0.0.1:8099/anything-to-image.html']]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 }, acceptDownloads: true });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(700);
  await page.evaluate(async (b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], 'text.pdf', { type: 'application/pdf' }));
    const i = document.getElementById('fileInput'); i.files = dt.files; i.dispatchEvent(new Event('change'));
  }, B64);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    sizes: pages.map(p => `${p.canvas.width}x${p.canvas.height}`),
  }));
  // text.pdf is the four-page fixture beside this file; the count is
  // asserted so a page that silently renders only the first one fails.
  ok(`${label} renders a text PDF`, r.sizes.length === PAGES_IN_FIXTURE && !/didn't load|Couldn't/.test(r.status), r.status);
  console.log(`      ${label} pages:`, r.sizes.join(' '), '|', r.status.trim());

  // the zip still comes out under file://
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.click('#allBtn');
  const got = await dl;
  ok(`${label} zip saves`, !!got, 'no download');
  if (got && label === 'file://') { await got.saveAs(SCR + '/file-out.zip'); }
  if (errs.length) console.log('      errors:', errs.join(' | '));
  if (label === 'file://') await page.locator('#stage canvas').screenshot({ path: SCR + '/ati-textpdf.png' });
  await page.close();
}
await browser.close();
