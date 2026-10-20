import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const SCR = WORK + '';
const SRC = SCR + '/pdflib/src.pdf';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, acceptDownloads: true });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
const info = f => execFileSync('pdfinfo', [f]).toString();
const text = f => execFileSync('pdftotext', ['-layout', f, '-']).toString();

await page.goto('http://127.0.0.1:8099/tile-pdf-pages.html');
await page.waitForTimeout(400);
await page.setInputFiles('#fileInput', [SRC]);
await page.waitForFunction(() => /pages in|Couldn/.test(document.getElementById('status').textContent), null, { timeout: 30000 });

const s1 = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  tally: document.getElementById('tally').textContent,
  which: document.getElementById('which').textContent,
  canvas: [document.getElementById('preview').width, document.getElementById('preview').height],
}));
ok('6 pages read in', /6 pages in/.test(s1.status), s1.status);
ok('all six placed on one A1 sheet', /6 of 6 pages on 1 sheet/.test(s1.tally), s1.tally);
ok('preview rendered', s1.canvas[0] > 100 && s1.canvas[1] > 100, JSON.stringify(s1.canvas));
ok('preview is portrait A1 shaped', Math.abs((s1.canvas[1]/s1.canvas[0]) - (2384/1684)) < 0.02, JSON.stringify(s1.canvas));

const grab = async (name) => {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#saveBtn');
  await (await dl).saveAs(`${SCR}/${name}`);
  return `${SCR}/${name}`;
};

// --- packed A1, the faithful default ---
let out = await grab('tile-a1.pdf');
ok('output is A1', /1684 x 2384/.test(info(out)), info(out).split('\n').find(l=>/Page size/.test(l)));
ok('output is one sheet', /Pages:\s+1/.test(info(out)), '');
const t = text(out);
ok('every page\'s text survived', ['PAGE ONE','PAGE TWO','PAGE THREE','PAGE FOUR','WIDE FIVE','SMALL SIX'].every(w => t.includes(w)), JSON.stringify(t.slice(0,120)));
ok('nothing was rasterised', !/image/.test(execFileSync('pdfimages',['-list',out]).toString().split('\n').slice(2).join('')), '');

// --- reading order: page one must be at the TOP, which is the old bug ---
const positions = await page.evaluate(async () => {
  const doc = await pdfjsLib.getDocument({ data: built.bytes.slice() }).promise;
  const p = await doc.getPage(1);
  const c = await p.getTextContent();
  const out = {};
  for (const item of c.items) {
    const s = item.str.trim();
    if (s) out[s] = Math.round(item.transform[5]);   // y, counting up from the bottom
  }
  doc.destroy();
  return out;
});
console.log('      text y positions (higher = further up the sheet):', JSON.stringify(positions));
ok('page one sits above page four', positions['PAGE ONE'] > positions['PAGE FOUR'], JSON.stringify(positions));
ok('page one sits at the top of the sheet', positions['PAGE ONE'] > 2384 * 0.85, positions['PAGE ONE']);

// --- grid mode ---
await page.selectOption('#modeSel', 'grid');
await page.fill('#cols', '2'); await page.fill('#rows', '2');
await page.waitForTimeout(700);
const g = await page.evaluate(() => document.getElementById('tally').textContent);
ok('2x2 grid puts 6 pages on 2 sheets', /6 of 6 pages on 2 sheets/.test(g), g);
out = await grab('tile-grid.pdf');
ok('grid output has 2 sheets', /Pages:\s+2/.test(info(out)), '');
ok('grid keeps the text', text(out).includes('SMALL SIX'), '');

// --- page range ---
await page.selectOption('#modeSel', 'pack');
await page.fill('#rangeIn', '2-3, 5');
await page.waitForTimeout(700);
const r = await page.evaluate(() => document.getElementById('tally').textContent);
ok('a range narrows the set', /3 of 3 pages/.test(r), r);
out = await grab('tile-range.pdf');
const rt = text(out);
ok('range kept pages 2, 3 and 5', rt.includes('PAGE TWO') && rt.includes('PAGE THREE') && rt.includes('WIDE FIVE'), '');
ok('range dropped the rest', !rt.includes('PAGE ONE') && !rt.includes('SMALL SIX'), JSON.stringify(rt.slice(0,80)));
await page.fill('#rangeIn', '');

// --- a sheet smaller than the pages ---
await page.selectOption('#sheetSel', '595x842');   // A4, smaller than Letter pages? no — bigger
await page.waitForTimeout(700);
const a4 = await page.evaluate(() => document.getElementById('tally').textContent);
console.log('      A4 packed:', a4);
await page.selectOption('#sheetSel', 'custom');
await page.fill('#customW', '100'); await page.fill('#customH', '140');  // 100x140mm, smaller than a page
await page.waitForTimeout(800);
const tiny = await page.evaluate(() => document.getElementById('tally').textContent);
ok('oversized pages are shrunk, and counted', /shrunk to fit/.test(tiny), tiny);
await page.uncheck('#shrinkBig');
await page.waitForTimeout(800);
const left = await page.evaluate(() => document.getElementById('tally').textContent);
ok('with shrinking off they are left out', /too big, left out/.test(left), left);
await page.check('#shrinkBig');

// --- landscape and margins ---
await page.selectOption('#sheetSel', '1684x2384');
await page.selectOption('#turned', 'wide');
await page.waitForTimeout(700);
out = await grab('tile-wide.pdf');
ok('landscape swaps the sheet', /2384 x 1684/.test(info(out)), info(out).split('\n').find(l=>/Page size/.test(l)));

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.setViewportSize({ width: 390, height: 1500 });
await page.waitForTimeout(400);
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok('no horizontal scroll at 390px', !over, '');
await browser.close();
