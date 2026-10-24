/* games/approach — the air traffic one.

   The rules worth checking are nearly all about the middle of a run rather
   than the end of it: that an aircraft only lands when it crosses the right
   end of the right strip pointing roughly the right way, that none of them
   ever turns faster than it is allowed to, that two of them touching ends
   the shift. So most of this steps the page's own loop a sixtieth at a time
   and watches, rather than running to the end and reading a number.

   The one property worth more than the rest is the last section. An arrival
   is only accepted into the sector if nothing comes near it for the next
   eleven seconds, which is what stops the game handing you a collision you
   could never have prevented. A first version sampled that check every half
   second, and two darts closing head-on cover a hundred units between
   samples; it let a pair through that then hit nine seconds into a shift
   nobody had touched. It is solved rather than sampled now, and the test
   plays every field on twenty-five seeds with nobody at the console. */

import { chromium, CHROMIUM_BIN, WORK, SITE, scoring } from "../lib/env.mjs";

const { ok, done } = scoring();

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto(`${SITE}/games/approach/`);
await page.waitForFunction(() => window.GAME && GAME.S);

await page.addScriptTag({ content: `
/* Step until something is true, or give up. Everything below needs to find
   an aircraft in a particular state before it can do anything to it. This
   stands in for the page's own loop, so like the loop it brings the counters
   up to date when it stops — otherwise the readouts under the scope are
   whatever they said before the test started stepping. */
window.until = function (test, secs = 120) {
  const out = (v) => { GAME.refresh(); return v; };
  for (let i = 0, n = Math.round(secs / GAME.STEP); i < n; i++) {
    const got = test();
    if (got) return out(got);
    GAME.step(GAME.STEP);
    if (GAME.S.over) return out(null);
  }
  return out(test() || null);
};
/* The centreline of a strip, from well out to the threshold — what a player
   draws, and the only way onto a runway. */
window.finalFor = function (s) {
  if (s.type === "pad") return [{ x: s.x, y: s.y }];
  const dx = Math.cos(s.hdg), dy = Math.sin(s.hdg);
  let back = 0;
  while (back < 1200) {
    const x = s.x - dx * (back + 2), y = s.y - dy * (back + 2);
    if (x < 20 || y < 20 || x > GAME.FW - 20 || y > GAME.FH - 20) break;
    back += 2;
  }
  return [...new Set([Math.min(back, 340), Math.min(back, 165), 0])]
    .map((d) => ({ x: s.x - dx * d, y: s.y - dy * d }));
};
window.spotFor = (c) => GAME.S.field.spots.find((s) => s.k === c.k);
` });

/* Field units to the page, so a drag can be done with a real pointer. */
const toScreen = async (pts) => page.evaluate((ps) => {
  const r = document.getElementById("cv").getBoundingClientRect();
  return ps.map((p) => [r.left + (p.x / GAME.FW) * r.width, r.top + (p.y / GAME.FH) * r.height]);
}, pts);

async function dragAlong(pts) {
  const screen = await toScreen(pts);
  await page.mouse.move(screen[0][0], screen[0][1]);
  await page.mouse.down();
  for (const [x, y] of screen.slice(1)) await page.mouse.move(x, y, { steps: 14 });
  await page.mouse.up();
}

const stat = (id) => page.textContent(`#${id} b`);

/* The game's own numbers, so the suite checks against them rather than
   against a second copy that could drift. */
const RULE = await page.evaluate(() => ({ CATCH: GAME.CATCH, CRASH: GAME.CRASH, WARN: GAME.WARN }));

/* ------------------------------------------------- the same shift twice -- */

const twice = await page.evaluate(() => {
  const run = (seed) => {
    GAME.load("coast", seed);
    const log = [];
    let seen = 0;
    GAME.fast(90, () => {
      for (const c of GAME.S.craft) {
        if (c.id > seen) {
          seen = c.id;
          log.push(`${c.id}:${c.k}:${Math.round(c.x)},${Math.round(c.y)}:${GAME.S.t.toFixed(2)}`);
        }
      }
    });
    return log;
  };
  const a = run(99), b = run(99), c = run(100);
  return { same: JSON.stringify(a) === JSON.stringify(b), other: JSON.stringify(a) === JSON.stringify(c), n: a.length };
});
ok("the same seed deals the same shift", twice.same && twice.n > 4, `${twice.n} arrivals`);
ok("a different seed deals a different one", !twice.other);

/* ----------------------------------------------------- flying one down --- */

/* A dart already on the approach side of the runway, so that a line straight
   down the centreline is a line it can fly. One that arrives from behind the
   threshold has to be turned the long way round first, which is a fair thing
   to ask of a player and an unfair thing to ask of a three-point drag. */
await page.evaluate(() => GAME.load("coast", 4));
const first = await page.evaluate(() => until(() => {
  const s = GAME.S.field.spots.find((x) => x.type === "runway");
  const c = GAME.S.craft.find((x) => x.k === s.k && !x.down && x.x < s.x - 180);
  return c ? { id: c.id, x: c.x, y: c.y } : null;
}, 240));
ok("a dart turns up on the approach side", !!first, JSON.stringify(first));

const legs = await page.evaluate((id) => {
  const c = GAME.S.craft.find((x) => x.id === id);
  return [{ x: c.x, y: c.y }, ...finalFor(spotFor(c))];
}, first.id);
await dragAlong(legs);
ok("the drag gave it a route", await page.evaluate((id) =>
  GAME.S.craft.find((c) => c.id === id).path.length > 1, first.id));

const landedIt = await page.evaluate((id) => {
  until(() => GAME.S.landed > 0 || !GAME.S.craft.some((c) => c.id === id), 120);
  return { landed: GAME.S.landed, over: GAME.S.over && GAME.S.over.head };
}, first.id);
ok("and it lands on the strip of its own colour", landedIt.landed > 0,
  `${landedIt.landed} landed, ${landedIt.over || "still going"}`);
ok("the counter says so", Number(await stat("stDown")) > 0, await stat("stDown"));

/* ------------------------------------------------------ the heading rule -- */

/* Put one right on the threshold and turn it, which is the only way to ask
   the heading question precisely: at what angle does the same aircraft, over
   the same spot, stop being allowed to land? */
const angles = await page.evaluate(() => {
  GAME.load("coast", 4);
  const s = GAME.S.field.spots.find((x) => x.type === "runway");
  const c = until(() => GAME.S.craft.find((x) => x.k === s.k && !x.down));
  if (!c) return { got: false };
  const out = [];
  for (const deg of [0, 20, 40, 90, 180]) {
    c.down = null; c.path = [];
    c.x = s.x - Math.cos(s.hdg) * 2; c.y = s.y - Math.sin(s.hdg) * 2;
    c.hdg = GAME.wrap(s.hdg + deg / 57.2958);
    const before = GAME.S.landed;
    GAME.step(GAME.STEP);
    out.push({ deg, landed: GAME.S.landed > before || !!c.down });
    if (c.down) { c.down = null; GAME.S.landed = before; }
  }
  return { got: true, out, tol: Math.round(GAME.TOL * 57.2958) };
});
ok("over the threshold and lined up, it lands", angles.got && angles.out[0].landed,
  JSON.stringify(angles.out));
ok(`a little off is still allowed (tolerance ${angles.tol}°)`, angles.out[1].landed,
  JSON.stringify(angles.out[1]));
ok("well off is not, however exactly it crosses",
  !angles.out[2].landed && !angles.out[3].landed && !angles.out[4].landed,
  JSON.stringify(angles.out.slice(2)));

/* ------------------------------------------------------------ the pad ---- */

const pad = await page.evaluate(() => {
  GAME.load("coast", 4);
  const s = GAME.S.field.spots.find((x) => x.type === "pad");
  const c = until(() => GAME.S.craft.find((x) => x.k === s.k && !x.down));
  if (!c) return { got: false };
  const from = Math.atan2(c.y - s.y, c.x - s.x);
  c.path = [{ x: s.x, y: s.y }];
  const before = GAME.S.landed;
  until(() => GAME.S.landed > before, 120);
  const live = GAME.S.craft.find((x) => x.id === c.id);
  return { got: true, scored: GAME.S.landed > before,
           heading: live && live.down ? Math.round(GAME.wrap(live.hdg - from) * 57.3) : null };
});
ok("a pad takes a rotor from whatever direction it arrives", pad.got && pad.scored,
  JSON.stringify(pad));

const mismatch = await page.evaluate(() => {
  GAME.load("coast", 4);
  const pad = GAME.S.field.spots.find((x) => x.type === "pad");
  const c = until(() => GAME.S.craft.find((x) => x.k !== pad.k && !x.down));
  if (!c) return { got: false };
  c.path = [{ x: pad.x, y: pad.y }];
  const before = GAME.S.landed;
  until(() => !GAME.S.craft.some((x) => x.id === c.id), 90);
  return { got: true, scored: GAME.S.landed > before };
});
ok("and takes nothing else, however squarely it arrives", mismatch.got && !mismatch.scored,
  JSON.stringify(mismatch));

/* A line drawn tighter than the aircraft can fly is a line it overshoots,
   and what it must do then is carry on to the next point rather than wheel
   round to collect the one it missed. Getting this wrong was not subtle: a
   dart handed an ordinary three-point approach spiralled back out of the
   sector and diverted every time. */
const corner = await page.evaluate(() => {
  GAME.load("coast", 4);
  const c = until(() => GAME.S.craft.find((x) => !x.down && x.k === 0));
  if (!c) return { got: false };
  c.x = 200; c.y = 200; c.hdg = 0;                      // due east, in clear air
  const legs = [];
  for (let d = 20; d <= 180; d += 20) legs.push({ x: 200 + d, y: 200 });
  for (let d = 20; d <= 320; d += 20) legs.push({ x: 380, y: 200 + d });   // a square corner
  c.path = legs;
  const aim = Math.PI / 2;                              // the last leg runs due south
  let turnedBack = false;
  until(() => {
    const live = GAME.S.craft.find((x) => x.id === c.id);
    if (!live || live.down) return true;
    if (Math.abs(GAME.wrap(live.hdg - aim)) > Math.PI * 0.75) turnedBack = true;
    return live.path.length === 0;
  }, 40);
  const live = GAME.S.craft.find((x) => x.id === c.id);
  return { got: true, turnedBack, left: live ? live.path.length : 0,
           off: live ? Math.round(Math.abs(GAME.wrap(live.hdg - aim)) * 57.3) : null,
           gone: !live };
});
ok("a corner drawn tighter than it can fly is overshot, not collected",
  corner.got && !corner.turnedBack, JSON.stringify(corner));
ok("and it works through the rest of the route", corner.got && corner.left === 0 && !corner.gone,
  JSON.stringify(corner));
ok("and comes out of it still going broadly the way the route ends",
  corner.off !== null && corner.off < 90, `${corner.off}° off the last leg`);

/* -------------------------------------------------- how hard they turn --- */

const turning = await page.evaluate(() => {
  GAME.load("hub", 11);
  const was = new Map();
  let worst = 0, sharpest = "";
  GAME.fast(150, () => {
    for (const c of GAME.S.craft) {
      if (!c.down) {
        if (!c.path.length) c.path = finalFor(spotFor(c));     // make them all turn
        if (was.has(c.id)) {
          const swung = Math.abs(GAME.wrap(c.hdg - was.get(c.id))) / GAME.STEP;
          const over = swung / c.turn;
          if (over > worst) { worst = over; sharpest = GAME.KINDS[c.k].key; }
        }
      }
      was.set(c.id, c.hdg);
    }
  });
  return { worst: +worst.toFixed(4), sharpest };
});
ok("nothing ever turns faster than it is allowed to",
  turning.worst <= 1.0001, `worst was ${turning.worst}× its own rate (${turning.sharpest})`);

/* ------------------------------------------------------- losing it all --- */

const bump = await page.evaluate(() => {
  GAME.load("crosswind", 3);
  const a = until(() => GAME.S.craft.find((c) => !c.down));
  if (!a) return { got: false };
  // hold one in a tight circle and send the next one to the middle of it
  const cx = a.x, cy = a.y;
  const ring = [];
  for (let i = 1; i <= 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    ring.push({ x: cx + Math.cos(t) * 45, y: cy + Math.sin(t) * 45 });
  }
  a.path = ring;
  let warned = false;
  const over = (() => {
    for (let i = 0; i < 60 * 180; i++) {
      for (const c of GAME.S.craft) {
        if (c.id !== a.id && !c.down && c.path.length === 0) c.path = [{ x: cx, y: cy }];
        if (!a.path.length) a.path = ring.map((p) => ({ ...p }));
      }
      GAME.step(GAME.STEP);
      if (GAME.S.craft.some((c) => c.near)) warned = true;
      if (GAME.S.over) return GAME.S.over;
    }
    return null;
  })();
  return { got: true, over: over && over.head, why: over && over.why, warned,
           closest: Math.round(GAME.S.closest) };
});
ok("two aircraft brought together end the shift", bump.over === "Loss of separation",
  JSON.stringify(bump));
ok("they light up before they touch", bump.warned);
ok("and the closest approach is recorded", bump.closest <= RULE.CRASH, bump.closest);
ok("the banner says what happened", /came together after/.test(await page.textContent("#bWhy")),
  await page.textContent("#bWhy"));
ok("a score is kept the moment it is earned, not only when the shift ends",
  await page.evaluate(() => ((JSON.parse(localStorage.getItem("approach.best")) || {}).coast || 0) >= 1),
  await page.evaluate(() => localStorage.getItem("approach.best")));

const away = await page.evaluate(() => {
  GAME.load("coast", 4);
  const c = until(() => GAME.S.craft.find((x) => !x.down));
  if (!c) return { got: false };
  c.path = [{ x: c.x + Math.cos(c.hdg) * 40, y: c.y + Math.sin(c.hdg) * 40 },
            { x: -400, y: -400 }];                      // straight out of the sector
  until(() => GAME.S.diverted > 0, 120);
  return { got: true, diverted: GAME.S.diverted, over: GAME.S.over && GAME.S.over.head };
});
ok("flying one out of the sector diverts it rather than ending the shift",
  away.got && away.diverted > 0 && !away.over, JSON.stringify(away));

/* -------------------------------------------- nobody at the console ----- */

/* The arrival guard, which is the fairness of the whole thing: leave it
   entirely alone and nothing should hit anything for a good while. */
const fair = await page.evaluate(() => {
  const out = {};
  for (const f of GAME.FIELDS) {
    let crashed = 0, arrivals = 0, soonest = Infinity;
    for (let seed = 1; seed <= 25; seed++) {
      GAME.load(f.id, seed);
      const over = GAME.fast(60);
      arrivals += GAME.S.nextId - 1;
      if (over) { crashed++; soonest = Math.min(soonest, GAME.S.t); }
    }
    out[f.id] = { crashed, arrivals, soonest: soonest === Infinity ? null : Math.round(soonest) };
  }
  return out;
});
for (const [id, r] of Object.entries(fair)) {
  ok(`${id}: a minute untouched hits nothing, over 25 shifts`, r.crashed === 0,
    `${r.crashed} crashes in ${r.arrivals} arrivals, soonest ${r.soonest}s`);
}

/* ---------------------------------------------------------- the routes -- */

await page.evaluate(() => GAME.load("coast", 4));
const tap = await page.evaluate(() =>
  until(() => { const c = GAME.S.craft.find((x) => !x.down); return c ? { id: c.id, x: c.x, y: c.y } : null; }));
await dragAlong([{ x: tap.x, y: tap.y }, { x: tap.x + 120, y: tap.y + 90 }, { x: tap.x + 230, y: tap.y + 60 }]);
ok("a drag sets a route", await page.evaluate((id) =>
  GAME.S.craft.find((c) => c.id === id).path.length > 1, tap.id));
const spot = (await toScreen([{ x: tap.x, y: tap.y }]))[0];
await page.mouse.move(spot[0], spot[1]);
await page.mouse.down();
await page.mouse.up();
ok("a tap with no drag tears it up again", await page.evaluate((id) =>
  GAME.S.craft.find((c) => c.id === id).path.length === 0, tap.id));
ok("and the page says so", /fly straight on/.test(await page.textContent("#say")),
  await page.textContent("#say"));

const miss = await page.evaluate(() => {
  const r = document.getElementById("cv").getBoundingClientRect();
  return { r: { left: r.left, top: r.top, w: r.width, h: r.height } };
});
await page.mouse.move(miss.r.left + 8, miss.r.top + 8);
await page.mouse.down();
await page.mouse.up();
ok("a drag that starts on nothing is refused", /on an aircraft/.test(await page.textContent("#say")),
  await page.textContent("#say"));

/* ----------------------------------------------------------- the paint -- */

const painted = await page.evaluate(() => {
  GAME.load("crosswind", 4);
  GAME.draw();
  const cv = document.getElementById("cv");
  const g = cv.getContext("2d");
  const scale = cv.width / GAME.FW;
  const read = (x, y) => {
    const d = g.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const out = {};
  for (const s of GAME.S.field.spots) {
    const mid = s.type === "pad" ? { x: s.x, y: s.y }
      : { x: s.x + Math.cos(s.hdg) * s.len * 0.5, y: s.y + Math.sin(s.hdg) * s.len * 0.5 };
    out[GAME.KINDS[s.k].key] = read(mid.x, mid.y);
  }
  out.empty = read(60, 640);
  return out;
});
ok("the dart's runway is painted amber", painted.dart[0] > painted.dart[2] + 30, JSON.stringify(painted.dart));
ok("the cross's is not", painted.cross[2] > painted.cross[0] + 30, JSON.stringify(painted.cross));
ok("nor is the rotor's pad", painted.rotor[0] > painted.rotor[1] + 30
  && painted.rotor[2] > painted.rotor[1] + 20, JSON.stringify(painted.rotor));
ok("and empty sky is black", painted.empty.every((v) => v < 30), JSON.stringify(painted.empty));

await page.setViewportSize({ width: 390, height: 900 });
await page.evaluate(() => GAME.load("hub", 4));
await page.waitForTimeout(250);
const narrow = await page.evaluate(() => ({
  cv: document.getElementById("cv").getBoundingClientRect().width,
  body: document.body.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
ok("the scope fits a phone", narrow.cv <= narrow.body + 1 && narrow.scroll <= 390, JSON.stringify(narrow));
await page.setViewportSize({ width: 1200, height: 1000 });

await page.evaluate(() => {
  GAME.load("crosswind", 42);
  const done = new Set();
  GAME.fast(46, () => {
    for (const c of GAME.S.craft) {
      if (c.down || done.has(c.id)) continue;
      c.path = finalFor(spotFor(c));
      done.add(c.id);
    }
  });
});
await page.locator("#scope").screenshot({ path: `${WORK}/approach.png` });
ok("a scope draws", true);

/* --------------------------------------------------------- the two hubs -- */

await page.goto(`${SITE}/games/`);
ok("the games page links it", (await page.locator('a[href="approach/"]').count()) === 1);
await page.goto(`${SITE}/index.html`);
ok("and the index links it too", (await page.locator('a[href="games/approach/"]').count()) === 1);

ok("nothing shouted at the console", errs.length === 0, errs.join(" | "));

await browser.close();
process.exit(done());
