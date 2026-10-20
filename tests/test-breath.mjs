import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const URL = 'http://127.0.0.1:8099/noise-machine.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1250, height: 1600 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto(URL);

/* ---- the lanes ---- */
ok('nine lanes now', (await page.$$('.lane')).length === 9, (await page.$$('.lane')).length);
ok('breathing and purring are separate lanes',
   await page.$('#lvl-breath') !== null && await page.$('#lvl-purr') !== null, '');
ok('six creatures', (await page.$$('#beastChips button')).length === 6, (await page.$$('#beastChips button')).length);

/* ---- the envelope, against the shape the source describes ---- */
const env = (inhale, seconds) => page.evaluate(
  (o) => Array.from(breathEnvelope(o.inhale, o.seconds, 1)), { inhale, seconds });

const peakOf = (a) => a.indexOf(Math.max(...a)) / (a.length - 1);
let inh = await env(true, 1.2), exh = await env(false, 1.65);
ok('an inhale peaks late', Math.abs(peakOf(inh) - 0.58) < 0.08, peakOf(inh).toFixed(3));
ok('an exhale peaks early', Math.abs(peakOf(exh) - 0.22) < 0.08, peakOf(exh).toFixed(3));
ok('inhale gathers, exhale releases', peakOf(inh) > peakOf(exh) + 0.25,
   `${peakOf(inh).toFixed(2)} vs ${peakOf(exh).toFixed(2)}`);
ok('both start and end at nothing', inh[0] === 0 && inh[inh.length-1] === 0 && exh[0] === 0, '');
ok('an exhale has the longer taper',
   (1 - peakOf(exh)) > (1 - peakOf(inh)), `${(1-peakOf(exh)).toFixed(2)} vs ${(1-peakOf(inh)).toFixed(2)}`);

// Two breaths are never identical: the wobble is regenerated each time.
const a1 = await env(true, 1.2), a2 = await env(true, 1.2);
ok('no two breaths are the same', a1.some((v, i) => Math.abs(v - a2[i]) > 1e-6), 'identical');
ok('but both keep the same overall shape', Math.abs(peakOf(a1) - peakOf(a2)) < 0.12,
   `${peakOf(a1).toFixed(2)} vs ${peakOf(a2).toFixed(2)}`);

/* ---- creatures ---- */
for (const [id, pace, purr] of [['cat', 28, 28], ['dragon', 6, 9], ['horse', 12, 14]]) {
  await page.click(`#beastChips button[data-beast="${id}"]`);
  const got = await page.evaluate(() => ({ beast, pace: breathPace, purr: purrRate }));
  ok(`${id} sets its own pace and size`, got.beast === id && got.pace === pace && got.purr === purr,
     JSON.stringify(got));
}
await page.click('#beastChips button[data-beast="dragon"]');
const dragon = await page.evaluate(() => {
  const c = CREATURES.find(x => x.id === 'dragon'), k = CREATURES.find(x => x.id === 'cat');
  return { dIn: c.inhale.bands, kIn: k.inhale.bands, dLp: c.exhale.lp, kLp: k.exhale.lp };
});
ok('a dragon resonates far below a cat', dragon.dIn[0] < dragon.kIn[0] / 5,
   `${dragon.dIn[0]} Hz vs ${dragon.kIn[0]} Hz`);
ok('and is darker with it', dragon.dLp < dragon.kLp / 1.5, `${dragon.dLp} vs ${dragon.kLp}`);

/* ---- the purr is its own thing ---- */
await page.click('#beastChips button[data-beast="cat"]');
await page.click('#purrChips button[data-purr="9"]');
const mixed = await page.evaluate(() => ({ beast, purr: purrRate }));
ok('a cat can be given a purr the size of a house', mixed.beast === 'cat' && mixed.purr === 9,
   JSON.stringify(mixed));
ok('and the page says so', /size of a house/.test(await page.textContent('#purrNote')), await page.textContent('#purrNote'));
await page.click('#purrChips button[data-purr="28"]');
ok('a cat purr reads as one', /cat on your chest/.test(await page.textContent('#purrNote')), await page.textContent('#purrNote'));

const curves = await page.evaluate(() => {
  setBreath({ grain: 0 }); const smooth = Array.from(purrCurve());
  setBreath({ grain: 100 }); const rough = Array.from(purrCurve());
  const jump = (c) => Math.max(...c.slice(1).map((v, i) => Math.abs(v - c[i])));
  return { smooth: jump(smooth), rough: jump(rough), floor: Math.min(...rough) };
});
ok('grain makes the buzz rougher', curves.rough > curves.smooth * 1.5,
   `${curves.rough.toFixed(3)} vs ${curves.smooth.toFixed(3)}`);
ok('a purr never cuts to silence', curves.floor > 0.2, curves.floor.toFixed(3));

/* ---- it runs ---- */
await page.reload();
await page.click('#beastChips button[data-beast="dragon"]');
await page.fill('#lvl-breath', '60'); await page.dispatchEvent('#lvl-breath', 'input');
await page.fill('#lvl-purr', '40'); await page.dispatchEvent('#lvl-purr', 'input');
await page.click('#playBtn');
await page.waitForTimeout(1500);
ok('both play', await page.evaluate(() => running && !!lanes.breath && !!lanes.purr), '');
ok('the readout names the creature', /dragon at 6 a minute/.test(await page.textContent('#readout')),
   await page.textContent('#readout'));
ok('and the purr', /purring at 9/.test(await page.textContent('#readout')), await page.textContent('#readout'));
await page.fill('#purrNum', '20'); await page.dispatchEvent('#purrNum', 'input');
await page.fill('#paceNum', '14'); await page.dispatchEvent('#paceNum', 'input');
await page.waitForTimeout(900);
ok('retuning while alive does not throw', await page.evaluate(() => running), '');
await page.click('#playBtn');
await page.waitForTimeout(500);
ok('and it stops', await page.evaluate(() => !running), '');

/* ---- it travels in the address ---- */
await page.goto(URL);
await page.click('#beastChips button[data-beast="horse"]');
await page.fill('#lvl-breath', '35'); await page.dispatchEvent('#lvl-breath', 'input');
await page.waitForTimeout(600);
ok('the creature is in the address', /beast=horse/.test(page.url()), page.url());
const before = await page.evaluate(() => snapshot());
await page.goto(page.url());
await page.waitForTimeout(400);
ok('and comes back from it', JSON.stringify(await page.evaluate(() => snapshot())) === JSON.stringify(before), '');

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
