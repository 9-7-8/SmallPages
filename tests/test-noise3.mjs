import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const URL = 'http://127.0.0.1:8099/noise-machine.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx0 = await browser.newContext({ viewport: { width: 1250, height: 1600 } });
const page = await ctx0.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto(URL);

/* ---------------- rain is gone ---------------- */
ok('no rain lane', await page.$('#lvl-rain') === null, 'still there');
ok('nine lanes, with rain gone and breathing added', (await page.$$('.lane')).length === 9, (await page.$$('.lane')).length);
ok('an isochronic lane exists', await page.$('#lvl-isochronic') !== null, '');
ok('the dropper went with it', await page.evaluate(() => typeof dropper === 'undefined'), '');

/* ---------------- the pulse envelope, against its formula ---------------- */

// pulseCurve() builds one cycle, so it can be read straight off rather than
// inferred from what was scheduled.
const curve = (over) => page.evaluate(async (o) => { setIso(o); return Array.from(pulseCurve()); }, over);

let c = await curve({ rate: 4, duty: 50, depth: 100, soft: 12, shape: "soft" });
ok('the envelope reaches silence at full depth', Math.min(...c) === 0, Math.min(...c));
ok('and full level somewhere in the pulse', Math.max(...c) === 1, Math.max(...c));
const onFraction = c.filter(v => v > 0).length / c.length;
ok('the on-window is the duty', Math.abs(onFraction - 0.5) < 0.03, onFraction.toFixed(3));
ok('it rises rather than snapping on', c[0] === 0 && c[1] > 0 && c[1] < 1, `${c[0]}, ${c[1].toFixed(3)}`);

// The source's own worked example: 40 a second at half duty is a 25 ms cycle
// with a 12.5 ms on-window.
const worked = await page.evaluate(() => {
  setIso({ rate: 40, duty: 50, depth: 100 });
  const c = Array.from(pulseCurve());
  const period = 1000 / isoRate;
  return { period, on: period * (c.filter(v => v > 0).length / c.length) };
});
ok('40 a second at half duty is a 25 ms cycle', Math.abs(worked.period - 25) < 0.01, worked.period.toFixed(2));
ok('with a 12.5 ms on-window', Math.abs(worked.on - 12.5) < 0.5, worked.on.toFixed(2));

// Depth is (1 - m) + m * g, so the floor is exactly 1 - m.
for (const [depth, floor] of [[100, 0], [60, 0.4], [25, 0.75], [0, 1]]) {
  c = await curve({ depth, shape: "soft", duty: 50 });
  ok(`depth ${depth}% floors the level at ${floor}`, Math.abs(Math.min(...c) - floor) < 0.001, Math.min(...c).toFixed(3));
}
c = await curve({ depth: 0 });
ok('at no depth the carrier is unmodulated', Math.max(...c) - Math.min(...c) < 0.001, `${Math.min(...c)}–${Math.max(...c)}`);

await page.evaluate(() => setIso({ depth: 100 }));
ok('full depth is called isochronic', /what makes it isochronic/.test(await page.textContent('#idepthNote')),
   await page.textContent('#idepthNote'));
await page.evaluate(() => setIso({ depth: 55 }));
ok('and anything less is called a tremolo', /tremolo rather than isochronic/.test(await page.textContent('#idepthNote')),
   await page.textContent('#idepthNote'));

// What the constraint is actually for: the envelope must not jump. A fade
// cut short, or one too brief to be a fade, is a click — so measure the
// largest step between neighbouring points rather than counting samples.
const biggestStep = (c) => Math.max(...c.slice(1).map((v, i) => Math.abs(v - c[i])));

for (const [rate, duty, soft] of [[4, 50, 12], [4, 10, 12], [50, 10, 12], [50, 10, 1],
                                  [40, 50, 50], [0.5, 90, 2], [30, 20, 0]]) {
  const step = await page.evaluate((o) => {
    setIso({ rate: o.rate, duty: o.duty, soft: o.soft, depth: 100, shape: "soft" });
    const c = Array.from(pulseCurve());
    return Math.max(...c.slice(1).map((v, i) => Math.abs(v - c[i])));
  }, { rate, duty, soft });
  ok(`${rate}/s at ${duty}% duty with ${soft}% edges never jumps`, step < 0.34, step.toFixed(3));
}

// And the floor is what does it: without one, the same settings step badly.
const unfloored = await page.evaluate(() => {
  setIso({ rate: 50, duty: 10, soft: 1, depth: 100, shape: "soft" });
  const duty = isoDuty / 100, edge = Math.min(0.5, isoSoft / 100), out = [];
  for (let i = 0; i < 256; i++) {
    const u = i / 255; let g;
    if (u >= duty) g = 0;
    else { const v = u / duty; g = edge <= 0 ? 1 : v < edge ? v / edge : v > 1 - edge ? (1 - v) / edge : 1; }
    out.push(g);
  }
  return Math.max(...out.slice(1).map((v, i) => Math.abs(v - out[i])));
});
ok('and without the floor that setting would step', unfloored > 0.6, unfloored.toFixed(3));
ok('the page says when it has held the edge up',
   await page.evaluate(() => { setIso({ rate: 50, duty: 10, soft: 1, shape: "soft" });
     return /will not click/.test(idepthNote.parentElement.parentElement.querySelector("#isoftNote").textContent); }), '');

// A flat top is what the soft shape has and the other two do not; counting
// against it rather than against a fixed number keeps this honest whatever
// the curve's resolution.
const atPeak = (c) => c.filter(v => v > 0.999).length;
const flat = atPeak(await curve({ shape: "soft", duty: 50, soft: 12, depth: 100 }));
const sine = await curve({ shape: "sine", depth: 100 });
const round = await curve({ shape: "round", duty: 50, depth: 100 });
ok('a sinusoid has no flat top, where the soft shape does',
   atPeak(sine) < flat / 8, `${atPeak(sine)} at peak vs ${flat} for soft-edged`);
ok('and still reaches silence once a cycle', Math.min(...sine) < 0.001, Math.min(...sine));
ok('nor does a rounded pulse', atPeak(round) < flat / 8, `${atPeak(round)} vs ${flat}`);
ok('but all three reach full level', Math.max(...sine) > 0.999 && Math.max(...round) > 0.999, '');

/* ---------------- the controls ---------------- */
await page.reload();
ok('the rate runs from a half to fifty', await page.getAttribute('#irateIn', 'min') === '0.5'
   && await page.getAttribute('#irateIn', 'max') === '50',
   `${await page.getAttribute('#irateIn','min')}–${await page.getAttribute('#irateIn','max')}`);

const mid = await page.evaluate(() => { itoneIn.value = '500'; itoneIn.dispatchEvent(new Event('input')); return isoTone; });
ok('the tone slider is logarithmic', Math.abs(mid - Math.sqrt(40 * 1000)) < 6, `${mid.toFixed(0)} Hz at the midpoint`);
await page.fill('#itoneNum', '880'); await page.dispatchEvent('#itoneNum', 'input');
ok('and the box still sets an exact figure', await page.evaluate(() => isoTone) === 880, await page.evaluate(() => isoTone));

await page.click('#isoChips button[data-hz="published"]');
const pub = await page.evaluate(() => ({ tone: isoTone, rate: isoRate, duty: isoDuty, depth: isoDepth }));
ok('the published stimulus is one click', pub.tone === 440 && pub.rate === 40 && pub.duty === 50 && pub.depth === 100,
   JSON.stringify(pub));

await page.selectOption('#ishapeSel', 'sine');
await page.waitForTimeout(500);
ok('the shape goes into the address too', /ishape=sine/.test(page.url()), page.url());

// It must still actually run.
await page.reload();
await page.fill('#lvl-isochronic', '55'); await page.dispatchEvent('#lvl-isochronic', 'input');
await page.click('#playBtn');
await page.waitForTimeout(1200);
ok('the pulsed tone still plays', await page.evaluate(() => running && !!lanes.isochronic), '');
await page.selectOption('#ishapeSel', 'round');
await page.fill('#irateNum', '30'); await page.dispatchEvent('#irateNum', 'input');
await page.waitForTimeout(800);
ok('and survives being retuned mid-pulse', await page.evaluate(() => running), '');
await page.click('#playBtn');
await page.waitForTimeout(400);

/* ---------------- presets ---------------- */
await page.goto(URL);
ok('seven presets along the top', (await page.$$('#presetChips button')).length === 7, (await page.$$('#presetChips button')).length);
await page.click('#presetChips button[data-preset="Sleep"]');
await page.waitForTimeout(350);
let now = await page.evaluate(() => snapshot());
ok('a preset sets every knob at once', now.brown === 46 && now.pink === 16 && now.bin === 26
   && now.split === 2.5 && now.sleep === 8 && now.vol === 46, JSON.stringify(now));
ok('and lights itself', /\bon\b/.test(await page.getAttribute('#presetChips button[data-preset="Sleep"]', 'class')), '');
await page.click('#presetChips button[data-preset="Energy"]');
await page.waitForTimeout(350);
now = await page.evaluate(() => snapshot());
ok('switching preset resets what the last one set', now.brown === 0 && now.iso === 28 && now.irate === 40
   && now.shape === 'walk', JSON.stringify(now));
ok('the old one goes dark', !/\bon\b/.test(await page.getAttribute('#presetChips button[data-preset="Sleep"]', 'class')), '');
await page.fill('#lvl-white', '7'); await page.dispatchEvent('#lvl-white', 'input');
await page.waitForTimeout(350);
ok('touching a knob unlights the preset', (await page.$$('#presetChips button.on')).length === 0, '');

/* ---------------- the address bar ---------------- */
await page.goto(URL);
ok('an untouched page has a clean address', !page.url().includes('?'), page.url());
await page.click('#presetChips button[data-preset="Meditation"]');
await page.waitForTimeout(500);
const url = page.url();
ok('a change writes itself into the address', url.includes('?') && /split=6/.test(url) && /tone=136.1/.test(url), url);
ok('and leaves defaults out of it', !/swap=0/.test(url) && !/iduty=50/.test(url), url);
const meditation = await page.evaluate(() => snapshot());
await page.goto(url);
await page.waitForTimeout(350);
ok('opening that address brings the whole setting back',
   JSON.stringify(await page.evaluate(() => snapshot())) === JSON.stringify(meditation),
   JSON.stringify(await page.evaluate(() => snapshot())));
ok('and the preset shows as the one loaded',
   /\bon\b/.test(await page.getAttribute('#presetChips button[data-preset="Meditation"]', 'class')), '');
await page.fill('#bpmNum', '77'); await page.dispatchEvent('#bpmNum', 'input');
await page.waitForTimeout(500);
ok('every later change updates it too', /bpm=77/.test(page.url()), page.url());
await page.goto(URL + '?pink=0&brown=80&split=3.5&shape=tide');
await page.waitForTimeout(350);
now = await page.evaluate(() => snapshot());
ok('a hand-written address is honoured', now.pink === 0 && now.brown === 80 && now.split === 3.5 && now.shape === 'tide',
   JSON.stringify(now));
ok('and anything it leaves out keeps its default', now.vol === 60 && now.itone === 200, JSON.stringify(now));

/* ---------------- keeping your own ---------------- */
await page.goto(URL);
await page.click('#presetChips button[data-preset="Calming"]');
await page.fill('#lvl-fan', '33'); await page.dispatchEvent('#lvl-fan', 'input');
await page.fill('#presetName', 'My evening');
await page.click('#keepBtn');
await page.waitForTimeout(300);
ok('it can be kept', /Kept as My evening/.test(await page.textContent('#keptNote')), await page.textContent('#keptNote'));
ok('and appears in the list', (await page.$$eval('#mineSel option', o => o.map(x => x.textContent))).includes('My evening'), '');
const mine = await page.evaluate(() => snapshot());
await page.reload();
await page.waitForTimeout(350);
ok('it survives a reload', (await page.$$eval('#mineSel option', o => o.map(x => x.textContent))).includes('My evening'), '');
await page.click('#presetChips button[data-preset="Sleep"]');
await page.waitForTimeout(300);
await page.selectOption('#mineSel', 'My evening');
await page.waitForTimeout(350);
ok('and loading it brings everything back',
   JSON.stringify(await page.evaluate(() => snapshot())) === JSON.stringify(mine), JSON.stringify(await page.evaluate(() => snapshot())));
await page.selectOption('#mineSel', 'My evening');
await page.click('#dropBtn');
await page.waitForTimeout(300);
ok('and it can be forgotten', !(await page.$$eval('#mineSel option', o => o.map(x => x.textContent))).includes('My evening'),
   JSON.stringify(await page.$$eval('#mineSel option', o => o.map(x => x.textContent))));

// Storage refused must not take the page with it.
const blocked = await browser.newContext();
await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('no'); } }); });
const bp = await blocked.newPage();
const bErr = [];
bp.on('pageerror', e => bErr.push(e.message));
await bp.goto(URL);
await bp.click('#presetChips button[data-preset="Focus"]');
await bp.fill('#presetName', 'x');
await bp.click('#keepBtn');
await bp.waitForTimeout(300);
ok('a browser refusing storage still works and says so',
   bErr.length === 0 && /will not store it/.test(await bp.textContent('#keptNote')), JSON.stringify(bErr));
ok('and the address bar still carries it', bp.url().includes('irate=14'), bp.url());
await blocked.close();

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
