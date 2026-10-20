import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:8099/pdf-builder.html';
const SCR = WORK + '';
const D = SCR + '/docs';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, acceptDownloads: true });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

const load = async (names) => {
  await page.setInputFiles('#fileInput', names.map(n => `${D}/${n}`));
  await page.waitForFunction(() => /added|Not taken|Nothing|no pages|words/.test(
    document.getElementById('status').textContent + document.getElementById('turnaway').textContent),
    null, { timeout: 30000 });
  await page.waitForTimeout(400);
};
const count = () => page.$$eval('.sheet', s => s.length);
const labels = () => page.$$eval('.sheet .tag em', e => e.map(x => x.textContent));

await page.goto(URL);

/* ---- taking documents in ---- */
await load(['alpha.pdf', 'beta.pdf']);
ok('two PDFs make five pages', await count() === 5, await count());
ok('each page says where it came from',
   JSON.stringify(await labels()) === JSON.stringify(['alpha.pdf 1','alpha.pdf 2','alpha.pdf 3','beta.pdf 1','beta.pdf 2']),
   JSON.stringify(await labels()));
ok('the sources are listed with their counts',
   /alpha\.pdf3of3/.test((await page.textContent('#sources')).replace(/\s+/g,'')), await page.textContent('#sources'));

// Thumbnails are rendered from the real page, not faked.
await page.waitForFunction(() => {
  const i = document.querySelector('.sheet img');
  return i && i.src.startsWith('data:image/png') && i.naturalWidth > 20;
}, null, { timeout: 30000 });
ok('thumbnails render from the actual pages', true, '');

/* ---- rearranging ---- */
await page.click('.sheet:nth-child(4)');
await page.click('.sheet:nth-child(5)', { modifiers: ['Shift'] });
ok('shift picks a run', (await page.$$('.sheet.on')).length === 2, (await page.$$('.sheet.on')).length);
await page.click('#upBtn');
ok('to front moves the run', (await labels()).slice(0, 2).join() === 'beta.pdf 1,beta.pdf 2', JSON.stringify(await labels()));
await page.click('#reverseBtn');
ok('reverse turns the whole order round',
   (await labels())[0] === 'alpha.pdf 3' && (await labels())[4] === 'beta.pdf 1', JSON.stringify(await labels()));
await page.click('#reverseBtn');
await page.click('#downBtn');
ok('to back moves it the other way', (await labels()).slice(3).join() === 'beta.pdf 1,beta.pdf 2', JSON.stringify(await labels()));

/* ---- duplicate, blank, delete ---- */
await page.click('#noneBtn');
await page.click('.sheet:nth-child(1)');
await page.click('#dupBtn');
ok('duplicate adds a copy next to it', await count() === 6
   && (await labels()).slice(0,2).join() === 'alpha.pdf 1,alpha.pdf 1', JSON.stringify(await labels()));
await page.click('#blankBtn');
ok('a blank goes in after the selection', await count() === 7 && (await labels())[2] === 'blank',
   JSON.stringify(await labels()));
await page.click('#noneBtn');
await page.click('.sheet:nth-child(3)');
await page.click('#deleteBtn');
ok('delete removes it', await count() === 6 && !(await labels()).includes('blank'), JSON.stringify(await labels()));

/* ---- rotation ---- */
await page.click('#noneBtn');
await page.click('.sheet:nth-child(1)');
await page.click('#rightBtn');
ok('rotating marks the page turned', /1 turned/.test(await page.textContent('#tally')), await page.textContent('#tally'));
ok('and shows it turned', /rotate\(90deg\)/.test(await page.getAttribute('.sheet:nth-child(1) .paper', 'style')),
   await page.getAttribute('.sheet:nth-child(1) .paper', 'style'));
await page.click('#leftBtn');
ok('turning it back undoes it exactly', !/turned/.test(await page.textContent('#tally')), await page.textContent('#tally'));
await page.click('#rightBtn');
await page.click('#rightBtn');
ok('two turns make a half', /rotate\(180deg\)/.test(await page.getAttribute('.sheet:nth-child(1) .paper', 'style')), '');

/* ---- what comes out ---- */
const save = async (name) => {
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#saveBtn');
  const path = `${SCR}/${name}`;
  await (await dl).saveAs(path);
  return path;
};
const read = (path) => page.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const t = await p.getTextContent();
    out.push({ text: t.items.map(x => x.str).join(' ').trim(), rotate: p.rotate });
  }
  return out;
}, fs.readFileSync(path).toString('base64'));

let built = await read(await save('built.pdf'));
ok('the saved file has the pages on screen', built.length === 6, built.length);
ok('in the order they were put in',
   built.map(p => p.text).join(' | ') === 'ALPHA ONE | ALPHA ONE | ALPHA TWO | ALPHA THREE | BETA ONE | BETA TWO',
   built.map(p => p.text).join(' | '));
ok('the text is still text, not a picture of it', built.every(p => p.text.length > 3), JSON.stringify(built.map(p=>p.text)));
ok('the turned page carries its rotation', built[0].rotate === 180, `${built[0].rotate}deg`);
ok('and the others are untouched', built.slice(1).every(p => p.rotate === 0), JSON.stringify(built.map(p=>p.rotate)));
console.log('      ' + built.map(p => `${p.text}${p.rotate ? ' @' + p.rotate : ''}`).join(' | '));

/* ---- documents that have no pages of their own ---- */
await page.goto(URL);
await load(['sample.docx']);
let n = await count();
ok('a .docx is laid out onto pages', n >= 2, n);
ok('and is marked as set here', /set here/.test(await page.textContent('#sources')), await page.textContent('#sources'));
let out = await read(await save('docx.pdf'));
ok('its heading survives as a heading', /Docx Heading/.test(out[0].text), out[0].text.slice(0, 60));
ok('and its words come through', /Docx paragraph number 1\b/.test(out.map(p=>p.text).join(' ')), out[0].text.slice(0, 80));

await page.goto(URL);
await load(['sample.odt']);
ok('an .odt is laid out too', await count() >= 2, await count());
out = await read(await save('odt.pdf'));
ok('with its heading', /Odt Heading/.test(out[0].text), out[0].text.slice(0, 60));

await page.goto(URL);
await load(['notes.md', 'plain.txt', 'sample.rtf']);
const three = await count();
ok('markdown, text and rtf all paginate', three >= 3, three);
out = await read(await save('text.pdf'));
const all = out.map(p => p.text).join(' ');
ok('each one contributes its words',
   /Markdown Heading/.test(all) && /Plain paragraph 1\b/.test(all) && /RTF paragraph 1\b/.test(all),
   all.slice(0, 120));

/* ---- what it will not take ---- */
await page.goto(URL);
await load(['picture.png']);
ok('a picture is refused', await page.isVisible('#turnaway'), '');
ok('and is sent somewhere that can help',
   /images-to-pdf\.html/.test(await page.innerHTML('#turnaway'))
   && /anything-to-image\.html/.test(await page.innerHTML('#turnaway')), '');
ok('with nothing added', await count() === 0, await count());

/* ---- characters the standard fonts cannot set ---- */
await page.goto(URL);
await load(['wide.txt']);
ok('a document with unencodable characters still goes in', await count() >= 1, await count());
ok('and the page says what it dropped', /characters outside the standard fonts were dropped/.test(await page.textContent('#status')),
   await page.textContent('#status'));
out = await read(await save('wide.pdf'));
ok('the rest of the words are intact', /Smart .quotes. and an em--dash/.test(out[0].text), out[0].text.slice(0, 80));

/* ---- mixing a made document with a real one ---- */
await page.goto(URL);
await load(['alpha.pdf', 'notes.md']);
const mixed = await count();
ok('a PDF and a text file sit in the same pile', mixed > 3, mixed);
await page.click('#allBtn');
await page.click('#reverseBtn');
out = await read(await save('mixed.pdf'));
ok('and come out in one document', out.length === mixed, `${out.length} of ${mixed}`);
ok('with the real pages still real', /ALPHA ONE/.test(out.map(p=>p.text).join(' ')), '');

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.goto(URL);
await load(['alpha.pdf', 'beta.pdf', 'notes.md']);
await page.click('.sheet:nth-child(2)');
await page.waitForTimeout(1500);
await page.screenshot({ path: SCR + '/pdfb.png', fullPage: true });
await browser.close();
