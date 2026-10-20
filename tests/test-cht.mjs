import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/combat-health-tracker.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
await page.goto(URL);

const snap = () => page.evaluate(() => ({
  hp: document.getElementById('hp').value,
  state: document.getElementById('state').textContent,
  maxNote: document.getElementById('maxNote').textContent,
  barOn: document.getElementById('bar').classList.contains('on'),
  barWidth: document.getElementById('barFill').style.width,
  body: document.body.className,
  log: [...document.querySelectorAll('.entry')].map(e => e.querySelector('.what').textContent + ' | ' + e.querySelector('.delta').textContent),
  empty: document.querySelector('.empty')?.textContent || null,
}));

const ok = (name, cond, extra='') => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  <<< ' + extra));

let s = await snap();
ok('starts at 0', s.hp === '0', s.hp);
ok('starts Down', s.state === 'Down', s.state);
ok('empty log message', s.empty === 'Nothing has happened yet.', JSON.stringify(s.empty));
ok('no bar without max', !s.barOn, s.barOn);
ok('flat-number note', s.maxNote === 'empty counts in flat numbers', s.maxNote);

// damage at zero records nothing
await page.click('#hurtOne');
s = await snap();
ok('damage at zero stays 0', s.hp === '0', s.hp);
ok('damage at zero logs nothing', s.log.length === 0, JSON.stringify(s.log));

// heal one
await page.click('#healOne');
s = await snap();
ok('heal 1 -> 1', s.hp === '1', s.hp);
ok('heal 1 logged', s.log[0] === 'Healed 1 | 0 → 1', JSON.stringify(s.log[0]));
ok('1 hp is Bloodied flat', s.state === 'Bloodied', s.state);
ok('hurt class on body', /hurt/.test(s.body), s.body);

// type straight in
await page.fill('#hp', '25');
await page.locator('#hp').press('Tab');
s = await snap();
ok('typed 25', s.hp === '25', s.hp);
ok('set logged once', s.log[0] === 'Set to 25 | 1 → 25', JSON.stringify(s.log[0]));
ok('no stop at 2', !s.log.some(l => /→ 2$/.test(l)), JSON.stringify(s.log));
ok('25 flat is Wounded', s.state === 'Wounded', s.state);

// custom amount
await page.fill('#amount', '7');
await page.click('#hurtBy');
s = await snap();
ok('damage by 7', s.hp === '18', s.hp);
ok('damage by 7 logged', s.log[0] === 'Took 7 | 25 → 18', JSON.stringify(s.log[0]));

await page.click('#healBy');
s = await snap();
ok('heal by 7', s.hp === '25', s.hp);

// clamp logging: 3 hp, hit for 10
await page.fill('#hp', '3');
await page.locator('#hp').press('Tab');
await page.fill('#amount', '10');
await page.click('#hurtBy');
s = await snap();
ok('clamps at zero', s.hp === '0', s.hp);
ok('clamp logs 3 -> 0 not 10 -> 0', s.log[0] === 'Took 3 | 3 → 0', JSON.stringify(s.log[0]));
ok('zero is Down', s.state === 'Down', s.state);
ok('down class', /down/.test(s.body) && !/hurt/.test(s.body), s.body);

// enter / shift+enter
await page.fill('#amount', '4');
await page.locator('#amount').press('Enter');
s = await snap();
ok('Enter heals', s.hp === '4', s.hp);
await page.locator('#amount').press('Shift+Enter');
s = await snap();
ok('Shift+Enter damages', s.hp === '0', s.hp);

// maximum and proportional states
await page.fill('#hp', '40');
await page.locator('#hp').press('Tab');
await page.fill('#maxHp', '40');
s = await snap();
ok('bar appears with max', s.barOn, s.barOn);
ok('bar full at max', s.barWidth === '100%', s.barWidth);
ok('full is Untouched', s.state === 'Untouched', s.state);
ok('max note counts', s.maxNote === '40 of 40', s.maxNote);

for (const [hp, want, width] of [[30,'Steady','75%'],[29,'Wounded','72.5%'],[20,'Bloodied','50%'],[21,'Wounded','52.5%'],[1,'Bloodied','2.5%'],[0,'Down','0%']]) {
  await page.fill('#hp', String(hp));
  await page.locator('#hp').press('Tab');
  s = await snap();
  ok(`hp ${hp}/40 is ${want}`, s.state === want, s.state);
  ok(`bar ${hp}/40 is ${width}`, s.barWidth === width, s.barWidth);
}

// back to full
await page.click('#fullBtn');
s = await snap();
ok('back to full', s.hp === '40', s.hp);
ok('back to full logged', s.log[0] === 'Healed 40 | 0 → 40', JSON.stringify(s.log[0]));

// overheal above max
await page.fill('#amount', '5');
await page.click('#healBy');
s = await snap();
ok('can overheal past max', s.hp === '45', s.hp);
ok('bar clamps at 100%', s.barWidth === '100%', s.barWidth);
ok('overheal still Untouched', s.state === 'Untouched', s.state);

// reset
await page.click('#resetBtn');
s = await snap();
ok('reset to zero', s.hp === '0', s.hp);
ok('reset logged', s.log[0] === "Set to 0 | 45 → 0", JSON.stringify(s.log[0]));

// persistence
const before = await snap();
const stored = await page.evaluate(() => localStorage.getItem('combat-health-tracker'));
ok('storage is JSON not markup', !/</.test(stored), stored?.slice(0,80));
await page.reload();
s = await snap();
ok('hp survives reload', s.hp === before.hp, s.hp);
ok('max survives reload', await page.inputValue('#maxHp') === '40', await page.inputValue('#maxHp'));
ok('amount survives reload', await page.inputValue('#amount') === '5', await page.inputValue('#amount'));
ok('log survives reload', JSON.stringify(s.log) === JSON.stringify(before.log), JSON.stringify(s.log.slice(0,2)));

// cap at 50
await page.evaluate(async () => {
  for (let i = 0; i < 60; i++) document.getElementById('healOne').click();
});
s = await snap();
ok('log capped at 50 on screen', s.log.length === 50, s.log.length);
const held = await page.evaluate(() => JSON.parse(localStorage.getItem('combat-health-tracker')).entries.length);
ok('log capped at 50 in storage', held === 50, held);

// clear log keeps hp
const hpNow = s.hp;
await page.click('#clearBtn');
s = await snap();
ok('clear empties log', s.log.length === 0 && s.empty === 'Nothing has happened yet.', JSON.stringify(s.log.length));
ok('clear keeps hp', s.hp === hpNow, s.hp);

// clearing the maximum
await page.fill('#maxHp', '');
s = await snap();
ok('clearing max hides bar', !s.barOn, s.barOn);
ok('clearing max returns flat note', s.maxNote === 'empty counts in flat numbers', s.maxNote);

// garbage in the number box
await page.fill('#hp', '-5');
await page.locator('#hp').press('Tab');
s = await snap();
ok('negative typed clamps to 0', s.hp === '0', s.hp);

// corrupt storage
await page.evaluate(() => localStorage.setItem('combat-health-tracker', '{"hp":"<img src=x>","entries":"nope"}'));
await page.reload();
s = await snap();
ok('survives junk storage', s.hp === '0' && s.log.length === 0, JSON.stringify(s));

// overflow of the log area
await page.evaluate(() => localStorage.clear());
await page.reload();
const box = await page.evaluate(() => {
  const l = document.getElementById('log');
  return { scrolls: getComputedStyle(l).overflow, maxH: getComputedStyle(l).maxHeight };
});
ok('log scrolls rather than grows', box.maxH === '320px', JSON.stringify(box));

await page.screenshot({ path: WORK + '/cht-wide.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 1500 });
await page.fill('#hp', '17');
await page.locator('#hp').press('Tab');
await page.fill('#maxHp', '30');
await page.screenshot({ path: WORK + '/cht-narrow.png', fullPage: true });
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok('no horizontal scroll at 390px', !over, 'scrollWidth overflow');

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
