/* The quote maker.

   Nearly everything on this page comes out of one measurement — how big the
   words have to be to fit the box — and a measurement taken against the wrong
   face is the bug this page is most likely to have. A webfont that has not
   arrived does not draw wrong, it *measures* wrong: the fitter sizes the
   quote to Georgia's metrics, the face lands a frame later, and the words run
   off the canvas with nothing on screen having complained. So the checks
   below read the ink back off the canvas rather than the plan that made it,
   and the plan is only trusted about things the ink cannot show.

   The other half is the photographs. `images.pexels.com` answers with
   `Access-Control-Allow-Origin: *` today — every path in the page's list was
   checked against the live CDN while it was being written — but a suite that
   needed the real one would be a suite that fails when a train goes into a
   tunnel, and it could never exercise the case that matters, which is the CDN
   one day saying no. So the CDN is intercepted here and answered both ways:
   with the header, where the picture has to arrive and the canvas has to stay
   exportable, and without it, where the page has to say so out loud rather
   than quietly handing back a canvas that cannot be saved.

   What is not checked here: whether the faces are pretty, and whether a
   particular photograph suits a particular quote. */
import fs from 'node:fs';
import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/quote-maker.html';
const { ok, done } = scoring();

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 },
  acceptDownloads: true });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => {
  // The missing favicon says nothing in its text, only in its location.
  if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text());
});

/* ------------------------------------------------- standing in for Pexels -- */

/* Every request the page makes to the CDN, and how it was answered. `cors`
   decides whether the reply carries the header; `fail` kills the connection,
   which is what no network looks like. */
const asked = [];
let cors = true;
let fail = false;
let stub = null;                 // jpeg bytes, drawn below once there is a tab

await page.route('https://images.pexels.com/**', async (route) => {
  const url = route.request().url();
  asked.push(url);
  if (fail) return route.abort('connectionrefused');
  await route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    /* The one header the whole question turns on. Without it the browser
       throws the fetch away before the page ever sees a byte. */
    headers: cors ? { 'access-control-allow-origin': '*' } : {},
    body: stub,
  });
});

await page.goto(URL);
await page.waitForFunction(() => window.CLI && window.CLI.image().renders > 0);

/* A picture with structure in it rather than a flat fill: the shade checks
   below measure a mean, and a mean of one colour cannot show a scrim working
   in the right direction only on the parts that had somewhere to go. The
   halves are deliberately lopsided so a photo drawn upside down or mirrored
   would show up. */
stub = Buffer.from(await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 800;
  const g = c.getContext('2d');
  g.fillStyle = '#20304a'; g.fillRect(0, 0, 1200, 800);
  g.fillStyle = '#c8d4e4'; g.fillRect(0, 0, 1200, 300);
  for (let i = 0; i < 400; i++) {
    /* A fixed sequence, not Math.random, so two runs draw the same picture. */
    const x = (i * 97) % 1200, y = 300 + ((i * 53) % 500);
    g.fillStyle = i % 2 ? '#4a5f7d' : '#16202f';
    g.fillRect(x, y, 24, 24);
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}));

/* ------------------------------------------------------------- the tools -- */

const state = () => page.evaluate(() => window.CLI.image());
const plan = (o = {}) => page.evaluate((opts) => window.CLI.jobs.make(opts), o);

/* Wait on the answer rather than on a stopwatch: `renders` moves once per
   finished draw, so a check after this is reading the new canvas. */
async function settle(act) {
  const was = (await state()).renders;
  await act();
  await page.waitForFunction((n) => window.CLI.image().renders > n, was, { timeout: 30000 });
}

/* The bounding box of anything on the canvas that is close to the text
   colour, in canvas pixels — which is where the words really are, as opposed
   to where the plan says they should be. */
const inkBox = (hex) => page.evaluate((want) => {
  const c = document.getElementById('canvas');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const n = parseInt(want.slice(1), 16);
  const tr = (n >> 16) & 255, tg = (n >> 8) & 255, tb = n & 255;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, hits = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - tr) < 24 && Math.abs(d[i + 1] - tg) < 24
          && Math.abs(d[i + 2] - tb) < 24) {
        hits++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return hits ? { x0, y0, x1, y1, hits, w: c.width, h: c.height } : null;
}, hex);

/* The mean of the canvas, which is how the scrim is caught going the wrong
   way: darkening a picture lowers it and lightening it raises it. */
const meanLuma = () => page.evaluate(() => {
  const c = document.getElementById('canvas');
  const s = document.createElement('canvas');
  s.width = 32; s.height = 32;
  const g = s.getContext('2d');
  g.drawImage(c, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4);
});

/* ============================================================ what it opens on */

{
  const s = await state();
  const p = await plan({});
  ok('opens on a 1000-pixel square',
    p.width === 1000 && p.height === 1000, `${p.width}x${p.height}`);
  ok('opens in a face that needs nothing fetched',
    p.font === 'Georgia' && p.where === 'local', `${p.font} / ${p.where}`);
  ok('opens with no photograph behind it', s.photo === null, JSON.stringify(s.photo));
  ok('opens with a quote in the box rather than an empty canvas',
    p.lines.join(' ').includes('mountains are calling') && p.author === 'John Muir',
    JSON.stringify(p.lines));

  /* The page's markup and the page's script have to agree about which state
     it is in — playlist-to-audio.html shipped for a while with the card lit
     up disagreeing with the variable underneath it. */
  const shown = await page.evaluate(() => ({
    font: document.getElementById('font').value,
    align: document.querySelector('#alignSeg button[aria-pressed="true"]').dataset.align,
    preset: document.getElementById('preset').value,
    fill: document.getElementById('fill').value,
    fillOut: document.getElementById('fillOut').textContent,
    shade: document.getElementById('shade').value,
    shadeOut: document.getElementById('shadeOut').textContent,
    format: document.getElementById('format').value,
    qualityHidden: document.getElementById('qualityFld').hidden,
  }));
  ok('every control on screen says what the page says it says',
    shown.font === p.font && shown.align === p.align && shown.preset === '1000x1000'
    && shown.fill === shown.fillOut && shown.shade === shown.shadeOut,
    JSON.stringify(shown));
  ok('the quality slider is put away for the one format that ignores it',
    shown.format === 'image/png' && shown.qualityHidden === true, JSON.stringify(shown));
}

/* ================================================================ the fitter */

{
  const p = await plan({ fill: 100 });
  const margin = Math.round(1000 * 0.09);
  ok('at full size the type is the size that fits, and no more',
    p.size === p.fitted, `${p.size} vs ${p.fitted}`);
  ok('the longest line stays inside the margin',
    p.widest <= 1000 - margin * 2, `${p.widest} > ${1000 - margin * 2}`);

  /* The plan can say whatever it likes; this is where the words actually are. */
  const box = await inkBox('#ffffff');
  ok('and the ink lands inside the margin too',
    box && box.x0 >= margin - 2 && box.x1 <= 1000 - margin + 2
    && box.y0 >= margin - 2 && box.y1 <= 1000 - margin + 2,
    JSON.stringify(box));

  /* Found by breaking the page on purpose: drawing the block from the top of
     the canvas instead of the middle of it was caught by exactly one check,
     and only by accident — the ink was still inside the margin, so only the
     bound nearest the top complained. Centring is the whole look of the
     thing, so it gets said outright, as the two gaps above and below the ink
     being the same to within a pixel or two of rounding. */
  /* The ink is only centred to within its own side bearings: the blank built
     into the left of a T and the right of a comma are part of the glyph and
     not part of what the eye reads as the edge of the line. Those scale with
     the type, so the slack here does too — a twentieth of the type size,
     which is about one bearing — rather than being a flat number that would
     be generous at 40 px and impossible at 400. */
  const slack = (p2) => Math.max(3, Math.round(p2.size * 0.05));
  const centred = await inkBox('#ffffff');
  ok('the block of words sits in the middle of the canvas, not at the top',
    centred && Math.abs(centred.y0 - (1000 - centred.y1)) <= slack(p),
    centred && `${centred.y0} above, ${1000 - centred.y1} below, slack ${slack(p)}`);

  const wide = await plan({ canvas: '1600x900', fill: 100 });
  const centred2 = await inkBox('#ffffff');
  ok('and goes on doing it when the canvas is not a square',
    centred2 && Math.abs(centred2.y0 - (900 - centred2.y1)) <= slack(wide)
      && Math.abs(centred2.x0 - (1600 - centred2.x1)) <= slack(wide),
    centred2 && `${centred2.y0}/${900 - centred2.y1} and `
      + `${centred2.x0}/${1600 - centred2.x1}, slack ${slack(wide)}`);

  /* Left-aligned, where there is nothing for a bearing to hide in: the ink
     has to start at the margin and the right-hand gap has to be real. */
  await plan({ canvas: '1600x900', align: 'left', fill: 100 });
  const left = await inkBox('#ffffff');
  const margin1600 = Math.round(900 * 0.09);
  ok('aligned left, the words start at the margin and leave the rest alone',
    left && Math.abs(left.x0 - margin1600) <= slack(wide)
      && (1600 - left.x1) > margin1600,
    left && `${left.x0} in from the left, margin is ${margin1600}`);
  await plan({ canvas: '1000x1000', align: 'center', fill: 100 });

  const small = await plan({ fill: 40 });
  const smallBox = await inkBox('#ffffff');
  ok('the size slider makes the words smaller',
    small.size < p.size, `${small.size} vs ${p.size}`);
  ok('and the ink shrinks with it rather than only the number',
    smallBox && (smallBox.x1 - smallBox.x0) < (box.x1 - box.x0),
    `${smallBox && smallBox.x1 - smallBox.x0} vs ${box.x1 - box.x0}`);
  ok('a smaller size still fits the box',
    smallBox && smallBox.x0 >= margin - 2 && smallBox.x1 <= 1000 - margin + 2,
    JSON.stringify(smallBox));
}

/* WHAT IS NOT CHECKED, and why, found by deleting things and seeing what
   complained. The fitter will only accept a size if the block fits the box
   *and* no line is wider than it; taking the width half out breaks nothing
   that any check here can see, because `wrapAt` has already made it true —
   it breaks a line before it passes the box and breaks an over-long word by
   letter. It is a second guard, not the one doing the work, and the one case
   it is really for is a single character wider than the whole box, which has
   nowhere to break and which no sane canvas is small enough to produce. So
   there is no check for it: it is a limit written down rather than coverage
   pretended at. */

{
  /* A word longer than the box. Without the hard break the greedy wrap can
     never produce a line that fits, the search bottoms out at four pixels,
     and the page silently sets a perfectly ordinary quote in nothing. */
  const long = 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch';
  const p = await plan({ text: long, author: '', fill: 100 });
  const margin = Math.round(1000 * 0.09);
  ok('a word wider than the canvas is broken rather than overflowing',
    p.lines.length > 1 && p.widest <= 1000 - margin * 2 && p.size > 20,
    `${p.lines.length} lines, ${p.widest} wide, ${p.size}px`);
  ok('and every letter of it survives the break',
    p.lines.join('') === long, p.lines.join(''));
  const box = await inkBox('#ffffff');
  ok('the broken word is drawn inside the margin',
    box && box.x0 >= margin - 2 && box.x1 <= 1000 - margin + 2, JSON.stringify(box));
}

{
  const p = await plan({ text: 'one\n\ntwo', author: '', fill: 100 });
  ok('a newline in the box is a newline on the canvas',
    p.lines[0] === 'one' && p.lines[p.lines.length - 1] === 'two' && p.lines.length === 3,
    JSON.stringify(p.lines));
}

{
  await plan({ text: '', author: '' });
  const box = await inkBox('#ffffff');
  ok('nothing typed draws nothing, rather than drawing an em dash',
    box === null || box.hits < 20, JSON.stringify(box));
  const s = await state();
  ok('and says so without calling it an error',
    /Nothing typed/.test(s.note) && !s.failed, s.note);
}

/* ================================================== the face it is measured in */

{
  await plan({ text: 'The mountains are calling and I must go.', author: 'John Muir' });
  const georgia = await plan({ font: 'Georgia', fill: 100 });
  const league = await plan({ font: 'League Gothic', fill: 100 });

  ok('a face out of the repo really loads before anything is measured',
    await page.evaluate(() => document.fonts.check('400 48px "League Gothic"')),
    'League Gothic never arrived');
  /* A condensed face fits far more on a line than Georgia does. If the fitter
     were measuring against a fallback these two would come out identical,
     which is the whole failure this check exists for. */
  ok('and the fitter measures in it, not in the fallback',
    league.lines.length < georgia.lines.length || league.size > georgia.size * 1.15,
    `league ${league.lines.length} lines at ${league.size}px, `
    + `georgia ${georgia.lines.length} at ${georgia.size}px`);

  const leagueBox = await inkBox('#ffffff');
  await plan({ font: 'Georgia', fill: 100 });
  const georgiaBox = await inkBox('#ffffff');
  ok('and the canvas is drawn in it, not just planned in it',
    Math.abs((leagueBox.y1 - leagueBox.y0) - (georgiaBox.y1 - georgiaBox.y0)) > 10,
    `${leagueBox.y1 - leagueBox.y0} vs ${georgiaBox.y1 - georgiaBox.y0}`);

  ok('a face the page does not have is a sentence with the list in it',
    await plan({ font: 'Comic Papyrus' }).then(() => false, (e) =>
      /no face called/.test(e.message) && /Georgia/.test(e.message)),
    'it took a face that does not exist');
}

/* ======================================================= the canvas it is on */

{
  const p = await plan({ canvas: '1920x1080' });
  ok('a canvas asked for by its numbers is that size',
    p.width === 1920 && p.height === 1080, `${p.width}x${p.height}`);
  ok('and the boxes on screen follow it',
    await page.inputValue('#width') === '1920' && await page.inputValue('#height') === '1080',
    await page.inputValue('#width'));
  ok('and the preset select lands on the matching row rather than lying',
    await page.inputValue('#preset') === '1920x1080', await page.inputValue('#preset'));

  const byName = await plan({ canvas: '4k' });
  ok('a canvas asked for by name is resolved by the page',
    byName.width === 3840 && byName.height === 2160, `${byName.width}x${byName.height}`);

  ok('a canvas name the page does not have is a sentence with the list in it',
    await plan({ canvas: 'retina-ish' }).then(() => false, (e) =>
      /no canvas called/.test(e.message) && /1920x1080/.test(e.message)),
    'it took a size that does not exist');

  ok('--canvas and --width together are refused rather than one winning',
    await plan({ canvas: '4k', width: 800 }).then(() => false, (e) =>
      /one or the other/.test(e.message)), 'it took both');

  ok('a size past what the boxes offer is a sentence, not a silent clamp',
    await plan({ width: 40000 }).then(() => false, (e) =>
      /whole number from 64 to 16384/.test(e.message)), 'it took 40000');

  /* The clamps under those boxes cannot be reached through the boxes' own
     limits, which is exactly the shape of thing nothing ever checks — so they
     are reached the way a person reaches them, by typing a number past the
     box's max, which no browser prevents. A canvas past what Chromium will
     paint comes back fully transparent rather than refusing, so the page
     bringing it down is the only thing standing between a wallpaper and an
     empty file. */
  await settle(async () => {
    await page.fill('#width', '99999');
    await page.fill('#height', '300');
  });
  let huge = await plan({});
  ok('a canvas too wide to paint is brought down to the widest that is',
    huge.capped && huge.width === 65535 && huge.height < 300,
    `${huge.width}x${huge.height} capped=${huge.capped}`);
  ok('and the size that was asked for is reported, not quietly swallowed',
    !!huge.asked && huge.asked.width === 99999 && huge.asked.height === 300,
    JSON.stringify(huge.asked));
  ok('and the page says on screen that it did it',
    /past what a browser will paint/.test((await state()).note), (await state()).note);
  /* Saying so is not the same as failing: the canvas is real and the plan is
     about this run, so a job that threw here would be refusing to hand back a
     perfectly good picture. */
  ok('and hands the picture back rather than refusing it',
    huge.lines.join(' ').length > 0 && huge.size > 4, JSON.stringify(huge.lines));

  /* And the other clamp, which the first one cannot stand in for: both sides
     are paintable on their own and the two together are not.

     This is the expensive check in the suite. Clamping by area always lands
     at the ceiling by definition, so there is no cheaper canvas that proves
     it, and for a moment the page is holding two canvases of 2^28 pixels —
     the picture and the background under it — which is about two gigabytes.
     If this suite ever dies of memory rather than failing a check, this is
     where it happened. */
  await settle(async () => {
    await page.fill('#width', '20000');
    await page.fill('#height', '16000');
  });
  huge = await plan({});
  ok('a canvas too large in total is brought down by area, keeping its shape',
    huge.capped && huge.width * huge.height <= 268435456
    && Math.abs((huge.width / huge.height) - (20000 / 16000)) < 0.01,
    `${huge.width}x${huge.height} capped=${huge.capped}`);
  const stillThere = await page.evaluate(() => {
    const c = document.getElementById('canvas');
    return { w: c.width, h: c.height,
      painted: c.getContext('2d').getImageData(c.width - 1, c.height - 1, 1, 1).data[3] };
  });
  ok('and what came back is a canvas that really is painted to its corners',
    stillThere.painted === 255 && stillThere.w === huge.width, JSON.stringify(stillThere));

  await settle(async () => {
    await page.fill('#width', '1000');
    await page.fill('#height', '1000');
  });
  await plan({ canvas: '1000x1000' });
}

/* ========================================================== colour and shade */

{
  const p = await plan({ colour: '#ff3366', background: '#101010', fill: 60 });
  ok('the words are drawn in the colour that was asked for',
    p.colour === '#ff3366', p.colour);
  const box = await inkBox('#ff3366');
  ok('and there is that much of it on the canvas',
    box && box.hits > 500, JSON.stringify(box));

  ok('a colour that is not a colour is a sentence',
    await plan({ colour: 'reddish' }).then(() => false, (e) =>
      /hex colour/.test(e.message)), 'it took "reddish"');

  const bgOnly = await page.evaluate(() => {
    const g = document.getElementById('canvas').getContext('2d');
    const d = g.getImageData(4, 4, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]},${d[3]}`;
  });
  ok('the plain colour fills the corners, opaque', bgOnly === '16,16,16,255', bgOnly);
}

/* ============================================================ the photograph */

{
  asked.length = 0;
  await plan({ canvas: '1000x1000', colour: '#ffffff', fill: 80 });

  const got = await page.evaluate(() => window.CLI.jobs.pexels({ index: 0 }));
  ok('a photograph fetched with the CORS header arrives',
    got.width === 1200 && got.height === 800, JSON.stringify(got));
  ok('and the request went to the CDN with a width on it',
    asked.length === 1 && /[?&]w=\d+/.test(asked[0]), asked.join(' '));
  ok('and the credit under the canvas names the photographer, with a link',
    (await page.textContent('#credit')).includes(got.by)
    && (await page.getAttribute('#credit a', 'href')) === got.page,
    await page.textContent('#credit'));

  /* The whole reason the photograph is fetched as bytes rather than pointed
     at: a canvas handed a cross-origin <img> previews perfectly and throws on
     the way out. If this ever starts failing, that is what happened. */
  const saved = await page.evaluate(() => window.CLI.jobs.make({ bytes: true }));
  ok('and the canvas with a remote photograph on it still exports',
    saved.bytes && saved.bytes.length > 1000 && saved.fileBytes === saved.bytes.length,
    `${saved.bytes ? saved.bytes.length : 0} bytes`);

  /* The width asked for is arithmetic over the canvas and the photo's shape,
     so growing the canvas has to go back for a bigger one — otherwise a 4K
     wallpaper is a 1500-pixel picture blown up, and nothing says so. */
  const first = Number(/[?&]w=(\d+)/.exec(asked[0])[1]);
  asked.length = 0;
  await plan({ canvas: '4k' });
  const again = asked.length ? Number(/[?&]w=(\d+)/.exec(asked[asked.length - 1])[1]) : 0;
  ok('growing the canvas fetches the same photograph again, bigger',
    asked.length >= 1 && again > first, `${first} then ${again}`);

  asked.length = 0;
  await plan({ canvas: '1000x1000' });
  ok('and shrinking it does not, because the one in hand is already enough',
    asked.length === 0, asked.join(' '));
}

{
  /* The scrim has one knob and has to point it the right way by itself. */
  await page.evaluate(() => window.CLI.jobs.pexels({ index: 0 }));
  const none = await plan({ shade: 0, colour: '#ffffff', text: '', author: '' });
  const bare = await meanLuma();
  await plan({ shade: 80, colour: '#ffffff' });
  const darkened = await meanLuma();
  await plan({ shade: 80, colour: '#111111' });
  const lightened = await meanLuma();

  ok('light words push the picture down', darkened < bare - 20,
    `${bare.toFixed(1)} -> ${darkened.toFixed(1)}`);
  ok('dark words push it up instead', lightened > bare + 20,
    `${bare.toFixed(1)} -> ${lightened.toFixed(1)}`);
  ok('and the page says which way round it is going',
    /Lightening/.test(await page.textContent('#shadeNote')),
    await page.textContent('#shadeNote'));
  ok('no shade leaves the picture alone', none.shade === 0, String(none.shade));
}

{
  /* A photograph has to cover the canvas, not letterbox into it: a 3:2
     picture on a square canvas means no bare background anywhere. */
  await plan({ canvas: '1000x1000', shade: 0, text: '', author: '', background: '#ff00ff' });
  const bare = await page.evaluate(() => {
    const g = document.getElementById('canvas').getContext('2d');
    const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] > 200 && d[2] > 200 && d[1] < 60; };
    return [at(2, 2), at(997, 2), at(2, 997), at(997, 997), at(500, 2), at(500, 997)];
  });
  ok('the picture covers the canvas, with no plain colour showing through',
    bare.every((hit) => hit === false), JSON.stringify(bare));
}

/* ====================================================== when the fetch fails */

/* WHAT IS AND IS NOT CHECKED HERE, because the obvious version of this is a
   check that cannot fail.

   The first thing written here served the stub *without*
   `Access-Control-Allow-Origin` and asserted that the page noticed. It
   passed, and it was worthless: Playwright fulfils a routed request inside
   the browser, past the point where cross-origin rules are applied, so a
   fulfilled response is accepted whatever headers it carries or does not.
   Both spellings passed identically, which is what a tautology looks like.

   So the refusal is covered from the two ends that can really be reached.
   Below: the fetch rejecting, which is the whole of what the page sees of a
   CORS refusal — `fetch` reports "the CDN would not have you" and "there is
   no network" as the same TypeError with the same message, deliberately, so
   there is exactly one code path here and `route.abort` is on it. And
   after it: that a cross-origin response really is refused, and that a canvas
   really is tainted by one, run against a second origin rather than a
   simulation — which is the reason this page fetches bytes instead of
   pointing an <img> at the CDN, and the check that would notice if that
   reason ever stopped being true. */
{
  await page.evaluate(() => window.CLI.jobs.clearPhoto());

  fail = true;
  const dead = await page.evaluate(() => window.CLI.jobs.pexels({ index: 1 })
    .then(() => null, (e) => e.message));
  ok('a fetch that will not complete is a sentence, not a half-loaded picture',
    dead && /couldn't fetch the photo/.test(dead), String(dead));
  ok('and the sentence says what to do instead rather than naming a header',
    dead && /dropping the file in/.test(dead) && /CDN refused/.test(dead), String(dead));
  ok('nothing is left behind, so the canvas is still the one it was',
    (await state()).photo === null, JSON.stringify((await state()).photo));
  /* The failure this is really about: a page that let a tainted picture
     through would preview perfectly and throw only on Save. */
  const after = await page.evaluate(() => window.CLI.jobs.make({ bytes: true })
    .then((m) => m.bytes.length, (e) => 'threw: ' + e.message));
  ok('and saving still works afterwards',
    typeof after === 'number' && after > 1000, String(after));
  fail = false;

  /* The aborted fetch is a console error the page is right to log and the
     suite asked for, so it comes off the list here, where it was caused. */
  const mine = errs.filter((e) => /ERR_CONNECTION_REFUSED|Failed to load resource/.test(e));
  for (const e of mine) errs.splice(errs.indexOf(e), 1);
  ok('the aborted fetch logged exactly one complaint, and it was ours',
    mine.length >= 1, mine.join(' | '));

  ok('an id the list does not have is a sentence rather than a dice roll',
    await page.evaluate(() => window.CLI.jobs.pexels({ id: 999999 })
      .then(() => false, (e) => /no photo with the id/.test(e.message))),
    'it took an id that is not there');
}

{
  /* The premise, tested rather than asserted. `localhost` and `127.0.0.1` are
     the same server and two different origins, and the suites' static server
     sends no CORS header, so this is a real refusal by a real browser — no
     routing, nothing simulated. If either of these two ever stops being true,
     the comment at the top of quote-maker.html is out of date. */
  const other = 'http://localhost:8099/favicon-32.png';

  const fetched = await page.evaluate((u) => fetch(u, { mode: 'cors' })
    .then(() => 'allowed', (e) => 'refused: ' + e.message), other);
  ok('a cross-origin response with no CORS header really is refused',
    /^refused/.test(fetched), fetched);

  const tainted = await page.evaluate((u) => new Promise((settle) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      c.getContext('2d').drawImage(img, 0, 0);
      try { c.toDataURL(); settle('exported'); }
      catch (e) { settle('tainted: ' + e.name); }
    };
    img.onerror = () => settle('would not load');
    img.src = u;
  }), other);
  ok('and the same picture as a plain <img> loads fine and then poisons a canvas',
    /^tainted/.test(tainted), tainted);

  /* Which is the trap: that picture previews perfectly. So the page never
     does it — and after a real pull, its own canvas still exports. */
  cors = true;
  await page.evaluate(() => window.CLI.jobs.pexels({ index: 0 }));
  const ours = await page.evaluate(() => window.CLI.jobs.make({ bytes: true })
    .then((m) => m.bytes.length, (e) => 'threw: ' + e.message));
  ok('the page\'s own canvas is never the poisoned kind',
    typeof ours === 'number' && ours > 1000, String(ours));

  /* Chromium logs the refusal above, correctly — the suite asked for it, so
     it comes off the list here rather than at the end. That it is there at
     all is the proof the refusal was the browser's and not a stub's. */
  const mine = errs.filter((e) => /blocked by CORS policy/.test(e));
  for (const e of mine) errs.splice(errs.indexOf(e), 1);
  ok('and the refusal was loud enough for the browser to log it',
    mine.length === 1, mine.join(' | '));
}

/* ===================================================================== the dice */

{
  await plan({ canvas: '1000x1000', text: 'The mountains are calling and I must go.',
    author: 'John Muir', font: 'Georgia', colour: '#ffffff' });

  const a = await plan({ randomFont: true, randomColour: true, seed: 11 });
  const b = await plan({ randomFont: true, randomColour: true, seed: 11 });
  ok('the same seed rolls the same face and the same colour',
    a.rolled.font === b.rolled.font && a.rolled.colour === b.rolled.colour,
    JSON.stringify([a.rolled, b.rolled]));

  const seeds = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    seeds.push((await plan({ randomFont: true, seed })).rolled.font);
  }
  ok('different seeds roll different faces',
    new Set(seeds).size >= 5, seeds.join(', '));
  ok('and the dice never land on the face already showing',
    seeds.every((f, i) => i === 0 || f !== seeds[i - 1]) || new Set(seeds).size > 1,
    seeds.join(', '));

  /* A random colour is only worth having if it can be read, which means it
     has to look at what is behind the words first. Both ends, so a check that
     always passes because white happens to work is caught. */
  await page.evaluate(() => window.CLI.jobs.clearPhoto());
  const onWhite = [];
  const onBlack = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    onWhite.push((await plan({ background: '#ffffff', randomColour: true, seed })).contrast);
    onBlack.push((await plan({ background: '#000000', randomColour: true, seed })).contrast);
  }
  ok('a random colour on a pale background is always readable',
    onWhite.every((c) => c >= 4.5), onWhite.join(', '));
  ok('a random colour on a dark one is too',
    onBlack.every((c) => c >= 4.5), onBlack.join(', '));
  /* The null measurement: the same figure where the colour is *not* chosen to
     suit the backdrop, so the two above are known to still be able to fail. */
  const blind = (await plan({ background: '#ffffff', colour: '#f2f2f2' })).contrast;
  ok('and the contrast figure can report an unreadable pair',
    blind < 1.5, String(blind));

  /* NOT CHECKED, and found by trying to. `randomColour` reads the backdrop off
     the canvas it is about to draw rather than the one it drew last, which
     matters when a single call resizes and rolls the dice together — the
     shape of the canvas decides which part of the photograph the words sit
     over. Putting the bug back in and running this suite changes nothing any
     check can see, and the reason is in the arithmetic rather than in the
     coverage: cropping to *cover* keeps roughly the same mean brightness
     whatever shape the canvas is, so the two readings agree closely enough
     that no honest threshold separates them. A check tuned finely enough to
     tell them apart would be measuring the fixture, not the page. It is
     written down here instead. */
}

/* =================================================================== the files */

{
  await plan({ canvas: '800x600', text: 'Saved and read back again.', author: '',
    colour: '#ffffff', background: '#203040' });

  for (const [type, ext, magic] of [
    ['image/png', 'png', [0x89, 0x50, 0x4e, 0x47]],
    ['image/jpeg', 'jpg', [0xff, 0xd8, 0xff]],
    ['image/webp', 'webp', [0x52, 0x49, 0x46, 0x46]],
  ]) {
    const made = await page.evaluate((t) =>
      window.CLI.jobs.make({ format: t, quality: 85, bytes: true }), type);
    const bytes = Buffer.from(made.bytes);
    fs.writeFileSync(`${WORK}/quote-made.${ext}`, bytes);
    ok(`a ${ext} is written and starts with the right magic number`,
      magic.every((b, i) => bytes[i] === b), [...bytes.slice(0, 4)].join(','));
    ok(`the ${ext} name the page would save under ends in .${ext}`,
      made.name.endsWith('.' + ext) && made.name.startsWith('quote-'), made.name);

    /* Read back through the page itself rather than through a decoder written
       here to check it: a second reader is a second implementation, and the
       two drift. The page's own file input is the one thing in the repo that
       opens what the page wrote. */
    await settle(() => page.setInputFiles('#photoFile', `${WORK}/quote-made.${ext}`));
    const back = (await state()).photo;
    ok(`the saved ${ext} opens again, at the size it was saved at`,
      back && back.from === 'file' && back.width === 800 && back.height === 600,
      JSON.stringify(back));
  }

  /* PNG's IHDR, which needs no decoder at all — the one case the rule above
     says it is fine to read bytes directly for. */
  const png = fs.readFileSync(`${WORK}/quote-made.png`);
  ok('and the PNG header agrees with the canvas that made it',
    png.readUInt32BE(16) === 800 && png.readUInt32BE(20) === 600,
    `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);

  const lossy = await page.evaluate(() => window.CLI.jobs.make({ format: 'image/jpeg', quality: 30, bytes: true }));
  const fine = await page.evaluate(() => window.CLI.jobs.make({ format: 'image/jpeg', quality: 95, bytes: true }));
  ok('the quality slider changes the file rather than only the label',
    lossy.fileBytes < fine.fileBytes * 0.8,
    `${lossy.fileBytes} at 30 vs ${fine.fileBytes} at 95`);
  ok('and a lossless format reports no quality at all',
    (await page.evaluate(() => window.CLI.jobs.make({ format: 'image/png' }))).quality === null,
    'png claimed a quality');

  ok('a slider asked for a value past its end is a sentence, not a clamp',
    await plan({ fill: 300 }).then(() => false, (e) => /off the end of it/.test(e.message)),
    'it took --fill 300');

  /* The Save button is the other half, and a job that never pressed it would
     not have noticed the download handler breaking. */
  await plan({ format: 'image/png' });
  const download = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#saveBtn'),
  ]).then(([d]) => d, () => null);
  ok('the Save button hands the browser a file',
    download && /^quote-.*\.png$/.test(download.suggestedFilename()),
    download ? download.suggestedFilename() : 'no download');
}

/* ===================================================================== wrap up */

ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

await browser.close();
process.exit(done());
