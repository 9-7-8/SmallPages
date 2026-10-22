/* The stopwatch. What is worth checking here is not that a counter counts:
   it is that the reading is the wall clock's answer rather than a tally of
   frames, that a lap is both figures and they agree with each other, and that
   closing the tab does not stop it. */
import { chromium, CHROMIUM_BIN } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/stopwatch.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1200 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) pass++; else fail++;
  console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
};

await page.goto(URL);
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload();
await page.waitForTimeout(150);

const read = () => page.locator('#read').textContent();

/* ------------------------------------------------------------ the figures -- */

ok('it opens at nought', await read() === '00:00.00', await read());
ok('and says so', (await page.locator('#status').textContent()).includes('Nothing timed'),
  await page.locator('#status').textContent());

/* Hundredths are cut, not rounded: a stopwatch that reads 10.00 before ten
   seconds have passed is lying, and every real one cuts. */
const shaped = await page.evaluate(() => ({
  nearly: clockOf(999),
  justOver: clockOf(1001),
  under: clockOf(1999),
  minute: clockOf(60000),
  hour: clockOf(3600000),
  longer: clockOf(3600000 + 125 * 1000 + 450),
}));
ok('a hundredth short of a second is not a second', shaped.nearly === '00:00.99', shaped.nearly);
ok('and a thousandth over one is', shaped.justOver === '00:01.00', shaped.justOver);
ok('1.999 seconds reads 1.99, not 2.00', shaped.under === '00:01.99', shaped.under);
ok('a minute is 01:00.00', shaped.minute === '01:00.00', shaped.minute);
ok('the hour appears only once it is reached', shaped.hour === '1:00:00.00', shaped.hour);
ok('and carries the rest with it', shaped.longer === '1:02:05.45', shaped.longer);

/* --------------------------------------------------------- against the clock -- */

const began = Date.now();
await page.click('#goBtn');
await page.waitForTimeout(900);
const [shown, real] = [await read(), Date.now() - began];
const asMs = (str) => {
  const m = /^(?:(\d+):)?(\d\d):(\d\d)\.(\d\d)$/.exec(str);
  return ((Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 10;
};
ok('what it shows is what the clock says', Math.abs(asMs(shown) - real) < 150,
  `${shown} against ${real} ms of wall clock`);
ok('the box lights while it runs',
  (await page.locator('#face').getAttribute('class')).includes('live'),
  await page.locator('#face').getAttribute('class'));
ok('and the tab title carries the time',
  /\d\d:\d\d · Stopwatch/.test(await page.title()), await page.title());

/* -------------------------------------------------------------- the laps -- */

for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(260 + i * 180);
  await page.click('#lapBtn');
}
await page.click('#goBtn');                            // stop, so nothing moves under us
await page.waitForTimeout(120);

const laps = await page.evaluate(() => ({
  splits: laps.slice(),
  times: laps.map((at, i) => at - (i ? laps[i - 1] : 0)),
  table: [...document.querySelectorAll('#laps tr')].slice(1).map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.textContent)),
  bars: document.querySelectorAll('#bars .row').length,
  figures: document.getElementById('figures').textContent,
}));

ok('three laps are three laps', laps.splits.length === 3, laps.splits.length);
ok('and they only ever go forwards',
  laps.splits.every((at, i) => i === 0 || at > laps.splits[i - 1]), JSON.stringify(laps.splits));
ok('the lap times add up to the splits',
  laps.times.every((t, i) => Math.abs(laps.times.slice(0, i + 1).reduce((a, b) => a + b, 0)
    - laps.splits[i]) < 0.001), JSON.stringify(laps.times));
ok('the newest lap is at the top',
  laps.table[0][0] === '3' && laps.table[2][0] === '1',
  JSON.stringify(laps.table.map(r => r[0])));
ok('each row carries its lap time and its split',
  laps.table.every(row => /^\d?\d?:?\d\d:\d\d\.\d\d$/.test(row[1]) && /\d\d\.\d\d$/.test(row[2])),
  JSON.stringify(laps.table));

/* The quickest and the slowest are marked once there are three to compare,
   and the marks have to be on the right rows rather than on any two. */
const times = laps.times;
const quickest = times.indexOf(Math.min(...times));
const slowest = times.indexOf(Math.max(...times));
const marked = await page.evaluate(() => [...document.querySelectorAll('#laps tr')].slice(1)
  .map(tr => ({ no: tr.querySelector('td').textContent, mark: tr.querySelector('.mark').textContent })));
ok('the quickest lap is marked quickest',
  marked.find(r => r.no === String(quickest + 1)).mark === 'quickest', JSON.stringify(marked));
ok('and the slowest slowest',
  marked.find(r => r.no === String(slowest + 1)).mark === 'slowest', JSON.stringify(marked));
ok('one bar per lap', laps.bars === 3, laps.bars);

/* The figures under the laps are of the laps, worked out here rather than
   read back off the page that printed them. */
const sorted = [...times].sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const cs = (ms) => {
  const t = Math.floor(Math.max(0, ms) / 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 6000))}:${p(Math.floor(t / 100) % 60)}.${p(t % 100)}`;
};
ok('the mean of the laps is the mean of the laps',
  laps.figures.includes(`mean ${cs(mean)}`), `${laps.figures} wanted mean ${cs(mean)}`);
ok('and the median the middle one',
  laps.figures.includes(`median ${cs(sorted[1])}`), `${laps.figures} wanted median ${cs(sorted[1])}`);
ok('and the total the last split',
  laps.figures.includes(`total ${cs(laps.splits[2])}`), laps.figures);

/* --------------------------------------------------------------- copying -- */

await page.click('#copyBtn');
await page.waitForTimeout(150);
const copied = await page.evaluate(() => navigator.clipboard.readText());
const lines = copied.trim().split('\n');
ok('copy writes a header and a line a lap', lines.length === 4, JSON.stringify(lines));
ok('with the milliseconds alongside the figures',
  lines[1].split('\t').length === 5 && Number(lines[1].split('\t')[4]) === Math.round(laps.splits[0]),
  JSON.stringify(lines[1]));

/* ------------------------------------------------- a reload does not stop it -- */

await page.click('#goBtn');                            // running again
await page.waitForTimeout(400);
const before = asMs(await read());
await page.reload();
await page.waitForTimeout(350);
const after = asMs(await read());
ok('a reload finds it still running', after > before,
  `${before} ms before the reload, ${after} after`);
ok('and it says where it came from',
  (await page.locator('#status').textContent()).includes('Still running'),
  await page.locator('#status').textContent());
ok('with the laps still there',
  await page.evaluate(() => laps.length) === 3, await page.evaluate(() => laps.length));

/* ---------------------------------------------------------------- resetting -- */

await page.click('#resetBtn');
await page.waitForTimeout(120);
ok('the first reset stops it rather than clearing it',
  await page.evaluate(() => !running && laps.length === 3 && acc > 0),
  await page.evaluate(() => ({ running, laps: laps.length, acc })));
await page.click('#resetBtn');
await page.waitForTimeout(120);
ok('the second clears it', await read() === '00:00.00' && await page.evaluate(() => laps.length) === 0,
  await read());

/* ------------------------------------------------------------ on a phone -- */

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
await page.click('#goBtn');
await page.waitForTimeout(300);
ok('no sideways scroll at 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
/* The digits are sized to their own width rather than to the page, so the
   case that matters is the longest reading there is: an hour on a phone. */
await page.click('#goBtn');
const boxed = await page.evaluate(() => {
  acc = 3600000 + 125 * 1000 + 450;
  shownRest = '';
  paint();
  const read = document.getElementById('read').getBoundingClientRect();
  const face = document.getElementById('face').getBoundingClientRect();
  return { shown: document.getElementById('read').textContent,
           read: [read.left, read.right], face: [face.left, face.right] };
});
ok('and an hour-long reading still fits the box on a phone',
  boxed.shown === '1:02:05.45'
  && boxed.read[0] >= boxed.face[0] - 1 && boxed.read[1] <= boxed.face[1] + 1,
  JSON.stringify(boxed));

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passing, ${fail} failing`);
await browser.close();
process.exit(fail ? 1 : 0);
