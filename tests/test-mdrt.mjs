/* Markdown → Rich Text. The page's job is what comes out of it rather than
   what it draws, so most of this reads the clipboard and the saved files back
   rather than the preview's markup. */

import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:8099/markdown-to-rich-text.html';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x = '') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto(URL);

const type = async (text) => {
  await page.fill('#src', text);
  await page.waitForTimeout(120);
};
const html = () => page.$eval('#out', o => o.innerHTML);
const shown = () => page.$eval('#out', o => o.textContent);

/* ---- it renders as you type, without a button to press ---- */

ok('the preview says so before anything is typed',
   /Nothing yet/.test(await shown()), await shown());

await page.click('#src');
await page.keyboard.type('# Live');
await page.waitForTimeout(150);
ok('typing renders straight away, with no button pressed',
   /<h1>Live<\/h1>/.test(await html()), await html());

/* ---- the markdown ---- */

const md = async (source) => { await type(source); return html(); };

ok('headings', /<h1>One<\/h1>/.test(await md('# One')) && /<h3>Three<\/h3>/.test(await md('### Three')), await html());
ok('bold, italic and both', /<strong>b<\/strong>/.test(await md('**b**'))
   && /<em>i<\/em>/.test(await md('*i*'))
   && /<strong><em>x<\/em><\/strong>/.test(await md('***x***')), await html());
ok('underscores are bold, the way GitHub and CommonMark read them',
   /<strong>b<\/strong>/.test(await md('__b__')), await html());
ok('strikethrough', /<del>gone<\/del>/.test(await md('~~gone~~')), await html());
ok('inline code is not read as markup', /<code>a\*b\*c<\/code>/.test(await md('`a*b*c`'))
   && !/<em>/.test(await html()), await html());
ok('fenced code keeps its language', /<pre><code class="lang-js">let x = 1;<\/code><\/pre>/.test(await md('```js\nlet x = 1;\n```')), await html());
ok('indented code', /<pre><code>step one<\/code><\/pre>/.test(await md('    step one')), await html());
ok('a horizontal rule', (await md('---')).includes('<hr>'), await html());
ok('a bare hyphen is a list, not a rule', !/hr/.test(await md('- a')), await html());
ok('a blockquote holds blocks, not just a line',
   /<blockquote>\s*<p>one<\/p>\s*<p>two<\/p>\s*<\/blockquote>/.test(await md('> one\n>\n> two')), await html());
ok('two spaces at the end of a line is a break',
   /first<br>second/.test(await md('first  \nsecond')), await html());
ok('a link', /<a href="https:\/\/e.test"[^>]*>t<\/a>/.test(await md('[t](https://e.test)')), await html());
ok('an autolink in angle brackets',
   /<a href="https:\/\/e.test"[^>]*>https:\/\/e.test<\/a>/.test(await md('<https://e.test>')), await html());

/* ---- lists, including the nesting a flat parser gets wrong ---- */

ok('an unordered list', /<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/.test(await md('- a\n- b')), await html());
ok('an ordered list', /<ol>\s*<li>a<\/li>/.test(await md('1. a\n2. b')), await html());
ok('an ordered list that does not start at one', /<ol start="3">/.test(await md('3. c\n4. d')), await html());
ok('a list nested under a list',
   /<li>outer\s*<ul>\s*<li>inner<\/li>\s*<\/ul>\s*<\/li>/.test(await md('- outer\n  - inner')), await html());
ok('a paragraph and a code block inside one item',
   /<li>\s*<p>item<\/p>\s*<pre><code>code<\/code><\/pre>\s*<\/li>/.test(await md('- item\n\n      code\n')), await html());
ok('a loose list is marked so it can breathe',
   /<ul class="loose">/.test(await md('- a\n\n- b')), await html());
ok('a task list is boxes that will survive being pasted',
   /☐/.test(await md('- [ ] to do\n- [x] done')) && /☑/.test(await html())
   && !/<input/.test(await html()), await html());
// The box went in front of the item's paragraph rather than inside it, which
// in a loose list put it on a line of its own with the words underneath.
await type('- [x] paid\n\n- [ ] collected\n\n- nails');
const tasks = await page.$$eval('#out li', n => n.map(li => ({
  task: li.classList.contains('task'),
  h: Math.round(li.getBoundingClientRect().height),
  left: Math.round((li.querySelector('.box') || li).getBoundingClientRect().left),
})));
ok('a task box stays on the line with its words even in a loose list',
   tasks.filter(t => t.task).every(t => t.h < 40), JSON.stringify(tasks));
// Pulled back into the marker column rather than left in the text column —
// a loose list resetting that margin is how the boxes came to sit in from
// the bullets above them.
const pull = tasks[2].left - tasks[0].left;
ok('and is pulled back into the column the bullets are drawn in',
   pull > 8 && pull < 26, `${pull}px, from ${JSON.stringify(tasks)}`);
ok('a year at the start of a line is not an ordered list',
   /<p>I was born in<br>1984. It was a year.<\/p>/.test(await md('I was born in\n1984. It was a year.')), await html());

/* ---- tables ---- */

const TABLE = '| Name | Qty | Cost |\n|:-----|:---:|-----:|\n| Nail | 40 | 2.50 |\n| Screw | 7 | 11 |';
await type(TABLE);
ok('a table becomes a table', /<table>/.test(await html())
   && (await page.$$eval('#out td', n => n.length)) === 6
   && (await page.$$eval('#out th', n => n.length)) === 3,
   await html());
ok('and its column alignment comes with it',
   await page.$$eval('#out thead th', n => n.map(c => c.style.textAlign).join(',')) === 'left,center,right',
   await page.$$eval('#out thead th', n => n.map(c => c.style.textAlign).join(',')));

/* ---- nothing in the text may run, here or wherever it is pasted ---- */

const NASTY = '<script>window.__pwned=1<\/script>\n\n'
  + '<img src=x onerror="window.__pwned=2">\n\n'
  + '![a](x" onerror="window.__pwned=3)\n\n'
  + '[t](javascript:window.__pwned=4)\n\n'
  + '[d](data:text/html,<script>window.__pwned=5<\/script>)';
await type(NASTY);
await page.waitForTimeout(250);
ok('nothing in the text runs', await page.evaluate(() => window.__pwned) === undefined,
   String(await page.evaluate(() => window.__pwned)));
ok('a typed script tag shows as the characters typed', (await shown()).includes('<script>'), (await shown()).slice(0, 60));
ok('no onerror attribute exists anywhere',
   await page.$$eval('#out *', n => n.filter(e => e.hasAttribute('onerror')).length) === 0, '');
const hrefs = await page.$$eval('#out a', n => n.map(a => a.getAttribute('href')));
ok('a javascript: or data: link is dropped rather than carried into the paste',
   hrefs.every(h => !/^(javascript|data):/i.test(h)), JSON.stringify(hrefs));
ok('but its words are kept rather than vanishing', /\bt\b/.test(await shown()) && /\bd\b/.test(await shown()),
   (await shown()).slice(0, 120));

/* ---- the whole document, which is what the buttons act on ---- */

const DOC = [
  '# Shopping',
  '',
  'A **bold** word, an *italic* one and a [link](https://example.test).',
  '',
  '## The list',
  '',
  '- nails',
  '- screws',
  '  - countersunk',
  '',
  '1. first',
  '2. second',
  '',
  '> Remember the receipt.',
  '',
  '| Item | Cost |',
  '|------|-----:|',
  '| Nail | 2.50 |',
  '| Screw | 11 |',
  '',
  '```',
  'make -j4',
  '```',
  '',
  '---',
  '',
  'Done.',
].join('\n');
await type(DOC);

ok('the count is of the words, not of the asterisks',
   /\d+ words · \d+ characters of Markdown/.test(await page.textContent('#tally')), await page.textContent('#tally'));

/* ---- copy ---- */

await page.click('#copyBtn');
await page.waitForTimeout(400);
ok('it says it copied', /Copied/.test(await page.textContent('#said')), await page.textContent('#said'));

const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = {};
  for (const item of items) {
    for (const kind of item.types) out[kind] = await (await item.getType(kind)).text();
  }
  return out;
});

ok('the clipboard carries a rich flavour and a plain one',
   !!clip['text/html'] && !!clip['text/plain'], Object.keys(clip).join(', '));

const rich = clip['text/html'] || '';
ok('what is on the clipboard is the preview, formatted',
   /<h1>Shopping<\/h1>/.test(rich) && /<strong>bold<\/strong>/.test(rich) && /<em>italic<\/em>/.test(rich)
   && /<ul>/.test(rich) && /<ol>/.test(rich) && /<table>/.test(rich) && /<blockquote>/.test(rich)
   && /<pre><code>make -j4<\/code><\/pre>/.test(rich), rich.slice(0, 200));
ok('with the nested list still nested and the link still a link',
   /<li>screws\s*<ul>\s*<li>countersunk<\/li>/.test(rich)
   && /<a href="https:\/\/example\.test\/?"/.test(rich), rich.slice(0, 200));
ok('and no markdown punctuation left in it',
   !/\*\*|\]\(|^\s*- /m.test(rich.replace(/<[^>]*>/g, '')), rich.replace(/<[^>]*>/g, '').slice(0, 200));
ok('it carries no colours of its own, so a paste is not white on black',
   !/color:|background|style="(?!text-align)/.test(rich), (rich.match(/style="[^"]*"/g) || []).join(' | '));

// The rich flavour has to be HTML a word processor will take, so it is parsed
// as a document rather than pattern-matched and the headings counted.
const asDoc = await page.evaluate((source) => {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  return {
    h1: [...doc.querySelectorAll('h1')].map(h => h.textContent),
    items: [...doc.querySelectorAll('li')].map(li => li.firstChild.textContent.trim()),
    cells: [...doc.querySelectorAll('td')].map(td => td.textContent),
    quote: doc.querySelector('blockquote')?.textContent.trim(),
  };
}, rich);
ok('a reader parsing it gets the document back whole',
   asDoc.h1[0] === 'Shopping' && asDoc.items.join() === 'nails,screws,countersunk,first,second'
   && asDoc.cells.join() === 'Nail,2.50,Screw,11' && asDoc.quote === 'Remember the receipt.',
   JSON.stringify(asDoc));

const plain = clip['text/plain'] || '';
ok('the plain flavour is the preview flattened, not the markdown',
   plain.startsWith('Shopping') && !/\*\*|^#/m.test(plain) && plain.includes('• nails'),
   JSON.stringify(plain).slice(0, 200));

/* ---- the files ---- */

const grab = async (sel, name) => {
  const wait = page.waitForEvent('download', { timeout: 15000 });
  await page.click(sel);
  const got = await wait;
  const path = `${SCR}/${name}`;
  await got.saveAs(path);
  return { body: fs.readFileSync(path, 'utf8'), file: got.suggestedFilename() };
};

const asMd = await grab('#mdBtn', 'mdrt.md');
ok('the .md is the source exactly as it stands', asMd.body === DOC, JSON.stringify(asMd.body.slice(0, 80)));
ok('and it is named after the first heading', asMd.file === 'Shopping.md', asMd.file);

const asTxt = await grab('#txtBtn', 'mdrt.txt');
const txt = asTxt.body;
ok('the .txt is named the same way', asTxt.file === 'Shopping.txt', asTxt.file);
ok('the .txt is the same text the clipboard carried', txt.trim() === plain.trim(),
   JSON.stringify(txt.slice(0, 120)));
ok('no markdown punctuation survives into it',
   !/\*\*|^#{1,6} |\]\(|^\s*\| /m.test(txt), JSON.stringify(txt.slice(0, 200)));
ok('a nested list is indented under the one above it',
   /• screws\n {2}• countersunk/.test(txt), JSON.stringify(txt));
ok('a numbered list keeps its numbers', /1\. first\n2\. second/.test(txt), JSON.stringify(txt));
ok('a quote is set in from the margin', /^ {4}Remember the receipt\./m.test(txt), JSON.stringify(txt));
ok('a code block is set in too', /^ {4}make -j4$/m.test(txt), JSON.stringify(txt));
ok('a link keeps its address beside the words',
   txt.includes('link (https://example.test)'), JSON.stringify(txt));
// A table read out one cell per line is not a table any more.
const table = txt.split('\n').filter(l => /Nail|Screw|^Item/.test(l));
ok('the table is lined up in columns',
   table.join('\n') === 'Item   Cost\nNail   2.50\nScrew  11', JSON.stringify(table));

/* ---- scrolling, which is the thing a split preview is for ---- */

await type(Array.from({ length: 160 }, (_, i) => `Line number ${i} of the long document.`).join('\n\n'));
await page.waitForTimeout(200);
await page.$eval('#src', s => { s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(250);
const where = await page.evaluate(() => ({
  src: src.scrollTop / (src.scrollHeight - src.clientHeight),
  out: out.scrollTop / (out.scrollHeight - out.clientHeight),
}));
ok('the preview follows the editor down the document',
   where.out > 0.9 && Math.abs(where.src - where.out) < 0.05, JSON.stringify(where));
await page.$eval('#out', o => { o.scrollTop = 0; o.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(300);
ok('and the editor follows the preview back up',
   await page.$eval('#src', s => s.scrollTop) < 40, await page.$eval('#src', s => s.scrollTop));

/* ---- the two halves fill the window rather than growing the page ---- */

await type(DOC);
await page.waitForTimeout(200);
const room = await page.evaluate(() => ({
  fits: document.documentElement.scrollHeight <= innerHeight + 2,
  wide: document.documentElement.scrollWidth > innerWidth,
  panes: Math.round(document.querySelector('.panes').getBoundingClientRect().height),
}));
ok('at a laptop size the whole page fits, panes and all', room.fits && !room.wide && room.panes > 300,
   JSON.stringify(room));

/* ---- nothing to copy is said rather than silently doing nothing ---- */

await type('');
await page.click('#copyBtn');
await page.waitForTimeout(200);
ok('an empty page says there is nothing to copy', /Nothing to copy/.test(await page.textContent('#said')),
   await page.textContent('#said'));

/* ---- it works opened off the filesystem, where there is no clipboard API ---- */

const file = await browser.newPage();
const fileErrs = [];
file.on('pageerror', e => fileErrs.push(e.message));
await file.goto('file://' + process.cwd().replace(/\/tests$/, '') + '/markdown-to-rich-text.html');
await file.fill('#src', '# Off the filesystem\n\n- it still renders');
await file.waitForTimeout(250);
ok('opened as a file it still renders',
   /<h1>Off the filesystem<\/h1>/.test(await file.$eval('#out', o => o.innerHTML)) && !fileErrs.length,
   JSON.stringify(fileErrs));
await file.click('#copyBtn');
await file.waitForTimeout(300);
ok('and copying either works or says it could not, rather than failing silently',
   /Copied|would not let/.test(await file.textContent('#said')), await file.textContent('#said'));
await file.close();

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');

await type(DOC);
await page.waitForTimeout(250);
await page.screenshot({ path: SCR + '/mdrt.png' });
await browser.close();
