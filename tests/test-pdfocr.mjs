/* PDF OCR. The claim worth checking is the one you cannot see by looking at
   the document: that the words are in it, and in the right place. So the
   output is reloaded through pdf.js and its text read back out, line by line,
   against where the words were drawn on the page in the first place — a text
   layer that extracts cleanly but sits an inch from the print selects a
   rectangle somewhere near the paragraph rather than the paragraph.

   The scans are built here rather than committed: a picture of a page is a
   hundred kilobytes and nobody needs to keep one. */
import { chromium, CHROMIUM_BIN } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/pdf-ocr.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) pass++; else fail++;
  console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
};

await page.goto(URL);
await page.waitForTimeout(200);

/* A page of paper, photographed: the words are pixels and there is no text in
   the file at all. `rot` turns the page the way a scanner feeding a sheet in
   sideways does — the picture goes in turned the other way, so that the
   document's own /Rotate stands it back up. */
const buildScan = (pages) => page.evaluate(async (wanted) => {
  const { PDFDocument, degrees } = PDFLib;
  const doc = await PDFDocument.create();
  for (const { lines, rot } of wanted) {
    const sideways = rot === 90 || rot === 270;
    const c = document.createElement('canvas');
    c.width = sideways ? 1754 : 1240;
    c.height = sideways ? 1240 : 1754;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.save();
    g.translate(c.width / 2, c.height / 2);
    g.rotate(-rot * Math.PI / 180);
    g.translate(-620, -877);                       // the portrait page's own frame
    g.fillStyle = '#111111';
    lines.forEach((line, i) => {
      g.font = `${i === 0 ? 'bold 64' : '44'}px Georgia, serif`;
      g.fillText(line, 120, 220 + i * 130);
    });
    g.restore();
    const img = await doc.embedJpg(c.toDataURL('image/jpeg', 0.75));
    const sheet = doc.addPage(sideways ? [842, 595] : [595, 842]);
    sheet.drawImage(img, { x: 0, y: 0, width: sideways ? 842 : 595, height: sideways ? 595 : 842 });
    if (rot) sheet.setRotation(degrees(rot));
  }
  return Array.from(await doc.save());
}, pages);

// A page out of a word processor: real text, no picture of anything.
const buildTyped = (count) => page.evaluate(async (many) => {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= many; n++) {
    const sheet = doc.addPage([595, 842]);
    sheet.drawText(`This page was typed, not scanned. It is page ${n}.`,
      { x: 60, y: 700, size: 16, font });
  }
  return Array.from(await doc.save());
}, count);

const give = (bytes, name) => page.setInputFiles('#fileInput',
  { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });

const readIt = async () => {
  await page.click('#readBtn');
  await page.waitForFunction(() => !document.getElementById('readBtn').disabled,
    null, { timeout: 300000 });
  await page.waitForTimeout(200);
};

/* Everything the finished document says, and where it says it, in the
   coordinates of the page as it is displayed. */
const textBack = (bytes) => page.evaluate(async (arr) => {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const sheet = await doc.getPage(n);
    const view = sheet.getViewport({ scale: 1 });
    const content = await sheet.getTextContent();
    out.push({
      rotate: sheet.rotate,
      width: Math.round(view.width),
      height: Math.round(view.height),
      text: content.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim(),
      lines: content.items.filter(i => i.str.trim()).map(i => {
        const m = pdfjsLib.Util.transform(view.transform, i.transform);
        return { str: i.str, x: Math.round(m[4]), y: Math.round(m[5]) };
      }),
    });
  }
  return out;
}, Array.from(bytes));

const saved = async () => {
  const wait = page.waitForEvent('download');
  await page.click('#savePdf');
  const file = await wait;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const bit of stream) chunks.push(bit);
  return { name: file.suggestedFilename(), bytes: Array.from(Buffer.concat(chunks)) };
};

/* ----------------------------------------------------------- a plain scan -- */

const PAGES = [
  ['THE QUARTERLY REPORT', 'Section one, page one of three.',
   'Revenue rose by eleven percent.', 'The warehouse in Bristol closed.'],
  ['CHAPTER TWO', 'Second page of the same document.',
   'Every figure in this table was invented.', 'Nothing here is a real company.'],
  ['APPENDIX', 'Third and last page.',
   'Printed on the fourteenth of August.', 'End of the report.'],
];
const scan = await buildScan(PAGES.map(lines => ({ lines, rot: 0 })));
await give(scan, 'quarterly.pdf');
await page.waitForTimeout(800);

ok('it says how long the document is',
  /3 pages/.test(await page.locator('#meta').textContent()), await page.locator('#meta').textContent());
ok('and gives every page a cell of its own',
  await page.locator('#map button').count() === 3, await page.locator('#map button').count());

await readIt();
const got = await page.evaluate(() => pages.map(p => ({ state: p.state, text: p.text, lines: p.lines.length })));
ok('every page is read', got.every(p => p.state === 'done'), JSON.stringify(got.map(p => p.state)));
ok('and the words come off the paper',
  got.every((p, i) => p.text.includes(PAGES[i][0]) && p.text.includes(PAGES[i][3].slice(0, 18))),
  JSON.stringify(got.map(p => p.text.slice(0, 40))));
ok('with a box for each line it read',
  got.every(p => p.lines >= 4), JSON.stringify(got.map(p => p.lines)));

/* The point of the whole page: the document comes back the same document,
   with the words in it. */
const out = await saved();
ok('the file is named after the one that went in', out.name === 'quarterly-searchable.pdf', out.name);
const back = await textBack(out.bytes);
ok('the finished document has the same pages, the same size',
  back.length === 3 && back.every(p => p.width === 595 && p.height === 842),
  JSON.stringify(back.map(p => [p.width, p.height])));
ok('and every one of them can be searched',
  back.every((p, i) => p.text.includes(PAGES[i][0])),
  JSON.stringify(back.map(p => p.text.slice(0, 40))));

/* Where the text sits is what makes selecting a paragraph select the
   paragraph. The heading was drawn at 120, 220 on a 1240 by 1754 picture of
   an A4 page, which is 57.6 points across and 105.6 points down a 595 by 842
   page — and the line's box sits a little under its baseline. */
const heading = back[0].lines[0];
ok('the text sits where the words are',
  Math.abs(heading.x - 58) <= 8 && Math.abs(heading.y - 108) <= 14,
  `${heading.str} at ${heading.x}, ${heading.y}`);

/* --------------------------------------------------------- a turned page -- */

const turned = await buildScan([90, 180, 270].map((rot, i) => ({ lines: PAGES[i], rot })));
await give(turned, 'turned.pdf');
await page.waitForTimeout(700);
await readIt();
const turnedText = await page.evaluate(() => pages.map(p => p.text));
ok('a page the scanner turned is still read',
  turnedText.every((t, i) => t.includes(PAGES[i][0])),
  JSON.stringify(turnedText.map(t => t.slice(0, 30))));

const turnedBack = await textBack((await saved()).bytes);
ok('and the document keeps the turn it had',
  turnedBack.map(p => p.rotate).join(',') === '90,180,270',
  JSON.stringify(turnedBack.map(p => p.rotate)));
ok('with the displayed page the right way up',
  turnedBack.every(p => p.width === 595 && p.height === 842),
  JSON.stringify(turnedBack.map(p => [p.width, p.height])));
const turnedHeads = turnedBack.map(p => p.lines[0]);
ok('and the text on it in the same place it would be unturned',
  turnedHeads.every(h => Math.abs(h.x - 58) <= 8 && Math.abs(h.y - 108) <= 14),
  JSON.stringify(turnedHeads));

/* ------------------------------------------------- pages that are already text -- */

const typed = await buildTyped(4);
await give(typed, 'typed.pdf');
await page.waitForTimeout(700);
await readIt();
const typedStates = await page.evaluate(() => pages.map(p => ({ state: p.state, text: p.text })));
ok('a page that already has text is left alone',
  typedStates.every(p => p.state === 'had'), JSON.stringify(typedStates.map(p => p.state)));
ok('and its own text is what comes out',
  typedStates[2].text.includes('It is page 3.'), JSON.stringify(typedStates[2].text));
const typedOut = await saved();
ok('nothing is written into it',
  /text added to 0 pages/.test(await page.locator('#outSay').textContent()),
  await page.locator('#outSay').textContent());
const typedBack = await textBack(typedOut.bytes);
ok('so the text in it is still only its own',
  typedBack.every(p => p.lines.length === 1), JSON.stringify(typedBack.map(p => p.lines.length)));

// Asked not to skip them, it reads them like anything else.
await page.uncheck('#skipIn');
await give(typed, 'typed.pdf');
await page.waitForTimeout(700);
await readIt();
ok('unless you tell it not to skip them',
  await page.evaluate(() => pages.every(p => p.state === 'done')),
  JSON.stringify(await page.evaluate(() => pages.map(p => p.state))));
await page.check('#skipIn');

/* ----------------------------------------------------------- a long one -- */

/* A hundred and forty pages, read a page at a time. They are typed rather
   than scanned so the suite finishes this century; what is being checked is
   that the page walks a long document at all, keeps the range box honest
   over it, and can be stopped and picked up again. */
const long = await buildTyped(140);
await give(long, 'long.pdf');
await page.waitForTimeout(1200);
ok('a hundred and forty pages open',
  /140 pages/.test(await page.locator('#meta').textContent()), await page.locator('#meta').textContent());
ok('and every one of them gets a cell',
  await page.locator('#map button').count() === 140, await page.locator('#map button').count());

await page.fill('#rangeIn', '3-5, 11, 130-');
await readIt();
const ranged = await page.evaluate(() => ({
  done: pages.filter(p => p.state !== 'waiting').map(p => p.no),
  waiting: pages.filter(p => p.state === 'waiting').length,
}));
ok('a range reads that range and nothing else',
  JSON.stringify(ranged.done) === JSON.stringify([3, 4, 5, 11, ...Array.from({ length: 11 }, (_, i) => 130 + i)]),
  JSON.stringify(ranged.done));
ok('and leaves the rest waiting', ranged.waiting === 140 - 15, ranged.waiting);

await page.fill('#rangeIn', '');
await readIt();
ok('a second pass picks up the ones still waiting',
  await page.evaluate(() => pages.every(p => p.state !== 'waiting')),
  await page.evaluate(() => pages.filter(p => p.state === 'waiting').length + ' left waiting'));
ok('and the figures count the whole document',
  (await page.locator('#figures').textContent()).includes('pages 140'),
  await page.locator('#figures').textContent());

/* ------------------------------------------------------- what it refuses -- */

await page.setInputFiles('#fileInput',
  { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a pdf') });
await page.waitForTimeout(300);
ok('something that is not a PDF is refused, and says why',
  /not a PDF/.test(await page.locator('#status').textContent()),
  await page.locator('#status').textContent());

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
ok('no sideways scroll at 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passing, ${fail} failing`);
await browser.close();
process.exit(fail ? 1 : 0);
