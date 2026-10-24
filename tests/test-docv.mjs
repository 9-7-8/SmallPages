/* Document Viewer, and mostly its .eml reader: an email is the one format here
   whose file is somebody else's HTML, so what gets through the sanitiser and
   what does not is most of this. */

import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:8099/document-viewer.html';
const D = WORK + '/docs';
/* The locale is pinned because this container has none, and a Chromium with
   no locale cannot name a saved file "Årsräkning.csv" — it falls back to
   "download" and the check below would be measuring the container rather than
   the page. The timezone is pinned for the same reason: a date in a header is
   shown in local time. */
const browser = await chromium.launch({
  executablePath: CHROMIUM_BIN,
  env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
});
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 1000 },
  acceptDownloads: true,
  locale: 'en-US',
  timezoneId: 'UTC',
});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
// pdf.js is fetched rather than carried, so a checkout with no network logs
// that it could not be — which is the environment talking, not the page.
const NOISE = /favicon|404|ERR_NAME|net::|pdf\.js couldn't be loaded|unpkg\.com/;
page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x = '') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto(URL);

/* The status line is stamped first so the wait cannot be satisfied by the
   line the last document left behind — which is how this came to carry on
   before the new one had been read at all. */
const open = async (name) => {
  await page.evaluate(() => { document.getElementById('status').textContent = 'WAITING'; });
  // Cleared first: handing the input the same file twice running is not a
  // change, and the second open would never happen.
  await page.setInputFiles('#fileInput', []);
  await page.setInputFiles('#fileInput', `${D}/${name}`);
  await page.waitForFunction(() => {
    const said = document.getElementById('status').textContent;
    return said && !/^(WAITING|Opening|Reading|Unpacking|Fetching)/.test(said);
  }, null, { timeout: 25000 });
  await page.waitForTimeout(350);
};
const status = () => page.textContent('#status');
const shown = () => page.$eval('#render', r => r.innerText);
const acts = () => page.$$eval('#docacts button', n => n.map(b => b.textContent));
const click = (label) => page.click(`#docacts button:text-is("${label}")`);

/* ---- the formats that were already here still open ---- */

await open('notes.md');
ok('Markdown still opens as a document', (await acts()).join() === 'rendered,source,Copy all'
   && (await shown()).length > 50, (await acts()).join());
await open('sample.docx');
ok('a .docx still opens', /Word document/.test(await status()), await status());
await open('alpha.pdf');
// This page fetches pdf.js rather than carrying it, so a checkout with no
// network cannot exercise the PDF reader. Say so rather than pass on nothing.
const pdfSaid = await status();
if (/pdf\.js couldn't be loaded/.test(pdfSaid)) console.log('NOTE  no network for pdf.js — the PDF reader went unchecked');
else ok('a PDF still opens', /page/i.test(pdfSaid), pdfSaid);
await open('plain.txt');
ok('plain text still opens through the line viewer',
   await page.$eval('#viewport', v => v.classList.contains('on')), await status());

/* ---- the simplest message ---- */

await open('plain.eml');
ok('an .eml opens as an email', /Opened as an email/.test(await status()), await status());
ok('and says so under the name', /· email$/.test(await page.textContent('#docmeta')),
   await page.textContent('#docmeta'));

let text = await shown();
ok('the subject is the heading',
   await page.$eval('#render h1', h => h.textContent) === 'The engine weaves algebraic patterns',
   await page.$eval('#render h1', h => h.textContent));
ok('From, To and Date are laid out as fields',
   await page.$$eval('#render .mailhead dt', n => n.map(d => d.textContent).join()) === 'From,To,Date',
   await page.$$eval('#render .mailhead dt', n => n.map(d => d.textContent).join()));
ok('the Date is shown as a date rather than as the header',
   /\d{1,2}\/\d{1,2}\/\d{4}/.test(text) && !text.includes('+0000'), text.slice(0, 300));
ok('the body is there, hard wrapping and all',
   text.includes('weaves algebraic patterns just as the Jacquard'), text.slice(0, 400));
ok('the headers it does not show are not dumped into the body',
   !text.includes('Return-Path') && !text.includes('ESMTP'), text.slice(0, 400));
const quotes = await page.$$eval('#render .mailtext blockquote',
  n => n.map(q => [q.closest('blockquote:not(:scope)') ? 2 : 1, q.textContent.trim()]));
ok('a quoted passage is set apart rather than run in, and a reply to it sits inside it',
   quotes.length === 2 && /compose music/.test(quotes[0][1])
   && /rules of harmony/.test(quotes[1][1])
   && await page.$$eval('#render .mailtext blockquote blockquote', n => n.length) === 1,
   JSON.stringify(quotes));
ok('and the angle brackets go, since the rule down the side already says it',
   !quotes.some(q => q[1].includes('>')), JSON.stringify(quotes));
const links = await page.$$eval('#render .mailtext a', n => n.map(a => a.getAttribute('href')));
ok('a bare address and a bare URL in plain text are made clickable',
   links.includes('mailto:ada@example.test') && links.includes('https://example.test/notes'),
   JSON.stringify(links));

/* ---- the source view, which is the raw file through the line tools ---- */

ok('a message offers the message and the raw source', (await acts()).slice(0, 2).join() === 'message,source',
   (await acts()).join());
await click('source');
await page.waitForTimeout(300);
ok('the source view hands the file to the line viewer',
   await page.$eval('#viewport', v => v.classList.contains('on')), '');
const raw = await page.$eval('#rows', r => r.innerText);
ok('and the source is the headers too, which the message view hides',
   /Return-Path/.test(raw) && /Content-Type/.test(raw), raw.slice(0, 160));
await click('message');
await page.waitForTimeout(300);
ok('and it goes back to the message', await page.$$eval('#render .mailhead', n => n.length) === 1, '');

/* ---- encoded words, charsets, and the rest of what a real message carries ---- */

await open('latin.eml');
text = await shown();
ok('an encoded-word subject in a one-byte charset comes back as words',
   await page.$eval('#render h1', h => h.textContent) === 'Rechnung für Büro',
   await page.$eval('#render h1', h => h.textContent));
ok('and so does a name in one', text.includes('Jürgen Weiß'), text.slice(0, 200));
ok('a base64 body in iso-8859-1 is decoded with its own charset',
   text.includes('Grüße aus München'), text.slice(0, 400));

await open('rich.eml');
text = await shown();
ok('an encoded-word subject split across two words loses the fold, not a space',
   await page.$eval('#render h1', h => h.textContent) === 'Quarterly notes — brass & cards',
   await page.$eval('#render h1', h => h.textContent));
ok('a quoted-printable part is decoded', (await page.textContent('#status')).includes('plain text'),
   await status());
ok('the message says what it found', /HTML and plain text/.test(await status())
   && /1 attachment and 1 inline image/.test(await status()), await status());

/* ---- somebody else's HTML, which is the whole risk ---- */

ok('nothing in the message runs', await page.evaluate(() => window.__pwned) === undefined,
   String(await page.evaluate(() => window.__pwned)));
ok('no script, style, iframe, form or input survives',
   await page.$$eval('#render script, #render style, #render iframe, #render form, #render input, #render button[type]', n => n.length) === 0, '');
ok('and the <title> of the mail is not shown as text', !text.includes('should not show'), text.slice(0, 400));
ok('a tag that is not on the list is unwrapped rather than losing its words',
   text.includes('Kept, though the section tag is not'), text.slice(0, 600));
ok('the structure that matters comes through',
   await page.$$eval('#render .mailbody h1', n => n.length) === 1
   && await page.$$eval('#render .mailbody li', n => n.length) === 2
   && await page.$$eval('#render .mailbody th', n => n.length) === 2
   && await page.$$eval('#render .mailbody strong, #render .mailbody em', n => n.length) === 2, '');
ok('a colspan is kept, since the table is wrong without it',
   await page.$eval('#render .mailbody th[colspan]', t => t.getAttribute('colspan')) === '2', '');
ok('no style attribute and no bgcolor ride along',
   await page.$$eval('#render .mailbody *', n =>
     n.filter(e => e.hasAttribute('style') || e.hasAttribute('bgcolor') || e.hasAttribute('onerror')).length) === 0, '');
const mailLinks = await page.$$eval('#render .mailbody a', n => n.map(a => [a.getAttribute('href'), a.target]));
ok('a javascript: link is not a link any more, though its words stay',
   mailLinks.length === 1 && mailLinks[0][0] === 'https://example.test/ledger' && mailLinks[0][1] === '_blank'
   && text.includes('do not press this'), JSON.stringify(mailLinks));

/* ---- pictures ---- */

let imgs = await page.$$eval('#render .mailbody img', n => n.map(i => [i.src.slice(0, 5), i.naturalWidth]));
ok('a picture that came inside the message is shown, out of the message',
   imgs.length === 1 && imgs[0][0] === 'blob:' && imgs[0][1] === 12, JSON.stringify(imgs));
ok('one hosted elsewhere is held back, named by where it would come from',
   /\[image from tracker\.example\.test\]/.test(text), text.slice(0, 700));
ok('and an <img> with a target that is neither is just a gap',
   await page.$$eval('#render .mailbody .held', n => n.length) === 2, '');

ok('loading them is offered, not done', (await acts()).includes('Load remote images'), (await acts()).join());
await click('Load remote images');
await page.waitForTimeout(400);
imgs = await page.$$eval('#render .mailbody img', n => n.map(i => i.getAttribute('src')));
ok('asking for them puts them in', imgs.length === 2
   && imgs.some(s => s.startsWith('https://tracker.example.test/')), JSON.stringify(imgs));
ok('and the offer goes away once it has been taken', !(await acts()).includes('Load remote images'),
   (await acts()).join());

/* ---- the plain half of the same message ---- */

ok('both versions are offered when a message carries both',
   (await acts()).includes('HTML') && (await acts()).includes('plain'), (await acts()).join());
await click('plain');
await page.waitForTimeout(350);
text = await shown();
ok('the plain version is the plain version',
   await page.$$eval('#render .mailtext', n => n.length) === 1
   && await page.$$eval('#render .mailbody', n => n.length) === 0
   && text.includes('Café receipts are in the attachment'), text.slice(0, 500));
ok('a picture nothing asked for is listed rather than locked in the file',
   (await page.$$eval('#render .atts li .name', n => n.map(x => x.textContent))).includes('logo.png'),
   JSON.stringify(await page.$$eval('#render .atts li .name', n => n.map(x => x.textContent))));
await click('HTML');
await page.waitForTimeout(350);

/* ---- attachments ---- */

const atts = await page.$$eval('#render .atts li', n => n.map(li => [
  li.querySelector('.name').textContent, li.querySelector('.meta').textContent]));
ok('the attachment is listed with its type and size', atts.length === 1
   && /text\/csv · \d+ B/.test(atts[0][1]), JSON.stringify(atts));
ok('and its name is the one the headers spell across three lines, percent-encoded',
   atts[0][0] === 'Årsräkning.csv', JSON.stringify(atts));

const wait = page.waitForEvent('download', { timeout: 15000 });
await page.click('#render .atts li button:text-is("Save")');
const got = await wait;
const saved = `${WORK}/att.csv`;
await got.saveAs(saved);
ok('saving it gives back the bytes that were in the message',
   got.suggestedFilename() === 'Årsräkning.csv'
   && fs.readFileSync(saved, 'utf8').startsWith('date,item,cost'),
   JSON.stringify([got.suggestedFilename(), fs.readFileSync(saved, 'utf8').slice(0, 40)]));

await page.click('#render .atts li button:text-is("Open here")');
await page.waitForTimeout(600);
ok('and opening it here opens it here',
   /Årsräkning\.csv/.test(await page.textContent('#docname'))
   && (await page.$eval('#rows', r => r.innerText)).includes('brass gears'),
   await page.textContent('#docname'));

/* ---- copying ---- */

await open('rich.eml');
await page.click('#docacts button:text-is("Copy all")');
await page.waitForTimeout(400);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok('copying gives the message rather than the page furniture',
   /^Subject: Quarterly notes — brass & cards$/m.test(clip)
   && /^From: Grégoire Noël <gregoire@example.test>$/m.test(clip)
   && clip.includes('The figures are settled')
   && /^Attachments: Årsräkning\.csv \(text\/csv · \d+ B\)$/m.test(clip)
   && !/Open here|Save$/m.test(clip), JSON.stringify(clip).slice(0, 400));

/* ---- a message with a message attached to it ---- */

await open('forwarded.eml');
const fwd = await page.$$eval('#render .atts li', n => n.map(li => [
  li.querySelector('.name').textContent, li.querySelector('.meta').textContent]));
ok('a forwarded message is luggage with a name it never had',
   fwd.length === 1 && fwd[0][0] === 'attached-message-1.eml' && /message\/rfc822/.test(fwd[0][1]),
   JSON.stringify(fwd));
ok('and the covering note is the body rather than the whole pile',
   (await shown()).includes('Passing this on') && !(await shown()).includes('2,292,387'),
   (await shown()).slice(0, 300));
await page.click('#render .atts li button:text-is("Open here")');
await page.waitForTimeout(600);
ok('opening it here opens it as the message it is',
   await page.$eval('#render h1', h => h.textContent) === 'The frequency hopping paper'
   && (await shown()).includes('2,292,387'),
   await page.$eval('#render h1', h => h.textContent));

/* ---- a message with no extension on it at all ---- */

await open('message-no-extension');
ok('a file with no extension that is shaped like a message opens as one',
   /Opened as an email/.test(await status())
   && (await shown()).includes('It still has to open as a message'), await status());

/* ---- and the things that look like headers but are not ---- */

await open('notes.md');
ok('Markdown with a colon in its first line is still Markdown',
   (await acts()).includes('rendered'), (await acts()).join());
await open('wide.txt');
ok('a .txt is still text', await page.$eval('#viewport', v => v.classList.contains('on')), '');

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');

await open('rich.eml');
await page.screenshot({ path: WORK + '/docv-eml.png' });
await browser.close();
