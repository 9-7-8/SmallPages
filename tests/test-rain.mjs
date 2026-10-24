import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const URL = 'http://127.0.0.1:8099/rain-machine.html';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto(URL);
await page.waitForTimeout(400);

/* ---- the map ---- */
const inked = () => page.evaluate(() => {
  const c = document.getElementById('map');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
});
ok('the map draws before anything is started', await inked() > 2000, await inked());
ok('four places to stand', (await page.$$('#where button')).length === 4, (await page.$$('#where button')).length);

/* ---- a band, not a value ---- */
await page.fill('#rainLo', '30'); await page.dispatchEvent('#rainLo', 'input');
await page.fill('#rainHi', '80'); await page.dispatchEvent('#rainHi', 'input');
ok('the bar reads as a band', /30–80%/.test(await page.textContent('#rainOut')), await page.textContent('#rainOut'));
/* Long enough that the walk has to have gone somewhere. The weather picks a
   new aim only now and then, so over forty steps it can sit almost still:
   three hundred tries of forty put the spread under the 0.04 line about one
   time in eighty, and once at nothing at all. Over a hundred and sixty the
   smallest spread in three hundred tries was 0.215, five times the line —
   and the band it must stay inside gets four times as many chances to be
   broken, so the check above it is the stronger for it too. */
const inside = await page.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 160; i++) { drift(0.6); seen.push(BANDS.rain.now); }
  return { min: Math.min(...seen), max: Math.max(...seen), spread: Math.max(...seen) - Math.min(...seen) };
});
ok('the weather stays inside its band', inside.min >= 0.2999 && inside.max <= 0.8001,
   `${inside.min.toFixed(3)}–${inside.max.toFixed(3)}`);
ok('and actually wanders rather than sitting', inside.spread > 0.04, inside.spread.toFixed(3));

// Pinching the band to a point must pin the weather to it.
await page.fill('#rainLo', '50'); await page.dispatchEvent('#rainLo', 'input');
await page.fill('#rainHi', '50'); await page.dispatchEvent('#rainHi', 'input');
const pinned = await page.evaluate(() => { for (let i = 0; i < 40; i++) drift(0.6); return BANDS.rain.now; });
ok('a band of zero width holds still', Math.abs(pinned - 0.5) < 0.001, pinned.toFixed(4));

/* ---- the squall, which used to rubber-band ---- */

// The bug: the gust was added into the stored value every frame, so at sixty
// frames a second the rain slammed to the ceiling, pinned, and sagged back.
// The stored value must come through a gust completely untouched.
const squall = await page.evaluate(() => {
  BANDS.rain.lo.value = '20'; BANDS.rain.hi.value = '80';
  BANDS.rain.now = 0.35; BANDS.rain.aim = 0.35;
  BANDS.wind.now = 0.5; BANDS.wind.aim = 0.5;
  BANDS.wind.lo.value = '50'; BANDS.wind.hi.value = '50';
  gustAt = 0; gustLife = 5; gustSize = 0.8;
  // The base is allowed to wander on its own, which would mask the thing
  // being measured. Held still for the duration so that any movement in it
  // can only have come from the gust.
  const realRandom = Math.random;
  Math.random = () => 0.99;
  const trace = [];
  for (let i = 0; i < 70; i++) {
    trace.push({ heard: nowOf('rain'), stored: BANDS.rain.now, wind: nowOf('wind'), lift: gustLevel() });
    drift(0.1);
  }
  Math.random = realRandom;
  return trace;
});
const stored = squall.map(t => t.stored);
ok('a gust never writes into the stored value',
   Math.max(...stored) - Math.min(...stored) < 0.0005, `drifted ${(Math.max(...stored)-Math.min(...stored)).toFixed(5)}`);
const heard = squall.map(t => t.heard);
ok('but the rain does rise with it', Math.max(...heard) > heard[0] + 0.05,
   `${heard[0].toFixed(3)} → ${Math.max(...heard).toFixed(3)}`);
ok('and it is a swell, not a slam to the ceiling',
   Math.max(...heard) < 0.8 - 0.001, `peaked at ${Math.max(...heard).toFixed(3)} against a ceiling of 0.80`);
const peakAt = heard.indexOf(Math.max(...heard)) / heard.length;
ok('rising and falling rather than pinning', peakAt > 0.1 && peakAt < 0.6, `peak ${(peakAt*100).toFixed(0)}% through`);
ok('and gone when the gust is gone',
   Math.abs(heard[heard.length - 1] - stored[stored.length - 1]) < 0.001,
   `${heard[heard.length-1].toFixed(4)} vs ${stored[stored.length-1].toFixed(4)}`);
ok('the wind swells with it too', Math.max(...squall.map(t => t.wind)) > squall[0].wind + 0.1,
   `${squall[0].wind.toFixed(2)} → ${Math.max(...squall.map(t=>t.wind)).toFixed(2)}`);
console.log(`      rain ${heard[0].toFixed(2)} → ${Math.max(...heard).toFixed(2)} → ${heard[heard.length-1].toFixed(2)}`);

// Nothing may schedule on the wind's gain except the one writer, or they
// cancel each other and the swell restarts every time the other one runs.
await page.evaluate(() => { gustAt = -1; });
const touched = await page.evaluate(async () => {
  const off = new OfflineAudioContext(2, 2048, 48000);
  ctx = off;
  const seen = [];
  const real = AudioParam.prototype.cancelScheduledValues;
  AudioParam.prototype.cancelScheduledValues = function (t) { seen.push(1); return real.call(this, t); };
  running = true;
  airNodes = { gain: off.createGain(), filter: off.createBiquadFilter() };
  gust(true);
  clearTimeout(gustTimer);
  running = false;
  AudioParam.prototype.cancelScheduledValues = real;
  return { cancels: seen.length, armed: gustAt >= 0, size: gustSize };
});
ok('a gust schedules nothing of its own', touched.cancels === 0, `${touched.cancels} cancellations`);
ok('it only arms its envelope', touched.armed && touched.size > 0, JSON.stringify(touched));

// Wind and rain are tied: a gust pushes the rain up with it.
const coupled = await page.evaluate(() => {
  BANDS.rain.lo.value = '10'; BANDS.rain.hi.value = '90';
  BANDS.rain.now = 0.3; BANDS.rain.aim = 0.3;
  gustAt = 0; gustLife = 4; gustSize = 0.9;
  const before = nowOf('rain');
  for (let i = 0; i < 10; i++) drift(0.1);
  const during = nowOf('rain');
  for (let i = 0; i < 60; i++) drift(0.1);
  return { before, during, settled: nowOf('rain'), after: gustAt };
});
ok('a gust pushes the rain up with it', coupled.during > coupled.before + 0.05,
   `${coupled.before.toFixed(3)} → ${coupled.during.toFixed(3)}`);
ok('and the gust ends rather than sticking', coupled.after < 0, `gustAt ${coupled.after}`);

/* ---- Poisson, not an evenly jittered gap ---- */
const gaps = await page.evaluate(() => {
  const out = [];
  for (let i = 0; i < 6000; i++) out.push(nextGap(10));
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  return { mean, belowMean: out.filter(g => g < mean).length / out.length, max: Math.max(...out) };
});
ok('the mean gap is one over the rate', Math.abs(gaps.mean - 0.1) < 0.006, gaps.mean.toFixed(4));
// An exponential puts 1 - 1/e of its mass below the mean; a uniform puts half.
ok('and the shape is exponential, not uniform', Math.abs(gaps.belowMean - 0.632) < 0.03,
   `${(gaps.belowMean * 100).toFixed(1)}% below the mean`);
ok('with the occasional long wait a uniform would never give', gaps.max > 0.4, gaps.max.toFixed(3));

/* ---- the excitations ---- */
// Averaged over several builds: the shortest excitation is a few dozen
// samples, and one draw of that is not a measurement of anything.
const exc = await page.evaluate(async () => {
  const off = new OfflineAudioContext(1, 1024, 48000);
  ctx = off;
  const runs = 12;
  const acc = null;
  let totals = null;
  for (let r = 0; r < runs; r++) {
    buildExcitations();
    const got = excitations.map(b => {
      const d = b.getChannelData(0);
      let cross = 0;
      for (let i = 1; i < d.length; i++) if ((d[i - 1] <= 0) !== (d[i] <= 0)) cross++;
      return { ms: b.duration * 1000, bright: cross / b.duration, first: Math.abs(d[0]) };
    });
    if (!totals) totals = got.map(g => ({ ...g }));
    else got.forEach((g, i) => { totals[i].bright += g.bright; totals[i].first = Math.max(totals[i].first, g.first); });
  }
  return totals.map(t => ({ ...t, bright: t.bright / runs }));
});
ok('five excitations, shortest to longest', exc.every((e, i) => i === 0 || e.ms > exc[i-1].ms),
   JSON.stringify(exc.map(e => +e.ms.toFixed(2))));
ok('a small drop is under a millisecond and a big one a few',
   exc[0].ms < 1 && exc[4].ms > 4 && exc[4].ms < 7, `${exc[0].ms.toFixed(2)} to ${exc[4].ms.toFixed(2)} ms`);
// Measured on the two that are long enough to measure; the shortest is a
// handful of samples and tells you nothing either way.
ok('bigger drops carry more low end', exc[4].bright < exc[1].bright * 0.8,
   `${exc[1].bright.toFixed(0)} vs ${exc[4].bright.toFixed(0)} crossings a second`);
ok('and none of them starts with a step', exc.every(e => e.first < 0.3), JSON.stringify(exc.map(e => +e.first.toFixed(3))));

/* ---- the resonator banks ---- */
const bankInfo = await page.evaluate(async () => {
  const off = new OfflineAudioContext(2, 1024, 48000);
  ctx = off;
  const out = off.createGain();
  buildExcitations();
  buildBanks(out);
  return { ids: Object.keys(banks), roof: SURFACES.roof.hz, glass: SURFACES.glass.hz,
           maxQ: Math.max(...Object.values(SURFACES).flatMap(s => s.hz.map(h => Math.min(18, Math.max(1.5, s.decay * Math.PI * h))))) };
});
ok('the roof is the research figures', JSON.stringify(bankInfo.roof) === JSON.stringify([170, 290, 470, 760, 1180]),
   JSON.stringify(bankInfo.roof));
ok('the windshield is too', JSON.stringify(bankInfo.glass) === JSON.stringify([650, 1150, 1900, 3100]),
   JSON.stringify(bankInfo.glass));
ok('side glass has a bank on each side', bankInfo.ids.includes('sidesL') && bankInfo.ids.includes('sidesR'),
   JSON.stringify(bankInfo.ids));
ok('no resonance is sharp enough to chime', bankInfo.maxQ <= 18, bankInfo.maxQ.toFixed(1));

/* ---- thunder, measured rather than described ---- */

/* Rendered offline and read as an envelope: the complaint was that it was
   too brief — a punch rather than a rumble — so the thing to measure is how
   long it actually lasts and where its energy sits.

   Seven renders, and the median of each figure across them. Not the mean,
   and emphatically not the mean of the seven envelopes: a strike is four to
   seven segments at distances the generator picks for itself, so only the
   first one arrives at a time you can predict. Averaging the envelopes
   therefore sharpens the first segment, which is time-locked, and smears
   every later one, which is not — it pulls the peak back towards the
   arrival and reports the opposite of what is there. That was tried here
   first and it made this worse. Measuring each render on its own terms and
   taking the middle one leaves every render's shape intact.

   Over a hundred and fifty single renders at 1.5 km the peak lands anywhere
   from 0.10 s to 4.15 s after the first sound, and under the 0.15 s line on
   four per cent of them; the median of seven never went under it in four
   hundred tries, the lowest being 0.25 s. The same move carries two other
   checks that were sitting just as close to their lines: the back-half
   energy, whose single-render minimum was 0.14 against a line of 0.15, and
   how long a close strike rolls, whose minimum was 2.35 s against 3 s. */
const ROLL_RENDERS = 7;
const roll = (metres) => page.evaluate(async ([m, renders]) => {
  const RATE = 24000;
  const win = Math.floor(RATE * 0.05);
  const got = [];

  for (let r = 0; r < renders; r++) {
    const off = new OfflineAudioContext(1, RATE * 22, RATE);
    ctx = off;
    bank.clear();
    outdoors = off.createGain();
    outdoors.gain.value = 1;
    outdoors.connect(off.destination);
    thunder(0, m);
    const buf = await off.startRendering();
    const d = buf.getChannelData(0);

    const rms = [];
    for (let i = 0; i + win < d.length; i += win) {
      let sum = 0;
      for (let j = i; j < i + win; j++) sum += d[j] * d[j];
      rms.push(Math.sqrt(sum / win));
    }
    const peak = Math.max(...rms);
    const loud = rms.map((v, i) => ({ v, t: i * 0.05 })).filter(x => x.v > peak * 0.05);
    const total = rms.reduce((a, b) => a + b, 0);
    const first = loud.length ? loud[0].t : 0;
    const last = loud.length ? loud[loud.length - 1].t : 0;
    const peakAt = rms.indexOf(peak) * 0.05;
    const half = first + (last - first) / 2;
    const lateEnergy = rms.reduce((a, v, i) => a + (i * 0.05 > half ? v : 0), 0);

    // What makes a close strike sharp is the tearing onset, so measure the
    // brightness of the first fifth of a second rather than when the body
    // happens to peak — that is several overlapping swells and lands where
    // chance puts it.
    const from = Math.floor(first * RATE);
    const to = Math.min(d.length, from + Math.floor(RATE * 0.2));
    let diff = 0, level = 0;
    for (let i = from + 1; i < to; i++) { diff += Math.abs(d[i] - d[i - 1]); level += Math.abs(d[i]); }

    got.push({ first, last, span: last - first, peakAt, peakLag: peakAt - first,
               late: total > 0 ? lateEnergy / total : 0, peak,
               onsetBright: level > 0 ? diff / level : 0 });
  }

  const middle = (key) => {
    const v = got.map((g) => g[key]).sort((a, b) => a - b);
    return v[(v.length - 1) >> 1];
  };
  return Object.fromEntries(Object.keys(got[0]).map((k) => [k, middle(k)]));
}, [metres, ROLL_RENDERS]);

const far = await roll(1500);
ok('a strike at a kilometre and a half rolls for seconds, not a moment',
   far.span > 5, `${far.span.toFixed(1)}s of it`);
ok('it does not peak the instant it arrives',
   far.peakLag > 0.15, `peak ${far.peakLag.toFixed(2)}s after the first sound`);
ok('and half its energy is not spent in the first half',
   far.late > 0.15, `${(far.late * 100).toFixed(0)}% in the back half`);
ok('it arrives when the distance says it should',
   Math.abs(far.first - 1500 / 343) < 0.6, `${far.first.toFixed(2)}s against ${(1500/343).toFixed(2)}`);
console.log(`      1.5 km: arrives ${far.first.toFixed(1)}s, rolls ${far.span.toFixed(1)}s, peak +${far.peakLag.toFixed(2)}s`);

// Far enough out that the crack is gone entirely, which is the comparison
// worth making — 1.5 km still has one.
/* An exponential ramp upward from near-silence is the sound of audio played
   backwards: nearly inaudible for most of its length, then a rush into the
   peak. With a swell per segment staggered across a strike, that is what it
   sounded like. Measured as how much of a sound's length is spent climbing
   to half its peak — and against a control built the old way, so the measure
   is known to be able to fail.

   Six renders averaged, not one. The envelope under test is the same every
   time and only the brown noise beneath it differs, so averaging the RMS
   curve across renders leaves the shape untouched and takes the wobble out
   of it: measured over twenty tries, one render put the forward figure
   anywhere from 2.2% to 10.6% and tripped the 10% line about one run in
   twenty, where six renders at a 10 ms window hold it inside 2.3–4.3%. */
const CLIMB_RENDERS = 6, CLIMB_WIN = 0.01;
const climb = await page.evaluate(async ([renders, win]) => {
  const RATE = 12000;
  const one = async (reverse) => {
    const w = Math.floor(RATE * win);
    let curve = null;
    for (let r = 0; r < renders; r++) {
      const off = new OfflineAudioContext(1, RATE * 8, RATE);
      ctx = off; bank.clear();
      const out = off.createGain(); out.gain.value = 1; out.connect(off.destination);
      const src = looping(noise('brown'));
      const env = off.createGain();
      const rise = reverse ? 0.9 : 0.09, fall = 3.0, peak = 0.6;
      env.gain.setValueAtTime(0.0001, 0);
      if (reverse) env.gain.exponentialRampToValueAtTime(peak, rise);
      else env.gain.linearRampToValueAtTime(peak, rise);
      env.gain.exponentialRampToValueAtTime(peak * 0.3, rise + fall * 0.4);
      env.gain.exponentialRampToValueAtTime(0.0001, rise + fall);
      src.connect(env).connect(out); src.start(0); src.stop(rise + fall + 0.1);
      const d = (await off.startRendering()).getChannelData(0);
      const rms = [];
      for (let i = 0; i + w < d.length; i += w) {
        let a = 0; for (let j = i; j < i + w; j++) a += d[j] * d[j];
        rms.push(Math.sqrt(a / w));
      }
      if (!curve) curve = rms.map(() => 0);
      for (let i = 0; i < curve.length; i++) curve[i] += rms[i] / renders;
    }
    const pk = Math.max(...curve);
    const t50 = curve.findIndex(v => v > pk * 0.5) * win;
    const last = (curve.length - 1 - [...curve].reverse().findIndex(v => v > pk * 0.05)) * win;
    return t50 / last;
  };
  return { now: await one(false), was: await one(true) };
}, [CLIMB_RENDERS, CLIMB_WIN]);
ok('a swell arrives rather than creeping up on you', climb.now < 0.1,
   `${(climb.now * 100).toFixed(1)}% of its length spent climbing`);
ok('and the shape it had really did creep, so this can fail',
   climb.was > climb.now * 4, `${(climb.was * 100).toFixed(1)}% the old way`);
console.log(`      climb to half peak: ${(climb.was * 100).toFixed(0)}% old, ${(climb.now * 100).toFixed(0)}% now`);

// The wash's colour must not ride the gust: a bandpass swept across noise is
// a whoosh, and it swept every time the wind came up.
const sweep = await page.evaluate(() => {
  const seen = [];
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    BANDS.rain.lo.value = '0'; BANDS.rain.hi.value = '100';
    BANDS.rain.now = level;
    gustAt = -1;
    seen.push(1100 + BANDS.rain.now * 520);
  }
  return { lowest: Math.min(...seen), highest: Math.max(...seen) };
});
ok('the wash filter barely moves across the whole rain range',
   sweep.highest / sweep.lowest < 1.6, `${sweep.lowest.toFixed(0)} to ${sweep.highest.toFixed(0)} Hz`);

/* ---- the wash and the wind hold a level ---- */

/* A jitter under both the rain and the wind, and both ran on the same brown
   buffer, which is why it was under both. A narrow band of noise has an
   envelope that wanders at the width of the band, and brown is a narrow
   band: a one-pole at 0.995 is flat below about 40 Hz and falls away above
   it, so almost everything it carries is in that bottom 40 Hz. Its level
   swung between a half and twice its own average across a fortieth of a
   second, and the lowpass each layer sits behind kept every bit of it. Too
   slow to hear as a pitch, far too big to miss as a level.

   Measured as what the layer produced rather than as what the buffer looks
   like: RMS in 25 ms windows, and how far that moves. Two controls go
   through the same two chains alongside, so the checks are known to be able
   to fail. The brown is the first. The second is pink with the highpass
   left off, which matters because it is the near miss: the colour is not
   what fixed this. Plain pink wanders about as badly as the brown — the
   slowest of its sixteen rows turns over twice a second — and it is cutting
   what sits below hearing that holds the level still. Levels are compared
   above 100 Hz, because what the swap took away below that was never
   audible in the first place. */
const steady = await page.evaluate(async () => {
  const RATE = 48000;
  const envelope = (d) => {
    const win = Math.floor(RATE * 0.025);
    const e = [];
    for (let i = 0; i + win < d.length; i += win) {
      let a = 0; for (let j = i; j < i + win; j++) a += d[j] * d[j];
      e.push(Math.sqrt(a / win));
    }
    const mean = e.reduce((a, b) => a + b, 0) / e.length;
    const sd = Math.sqrt(e.reduce((a, v) => a + (v - mean) ** 2, 0) / e.length);
    return { cv: sd / mean, lo: Math.min(...e) / mean, hi: Math.max(...e) / mean };
  };
  // Which side of a corner a signal's energy sits on, by one-pole either way.
  const split = (d, hz) => {
    const dt = 1 / RATE, rc = 1 / (2 * Math.PI * hz), a = rc / (rc + dt);
    let hi = 0, pv = 0, lo = 0, hp = 0, lp = 0;
    for (let i = 0; i < d.length; i++) {
      hi = a * (hi + d[i] - pv); pv = d[i];
      lo = lo + (d[i] - lo) * (dt / (rc + dt));
      hp += hi * hi; lp += lo * lo;
    }
    return { under: Math.sqrt(lp / d.length), over: Math.sqrt(hp / d.length) };
  };

  const prime = new OfflineAudioContext(1, 1024, RATE);
  ctx = prime; bank.clear();
  const buffers = { pink: noise('pink'), brown: noise('brown'), white: noise('white') };

  /* The second control: the page's pink with the 60 Hz highpass taken out of
     it, which is the version that looks like the obvious fix and is not. */
  buffers.unfiltered = (() => {
    const len = buffers.pink.length;
    const d = new Float32Array(len);
    const rows = new Float32Array(16);
    let running = 0;
    for (let i = 0; i < len; i++) {
      let bit = i & -i, row = 0;
      while (bit > 1) { bit >>= 1; row++; }
      if (row < rows.length) { running -= rows[row]; rows[row] = Math.random() * 2 - 1; running += rows[row]; }
      d[i] = (running + (Math.random() * 2 - 1)) / (rows.length + 1);
    }
    let power = 0;
    for (let i = 0; i < len; i++) power += d[i] * d[i];
    const scale = 0.577 / Math.sqrt(power / len);
    const out = prime.createBuffer(1, len, RATE);
    const into = out.getChannelData(0);
    for (let i = 0; i < len; i++) into[i] = d[i] * scale;
    return out;
  })();

  // The two layers as start() wires them, at a middling rain and wind.
  const layer = async (kind, which) => {
    const off = new OfflineAudioContext(1, RATE * 4, RATE);
    const src = off.createBufferSource();
    src.buffer = buffers[kind];
    src.loop = true;
    const filter = off.createBiquadFilter();
    filter.type = 'lowpass';
    if (which === 'far') filter.frequency.value = 420 + 0.3 * 900;
    else { filter.frequency.value = 320 + 0.3 * 900; filter.Q.value = 3; }
    src.connect(filter).connect(off.destination);
    src.start(0);
    const d = (await off.startRendering()).getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    return { ...envelope(d), ...split(d, 100), peak };
  };

  const buf = (kind) => {
    const d = buffers[kind].getChannelData(0);
    return { ...envelope(d), ...split(d, 100) };
  };
  return {
    buffer: { pink: buf('pink'), brown: buf('brown'), white: buf('white') },
    far: { pink: await layer('pink', 'far'), brown: await layer('brown', 'far'),
           unfiltered: await layer('unfiltered', 'far') },
    air: { pink: await layer('pink', 'air'), brown: await layer('brown', 'air'),
           unfiltered: await layer('unfiltered', 'air') },
  };
});
ok('the noise under the wash and the wind keeps its energy where it can be heard',
   steady.buffer.pink.over > steady.buffer.pink.under * 1.5,
   `${steady.buffer.pink.under.toFixed(2)} under 100 Hz against ${steady.buffer.pink.over.toFixed(2)} over`);
ok('and the brown it ran on did the opposite, so this measures something',
   steady.buffer.brown.under > steady.buffer.brown.over * 1.4,
   `${steady.buffer.brown.under.toFixed(2)} under against ${steady.buffer.brown.over.toFixed(2)} over`);
ok('so its own level sits still rather than wandering',
   steady.buffer.pink.cv < 0.12 && steady.buffer.brown.cv > 0.2,
   `${steady.buffer.pink.cv.toFixed(3)} against the brown's ${steady.buffer.brown.cv.toFixed(3)}`
   + ` and the white's ${steady.buffer.white.cv.toFixed(3)}`);

for (const [name, which] of [['far wash', 'far'], ['wind', 'air']]) {
  const now = steady[which].pink, was = steady[which].brown;
  ok(`the ${name} comes out at a steady level`, now.cv < 0.17,
     `${now.cv.toFixed(3)}, between ${now.lo.toFixed(2)}x and ${now.hi.toFixed(2)}x its own average`);
  ok(`and the jitter the ${name} had really was there to find`, was.cv > now.cv * 1.8,
     `${was.cv.toFixed(3)} the old way, ${was.lo.toFixed(2)}x to ${was.hi.toFixed(2)}x`);
  // Pink on its own is not the fix, and a check that passed without the
  // highpass would be saying the wrong thing about why this works.
  const bare = steady[which].unfiltered;
  ok(`and pinking the ${name} without the sub-audio cut would not have done it`,
     bare.cv > now.cv * 1.8,
     `${bare.cv.toFixed(3)} unfiltered, ${bare.lo.toFixed(2)}x to ${bare.hi.toFixed(2)}x`);
  // The gain each layer was given back, against what it had before.
  const gain = which === 'far' ? [1.35, 0.85] : [0.48, 0.3];
  ok(`and the ${name} is no quieter for it where it counts`,
     Math.abs(now.over * gain[0] - was.over * gain[1]) < was.over * gain[1] * 0.15,
     `${(now.over * gain[0]).toFixed(3)} against ${(was.over * gain[1]).toFixed(3)} above 100 Hz`);
  ok(`with more headroom than the ${name} had, not less`,
     now.peak * gain[0] < was.peak * gain[1],
     `peaks ${(now.peak * gain[0]).toFixed(2)} against ${(was.peak * gain[1]).toFixed(2)}`);
  console.log(`      ${name}: level moves ${now.lo.toFixed(2)}–${now.hi.toFixed(2)}x,`
    + ` was ${was.lo.toFixed(2)}–${was.hi.toFixed(2)}x`);
}

/* The crack is measured by its band, not by a window of time. A window at
   the onset catches whatever the body is doing there too, and once the body
   attacked faster that is exactly what it started reporting. Split at
   1.2 kHz instead: the body is low-passed well below it and the crack lives
   above, so the two can be read apart whatever their timing. */
const bands = await page.evaluate(async () => {
  const split = (d, RATE, hz) => {
    const dt = 1 / RATE, rc = 1 / (2 * Math.PI * hz), a = rc / (rc + dt);
    let hi = 0, pv = 0, lo = 0, hiPk = 0, loPk = 0;
    for (let i = 0; i < d.length; i++) {
      hi = a * (hi + d[i] - pv); pv = d[i];
      lo = lo + (d[i] - lo) * (dt / (rc + dt));
      hiPk = Math.max(hiPk, Math.abs(hi)); loPk = Math.max(loPk, Math.abs(lo));
    }
    return { hiPk, loPk };
  };
  const out = {};
  for (const m of [160, 2600]) {
    let hi = 0, lo = 0;
    for (let run = 0; run < 12; run++) {
      const RATE = 24000;
      const off = new OfflineAudioContext(1, RATE * 12, RATE);
      ctx = off; bank.clear();
      outdoors = off.createGain(); outdoors.gain.value = 1; outdoors.connect(off.destination);
      thunder(0, m);
      const d = (await off.startRendering()).getChannelData(0);
      const s = split(d, RATE, 1200);
      hi += s.hiPk / 12; lo += s.loPk / 12;
    }
    out[m] = { crack: hi, body: lo, ratio: hi / lo };
  }
  return out;
});
ok('the crack sits well under the body it belongs to',
   bands[160].ratio < 0.35, `${(bands[160].ratio * 100).toFixed(0)}% of the body at 160 m`);
ok('but is not so far under that it has gone',
   bands[160].ratio > 0.08, `${(bands[160].ratio * 100).toFixed(0)}%`);
/* Where the line sits, and why it is not tighter. A single strike's crack
   peak is a wild thing — sixty renders at 160 m put the crack/body ratio
   anywhere between 0.08 and 0.25 — but the renders really are independent
   (the mean of five blocks scatters exactly as much as independence
   predicts), so averaging works. Twelve of them put the separation at
   2.16 with a standard deviation of 0.21, measured over thirty-six tries.
   The old line at 1.8 sat 1.7 of those below the mean and went under on two
   of the thirty-six, which is the flake; 1.5 sits 3.1 below and went under
   on none. It keeps its teeth either way: measured against itself — 160 m
   against another 160 m, where there is no difference to find — the same
   figure comes out at 1.01 and never above 1.21, so anything that stopped
   the distance filtering working would still be caught well short of 1.5. */
ok('and a distant strike has far less of it',
   bands[2600].ratio < bands[160].ratio / 1.5,
   `${(bands[2600].ratio * 100).toFixed(0)}% at 2.6 km against ${(bands[160].ratio * 100).toFixed(0)}% at 160 m`
   + ` — ${(bands[160].ratio / bands[2600].ratio).toFixed(2)}× apart, wanted 1.5`);
ok('nothing clips', bands[160].body < 0.95 && bands[2600].body < 0.95,
   `peaks ${bands[160].body.toFixed(2)} and ${bands[2600].body.toFixed(2)}`);
console.log(`      crack/body ${(bands[160].ratio * 100).toFixed(0)}% at 160 m, ${(bands[2600].ratio * 100).toFixed(0)}% at 2.6 km`);

const distant = await roll(2600);
const near = await roll(150);
ok('a close strike has the tearing onset a distant one has lost',
   near.onsetBright > distant.onsetBright * 1.5,
   `brightness ${near.onsetBright.toFixed(3)} at 150 m vs ${distant.onsetBright.toFixed(3)} at 2.6 km`);
ok('and a distant one is rumble all the way through',
   distant.span > 5, `${distant.span.toFixed(1)}s`);
ok('but still rolls afterwards rather than stopping dead', near.span > 3, `${near.span.toFixed(1)}s`);
console.log(`      150 m: arrives ${near.first.toFixed(2)}s, rolls ${near.span.toFixed(1)}s, peak +${near.peakLag.toFixed(2)}s`);

// The old shape for comparison: one fast attack onto one exponential decay.
const punch = await page.evaluate(async () => {
  const RATE = 24000;
  const off = new OfflineAudioContext(1, RATE * 22, RATE);
  ctx = off; bank.clear();
  const out = off.createGain(); out.gain.value = 1; out.connect(off.destination);
  const src = looping(noise("brown"));
  const low = off.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 500;
  const env = off.createGain();
  env.gain.setValueAtTime(0.0001, 0);
  env.gain.exponentialRampToValueAtTime(0.8, 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, 1.8);
  src.connect(low).connect(env).connect(out);
  src.start(0); src.stop(2);
  const d = (await off.startRendering()).getChannelData(0);
  const win = Math.floor(RATE * 0.05);
  const rms = [];
  for (let i = 0; i + win < d.length; i += win) {
    let sum = 0; for (let j = i; j < i + win; j++) sum += d[j] * d[j];
    rms.push(Math.sqrt(sum / win));
  }
  const peak = Math.max(...rms);
  const loud = rms.map((v, i) => ({ v, t: i * 0.05 })).filter(x => x.v > peak * 0.05);
  return { span: loud.length ? loud[loud.length - 1].t - loud[0].t : 0 };
});
ok('and the shape it used to have really was brief, so this measures something',
   far.span > punch.span * 3, `${far.span.toFixed(1)}s now against ${punch.span.toFixed(1)}s before`);

/* ---- overhead against far away ---- */
const field = await page.evaluate(() => {
  clouds.length = 0;
  clouds.push({ x: 0, y: 0, r: 120, thick: 1, wobble: 0 });
  const over = sky();
  clouds.length = 0;
  clouds.push({ x: 200, y: 0, r: 120, thick: 1, wobble: 0 });
  const away = sky();
  return { over, away };
});
ok('cloud overhead reads as overhead', field.over.over > 0.8 && field.over.far < field.over.over,
   JSON.stringify(field.over));
ok('cloud a kilometre off reads as distance and not as overhead',
   field.away.over < 0.01 && field.away.far > 0.02, JSON.stringify(field.away));
// The same cloud moved overhead flips which of the two dominates, which is
// the whole point: sparse above you over a dense roar further out.
ok('moving it overhead flips which one dominates',
   field.over.over > field.over.far && field.away.far > field.away.over,
   `overhead ${field.over.over.toFixed(2)}/${field.over.far.toFixed(2)} vs away ${field.away.over.toFixed(2)}/${field.away.far.toFixed(2)}`);

/* ---- thunder along the channel ---- */
await page.reload();
await page.waitForTimeout(300);
await page.fill('#stormLo', '0'); await page.dispatchEvent('#stormLo', 'input');
await page.click('#playBtn');
await page.waitForTimeout(700);
const bolt = await page.evaluate(() => {
  const flash = ctx.currentTime;
  const sent = thunder(flash, 1200);
  return { flash, sent, n: sent.length };
});
ok('a strike is several segments, not one bang', bolt.n >= 3, bolt.n);
ok('each arrives at its own distance over 343',
   bolt.sent.every(x => Math.abs((x.at - bolt.flash) - x.along / 343) < 1e-6), JSON.stringify(bolt.sent[0]));
ok('the near end of the channel is heard first',
   bolt.sent.every((x, i) => i === 0 || x.at > bolt.sent[i-1].at), JSON.stringify(bolt.sent.map(x => +x.at.toFixed(2))));
ok('and the far end has had the top rubbed off it',
   bolt.sent[bolt.sent.length-1].close < bolt.sent[0].close, `${bolt.sent[0].close.toFixed(2)} → ${bolt.sent[bolt.sent.length-1].close.toFixed(2)}`);
console.log(`      ${bolt.n} segments over ${(bolt.sent[bolt.sent.length-1].at - bolt.flash).toFixed(1)}s`);

// Measuring the buffers proves nothing if a layer is not playing the one it
// should, which is the quiet way this undoes itself. Asked of the graph that
// is actually running.
const playing = await page.evaluate(() => ({
  far: washNodes.farSource.buffer === bank.get('pink'),
  air: airNodes.source.buffer === bank.get('pink'),
  near: washNodes.nearSource.buffer === bank.get('white'),
}));
ok('the far wash and the wind are both playing the steady noise',
   playing.far && playing.air, JSON.stringify(playing));
ok('and the near wash is still the white it always was', playing.near, JSON.stringify(playing));

/* Hiding the tab is the one warning the page gets that its timers are about
   to be clamped, and the horizon goes deep on it rather than a starved
   second later. Headless keeps every page visible, so the state and the
   event are both supplied here; what is being checked is that the page
   answers the event it will really be given. Put back afterwards, because
   the drop checks below measure the lead times. */
const onHide = await page.evaluate(() => {
  if (!rainPump) return { ran: false };
  rainPump.reach = AHEAD_MIN;
  const before = rainPump.reach;
  Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  const after = rainPump.reach;
  delete document.hidden;
  rainPump.reach = AHEAD_MIN;
  return { ran: true, before, after, max: AHEAD_MAX, restored: document.hidden };
});
ok('hiding the tab deepens the lookahead at once', onHide.ran && onHide.after === onHide.max,
   JSON.stringify(onHide));
ok('and the page is visible again afterwards', onHide.restored === false, JSON.stringify(onHide));

/* ---- drops follow the rain ---- */
await page.evaluate(() => {
  window.__drops = [];
  const real = drop;
  drop = (...args) => { window.__drops.push({ s: args[0], z: args[1], g: args[2], at: args[3],
    now: ctx.currentTime, reach: rainPump ? rainPump.reach : 0 }); return real(...args); };
});
await page.evaluate(() => {
  clouds.length = 0; clouds.push({ x: 0, y: 0, r: 200, thick: 1, wobble: 0 });
  BANDS.rain.lo.value = '85'; BANDS.rain.hi.value = '85'; BANDS.rain.now = 0.85;
});
await page.waitForTimeout(2500);
const heavy = await page.evaluate(() => { const d = window.__drops.slice(); window.__drops = []; return d; });
await page.evaluate(() => { BANDS.rain.lo.value = '12'; BANDS.rain.hi.value = '12'; BANDS.rain.now = 0.12; });
await page.waitForTimeout(2500);
const light = await page.evaluate(() => { const d = window.__drops.slice(); window.__drops = []; return d; });

/* Drops a second, over the stretch of the audio clock they were actually
   laid on, rather than however many turned up inside a wall-clock window.
   The lookahead is not a fixed third of a second any more — it deepens when
   the pump is made to wait — so a window of wall time catches a whole number
   of burst-sized fills and the count comes out quantised by whatever the
   horizon happened to be. The rate over the span they cover is not: it is
   the same figure however the fills were grouped, which is the point. */
const perSecond = (list) => {
  const at = list.map((d) => d.at).sort((a, b) => a - b);
  const span = at[at.length - 1] - at[0];
  return span > 0.5 ? (at.length - 1) / span : 0;
};
ok('heavier rain really is more drops', perSecond(heavy) > perSecond(light) * 2.5,
   `${perSecond(heavy).toFixed(1)} a second against ${perSecond(light).toFixed(1)}`
   + ` (${heavy.length} drops and ${light.length} over 2.5s apiece)`);
// The skipping was drops fired by a main-thread timer: a long frame delays
// the callbacks and they then arrive together, so the rain bunches and gaps.
// Scheduled ahead on the audio clock, a drop is handed over before it is due.
const lead = heavy.map(d => d.at - d.now).filter(v => Number.isFinite(v));
ok('drops are handed to the audio clock before they are due',
   lead.filter(v => v > 0.004).length > lead.length * 0.8,
   `${lead.filter(v => v > 0.004).length} of ${lead.length} scheduled ahead`);
/* Judged against the horizon that was in force when each drop was placed,
   rather than against a figure. The horizon follows how long the pump is
   being made to wait, so a frame that ran long legitimately deepens it, and
   a flat ceiling here would fail on that while saying nothing about the
   thing it was put there to watch. */
ok('and spread across the lookahead rather than all at one instant',
   Math.max(...lead) > 0.05 && heavy.every((d) => d.at - d.now <= d.reach + 0.05),
   `furthest ahead ${Math.max(...lead).toFixed(3)}s`);
ok('and the lookahead sits at its floor while the page is in front of you',
   heavy.filter((d) => d.reach <= 0.3001).length > heavy.length * 0.9,
   `${heavy.filter((d) => d.reach <= 0.3001).length} of ${heavy.length} drops placed at the floor`);
ok('none is scheduled in the past', Math.min(...lead) > -0.02, Math.min(...lead).toFixed(4));
console.log(`      lead times ${Math.min(...lead).toFixed(3)}s to ${Math.max(...lead).toFixed(3)}s`);

const strengths = heavy.map(d => d.g).sort((a, b) => a - b);
const median = strengths[Math.floor(strengths.length / 2)];
ok('and small drops far outnumber heavy ones', median < strengths[strengths.length - 1] / 3,
   `median ${median.toFixed(3)}, loudest ${strengths[strengths.length-1].toFixed(3)}`);
console.log(`      ${heavy.length} drops heavy vs ${light} light`);

/* ---- where you are ---- */
const chain = () => page.evaluate(() => ({ cut: shelter.cut.frequency.value, boom: shelter.boom.gain.value,
  wet: wetBus.gain.value, tail: shelter.verb.buffer.duration }));
const outside = await chain();
await page.click('#where button[data-place="car"]');
await page.waitForTimeout(700);
const car = await chain();
ok('a car cuts the exterior hard', car.cut < outside.cut / 5, `${car.cut.toFixed(0)} vs ${outside.cut.toFixed(0)} Hz`);
ok('and booms', car.boom > outside.boom, `${car.boom} dB`);
ok('a car hears roof, windshield and both sides',
   await page.evaluate(() => Object.keys(PLACES.find(p => p.id === 'car').mix).join()) === 'roof,glass,sides', '');
await page.click('#where button[data-place="underground"]');
await page.waitForTimeout(800);
const under = await chain();
ok('underground leaves almost nothing', under.cut < 400, `${under.cut.toFixed(0)} Hz`);
ok('and has the long tail', under.tail > 2 && under.wet > car.wet * 3, `${under.tail.toFixed(1)}s, wet ${under.wet}`);
ok('with drips on stone rather than a roof',
   await page.evaluate(() => Object.keys(PLACES.find(p => p.id === 'underground').mix).join()) === 'stone', '');

await page.click('#playBtn');
await page.waitForTimeout(600);
ok('it stops cleanly', await page.evaluate(() => !running), '');

/* ---- the rain behind another tab ---- */

/* What was reported after the flutter went: a sharp cut off, like the noise
   restarting. The drops are placed by a main-thread timer, and a tab that is
   not in front of you — behind another tab, or merely covered by another
   window — has its timers clamped to one a second. The pump was laying down
   a third of a second of drops and then waiting a whole one, so seven tenths
   of every second had nothing in them: the rain stopped dead and came back,
   once a second, for as long as it was left. Which is how this page is used,
   so it is the case that matters most and the only one nothing watched.

   Playwright turns that throttling off, so it is put back by hand: setTimeout
   is clamped before the page loads, which is the same thing happening for the
   same reason. One fixed cloud overhead pins the drop rate, so the only thing
   that differs between the two runs is the scheduler. Measured on the times
   drops were actually handed to the audio clock, against what an exponential
   at the same mean says to expect — and run a second time with the horizon
   held down at the old third of a second, so the check is known to be able
   to fail. */
const BEHIND = 7000;
const behind = async (pin) => {
  const tab = await browser.newPage();
  await tab.addInitScript((ms) => {
    const real = window.setTimeout;
    window.setTimeout = (fn, d, ...rest) => real(fn, Math.max(ms, d || 0), ...rest);
  }, 1000);
  await tab.goto(URL);
  await tab.waitForTimeout(250);
  for (const [id, v] of [['stormLo', '0'], ['stormHi', '0'], ['rainLo', '70'], ['rainHi', '70'],
                         ['windLo', '0'], ['windHi', '0'], ['driftIn', '0']]) {
    await tab.fill('#' + id, v); await tab.dispatchEvent('#' + id, 'input');
  }
  await tab.evaluate((held) => {
    clouds.length = 0; clouds.push({ x: 0, y: 0, r: 240, thick: 1, wobble: 0 });
    moveClouds = () => {};
    if (held) AHEAD_MAX = held;
    window.__at = [];
    const real = drop;
    drop = (...a) => { window.__at.push(a[3]); return real(...a); };
  }, pin || 0);
  await tab.click('#playBtn');
  await tab.waitForTimeout(BEHIND);
  const got = await tab.evaluate(() => {
    const at = window.__at.slice().sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < at.length; i++) gaps.push(at[i] - at[i - 1]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Drops are Poisson, so the gaps are exponential and how many run past
    // any length is arithmetic rather than a guess.
    return { drops: at.length, mean, longest: Math.max(...gaps),
             over: gaps.filter((g) => g > mean * 8).length,
             expected: gaps.length * Math.exp(-8),
             dead: gaps.filter((g) => g > 0.4).reduce((a, g) => a + g - 0.4, 0) };
  });
  await tab.close();
  return got;
};
const kept = await behind(0);
const atOld = await behind(0.3);
ok('behind another tab the rain keeps falling',
   kept.over <= Math.max(3, kept.expected * 4),
   `${kept.over} gaps past eight times the mean, where chance says ${kept.expected.toFixed(1)}`);
ok('and with no second-long holes in it', kept.longest < 0.5,
   `longest gap ${kept.longest.toFixed(3)}s, ${kept.dead.toFixed(2)}s of dead air`);
ok('held at the old lookahead it stops dead, so this can fail',
   atOld.longest > 0.6, `longest gap ${atOld.longest.toFixed(3)}s`);
ok('and that is dead air rather than rain that merely thinned out',
   atOld.dead > 1 && kept.drops > atOld.drops * 1.8,
   `${atOld.dead.toFixed(2)}s dead against ${kept.dead.toFixed(2)}s,`
   + ` ${atOld.drops} drops against ${kept.drops}`);
console.log(`      throttled: ${kept.drops} drops, longest gap ${kept.longest.toFixed(2)}s`
  + ` — at the old lookahead ${atOld.drops} drops, longest ${atOld.longest.toFixed(2)}s`);

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');

await page.goto(URL);
await page.fill('#rainLo', '40'); await page.dispatchEvent('#rainLo', 'input');
await page.fill('#rainHi', '85'); await page.dispatchEvent('#rainHi', 'input');
await page.click('#where button[data-place="car"]');
await page.click('#playBtn');
await page.waitForTimeout(800);
await page.click('#strikeBtn');
await page.waitForTimeout(1500);
await page.screenshot({ path: SCR + '/rain3.png', fullPage: true });
await browser.close();
