import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1400 } });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto('http://127.0.0.1:8099/captions-to-transcript.html');

const trail = () => page.$$eval('#trail li', ls => ls.map(l => ({
  via: l.querySelector('.via').textContent, said: l.querySelector('.said').textContent,
  state: l.className, title: l.title, whole: l.textContent })));

const run = async (relay) => {
  await page.fill('#relayIn', relay);
  await page.fill('#linkIn', 'https://www.youtube.com/watch?v=TEST');
  await page.click('#fetchBtn');
  await page.waitForFunction(() => !document.getElementById('fetchBtn').disabled
    && !/Trying each route|checking whether/.test(document.getElementById('status').textContent),
    null, { timeout: 240000 });
  return { status: await page.textContent('#status'), steps: await trail() };
};

// ---- a host that answers but sends no CORS header ----
let r = await run('http://127.0.0.1:8098/nocors?url={url}');
const mine = r.steps.find(s => /your relay/.test(s.via));
ok('a reachable host that refuses CORS is named as such',
   /answered, but refused the browser/.test(mine.said), JSON.stringify(mine));

// ---- a host that is simply not there ----
r = await run('http://127.0.0.1:9/dead?url={url}');
const dead = r.steps.find(s => /your relay/.test(s.via));
ok('an unreachable host is named differently',
   /could not be reached|reach your computer/.test(dead.said), JSON.stringify(dead));
ok('the two diagnoses are actually different strings', mine.said !== dead.said,
   `${mine.said} // ${dead.said}`);

// ---- the hint when every relay is unreachable ----
ok('every relay unreachable prompts a local-cause hint',
   /is blocking them/.test(r.status), r.status);
console.log('      status:', r.status.replace(/\s+/g,' ').slice(0, 220));

// ---- the copied log ----
const log = await page.evaluate(() => logText());
ok('the log separates the route from the reason', /your relay\s{2,}\S/.test(log),
   JSON.stringify(log.split('\n')[2] || ''));
ok('the log carries the link each route was given', /http:\/\/127\.0\.0\.1:9\/dead\?url=https%3A/.test(log),
   JSON.stringify(log.slice(0, 200)));
ok('no two fields run together anywhere in the log', !/[a-z](?:could not|answered|refused|worked)/.test(log),
   JSON.stringify(log));
console.log('      log:'); for (const l of log.split('\n')) console.log('        ' + l.slice(0, 120));

// ---- the on-screen row no longer mashes when selected ----
ok('the row has whitespace between its columns when copied',
   r.steps.every(s => / /.test(s.whole.replace(s.via, '').replace(s.said, '')) || s.whole.includes(s.via + ' ')),
   JSON.stringify(r.steps[0].whole));
ok('each row carries its link as a tooltip', r.steps.filter(s => s.title).length >= 3,
   JSON.stringify(r.steps.map(s => s.title)));

// ---- the copy button works ----
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#copyLog');
await page.waitForTimeout(300);
ok('the copy button reports success', /Log copied/.test(await page.textContent('#status')),
   await page.textContent('#status'));

// ---- a working relay still works ----
r = await run('http://127.0.0.1:8098/relay?url={url}');
ok('a good relay still gets through', /captions read/.test(r.status), r.status);

console.log(await page.evaluate(() => document.getElementById('outText').value.trim()) === 'fetched over the wire and then some'
  ? 'PASS  and the transcript is still right' : 'FAIL  transcript changed');
await browser.close();
