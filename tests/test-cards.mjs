import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:8099/card-drawer.html';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 1400 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x = '') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto(URL);
await page.waitForTimeout(200);

const settle = () => page.waitForFunction(() => settled && cards.length > 0, null, { timeout: 15000 });
const useDeck = async (kind) => { await page.click(`#decks button[data-deck="${kind}"]`); };
const drawn = () => page.evaluate(() => ({
  total: Number(document.getElementById('total').textContent),
  say: document.getElementById('say').textContent,
  rows: [...document.querySelectorAll('.drew')].map(r => ({
    seat: r.querySelector('.seat')?.textContent ?? null,
    pip: r.querySelector('.pip').textContent,
    face: r.querySelector('.face').textContent,
    worth: Number(r.querySelector('.worth').textContent),
  })),
}));

/* ------------------------------------------------------------- the decks -- */

const sizes = await page.evaluate(() => {
  const out = {};
  for (const [kind, deck] of Object.entries(DECKS)) {
    if (kind === 'custom') continue;
    out[kind] = {
      plain: deck.build(deck.worth, false).length,
      jokered: deck.build(deck.worth, true).length,
      distinct: new Set(deck.build(deck.worth, false).map(c => c.name)).size,
    };
  }
  return out;
});
ok('a pack of playing cards is 52', sizes.playing.plain === 52, sizes.playing.plain);
ok('and 54 with the jokers in', sizes.playing.jokered === 54, sizes.playing.jokered);
ok('a tarot deck is 78', sizes.tarot.plain === 78, sizes.tarot.plain);
ok('the major arcana is 22', sizes.major.plain === 22, sizes.major.plain);
ok('the minor arcana is 56', sizes.minor.plain === 56, sizes.minor.plain);
ok('an Uno deck is 108', sizes.uno.plain === 108, sizes.uno.plain);
ok('no deck but Uno repeats a card', sizes.playing.distinct === 52 && sizes.tarot.distinct === 78
  && sizes.major.distinct === 22 && sizes.minor.distinct === 56, JSON.stringify(sizes));
// Thirteen faces in each of four colours, and two wilds: 54 of the 108.
ok('and Uno repeats most of its', sizes.uno.distinct === 54, sizes.uno.distinct);

const faces = await page.evaluate(() => {
  const deck = DECKS.playing.build(DECKS.playing.worth, false);
  const tarot = DECKS.tarot.build(DECKS.tarot.worth, false);
  const uno = DECKS.uno.build(DECKS.uno.worth, false);
  const find = (list, name) => list.find(c => c.name === name);
  return {
    ace: find(deck, 'Ace of Spades'),
    king: find(deck, 'King of Hearts'),
    death: find(tarot, 'XIII — Death'),
    knight: find(tarot, 'Knight of Cups'),
    wild: find(uno, 'Wild'),
    suits: [...new Set(deck.map(c => c.icon))].join(''),
  };
});
ok('the ace of spades is an A on a spade', faces.ace.label === 'A' && faces.ace.icon === '♠', JSON.stringify(faces.ace));
ok('a king is worth thirteen to start with', faces.king.value === 13, faces.king.value);
ok('the tarot has its thirteenth', faces.death && faces.death.label === 'XIII', JSON.stringify(faces.death));
ok('and its knights, worth twelve', faces.knight && faces.knight.value === 12, JSON.stringify(faces.knight));
ok('an Uno wild is worth fifty', faces.wild.value === 50, JSON.stringify(faces.wild));
ok('four suits and no more', faces.suits === '♠♥♦♣', faces.suits);

/* ------------------------------------------------------------- the draw -- */

await page.fill('#howMany', '5');
await page.click('#drawBtn');
await settle();
let d = await drawn();
ok('five cards come out', d.rows.length === 5, d.rows.length);
ok('the total is what they add to',
  d.total === d.rows.reduce((n, r) => n + r.worth, 0), `${d.total} vs the rows`);
ok('no seat column without a spread', d.rows.every(r => r.seat === null), JSON.stringify(d.rows[0]));

// Every card on the table is face up, showing the card it was dealt.
const table = await page.evaluate(() => cards.map(c => {
  const up = c.shape.reads[c.up];
  return {
    label: c.face.label,
    facingUp: turn(c.quat, up.normal).y > 0.99,
    onTable: Math.abs(c.pos.y - (c.endY ?? c.pos.y)) < 1e-6,
  };
}));
ok('every card lands face up', table.every(c => c.facingUp), JSON.stringify(table));
ok('and the faces are the cards drawn',
  JSON.stringify(table.map(c => c.label)) === JSON.stringify(d.rows.map(r => r.pip.slice(0, -1))),
  `${JSON.stringify(table.map(c => c.label))} vs ${JSON.stringify(d.rows.map(r => r.pip))}`);

// Drawing the whole deck must deal every card once and none of them twice.
await useDeck('major');
await page.fill('#howMany', '22');
await page.click('#drawBtn');
await settle();
d = await drawn();
const names = d.rows.map(r => r.face);
ok('a whole deck deals every card', new Set(names).size === 22, `${new Set(names).size} distinct`);
ok('and the majors add up to 231', d.total === 231, d.total);

await page.fill('#howMany', '23');
await page.click('#drawBtn');
ok('more cards than the deck holds is refused',
  /only 22 cards/.test(await page.textContent('#err')), await page.textContent('#err'));
await page.fill('#howMany', '0');
await page.click('#drawBtn');
ok('and so is none at all', /at least one card/.test(await page.textContent('#err')),
  await page.textContent('#err'));

/* ------------------------------------------------- what they are worth -- */

await useDeck('playing');
await page.fill('#howMany', '3');
await page.click('#drawBtn');
await settle();
const before = await drawn();
await page.fill('#worths input[data-worth="K"]', '40');
await page.waitForTimeout(200);
const after = await drawn();
const kings = before.rows.filter(r => r.pip.startsWith('K')).length;
ok('a king is worth what you say',
  after.total === before.total + kings * (40 - 13), `${before.total} -> ${after.total} with ${kings} kings`);
await page.click('#worthReset');
await page.waitForTimeout(200);
ok('and the usual value comes back',
  (await drawn()).total === before.total, (await drawn()).total);

await useDeck('major');
await page.waitForTimeout(100);
ok('a deck of plain numbers has nothing to set',
  await page.evaluate(() => document.querySelectorAll('#worths input').length) === 0,
  await page.evaluate(() => document.querySelectorAll('#worths input').length));
ok('and says so', /already counts as the number/.test(await page.textContent('#worthNote')),
  await page.textContent('#worthNote'));
ok('jokers are offered on playing cards only',
  await page.evaluate(() => document.getElementById('jokers').disabled), 'the box is live on the majors');
await useDeck('playing');
ok('and offered there', !await page.evaluate(() => document.getElementById('jokers').disabled), 'disabled');
await page.check('#jokers');
await page.waitForTimeout(100);
ok('jokers go into the deck',
  await page.evaluate(() => deckNow().length) === 54, await page.evaluate(() => deckNow().length));
await page.uncheck('#jokers');

/* ----------------------------------------------------------- your own -- */

await page.fill('#ownDeck', '♠ A = 11\n♠ 2\n♠ 3\nFireball = 7 ×3\n# a note\n★ Joker = 0 x2');
await page.click('#useOwn');
await page.waitForTimeout(200);
const own = await page.evaluate(() => deckNow().map(c => `${c.icon}${c.label}=${c.value}`));
ok('your own deck is read a line at a time', own.length === 8, JSON.stringify(own));
ok('a symbol at the front is the icon', own[0] === '♠A=11', own[0]);
ok('a card with no value counts as its own number', own[1] === '♠2=2', own[1]);
ok('times three puts three in', own.filter(c => c === 'Fir=7').length === 3, JSON.stringify(own));
ok('and a hash is a note, not a card', !own.some(c => c.includes('note')), JSON.stringify(own));
await page.fill('#howMany', '8');
await page.click('#drawBtn');
await settle();
ok('your own deck deals', (await drawn()).rows.length === 8, (await drawn()).rows.length);
await page.fill('#ownDeck', '');
await page.click('#useOwn');
await page.click('#drawBtn');
ok('an empty one says so', /no cards in it yet/.test(await page.textContent('#err')),
  await page.textContent('#err'));

/* ------------------------------------------------------------ spreads -- */

await useDeck('tarot');
await page.selectOption('#spread', { label: 'Past, present, future (3)' });
await page.waitForTimeout(100);
ok('a spread sets how many', await page.evaluate(() => document.getElementById('howMany').disabled),
  'the count box is still live');
await page.click('#drawBtn');
await settle();
d = await drawn();
ok('a spread deals one to a place', d.rows.length === 3, d.rows.length);
ok('and names them in order',
  JSON.stringify(d.rows.map(r => r.seat)) === '["Past","Present","Future"]',
  JSON.stringify(d.rows.map(r => r.seat)));
ok('the table knows the places too',
  await page.evaluate(() => cards.map(c => c.seat).join('|')) === 'Past|Present|Future',
  await page.evaluate(() => cards.map(c => c.seat).join('|')));
ok('and the tray says which spread', /Past, present, future/.test(await page.textContent('#trayNote')),
  await page.textContent('#trayNote'));

await page.fill('#spreadName', 'My own three');
await page.fill('#spreadSeats', 'One\nTwo\n\nThree');
await page.click('#saveSpread');
await page.waitForTimeout(100);
ok('a spread of your own saves', /Saved My own three, 3 places/.test(await page.textContent('#spreadSay')),
  await page.textContent('#spreadSay'));
await page.click('#drawBtn');
await settle();
ok('and deals its places',
  JSON.stringify((await drawn()).rows.map(r => r.seat)) === '["One","Two","Three"]',
  JSON.stringify((await drawn()).rows.map(r => r.seat)));

// A spread file, read as data: strings only, nothing else kept.
const file = WORK + '/spreads.json';
fs.writeFileSync(file, JSON.stringify({ spreads: [
  { name: 'From a file', positions: ['Above', 'Below'] },
  { name: 'Bad one', positions: 'not a list' },
  { nope: true },
] }));
await page.setInputFiles('#loadSpreads', file);
await page.waitForTimeout(300);
ok('a file of spreads loads', /Loaded 1 spread/.test(await page.textContent('#spreadSay')),
  await page.textContent('#spreadSay'));
ok('and the rubbish in it is left out',
  await page.evaluate(() => mySpreads.length) === 2, await page.evaluate(() => mySpreads.map(s => s.name)));
await page.click('#drawBtn');
await settle();
ok('the loaded spread deals',
  JSON.stringify((await drawn()).rows.map(r => r.seat)) === '["Above","Below"]',
  JSON.stringify((await drawn()).rows.map(r => r.seat)));
await page.click('#dropSpread');
await page.waitForTimeout(100);
ok('and it can be deleted again',
  await page.evaluate(() => mySpreads.length) === 1, await page.evaluate(() => mySpreads.length));
await page.selectOption('#spread', '');

/* ------------------------------------------------ dealt, laid out, inked -- */

/* A card is placed, not thrown: wherever it was in the air, it finishes in
   the place the arrangement gave it, to the millimetre. */
await page.selectOption('#shape', 'line');
await page.fill('#howMany', '5');
await page.click('#drawBtn');
await settle();
const settledAt = await page.evaluate(() => cards.map(c => ({
  off: Math.hypot(c.pos.x - c.place.x, c.pos.y - c.place.y, c.pos.z - c.place.z),
  // How far the card is from the orientation it was being put down in.
  turn: 2 * Math.acos(Math.min(1, Math.abs(
    c.quat.w * c.place.quat.w + c.quat.x * c.place.quat.x
    + c.quat.y * c.place.quat.y + c.quat.z * c.place.quat.z))) * 180 / Math.PI,
})));
ok('a card lands in the place it was dealt to',
  settledAt.every(c => c.off < 0.01 && c.turn < 0.05),
  JSON.stringify(settledAt));

/* The deal is a deal: cards leave the deck one after another and land one
   after another, rather than all being let go at once the way thrown dice
   are. Both halves of that are watched for over the whole flight. */
await page.click('#drawBtn');
const midway = await page.evaluate(() => new Promise(done => {
  const seen = { partDeck: false, partDown: false, frames: 0 };
  const watch = () => {
    const down = cards.filter(c =>
      Math.hypot(c.pos.x - c.place.x, c.pos.y - c.place.y, c.pos.z - c.place.z) < 0.05).length;
    if (deckLeft > 0 && deckLeft < cards.length) seen.partDeck = true;
    if (down > 0 && down < cards.length) seen.partDown = true;
    seen.frames++;
    if (settled) { done(seen); return; }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}));
ok('they come off the deck one at a time',
  midway.partDeck && midway.partDown, JSON.stringify(midway));
await settle();
ok('and the deck is empty of them by the end',
  await page.evaluate(() => deckLeft) === 0, await page.evaluate(() => deckLeft));

// Face down on the deck and face up on the table: the turn happens on the way.
const flip = await page.evaluate(() => {
  const c = cards[0];
  const up = (q) => {
    const n = c.shape.reads[c.up].normal;
    return turn(q, n).y;
  };
  return { deck: up(c.fromQuat), table: up(c.place.quat) };
});
ok('a card leaves face down and arrives face up',
  flip.deck < -0.9 && flip.table > 0.9, JSON.stringify(flip));

/* ------------------------------------------------------ the arrangements -- */

const laid = async (shape, many) => {
  await page.selectOption('#shape', shape);
  await page.fill('#howMany', String(many));
  await page.click('#drawBtn');
  await settle();
  return page.evaluate(() => cards.map(c => ({
    x: c.pos.x, z: c.pos.z, seat: c.seat,
    turn: Math.atan2(2 * (c.quat.w * c.quat.y), 1 - 2 * (c.quat.y * c.quat.y)),
  })));
};

const line = await laid('line', 6);
const lineZ = line.map(c => Math.abs(c.z));
ok('a line is one row', Math.max(...lineZ) < 0.01, JSON.stringify(lineZ));
ok('and in the order they were drawn',
  line.every((c, i) => i === 0 || c.x > line[i - 1].x), JSON.stringify(line.map(c => +c.x.toFixed(2))));
ok('with no two of them on top of each other',
  line.every((c, i) => i === 0 || c.x - line[i - 1].x > 6.3 * 0.9 * 0.5),
  JSON.stringify(line.map(c => +c.x.toFixed(2))));

/* Thirds as near as thirds go, and the present is the widest row whenever
   they are not all equal. Seven is 2-3-2, eight is 2-4-2, nine is 3-3-3. */
const rowsOf = (cards) => {
  const zs = [...new Set(cards.map(c => +c.z.toFixed(3)))].sort((a, b) => a - b);
  return zs.map(z => cards.filter(c => +c.z.toFixed(3) === z).length);
};
for (const [many, want] of [[3, [1, 1, 1]], [4, [1, 2, 1]], [5, [1, 3, 1]],
                            [7, [2, 3, 2]], [8, [2, 4, 2]], [9, [3, 3, 3]]]) {
  const rows = rowsOf(await laid('rows', many));
  ok(`${many} cards make ${want.join('-')} rows`,
    JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
}
const ppf = await laid('rows', 8);
ok('and the rows are named past, present, future',
  ppf.filter(c => c.seat).map(c => c.seat).join('|') === 'Past|Present|Future',
  JSON.stringify(ppf.map(c => c.seat)));

const ring = await laid('ring', 10);
const radii = ring.map(c => Math.hypot(c.x, c.z));
const spread = Math.max(...radii) - Math.min(...radii);
ok('a ring is a circle, not an oval', spread < 0.01,
  `radii run from ${Math.min(...radii).toFixed(2)} to ${Math.max(...radii).toFixed(2)}`);
const gaps = ring.map((c, i) => {
  const next = ring[(i + 1) % ring.length];
  return Math.hypot(c.x - next.x, c.z - next.z);
});
ok('and evenly spaced round it',
  Math.max(...gaps) - Math.min(...gaps) < 0.01, JSON.stringify(gaps.map(g => +g.toFixed(2))));
ok('each card turned to face out of it',
  ring.every((c, i) => {
    const want = -(i / ring.length) * Math.PI * 2;
    const off = Math.abs(((c.turn - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    return off < 0.02;
  }), JSON.stringify(ring.map(c => +c.turn.toFixed(3))));

/* ------------------------------------------------------------ the colours -- */

const inkOf = (name) => page.evaluate((want) => {
  const deck = deckNow();
  const face = deck.find(c => c.name === want);
  return face ? lookOf(face) : null;
}, name);

await useDeck('playing');
await page.waitForTimeout(100);
const hearts = await inkOf('Ace of Hearts');
const spades = await inkOf('Ace of Spades');
const diamonds = await inkOf('Ace of Diamonds');
const clubs = await inkOf('Ace of Clubs');
const redder = (ink) => ink[0] > 150 && ink[1] < 90 && ink[2] < 90;
const blackish = (ink) => ink.every(v => v < 60);
ok('hearts and diamonds are red',
  redder(hearts.ink) && redder(diamonds.ink), JSON.stringify([hearts.ink, diamonds.ink]));
ok('spades and clubs are black',
  blackish(spades.ink) && blackish(clubs.ink), JSON.stringify([spades.ink, clubs.ink]));
ok('and the stock is the colour of card, not of the page',
  hearts.stock.every(v => v > 200) && spades.stock.every(v => v > 200),
  JSON.stringify(hearts.stock));

await useDeck('uno');
await page.waitForTimeout(100);
const unoLooks = {};
for (const name of ['Red 5', 'Yellow 5', 'Green 5', 'Blue 5', 'Wild']) {
  unoLooks[name] = await inkOf(name);
}
const biggest = (rgb) => rgb.indexOf(Math.max(...rgb));
ok('an Uno card is its own colour',
  biggest(unoLooks['Red 5'].stock) === 0 && biggest(unoLooks['Green 5'].stock) === 1
  && biggest(unoLooks['Blue 5'].stock) === 2, JSON.stringify(
    Object.fromEntries(Object.entries(unoLooks).map(([k, v]) => [k, v.stock]))));
ok('yellow is yellow and prints dark',
  unoLooks['Yellow 5'].stock[0] > 180 && unoLooks['Yellow 5'].stock[1] > 140
  && unoLooks['Yellow 5'].stock[2] < 80 && unoLooks['Yellow 5'].ink.every(v => v < 70),
  JSON.stringify(unoLooks['Yellow 5']));
ok('and a wild is neither',
  unoLooks.Wild.stock.every(v => v < 60), JSON.stringify(unoLooks.Wild.stock));

await useDeck('tarot');
await page.waitForTimeout(100);
const cups = await inkOf('Ace of Cups');
const swords = await inkOf('Ace of Swords');
const fool = await inkOf('0 — The Fool');
ok('tarot suits take the colour of the suits they are',
  redder(cups.ink) && blackish(swords.ink), JSON.stringify([cups.ink, swords.ink]));
ok('and a major arcanum, having no suit, takes the page',
  fool.ink === null, JSON.stringify(fool));

await useDeck('playing');
await page.waitForTimeout(100);
await page.selectOption('#shape', 'line');

await page.fill('#howMany', '1');
await page.click('#drawBtn');
await settle();
const painted = await page.evaluate(() => {
  const c = cards[0];
  const face = c.shape.reads[c.up];
  const angle = () => {
    const mid = add(c.pos, mul(turn(c.quat, face.mid), c.r));
    const a = project(mid);
    const b = project(add(mid, mul(turn(c.quat, face.across), 1)));
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  };
  const was = angle();
  c.quat = qMul(qAxis(v3(0, 1, 0), Math.PI), c.quat);
  spinVerts(c);
  return Math.abs(((angle() - was + 540) % 360) - 180);
});
ok('the printing turns with the card', painted > 170, `half a turn moved it ${painted.toFixed(1)} degrees`);

await page.fill('#howMany', '4');
await page.click('#drawBtn');
await settle();
const hand = await page.evaluate(() => ({
  shown: document.getElementById('hand').textContent,
  values: lastDraw.map(c => c.value),
}));
const sorted = [...hand.values].sort((a, b) => a - b);
const wantMean = (hand.values.reduce((n, v) => n + v, 0) / 4).toFixed(2);
const wantMedian = String(Number(((sorted[1] + sorted[2]) / 2).toFixed(2)));
ok('the figures under the cards are of the cards on the table',
  hand.shown.includes(`mean ${wantMean}`) && hand.shown.includes(`median ${wantMedian}`)
  && hand.shown.includes(`lowest ${sorted[0]}`) && hand.shown.includes(`highest ${sorted[3]}`),
  `${hand.shown} for ${JSON.stringify(hand.values)}`);

const litUp = await page.evaluate(() => {
  const c = document.getElementById('tray');
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit++;
  return lit / (px.length / 4);
});
ok('the table is not a blank canvas', litUp > 0.02, `${(litUp * 100).toFixed(2)}% drawn on`);

/* ------------------------------------------------------- many draws --- */

await useDeck('playing');
await page.fill('#howMany', '2');
await page.click('#drawBtn');
await page.waitForFunction(() => sim && sim.trials === 10000, null, { timeout: 30000 });
let run = await page.evaluate(() => ({
  trials: sim.trials, first: sim.first, last: sim.last, mean: sim.mean,
  say: document.getElementById('simSay').textContent,
  box: document.getElementById('runs').value,
}));
ok('a new draw charts itself', run.trials === 10000, run.trials);
// Two aces is two, two kings is twenty-six: the deck has four of each, so
// the lowest draw is not an ace and a two.
ok('two from a pack runs 2 to 26', run.first === 2 && run.last === 26, `${run.first}-${run.last}`);
// 2 of 52 without replacement: the mean is twice the deck's own mean, 7.
ok('and averages fourteen', Math.abs(run.mean - 14) < 0.35, run.mean);
ok('it says it ran with the draw', /run with the draw/.test(run.say), run.say);
ok('without touching what you typed', run.box === '', JSON.stringify(run.box));

await page.fill('#runs', '40000');
await page.click('#simBtn');
await page.waitForFunction(() => !document.getElementById('simBtn').disabled, null, { timeout: 60000 });
run = await page.evaluate(() => ({ trials: sim.trials, rows: document.querySelectorAll('#table tr').length }));
ok('and runs what you ask for', run.trials === 40000, run.trials);
ok('the numbers are there to read', run.rows === 26, run.rows);   // 2 to 26, and a heading

const saved = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.click('#saveSim'),
]).then(([x]) => x);
const landed = WORK + '/cards-graph.jpg';
await saved.saveAs(landed);
const bytes = fs.readFileSync(landed);
ok('the graph saves as a jpeg named after the draw',
  saved.suggestedFilename() === '2-from-playing-cards.jpg', saved.suggestedFilename());
ok('and it is really a jpeg', bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF,
  [...bytes.subarray(0, 3)].join(','));

/* -------------------------------------------------------- keeping it -- */

const held = await page.evaluate(() => localStorage.getItem('card-drawer'));
ok('what is kept is data, not markup', !/</.test(held), held.slice(0, 60));
await page.reload();
await page.waitForTimeout(300);
const back = await page.evaluate(() => ({
  deck: deckKind, many: document.getElementById('howMany').value,
  spreads: mySpreads.length, log: document.querySelectorAll('.entry').length,
}));
ok('the deck and the count come back', back.deck === 'playing' && back.many === '2', JSON.stringify(back));
ok('so do your spreads', back.spreads === 1, back.spreads);
ok('and the log', back.log > 0, back.log);

await page.evaluate(() => localStorage.setItem('card-drawer', '{"deck":42,"spreads":"<img src=x>","entries":7}'));
await page.reload();
await page.waitForTimeout(300);
const junk = await page.evaluate(() => ({
  deck: deckKind, spreads: mySpreads.length,
  empty: document.querySelector('.empty')?.textContent || null,
}));
ok('junk in storage is ignored rather than believed',
  junk.deck === 'playing' && junk.spreads === 0 && junk.empty === 'Nothing drawn yet.',
  JSON.stringify(junk));

/* ------------------------------------------------------------ narrow -- */

await page.evaluate(() => localStorage.clear());
await page.reload();
await page.fill('#howMany', '4');
await page.click('#drawBtn');
await settle();
await page.waitForFunction(() => sim, null, { timeout: 30000 });
await page.screenshot({ path: WORK + '/cards-wide.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 1700 });
await page.waitForTimeout(400);
ok('no sideways scroll at 390px',
  !await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  'the page is wider than the phone');
await page.screenshot({ path: WORK + '/cards-narrow.png', fullPage: true });

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await browser.close();
