/* The countdown. Two different things live on this page — a timer you start
   and a date that arrives whether you do anything or not — and most of what
   is worth checking is that they stay two different things: that what is left
   is a subtraction from the clock rather than a tally, that zero is zero
   rather than a hair either side of it, and that past zero it says so. */
import { chromium, CHROMIUM_BIN } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/countdown.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1200 } });
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
const where = () => page.locator('#where').textContent();

/* ------------------------------------------------------------- the figures -- */

/* A countdown rounds up and an overrun rounds down, which is the same rule
   twice: the figure shown is the whole seconds you still have, or the whole
   seconds you are already past. */
const shaped = await page.evaluate(() => ({
  exact: clockOf(60000),
  nearly: clockOf(59001),
  sliver: clockOf(1),
  zero: clockOf(0),
  justPast: clockOf(-1),
  past: clockOf(-60000),
  hour: clockOf(3600000),
  day: clockOf(86400000 + 3600000 + 125000),
}));
ok('a minute reads 01:00', shaped.exact === '01:00', shaped.exact);
ok('and anything inside the last second of it rounds up', shaped.nearly === '01:00', shaped.nearly);
ok('a millisecond left still shows a second', shaped.sliver === '00:01', shaped.sliver);
ok('and nought shows nought', shaped.zero === '00:00', shaped.zero);
ok('a millisecond past nought is not yet a second past', shaped.justPast === '+00:00', shaped.justPast);
ok('a minute past is', shaped.past === '+01:00', shaped.past);
ok('the hour appears when it is reached', shaped.hour === '1:00:00', shaped.hour);
ok('and the days with it', shaped.day === '1d 01:02:05', shaped.day);

/* ------------------------------------------------------------- a length -- */

ok('it opens on the length in the boxes', await read() === '10:00', await read());
await page.click('[data-secs="300"]');
await page.waitForTimeout(100);
ok('a preset sets the boxes and the figure', await read() === '05:00', await read());

const began = Date.now();
await page.click('#goBtn');
await page.waitForTimeout(1200);
const left = await read();
const [m, sec] = left.split(':').map(Number);
const gone = 300 - (m * 60 + sec);
ok('what is left is what the clock says has gone',
  Math.abs(gone * 1000 - (Date.now() - began)) < 1200, `${left} after ${Date.now() - began} ms`);
ok('the box lights while it runs',
  (await page.locator('#face').getAttribute('class')).includes('live'),
  await page.locator('#face').getAttribute('class'));
ok('and it says when it ends', /^ends at \d\d:\d\d$/.test(await where()), await where());

await page.click('#goBtn');
await page.waitForTimeout(150);
const held = await read();
await page.waitForTimeout(500);
ok('pausing holds the figure still', await read() === held, `${held} became ${await read()}`);
ok('and says so', await where() === 'paused', await where());
ok('the button offers to resume', await page.locator('#goBtn').textContent() === 'Resume',
  await page.locator('#goBtn').textContent());

/* ------------------------------------------------------------ past nought -- */

await page.click('#resetBtn');
await page.fill('#minsIn', '0');
await page.fill('#secsIn', '2');
await page.evaluate(() => { volIn.value = '0'; volIn.dispatchEvent(new Event('input')); });
await page.waitForTimeout(100);
ok('reset puts the length back', await read() === '00:02', await read());
await page.click('#goBtn');
await page.waitForTimeout(3400);
const over = await read();
ok('past nought it counts up with a plus', /^\+00:0[12]$/.test(over), over);
ok('and the box says so',
  (await page.locator('#face').getAttribute('class')).includes('over'),
  await page.locator('#face').getAttribute('class'));
ok('with a word for it', (await page.locator('#status').textContent()) === 'Time.',
  await page.locator('#status').textContent());

/* Turned off, nought is where it stops. */
await page.click('#resetBtn');
await page.uncheck('#pastIn');
await page.click('#goBtn');
await page.waitForTimeout(3200);
ok('told not to, it stops dead on nought', await read() === '00:00', await read());
ok('and the box is not an alarm',
  !(await page.locator('#face').getAttribute('class')).includes('over'),
  await page.locator('#face').getAttribute('class'));
await page.check('#pastIn');

/* --------------------------------------------------------------- a date -- */

await page.click('[data-mode="date"]');
await page.waitForTimeout(150);
ok('there is nothing to start in date mode', await page.locator('#goBtn').isHidden(), 'start is still there');
ok('and reset becomes clear', (await page.locator('#resetBtn').textContent()).includes('Clear'),
  await page.locator('#resetBtn').textContent());

const target = await page.evaluate(() => {
  const at = new Date(Date.now() + 90 * 60 * 1000);
  at.setSeconds(0, 0);
  const p = (n) => String(n).padStart(2, '0');
  const value = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
    + `T${p(at.getHours())}:${p(at.getMinutes())}:00`;
  dateIn.value = value;
  dateIn.dispatchEvent(new Event('input'));
  return { value, at: at.getTime() };
});
await page.waitForTimeout(300);
const toGo = await read();
const want = Math.ceil((target.at - Date.now()) / 1000);
const got = toGo.split(':').map(Number);
ok('a date an hour and a half off reads an hour and a half',
  Math.abs((got[0] * 3600 + got[1] * 60 + got[2]) - want) <= 2, `${toGo} against ${want} s`);
ok('and the line underneath names the moment, in full',
  /\w{3}, \d+ \w{3} \d{4}, \d\d:\d\d — 1 hour, 2\d minutes to go/.test(await where()), await where());
ok('it runs without being started',
  await page.evaluate(() => !running), 'the date mode started the length timer');

/* A date already behind you is overtime, straight away, which is what
   "Monday, 9am" on a Monday afternoon has to read. */
await page.evaluate(() => {
  const at = new Date(Date.now() - 3 * 86400 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  dateIn.value = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
    + `T${p(at.getHours())}:${p(at.getMinutes())}:00`;
  dateIn.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(250);
ok('a date behind you reads as overtime', (await read()).startsWith('+3d'), await read());
ok('and says how long ago', /ago$/.test(await where()), await where());

/* The presets land where they say. End of today is the next midnight. */
await page.click('[data-when="midnight"]');
await page.waitForTimeout(200);
const midnight = await page.evaluate(() => {
  const at = new Date(dateIn.value);
  const wanted = new Date();
  wanted.setHours(24, 0, 0, 0);
  return { got: at.getTime(), wanted: wanted.getTime(), shown: dateIn.value };
});
ok('end of today is the next midnight', midnight.got === midnight.wanted, JSON.stringify(midnight));
await page.click('[data-when="year"]');
await page.waitForTimeout(200);
ok('and new year is the first of January',
  await page.evaluate(() => {
    const at = new Date(dateIn.value);
    return at.getMonth() === 0 && at.getDate() === 1 && at.getHours() === 0
      && at.getFullYear() === new Date().getFullYear() + 1;
  }), await page.evaluate(() => dateIn.value));

await page.click('#resetBtn');
await page.waitForTimeout(150);
ok('clearing the date leaves nothing counting', await read() === '00:00' && await where() === 'No date set yet.',
  `${await read()} · ${await where()}`);

/* ------------------------------------------------- a reload does not stop it -- */

await page.click('[data-mode="length"]');
await page.fill('#hoursIn', '0');
await page.fill('#minsIn', '20');
await page.fill('#secsIn', '0');
await page.click('#goBtn');
await page.waitForTimeout(1100);
const beforeReload = await read();
await page.reload();
await page.waitForTimeout(400);
ok('a reload finds a length still running',
  await page.evaluate(() => running) && await read() <= beforeReload,
  `${beforeReload} became ${await read()}`);
ok('and it says where it came from',
  (await page.locator('#status').textContent()).includes('Still running'),
  await page.locator('#status').textContent());

/* ------------------------------------------------------------ on a phone -- */

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
ok('no sideways scroll at 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));

/* The longest reading there is — days, hours, minutes and seconds — on the
   narrowest screen there is. */
const boxed = await page.evaluate(() => {
  running = false;
  left = 86400000 * 12 + 3600000 * 4 + 125000;
  shownRest = '';
  paint();
  const read = document.getElementById('read').getBoundingClientRect();
  const face = document.getElementById('face').getBoundingClientRect();
  return { shown: document.getElementById('read').textContent.replace(/\u00a0/g, ' '),
           read: [read.left, read.right], face: [face.left, face.right] };
});
ok('and a reading in days still fits the box',
  boxed.shown === '12d 04:02:05'
  && boxed.read[0] >= boxed.face[0] - 1 && boxed.read[1] <= boxed.face[1] + 1,
  JSON.stringify(boxed));

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passing, ${fail} failing`);
await browser.close();
process.exit(fail ? 1 : 0);
