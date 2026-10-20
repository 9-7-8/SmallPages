import { chromium, CHROMIUM_BIN, WORK, REPO } from './lib/env.mjs';
import fs from 'node:fs';
const SP = WORK + '';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + m); };

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:8099/index.html');

const info = await page.evaluate(() => {
  const lis = [...document.querySelectorAll('nav li')];
  return {
    count: lis.length,
    names: lis.map(l => l.querySelector('.name').textContent),
    hrefs: lis.map(l => l.querySelector('a').getAttribute('href')),
    groups: [...document.querySelectorAll('nav section')].map(s => ({
      title: s.querySelector('h2')?.textContent || '',
      gloss: s.querySelector('.gloss')?.textContent || '',
      names: [...s.querySelectorAll('li .name')].map(n => n.textContent),
    })),
    loose: [...document.querySelectorAll('nav li')].filter(li => !li.closest('section')).length,
    broken: lis.filter(li => {
      const u = li.querySelector('use');
      return !u || !document.getElementById(u.getAttribute('href').slice(1));
    }).map(li => li.querySelector('.name').textContent),
    sizes: [...new Set(lis.map(li => { const r = li.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }))],
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
});

const key = (n) => n.replace(/[←-⇿]/g, ' ').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Grouped by what the page is for, alphabetical inside each group.
ok(info.groups.length > 1, `${info.groups.length} groups`);
ok(info.loose === 0, info.loose ? `${info.loose} tiles are in no group` : 'every tile is in a group');
for (const g of info.groups) {
  const keys = g.names.map(key);
  const sorted = [...keys].sort();
  const bad = keys.findIndex((k, i) => k !== sorted[i]);
  ok(bad === -1, bad === -1
    ? `${g.title} (${g.names.length}) is in alphabetical order`
    : `${g.title} is out of order at ${keys[bad]} (expected ${sorted[bad]})`);
  ok(/^[A-Z]/.test(g.title) && g.gloss.length > 10,
    `${g.title} says what it is: ${JSON.stringify(g.gloss)}`);
}

/* Every page in the repo has a tile, so adding one and forgetting to list it
   is caught here rather than by nobody ever finding it. The three that are
   deliberately unlisted are named, because each is somebody's own page rather
   than a tool: a friend map, and two Minecraft write-ups that live in the
   handbook. */
const UNLISTED = new Set(['index.html', 'friends-interests.html',
  'minecraft-keybinds.html', 'minecraft-server-guide.html']);
const onDisk = fs.readdirSync(REPO).filter(f => f.endsWith('.html') && !UNLISTED.has(f));
const listed = new Set(info.hrefs);
const unlisted = onDisk.filter(f => !listed.has(f));
const dangling = info.hrefs.filter(h => !fs.existsSync(REPO + '/' + h));
ok(unlisted.length === 0, unlisted.length ? 'no tile for: ' + unlisted.join(', ') : `all ${onDisk.length} pages have a tile`);
ok(dangling.length === 0, dangling.length ? 'tiles point at nothing: ' + dangling.join(', ') : 'every tile points at a page that exists');
ok(listed.size === info.hrefs.length, 'no page is listed twice');
ok(info.broken.length === 0, 'every tile icon resolves' + (info.broken.length ? ': ' + info.broken : ''));
ok(info.sizes.length === 1, 'tiles are one size: ' + info.sizes.join(' '));
ok(!info.overflow, 'no horizontal overflow');

const i = info.names.indexOf('PDF Builder');
ok(i !== -1, 'PDF Builder has a tile');
ok(info.hrefs[i] === 'pdf-builder.html', 'it points at pdf-builder.html');
const paper = info.groups.find(g => g.title === 'Paper');
ok(!!paper && paper.names.includes('PDF Builder'), 'it is filed under Paper');
ok(!!paper && paper.names.join(' | ') === 'Document Viewer | Images → Searchable PDF | PDF Builder | Tile PDF Pages',
   `Paper holds ${paper ? paper.names.join(', ') : 'nothing'}`);

const res = await page.goto('http://127.0.0.1:8099/pdf-builder.html');
ok(res.status() === 200, 'the link resolves (' + res.status() + ')');
const h1 = await page.locator('h1').textContent();
ok(h1.trim() === 'PDF Builder', 'the page says ' + h1.trim());

await page.goto('http://127.0.0.1:8099/index.html');
await page.locator('nav li', { hasText: 'PDF Builder' }).screenshot({ path: SP + '/tile-pdfb.png' });
await page.evaluate(() => {
  const s = document.createElement('div');
  s.style.cssText = 'position:fixed;inset:0;background:#000;display:grid;place-items:center;z-index:9';
  s.innerHTML = '<svg width="320" height="320" viewBox="0 0 24 24" style="color:#fff;stroke:currentColor;stroke-width:1.25;fill:none;stroke-linecap:square;stroke-linejoin:miter"><use href="#i-stack"/></svg>';
  document.body.appendChild(s);
});
await page.screenshot({ path: SP + '/icon-stack.png', clip: { x: 440, y: 740, width: 320, height: 320 } });

ok(errs.length === 0, errs.length ? 'page errors: ' + errs.join(' | ') : 'no page errors');
console.log(`\n${info.count} tiles · ${pass} passing, ${fail} failing`);
await browser.close();
process.exit(fail ? 1 : 0);
