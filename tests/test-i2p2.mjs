import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1300, height: 1400 }, acceptDownloads: true });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
const text = (f, args=[]) => execFileSync('pdftotext', [...args, f, '-']).toString();

await page.goto('http://127.0.0.1:8099/images-to-pdf.html');
const files = ['i2p-wide.png', 'i2p-tall.jpg', 'i2p-square.png'].map(f => `${SCR}/${f}`);
await page.setInputFiles('#fileInput', files);
await page.waitForFunction(() => /words read|could not/.test(document.getElementById('status').textContent), null, { timeout: 180000 });

const grab = async (sel, name) => {
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.click(sel);
  await (await dl).saveAs(`${SCR}/${name}`);
  return `${SCR}/${name}`;
};

// --- markdown headings ---
const md = fs.readFileSync(await grab('#mdBtn', 'h.md'), 'utf8');
ok('markdown marks the big line as a heading', /^### Harbour notes$/m.test(md), md.slice(0, 160));
ok('markdown keeps the body as a paragraph', /The tide came in at four\./.test(md), '');

// --- editing a page changes the pdf text ---
await page.fill('#rawText', 'Corrected harbour heading\nThe tide came in at five, not four.\nA third line that was never there.');
await page.waitForTimeout(200);
const edited = text(await grab('#pdfBtn', 'edited.pdf'), ['-f', '1', '-l', '1']);
ok('edit reaches the pdf text layer', /came in at five/.test(edited), JSON.stringify(edited.trim()));
ok('an extra line past the reading still lands', /never there/.test(edited), JSON.stringify(edited.trim()));
ok('the old text is gone', !/at four/.test(edited), JSON.stringify(edited.trim()));

// --- revert ---
await page.click('#revertBtn');
await page.waitForTimeout(200);
ok('put it back restores the reading', /at four/.test(await page.inputValue('#rawText')), await page.inputValue('#rawText'));

// --- reorder by drag ---
const before = await page.evaluate(() => pages.map(p => p.name));
await page.evaluate(() => {
  const sheets = document.querySelectorAll('.sheet');
  const dt = new DataTransfer();
  sheets[2].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  sheets[0].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
  sheets[0].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
});
await page.waitForTimeout(300);
const after = await page.evaluate(() => pages.map(p => p.name));
ok('drag moves a page to the front', after[0] === before[2], `${before.join(',')} -> ${after.join(',')}`);
const reordered = await grab('#pdfBtn', 'reordered.pdf');
const p1 = execFileSync('pdftotext', ['-f','1','-l','1', reordered, '-']).toString();
ok('the pdf follows the new order', /Second page/.test(p1), JSON.stringify(p1.trim()));

// --- margin and paper ---
await page.fill('#margin', '0.5');
await page.selectOption('#paperSel', '595x842');
await page.waitForTimeout(300);
const a4 = await grab('#pdfBtn', 'a4.pdf');
const info = execFileSync('pdfinfo', [a4]).toString();
ok('A4 page size honoured', /595 x 842/.test(info), info.split('\n').find(l => /Page size/.test(l)));

// --- lossless ---
await page.selectOption('#paperSel', '612x792');
await page.fill('#margin', '1');
await page.selectOption('#quality', 'lossless');
await page.waitForTimeout(200);
const loss = await grab('#pdfBtn', 'lossless.pdf');
const listing = execFileSync('pdfimages', ['-list', loss]).toString();
ok('lossless embeds deflated images, not jpeg', /image/.test(listing) && !/jpeg/.test(listing), listing.split('\n').slice(2,4).join(' / '));
ok('lossless still searchable', /Second page|Harbour/.test(text(loss)), '');
console.log('      jpeg', fs.statSync(`${SCR}/reordered.pdf`).size, 'bytes vs lossless', fs.statSync(loss).size, 'bytes');

// --- remove a page ---
await page.click('.sheet .drop');
await page.waitForTimeout(300);
ok('removing a page drops it', (await page.evaluate(() => pages.length)) === 2, '');

await browser.close();
