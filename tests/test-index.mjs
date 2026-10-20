import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
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
    broken: lis.filter(li => {
      const u = li.querySelector('use');
      return !u || !document.getElementById(u.getAttribute('href').slice(1));
    }).map(li => li.querySelector('.name').textContent),
    sizes: [...new Set(lis.map(li => { const r = li.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }))],
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
});

const key = (n) => n.replace(/[←-⇿]/g, ' ').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const keys = info.names.map(key);
const sorted = [...keys].sort();
const firstBad = keys.findIndex((k, i) => k !== sorted[i]);
ok(firstBad === -1, firstBad === -1 ? 'tiles are in alphabetical order' : `out of order at ${keys[firstBad]} (expected ${sorted[firstBad]})`);
ok(info.broken.length === 0, 'every tile icon resolves' + (info.broken.length ? ': ' + info.broken : ''));
ok(info.sizes.length === 1, 'tiles are one size: ' + info.sizes.join(' '));
ok(!info.overflow, 'no horizontal overflow');

const i = info.names.indexOf('PDF Builder');
ok(i !== -1, 'PDF Builder has a tile');
ok(info.hrefs[i] === 'pdf-builder.html', 'it points at pdf-builder.html');
ok(info.names[i - 1] === 'Palette → Gem' && info.names[i + 1] === 'Playlist → Audio',
   `it sits between ${info.names[i - 1]} and ${info.names[i + 1]}`);

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
