import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:8099/dice-roller.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1400 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x = '') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto(URL);
await page.waitForTimeout(200);

const settle = async () => page.waitForFunction(() => settled && dice.length > 0,
  null, { timeout: 15000 });

const breakdown = () => page.evaluate(() => ({
  total: Number(document.getElementById('total').textContent),
  say: document.getElementById('say').textContent,
  rows: [...document.querySelectorAll('.term')].map(r => ({
    tag: r.querySelector('.tag').textContent,
    pips: [...r.querySelectorAll('.pip')].map(p => Number(p.textContent)),
    sum: r.querySelector('.sum').textContent,
  })),
}));

/* What the dice in the tray are actually showing: for each one, the labelled
   face (or, on a four, the corner) that is pointing at the ceiling. Worked
   from the quaternion the page left the die at rather than from anything the
   page says about it, because the number on the table is the whole claim. */
const showing = () => page.evaluate(() => dice.map(d => {
  if (d.shape.kind === 'tetra') {
    let best = -2, got = null;
    d.shape.pts.forEach((p, i) => {
      const y = turn(d.quat, unit(p)).y;
      if (y > best) { best = y; got = d.labels[i]; }
    });
    return { label: got, upright: best };
  }
  let best = -2, got = null;
  d.shape.reads.forEach((f, i) => {
    const y = turn(d.quat, f.normal).y;
    if (y > best) { best = y; got = d.labels[i]; }
  });
  return { label: got, upright: best };
}));

/* ------------------------------------------------------------ the roll -- */

const said = async (expr) => {
  await page.fill('#expr', expr);
  await page.click('#rollBtn');
  return page.evaluate(() => ({
    on: document.getElementById('err').classList.contains('on'),
    text: document.getElementById('err').textContent,
  }));
};

let e = await said('2d6 + x');
ok('refuses a letter that is not a d', e.on && /no .x./.test(e.text), e.text);
e = await said('2d6 +');
ok('refuses a trailing sign', e.on && /nothing after it/.test(e.text), e.text);
e = await said('2d6 3d4');
ok('refuses two terms with no sign', e.on && /\+ or a -/.test(e.text), e.text);
e = await said('3d1');
ok('refuses a one-sided die', e.on && /at least two sides/.test(e.text), e.text);
e = await said('0d6');
ok('refuses no dice at all', e.on && /no dice at all/.test(e.text), e.text);
e = await said('101d6');
ok('refuses more dice than the table holds', e.on && /more than the table holds/.test(e.text), e.text);
e = await said('1d1001');
ok('refuses more sides than it draws', e.on && /1000 sides is the most/.test(e.text), e.text);
e = await said('5d6 + 2d3');
ok('a good roll clears the complaint', !e.on, e.text);

await settle();
let b = await breakdown();
ok('a term for each part', b.rows.length === 2, JSON.stringify(b.rows.map(r => r.tag)));
ok('five dice in the first term', b.rows[0].pips.length === 5, b.rows[0].pips.length);
ok('two dice in the second', b.rows[1].pips.length === 2, b.rows[1].pips.length);
ok('every d6 in range', b.rows[0].pips.every(v => v >= 1 && v <= 6), JSON.stringify(b.rows[0].pips));
ok('every d3 in range', b.rows[1].pips.every(v => v >= 1 && v <= 3), JSON.stringify(b.rows[1].pips));
const adds = b.rows.reduce((n, r) => n + r.pips.reduce((a, c) => a + c, 0), 0);
ok('the total is what the dice add to', b.total === adds, `${b.total} vs ${adds}`);
ok('the working ends in the total', b.say.endsWith(`= ${b.total}`), b.say);

// What the tray shows has to be what the page says was rolled.
let up = await showing();
let want = b.rows[0].pips.concat(b.rows[1].pips);
ok('every die shows the number it rolled',
  JSON.stringify(up.map(u => u.label)) === JSON.stringify(want),
  `${JSON.stringify(up.map(u => u.label))} vs ${JSON.stringify(want)}`);
ok('every die is square with the table', up.every(u => u.upright > 0.999), JSON.stringify(up.map(u => +u.upright.toFixed(4))));

/* The dice are not steered onto their faces: the throw is run honestly and
   the numbers are painted on afterwards. What is left at the end is a rock
   flat onto whatever face the die is lying on, and that is a degree or two.
   This is the check that the old behaviour — a die snapping round to the
   right face once it had stopped — cannot pass. */
const tidying = await page.evaluate(() => {
  const out = [];
  document.getElementById('expr').value = '4d6 + 1d20 + 1d4';
  for (let k = 0; k < 10; k++) {
    document.getElementById('rollBtn').click();
    for (const d of dice) backToStart(d);
    for (let s = 0; s < throwSteps; s++) oneStep(s * (1 / 300));
    for (const d of dice) {
      const q = d.quat, t = d.endQuat;
      const near = Math.min(1, Math.abs(q.w * t.w + q.x * t.x + q.y * t.y + q.z * t.z));
      out.push(2 * Math.acos(near) * 180 / Math.PI);
    }
  }
  return out.sort((a, b) => a - b);
});
const middle = tidying[Math.floor(tidying.length / 2)];
const nineTenths = tidying[Math.floor(tidying.length * 0.9)];
ok('a die is left where it stops, not turned onto its face', middle < 5,
  `the middle die turns ${middle.toFixed(1)} degrees at the end`);
ok('and nine in ten of them likewise', nineTenths < 20, `${nineTenths.toFixed(1)} degrees`);

/* The numbers are painted on the die rather than kept upright for the camera:
   turn the die half a turn about the upright and the number has to come round
   with it. Under the old behaviour the text was re-levelled every frame and
   this would not move at all. */
await page.fill('#expr', '1d20');
await page.click('#rollBtn');
await settle();
const painted = await page.evaluate(() => {
  const d = dice[0];
  const face = d.shape.reads[d.up];
  const angle = () => {
    const mid = add(d.pos, mul(turn(d.quat, face.mid), d.r));
    const a = project(mid);
    const b = project(add(mid, mul(turn(d.quat, face.across), 0.3)));
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  };
  const before = angle();
  d.quat = qMul(qAxis(v3(0, 1, 0), Math.PI), d.quat);
  spinVerts(d);
  const after = angle();
  const square = Math.abs(dot(face.across, face.normal)) + Math.abs(dot(face.down, face.normal));
  return { moved: Math.abs(((after - before + 540) % 360) - 180), square };
});
ok('a number turns with the die', painted.moved > 170,
  `half a turn moved the number by ${painted.moved.toFixed(1)} degrees`);
ok('and lies flat on its face', painted.square < 1e-9, painted.square);

let rest = await page.evaluate(() => dice.map(d => {
  let low = Infinity;
  let out = 0;
  for (const p of d.shape.pts) {
    const w = mul(turn(d.quat, p), d.r);
    low = Math.min(low, w.y);
    out = Math.max(out, Math.abs(d.pos.x + w.x) - TRAY.w, Math.abs(d.pos.z + w.z) - TRAY.d);
  }
  return { sits: +(d.pos.y + low).toFixed(4), inside: out <= 1e-6, out: +out.toFixed(4) };
}));
ok('every die sits on the table', rest.every(r => Math.abs(r.sits) < 1e-3), JSON.stringify(rest.map(r => r.sits)));
ok('no corner of a die hangs off the edge', rest.every(r => r.inside), JSON.stringify(rest));

const onScreen = await page.evaluate(() => {
  const w = document.getElementById('tray').clientWidth;
  const h = document.getElementById('tray').clientHeight;
  return dice.every(d => d.world.every(p => {
    const s = project(p);
    return s && s.x >= -1 && s.x <= w + 1 && s.y >= -1 && s.y <= h + 1;
  }));
});
ok('every die is drawn inside the canvas', onScreen, 'a corner fell outside');

const litUp = await page.evaluate(() => {
  const c = document.getElementById('tray');
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit++;
  return lit / (px.length / 4);
});
ok('the tray is not a blank canvas', litUp > 0.02, `only ${(litUp * 100).toFixed(2)}% of it is drawn on`);

/* --------------------------------------------------------- the solids -- */

const solids = await page.evaluate(() => {
  const out = {};
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 20, 22, 24, 25, 100]) {
    const s = shapeFor(n);
    out[n] = { kind: s.kind, doubled: s.doubled, reads: s.reads.length, faces: s.faces.length,
               corners: s.pts.length, sides: s.reads.map(f => f.verts.length),
               paired: s.opposite.every(j => j >= 0) };
  }
  return out;
});
const sameShape = (n, kind, reads, doubled = false) =>
  ok(`a d${n} is ${kind} with ${reads} faces to read${doubled ? ', each number twice' : ''}`,
    solids[n].kind === kind && solids[n].reads === reads && solids[n].doubled === doubled,
    JSON.stringify(solids[n]));
sameShape(2, 'coin', 2);
sameShape(4, 'tetra', 4);
sameShape(6, 'cube', 6);
sameShape(8, 'octa', 8);
sameShape(10, 'trapezohedron', 10);
sameShape(12, 'dodeca', 12);
sameShape(20, 'icosa', 20);
sameShape(14, 'trapezohedron', 14);
sameShape(22, 'trapezohedron', 22);
sameShape(16, 'bipyramid', 16);
sameShape(24, 'bipyramid', 24);
// An odd number of sides is a solid of twice as many faces, each number twice.
sameShape(3, 'cube', 6, true);
sameShape(5, 'trapezohedron', 10, true);
sameShape(7, 'trapezohedron', 14, true);
sameShape(9, 'trapezohedron', 18, true);
sameShape(11, 'trapezohedron', 22, true);
// And past what a solid can carry, the stand-in twenty.
sameShape(13, 'stand-in', 20);
sameShape(25, 'stand-in', 20);
sameShape(100, 'stand-in', 20);

ok('the cube is six squares', solids[6].sides.every(n => n === 4), JSON.stringify(solids[6].sides));
ok('the dodecahedron is twelve pentagons', solids[12].sides.every(n => n === 5), JSON.stringify(solids[12].sides));
ok('the icosahedron is twenty triangles', solids[20].sides.every(n => n === 3), JSON.stringify(solids[20].sides));
ok('the d10 is ten kites', solids[10].sides.every(n => n === 4), JSON.stringify(solids[10].sides));
ok('a bipyramid is triangles', solids[16].sides.every(n => n === 3), JSON.stringify(solids[16].sides));
ok('a coin reads its two flats', solids[2].sides.every(n => n > 4), JSON.stringify(solids[2].sides));
// Every face must have one opposite it, or there is nothing on top when the
// die lands — which is the whole reason the odd numbers are doubled.
for (const n of [2, 6, 8, 10, 12, 14, 16, 20, 22, 24, 3, 5, 7, 9, 11]) {
  ok(`every face of a d${n} has one opposite it`, solids[n].paired, JSON.stringify(solids[n]));
}

const paired = await page.evaluate(() => {
  const out = {};
  for (const n of [6, 8, 10, 12, 20, 16, 3, 5, 7]) {
    const shape = shapeFor(n);
    const labels = labelsFor(shape, n, 1, 0, -1);
    out[n] = {
      sums: shape.opposite.map((j, i) => labels[i] + labels[j]),
      same: shape.opposite.every((j, i) => labels[i] === labels[j]),
      all: [...new Set(labels)].sort((a, b) => a - b),
    };
  }
  return out;
});
for (const n of [6, 8, 10, 12, 20, 16]) {
  ok(`opposite faces of a d${n} add to ${n + 1}`, paired[n].sums.every(v => v === n + 1),
    JSON.stringify(paired[n].sums));
  ok(`a d${n} carries 1 to ${n}`, paired[n].all.length === n && paired[n].all[n - 1] === n,
    JSON.stringify(paired[n].all));
}
for (const n of [3, 5, 7]) {
  ok(`a doubled d${n} has the same number on opposite faces`, paired[n].same, JSON.stringify(paired[n]));
  ok(`and carries 1 to ${n}, twice each`,
    paired[n].all.length === n && paired[n].all[n - 1] === n, JSON.stringify(paired[n].all));
}

/* ------------------------------------------------- the odd ones out --- */

await page.fill('#expr', '1d100 + 1d2 + 1d4 + 1d7');
await page.click('#rollBtn');
await settle();
b = await breakdown();
up = await showing();
want = b.rows.map(r => r.pips[0]);
ok('the stand-in twenty and the rest still show their rolls',
  JSON.stringify(up.map(u => u.label)) === JSON.stringify(want),
  `${JSON.stringify(up.map(u => u.label))} vs ${JSON.stringify(want)}`);
const standIn = await page.evaluate(() => {
  const d = dice.find(x => x.sides === 100);
  return { onFaces: d.labels.length, holds: d.labels.includes(d.value), spread: new Set(d.labels).size };
});
ok('a d100 is landed on twenty faces carrying its number',
  standIn.onFaces === 20 && standIn.holds && standIn.spread === 20, JSON.stringify(standIn));
ok('the tray says what it stood in with', /d100 on a twenty, standing in/.test(await page.textContent('#trayNote')),
  await page.textContent('#trayNote'));

// A d100 lands on numbers a twenty could not reach, which is the point of it.
const hundreds = await page.evaluate(() => {
  const got = [];
  document.getElementById('expr').value = '1d100';
  for (let i = 0; i < 200; i++) {
    document.getElementById('rollBtn').click();
    got.push(Number(document.getElementById('total').textContent));
  }
  return got;
});
ok('a d100 rolls over twenty', hundreds.some(v => v > 20) && hundreds.every(v => v >= 1 && v <= 100),
  JSON.stringify(hundreds.slice(0, 8)));

/* ------------------------------------------------------- the numbers -- */

const many = await page.evaluate(() => {
  const got = [];
  document.getElementById('expr').value = '1d6';
  for (let i = 0; i < 300; i++) {
    document.getElementById('rollBtn').click();
    got.push(Number(document.getElementById('total').textContent));
  }
  return got;
});
const tally = [0, 0, 0, 0, 0, 0, 0];
for (const v of many) tally[v]++;
ok('300 of 1d6 are all between 1 and 6', many.every(v => v >= 1 && v <= 6), JSON.stringify(many.slice(0, 10)));
ok('every face of a d6 turns up', tally.slice(1).every(n => n > 0), JSON.stringify(tally));
// Six sigma either side of fifty, so an honest die cannot fail this and a
// die stuck on one number cannot pass it.
ok('no face of a d6 runs away with it', tally.slice(1).every(n => n > 15 && n < 90), JSON.stringify(tally));

const marks = await page.evaluate(() => {
  document.getElementById('expr').value = '2d6';
  const seen = { top: false, bottom: false, other: false };
  for (let i = 0; i < 200; i++) {
    document.getElementById('rollBtn').click();
    for (const pip of document.querySelectorAll('.pip')) {
      const v = Number(pip.textContent);
      if (pip.classList.contains('top')) seen.top = v === 6;
      else if (pip.classList.contains('bottom')) seen.bottom = v === 1;
      else if (v === 6 || v === 1) seen.other = true;
    }
  }
  return seen;
});
ok('a six is lit and a one is dimmed', marks.top && marks.bottom && !marks.other, JSON.stringify(marks));

// One die has no breakdown to mark, so the line under the total carries it.
const edges = await page.evaluate(() => {
  document.getElementById('expr').value = '1d20';
  const seen = {};
  for (let i = 0; i < 300; i++) {
    document.getElementById('rollBtn').click();
    seen[document.getElementById('total').textContent] = document.getElementById('say').textContent;
  }
  return { top: seen['20'], bottom: seen['1'], middle: seen['11'] };
});
ok('a natural twenty is called the top of it', /the top of it$/.test(edges.top || ''), edges.top);
ok('a one is called the bottom of it', /the bottom of it$/.test(edges.bottom || ''), edges.bottom);
ok('everything between is just said plainly', edges.middle === '1d20, out of 1 to 20', edges.middle);

/* The roll beside the table rolls; the throw beside it only throws again. */
await page.click('#clearBtn');            // the log is at its cap by now
await page.fill('#expr', '3d6');
await page.click('#rollBtn');
await settle();
const once = await page.evaluate(() => ({
  values: dice.map(d => d.value).join(','),
  logged: document.querySelectorAll('.entry').length,
}));
await page.click('#rollHere');
await settle();
const twice = await page.evaluate(() => ({
  values: dice.map(d => d.value).join(','),
  logged: document.querySelectorAll('.entry').length,
}));
ok('the roll beside the table is a roll', twice.logged === once.logged + 1,
  `${once.logged} then ${twice.logged} in the log`);
await page.click('#againBtn');
await settle();
const thrice = await page.evaluate(() => ({
  values: dice.map(d => d.value).join(','),
  logged: document.querySelectorAll('.entry').length,
}));
ok('throwing again keeps the numbers it had',
  thrice.values === twice.values && thrice.logged === twice.logged,
  `${twice.values} then ${thrice.values}`);

/* --------------------------------------------------- setting them down -- */

await page.uncheck('#tumble');
await page.fill('#expr', '6d20');
await page.click('#rollBtn');
const stillRest = await page.evaluate(() => settled && dice.every(d => d.asleep));
ok('with the throw off the dice are already down', stillRest, 'still moving');
b = await breakdown();
up = await showing();
ok('and still showing what they rolled',
  JSON.stringify(up.map(u => u.label)) === JSON.stringify(b.rows[0].pips),
  `${JSON.stringify(up.map(u => u.label))} vs ${JSON.stringify(b.rows[0].pips)}`);
await page.check('#tumble');

/* ----------------------------------------------------- many throws ---- */

await page.fill('#expr', '1d6');
await page.fill('#runs', '20000');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 60000 });
let run = await page.evaluate(() => ({
  trials: sim.trials, first: sim.first, last: sim.last, mean: sim.mean,
  bins: sim.bins.length, per: sim.binWidth,
  shares: sim.bins.map(b => b.n / sim.trials),
  rows: document.querySelectorAll('#table tr').length,
  figures: document.getElementById('figures').textContent,
  say: document.getElementById('simSay').textContent,
}));
ok('20,000 throws is 20,000 throws', run.trials === 20000, run.trials);
ok('1d6 runs from 1 to 6', run.first === 1 && run.last === 6, `${run.first}-${run.last}`);
ok('one bar a face', run.bins === 6 && run.per === 1, `${run.bins} bars of ${run.per}`);
ok('the mean of a d6 comes out at three and a half', Math.abs(run.mean - 3.5) < 0.1, run.mean);
ok('every face about a sixth', run.shares.every(s => Math.abs(s - 1 / 6) < 0.03), JSON.stringify(run.shares.map(s => +s.toFixed(4))));
ok('the table is the same six, with a heading', run.rows === 7, run.rows);
ok('the figures are reported', /throws20,000/.test(run.figures.replace(/\s/g, '')), run.figures.slice(0, 60));
ok('it says what it ran', /20,000 throws of 1d6/.test(run.say), run.say);

await page.fill('#expr', '2d6 + 1');
await page.click('#rollBtn');
await settle();
await page.fill('#runs', '40000');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 60000 });
run = await page.evaluate(() => ({
  first: sim.first, last: sim.last, peakAt: sim.peakAt, mean: sim.mean,
  mine: Number(document.getElementById('total').textContent),
  marked: [...document.querySelectorAll('#table tr.mine td')].map(td => td.textContent),
  readout: document.getElementById('readout').textContent,
}));
ok('2d6 + 1 runs from 3 to 13', run.first === 3 && run.last === 13, `${run.first}-${run.last}`);
ok('it peaks on the eight', run.peakAt === 8, run.peakAt);
ok('and averages eight', Math.abs(run.mean - 8) < 0.1, run.mean);
ok('the roll on the table is marked in the numbers',
  run.marked.length === 3 && Number(run.marked[0]) === run.mine, JSON.stringify(run.marked));
ok('the readout says what is most likely', /most often 8/.test(run.readout), run.readout);

// Pointing at a bar reports that bar, and the arrow keys walk them.
const point = await page.evaluate(() => {
  const c = document.getElementById('plot');
  const box = c.getBoundingClientRect();
  const bins = binsFor(plotRoom().pw);
  const i = 4;
  const x = box.left + PAD.l + (i + 0.5) * (plotRoom().pw / bins.length);
  c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: box.top + 60, bubbles: true }));
  const under = document.getElementById('readout').textContent;
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  return { under, after: document.getElementById('readout').textContent, want: bins[i].lo };
});
ok('pointing at a bar reads that bar', point.under.startsWith(`${point.want}  `), point.under);
ok('the arrow keys walk to the next one', point.after.startsWith(`${point.want + 1}  `), point.after);

/* A roll of a shape this page has not charted yet runs ten thousand of them
   by itself, so the chart is never of a different roll than the dice. */
await page.evaluate(() => { localStorage.clear(); });
await page.reload();
await page.fill('#expr', '2d6 + 1');
await page.click('#rollBtn');
await page.waitForFunction(() => sim && sim.expr === '2d6 + 1', null, { timeout: 30000 });
run = await page.evaluate(() => ({
  trials: sim.trials, expr: sim.expr, say: document.getElementById('simSay').textContent,
  box: document.getElementById('runs').value,
  shown: document.getElementById('plotWrap').classList.contains('on'),
}));
ok('a new roll charts itself', run.trials === 10000 && run.expr === '2d6 + 1', JSON.stringify(run));
ok('and says it ran with the roll', /run with the roll/.test(run.say), run.say);
ok('without touching what you typed', run.box === '', JSON.stringify(run.box));
ok('and the chart is up', run.shown, 'the plot stayed hidden');

await page.click('#rollBtn');
await page.waitForTimeout(400);
ok('rolling the same thing again leaves it alone',
  await page.evaluate(() => sim.trials) === 10000, await page.evaluate(() => sim.trials));

await page.fill('#runs', '50000');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 60000 });
await page.fill('#runs', '');
await page.click('#rollBtn');
await page.waitForTimeout(400);
ok('and a run you asked for is not thrown away by one',
  await page.evaluate(() => sim.trials) === 50000, await page.evaluate(() => sim.trials));

// Saving the chart as a picture, titled with the roll.
const saved = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.click('#saveSim'),
]).then(([d]) => d);
const landed = WORK + '/dice-graph.jpg';
await saved.saveAs(landed);
const bytes = fs.readFileSync(landed);
ok('the graph saves as a jpeg named after the roll', saved.suggestedFilename() === '2d6+1.jpg',
  saved.suggestedFilename());
ok('and it is really a jpeg', bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF,
  [...bytes.subarray(0, 3)].join(','));
ok('with something on it', bytes.length > 20000, bytes.length);
ok('the page says where it went', /Saved 2d6\+1\.jpg/.test(await page.textContent('#readout')),
  await page.textContent('#readout'));

// The default, which is the whole of what an empty box means.
await page.fill('#expr', '1d6');
await page.fill('#runs', '');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 120000 });
run = await page.evaluate(() => ({ trials: sim.trials, say: document.getElementById('simSay').textContent }));
ok('an empty box is a million throws', run.trials === 1000000, run.trials);
ok('and it says so', /1,000,000 throws of 1d6/.test(run.say), run.say);

// Stopping partway charts what it has rather than nothing.
await page.fill('#expr', '60d100');
await page.fill('#runs', '9000000');
await page.click('#simBtn');
await page.waitForTimeout(400);
await page.click('#stopBtn');
await page.waitForTimeout(150);
run = await page.evaluate(() => ({ trials: sim.trials, say: document.getElementById('simSay').textContent,
  running: document.getElementById('simBtn').disabled }));
ok('stop stops it', !run.running, 'still running');
ok('and charts the throws it got to', run.trials > 0 && run.trials < 9000000 && /Stopped at/.test(run.say), run.say);

await page.fill('#expr', '7 + 3');
await page.click('#simBtn');
await page.waitForTimeout(100);
ok('a roll with no dice in it is said, not charted',
  /every throw of it is 10/.test(await page.textContent('#simSay')), await page.textContent('#simSay'));

await page.fill('#expr', '2d6');
await page.fill('#runs', 'lots');
await page.click('#simBtn');
await page.waitForTimeout(100);
ok('a count that is not a number is refused',
  /is not a number of throws/.test(await page.textContent('#simSay')), await page.textContent('#simSay'));
await page.fill('#runs', '1,000');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 60000 });
ok('a count typed with commas is read as written',
  await page.evaluate(() => sim.trials) === 1000, await page.evaluate(() => sim.trials));

/* ------------------------------------------------------ keeping it ---- */

await page.fill('#runs', '');
await page.fill('#expr', '3d8 + 2');
await page.click('#rollBtn');
await settle();
const before = await page.evaluate(() => ({
  expr: document.getElementById('expr').value,
  log: [...document.querySelectorAll('.entry')].map(e => e.textContent.replace(/\s+/g, ' ')),
  held: localStorage.getItem('dice-roller'),
}));
ok('the log is kept as numbers, not markup', !/</.test(before.held), before.held.slice(0, 70));
await page.reload();
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({
  expr: document.getElementById('expr').value,
  log: [...document.querySelectorAll('.entry')].map(e => e.textContent.replace(/\s+/g, ' ')),
  dice: dice.length,
}));
ok('the roll you typed survives a reload', after.expr === before.expr, after.expr);
ok('so does the log', JSON.stringify(after.log) === JSON.stringify(before.log), JSON.stringify(after.log.slice(0, 2)));
ok('the table starts empty', after.dice === 0, after.dice);

const capped = await page.evaluate(() => {
  const made = [];
  document.getElementById('expr').value = '1d4';
  for (let i = 0; i < 60; i++) document.getElementById('rollBtn').click();
  made.push(document.querySelectorAll('.entry').length);
  made.push(JSON.parse(localStorage.getItem('dice-roller')).entries.length);
  return made;
});
ok('the log stops at forty, on screen and in storage', capped[0] === 40 && capped[1] === 40, JSON.stringify(capped));

await page.evaluate(() => localStorage.setItem('dice-roller', '{"expr":42,"entries":"<img src=x>"}'));
await page.reload();
await page.waitForTimeout(200);
const junk = await page.evaluate(() => ({
  expr: document.getElementById('expr').value,
  empty: document.querySelector('.empty')?.textContent || null,
}));
ok('junk in storage is ignored rather than believed',
  junk.expr === '2d6' && junk.empty === 'Nothing rolled yet.', JSON.stringify(junk));

/* ----------------------------------------------------------- narrow --- */

await page.evaluate(() => localStorage.clear());
await page.reload();
await page.fill('#expr', '4d6 + 1d20');
await page.click('#rollBtn');
await settle();
await page.fill('#runs', '5000');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 60000 });
await page.screenshot({ path: WORK + '/dice-wide.png', fullPage: true });

await page.setViewportSize({ width: 390, height: 1600 });
await page.waitForTimeout(400);
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok('no sideways scroll at 390px', !over, 'the page is wider than the phone');
const drewSmall = await page.evaluate(() => {
  const c = document.getElementById('plot');
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit++;
  return lit > 500;
});
ok('the chart redraws at phone width', drewSmall, 'the plot came out blank');
await page.screenshot({ path: WORK + '/dice-narrow.png', fullPage: true });

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
