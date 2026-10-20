import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
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
const grab = async (sel, name) => {
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await page.click(sel);
  const p = `${SCR}/${name}`;
  await (await dl).saveAs(p);
  return { body: fs.readFileSync(p, 'utf8'), file: (await dl).suggestedFilename() };
};
let got = await grab('#mdBtn', 'bp.md');
ok('saves a .md named after the document', got.file === 'My Draft.md' && got.body === 'the quick brown fox', JSON.stringify(got));
got = await grab('#txtBtn', 'bp.txt');
ok('saves a .txt too', got.file === 'My Draft.txt' && got.body === 'the quick brown fox', JSON.stringify(got));

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
