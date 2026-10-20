import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const URL = 'http://127.0.0.1:8099/captions-to-transcript.html';
const MINE = 'http://127.0.0.1:8787/fetch?key=testkey123&url={url}';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  // Chrome gates a public page reaching 127.0.0.1 behind a prompt nobody is
  // here to click; the relay itself still has to answer for the test to pass.
  args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks"] });
const ctx = await browser.newContext({ viewport: { width: 1250, height: 1300 } });
const page = await ctx.newPage();
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto(URL);
ok('starts empty with the generic hint', (await page.inputValue('#relayIn')) === ''
   && /public ones come and go/.test(await page.textContent('#relayNote')), await page.textContent('#relayNote'));

await page.fill('#relayIn', MINE);
await page.waitForTimeout(200);
ok('says it is kept once set', /kept in this browser only/.test(await page.textContent('#relayNote')),
   await page.textContent('#relayNote'));

await page.reload();
ok('survives a reload', (await page.inputValue('#relayIn')) === MINE, await page.inputValue('#relayIn'));
ok('and still says so', /kept in this browser only/.test(await page.textContent('#relayNote')), '');

// A fresh tab in the same browser profile sees it; a different profile does not.
const other = await ctx.newPage(); await other.goto(URL);
ok('another tab in the same browser has it', (await other.inputValue('#relayIn')) === MINE, await other.inputValue('#relayIn'));
await other.close();
const stranger = await browser.newContext();
const sp = await stranger.newPage(); await sp.goto(URL);
ok('a different browser profile does not', (await sp.inputValue('#relayIn')) === '', await sp.inputValue('#relayIn'));
await stranger.close();

// It is actually used, and first.
await page.fill('#linkIn', 'https://www.youtube.com/watch?v=TEST');
await page.click('#fetchBtn');
await page.waitForFunction(() => /captions read|Couldn/.test(document.getElementById('status').textContent), null, { timeout: 240000 });
const steps = await page.$$eval('#trail li', ls => ls.map(l => l.querySelector('.via').textContent + ' | ' + l.querySelector('.said').textContent));
const subsAt = steps.findIndex(s => /your relay's yt-dlp/.test(s));
const directAt = steps.findIndex(s => /· direct/.test(s));
const mineAt = steps.findIndex(s => /watch page · your relay/.test(s));
ok('the relay\'s own yt-dlp is asked before anything else', subsAt === 0, JSON.stringify(steps));
ok('the kept relay is tried right after direct', mineAt === directAt + 1, JSON.stringify(steps));
// The page-to-relay hop is what this can prove: the relay answered with a
// real status rather than being unreachable. The relay-to-YouTube hop is
// blocked in this container, so it is covered by curl against the stub instead.
ok('the page reaches the kept relay and gets a real answer from it',
   /answered \d{3}|worked —/.test(steps[mineAt]), JSON.stringify(steps[mineAt]));
console.log('      trail:'); for (const s of steps) console.log('        ' + s);

// Emptying the box forgets it.
await page.fill('#relayIn', '');
await page.waitForTimeout(200);
await page.reload();
ok('emptying the box forgets it', (await page.inputValue('#relayIn')) === '', await page.inputValue('#relayIn'));
ok('and nothing is left in storage',
   await page.evaluate(() => { try { return localStorage.getItem('captions-to-transcript.relay'); } catch { return 'threw'; } }) === null, '');

// Storage being unavailable must not break the page.
const blocked = await browser.newContext();
await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
const bp = await blocked.newPage();
const errs = []; bp.on('pageerror', e => errs.push(e.message));
await bp.goto(URL);
await bp.fill('#relayIn', MINE);
await bp.waitForTimeout(200);
ok('a browser that refuses storage still works', errs.length === 0 && (await bp.inputValue('#relayIn')) === MINE,
   JSON.stringify(errs));
await blocked.close();
await browser.close();
