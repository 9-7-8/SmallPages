import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const URL = 'http://127.0.0.1:8099/noise-machine.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1250, height: 1500 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto(URL);

// Render the page's OWN build("binaural") into an offline context, so the
// thing measured is the graph the page really makes.
const render = (carrier, beat) => page.evaluate(async ({ carrier, beat }) => {
  const RATE = 48000;
  const off = new OfflineAudioContext(2, RATE, RATE);
  ctx = off;
  master = off.createGain();
  master.gain.value = 1;
  master.connect(off.destination);
  setBinaural(carrier, beat);
  const lane = build('binaural');
  lane.gain.gain.value = 1;
  const buf = await off.startRendering();
  return { left: Array.from(buf.getChannelData(0)), right: Array.from(buf.getChannelData(1)) };
}, { carrier, beat });

const crossings = (a) => { let n = 0; for (let i = 1; i < a.length; i++) if (a[i-1] <= 0 && a[i] > 0) n++; return n; };
// A pure tone holds a steady peak; two tones in one ear beat, and the envelope
// collapses to nothing at the trough. That is exactly the bleed to catch.
const envelopeRatio = (a, rate = 48000) => {
  const win = Math.floor(rate / 100), peaks = [];
  for (let i = 0; i + win < a.length; i += win) {
    let m = 0; for (let j = i; j < i + win; j++) m = Math.max(m, Math.abs(a[j]));
    peaks.push(m);
  }
  const mid = peaks.slice(2, -2);
  return Math.min(...mid) / Math.max(...mid);
};

let { left, right } = await render(200, 10);
ok('left ear carries carrier minus half the beat', Math.abs(crossings(left) - 195) <= 1, crossings(left));
ok('right ear carries carrier plus half the beat', Math.abs(crossings(right) - 205) <= 1, crossings(right));
ok('left ear is one pure tone, not two beating', envelopeRatio(left) > 0.97, envelopeRatio(left).toFixed(3));
ok('right ear is one pure tone, not two beating', envelopeRatio(right) > 0.97, envelopeRatio(right).toFixed(3));

// Prove the envelope test can fail: summed to mono, it must beat.
const mono = left.map((v, i) => (v + right[i]) / 2);
// A 10ms window cannot see all the way into a 100ms beat's trough, so the
// floor here is ~0.3 rather than 0. What matters is the gap: beating sits
// far below the 0.97 a pure tone holds, so the test above can in fact fail.
ok('summed to one ear it does beat — so the test above means something',
   envelopeRatio(mono) < 0.4 && envelopeRatio(mono) < envelopeRatio(left) / 2,
   `mono ${envelopeRatio(mono).toFixed(3)} vs pure ${envelopeRatio(left).toFixed(3)}`);

({ left, right } = await render(300, 4));
ok('the carrier moves both tones together', Math.abs(crossings(left) - 298) <= 1 && Math.abs(crossings(right) - 302) <= 1,
   `${crossings(left)} / ${crossings(right)}`);
ok('a smaller beat narrows the gap', crossings(right) - crossings(left) === 4, crossings(right) - crossings(left));

({ left, right } = await render(60, 0.5));
ok('the extremes of both sliders still render', crossings(left) > 55 && crossings(right) > 55 && envelopeRatio(left) > 0.95,
   `${crossings(left)} / ${crossings(right)} / ${envelopeRatio(left).toFixed(3)}`);

// ---- the UI ----
await page.reload();
ok('nine lanes now', (await page.$$('.lane')).length === 9, (await page.$$('.lane')).length);
ok('the tones start silent', await page.inputValue('#lvl-binaural') === '0', await page.inputValue('#lvl-binaural'));
ok('four named base tones offered', (await page.$$('#carrierChips button')).length === 4, (await page.$$('#carrierChips button')).length);
ok('six named differences offered', (await page.$$('#beatChips button')).length === 6, (await page.$$('#beatChips button')).length);
ok('the ears are shown to two places', /200\.00 Hz left · 210\.00 Hz right|195\.00 Hz left · 205\.00 Hz right/.test(await page.textContent('#earsOut')),
   await page.textContent('#earsOut'));

// 528 Hz has to be reachable at all — the old slider stopped at 500.
ok('the base slider now reaches past 528', Number(await page.getAttribute('#carrierIn', 'max')) >= 528,
   await page.getAttribute('#carrierIn', 'max'));

// Slider and box are one value seen twice.
await page.fill('#carrierNum', '333.5');
await page.dispatchEvent('#carrierNum', 'input');
ok('typing a figure moves the slider', await page.inputValue('#carrierIn') === '333.5' || Math.abs(Number(await page.inputValue('#carrierIn')) - 333.5) <= 1,
   await page.inputValue('#carrierIn'));
ok('and the ears follow the typed figure', /328\.50 Hz left · 338\.50 Hz right/.test(await page.textContent('#earsOut')),
   await page.textContent('#earsOut'));
await page.fill('#carrierIn', '440');
await page.dispatchEvent('#carrierIn', 'input');
ok('dragging the slider moves the box', await page.inputValue('#carrierNum') === '440', await page.inputValue('#carrierNum'));

// A value the slider's step cannot land on must survive in the box.
await page.click('#beatChips button[data-hz="7.83"]');
ok('a chip sets a figure finer than the slider step', await page.inputValue('#beatNum') === '7.83',
   await page.inputValue('#beatNum'));
// 7.8 would give 436.10 / 443.90; 7.83 gives 436.08 / 443.92.
ok('and it is used exactly, not snapped to the slider step', /436\.08 Hz left · 443\.92 Hz right/.test(await page.textContent('#earsOut')),
   await page.textContent('#earsOut'));
ok('the chip lights', /\bon\b/.test(await page.getAttribute('#beatChips button[data-hz="7.83"]', 'class')),
   await page.getAttribute('#beatChips button[data-hz="7.83"]', 'class'));

await page.click('#carrierChips button[data-hz="528"]');
ok('a base chip sets 528', await page.inputValue('#carrierNum') === '528', await page.inputValue('#carrierNum'));

// ---- the claims, and their standing, kept apart ----
let said = await page.textContent('#saidBox');
ok('the claim for 528 is reported', /love frequency/.test(said) && /repair DNA/.test(said), said.slice(0, 180));
ok('and is marked as unsupported in its own line',
   /nothing supports this/i.test(await page.textContent('#saidBox .holds')), await page.textContent('#saidBox .holds'));
ok('both the base and the difference are described', /528 Hz, Solfeggio/.test(said) && /7\.83 Hz, Schumann/.test(said), said.slice(0, 120));
ok('two standing lines, one per claim', (await page.$$('#saidBox .holds')).length === 2, (await page.$$('#saidBox .holds')).length);

await page.click('#beatChips button[data-hz="40"]');
ok('40 Hz is marked as the one with real research', (await page.$$('#saidBox .holds.some')).length === 1,
   (await page.$$('#saidBox .holds.some')).length);
ok('with the catch stated', /different stimulus|has not transferred/.test(await page.textContent('#saidBox')),
   (await page.textContent('#saidBox')).slice(-200));

await page.fill('#carrierNum', '211');
await page.dispatchEvent('#carrierNum', 'input');
await page.fill('#beatNum', '13.7');
await page.dispatchEvent('#beatNum', 'input');
said = await page.textContent('#saidBox');
ok('an unnamed setting claims nothing', /Nothing in particular/.test(said), said.slice(0, 140));
ok('and still names the band it falls in', /beta/.test(said), said.slice(0, 200));
ok('no chip is lit for it', (await page.$$('#carrierChips button.on')).length === 0
   && (await page.$$('#beatChips button.on')).length === 0, 'a chip stayed lit');

// ---- swapping ears ----
await page.fill('#carrierNum', '200');
await page.dispatchEvent('#carrierNum', 'input');
await page.fill('#beatNum', '10');
await page.dispatchEvent('#beatNum', 'input');
ok('before swapping, the lower tone is on the left', /195\.00 Hz left · 205\.00 Hz right/.test(await page.textContent('#earsOut')),
   await page.textContent('#earsOut'));
await page.click('#swapBtn');
ok('swapping puts the higher tone on the left', /205\.00 Hz left · 195\.00 Hz right/.test(await page.textContent('#earsOut')),
   await page.textContent('#earsOut'));
ok('and the button says which way round it is', /left ear/.test(await page.textContent('#swapBtn')), await page.textContent('#swapBtn'));

// The swap must reach the audio, not just the label.
const swappedRender = await page.evaluate(async () => {
  const RATE = 48000;
  const off = new OfflineAudioContext(2, RATE, RATE);
  ctx = off; master = off.createGain(); master.gain.value = 1; master.connect(off.destination);
  setBinaural(200, 10);
  const lane = build('binaural');
  lane.gain.gain.value = 1;
  const buf = await off.startRendering();
  return { left: Array.from(buf.getChannelData(0)), right: Array.from(buf.getChannelData(1)) };
});
ok('swapped, the left ear really carries the higher tone',
   Math.abs(crossings(swappedRender.left) - 205) <= 1 && Math.abs(crossings(swappedRender.right) - 195) <= 1,
   `${crossings(swappedRender.left)} / ${crossings(swappedRender.right)}`);
await page.click('#swapBtn');

// ---- live, with the real context ----
await page.fill('#lvl-binaural', '50');
await page.dispatchEvent('#lvl-binaural', 'input');
await page.click('#playBtn');
await page.waitForTimeout(900);
const live = await page.evaluate(() => ({ running, hasTune: !!(lanes.binaural && lanes.binaural.tune),
  readout: document.getElementById('readout').textContent }));
ok('it plays', live.running, JSON.stringify(live));
ok('the readout names base, difference and band', /200\.0 Hz, 10\.00 Hz apart, alpha/.test(live.readout), live.readout);

await page.fill('#beatNum', '20');
await page.dispatchEvent('#beatNum', 'input');
await page.waitForTimeout(400);
ok('retuning mid-play is fine', /20\.00 Hz apart, beta/.test(await page.textContent('#readout')), await page.textContent('#readout'));
await page.click('#swapBtn');
await page.waitForTimeout(300);
ok('swapping mid-play does not throw', await page.evaluate(() => running), '');
await page.click('#playBtn');
await page.waitForTimeout(500);
ok('and it stops cleanly', await page.evaluate(() => !running), '');

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.fill('#lvl-binaural', '45');
await page.dispatchEvent('#lvl-binaural', 'input');
await page.screenshot({ path: WORK + '/noise.png', fullPage: true });
await browser.close();
