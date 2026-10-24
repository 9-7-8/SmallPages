/* games/gridlock — the traffic puzzle.

   A game is harder to test than a converter: there is no saved file to reload
   and read back. What stands in for it here is the run itself. The suite draws
   road with real pointer drags, presses Play, and then reads what the board
   did — which cars got home, which cell held how many of them, what the banner
   says at the end. The simulation is a fixed step with nothing random in it,
   so a run is reproducible to the frame, and `GL.fast()` is the page's own
   loop with the waiting taken out rather than a second copy of the rules.

   The half of it worth having is the last section. Three levels exist to teach
   one piece each, and the claim that the piece is needed is a claim about what
   happens when it is missing: each of those levels is played through twice,
   once without and once with, and the test fails if the one without wins. */

import { chromium, CHROMIUM_BIN, WORK, SITE, scoring } from "./lib/env.mjs";

const { ok, done } = scoring();
const URL = `${SITE}/games/gridlock/`;

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.goto(URL);
await page.waitForFunction(() => window.GL && GL.S);

/* Wire every blob that makes cars to one that takes them, cheapest first and
   reusing road already laid. A poor player, which is the point: if this gets a
   level home then the level is wireable, and if it cannot then the budget or
   the walls are wrong. */
await page.addScriptTag({ content: `
window.wire = function () {
  const S = GL.S, n = S.n;
  for (const [from, k] of [...S.blob].filter(([,b]) => b.kind === 'src').map(([c,b]) => [c, b.k])) {
    const goal = new Set([...S.blob].filter(([,x]) => x.kind === 'dst' && x.k === k).map(([c]) => c));
    const dist = new Int32Array(n).fill(1e9), prev = new Int32Array(n).fill(-1);
    dist[from] = 0;
    const open = [from];
    while (open.length) {
      open.sort((a, b) => dist[a] - dist[b]);
      const u = open.shift();
      if (goal.has(u)) break;
      const [ux, uy] = GL.xy(u);
      for (let d = 0; d < 4; d++) {
        const x = ux + [0,1,0,-1][d], y = uy + [-1,0,1,0][d];
        if (x < 0 || y < 0 || x >= S.W || y >= S.H) continue;
        const v = y * S.W + x;
        if (!GL.canLink(u, v)) continue;
        const w = S.out[u].includes(v) ? 0 : 1;
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; open.push(v); }
      }
    }
    let best = -1;
    for (const g of goal) if (dist[g] < 1e9 && (best < 0 || dist[g] < dist[best])) best = g;
    if (best < 0) return { ok: false, kind: k };
    const path = [];
    for (let c = best; c >= 0; c = prev[c]) path.push(c);
    path.reverse();
    for (let i = 0; i < path.length - 1; i++) GL.addLink(path[i], path[i + 1]);
  }
  GL.reroute();
  return { ok: true, links: S.links };
};
window.run = function (id, furniture = [], secs = 300) {
  GL.load(id);
  const w = wire();
  if (!w.ok) return { wired: false };
  for (const [x, y, what] of furniture) { GL.S.kit[what] = 9; GL.place(GL.cell(x, y), what); }
  GL.reroute();
  const over = GL.fast(secs);
  return { wired: true, links: GL.S.links, budget: GL.S.lvl.budget, goal: GL.S.lvl.goal,
           delivered: GL.S.delivered, creeps: GL.S.creeps, t: +GL.S.t.toFixed(1),
           flow: GL.S.carSum ? Math.round(GL.S.moveSum / GL.S.carSum * 100) : 0,
           outcome: over ? (over.win ? 'WIN' : over.head) : 'TIMEOUT' };
};
/* Step a level in small bites and watch, which is the only way to see things
   that are true in the middle of a run and not at the end of it. */
window.watch = function (secs, look) {
  for (let i = 0; i < Math.round(secs / GL.STEP); i++) {
    GL.step(GL.STEP);
    look();
    if (GL.S.over) break;
  }
};` });

const drag = async (cells) => {
  const pts = await page.evaluate((cs) => {
    const r = document.getElementById("cv").getBoundingClientRect();
    return cs.map(([x, y]) => [r.left + (x + 0.5) * r.width / GL.S.W,
                               r.top + (y + 0.5) * r.height / GL.S.H]);
  }, cells);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
};
const links = () => page.evaluate(() =>
  GL.S.out.flatMap((vs, a) => vs.map((b) => [...GL.xy(a), ...GL.xy(b)].join(","))).sort());
const say = () => page.textContent("#say");
const stat = (id) => page.textContent(`#${id} b`);

/* ------------------------------------------------------- drawing road --- */

await page.evaluate(() => GL.load("first-light"));
await drag([[2, 3], [3, 3], [4, 3]]);
let have = await links();
ok("a drag lays road the way it was dragged",
  JSON.stringify(have) === JSON.stringify(["2,3,3,3", "3,3,4,3"]), JSON.stringify(have));
ok("and nothing the other way", !have.includes("3,3,2,3"));

await drag([[4, 3], [3, 3], [2, 3]]);
have = await links();
ok("dragging back over it makes it two-way",
  have.length === 4 && have.includes("4,3,3,3") && have.includes("3,3,2,3"), JSON.stringify(have));
ok("the road counter counts each direction", (await stat("stRoad")).startsWith("4 /"),
  await stat("stRoad"));

await page.click("#undo");
ok("undo puts back what the drag before it found", (await links()).length === 2,
  JSON.stringify(await links()));

await page.evaluate(() => GL.load("first-light"));
await drag([[7, 3], [6, 3]]);
ok("nothing comes out of a blob that takes cars", (await links()).length === 0);
ok("and the page says why", /takes cars/.test(await say()), await say());
await drag([[2, 3], [1, 3]]);
ok("nothing goes into a blob that makes them", (await links()).length === 0);
ok("and says that too", /makes cars/.test(await say()), await say());

await page.evaluate(() => GL.load("give-way"));            // budget 26
await page.evaluate(() => { for (let x = 0; x < 10; x++) GL.addLink(GL.cell(x, 5), GL.cell(x + 1, 5)); });
await page.evaluate(() => { for (let y = 0; y < 10; y++) GL.addLink(GL.cell(5, y), GL.cell(5, y + 1)); });
let n = await page.evaluate(() => GL.S.links);
await drag([[10, 5], [9, 5], [8, 5], [7, 5], [6, 5], [5, 5], [4, 5],
            [3, 5], [2, 5], [1, 5], [0, 5]]);        // ten more wanted, six left
const after = await page.evaluate(() => GL.S.links);
ok("the budget is a hard stop", after <= 26 && after > n, `${n} then ${after}, budget 26`);
ok("and the page says so", /Out of road/.test(await say()), await say());

await page.evaluate(() => GL.load("first-light"));
await drag([[1, 3], [2, 3], [3, 3], [4, 3]]);
await page.click('#tools [data-tool="erase"]');
await drag([[3, 3]]);
have = await links();
ok("the eraser takes a cell's roads with it",
  !have.some((l) => /^3,3|,3,3$/.test(l)) && have.length === 1, JSON.stringify(have));
await page.click('#tools [data-tool="draw"]');

/* --------------------------------------------- playing the first level -- */

await page.evaluate(() => GL.load("first-light"));
await drag([[1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3]]);
await page.click("#play");
ok("Play starts it", await page.evaluate(() => GL.S.running));
await page.evaluate(() => GL.fast(60));
ok("eight cars get home and the level is clear",
  (await page.textContent("#bHead")) === "Level clear", await page.textContent("#bHead"));
ok("the counter agrees", (await stat("stDeliv")) === "8 / 8", await stat("stDeliv"));
ok("six cells of road did it", (await stat("stRoad")) === "6 / 26", await stat("stRoad"));
ok("a clear run is a flowing one", (await stat("stFlow")) === "100%", await stat("stFlow"));
ok("and it is remembered",
  await page.evaluate(() => JSON.parse(localStorage.getItem("gridlock.cleared")).includes("first-light")));

/* --------------------------------------------------- cars and the road -- */

/* Each colour goes to its own blob, which is the whole of the routing: one
   trunk through the gap, one fork past it, and the fork sorts them. */
const fork = await page.evaluate(() => {
  GL.load("the-fork");
  wire();
  const sink = new Map([...GL.S.blob].filter(([, b]) => b.kind === "dst").map(([c, b]) => [c, b.k]));
  const home = new Set(), wrong = new Set();
  watch(120, () => {
    for (const car of GL.S.cars) {
      if (!sink.has(car.b)) continue;
      (sink.get(car.b) === car.k ? home : wrong).add(car.k);
    }
  });
  return { home: [...home].sort(), wrong: [...wrong], delivered: GL.S.delivered };
});
ok("both colours reach a blob of their own", JSON.stringify(fork.home) === "[0,1]", JSON.stringify(fork.home));
ok("neither turns up at the other's", fork.wrong.length === 0, JSON.stringify(fork.wrong));
ok("and all twenty get home", fork.delivered >= 20, fork.delivered);

/* A junction is one car at a time whichever way it came; a street with
   traffic both ways is one car a lane, which is why two-way road does not
   jam head-on. */
const caps = await page.evaluate(() => {
  GL.load("the-roundabout");
  wire();
  const road = (c) => !GL.S.blob.has(c) && !GL.S.round[c];
  let junction = 0, street = 0, both = 0;
  watch(90, () => {
    for (let c = 0; c < GL.S.n; c++) {
      const held = GL.S.occ[c].length;
      if (!held || !road(c)) continue;
      if (GL.S.street[c]) {
        street = Math.max(street, held);
        if (held === 2) both = c;
      } else junction = Math.max(junction, held);
    }
  });
  return { junction, street, arms: GL.armsAt(GL.cell(6, 6)).length,
           dirs: both ? GL.S.occ[both].map((x) => x.dir) : [] };
});
ok("the gap in the wall is a junction of three arms", caps.arms === 3, caps.arms);
ok("a junction holds one car at a time, whichever way it came", caps.junction === 1, caps.junction);
ok("a two-way street holds two", caps.street === 2, caps.street);

/* A junction nobody is directing costs time to cross, and that cost is the
   only reason any of the pieces below are worth putting down. */
const creep = await page.evaluate(() => {
  const bare = run("signals");
  const lit = run("signals", [[6, 6, "light"]]);
  return { bare: bare.creeps, lit: lit.creeps };
});
ok("cars creep across a junction left alone", creep.bare > 0, creep.bare);
ok("and never across one with lights on it", creep.lit === 0, creep.lit);

/* ----------------------------------------------------------- the kit ---- */

const red = await page.evaluate(() => {
  GL.load("signals");
  wire();
  GL.S.kit.light = 9;
  GL.place(GL.cell(6, 6), "light");
  GL.reroute();
  const mid = GL.cell(6, 6);
  const greens = new Set(), on = new Set();
  let crossed = 0, jumped = 0;
  watch(120, () => {
    const L = GL.S.lights.get(mid);
    greens.add(L.arms[L.i]);
    const now = new Set();
    for (const car of GL.S.cars) {
      if (car.b !== mid && car.a !== mid) continue;
      now.add(car.id);
      if (on.has(car.id) || car.b !== mid) continue;
      crossed++;                                  // the step it pulled onto the junction
      if (car.dir !== L.arms[L.i]) jumped++;      // on somebody else's green
    }
    on.clear();
    for (const id of now) on.add(id);
  });
  return { jumped, crossed, greens: [...greens].sort(), arms: GL.armsAt(mid) };
});
ok("cars do cross it", red.crossed > 20, red.crossed);
ok("a light gives every arm a turn", JSON.stringify(red.greens) === JSON.stringify(red.arms),
  `${JSON.stringify(red.greens)} of ${JSON.stringify(red.arms)}`);
ok("and no car ever crosses on somebody else's green", red.jumped === 0, red.jumped);

const signed = await page.evaluate(() => {
  GL.load("give-way");
  wire();
  GL.S.kit.stop = 9;
  GL.place(GL.cell(5, 4), "stop");       // the quiet arm, one cell short of the crossing
  GL.reroute();
  const sign = GL.cell(5, 4), mid = GL.cell(5, 5);
  const stood = new Map();               // how long each car had been standing at the sign
  let pulled = 0, shortest = Infinity;
  watch(150, () => {
    for (const car of GL.S.cars) {
      if (car.b === sign && !car.moving) stood.set(car.id, car.wait);
      else if (car.a === sign && car.b === mid && stood.has(car.id)) {
        pulled++;
        shortest = Math.min(shortest, stood.get(car.id));
        stood.delete(car.id);
      }
    }
  });
  return { pulled, shortest, dwell: GL.DWELL };
});
ok("cars do come through the sign", signed.pulled > 5, signed.pulled);
ok("and every one of them stopped first",
  signed.shortest >= signed.dwell - 0.02, `the quickest stood ${signed.shortest}s, needs ${signed.dwell}`);

const island = await page.evaluate(() => {
  GL.load("the-roundabout");
  wire();
  GL.S.kit.round = 9;
  GL.place(GL.cell(6, 6), "round");
  GL.reroute();
  const mid = GL.cell(6, 6);
  let most = 0;
  watch(120, () => { most = Math.max(most, GL.S.occ[mid].length); });
  return most;
});
ok("two cars fit on a roundabout at once", island === 2, island);

/* ------------------------------------------------------ losing it all --- */

/* Lights on a junction three busy roads meet at is the wrong answer, and the
   way it is wrong is the one the game is named after: cars go round and round
   into each other until every one of them is waiting on the next. */
const jam = await page.evaluate(() => {
  const r = run("the-roundabout", [[6, 6, "light"]]);
  const ring = GL.S.jam ? [...GL.S.jam] : [];
  const stuck = ring.every((id) => {
    const car = GL.S.cars.find((c) => c.id === id);
    return car && !car.moving;
  });
  return { ...r, ring: ring.length, stuck, why: document.getElementById("bWhy").textContent };
});
ok("it ends in gridlock", jam.outcome === "Gridlock", jam.outcome);
ok("a ring of at least two cars", jam.ring >= 2, jam.ring);
ok("every car in it stopped", jam.stuck && jam.ring > 0);
ok("and the banner counts them", new RegExp(`^${jam.ring} cars in a closed ring`).test(jam.why), jam.why);

const stranded = await page.evaluate(() => {
  GL.load("first-light");
  for (const x of [1, 2, 3]) GL.addLink(GL.cell(x, 3), GL.cell(x + 1, 3));   // stops short
  GL.reroute();
  const over = GL.fast(90);
  return { head: over.head, why: document.getElementById("bWhy").textContent };
});
ok("road that reaches nothing loses the run", stranded.head === "Nowhere to go", stranded.head);
ok("and says which colour", /^Amber/.test(stranded.why), stranded.why);

const flooded = await page.evaluate(() => run("signals"));
ok("a blob handed more cars than its road can carry backs up",
  flooded.outcome === "Backed up", flooded.outcome);

/* -------------------------------------------------------- the levels ---- */

const all = await page.evaluate(() => GL.LEVELS.map((l) => l.id));
ok("nine levels", all.length === 9, all.length);

for (const id of all) {
  const r = await page.evaluate((id) => run(id), id);
  ok(`${id}: wireable inside its budget`, r.wired && r.links <= r.budget,
    `${r.links} of ${r.budget}`);
}

/* The four before the kit appears are meant to go through on the road alone. */
for (const id of ["first-light", "merge", "crossing", "the-fork"]) {
  const r = await page.evaluate((id) => run(id), id);
  ok(`${id}: road alone gets them home`, r.outcome === "WIN",
    `${r.delivered} of ${r.goal}, ${r.outcome}`);
}

/* And the three after it are each meant to need the thing they introduce.
   Both halves matter: a level the bare run wins teaches nothing. */
const lessons = [
  ["give-way", [[5, 4, "stop"]], "a stop sign on the quiet arm"],
  ["signals", [[6, 6, "light"]], "lights"],
  ["the-roundabout", [[6, 6, "round"]], "a roundabout"],
];
for (const [id, kit, what] of lessons) {
  const bare = await page.evaluate((id) => run(id), id);
  const fixed = await page.evaluate(([id, kit]) => run(id, kit), [id, kit]);
  ok(`${id}: the road alone is not enough`, bare.outcome !== "WIN",
    `${bare.delivered} of ${bare.goal}, ${bare.outcome}`);
  ok(`${id}: ${what} is`, fixed.outcome === "WIN",
    `${fixed.delivered} of ${fixed.goal}, ${fixed.outcome}`);
}

/* Putting the sign on the arm that is actually busy starves it, which is the
   choice the level is asking you to get right. */
const wrongArm = await page.evaluate(() => run("give-way", [[4, 5, "stop"]]));
ok("give-way: a stop sign on the busy arm loses", wrongArm.outcome !== "WIN",
  `${wrongArm.delivered} of ${wrongArm.goal}, ${wrongArm.outcome}`);

/* Signs on every arm are an all-way stop, and an all-way stop is slower than
   lights because every car pays for pulling away again. */
const allWay = await page.evaluate(() => run("signals", [[5, 6, "stop"], [6, 5, "stop"]]));
ok("signals: signs on both arms are not lights", allWay.outcome !== "WIN",
  `${allWay.delivered} of ${allWay.goal}, ${allWay.outcome}`);

const last = await page.evaluate(() => ({
  bare: run("rush-hour"),
  kitted: run("rush-hour", [[13, 10, "round"], [6, 3, "light"]]),
}));
ok("rush-hour: the naive wiring is not enough", last.bare.outcome !== "WIN",
  `${last.bare.delivered} of ${last.bare.goal}, ${last.bare.outcome}`);
ok("rush-hour: the kit on the right junctions clears it", last.kitted.outcome === "WIN",
  `${last.kitted.delivered} of ${last.kitted.goal}, ${last.kitted.outcome}`);

/* ----------------------------------------------------------- the page --- */

const painted = await page.evaluate(() => {
  GL.load("crossing");
  GL.draw();
  const cv = document.getElementById("cv");
  const g = cv.getContext("2d");
  const dpr = cv.width / (GL.S.unit * GL.S.W);
  const at = (x, y) => {
    const d = g.getImageData(Math.round((x + 0.5) * GL.S.unit * dpr),
                             Math.round((y + 0.5) * GL.S.unit * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  return { amber: at(1, 1), cyan: at(9, 1), wall: at(4, 3), empty: at(0, 4) };
});
ok("the amber blob is painted amber", painted.amber[0] > painted.amber[2] + 60,
  JSON.stringify(painted.amber));
ok("the cyan one is not", painted.cyan[2] > painted.cyan[0] + 60, JSON.stringify(painted.cyan));
ok("ground you cannot build on is drawn", painted.wall.some((v) => v > 8), JSON.stringify(painted.wall));
ok("and ground you can is black", painted.empty.every((v) => v < 30), JSON.stringify(painted.empty));

await page.setViewportSize({ width: 390, height: 900 });
await page.evaluate(() => GL.load("rush-hour"));
await page.waitForTimeout(250);
const narrow = await page.evaluate(() => {
  const cv = document.getElementById("cv");
  return { cv: cv.getBoundingClientRect().width, body: document.body.clientWidth,
           scroll: document.documentElement.scrollWidth };
});
ok("the widest board still fits a phone", narrow.cv <= narrow.body + 1 && narrow.scroll <= 390,
  JSON.stringify(narrow));
await page.setViewportSize({ width: 1200, height: 1000 });

await page.evaluate(() => GL.load("the-roundabout"));
await page.evaluate(() => { wire(); GL.S.kit.round = 9; GL.place(GL.cell(6, 6), "round");
  GL.reroute(); GL.fast(24); });
await page.locator("#board").screenshot({ path: `${WORK}/gridlock.png` });
ok("a board draws", true);

/* -------------------------------------------------------- the two hubs -- */

await page.goto(`${SITE}/games/`);
ok("the games page links the game",
  (await page.locator('a[href="gridlock/"]').count()) === 1);
await page.goto(`${SITE}/index.html`);
ok("and the index links it too",
  (await page.locator('a[href="games/gridlock/"]').count()) === 1);

ok("nothing shouted at the console", errs.length === 0, errs.join(" | "));

await browser.close();
process.exit(done());
