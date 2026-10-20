import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1500 } });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto('http://127.0.0.1:8099/captions-to-transcript.html');

const trail = () => page.$$eval('#trail li', ls => ls.map(l => ({
  via: l.querySelector('.via').textContent, said: l.querySelector('.said').textContent, state: l.className })));

const run = async (relay, link='https://www.youtube.com/watch?v=TEST') => {
  await page.fill('#relayIn', relay);
  await page.fill('#linkIn', link);
  await page.click('#fetchBtn');
  await page.waitForFunction(() => !document.getElementById('fetchBtn').disabled
    && !/Trying each route/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
  return { status: await page.textContent('#status'), steps: await trail() };
};

// ---- a relay that works: the whole path, end to end ----
let r = await run('http://127.0.0.1:8098/relay?url={url}');
ok('captions arrive over the wire', /captions read/.test(r.status), r.status);
const out = await page.inputValue('#outText');
ok('and they are de-duplicated on the way in', out.trim() === 'fetched over the wire and then some', JSON.stringify(out));
ok('direct is tried first and shown failing', /watch page · direct/.test(r.steps[0].via) && r.steps[0].state === 'no', JSON.stringify(r.steps[0]));
ok('the direct failure is named for what it is', /refused the browser|could not be reached/.test(r.steps[0].said), r.steps[0].said);
ok('your relay is tried before the public ones', /your relay/.test(r.steps[1].via), JSON.stringify(r.steps.map(s=>s.via)));
ok('the working route is marked ok with a size', r.steps[1].state === 'ok' && /\d+ bytes/.test(r.steps[1].said), JSON.stringify(r.steps[1]));
ok('the tracks on offer are listed', r.steps.some(s => /tracks offered · 2/.test(s.via) && /en \(auto\)/.test(s.said)),
   JSON.stringify(r.steps.map(s=>s.via+' | '+s.said)));
ok('the preferred language wins over list order', r.steps.some(s => /^en track/.test(s.via)),
   JSON.stringify(r.steps.map(s=>s.via)));
ok('the recipe hides once it worked', await page.isHidden('#recipe'), '');
console.log('      trail:'); for (const s of r.steps) console.log(`        [${s.state}] ${s.via} — ${s.said}`);

// ---- a relay that answers 200 with the captions stripped out ----
r = await run('http://127.0.0.1:8098/stripped?url={url}');
ok('a stripped 200 counts as a failure, not a success',
   r.steps.some(s => /your relay/.test(s.via) && s.state === 'no' && /stripped/.test(s.said)),
   JSON.stringify(r.steps.filter(s=>/your relay/.test(s.via))));
ok('and the next routes still get their turn', r.steps.filter(s => /allorigins|codetabs/.test(s.via)).length === 3,
   JSON.stringify(r.steps.map(s=>s.via)));
ok('the summary counts the routes rather than blaming the last',
   /\d+ routes tried/.test(r.status) && !/corsproxy/.test(r.status), r.status);
ok('the recipe comes back when it fails', await page.isVisible('#recipe'), '');
console.log('      status:', r.status);
console.log('      trail:'); for (const s of r.steps) console.log(`        [${s.state}] ${s.via} — ${s.said}`);

// ---- a relay that errors outright ----
r = await run('http://127.0.0.1:8098/teapot?url={url}');
ok('an HTTP error is reported with its status',
   r.steps.some(s => /your relay/.test(s.via) && /answered 418/.test(s.said)),
   JSON.stringify(r.steps.filter(s=>/your relay/.test(s.via))));

// ---- no custom relay: every public route named and failing ----
r = await run('');
const vias = r.steps.map(s => s.via);
ok('corsproxy.io is gone from the list', !vias.some(v => /corsproxy/.test(v)), JSON.stringify(vias));
ok('all four default routes are tried and listed', vias.length === 4
   && /direct/.test(vias[0]) && /allorigins/.test(vias[1]) && /codetabs/.test(vias[2]) && /wrapped/.test(vias[3]),
   JSON.stringify(vias));
ok('each has its own reason', r.steps.every(s => s.state === 'no' && s.said.length > 5), JSON.stringify(r.steps.map(s=>s.said)));
console.log('      trail:'); for (const s of r.steps) console.log(`        [${s.state}] ${s.via} — ${s.said}`);

await page.fill('#relayIn', 'http://127.0.0.1:8098/relay?url={url}');
await page.fill('#linkIn', 'https://www.youtube.com/watch?v=TEST');
await page.click('#fetchBtn');
await page.waitForFunction(() => /captions read/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
await page.screenshot({ path: SCR + '/caps-fetch.png', fullPage: true });
await browser.close();
