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

/* ------------------------------------------------- not steered, painted -- */

const tidying = await page.evaluate(() => {
  const out = [];
  document.getElementById('howMany').value = '5';
  for (let k = 0; k < 8; k++) {
    document.getElementById('drawBtn').click();
    for (const c of cards) backToStart(c);
    for (let s = 0; s < dealSteps; s++) oneStep(s * (1 / 300));
    for (const c of cards) {
      const q = c.quat, t = c.endQuat;
      const near = Math.min(1, Math.abs(q.w * t.w + q.x * t.x + q.y * t.y + q.z * t.z));
      out.push(2 * Math.acos(near) * 180 / Math.PI);
    }
  }
  return out.sort((a, b) => a - b);
});
ok('a card is left where it stops', tidying[Math.floor(tidying.length / 2)] < 6,
  `the middle card turns ${tidying[Math.floor(tidying.length / 2)].toFixed(1)} degrees`);

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
