/* The ruler. Everything on this page rests on one number — how many of the
   page's pixels go to the inch — so the checks are mostly one question asked
   from several directions: does what is *drawn* follow it?

   So the ticks are read back off the canvas rather than out of the plan that
   made them. A plan that is right and a drawing that is half a millimetre out
   is exactly the bug this page would have, and reading the plan back would
   not see it. The columns of lit pixels are compared against arithmetic done
   here: 10 cm at 96 px to the inch is 377.95 px, and nothing about the page
   is allowed to disagree with that.

   What is not checked here, because nothing headless can be: whether the
   scale is *true*. No browser can hold a bank card against the glass.
   Everything below checks that the page draws what its own scale claims, and
   that the claim follows from the arithmetic; a person with a real rule is
   the only check there is on the last step of it. */
import { chromium, CHROMIUM_BIN, scoring } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/ruler.html';
const MM_IN = 25.4;
const { ok, done } = scoring();

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const errs = [];
const watch = (page) => {
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // The missing favicon says nothing in its text, only in its location.
    if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text());
  });
};

const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await ctx.newPage();
watch(page);
await page.goto(URL);
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload();
await page.waitForFunction(() => window.RULER && window.CLI);

const state = () => page.evaluate(() => window.RULER.state);
const setPpi = async (n) => {
  await page.fill('#ppiIn', String(n));
  await page.waitForFunction((want) => Math.abs(window.RULER.state.cssPpi - want) < 0.001,
    n, { timeout: 5000 });
};

/* The columns of the canvas that have a tick in them, in CSS pixels, read a
   few rows down from the measuring edge so the edge line itself is not one
   long tick. The wash under a mark is far too faint to count. */
const columns = () => page.evaluate(() => {
  const c = document.getElementById('rule');
  const d = window.devicePixelRatio || 1;
  const img = c.getContext('2d').getImageData(0, 0, c.width, Math.round(7 * d));
  const found = [];
  for (let x = 0; x < c.width; x++) {
    for (let y = Math.ceil(2 * d); y < img.height; y++) {
      if (img.data[(y * c.width + x) * 4 + 3] > 40) { found.push(x / d); break; }
    }
  }
  return found;
});

/* ------------------------------------------------------- what it opens on -- */

{
  const s = await state();
  ok('it opens on a guess rather than pretending to know',
    s.how === 'guess' && s.cssPpi === 96 && s.dpr === 1, JSON.stringify(s.how + ' ' + s.cssPpi));
  const said = await page.textContent('#scaleNow');
  ok('and says in the status line that it is one',
    /96 px to the inch/.test(said) && /guess/.test(said), said.slice(0, 90));
  ok('the implied diagonal is the cross-check on it',
    /16\.3 inches across the diagonal/.test(said), said.slice(0, 160));
  ok('and the straight rule is what it opens on',
    s.shape === 'straight' && s.lie === 'across' && s.both === true
      && s.units === 'metric' && s.finest.metric === '1mm', JSON.stringify(s.finest));
}

/* -------------------------------------------------- the ticks, as drawn --- */

{
  await setPpi(96);
  const cols = await columns();
  const pxMm = 96 / MM_IN;
  const w = (await state()).box.w;
  const want = [];
  for (let mm = 0; mm * pxMm < w; mm++) want.push(Math.round(mm * pxMm));

  ok('every millimetre of the rule is drawn, and nothing else is',
    cols.length === want.length && cols.every((c, i) => c === want[i]),
    `${cols.length} columns against ${want.length} millimetres; `
      + `first ${cols.slice(0, 4)} wanted ${want.slice(0, 4)}`);

  /* The one that matters: 10 cm is 10 cm. At 96 px to the inch that is
     377.95 px, and the tick carrying the figure 10 has to be there. */
  ok('10 cm lands 377.95 px along, because that is what 96 px to the inch is',
    cols.includes(Math.round(100 * pxMm)) && Math.round(100 * pxMm) === 378,
    String(Math.round(100 * pxMm)));

  await setPpi(113.5);
  const denser = await columns();
  const want10 = Math.round(100 * 113.5 / MM_IN);
  ok('and on a denser screen the same 10 cm is further along, by the same sum',
    denser.includes(want10) && want10 === 447, `${want10} px`);

  await setPpi(96);
}

/* The ranks have to be a hierarchy on the glass and not only in the data:
   the centimetre tick is the longest line, the half-centimetre next. */
{
  const deep = await page.evaluate(() => {
    const c = document.getElementById('rule');
    const d = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    /* Only the near scale's own half: the far edge carries the other
       system's ticks in the same columns, and the bottom-most lit pixel
       would be one of those whatever the near one did. */
    /* How far the tick itself runs: the lit pixels straight down from the
       measuring edge, stopping at the first gap. Taking the lowest lit pixel
       in the column instead reads the figures, which sit two pixels under
       the tick — and that made this check pass with the ranks deliberately
       collapsed, because the figure beside it filled the gap. */
    const reach = (mm) => {
      const x = Math.round(Math.round(mm * (96 / 25.4)) * d);
      const img = ctx.getImageData(x, 0, 1, Math.round(c.height / 2));
      let y = 0;
      while (y < img.height && img.data[y * 4 + 3] > 40) y++;
      return y / d;
    };
    return { cm: reach(10), half: reach(15), mm: reach(16) };
  });
  ok('a centimetre tick is drawn longer than a half, and a half longer than a millimetre',
    deep.cm > deep.half + 3 && deep.half > deep.mm + 3, JSON.stringify(deep));
}

/* ------------------------------------------------------- the other edge --- */

{
  const far = () => page.evaluate(() => {
    const c = document.getElementById('rule');
    const d = window.devicePixelRatio || 1;
    const rows = Math.round(7 * d);
    const img = c.getContext('2d').getImageData(0, c.height - rows, c.width, rows);
    let lit = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 40) lit++;
    return lit;
  });
  const withBoth = await far();
  await page.click('#bothBtn');
  await page.waitForFunction(() => window.RULER.state.both === false);
  const alone = await far();
  ok('the other unit is drawn on the far edge', withBoth > 200, String(withBoth));
  ok('and turning it off takes it off', alone === 0, String(alone));
  await page.click('#bothBtn');
  await page.waitForFunction(() => window.RULER.state.both === true);
}

/* ------------------------------------------------------------- the mark --- */

{
  const rule = await page.locator('#rule').boundingBox();
  await page.mouse.click(rule.x + 200, rule.y + 40);
  await page.waitForFunction(() => window.RULER.state.markMm !== null);
  const s = await state();
  ok('clicking the rule marks where the pointer was, in millimetres',
    Math.abs(s.markMm - 200 / (96 / MM_IN)) < 0.3, String(s.markMm));
  const read = await page.textContent('#reading');
  ok('and the readout says it in both systems and in pixels',
    read.includes('5.29 cm') && read.includes('2 1/16″') && read.includes('200 px'),
    read.trim());

  await page.locator('#rule').press('ArrowRight');
  const nudged = (await state()).markMm;
  ok('an arrow key moves it by one division', Math.abs(nudged - s.markMm - 1) < 1e-6,
    `${s.markMm} became ${nudged}`);
  await page.locator('#rule').press('Shift+ArrowLeft');
  const back = (await state()).markMm;
  ok('and Shift by ten of them', Math.abs(back - nudged + 10) < 1e-6,
    `${nudged} became ${back}`);
  await page.locator('#rule').press('Escape');
  ok('Escape takes the mark off', (await state()).markMm === null);
}

/* The rule stood on end reads the length down it, which is a different
   coordinate off the same pointer — and nothing above would notice if it
   went on reading the one across. */
{
  await page.click('#lieSeg button[data-lie="down"]');
  await page.waitForFunction(() => window.RULER.state.lie === 'down');
  const rule = await page.locator('#rule').boundingBox();
  await page.mouse.click(rule.x + 40, rule.y + 150);
  await page.waitForFunction(() => window.RULER.state.markMm !== null);
  const s = await state();
  ok('standing the rule on end, a mark is how far down it the pointer was',
    Math.abs(s.markMm - 150 / (96 / MM_IN)) < 0.3, String(s.markMm));
  await page.locator('#rule').press('Escape');
  await page.click('#lieSeg button[data-lie="across"]');
  await page.waitForFunction(() => window.RULER.state.lie === 'across');
}

/* ------------------------------------------------------------ imperial --- */

{
  await page.click('#unitSeg button[data-units="imperial"]');
  await page.waitForFunction(() => window.RULER.state.units === 'imperial');
  const cols = await columns();
  const step = 96 / 16;                       // a sixteenth of an inch, in pixels
  ok('the imperial scale is drawn in sixteenths', Math.abs(cols[1] - cols[0] - step) < 0.01
    && Math.abs(cols[16] - cols[0] - 96) < 0.01, `${cols.slice(0, 3)} … ${cols[16]}`);

  const rule = await page.locator('#rule').boundingBox();
  await page.mouse.click(rule.x + 318, rule.y + 40);
  await page.waitForFunction(() => window.RULER.state.markMm !== null);
  const read = await page.textContent('#reading');
  /* 318 px at 96 to the inch is 3.3125 inches exactly, which is 3 5/16 and
     not 3 10/32: the fraction has to come back in its lowest terms. */
  ok('a mark reads as whole inches and a fraction in its lowest terms',
    read.includes('3 5/16″'), read.trim());

  /* And one that has to be reduced to get there: 336 px is three and a half
     inches, which is eight sixteenths and has to come back as a half. The
     check above would pass with the reduction taken out, because five
     sixteenths is already in its lowest terms. */
  await page.mouse.click(rule.x + 336, rule.y + 40);
  await page.waitForFunction(() => Math.abs(window.RULER.state.markMm - 88.9) < 0.3);
  const half = await page.textContent('#reading');
  ok('eight sixteenths of an inch comes back as a half',
    half.includes('3 1/2″') && !half.includes('8/16'), half.trim());

  /* The mark's flag is eight columns wide at the measuring edge, so it comes
     off before the ticks are counted again. */
  await page.locator('#rule').press('Escape');
  await page.selectOption('#fineSel', '1/32');
  await page.waitForFunction(() => window.RULER.state.finest.imperial === '1/32');
  const finer = await columns();
  ok('asking for thirty-seconds draws twice the ticks',
    Math.abs(finer.length - cols.length * 2) < 3, `${cols.length} became ${finer.length}`);
  await page.selectOption('#fineSel', '1/4');
  await page.waitForFunction(() => window.RULER.state.finest.imperial === '1/4');
  const coarse = await columns();
  ok('and quarters draws a quarter of them',
    Math.abs(coarse.length - cols.length / 4) < 3, `${cols.length} became ${coarse.length}`);

  await page.selectOption('#fineSel', '1/16');
  await page.click('#unitSeg button[data-units="metric"]');
  await page.waitForFunction(() => window.RULER.state.units === 'metric');
}

/* --------------------------------------------------------------- the dial -- */

{
  await page.click('#shapeSeg button[data-shape="dial"]');
  await page.waitForFunction(() => window.RULER.state.shape === 'dial');

  const plan = await page.evaluate(() => window.CLI.jobs.dial({ radius: '6cm', degrees: 1 }));
  ok('the dial is marked every degree all the way round',
    plan.ticks.length === 360 && plan.ticks.filter((t) => t.rank === 0).length === 12,
    `${plan.ticks.length} marks`);
  ok('the figures go every ten degrees',
    plan.ticks.filter((t) => t.label !== null).length === 36,
    String(plan.ticks.filter((t) => t.label !== null).length));
  ok('and the rings are a centimetre apart',
    plan.rings.length === 6 && plan.rings[0].mm === 10, JSON.stringify(plan.rings.length));

  /* Where the arm is drawn, rather than where the state says it is: the sign
     of the angle is the whole convention, and getting it backwards would
     leave every reading off this dial mirrored. */
  const litAt = (deg, frac = 0.9) => page.evaluate(([deg, frac]) => {
    const c = document.getElementById('rule');
    const d = window.devicePixelRatio || 1;
    const g = window.RULER.geom.dialGeom();
    const s = window.RULER.state;
    const r = Math.min(s.armMm * window.RULER.geom.pxMm(), g.R) * frac;
    const rad = (s.zero === 'north' ? (deg - 90) : -deg) * Math.PI / 180;
    const x = Math.round((g.cx + r * Math.cos(rad)) * d);
    const y = Math.round((g.cy + r * Math.sin(rad)) * d);
    /* How bright, rather than whether anything is painted: a ring passes
       through nearly every point at a given radius, and a ring is painted
       too. The arm is drawn in the accent, the brightest thing on the dial. */
    const img = c.getContext('2d').getImageData(x - 3, y - 3, 7, 7);
    let most = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      most = Math.max(most, Math.min(img.data[i], img.data[i + 3]));
    }
    return most;
  }, [deg, frac]);

  await page.evaluate(() => { window.RULER.state; });
  const dial = await page.locator('#rule').boundingBox();
  const geom = await page.evaluate(() => {
    const g = window.RULER.geom.dialGeom();
    return { cx: g.cx, cy: g.cy, R: g.R };
  });
  // 60 degrees anticlockwise from the right, set by dragging as a person would.
  const rad = 60 * Math.PI / 180;
  await page.mouse.click(dial.x + geom.cx + Math.cos(-rad) * geom.R * 0.8,
                         dial.y + geom.cy + Math.sin(-rad) * geom.R * 0.8);
  await page.waitForFunction(() => window.RULER.state.armMm !== null);
  const s = await state();
  ok('dragging in the dial swings the arm to the angle under the pointer',
    Math.abs(s.armDeg - 60) < 0.6, String(s.armDeg));
  ok('the arm is drawn at that angle', await litAt(60) > 180, String(await litAt(60)));
  ok('and not at its mirror image, which is the whole convention',
    await litAt(-60) < 120, String(await litAt(-60)));

  const read = await page.textContent('#reading');
  ok('the readout gives the angle and the arm’s length',
    /60(\.0)?°/.test(read) && /arm \d/.test(read), read.trim());

  /* The other convention, read the way somebody reads a bearing: a point due
     right of the centre is a quarter turn clockwise from the top, so it has
     to come back as 90 and be drawn there. Under the protractor convention
     that same point is nought. */
  await page.click('#zeroSeg button[data-zero="north"]');
  await page.waitForFunction(() => window.RULER.state.zero === 'north');
  const face = await page.locator('#rule').boundingBox();
  await page.mouse.click(face.x + geom.cx + geom.R * 0.8, face.y + geom.cy);
  await page.waitForFunction(() => Math.abs(window.RULER.state.armDeg - 90) < 1);
  ok('nought at the top counts clockwise, so due right reads 90°',
    Math.abs((await state()).armDeg - 90) < 1, String((await state()).armDeg));
  ok('and the arm is drawn there', await litAt(90) > 180, String(await litAt(90)));
  const north = await page.textContent('#reading');
  ok('and the readout says which way it is counting',
    /clockwise from the top/.test(north), north.trim());

  await page.click('#zeroSeg button[data-zero="east"]');
  await page.click('#shapeSeg button[data-shape="straight"]');
  await page.waitForFunction(() => window.RULER.state.shape === 'straight');
}

/* ------------------------------------------------------- settling the scale -- */

{
  await page.click('[data-diag="13.3"]');
  await page.waitForFunction(() => window.RULER.state.how === 'diagonal');
  const s = await state();
  const want = Math.hypot(1200, 1000) / 13.3;    // the viewport is the screen here
  ok('a diagonal sets the scale from the screen’s own pixel count',
    Math.abs(s.ppi - want) < 0.01, `${s.ppi} against ${want}`);
  ok('and the implied diagonal comes back out as the one that went in',
    Math.abs(Number(await page.inputValue('#diagIn')) - 13.3) < 0.01,
    await page.inputValue('#diagIn'));

  /* The outline is the claim the page is making, so it is measured rather
     than taken on trust: a bank card is 85.6 mm wide and no other number. */
  const card = await page.locator('#objBox').boundingBox();
  ok('the card outline is drawn 85.6 mm wide at whatever the scale is',
    Math.abs(card.width - 85.6 * s.cssPpi / MM_IN) < 1.5,
    `${card.width} px for ${85.6 * s.cssPpi / MM_IN}`);

  await page.selectOption('#objSel', 'cd');
  const disc = await page.locator('#objBox').boundingBox();
  ok('and a disc 120 mm across, round',
    Math.abs(disc.width - 120 * s.cssPpi / MM_IN) < 1.5
      && Math.abs(disc.width - disc.height) < 1.5,
    `${disc.width} × ${disc.height}`);

  /* A sheet of A4 at a dense scale is wider than the window, and an outline
     you cannot see both edges of is no use for matching: it has to come down
     and say so rather than being shrunk or clipped, either of which would be
     the page lying about a size. */
  await page.selectOption('#objSel', 'a4');
  await page.fill('#ppiIn', '300');
  await page.waitForFunction(() => Math.abs(window.RULER.state.cssPpi - 300) < 0.001);
  ok('an outline too wide for the window is taken down rather than shrunk',
    await page.locator('#objBox').isHidden()
      && /wider than this window/.test(await page.textContent('#objNote')),
    (await page.textContent('#objNote')).slice(0, 120));
  await page.fill('#ppiIn', '96');
  await page.waitForFunction(() => Math.abs(window.RULER.state.cssPpi - 96) < 0.001);
  ok('and comes back when it fits again',
    await page.locator('#objBox').isVisible(), 'still hidden');
  await page.selectOption('#objSel', 'cd');

  await page.locator('#ppiRange').fill('150');
  await page.waitForFunction(() => Math.abs(window.RULER.state.cssPpi - 150) < 0.01);
  const dragged = await state();
  ok('dragging the slider is a calibration, and the page says where it came from',
    dragged.how === 'object' && dragged.cssPpi === 150, dragged.how);
  const grown = await page.locator('#objBox').boundingBox();
  ok('and the outline grows with it',
    Math.abs(grown.width - 120 * 150 / MM_IN) < 1.5, String(grown.width));

  await page.click('#upBtn');
  ok('the nudge moves it by two tenths of a pixel to the inch',
    Math.abs((await state()).cssPpi - 150.2) < 0.001, String((await state()).cssPpi));
}

/* ----------------------------------------------------------- remembering -- */

{
  await setPpi(127.5);
  await page.selectOption('#fineSel', '0.5mm');
  await page.reload();
  await page.waitForFunction(() => window.RULER && window.CLI);
  const s = await state();
  ok('the scale survives a reload', Math.abs(s.cssPpi - 127.5) < 0.001, String(s.cssPpi));
  ok('and so does the division that was showing', s.finest.metric === '0.5mm',
    JSON.stringify(s.finest));
  ok('the status line says it was remembered',
    /Remembered from last time/.test(await page.textContent('#scaleNow')),
    (await page.textContent('#scaleNow')).slice(0, 200));
  await page.click('#resetBtn');
  ok('and Back to the guess puts it back',
    (await state()).how === 'guess' && (await state()).cssPpi === 96,
    JSON.stringify(await state()));
}

/* ------------------------------------------------------------ and a zoom -- */

/* What is kept is the screen's own density, so the same stored figure on the
   same screen at twice the device pixel ratio — which is what a zoom looks
   like from in here — has to come out at half the pixels to the inch and
   still draw a centimetre a centimetre wide. Playwright cannot zoom a page,
   but it can open one at a ratio of 2, and the arithmetic under test is the
   division rather than the cause. */
{
  const zoomed = await browser.newContext({
    viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 2 });
  const tab = await zoomed.newPage();
  watch(tab);
  await tab.goto(URL);
  await tab.evaluate(() => localStorage.setItem('smallpages.ruler',
    JSON.stringify({ ppi: 227, how: 'object', dpr: 1 })));
  await tab.reload();
  await tab.waitForFunction(() => window.RULER);
  const s = await tab.evaluate(() => window.RULER.state);
  ok('a screen of 227 ppi at a ratio of 2 is 113.5 px to the inch on the page',
    Math.abs(s.cssPpi - 113.5) < 0.001 && s.dpr === 2, JSON.stringify(s.cssPpi));

  const ten = await tab.evaluate(() => {
    const c = document.getElementById('rule');
    const d = window.devicePixelRatio;
    const img = c.getContext('2d').getImageData(0, 0, c.width, Math.round(7 * d));
    const found = [];
    for (let x = 0; x < c.width; x++) {
      for (let y = Math.ceil(2 * d); y < img.height; y++) {
        if (img.data[(y * c.width + x) * 4 + 3] > 40) { found.push(x / d); break; }
      }
    }
    return found;
  });
  ok('and 10 cm is drawn 446.85 px along, not 377.95',
    ten.includes(Math.round(100 * 113.5 / MM_IN * 2) / 2), `near ${ten.slice(170, 180)}`);
  /* Ticks are snapped to whole *device* pixels, so at a ratio of 2 some of
     them land on a half of one of the page's. Snapping to the page's pixels
     instead would leave every one of them a whole number, and at a ratio of
     1 the two are the same thing — this is the only place the difference is
     visible at all. */
  ok('a tick is snapped to a device pixel rather than one of the page\u2019s',
    ten.some((x) => !Number.isInteger(x)),
    `${ten.slice(100, 104)} — none of them a half`);

  ok('the status line owns up to the zoom having moved',
    /zoom has changed since/.test(await tab.textContent('#scaleNow')),
    (await tab.textContent('#scaleNow')).slice(60, 260));

  /* And the diagonal has to be worked out from the pixels the screen really
     has rather than the ones the page can see, which is the same division in
     the other direction and is invisible at a ratio of 1. */
  await tab.click('[data-diag="13.3"]');
  await tab.waitForFunction(() => window.RULER.state.how === 'diagonal');
  const byDiagonal = await tab.evaluate(() => window.RULER.state);
  ok('a 13.3-inch diagonal is reckoned off the device pixels, not the page\u2019s',
    Math.abs(byDiagonal.ppi - Math.hypot(2400, 2000) / 13.3) < 0.01
      && Math.abs(byDiagonal.cssPpi - Math.hypot(2400, 2000) / 13.3 / 2) < 0.01,
    `${byDiagonal.ppi} ppi, ${byDiagonal.cssPpi} on the page`);
  await zoomed.close();
}

/* On a phone the opening choice cannot be a bank card, because a bank card is
   wider than the screen — there would be nothing on screen to hold it
   against. It has to open on something that fits instead. */
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true });
  const tab = await phone.newPage();
  watch(tab);
  await tab.goto(URL);
  await tab.evaluate(() => { try { localStorage.clear(); } catch {} });
  await tab.reload();
  await tab.waitForFunction(() => window.RULER);
  const s = await tab.evaluate(() => window.RULER.state);
  const outline = await tab.locator('#objBox').boundingBox();
  ok('on a phone it opens on something that fits on a phone',
    s.thing !== 'card' && outline.width < 390,
    `${s.thing}, ${outline && outline.width} px wide`);
  ok('and the page does not run off the side of it',
    await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    await tab.evaluate(() => `${document.documentElement.scrollWidth} in ${window.innerWidth}`));
  await phone.close();
}

/* ------------------------------------------------------------- refusals --- */

{
  const refused = await page.evaluate(() => {
    const out = {};
    const tryIt = (name, work) => {
      try { work(); out[name] = 'answered'; } catch (e) { out[name] = e.message; }
    };
    tryIt('finest', () => window.CLI.jobs.ticks({ finest: '1/5' }));
    tryIt('units', () => window.CLI.jobs.ticks({ units: 'furlongs' }));
    tryIt('length', () => window.CLI.jobs.ticks({ length: '30 parsecs' }));
    tryIt('degrees', () => window.CLI.jobs.dial({ degrees: 7 }));
    tryIt('scale', () => window.CLI.jobs.scale({ dpi: 2 }));
    return out;
  });
  ok('a division the scale has not got is refused with the list it has',
    /no 1\/5 division/.test(refused.finest) && /5mm, 2mm, 1mm, 0.5mm/.test(refused.finest),
    refused.finest);
  ok('and so are units it does not have', /metric or imperial/.test(refused.units),
    refused.units);
  ok('a length it cannot read says what one looks like',
    /not a length/.test(refused.length), refused.length);
  ok('a degree step the dial is not marked in is refused',
    /5, 2, 1 degrees/.test(refused.degrees), refused.degrees);
  ok('and a scale no screen has', /is not a screen/.test(refused.scale), refused.scale);
}

ok('nothing threw along the way', errs.length === 0, errs.join(' | '));
await browser.close();
process.exit(done());
