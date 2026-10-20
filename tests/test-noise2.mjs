import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const URL = 'http://127.0.0.1:8099/noise-machine.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1250, height: 1500 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto(URL);

/* ---------------- the loop seam, which was the popping ---------------- */

// Generated through the page's own seamless(), then measured where the end
// meets the beginning. A step there is a click once every eight seconds.
// Averaged over several generations: a random walk ends wherever it ends, so
// a single draw can finish near zero by luck and make a broken seam look fine.
const seam = (kind, crossfade, runs = 5) => page.evaluate(async ({ kind, crossfade, runs }) => {
  const off = new OfflineAudioContext(1, 1024, 48000);
  ctx = off;
  buffers = new Map();
  const fill = { white: fillWhite, pink: fillPink, brown: fillBrown }[kind];
  let wrap = 0, typical = 0, rms = 0;
  for (let r = 0; r < runs; r++) {
    let data;
    if (crossfade) {
      data = seamless(fill).getChannelData(0);
    } else {
      // The old way: generate exactly the buffer, no overrun, no fade.
      data = new Float32Array(Math.floor(48000 * 8));
      fill(data);
    }
    const n = data.length;
    let steps = 0, power = 0;
    for (let i = 1; i < n; i++) steps += Math.abs(data[i] - data[i - 1]);
    for (let i = 0; i < n; i++) power += data[i] * data[i];
    wrap += Math.abs(data[0] - data[n - 1]) / runs;
    typical += (steps / (n - 1)) / runs;
    rms += Math.sqrt(power / n) / runs;
  }
  return { wrap, typical, rms };
}, { kind, crossfade, runs });

// Brown is the one that was broken. A leaky walk ends far from the nothing
// it started at, so the loop stepped by several times anything else in the
// signal — a click every eight seconds, in Brown and in Rain and the Fan,
// which are built on it. Pink's seam runs about one ordinary sample, because
// a full-bandwidth white term dominates it; there the fade has nothing to
// mend and only has to leave well alone. Both are measured against the
// signal's own typical sample-to-sample step, which is the only scale on
// which "a step" means anything.
const ratio = (m) => m.wrap / m.typical;

const brownBefore = await seam('brown', false);
const brownAfter = await seam('brown', true);
ok('brown: the seam stepped many times an ordinary sample', ratio(brownBefore) > 3,
   `${ratio(brownBefore).toFixed(1)}x a typical step`);
ok('brown: now it is one ordinary sample', ratio(brownAfter) < 2.2, `${ratio(brownAfter).toFixed(1)}x`);
ok('brown: and that is the fade, not luck', brownAfter.wrap < brownBefore.wrap / 2,
   `${brownBefore.wrap.toFixed(4)} → ${brownAfter.wrap.toFixed(4)}`);
console.log(`      brown: ${ratio(brownBefore).toFixed(1)}x → ${ratio(brownAfter).toFixed(1)}x a typical step`);

const pinkBefore = await seam('pink', false);
const pinkAfter = await seam('pink', true);
ok('pink: never had brown\'s problem to begin with',
   ratio(pinkBefore) < ratio(brownBefore) / 2, `pink ${ratio(pinkBefore).toFixed(1)}x vs brown ${ratio(brownBefore).toFixed(1)}x`);
ok('pink: and the fade leaves it alone', ratio(pinkAfter) < 2.2, `${ratio(pinkAfter).toFixed(1)}x`);
console.log(`      pink:  ${ratio(pinkBefore).toFixed(1)}x → ${ratio(pinkAfter).toFixed(1)}x a typical step`);

const white = await seam('white', true);
ok('white keeps its level through the fade', white.rms > 0.5 && white.rms < 0.62, white.rms.toFixed(3));

/* ---------------- only what is wanted gets built ---------------- */

await page.reload();
await page.click('#playBtn');
await page.waitForTimeout(600);
let built = await page.evaluate(() => Object.keys(lanes));
ok('at Start only the lane that is up is built', built.length === 1 && built[0] === 'pink', JSON.stringify(built));
ok('and only its buffer was generated', await page.evaluate(() => [...buffers.keys()]).then(k => k.length === 1 && k[0] === 'pink'),
   JSON.stringify(await page.evaluate(() => [...buffers.keys()])));
await page.fill('#lvl-brown', '40');
await page.dispatchEvent('#lvl-brown', 'input');
await page.waitForTimeout(400);
built = await page.evaluate(() => Object.keys(lanes));
ok('raising a fader builds that lane then', built.includes('brown'), JSON.stringify(built));
ok('nothing sounds before the opening', await page.evaluate(() => openAt > 0), '');
await page.click('#playBtn');
await page.waitForTimeout(500);

/* ---------------- the drum ---------------- */

await page.reload();
ok('a drum lane exists and starts silent', await page.inputValue('#lvl-drum') === '0', await page.inputValue('#lvl-drum'));
ok('five presets', (await page.$$('#drumChips button')).length === 5, (await page.$$('#drumChips button')).length);
ok('four shapes', (await page.$$('#shapeChips button')).length === 4, (await page.$$('#shapeChips button')).length);

await page.click('#drumChips button[data-drum="Walk"]');
ok('a preset sets tempo, depth and shape at once',
   await page.inputValue('#bpmNum') === '96' && await page.inputValue('#depthNum') === '54'
   && /\bon\b/.test(await page.getAttribute('#shapeChips button[data-shape="walk"]', 'class')),
   `${await page.inputValue('#bpmNum')} / ${await page.inputValue('#depthNum')}`);
ok('and lights itself', /\bon\b/.test(await page.getAttribute('#drumChips button[data-drum="Walk"]', 'class')), '');

await page.fill('#bpmNum', '120');
await page.dispatchEvent('#bpmNum', 'input');
ok('typing a tempo moves the slider', await page.inputValue('#bpmIn') === '120', await page.inputValue('#bpmIn'));
ok('the preset unlights once changed', !/\bon\b/.test(await page.getAttribute('#drumChips button[data-drum="Walk"]', 'class')), '');
ok('the note says how often a bar comes round', /every 1\.0s/.test(await page.textContent('#bpmNote')), await page.textContent('#bpmNote'));

await page.fill('#depthNum', '95');
await page.dispatchEvent('#depthNum', 'input');
const deepNote = await page.textContent('#depthNote');
await page.fill('#depthNum', '10');
await page.dispatchEvent('#depthNum', 'input');
const shallowNote = await page.textContent('#depthNote');
ok('depth changes where the drum falls to', /falls to 3[0-9] Hz/.test(deepNote) && /falls to 9[0-9] Hz/.test(shallowNote),
   `${deepNote} // ${shallowNote}`);
ok('and how long it rings', /0\.6[0-9]s/.test(deepNote) && /0\.2[0-9]s/.test(shallowNote), `${deepNote} // ${shallowNote}`);

// The kick itself, rendered rather than described.
const kickAt = (depth) => page.evaluate(async (d) => {
  const RATE = 48000;
  const off = new OfflineAudioContext(1, RATE, RATE);
  ctx = off; buffers = new Map();
  drumDepth = d;
  const out = off.createGain(); out.gain.value = 1; out.connect(off.destination);
  kick(0, 1, out);
  const buf = await off.startRendering();
  const a = Array.from(buf.getChannelData(0));
  let cross = 0; for (let i = 1; i < 4800; i++) if (a[i-1] <= 0 && a[i] > 0) cross++;
  let last = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > 0.02) last = i;
  return { hz: cross * 10, tail: last / RATE, peak: Math.max(...a.map(Math.abs)) };
}, depth);
const deep = await kickAt(95), shallow = await kickAt(10);
ok('a deep kick really is lower', deep.hz < shallow.hz - 15, `${deep.hz} Hz vs ${shallow.hz} Hz`);
ok('and really does ring longer', deep.tail > shallow.tail * 1.5, `${deep.tail.toFixed(2)}s vs ${shallow.tail.toFixed(2)}s`);
ok('and neither clips', deep.peak <= 1.01 && shallow.peak <= 1.01, `${deep.peak.toFixed(2)} / ${shallow.peak.toFixed(2)}`);
console.log(`      deep: ${deep.hz} Hz for ${deep.tail.toFixed(2)}s · shallow: ${shallow.hz} Hz for ${shallow.tail.toFixed(2)}s`);

// The scheduler, caught in the act on the real clock.
await page.reload();
await page.evaluate(() => {
  window.__hits = [];
  const real = kick;
  kick = (at, strength, out) => { window.__hits.push({ at, strength }); real(at, strength, out); };
});
await page.click('#shapeChips button[data-shape="pulse"]');
await page.fill('#bpmNum', '120');
await page.dispatchEvent('#bpmNum', 'input');
await page.fill('#lvl-drum', '50');
await page.dispatchEvent('#lvl-drum', 'input');
await page.click('#playBtn');
await page.waitForTimeout(3000);
const hits = await page.evaluate(() => window.__hits.map(h => h.at));
ok('the drum actually beats', hits.length >= 4, `${hits.length} hits`);
const gaps = hits.slice(1).map((t, i) => t - hits[i]);
ok('at the tempo asked for, on the audio clock',
   gaps.every(g => Math.abs(g - 0.5) < 0.004), JSON.stringify(gaps.map(g => +g.toFixed(4))));
ok('scheduled ahead, not at the moment of playing',
   await page.evaluate(() => window.__hits.some(h => h.at > 0)), '');
console.log(`      ${hits.length} hits, gaps ${gaps.slice(0,4).map(g => g.toFixed(3)).join(', ')}`);

await page.click('#shapeChips button[data-shape="heart"]');
await page.evaluate(() => { window.__hits = []; });
await page.waitForTimeout(2200);
const two = await page.evaluate(() => window.__hits.map(h => h.strength));
ok('the heartbeat is two hits of different weight', new Set(two).size === 2 && two.includes(1), JSON.stringify([...new Set(two)]));
await page.click('#playBtn');
await page.waitForTimeout(400);
ok('stopping silences the drum', await page.evaluate(async () => {
  window.__hits = []; await new Promise(r => setTimeout(r, 600)); return window.__hits.length === 0; }), '');

/* ---------------- the sleep timer ---------------- */

await page.reload();
ok('the timer sits at the very top', await page.evaluate(() => {
  const r = document.getElementById('sleeper').getBoundingClientRect();
  return r.top === 0 && getComputedStyle(document.getElementById('sleeper')).position === 'fixed';
}), '');
ok('on by default', await page.isChecked('#sleepOn'), '');
ok('set to four hours', await page.inputValue('#sleepHrs') === '4', await page.inputValue('#sleepHrs'));
ok('and says so', /4 hours, then it fades out/.test(await page.textContent('#sleepOut')), await page.textContent('#sleepOut'));
ok('it runs from four to twenty-four',
   await page.getAttribute('#sleepHrs', 'min') === '4' && await page.getAttribute('#sleepHrs', 'max') === '24',
   `${await page.getAttribute('#sleepHrs','min')}–${await page.getAttribute('#sleepHrs','max')}`);
await page.fill('#sleepHrs', '24');
await page.dispatchEvent('#sleepHrs', 'input');
ok('twenty-four is reachable', /24 hours/.test(await page.textContent('#sleepOut')), await page.textContent('#sleepOut'));
await page.uncheck('#sleepOn');
ok('and it can be switched off entirely', /plays until you stop it/.test(await page.textContent('#sleepOut')),
   await page.textContent('#sleepOut'));
ok('the strip dims when off', /\boff\b/.test(await page.getAttribute('#sleeper', 'class')), await page.getAttribute('#sleeper', 'class'));
await page.check('#sleepOn');
await page.fill('#sleepHrs', '4');
await page.dispatchEvent('#sleepHrs', 'input');
await page.click('#playBtn');
await page.waitForTimeout(900);
ok('playing, it counts down in hours', /3:5\d:\d\d left/.test(await page.textContent('#sleepOut')), await page.textContent('#sleepOut'));
ok('and the readout agrees', /3:5\d:\d\d left/.test(await page.textContent('#readout')), await page.textContent('#readout'));
ok('the status says how long it has', /stopping in 4 hours/.test(await page.textContent('#status')), await page.textContent('#status'));
await page.click('#playBtn');
await page.waitForTimeout(500);
ok('stopped, it shows the setting again', /4 hours, then it fades out/.test(await page.textContent('#sleepOut')), await page.textContent('#sleepOut'));

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
