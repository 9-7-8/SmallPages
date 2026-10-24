import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const URL = 'http://127.0.0.1:8099/blank-page.html';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
const errs = [];

const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
  await page.goto(URL);
  return { ctx, page };
};

// ---- markdown ----
let { ctx, page } = await fresh();
const md = (src) => page.evaluate((s) => toHtml(s), src);

ok('headings', (await md('# One\n## Two')).includes('<h1>One</h1>') && (await md('## Two')).includes('<h2>Two</h2>'), await md('# One'));
ok('bold and italic', /<strong>b<\/strong>/.test(await md('**b**')) && /<em>i<\/em>/.test(await md('*i*')), await md('**b** and *i*'));
ok('bold inside italic', /<strong><em>x<\/em><\/strong>/.test(await md('***x***')), await md('***x***'));
ok('strikethrough and underline', /<del>s<\/del>/.test(await md('~~s~~')) && /<u>u<\/u>/.test(await md('__u__')), await md('~~s~~ __u__'));
ok('inline code', /<code>a\*b<\/code>/.test(await md('`a*b`')), await md('`a*b`'));
ok('code inside backticks is not re-parsed', !/<em>/.test(await md('`a*b*c`')), await md('`a*b*c`'));
ok('fenced block', /<pre><code>one\ntwo<\/code><\/pre>/.test(await md('```\none\ntwo\n```')), await md('```\none\ntwo\n```'));
ok('unordered list', /<ul>\n<li>a<\/li>\n<li>b<\/li>\n<\/ul>/.test(await md('- a\n- b')), await md('- a\n- b'));
ok('ordered list', /<ol>\n<li>a<\/li>/.test(await md('1. a\n2. b')), await md('1. a\n2. b'));
ok('blockquote', /<blockquote>.*<p>q<\/p>.*<\/blockquote>/s.test(await md('> q')), await md('> q'));
ok('horizontal rule', (await md('---')).includes('<hr>'), await md('---'));
ok('link', /<a href="https:\/\/e.test" rel="noopener noreferrer" target="_blank">t<\/a>/.test(await md('[t](https://e.test)')), await md('[t](https://e.test)'));
ok('paragraphs split on blank lines', (await md('a\n\nb')).match(/<p>/g).length === 2, await md('a\n\nb'));
ok('a single newline is a line break', /<br>/.test(await md('a\nb')), await md('a\nb'));
ok('a bare hyphen is not a rule', !/hr/.test(await md('- a')), await md('- a'));

// ---- the preview must not execute anything ----
const nasty = '<script>window.__pwned=1<\/script>\n\n<img src=x onerror="window.__pwned=2">\n\n![a](x" onerror="window.__pwned=3)\n\n[t](javascript:window.__pwned=4)';
await page.fill('#sheet', nasty);
await page.click('#previewBtn');
await page.waitForTimeout(400);
const pwned = await page.evaluate(() => window.__pwned);
ok('nothing in the text runs', pwned === undefined, String(pwned));
ok('a typed script tag shows as text', (await page.textContent('#preview')).includes('<script>'), (await page.textContent('#preview')).slice(0, 60));
ok('no img element was conjured from raw html', await page.$$eval('#preview img', n => n.length) <= 1, '');
const imgSrc = await page.$$eval('#preview img', n => n.map(i => i.getAttribute('src')));
ok('a quote in a link target cannot break out of the attribute',
   imgSrc.every(s => !/onerror/i.test(s) || s.includes('onerror=')), JSON.stringify(imgSrc));
ok('and no onerror attribute exists anywhere', await page.$$eval('#preview *', n => n.filter(e => e.hasAttribute('onerror')).length) === 0, '');
await page.click('#previewBtn');

// ---- caching ----
await page.fill('#sheet', 'the quick brown fox');
await page.fill('#titleIn', 'My Draft');
await page.waitForTimeout(700);
await page.reload();
ok('the writing survives a reload', await page.inputValue('#sheet') === 'the quick brown fox', await page.inputValue('#sheet'));
ok('and so does the name', await page.inputValue('#titleIn') === 'My Draft', await page.inputValue('#titleIn'));

// ---- several documents ----
await page.click('#newBtn');
await page.fill('#sheet', 'second document');
await page.waitForTimeout(700);
ok('New does not destroy the first', await page.$$eval('#docsSel option', o => o.length) === 2,
   await page.$$eval('#docsSel option', o => o.map(x => x.textContent)));
const names = await page.$$eval('#docsSel option', o => o.map(x => x.textContent));
ok('the list names them', names.includes('My Draft') && names.includes('second document'), JSON.stringify(names));
const firstId = await page.$$eval('#docsSel option', o => o.find(x => x.textContent === 'My Draft').value);
await page.selectOption('#docsSel', firstId);
await page.waitForTimeout(300);
ok('switching back brings the first one up', await page.inputValue('#sheet') === 'the quick brown fox', await page.inputValue('#sheet'));

// ---- downloads ----
// The bar has to be down for the pointer to reach the Save button, and resting
// on it holds it there.
await page.mouse.move(600, 4);
await page.waitForTimeout(300);

const grab = async (kind, name) => {
  await page.selectOption('#saveSel', kind);
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click('#saveBtn');
  const got = await dl;
  const p = `${SCR}/${name}`;
  await got.saveAs(p);
  return { path: p, file: got.suggestedFilename() };
};

let got = await grab('md', 'bp.md');
ok('saves a .md named after the document',
   got.file === 'My Draft.md' && fs.readFileSync(got.path, 'utf8') === 'the quick brown fox', JSON.stringify(got));
got = await grab('txt', 'bp.txt');
ok('saves a .txt too',
   got.file === 'My Draft.txt' && fs.readFileSync(got.path, 'utf8') === 'the quick brown fox', JSON.stringify(got));

// Something with every shape in it, so the rich formats have something to lose.
const SAMPLE = [
  '# Title One', '',
  'A **bold** word, an *italic* one and a [link](https://example.test).', '',
  '## Smaller', '',
  '- first', '- second', '',
  '1. one', '2. two', '',
  '> quoted line', '',
  '```', '  code  line', '```', '',
  '---', '',
  'last — with a dash',
].join('\n');

await page.fill('#sheet', SAMPLE);
await page.waitForTimeout(700);
await page.mouse.move(600, 4);
await page.waitForTimeout(300);

const saved = {};
for (const kind of ['html', 'rtf', 'docx', 'odt']) saved[kind] = (await grab(kind, `bp.${kind}`)).path;
ok('the picker saves one of each', Object.values(saved).every(p => fs.statSync(p).size > 200),
   JSON.stringify(Object.fromEntries(Object.entries(saved).map(([k, p]) => [k, fs.statSync(p).size]))));

// ---- the zips are zips, and are the documents they claim to be ----
const py = (code, ...args) => execFileSync('python3', ['-I', '-c', code, ...args], { encoding: 'utf8' }).trim();

const PEEK = `
import sys, zipfile
from xml.etree import ElementTree as ET
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
names = z.namelist()
first = z.infolist()[0]
texts = []
for n in names:
    if n.endswith('.xml'):
        ET.fromstring(z.read(n))          # every part has to parse
print(repr(bad))
print('|'.join(names))
print(first.filename, first.compress_type)
print(z.read(sys.argv[2]).decode('utf-8'))
`;

// A .docx
let out = py(PEEK, saved.docx, 'word/document.xml').split('\n');
const docxXml = out.slice(3).join('\n');
ok('the .docx is a sound zip of XML that parses',
   out[0] === 'None' && out[1].split('|').includes('word/document.xml')
   && out[1].split('|').includes('[Content_Types].xml') && out[1].split('|').includes('word/styles.xml'), out.slice(0, 2).join(' '));
ok('its headings are headings rather than a line in bold',
   /<w:pStyle w:val="Heading1"\/>/.test(docxXml) && /<w:pStyle w:val="Heading2"\/>/.test(docxXml), '');
ok('bold and italic survive as runs', /<w:b\/>/.test(docxXml) && /<w:i\/>/.test(docxXml), '');
ok('the list items are numbered by Word, not by hand',
   /<w:numId w:val="1"\/>/.test(docxXml) && /<w:numId w:val="10\d"\/>/.test(docxXml)
   && !/<w:t[^>]*>1\.<\/w:t>/.test(docxXml), '');
ok('and the link is a real hyperlink with a relationship behind it',
   /<w:hyperlink r:id="(rId\d+)">/.test(docxXml)
   && py(PEEK, saved.docx, 'word/_rels/document.xml.rels').includes('https://example.test'), '');
const numbering = py(PEEK, saved.docx, 'word/numbering.xml');
ok('the numbering it points at is actually in the file',
   /<w:num w:numId="1">/.test(numbering) && /<w:num w:numId="10\d">/.test(numbering), '');

// An .odt
out = py(PEEK, saved.odt, 'content.xml').split('\n');
const odtXml = out.slice(3).join('\n');
ok('the .odt is a sound zip of XML that parses',
   out[0] === 'None' && out[1].split('|').includes('content.xml')
   && out[1].split('|').includes('META-INF/manifest.xml'), out.slice(0, 2).join(' '));
ok('its mimetype entry is first and stored, as the format requires',
   out[2] === 'mimetype 0', out[2]);
ok('headings carry their outline level',
   /text:outline-level="1"/.test(odtXml) && /text:outline-level="2"/.test(odtXml), '');
ok('a numbered list is one list rather than four lists of one',
   (odtXml.match(/<text:list /g) || []).length === 2
   && (odtXml.match(/<text:list-item>/g) || []).length === 4,
   JSON.stringify([(odtXml.match(/<text:list /g) || []).length, (odtXml.match(/<text:list-item>/g) || []).length]));
ok('the indent inside a code block is kept rather than collapsed',
   /<text:s text:c="2"\/>/.test(odtXml), '');
ok('and the link is a link', /<text:a[^>]+xlink:href="https:\/\/example.test"/.test(odtXml), '');

// ---- read back by something else: pdf-builder's own readers ----
const pb = await browser.newPage();
await pb.goto('http://127.0.0.1:8099/pdf-builder.html');
const reread = (kind) => pb.evaluate(async ({ bytes, kind }) => {
  const file = new File([new Uint8Array(bytes)], `x.${kind}`);
  if (kind === 'docx') return readDocx(file);
  if (kind === 'odt') return readOdt(file);
  return readRtf(await file.text());
}, { bytes: [...fs.readFileSync(saved[kind])], kind });

for (const kind of ['docx', 'odt', 'rtf']) {
  const blocks = (await reread(kind)).filter(b => b.text);
  // Spaces are collapsed before comparing: a reader that takes the text and
  // nothing else does not expand an .odt's <text:s/>, and the run of spaces
  // inside the code block is checked against the XML itself further up.
  const text = blocks.map(b => b.text).join('\n').replace(/ {2,}/g, ' ');
  const levelOf = (want) => (blocks.find(b => b.text === want) || {}).level;
  ok(`another program reads the .${kind} back`,
     ['Title One', 'Smaller', 'first', 'second', 'one', 'two', 'quoted line', 'code line']
       .every(w => text.includes(w)) && /last .*with a dash/.test(text),
     JSON.stringify(text).slice(0, 220));
  // The space on either side of an emphasised word is its own run, and an
  // .odt lost it to a <text:s/> that the reader threw away.
  ok(`the .${kind} keeps the spaces around an emphasised word`,
     /A bold word, an italic one and a link\./.test(text), JSON.stringify(text).slice(0, 160));
  ok(`and the .${kind} still has its headings`,
     kind === 'rtf' ? !/^#/m.test(text) : levelOf('Title One') === 1 && levelOf('Smaller') === 2,
     JSON.stringify(blocks).slice(0, 220));
  ok(`the .${kind} carries no leftover markdown punctuation`,
     !/\*\*|\]\(|^- /m.test(text), JSON.stringify(text).slice(0, 220));
}
await pb.close();

// ---- the .html is a page a browser reads ----
const hp = await browser.newPage();
await hp.goto('file://' + saved.html);
ok('the .html opens as a document of its own',
   await hp.textContent('h1') === 'Title One' && await hp.textContent('h2') === 'Smaller', '');
ok('with real emphasis, a list and a link',
   await hp.textContent('strong') === 'bold' && await hp.textContent('em') === 'italic'
   && await hp.$$eval('li', n => n.length) === 4
   && await hp.getAttribute('a', 'href') === 'https://example.test', '');
ok('and it stands alone — nothing is fetched from anywhere',
   !/<link|src=|@import/i.test(fs.readFileSync(saved.html, 'utf8')), '');
await hp.close();

// ---- the chosen format is the one ctrl-S uses, and it is remembered ----
await page.reload();
await page.waitForTimeout(400);
ok('the picker comes back where it was left', await page.inputValue('#saveSel') === 'odt',
   await page.inputValue('#saveSel'));
await page.selectOption('#saveSel', 'rtf');
await page.click('#sheet');
const viaKey = page.waitForEvent('download', { timeout: 20000 });
await page.keyboard.press('Control+s');
ok('ctrl-S saves in the format that is chosen', (await viaKey).suggestedFilename().endsWith('.rtf'),
   (await viaKey).suggestedFilename());

// Back to where the rest of the suite expects to be.
await page.fill('#sheet', 'the quick brown fox');
await page.waitForTimeout(700);

// ---- the bar ----
await page.mouse.move(600, 500);   // off the bar: resting on it rightly holds it open
await page.reload();
await page.mouse.move(600, 500);
await page.waitForTimeout(2700);   // the welcome showing must expire
const openNow = () => page.$eval('#bar', b => b.classList.contains('open'));
ok('the bar greets you then gets out of the way', !(await openNow()), '');
await page.mouse.move(600, 4);
await page.waitForTimeout(350);
ok('it comes back at the top of the screen', await openNow(), '');
const box = await page.$eval('#previewBtn', b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
await page.mouse.move(box.x, box.y);
await page.waitForTimeout(350);
ok('and stays open when the pointer moves onto a button in it', await openNow(), 'it closed under the hand');
await page.mouse.move(600, 500);
await page.waitForTimeout(450);
ok('it leaves again once the pointer does', !(await openNow()), '');
// The bar gained a format to pick; it must still be one row on a laptop,
// and a long document name must not be able to shove it onto two.
await page.fill('#titleIn', 'A document with a rather long name indeed');
await page.waitForTimeout(700);
await page.setViewportSize({ width: 1280, height: 820 });
await page.mouse.move(600, 4);
await page.waitForTimeout(300);
const rows = await page.$eval('#bar', b => b.getBoundingClientRect().height);
ok('everything in it stays on one line at a laptop width', rows < 60, `${rows}px tall`);
await page.setViewportSize({ width: 1200, height: 820 });
await page.fill('#titleIn', 'My Draft');
await page.waitForTimeout(700);

// ---- preferences persist ----
await page.mouse.move(600, 4); await page.waitForTimeout(300);
await page.selectOption('#paperSel', 'sepia');
await page.selectOption('#fontSel', 'serif');
await page.selectOption('#sizeSel', '22');
await page.selectOption('#widthSel', '48');
await page.click('#focusBtn');
await page.click('#typerBtn');
await page.waitForTimeout(300);
ok('the paper changes', await page.getAttribute('body', 'data-paper') === 'sepia', await page.getAttribute('body', 'data-paper'));
ok('focus mode marks the body', await page.getAttribute('body', 'data-focus') === 'on', '');
await page.reload();
await page.waitForTimeout(300);
ok('every preference survives a reload', await page.getAttribute('body', 'data-paper') === 'sepia'
   && await page.inputValue('#fontSel') === 'serif' && await page.inputValue('#sizeSel') === '22'
   && await page.inputValue('#widthSel') === '48' && await page.getAttribute('body', 'data-focus') === 'on'
   && await page.getAttribute('#typerBtn', 'aria-pressed') === 'true',
   await page.evaluate(() => JSON.stringify({p: document.body.dataset.paper, f: fontSel.value, s: sizeSel.value, w: widthSel.value})));
ok('the serif actually reaches the sheet', /Georgia|serif/.test(await page.$eval('#sheet', s => getComputedStyle(s).fontFamily)),
   await page.$eval('#sheet', s => getComputedStyle(s).fontFamily));
ok('and the size does', await page.$eval('#sheet', s => getComputedStyle(s).fontSize) === '22px',
   await page.$eval('#sheet', s => getComputedStyle(s).fontSize));

// ---- counting ----
await page.fill('#sheet', 'one two three four five');
await page.waitForTimeout(300);
ok('it counts words and characters', /5 words · 23 characters/.test(await page.textContent('#tally')), await page.textContent('#tally'));

// ---- typewriter actually scrolls ----
await page.fill('#sheet', Array.from({length: 120}, (_, i) => `line ${i}`).join('\n'));
await page.waitForTimeout(200);
await page.evaluate(() => { sheet.selectionStart = sheet.selectionEnd = sheet.value.length; sheet.dispatchEvent(new Event('input')); });
await page.waitForTimeout(300);
const scrolled = await page.$eval('#sheet', s => s.scrollTop);
ok('typewriter keeps the caret off the bottom', scrolled > 100, String(scrolled));

// ---- keyboard ----
await page.click('#sheet');
await page.keyboard.press('Control+p');
await page.waitForTimeout(300);
ok('ctrl-P previews', !(await page.$eval('#preview', p => p.hidden)), '');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('escape leaves the preview', await page.$eval('#preview', p => p.hidden), '');
await ctx.close();

// ---- a browser that refuses to store anything ----
const blocked = await browser.newContext();
await blocked.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
});
const bp = await blocked.newPage();
const bErrs = [];
bp.on('pageerror', e => bErrs.push(e.message));
await bp.goto(URL);
await bp.fill('#sheet', 'still typeable');
await bp.waitForTimeout(700);
ok('a browser that refuses storage still lets you write',
   bErrs.length === 0 && await bp.inputValue('#sheet') === 'still typeable', JSON.stringify(bErrs));
ok('and says so rather than failing silently', /will not store/.test(await bp.textContent('#flash')), await bp.textContent('#flash'));
await blocked.close();

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');

const shot = await browser.newContext({ viewport: { width: 1200, height: 760 } });
const sp = await shot.newPage();
await sp.goto(URL);
await sp.fill('#sheet', '# On the blank page\n\nThe **hardest** part is the first line. After that it is only *typing*.\n\n> Nothing to be done.\n\n- no toolbar\n- no menus\n- `markdown` as you type it\n');
await sp.waitForTimeout(400);
await sp.mouse.move(600, 4);
await sp.waitForTimeout(500);
await sp.screenshot({ path: SCR + '/blank.png' });
await shot.close();
await browser.close();
